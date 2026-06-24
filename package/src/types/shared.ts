import type { GeoCoordinate } from '../utils/distance'

/**
 * Coordinate annotated with great-circle distance from a query origin.
 *
 * Produced by {@linkcode sortPointsByDistance} and {@linkcode getNearestPoints}.
 *
 * @see {@linkcode GeoCoordinate}
 */
export interface PointWithDistance extends GeoCoordinate {
  /** Distance from the query origin in meters. */
  distanceMeters: number
}
