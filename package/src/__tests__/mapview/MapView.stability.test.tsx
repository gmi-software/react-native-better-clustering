/**
 * Mount stability, data updates and the known MapView bugs.
 *
 * `it.failing` tests pin down open issues: each one passes while its bug is
 * present and turns red once the bug is fixed, telling the fix to drop the
 * `.failing` and keep the test as a regression guard.
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
  spyOn,
} from 'bun:test'
import { act, render } from '@testing-library/react'
import React, { StrictMode, useState } from 'react'

import {
  CENTER,
  CITY_ZOOM,
  GROUP,
  SAME_SPOT,
  SINGLES,
  type TestPoint,
} from './fixtures'
import {
  Marker,
  clusterLabels,
  fakeClusterEngineStats,
  flush,
  harnessControls,
  mapState,
  mountLog,
  polylineCount,
  press,
  regionAt,
  renderedMarkerIds,
  renderedMarkers,
  resetHarness,
  retargetsSince,
  settleRegion,
  unmountsSince,
} from './harness'

const { default: MapView } = await import('../../compat/MapView')

type MapViewProps = React.ComponentProps<typeof MapView>

function Map({
  points = [...GROUP, ...SINGLES],
  ...props
}: Partial<MapViewProps> & { points?: TestPoint[] }) {
  return (
    <MapView
      initialRegion={regionAt(CENTER, CITY_ZOOM)}
      clusterFadeInDuration={0}
      {...props}
    >
      {points.map((point) => (
        <Marker
          key={point.id}
          testID={point.id}
          coordinate={{ latitude: point.latitude, longitude: point.longitude }}
          cluster={point.cluster}
        />
      ))}
    </MapView>
  )
}

/** Far enough from GROUP and SINGLES to render on its own at CITY_ZOOM. */
const EXTRA: TestPoint = { id: 'x0', latitude: 52.21, longitude: 21.0 }

beforeEach(() => {
  resetHarness()
})

describe('MapView mount stability', () => {
  it('keeps every marker mounted when a pan settles on the same clusters', async () => {
    const { container } = render(<Map />)
    await flush()
    const before = renderedMarkers(container).length
    const start = mountLog.length

    await settleRegion(
      regionAt(
        { latitude: CENTER.latitude + 0.0005, longitude: CENTER.longitude },
        CITY_ZOOM
      )
    )

    expect(unmountsSince(start)).toEqual([])
    expect(renderedMarkers(container)).toHaveLength(before)
  })

  it('shows a newly added marker once the index has rebuilt', async () => {
    const { container, rerender } = render(<Map />)
    await flush()

    rerender(<Map points={[...GROUP, ...SINGLES, EXTRA]} />)
    await flush()

    expect(renderedMarkerIds(container)).toEqual(['s0', 's1', 's2', 'x0'])
    expect(fakeClusterEngineStats.created).toBe(2)
  })

  it('keeps a removed default bubble mounted while it fades out', async () => {
    // Default clusterFadeInDuration (250 ms): the old bubble lingers, marked as
    // exiting, while the new markers fade in.
    const { container } = render(
      <MapView initialRegion={regionAt(CENTER, CITY_ZOOM)}>
        {GROUP.map((point) => (
          <Marker key={point.id} testID={point.id} coordinate={point} />
        ))}
      </MapView>
    )
    await flush()
    expect(clusterLabels(container)).toEqual(['5'])

    jest.useFakeTimers()
    try {
      act(() => {
        mapState.props?.onRegionChangeComplete?.(regionAt(GROUP[2]!, 20), {
          isGesture: true,
        })
      })
      expect(clusterLabels(container)).toEqual(['5'])
      expect(renderedMarkerIds(container)).toEqual(GROUP.map((p) => p.id))

      act(() => {
        jest.advanceTimersByTime(250)
      })
      expect(clusterLabels(container)).toEqual([])
    } finally {
      jest.useRealTimers()
    }
  })
})

