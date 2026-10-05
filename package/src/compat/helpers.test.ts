import { describe, expect, it } from 'bun:test'
import React from 'react'

import {
  computeClusterLayoutSignature,
  markerToGeoJSONFeature,
} from './helpers'
import { isClusterFeature } from '../geojson'
import type { ClusterFeature, PointFeature } from '../geojson/types'

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
