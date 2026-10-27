import { describe, expect, it } from 'bun:test'
import React from 'react'

import {
  bboxToFitCoordinates,
  elementKey,
  markerToGeoJSONFeature,
  sortByKey,
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
