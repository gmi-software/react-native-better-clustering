import { beforeEach, describe, expect, it, jest } from 'bun:test'
import { act, render } from '@testing-library/react'
import React, { createRef, type MutableRefObject } from 'react'

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

    // One query for the rendered clusters and a second one only to compute
    // the LayoutAnimation signature (audit finding F-28; the #5 branch
    // removes it).
    expect(fakeClusterEngineStats.getClusters - before).toBe(2)
  })

  it('animates the next layout on iOS when the settled clusters change, unless animationEnabled is false', async () => {
    const { unmount } = render(<Map />)
    await flush()
    await settleRegion(regionAt(GROUP_CENTER, 20))
    expect(layoutAnimationCalls).toHaveLength(1)
    unmount()

    resetHarness()
    render(<Map animationEnabled={false} />)
    await flush()
    await settleRegion(regionAt(GROUP_CENTER, 20))
    expect(layoutAnimationCalls).toHaveLength(0)
  })
})

describe('MapView refs', () => {
  it('exposes the loaded Supercluster through superClusterRef, and null when clustering is off', async () => {
    const superClusterRef = createRef() as MutableRefObject<InstanceType<
      typeof Supercluster
    > | null>
    const { rerender } = render(<Map superClusterRef={superClusterRef} />)
    await flush()

    const instance = superClusterRef.current
    expect(instance).toBeInstanceOf(Supercluster)
    expect(instance!.isLoaded).toBe(true)

    rerender(
      <Map superClusterRef={superClusterRef} clusteringEnabled={false} />
    )
    await flush()
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
