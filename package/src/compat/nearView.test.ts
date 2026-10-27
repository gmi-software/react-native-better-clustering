import { describe, expect, it } from 'bun:test'

import type { ClusterFeature, PointFeature } from '../geojson/types'
import { featuresNearView } from './nearView'

// 1° each way on a 100 × 100 pt map: 100 pt per degree.
const REGION = {
  latitude: 0,
  longitude: 0,
  latitudeDelta: 1,
  longitudeDelta: 1,
}
const SIZE = { width: 100, height: 100 }

function cluster(longitude: number, latitude = 0): ClusterFeature {
  return {
    type: 'Feature',
    id: `c${longitude},${latitude}`,
    geometry: { type: 'Point', coordinates: [longitude, latitude] },
    properties: {
      cluster: true,
      cluster_id: 1,
      point_count: 2,
      point_count_abbreviated: '2',
      getExpansionRegion: () => REGION,
    },
  }
}

function point(longitude: number): PointFeature {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [longitude, 0] },
    properties: { index: 0 },
  } as PointFeature
}

describe('featuresNearView', () => {
  it('keeps clusters on the map and within the margin', () => {
    const onMap = cluster(0.4)
    const inMargin = cluster(0.6) // 10 pt past the edge
    const features = [onMap, inMargin]

    expect(featuresNearView(features, REGION, SIZE, 20)).toBe(features)
  })

  it('leaves out clusters past the margin, on either axis', () => {
    const onMap = cluster(0)
    const east = cluster(0.8) // 30 pt past the edge
    const north = cluster(0, -0.8)

    expect(featuresNearView([onMap, east, north], REGION, SIZE, 20)).toEqual([
      onMap,
    ])
  })

  it('keeps markers wherever they are', () => {
    const far = point(0.9)

    expect(featuresNearView([far], REGION, SIZE, 0)).toEqual([far])
  })

  it('measures longitude across the antimeridian', () => {
    const region = { ...REGION, longitude: 179.8 }
    const acrossTheLine = cluster(-179.9) // 0.3° east of the centre

    expect(featuresNearView([acrossTheLine], region, SIZE, 0)).toEqual([
      acrossTheLine,
    ])
  })

  it('keeps every cluster for an infinite margin or an empty map', () => {
    const far = [cluster(5)]

    expect(featuresNearView(far, REGION, SIZE, Infinity)).toBe(far)
    expect(featuresNearView(far, REGION, { width: 0, height: 0 }, 0)).toBe(far)
  })
})
