import type { PointFeature } from '../geojson/types'
import type { Supercluster } from '../engine/Supercluster'
import { deriveVisibleMapFeatures } from './deriveVisibleMapFeatures'

describe('deriveVisibleMapFeatures', () => {
  const region = {
    latitude: 37.78,
    longitude: -122.42,
    latitudeDelta: 0.05,
    longitudeDelta: 0.05,
  }
  const mapDimensions = { width: 400, height: 800 }
  const markerFeatures: PointFeature[] = [
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-122.42, 37.78] },
      properties: { index: 0, point_count: 0 },
    },
  ]

  it('returns marker features when clustering is disabled', () => {
    expect(
      deriveVisibleMapFeatures(
        region,
        mapDimensions,
        markerFeatures,
        false,
        null
      )
    ).toBe(markerFeatures)
  })

  it('queries the supercluster for the given region when clustering is enabled', () => {
    const clusters = [
      {
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [-122.42, 37.78] },
        properties: { cluster: true as const, cluster_id: 1, point_count: 1 },
      },
    ]
    const supercluster = {
      getClustersFromRegion: jest.fn(() => clusters),
    } as unknown as Supercluster

    expect(
      deriveVisibleMapFeatures(
        region,
        mapDimensions,
        markerFeatures,
        true,
        supercluster
      )
    ).toBe(clusters)
    expect(supercluster.getClustersFromRegion).toHaveBeenCalledWith(
      region,
      mapDimensions
    )
  })
})