describe('MapView index rebuilds (#12, #13)', () => {
  it('#12: an unrelated parent re-render keeps the index and every marker mounted, and onMarkersChange quiet', async () => {
    const onMarkersChange = jest.fn()
    function Parent({ tick }: { tick: number }) {
      return (
        <Map
          accessibilityLabel={`tick ${tick}`}
          onMarkersChange={(markers) => onMarkersChange(markers)}
        />
      )
    }
    const { rerender } = render(<Parent tick={0} />)
    await flush()
    const start = mountLog.length
    const calls = onMarkersChange.mock.calls.length

    rerender(<Parent tick={1} />)
    await flush()

    expect(fakeClusterEngineStats.created).toBe(1)
    expect(unmountsSince(start)).toEqual([])
    expect(onMarkersChange.mock.calls.length).toBe(calls)
  })

  it('#12: onMarkersChange={setState} with inline children settles', async () => {
    let renders = 0
    function Parent() {
      const [, setVisible] = useState<unknown[]>([])
      renders++
      // Stop feeding the loop after 30 renders so the test terminates.
      return <Map onMarkersChange={renders < 30 ? setVisible : undefined} />
    }
    render(<Parent />)
    for (let i = 0; i < 10; i++) await flush()

    // The first render, plus at most two once the index has loaded.
    expect(renders).toBeLessThanOrEqual(3)
    expect(fakeClusterEngineStats.created).toBe(1)
  })

  it('#12: onMarkersChange is not called with the empty set before the first load', async () => {
    const onMarkersChange = jest.fn()
    render(<Map onMarkersChange={onMarkersChange} />)
    await flush()

    expect(onMarkersChange).toHaveBeenCalledTimes(1)
    expect(onMarkersChange.mock.calls[0]![0]).toHaveLength(4)
  })

  it('#12: a data update keeps the previous markers until the rebuild lands', async () => {
    const { container, rerender } = render(<Map />)
    await flush()

    rerender(<Map points={[...GROUP, ...SINGLES, EXTRA]} />)
    expect(renderedMarkerIds(container)).toEqual(['s0', 's1', 's2'])
    expect(clusterLabels(container)).toEqual(['5'])

    await flush()
    expect(renderedMarkerIds(container)).toEqual(['s0', 's1', 's2', 'x0'])
  })

  it('#12: a marker inserted at the start does not shift the markers shown while rebuilding', async () => {
    const { container, rerender } = render(<Map points={SINGLES} />)
    await flush()

    rerender(<Map points={[EXTRA, ...SINGLES]} />)
    expect(renderedMarkerIds(container)).toEqual(['s0', 's1', 's2'])

    await flush()
    expect(renderedMarkerIds(container)).toEqual(['s0', 's1', 's2', 'x0'])
  })

  it('#12: a non-clustered child inserted before the markers keeps every marker on its own element', async () => {
    function Pinned({ pinned }: { pinned: boolean }) {
      return (
        <MapView
          initialRegion={regionAt(CENTER, CITY_ZOOM)}
          clusterFadeInDuration={0}
        >
          {pinned ? (
            <Marker
              key="pinned"
              testID="pinned"
              cluster={false}
              coordinate={EXTRA}
            />
          ) : null}
          {[...GROUP, ...SINGLES].map((point) => (
            <Marker
              key={point.id}
              testID={point.id}
              coordinate={{
                latitude: point.latitude,
                longitude: point.longitude,
              }}
            />
          ))}
        </MapView>
      )
    }
    const { container, rerender } = render(<Pinned pinned={false} />)
    await flush()

    rerender(<Pinned pinned />)
    expect(renderedMarkerIds(container)).toEqual(['pinned', 's0', 's1', 's2'])

    await flush()
    expect(renderedMarkerIds(container)).toEqual(['pinned', 's0', 's1', 's2'])
    expect(clusterLabels(container)).toEqual(['5'])
  })

  it('#12: a prop-only change does not rebuild, and cluster leaves carry the new prop', async () => {
    const onClusterPress = jest.fn()
    function Titled({ suffix }: { suffix: string }) {
      return (
        <MapView
          initialRegion={regionAt(CENTER, CITY_ZOOM)}
          clusterFadeInDuration={0}
          preserveClusterPressBehavior
          onClusterPress={onClusterPress}
        >
          {GROUP.map((point) => (
            <Marker
              key={point.id}
              testID={point.id}
              title={`${point.id} ${suffix}`}
              coordinate={{
                latitude: point.latitude,
                longitude: point.longitude,
              }}
            />
          ))}
        </MapView>
      )
    }
    const { container, rerender } = render(<Titled suffix="old" />)
    await flush()

    rerender(<Titled suffix="new" />)
    await flush()
    expect(fakeClusterEngineStats.created).toBe(1)

    press(renderedMarkers(container).find((marker) => marker.isCluster)!)
    const leaves = onClusterPress.mock.calls[0]![1] as Array<{
      properties: { title: string }
    }>
    expect(leaves.map((leaf) => leaf.properties.title).sort()).toEqual(
      GROUP.map((point) => `${point.id} new`)
    )
  })

  it('#12: mounts once under StrictMode without querying a destroyed engine', async () => {
    const consoleError = spyOn(console, 'error').mockImplementation(() => {})
    try {
      const { container } = render(
        <StrictMode>
          <Map />
        </StrictMode>
      )
      await flush()

      expect(renderedMarkerIds(container)).toEqual(['s0', 's1', 's2'])
      expect(clusterLabels(container)).toEqual(['5'])
      expect(fakeClusterEngineStats.created).toBeLessThanOrEqual(2)
      expect(consoleError).not.toHaveBeenCalled()
    } finally {
      consoleError.mockRestore()
    }
  })

  it('#13: getExpansionRegion still works after an unrelated parent re-render', async () => {
    const seen: Array<{ properties: { getExpansionRegion: () => unknown } }> =
      []
    function Parent({ tick }: { tick: number }) {
      return (
        <Map
          accessibilityLabel={`tick ${tick}`}
          renderCluster={(cluster) => {
            seen.push(cluster)
            const [longitude, latitude] = cluster.geometry.coordinates
            return (
              <Marker testID="custom" coordinate={{ latitude, longitude }} />
            )
          }}
        />
      )
    }
    const { rerender } = render(<Parent tick={0} />)
    await flush()
    rerender(<Parent tick={1} />)
    await flush()

    expect(() => seen.at(-1)!.properties.getExpansionRegion()).not.toThrow()
  })

  it('#13: getExpansionRegion still works after the index is rebuilt', async () => {
    const seen: Array<{ properties: { getExpansionRegion: () => unknown } }> =
      []
    function Parent({ points }: { points: TestPoint[] }) {
      return (
        <Map
          points={points}
          renderCluster={(cluster) => {
            seen.push(cluster)
            const [longitude, latitude] = cluster.geometry.coordinates
            return (
              <Marker testID="custom" coordinate={{ latitude, longitude }} />
            )
          }}
        />
      )
    }
    const { rerender } = render(<Parent points={[...GROUP, ...SINGLES]} />)
    await flush()
    rerender(<Parent points={[...GROUP, ...SINGLES, EXTRA]} />)
    await flush()

    expect(fakeClusterEngineStats.created).toBe(2)
    expect(() => seen.at(-1)!.properties.getExpansionRegion()).not.toThrow()
  })
})

