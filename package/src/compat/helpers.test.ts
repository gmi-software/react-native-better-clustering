import { describe, expect, it } from 'bun:test'
import React from 'react'

import {
  bboxToFitCoordinates,
  createMarkerFeatureCache,
  elementKey,
  markerToGeoJSONFeature,
  sortByKey,
  splitMarkerChildren,
} from './helpers'
import { isClusterFeature } from '../geojson'

describe('markerToGeoJSONFeature', () => {
  function Marker(_props: Record<string, unknown>) {
    return null
  }

  it('keeps marker props but never the ones that mark a cluster (#14)', () => {
    const marker = React.createElement(
      Marker,
      {
        coordinate: { latitude: 52.2, longitude: 21.0 },
        title: 'Office',
        cluster: true,
        cluster_id: 7,
        point_count: 5,
        point_count_abbreviated: '5',
        getExpansionRegion: () => null,
        index: 99,
      },
      'child'
    ) as React.ReactElement<never>

    const feature = markerToGeoJSONFeature(marker, 2)

    expect(feature.geometry.coordinates).toEqual([21.0, 52.2])
    expect(feature.properties).toEqual({
      title: 'Office',
      point_count: 0,
      index: 2,
    })
    expect(isClusterFeature(feature)).toBe(false)
  })
})

describe('splitMarkerChildren', () => {
  function Marker(_props: Record<string, unknown>) {
    return null
  }

  function marker(key: string, latitude: number, cluster?: boolean) {
    return React.createElement(Marker, {
      key,
      cluster,
      coordinate: { latitude, longitude: 21.0 },
    })
  }

  function split(
    children: React.ReactNode[],
    cache: ReturnType<typeof createMarkerFeatureCache>
  ) {
    return splitMarkerChildren(React.Children.toArray(children), cache)
  }

  it('keeps the point of a marker whose props and child index stay the same', () => {
    const cache = createMarkerFeatureCache()
    const a = marker('a', 52.0)
    const first = split([a, marker('b', 52.1)], cache)
    const second = split([a, marker('b', 52.2)], cache)

    expect(second.markerFeatures[0]).toBe(first.markerFeatures[0]!)
    expect(second.markerFeatures[1]).not.toBe(first.markerFeatures[1]!)
    expect(second.markerFeatures[1]!.geometry.coordinates).toEqual([21.0, 52.2])
  })

  it('makes a new point for a marker at another child index', () => {
    const cache = createMarkerFeatureCache()
    const a = marker('a', 52.0)
    const first = split([a], cache)
    const second = split([marker('x', 52.3), a], cache)

    expect(second.markerFeatures[1]).not.toBe(first.markerFeatures[0]!)
    expect(second.markerFeatures[1]!.properties.index).toBe(1)
  })

  it('makes a new point for a marker whose key changed at the same index', () => {
    const cache = createMarkerFeatureCache()
    const a = marker('a', 52.0)
    const first = split([a], cache)
    // Nested one slot later, `Children.toArray` keys it `.1:$a` instead of `.$a`.
    const second = split([null, [a]], cache)

    expect(second.markerFeatures[0]!.properties.index).toBe(0)
    expect(second.markerFeatures[0]).not.toBe(first.markerFeatures[0]!)
  })

  it('returns the previous list while every point stays the same', () => {
    const cache = createMarkerFeatureCache()
    const a = marker('a', 52.0)
    const b = marker('b', 52.1)
    const first = split([a, b, marker('v', 52.5, false)], cache)
    const second = split([a, b, marker('v', 52.6, false)], cache)

    expect(second.markerFeatures).toBe(first.markerFeatures)
    expect(second.otherChildren).toHaveLength(1)
  })

  it('leaves unclustered markers and other children out of the points', () => {
    const cache = createMarkerFeatureCache()
    const { markerFeatures, otherChildren } = split(
      [marker('a', 52.0), marker('v', 52.5, false), 'label'],
      cache
    )

    expect(markerFeatures).toHaveLength(1)
    expect(otherChildren).toHaveLength(2)
  })
})

describe('bboxToFitCoordinates', () => {
  it('returns the south-west corner, the centre and the north-east corner', () => {
    expect(bboxToFitCoordinates([16.9, 50.0, 21.1, 52.4])).toEqual([
      { latitude: 50.0, longitude: 16.9 },
      { latitude: 51.2, longitude: 19 },
      { latitude: 52.4, longitude: 21.1 },
    ])
  })

  it('keeps every step under 180° of longitude for a box wider than that', () => {
    const [southWest, centre, northEast] = bboxToFitCoordinates([
      -100, -10, 100, 10,
    ])

    expect(centre!.longitude - southWest!.longitude).toBe(100)
    expect(northEast!.longitude - centre!.longitude).toBe(100)
  })
})

describe('sortByKey', () => {
  it('orders items by key without changing the input', () => {
    const items = [{ key: 'b' }, { key: 'c' }, { key: 'a' }]

    expect(sortByKey(items, (item) => item.key)).toEqual([
      { key: 'a' },
      { key: 'b' },
      { key: 'c' },
    ])
    expect(items.map((item) => item.key)).toEqual(['b', 'c', 'a'])
  })

  it('orders rendered children by their React key', () => {
    const children = ['s2', 's0', 's1'].map((key) =>
      React.createElement('marker', { key })
    )

    expect(sortByKey(children, elementKey).map(elementKey)).toEqual([
      's0',
      's1',
      's2',
    ])
  })
})
