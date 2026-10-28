import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
  mock,
} from 'bun:test'
import { act, render, renderHook } from '@testing-library/react'
import React, { Activity, StrictMode } from 'react'

import type { PointFeature } from '../geojson'
import type { MapRegion } from '../types'

// When set, `createHybridObject` throws it (native module missing).
let createHybridObjectError: Error | null = null

interface HeldBuild {
  resolve: () => void
  reject: (error: Error) => void
}

// When set, every `buildAsync` waits here, oldest first, until a test lands
// or fails it: a native build that outlasts the updates around it.
let heldBuilds: HeldBuild[] | null = null

// Only the native boundary is mocked; the real Supercluster runs on top of it.
// (Module mocks are process-wide in bun, so internal modules are not mocked.)
mock.module('react-native-nitro-modules', () => ({
  NitroModules: {
    createHybridObject: () => {
      if (createHybridObjectError != null) {
        throw createHybridObjectError
      }
      const engine = {
        isBuilt: false,
        setOptions: () => {},
        setPoints: () => {},
        build: () => {
          engine.isBuilt = true
        },
        buildAsync: () => {
          if (heldBuilds == null) {
            engine.isBuilt = true
            return Promise.resolve()
          }
          const held = heldBuilds
          return new Promise<void>((resolve, reject) => {
            held.push({
              resolve: () => {
                engine.isBuilt = true
                resolve()
              },
              reject,
            })
          })
        },
        getClusters: () => [],
        getChildren: () => [],
        getLeaves: () => [],
        getClusterBounds: () => undefined,
        getClusterExpansionZoom: () => 0,
        dispose: () => {},
      }
      return engine
    },
    updateMemorySize: <T,>(engine: T) => engine,
  },
}))

const { Supercluster } = await import('../engine/Supercluster')
const { useClusterer } = await import('./useClusterer')
const { useClusterIndex } = await import('./useClusterIndex')
const { Clusterer } = await import('../clusterer/Clusterer')

const REGION: MapRegion = {
  latitude: 37.78,
  longitude: -122.42,
  latitudeDelta: 0.05,
  longitudeDelta: 0.05,
}

const MAP_DIMENSIONS = { width: 400, height: 800 }

const POINT_A: PointFeature = {
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [-122.42, 37.78] },
  properties: { id: 'a' },
}

const POINT_B: PointFeature = {
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [-122.41, 37.79] },
  properties: { id: 'b' },
}

describe('useClusterer cleanup', () => {
  it('destroys the previous engine once its replacement has loaded, and on unmount', async () => {
    const destroy = jest.spyOn(Supercluster.prototype, 'destroy')

    const { rerender, unmount } = renderHook(
      ({ data }) => useClusterer(data, MAP_DIMENSIONS, REGION),
      { initialProps: { data: [POINT_A] } }
    )
    await act(async () => {})

    expect(destroy).not.toHaveBeenCalled()

    rerender({ data: [POINT_B] })

    // The loaded engine keeps serving queries while the new one builds.
    expect(destroy).not.toHaveBeenCalled()

    await act(async () => {})

    expect(destroy).toHaveBeenCalledTimes(1)

    unmount()

    expect(destroy).toHaveBeenCalledTimes(2)

    destroy.mockRestore()
  })
})

