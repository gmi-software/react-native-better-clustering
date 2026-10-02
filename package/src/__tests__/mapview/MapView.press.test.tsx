import { beforeEach, describe, expect, it, jest } from 'bun:test'
import { render } from '@testing-library/react'
import React from 'react'

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
  flush,
  harnessControls,
  mapState,
  polylineCount,
  press,
  regionAt,
  renderedMarkerIds,
  renderedMarkers,
  resetHarness,
  type LatLng,
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
        />
      ))}
    </MapView>
  )
}

function sortCoordinates(coordinates: LatLng[]): LatLng[] {
  return [...coordinates]
    .map(({ latitude, longitude }) => ({ latitude, longitude }))
    .sort((a, b) => a.latitude - b.latitude || a.longitude - b.longitude)
}

function theCluster(container: HTMLElement) {
  const cluster = renderedMarkers(container).find((m) => m.isCluster)
  if (cluster == null) throw new Error('no cluster rendered')
  return cluster
}

beforeEach(() => {
  resetHarness()
})

describe('MapView cluster press', () => {
  it('fits the map to every leaf of the pressed cluster and reports them to onClusterPress', async () => {
    const onClusterPress = jest.fn()
    const { container } = render(<Map onClusterPress={onClusterPress} />)
    await flush()

    press(theCluster(container))

    expect(mapState.fitToCoordinates).toHaveLength(1)
    const [{ coordinates, options }] = mapState.fitToCoordinates as [
      (typeof mapState.fitToCoordinates)[number],
    ]
    expect(sortCoordinates(coordinates)).toEqual(sortCoordinates(GROUP))
    expect(options).toEqual({
      edgePadding: { top: 50, left: 50, right: 50, bottom: 50 },
    })

    expect(onClusterPress).toHaveBeenCalledTimes(1)
    const [cluster, leaves] = onClusterPress.mock.calls[0] as [
      { properties: { point_count: number } },
      unknown[],
    ]
    expect(cluster.properties.point_count).toBe(5)
    expect(leaves).toHaveLength(5)
  })

  it('forwards a custom edgePadding to fitToCoordinates', async () => {
    const edgePadding = { top: 10, left: 20, right: 30, bottom: 40 }
    const { container } = render(<Map edgePadding={edgePadding} />)
    await flush()

    press(theCluster(container))

    expect(mapState.fitToCoordinates[0]!.options).toEqual({ edgePadding })
  })

  it('leaves the camera alone with preserveClusterPressBehavior', async () => {
    const onClusterPress = jest.fn()
    const { container } = render(
      <Map preserveClusterPressBehavior onClusterPress={onClusterPress} />
    )
    await flush()

    press(theCluster(container))

    expect(mapState.fitToCoordinates).toHaveLength(0)
    expect(mapState.animateToRegion).toHaveLength(0)
    expect(onClusterPress).toHaveBeenCalledTimes(1)
  })

  it('animates to the expansion region when the map is not ready yet', async () => {
    harnessControls.mapReady = false
    const { container } = render(<Map />)
    await flush()

    press(theCluster(container))

    expect(mapState.fitToCoordinates).toHaveLength(0)
    expect(mapState.animateToRegion).toHaveLength(1)
    const { region, duration } = mapState.animateToRegion[0]!
    expect(duration).toBe(300)
    expect(region.latitude).toBeCloseTo(GROUP[2]!.latitude, 6)
    expect(region.longitude).toBeCloseTo(GROUP[2]!.longitude, 6)
  })

  it('wires the same press handler into a custom renderCluster', async () => {
    const onClusterPress = jest.fn()
    const { container } = render(
      <Map
        onClusterPress={onClusterPress}
        renderCluster={(cluster) => {
          const [longitude, latitude] = cluster.geometry.coordinates
          return (
            <Marker
              testID="custom"
              coordinate={{ latitude, longitude }}
              onPress={cluster.onPress}
            />
          )
        }}
      />
    )
    await flush()

    press(renderedMarkers(container).find((m) => m.id === 'custom')!)

    expect(mapState.fitToCoordinates).toHaveLength(1)
    expect(onClusterPress).toHaveBeenCalledTimes(1)
  })
})

describe('MapView spiderfy', () => {
  // The cluster zoom MapView computes is about two levels below the camera
  // zoom, so the default maxZoom of 20 is only reached from ~camera zoom 22.
  const SPIDER_ZOOM = 23

  it('spreads co-located markers into a spiral with connector lines at maxZoom', async () => {
    const { container } = render(
      <Map points={SAME_SPOT} initialRegion={regionAt(CENTER, SPIDER_ZOOM)} />
    )
    await flush()

    expect(clusterLabels(container)).toEqual([])
    expect(renderedMarkerIds(container)).toEqual(
      SAME_SPOT.map((point) => point.id)
    )
    expect(polylineCount(container)).toBe(SAME_SPOT.length)
    const positions = new Set(
      renderedMarkers(container).map((m) => `${m.latitude},${m.longitude}`)
    )
    expect(positions.size).toBeGreaterThan(1)
  })

  it('keeps the cluster when spiralEnabled is false', async () => {
    const { container } = render(
      <Map
        points={SAME_SPOT}
        spiralEnabled={false}
        initialRegion={regionAt(CENTER, SPIDER_ZOOM)}
      />
    )
    await flush()

    expect(clusterLabels(container)).toEqual(['5'])
  })

  it('does not spiderfy clusters of points that can still split', async () => {
    const { container } = render(
      <Map points={GROUP} initialRegion={regionAt(GROUP[2]!, 20)} />
    )
    await flush()

    expect(polylineCount(container)).toBe(0)
  })
})
