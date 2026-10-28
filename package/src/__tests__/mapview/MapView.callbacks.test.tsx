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
import React, { createRef, type MutableRefObject } from 'react'
import type { Region } from 'react-native-maps'

import type { GeoJSONFeature } from '../../geojson/types'

import { CENTER, CITY_ZOOM, GROUP, SINGLES, type TestPoint } from './fixtures'
import {
  Marker,
  clusterLabels,
  fakeClusterEngineStats,
  flush,
  layoutAnimationCalls,
  mapState,
  regionAt,
  renderedMarkerIds,
  resetHarness,
  settleRegion,
} from './harness'

const { default: MapView } = await import('../../compat/MapView')
const { Supercluster } = await import('../../engine/Supercluster')

type MapViewProps = React.ComponentProps<typeof MapView>

const GROUP_CENTER = GROUP[2]!

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
        />
      ))}
    </MapView>
  )
}

beforeEach(() => {
  resetHarness()
})

describe('MapView callbacks', () => {
  it('reports the visible markers and clusters through onMarkersChange', async () => {
    const onMarkersChange = jest.fn()
    render(<Map onMarkersChange={onMarkersChange} />)
    await flush()

    const visible = onMarkersChange.mock.calls.at(-1)![0] as unknown[]
    expect(visible).toHaveLength(4)
  })

  it('calls onRegionChangeComplete with (region, details, markers) once the region settles', async () => {
    const onRegionChangeComplete = jest.fn()
    render(<Map onRegionChangeComplete={onRegionChangeComplete} />)
    await flush()

    const settled = regionAt(GROUP_CENTER, 20)
    await settleRegion(settled)

    expect(onRegionChangeComplete).toHaveBeenCalledTimes(1)
    const [region, details, features] = onRegionChangeComplete.mock
      .calls[0] as [unknown, unknown, unknown[]]
    expect(region).toEqual(settled)
    expect(details).toEqual({ isGesture: true })
    // Zoomed onto GROUP: its five points are visible individually.
    expect(features).toHaveLength(5)
  })

  it('forwards onRegionChange and onMapReady', async () => {
    const onRegionChange = jest.fn()
    const onMapReady = jest.fn()
    render(<Map onRegionChange={onRegionChange} onMapReady={onMapReady} />)
    await flush()

    const moving = regionAt(CENTER, CITY_ZOOM + 1)
    act(() => {
      mapState.props?.onRegionChange?.(moving, { isGesture: true })
    })

    expect(onMapReady).toHaveBeenCalledTimes(1)
    expect(onRegionChange).toHaveBeenCalledWith(moving, { isGesture: true })
  })
})

describe('MapView region updates', () => {
  it('splits a cluster when the settled region zooms in', async () => {
    const { container } = render(<Map />)
    await flush()
    expect(clusterLabels(container)).toEqual(['5'])

    await settleRegion(regionAt(GROUP_CENTER, 20))

    expect(clusterLabels(container)).toEqual([])
    expect(renderedMarkerIds(container)).toEqual(['g0', 'g1', 'g2', 'g3', 'g4'])
  })

  it('re-clusters during a gesture, throttled to clusterUpdateIntervalMs', async () => {
    const { container } = render(<Map clusterUpdateIntervalMs={100} />)
    await flush()

    // The first region event of a gesture syncs immediately (leading edge).
    act(() => {
      mapState.props?.onRegionChange?.(regionAt(GROUP_CENTER, 20), {
        isGesture: true,
      })
    })
    await flush()

    expect(clusterLabels(container)).toEqual([])
  })

  it('waits for the gesture to settle when clusterUpdateIntervalMs is 0', async () => {
    const { container } = render(<Map clusterUpdateIntervalMs={0} />)
    await flush()

    act(() => {
      mapState.props?.onRegionChange?.(regionAt(GROUP_CENTER, 20), {
        isGesture: true,
      })
    })
    await flush()
    expect(clusterLabels(container)).toEqual(['5'])

    await settleRegion(regionAt(GROUP_CENTER, 20))
    expect(clusterLabels(container)).toEqual([])
  })

  it('queries the native engine only for region changes, not unrelated re-renders of MapView state', async () => {
    render(<Map />)
    await flush()
    const before = fakeClusterEngineStats.getClusters

    await settleRegion(regionAt(GROUP_CENTER, 20))

    expect(fakeClusterEngineStats.getClusters - before).toBe(1)
  })

  it('never configures a LayoutAnimation, which cannot animate map markers', async () => {
    render(<Map layoutAnimationConf={{ duration: 300 }} />)
    await flush()

    await settleRegion(regionAt(GROUP_CENTER, 20))

    expect(layoutAnimationCalls).toHaveLength(0)
    // Accepted for compatibility, never passed on to the native map.
    expect(mapState.props).not.toHaveProperty('layoutAnimationConf')
  })
})