describe('useClusterer live updates', () => {
  /** The data of a live feed at `tick`: POINT_A moves, POINT_B stays put. */
  function feedAt(tick: number): PointFeature[] {
    return [
      {
        ...POINT_A,
        geometry: {
          type: 'Point',
          coordinates: [-122.42 + tick * 0.001, 37.78],
        },
      },
      POINT_B,
    ]
  }

  /** Lands the oldest held build, or fails it with `error`. */
  async function settleBuild(error?: Error): Promise<void> {
    await act(async () => {
      const build = heldBuilds!.shift()!
      if (error == null) {
        build.resolve()
      } else {
        build.reject(error)
      }
    })
  }

  function renderFeed(initial: PointFeature[], onError?: (e: Error) => void) {
    return renderHook(
      ({ data }) => useClusterIndex(data, MAP_DIMENSIONS, REGION, { onError }),
      { initialProps: { data: initial } }
    )
  }

  beforeEach(() => {
    heldBuilds = []
  })

  afterEach(() => {
    heldBuilds = null
  })

  it('advances the index while every build is overtaken by the next update', async () => {
    const { result, rerender } = renderFeed(feedAt(0))
    await settleBuild()
    const first = result.current.supercluster

    // Each build lands only after the next update has arrived.
    for (let tick = 1; tick <= 4; tick++) {
      rerender({ data: feedAt(tick) })
      if (tick > 1) {
        await settleBuild()
      }
    }

    expect(result.current.supercluster).not.toBe(first)
  })

  it('runs one build at a time, then builds the newest data', async () => {
    const loadAsync = jest.spyOn(Supercluster.prototype, 'loadAsync')
    const feed = [0, 1, 2, 3].map(feedAt)
    const { result, rerender } = renderFeed(feed[0]!)
    await settleBuild()
    const first = result.current.supercluster

    rerender({ data: feed[1]! })
    rerender({ data: feed[2]! })
    rerender({ data: feed[3]! })

    // The updates during a build wait for it.
    expect(loadAsync).toHaveBeenCalledTimes(2)

    await settleBuild()

    // The overtaken build still lands, and the newest data builds next,
    // skipping the update in between.
    expect(result.current.supercluster).not.toBe(first)
    expect(result.current.isCurrent).toBe(false)
    expect(loadAsync).toHaveBeenCalledTimes(3)
    expect(loadAsync.mock.calls[2]![0]).toBe(feed[3]!)

    await settleBuild()

    expect(result.current.isCurrent).toBe(true)
    expect(loadAsync).toHaveBeenCalledTimes(3)

    loadAsync.mockRestore()
  })

  it('stays silent when an overtaken build fails, and builds the newest data', async () => {
    const onError = jest.fn()
    const { result, rerender } = renderFeed(feedAt(0), onError)
    await settleBuild()

    rerender({ data: feedAt(1) })
    rerender({ data: feedAt(2) })
    await settleBuild(new Error('overtaken'))

    expect(onError).not.toHaveBeenCalled()
    expect(heldBuilds).toHaveLength(1)

    await settleBuild()

    expect(result.current.isCurrent).toBe(true)
    expect(onError).not.toHaveBeenCalled()
  })

  it('reports a failed build of the current data once, without retrying it', async () => {
    const onError = jest.fn()
    const { rerender } = renderFeed(feedAt(0), onError)
    await settleBuild()

    rerender({ data: feedAt(1) })
    await settleBuild(new Error('failed'))
    rerender({ data: feedAt(1) })

    expect(onError).toHaveBeenCalledTimes(1)
    expect(heldBuilds).toHaveLength(0)

    // New data still builds.
    rerender({ data: feedAt(2) })

    expect(heldBuilds).toHaveLength(1)
  })

  it('builds once under StrictMode', async () => {
    const data = feedAt(0)
    const { result } = renderHook(
      () => useClusterIndex(data, MAP_DIMENSIONS, REGION),
      { wrapper: StrictMode }
    )
    expect(heldBuilds).toHaveLength(1)

    await settleBuild()

    expect(result.current.isCurrent).toBe(true)
    expect(heldBuilds).toHaveLength(0)
  })

  describe('when hidden and shown again', () => {
    const data = feedAt(0)
    let index: ReturnType<typeof useClusterIndex> | null = null

    function Probe() {
      index = useClusterIndex(data, MAP_DIMENSIONS, REGION)
      return null
    }

    function Shown({ visible }: { visible: boolean }) {
      return (
        <Activity mode={visible ? 'visible' : 'hidden'}>
          <Probe />
        </Activity>
      )
    }

    it('builds again for the engine destroyed while hidden', async () => {
      const { rerender } = render(<Shown visible />)
      await settleBuild()

      rerender(<Shown visible={false} />)
      rerender(<Shown visible />)

      expect(index!.supercluster.isLoaded).toBe(false)
      expect(heldBuilds).toHaveLength(1)

      await settleBuild()

      expect(index!.supercluster.isLoaded).toBe(true)
    })

    it('builds again for a build that landed while hidden', async () => {
      const { rerender } = render(<Shown visible />)
      rerender(<Shown visible={false} />)
      await settleBuild()
      rerender(<Shown visible />)

      expect(heldBuilds).toHaveLength(1)

      await settleBuild()

      expect(index!.supercluster.isLoaded).toBe(true)
    })

    it('keeps a build that lands once shown again', async () => {
      const { rerender } = render(<Shown visible />)
      rerender(<Shown visible={false} />)
      rerender(<Shown visible />)
      await settleBuild()

      expect(index!.supercluster.isLoaded).toBe(true)
      expect(heldBuilds).toHaveLength(0)
    })
  })

  it('destroys a build that lands after unmount', async () => {
    const destroy = jest.spyOn(Supercluster.prototype, 'destroy')
    const onError = jest.fn()
    const { unmount } = renderFeed(feedAt(0), onError)

    unmount()
    await settleBuild()

    expect(destroy).toHaveBeenCalledTimes(1)
    expect(onError).not.toHaveBeenCalled()

    destroy.mockRestore()
  })
})

describe('useClusterer build failures (#15)', () => {
  beforeEach(() => {
    createHybridObjectError = new Error('ClusterEngine is not registered')
  })

  afterEach(() => {
    createHybridObjectError = null
  })

  it('throws a failed build into render', async () => {
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => {})
    let thrown: unknown = null
    try {
      renderHook(() => useClusterer([POINT_A], MAP_DIMENSIONS, REGION))
      await act(async () => {})
    } catch (error) {
      thrown = error
    }
    consoleError.mockRestore()

    expect((thrown as Error).message).toContain(
      'the native ClusterEngine module is not available'
    )
  })

  it('passes a failed build to onError instead', async () => {
    const onError = jest.fn()

    const { result } = renderHook(() =>
      useClusterer([POINT_A], MAP_DIMENSIONS, REGION, { onError })
    )
    await act(async () => {})

    expect(onError).toHaveBeenCalledTimes(1)
    expect(result.current[0]).toEqual([])
  })

  it('forwards onError from Clusterer', async () => {
    const onError = jest.fn()

    render(
      <Clusterer
        data={[POINT_A]}
        region={REGION}
        mapDimensions={MAP_DIMENSIONS}
        renderItem={() => <></>}
        onError={onError}
      />
    )
    await act(async () => {})

    expect(onError).toHaveBeenCalledTimes(1)
  })
})

describe('useClusterer invalid options (#19)', () => {
  it('reports invalid options to onError, naming the option', async () => {
    const onError = jest.fn()

    const { result } = renderHook(() =>
      useClusterer([POINT_A], MAP_DIMENSIONS, REGION, {
        maxZoom: 100,
        onError,
      })
    )
    await act(async () => {})

    expect(onError).toHaveBeenCalledTimes(1)
    expect((onError.mock.calls[0]![0] as Error).message).toBe(
      'react-native-better-clustering: maxZoom must be an integer from 0 to 30, got 100.'
    )
    expect(result.current[0]).toEqual([])
  })
})
