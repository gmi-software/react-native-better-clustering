import React from 'react'
import { isClusterFeature } from '../geojson'
import type { ClusterFeature, PointFeature } from '../geojson/types'

/**
 * Whether a React child is a clusterable `react-native-maps` `Marker`.
 *
 * Returns `false` for non-elements and markers with `cluster={false}`.
 *
 * @see {@linkcode markerToGeoJSONFeature}
 */
export function isMarker(
  child: React.ReactNode
): child is React.ReactElement<MarkerLikeProps> {
  if (!React.isValidElement(child)) {
    return false
  }

  const props = child.props as MarkerLikeProps
  return props.coordinate != null && props.cluster !== false
}

interface MarkerLikeProps {
  coordinate: { latitude: number; longitude: number }
  cluster?: boolean
  children?: React.ReactNode
  [key: string]: unknown
}

/** Properties attached to each marker-derived {@linkcode PointFeature}. */
export type MarkerFeatureProperties = Record<string, unknown> & {
  point_count: 0
  index: number
}

/** The `Marker` element each marker-derived feature was created from. */
const markerElements = new WeakMap<
  PointFeature,
  React.ReactElement<MarkerLikeProps>
>()

/**
 * Converts a `Marker` child into a GeoJSON point for the cluster engine.
 *
 * Preserves marker props on `properties` and stores the child index for later
 * React reconciliation. Leaves out `coordinate`, `children`, and the props that
 * name cluster properties (`cluster`, `cluster_id`, `point_count_abbreviated`,
 * `getExpansionRegion`), so a marker such as `<Marker cluster>` is never
 * mistaken for a cluster by {@linkcode isClusterFeature}.
 *
 * @see {@linkcode isMarker}
 */
export function markerToGeoJSONFeature(
  marker: React.ReactElement<MarkerLikeProps>,
  index: number
): PointFeature<MarkerFeatureProperties> {
  const {
    coordinate,
    children: _children,
    cluster: _cluster,
    cluster_id: _clusterId,
    point_count_abbreviated: _pointCountAbbreviated,
    getExpansionRegion: _getExpansionRegion,
    ...rest
  } = marker.props
  const properties: MarkerFeatureProperties = {
    ...rest,
    point_count: 0,
    index,
  }

  const feature: PointFeature<MarkerFeatureProperties> = {
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [coordinate.longitude, coordinate.latitude],
    },
    properties,
  }
  markerElements.set(feature, marker)
  return feature
}

/**
 * The `Marker` element a feature was created from by
 * {@linkcode markerToGeoJSONFeature}, or `undefined` for any other feature.
 *
 * Lets features from a previous children array render their own element
 * while the index for the current children is still building.
 */
export function markerElementOf(
  feature: PointFeature
): React.ReactElement<MarkerLikeProps> | undefined {
  return markerElements.get(feature)
}

/**
 * Stable fingerprint of visible clusters/markers for layout-animation gating.
 *
 * Includes cluster id, point count, and coordinates so implode/explode and
 * bubble resize transitions run only when the visible set actually changes.
 */
export function computeClusterLayoutSignature(
  features: Array<PointFeature | ClusterFeature>
): string {
  return features
    .map((feature) => {
      const [longitude, latitude] = feature.geometry.coordinates

      if (isClusterFeature(feature)) {
        return `c:${feature.properties.cluster_id}:${feature.properties.point_count}:${latitude}:${longitude}`
      }

      const index = feature.properties.index
      return `p:${index}:${latitude}:${longitude}`
    })
    .join('|')
}