describe('MapView refs', () => {
  function createSuperClusterRef() {
    return createRef() as MutableRefObject<InstanceType<
      typeof Supercluster
    > | null>
  }

  it('leaves superClusterRef null until the first index has loaded', async () => {
    const superClusterRef = createSuperClusterRef()
    render(<Map superClusterRef={superClusterRef} />)
    expect(superClusterRef.current).toBeNull()

    await flush()
    expect(superClusterRef.current).toBeInstanceOf(Supercluster)
    expect(superClusterRef.current!.isLoaded).toBe(true)
  })

  it('moves superClusterRef to the rebuilt Supercluster after a coordinate change', async () => {
    const superClusterRef = createSuperClusterRef()
    const { rerender } = render(<Map superClusterRef={superClusterRef} />)
    await flush()
    const instance = superClusterRef.current

    const moved = [
      ...GROUP,
      ...SINGLES.map((point, index) =>
        index === 0 ? { ...point, latitude: point.latitude + 0.01 } : point
      ),
    ]
    rerender(<Map superClusterRef={superClusterRef} points={moved} />)
    await flush()

    const rebuilt = superClusterRef.current
    expect(rebuilt).toBeInstanceOf(Supercluster)
    expect(rebuilt).not.toBe(instance)
    expect(() => rebuilt!.getClusters([-180, -85, 180, 85], 1)).not.toThrow()
  })

  it('sets superClusterRef to null while clustering is off', async () => {
    const superClusterRef = createSuperClusterRef()
    const { rerender } = render(<Map superClusterRef={superClusterRef} />)
    await flush()

    rerender(
      <Map superClusterRef={superClusterRef} clusteringEnabled={false} />
    )
    await flush()
    expect(superClusterRef.current).toBeNull()

    rerender(<Map superClusterRef={superClusterRef} />)
    await flush()
    expect(superClusterRef.current?.isLoaded).toBe(true)
  })

  it('clears superClusterRef on unmount', async () => {
    const superClusterRef = createSuperClusterRef()
    const { unmount } = render(<Map superClusterRef={superClusterRef} />)
    await flush()

    unmount()
    expect(superClusterRef.current).toBeNull()
  })

  it('hands the native map to both the forwarded ref and mapRef', async () => {
    const forwarded = createRef<{ fitToCoordinates: unknown }>()
    const mapRef = jest.fn()
    render(
      <MapView
        ref={forwarded as never}
        mapRef={mapRef}
        initialRegion={regionAt(CENTER, CITY_ZOOM)}
      >
        {[]}
      </MapView>
    )
    await flush()

    expect(typeof forwarded.current?.fitToCoordinates).toBe('function')
    expect(mapRef).toHaveBeenCalledWith(forwarded.current)
  })
})

describe('MapView onRegionChangeComplete from react-native-map-clustering 3.x', () => {
  const NOTICE =
    /onRegionChangeComplete is called with \(region, details, markers\)/
  let warn: ReturnType<typeof spyOn>

  const notices = () =>
    warn.mock.calls.filter((call: unknown[]) => NOTICE.test(String(call[0])))

  beforeEach(() => {
    warn = spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warn.mockRestore()
  })

  // The notice is once per app, so the silent cases run before it fires.
  it('stays silent for handlers that do not declare exactly two parameters', async () => {
    const calls: unknown[][] = []
    render(<Map />)
    render(<Map onRegionChangeComplete={(region) => calls.push([region])} />)
    render(
      <Map
        onRegionChangeComplete={(region, details, markers) =>
          calls.push([region, details, markers])
        }
      />
    )
    await flush()

    expect(notices()).toHaveLength(0)
  })

  it('warns once about handlers that declare two parameters', async () => {
    const calls: unknown[][] = []
    const { rerender, unmount } = render(
      <Map
        onRegionChangeComplete={(region, details) =>
          calls.push([region, details])
        }
      />
    )
    await flush()
    rerender(
      <Map
        onRegionChangeComplete={(region, details) =>
          calls.push([details, region])
        }
      />
    )
    unmount()
    render(
      <Map
        onRegionChangeComplete={(region, details) =>
          calls.push([region, details])
        }
      />
    )
    await flush()

    expect(notices()).toHaveLength(1)
  })

  it('still calls a two-parameter handler with (region, details, markers)', async () => {
    const onRegionChangeComplete = jest.fn()
    render(
      <Map
        onRegionChangeComplete={(region, details) =>
          onRegionChangeComplete(region, details)
        }
      />
    )
    await flush()

    const settled = regionAt(GROUP_CENTER, 20)
    await settleRegion(settled)

    expect(onRegionChangeComplete).toHaveBeenCalledWith(settled, {
      isGesture: true,
    })
  })

  it('rejects a handler typed for 3.x at compile time', () => {
    const props: Partial<MapViewProps> = {
      // @ts-expect-error The second argument is `details`, not the markers.
      onRegionChangeComplete: (_region: Region, markers: GeoJSONFeature[]) =>
        markers.length,
    }
    expect(typeof props.onRegionChangeComplete).toBe('function')
  })
})
