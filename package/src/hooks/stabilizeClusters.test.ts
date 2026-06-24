import type { ClusterFeature } from '../geojson/types'
import { stabilizeClusterFeatures } from './stabilizeClusters'

function cluster(
  clusterId: number,
  longitude: number,
  latitude: number,
  pointCount: number
): ClusterFeature {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [longitude, latitude] },
    properties: {
      cluster: true,
      cluster_id: clusterId,
      point_count: pointCount,
      point_count_abbreviated: String(pointCount),
      getExpansionRegion: () => ({
        latitude,
        longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      }),
    },
  }
}

describe('stabilizeClusterFeatures', () => {
  it('reuses identities when order changes', () => {
    const aPrev = cluster(1, -122.4, 37.78, 5)
    const bPrev = cluster(2, -122.5, 37.79, 3)
    const previous = [aPrev, bPrev]

    const aNext = cluster(1, -122.4, 37.78, 5)
    const bNext = cluster(2, -122.5, 37.79, 3)
    const next = [bNext, aNext]

    const result = stabilizeClusterFeatures(previous, next)

    expect(result[0]).toBe(bPrev)
    expect(result[1]).toBe(aPrev)
    expect(result).not.toBe(previous)
  })

  it('reuses surviving clusters when the set grows', () => {
    const aPrev = cluster(1, -122.4, 37.78, 5)
    const previous = [aPrev]

    const aNext = cluster(1, -122.4, 37.78, 5)
    const bNext = cluster(2, -122.5, 37.79, 3)
    const next = [aNext, bNext]

    const result = stabilizeClusterFeatures(previous, next)

    expect(result[0]).toBe(aPrev)
    expect(result[1]).toBe(bNext)
    expect(result).not.toBe(previous)
  })

  it('reuses surviving clusters when the set shrinks', () => {
    const aPrev = cluster(1, -122.4, 37.78, 5)
    const bPrev = cluster(2, -122.5, 37.79, 3)
    const previous = [aPrev, bPrev]

    const aNext = cluster(1, -122.4, 37.78, 5)
    const next = [aNext]

    const result = stabilizeClusterFeatures(previous, next)

    expect(result[0]).toBe(aPrev)
    expect(result).not.toBe(previous)
  })

  it('returns a new object when cluster state changes', () => {
    const aPrev = cluster(1, -122.4, 37.78, 5)
    const previous = [aPrev]

    const aNext = cluster(1, -122.4, 37.78, 6)
    const next = [aNext]

    const result = stabilizeClusterFeatures(previous, next)

    expect(result[0]).toBe(aNext)
    expect(result[0]).not.toBe(aPrev)
  })

  it('returns the previous array reference when the set and order are identical', () => {
    const aPrev = cluster(1, -122.4, 37.78, 5)
    const bPrev = cluster(2, -122.5, 37.79, 3)
    const previous = [aPrev, bPrev]

    const aNext = cluster(1, -122.4, 37.78, 5)
    const bNext = cluster(2, -122.5, 37.79, 3)
    const next = [aNext, bNext]

    const result = stabilizeClusterFeatures(previous, next)

    expect(result).toBe(previous)
    expect(result[0]).toBe(aPrev)
    expect(result[1]).toBe(bPrev)
  })

  it('returns next when previous is empty', () => {
    const next = [cluster(1, -122.4, 37.78, 5)]

    expect(stabilizeClusterFeatures([], next)).toBe(next)
  })

  it('returns next when next is empty', () => {
    const previous = [cluster(1, -122.4, 37.78, 5)]

    expect(stabilizeClusterFeatures(previous, [])).toEqual([])
  })
})
