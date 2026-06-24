import type { PointWithDistance } from '../types/shared'

/** WGS-84 equatorial radius in meters (matches C++ GeoUtils). */
const EARTH_RADIUS_METERS = 6_378_137

/** WGS-84 coordinate in degrees. */
export interface GeoCoordinate {
  /** Latitude in degrees. */
  latitude: number
  /** Longitude in degrees. */
  longitude: number
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180
}

/**
 * Great-circle distance between two {@linkcode GeoCoordinate} points using the haversine formula.
 *
 * Returns distance in meters, or `NaN` when either coordinate is non-finite.
 */
export function haversineDistance(a: GeoCoordinate, b: GeoCoordinate): number {
  if (
    !Number.isFinite(a.latitude) ||
    !Number.isFinite(a.longitude) ||
    !Number.isFinite(b.latitude) ||
    !Number.isFinite(b.longitude)
  ) {
    return Number.NaN
  }

  const dLat = toRadians(b.latitude - a.latitude)
  const dLng = toRadians(b.longitude - a.longitude)
  const lat1 = toRadians(a.latitude)
  const lat2 = toRadians(b.latitude)

  const sinDLat = Math.sin(dLat / 2)
  const sinDLng = Math.sin(dLng / 2)
  const h =
    sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng

  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)))
}

function withDistance<T extends GeoCoordinate>(
  point: T,
  origin: GeoCoordinate
): PointWithDistance & T {
  return {
    ...point,
    distanceMeters: haversineDistance(origin, point),
  }
}

/**
 * Returns points sorted ascending by distance from `origin`, each annotated with
 * `distanceMeters`. Points with invalid coordinates are excluded.
 */
export function sortPointsByDistance<T extends GeoCoordinate>(
  points: T[],
  origin: GeoCoordinate
): Array<PointWithDistance & T> {
  return points
    .map((point) => withDistance(point, origin))
    .filter((point) => Number.isFinite(point.distanceMeters))
    .sort((left, right) => left.distanceMeters - right.distanceMeters)
}

/**
 * Returns up to `limit` nearest {@linkcode GeoCoordinate} points from `origin`.
 *
 * When `radiusKm` is set, only points within that radius (in km) are considered.
 */
export function getNearestPoints<T extends GeoCoordinate>(
  points: T[],
  origin: GeoCoordinate,
  limit: number,
  radiusKm?: number
): Array<PointWithDistance & T> {
  const maxCount = Math.max(0, Math.floor(limit))
  if (maxCount === 0) {
    return []
  }

  const radiusMeters =
    radiusKm != null && Number.isFinite(radiusKm) && radiusKm > 0
      ? radiusKm * 1000
      : undefined

  const sorted = sortPointsByDistance(points, origin)
  const withinRadius =
    radiusMeters == null
      ? sorted
      : sorted.filter((point) => point.distanceMeters <= radiusMeters)

  return withinRadius.slice(0, maxCount)
}

/**
 * Human-readable distance label, e.g. `"350 m"` or `"2.1 km"`.
 */
export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters < 0) {
    return '0 m'
  }

  if (meters < 1000) {
    return `${Math.round(meters)} m`
  }

  const kilometers = meters / 1000
  const roundedKm = Math.round(kilometers * 10) / 10
  const label = Number.isInteger(roundedKm)
    ? String(roundedKm)
    : roundedKm.toFixed(1)

  return `${label} km`
}