describe('MapView engine failures (#15)', () => {
  const missingEngine = new Error(
    'HybridObject ClusterEngine is not registered'
  )
  let consoleError: ReturnType<typeof spyOn>

  beforeEach(() => {
    harnessControls.createHybridObjectError = missingEngine
    consoleError = spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleError.mockRestore()
  })

  async function renderAndCatch(element: React.ReactElement) {
    let thrown: unknown = null
    try {
      render(element)
      await flush()
    } catch (error) {
      thrown = error
    }
    return thrown
  }

  it('throws an actionable error into render when the native engine is missing', async () => {
    const thrown = await renderAndCatch(<Map />)

    expect(thrown).toBeInstanceOf(Error)
    const { message, cause } = thrown as Error
    expect(message).toContain('Rebuild the app after installing the library')
    expect(message).toContain('Expo Go is not supported')
    expect(message).toContain(missingEngine.message)
    expect(cause).toBe(missingEngine)
  })

  it('passes the error to onError instead of throwing', async () => {
    const onError = jest.fn()

    const thrown = await renderAndCatch(<Map onError={onError} />)

    expect(thrown).toBeNull()
    expect(onError).toHaveBeenCalledTimes(1)
    const [error] = onError.mock.calls[0] as [Error]
    expect(error.message).toContain('Expo Go is not supported')
  })

  it('keeps showing the previous markers when a rebuild fails', async () => {
    harnessControls.createHybridObjectError = null
    const onError = jest.fn()
    const { container, rerender } = render(<Map onError={onError} />)
    await flush()
    const before = renderedMarkerIds(container)

    harnessControls.createHybridObjectError = missingEngine
    rerender(<Map onError={onError} points={[...GROUP, ...SINGLES, EXTRA]} />)
    await flush()

    expect(onError).toHaveBeenCalledTimes(1)
    expect(renderedMarkerIds(container)).toEqual(before)
  })

  it('stays silent when the map unmounts before the build settles', async () => {
    const onError = jest.fn()

    const thrown = await (async () => {
      try {
        const { unmount } = render(<Map onError={onError} />)
        unmount()
        await flush()
        return null
      } catch (error) {
        return error
      }
    })()

    expect(thrown).toBeNull()
    expect(onError).not.toHaveBeenCalled()
    expect(consoleError).not.toHaveBeenCalled()
  })
})

