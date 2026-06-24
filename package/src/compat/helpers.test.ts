import { computeClusterLayoutSignature } from './helpers'
import type { ClusterFeature, PointFeature } from '../geojson/types'

describe('computeClusterLayoutSignature', () => {
  const point: PointFeature = {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [19.94, 50.06] },
    properties: { point_count: 0, index: 3 },
  }

  const cluster: ClusterFeature = {
    type: 'Feature',
    id: 42,
    geometry: { type: 'Point', coordinates: [20.0, 51.0] },
    properties: {
      cluster: true,
      cluster_id: 42,
      point_count: 12,
      point_count_abbreviated: '12',
      getExpansionRegion: () => ({
        latitude: 51,
        longitude: 20,
        latitudeDelta: 0.1,
        longitudeDelta: 0.1,
      }),
    },
  }

  it('encodes points and clusters with coordinates and counts', () => {
    expect(computeClusterLayoutSignature([point, cluster])).toBe(
      'p:3:50.06:19.94|c:42:12:51:20'
    )
  })

  it('changes when cluster point_count changes', () => {
    const before = computeClusterLayoutSignature([cluster])
    const after = computeClusterLayoutSignature([
      {
        ...cluster,
        properties: { ...cluster.properties, point_count: 13 },
      },
    ])

    expect(before).not.toBe(after)
  })
})
