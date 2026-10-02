import { beforeEach, describe, expect, it } from 'bun:test'
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
  Polyline,
  clusterLabels,
  fakeClusterEngineStats,
  flush,
  polylineCount,
  regionAt,
  renderedMarkerIds,
  renderedMarkers,
  resetHarness,
} from './harness'

const { default: MapView } = await import('../../compat/MapView')

type MapViewProps = React.ComponentProps<typeof MapView>

function markers(points: TestPoint[]) {
  return points.map((point) => (
    <Marker
      key={point.id}
      testID={point.id}
      coordinate={{ latitude: point.latitude, longitude: point.longitude }}
    />
  ))
}

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
      {markers(points)}
    </MapView>
  )
}

beforeEach(() => {
  resetHarness()
})

describe('MapView rendering', () => {
  it('builds one native engine and renders clusters once it has loaded', async () => {
    const { container } = render(<Map />)

    // The index builds asynchronously; nothing is on the map before that.
    expect(renderedMarkers(container)).toHaveLength(0)

    await flush()

    expect(fakeClusterEngineStats.created).toBe(1)
    expect(renderedMarkerIds(container)).toEqual(['s0', 's1', 's2'])
    expect(clusterLabels(container)).toEqual(['5'])
  })

  it('renders the default bubble label with an abbreviated count', async () => {
    const many: TestPoint[] = Array.from({ length: 1200 }, (_, i) => ({
      id: `m${i}`,
      latitude: CENTER.latitude + (i % 40) * 0.00001,
      longitude: CENTER.longitude + Math.floor(i / 40) * 0.00001,
    }))
    const { container } = render(<Map points={many} />)
    await flush()

    expect(clusterLabels(container)).toEqual(['1.2k'])
  })

  it('renders children that are not markers as-is', async () => {
    const { container } = render(
      <MapView
        initialRegion={regionAt(CENTER, CITY_ZOOM)}
        clusterFadeInDuration={0}
      >
        {markers(SINGLES)}
        <Polyline coordinates={[CENTER, SINGLES[0]!]} />
      </MapView>
    )
    await flush()

    expect(polylineCount(container)).toBe(1)
    expect(renderedMarkerIds(container)).toEqual(['s0', 's1', 's2'])
  })

  it('keeps a `cluster={false}` marker out of clustering', async () => {
    const { container } = render(
      <MapView
        initialRegion={regionAt(CENTER, CITY_ZOOM)}
        clusterFadeInDuration={0}
      >
        {markers(GROUP.slice(1))}
        <Marker key="own" testID="own" cluster={false} coordinate={GROUP[0]!} />
      </MapView>
    )
    await flush()

    expect(renderedMarkerIds(container)).toEqual(['own'])
    expect(clusterLabels(container)).toEqual(['4'])
  })

  it('renders every marker unclustered when clusteringEnabled is false, and clusters again when re-enabled', async () => {
    const { container, rerender } = render(<Map clusteringEnabled={false} />)
    await flush()

    expect(renderedMarkerIds(container)).toEqual(
      [...GROUP, ...SINGLES].map((point) => point.id).sort()
    )
    expect(clusterLabels(container)).toEqual([])

    rerender(<Map clusteringEnabled />)
    await flush()

    expect(renderedMarkerIds(container)).toEqual(['s0', 's1', 's2'])
    expect(clusterLabels(container)).toEqual(['5'])
  })

  it('renders a custom renderCluster element with the cluster data', async () => {
    const seen: Array<{ count: number; color: string }> = []
    const { container } = render(
      <Map
        clusterColor="#123456"
        renderCluster={(cluster) => {
          seen.push({
            count: cluster.properties.point_count,
            color: cluster.clusterColor,
          })
          const [longitude, latitude] = cluster.geometry.coordinates
          return (
            <Marker
              testID="custom-cluster"
              coordinate={{ latitude, longitude }}
              onPress={cluster.onPress}
            />
          )
        }}
      />
    )
    await flush()

    expect(renderedMarkerIds(container)).toEqual([
      'custom-cluster',
      's0',
      's1',
      's2',
    ])
    expect(seen.at(-1)).toEqual({ count: 5, color: '#123456' })
  })

  it('highlights the selected cluster with selectedClusterColor', async () => {
    const colors: string[] = []
    function Probe({ selected }: { selected?: number }) {
      return (
        <Map
          selectedClusterId={selected}
          selectedClusterColor="#FF0000"
          renderCluster={(cluster) => {
            colors.push(cluster.clusterColor)
            const [longitude, latitude] = cluster.geometry.coordinates
            return (
              <Marker
                testID={`cluster-${cluster.properties.cluster_id}`}
                coordinate={{ latitude, longitude }}
              />
            )
          }}
        />
      )
    }
    const { container, rerender } = render(<Probe />)
    await flush()
    const clusterId = Number(
      renderedMarkers(container)
        .find((marker) => marker.id.startsWith('cluster-'))!
        .id.slice('cluster-'.length)
    )

    rerender(<Probe selected={clusterId} />)
    await flush()

    expect(colors.at(-1)).toBe('#FF0000')
  })

  it('shows co-located markers as one cluster below the spiderfy zoom', async () => {
    const { container } = render(<Map points={SAME_SPOT} />)
    await flush()

    expect(clusterLabels(container)).toEqual(['5'])
    expect(renderedMarkerIds(container)).toEqual([])
  })
})
