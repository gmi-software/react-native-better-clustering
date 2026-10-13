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
  fakeClusterEngineStats,
  flush,
  harnessControls,
  mapState,
  polylineCount,
  press,
  regionAt,
  renderedMarkerIds,
  renderedMarkers,
  resetHarness,
  settleRegion,
} from './harness'
import { SPIRAL_SPACING_PT } from '../../compat/spiral'

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

function theCluster(container: HTMLElement) {
  const cluster = renderedMarkers(container).find((m) => m.isCluster)
  if (cluster == null) throw new Error('no cluster rendered')
  return cluster
}

beforeEach(() => {
  resetHarness()
})

describe('MapView cluster press', () => {
  it('fits the map to the bounds of the pressed cluster and reports its markers to onClusterPress', async () => {
    const onClusterPress = jest.fn()
    const { container } = render(<Map onClusterPress={onClusterPress} />)
    await flush()
    const leafQueries = fakeClusterEngineStats.getLeaves

    press(theCluster(container))

    expect(mapState.fitToCoordinates).toHaveLength(1)
    const [{ coordinates, options }] = mapState.fitToCoordinates as [
      (typeof mapState.fitToCoordinates)[number],
    ]
    const latitudes = GROUP.map((point) => point.latitude)
    const longitudes = GROUP.map((point) => point.longitude)
    expect(coordinates).toHaveLength(3)
    expect(coordinates[0]).toEqual({
      latitude: Math.min(...latitudes),
      longitude: Math.min(...longitudes),
    })
    expect(coordinates[2]).toEqual({
      latitude: Math.max(...latitudes),
      longitude: Math.max(...longitudes),
    })
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
    expect(fakeClusterEngineStats.getLeaves - leafQueries).toBe(1)
  })

  it('reads no markers on press without an onClusterPress', async () => {
    const { container } = render(<Map />)
    await flush()
    const leafQueries = fakeClusterEngineStats.getLeaves

    press(theCluster(container))

    expect(mapState.fitToCoordinates).toHaveLength(1)
    expect(fakeClusterEngineStats.getLeaves).toBe(leafQueries)
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
  // Above the default spiderfyMinZoom (19) and at the index's maxZoom.
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

describe('MapView bounded spiderfy (#16)', () => {
  const SPIDER_ZOOM = 23
  const SPIDER_REGION = regionAt(CENTER, SPIDER_ZOOM)

  function crowd(count: number): TestPoint[] {
    return Array.from({ length: count }, (_, i) => ({
      id: `c${i}`,
      latitude: CENTER.latitude,
      longitude: CENTER.longitude,
    }))
  }

  it.each([200, 1000])(
    'keeps %i identical markers as one cluster bubble',
    async (count) => {
      const { container } = render(
        <Map points={crowd(count)} initialRegion={SPIDER_REGION} />
      )
      await flush()

      expect(clusterLabels(container)).toHaveLength(1)
      expect(renderedMarkerIds(container)).toEqual([])
      expect(polylineCount(container)).toBe(0)
    }
  )

  it('spiderfies a cluster of exactly spiderfyMaxLeaves markers', async () => {
    const { container } = render(
      <Map points={crowd(50)} initialRegion={SPIDER_REGION} />
    )
    await flush()

    expect(clusterLabels(container)).toEqual([])
    expect(renderedMarkerIds(container)).toHaveLength(50)
    expect(polylineCount(container)).toBe(50)
  })

  it.each([3, Number.NaN])(
    'keeps the cluster with spiderfyMaxLeaves=%p',
    async (spiderfyMaxLeaves) => {
      const { container } = render(
        <Map
          points={SAME_SPOT}
          spiderfyMaxLeaves={spiderfyMaxLeaves}
          initialRegion={SPIDER_REGION}
        />
      )
      await flush()

      expect(clusterLabels(container)).toEqual(['5'])
      expect(polylineCount(container)).toBe(0)
    }
  )

  it('reports every marker of an over-cap cluster to onClusterPress', async () => {
    const onClusterPress = jest.fn()
    const { container } = render(
      <Map
        points={crowd(200)}
        onClusterPress={onClusterPress}
        initialRegion={SPIDER_REGION}
      />
    )
    await flush()

    press(theCluster(container))

    expect(onClusterPress).toHaveBeenCalledTimes(1)
    expect(onClusterPress.mock.calls[0]![1]).toHaveLength(200)
  })

  it('keeps spider markers a marker width apart on screen', async () => {
    const { container } = render(
      <Map points={crowd(50)} initialRegion={SPIDER_REGION} />
    )
    await flush()

    // Back to screen points, as the 390 pt wide harness map shows them.
    const longitudePerPoint = SPIDER_REGION.longitudeDelta / 390
    const latitudePerPoint =
      longitudePerPoint * Math.cos((CENTER.latitude * Math.PI) / 180)
    const points = renderedMarkers(container).map((marker) => ({
      x: (marker.longitude - CENTER.longitude) / longitudePerPoint,
      y: (marker.latitude - CENTER.latitude) / latitudePerPoint,
    }))
    let minDistance = Infinity
    for (let i = 0; i < points.length; i++) {
      const a = points[i]!
      expect(Math.hypot(a.x, a.y)).toBeGreaterThan(0.9 * SPIRAL_SPACING_PT)
      for (let j = i + 1; j < points.length; j++) {
        const b = points[j]!
        minDistance = Math.min(minDistance, Math.hypot(a.x - b.x, a.y - b.y))
      }
    }

    expect(points).toHaveLength(50)
    expect(minDistance).toBeGreaterThanOrEqual(0.9 * SPIRAL_SPACING_PT)
  })

  it('does not refetch leaves on re-renders and pans that keep the spider', async () => {
    const { container, rerender } = render(
      <Map points={SAME_SPOT} initialRegion={SPIDER_REGION} />
    )
    await flush()
    expect(polylineCount(container)).toBe(SAME_SPOT.length)
    const leafQueries = fakeClusterEngineStats.getLeaves
    const zoomQueries = fakeClusterEngineStats.getClusterExpansionZoom

    rerender(<Map points={[...SAME_SPOT]} initialRegion={SPIDER_REGION} />)
    await flush()
    await settleRegion(
      regionAt(
        { latitude: CENTER.latitude + 0.00001, longitude: CENTER.longitude },
        SPIDER_ZOOM
      )
    )

    expect(polylineCount(container)).toBe(SAME_SPOT.length)
    expect(fakeClusterEngineStats.getLeaves).toBe(leafQueries)
    expect(fakeClusterEngineStats.getClusterExpansionZoom).toBe(zoomQueries)
  })
})

describe('MapView reachable spiderfy (#22)', () => {
  function crowd(count: number): TestPoint[] {
    return Array.from({ length: count }, (_, i) => ({
      id: `c${i}`,
      latitude: CENTER.latitude,
      longitude: CENTER.longitude,
    }))
  }

  it.each([17, 18, 18.99])(
    'keeps co-located markers as a cluster at camera zoom %p',
    async (zoom) => {
      const { container } = render(
        <Map points={SAME_SPOT} initialRegion={regionAt(CENTER, zoom)} />
      )
      await flush()

      expect(clusterLabels(container)).toEqual(['5'])
      expect(polylineCount(container)).toBe(0)
    }
  )

  it.each([19, 20, 21])(
    'spiderfies co-located markers at camera zoom %p',
    async (zoom) => {
      const { container } = render(
        <Map points={SAME_SPOT} initialRegion={regionAt(CENTER, zoom)} />
      )
      await flush()

      expect(clusterLabels(container)).toEqual([])
      expect(renderedMarkerIds(container)).toHaveLength(SAME_SPOT.length)
      expect(polylineCount(container)).toBe(SAME_SPOT.length)
    }
  )

  it('lets distinct nearby markers expand by zooming instead', async () => {
    // GROUP's ~13 m spacing still clusters at camera zoom 18 and splits at 19,
    // so lower the threshold to have the cluster sit past it.
    const at18 = render(
      <Map
        points={GROUP}
        spiderfyMinZoom={18}
        initialRegion={regionAt(GROUP[2]!, 18)}
      />
    )
    await flush()
    expect(clusterLabels(at18.container).length).toBeGreaterThan(0)
    expect(polylineCount(at18.container)).toBe(0)

    press(theCluster(at18.container))
    await flush()
    expect(mapState.fitToCoordinates).toHaveLength(1)
    expect(polylineCount(at18.container)).toBe(0)
    at18.unmount()

    const at19 = render(
      <Map
        points={GROUP}
        spiderfyMinZoom={18}
        initialRegion={regionAt(GROUP[2]!, 19)}
      />
    )
    await flush()
    expect(renderedMarkerIds(at19.container)).toHaveLength(GROUP.length)
    expect(polylineCount(at19.container)).toBe(0)
  })

  it('honours spiderfyMinZoom', async () => {
    const at = (zoom: number) =>
      render(
        <Map
          points={SAME_SPOT}
          spiderfyMinZoom={21}
          initialRegion={regionAt(CENTER, zoom)}
        />
      )

    const below = at(19)
    await flush()
    expect(clusterLabels(below.container)).toEqual(['5'])
    below.unmount()

    const from = at(21)
    await flush()
    expect(polylineCount(from.container)).toBe(SAME_SPOT.length)
  })

  describe('on press, below spiderfyMinZoom', () => {
    const PRESS_ZOOM = 14

    it('spreads co-located markers in place instead of fitting the map', async () => {
      const onClusterPress = jest.fn()
      const { container } = render(
        <Map
          points={SAME_SPOT}
          onClusterPress={onClusterPress}
          initialRegion={regionAt(CENTER, PRESS_ZOOM)}
        />
      )
      await flush()

      press(theCluster(container))
      await flush()

      expect(clusterLabels(container)).toEqual([])
      expect(renderedMarkerIds(container)).toHaveLength(SAME_SPOT.length)
      expect(polylineCount(container)).toBe(SAME_SPOT.length)
      expect(mapState.fitToCoordinates).toEqual([])
      expect(onClusterPress).toHaveBeenCalledTimes(1)
      expect(onClusterPress.mock.calls[0]![1]).toHaveLength(SAME_SPOT.length)
    })

    it('spreads them when pressed after a zoom change', async () => {
      const { container } = render(
        <Map points={SAME_SPOT} initialRegion={regionAt(CENTER, PRESS_ZOOM)} />
      )
      await flush()
      await settleRegion(regionAt(CENTER, PRESS_ZOOM + 1))

      press(theCluster(container))
      await flush()

      expect(polylineCount(container)).toBe(SAME_SPOT.length)
    })

    it('stays spread on a pan and collapses when the zoom changes', async () => {
      const { container } = render(
        <Map points={SAME_SPOT} initialRegion={regionAt(CENTER, PRESS_ZOOM)} />
      )
      await flush()
      press(theCluster(container))
      await flush()

      await settleRegion(
        regionAt(
          { latitude: CENTER.latitude + 0.001, longitude: CENTER.longitude },
          PRESS_ZOOM
        )
      )
      expect(polylineCount(container)).toBe(SAME_SPOT.length)

      await settleRegion(regionAt(CENTER, PRESS_ZOOM - 2))
      expect(clusterLabels(container)).toEqual(['5'])
      expect(polylineCount(container)).toBe(0)
    })

    it.each([
      ['preserveClusterPressBehavior', { preserveClusterPressBehavior: true }],
      ['spiralEnabled={false}', { spiralEnabled: false }],
    ] as const)('does not spread them with %s', async (_, props) => {
      const onClusterPress = jest.fn()
      const { container } = render(
        <Map
          points={SAME_SPOT}
          onClusterPress={onClusterPress}
          initialRegion={regionAt(CENTER, PRESS_ZOOM)}
          {...props}
        />
      )
      await flush()

      press(theCluster(container))
      await flush()

      expect(clusterLabels(container)).toEqual(['5'])
      expect(polylineCount(container)).toBe(0)
      expect(onClusterPress).toHaveBeenCalledTimes(1)
    })

    it('fits the map for a cluster above spiderfyMaxLeaves', async () => {
      const { container } = render(
        <Map points={crowd(200)} initialRegion={regionAt(CENTER, PRESS_ZOOM)} />
      )
      await flush()

      press(theCluster(container))
      await flush()

      expect(polylineCount(container)).toBe(0)
      expect(mapState.fitToCoordinates).toHaveLength(1)
    })
  })
})
