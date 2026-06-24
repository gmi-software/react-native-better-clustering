import type { AnyProps, ClusterFeature, PointFeature } from './types'

type CoordInput =
  | [number, number]
  | { latitude: number; longitude: number }
  | { lat: number; lng: number }

/**
 * Build a {@linkcode PointFeature} from coordinates and optional properties.
 *
 * Accepts GeoJSON `[lng, lat]`, `{ latitude, longitude }`, or `{ lat, lng }`.
 *
 * @see {@linkcode Supercluster.load}
 * @see {@linkcode useClusterer}
 */
export function coordsToGeoJSONFeature<P extends AnyProps = AnyProps>(
  coords: CoordInput,
  properties?: P
): PointFeature<P> {
  let coordinates: [number, number]
  if (Array.isArray(coords)) {
    coordinates = coords
  } else if ('latitude' in coords) {
    coordinates = [coords.longitude, coords.latitude]
  } else {
    coordinates = [coords.lng, coords.lat]
  }

  return {
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates,
    },
    properties: (properties ?? {}) as P,
  }
}

/**
 * Type guard for {@linkcode ClusterFeature}.
 *
 * @see {@linkcode ClusterProperties.cluster}
 */
export function isClusterFeature<P = AnyProps>(
  point: PointFeature<P> | ClusterFeature<P>
): point is ClusterFeature<P> {
  const properties = point.properties
  return (
    typeof properties === 'object' &&
    properties !== null &&
    'cluster' in properties &&
    (properties as ClusterFeature<P>['properties']).cluster === true
  )
}