describe('MapView marker keys (#28)', () => {
  it('does not remount other markers when one is inserted at the start', async () => {
    const { rerender } = render(<Map points={SINGLES} />)
    await flush()
    const start = mountLog.length

    rerender(<Map points={[EXTRA, ...SINGLES]} />)
    await flush()

    expect(unmountsSince(start)).toEqual([])
    // Index keys used to hand the shifted markers' instances to other points.
    expect(retargetsSince(start)).toEqual([])
  })

  it('unmounts only the marker removed from the start', async () => {
    const { rerender } = render(<Map points={[EXTRA, ...SINGLES]} />)
    await flush()
    const start = mountLog.length

    rerender(<Map points={SINGLES} />)
    await flush()

    expect(unmountsSince(start)).toEqual(['x0'])
    expect(retargetsSince(start)).toEqual([])
  })
})

describe('MapView known issues', () => {
  let consoleError: ReturnType<typeof spyOn>

  beforeEach(() => {
    consoleError = spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleError.mockRestore()
  })

  it.failing(
    '#14: markers with cluster={true} are clustered and rendered as themselves',
    async () => {
      const { container } = render(
        <Map points={SINGLES.map((point) => ({ ...point, cluster: true }))} />
      )
      await flush()

      expect(renderedMarkerIds(container)).toEqual(['s0', 's1', 's2'])
    }
  )

  it.failing(
    '#16: spiderfy caps how many markers and connector lines it renders',
    async () => {
      const crowd: TestPoint[] = Array.from({ length: 200 }, (_, i) => ({
        id: `c${i}`,
        latitude: CENTER.latitude,
        longitude: CENTER.longitude,
      }))
      const { container } = render(
        <Map points={crowd} initialRegion={regionAt(CENTER, 23)} />
      )
      await flush()

      // The cap's value is the fix's call (about 50 is suggested); any cap
      // renders fewer markers and lines than there are leaves.
      expect(renderedMarkers(container).length).toBeLessThan(crowd.length)
      expect(polylineCount(container)).toBeLessThan(crowd.length)
    }
  )

  it.failing('#22: co-located markers spiderfy by camera zoom 19', async () => {
    // Today spiderfy needs camera zoom 22+, beyond Google Maps' maximum.
    const { container } = render(
      <Map points={SAME_SPOT} initialRegion={regionAt(CENTER, 19)} />
    )
    await flush()

    expect(clusterLabels(container)).toEqual([])
    expect(renderedMarkerIds(container)).toHaveLength(SAME_SPOT.length)
  })
})
