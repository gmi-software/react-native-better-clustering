import type { AnyProps, PointFeature } from '../geojson'

/** Result of {@linkcode partitionValidPoints}. */
export interface PartitionedPoints<P extends AnyProps> {
  /** Points the native engine can index, in their original relative order. */
  valid: PointFeature<P>[]
  /** Indices into the original array whose coordinates were non-finite. */
  invalidIndices: number[]
}

/**
 * Splits points the native engine will index from ones it would drop on ingest.
 *
 * Mirrors the native `isValidGeoCoordinate` check: a coordinate is usable when
 * both latitude and longitude are finite. Out-of-range values are deliberately
 * *not* rejected here — the native side clamps those to the Web Mercator limits
 * rather than dropping them, and rejecting them in JS would remove points that
 * currently render.
 *
 * @see {@linkcode warnSkippedPoints}
 */
export function partitionValidPoints<P extends AnyProps>(
  points: PointFeature<P>[]
): PartitionedPoints<P> {
  const valid: PointFeature<P>[] = []
  const invalidIndices: number[] = []

  for (let i = 0; i < points.length; i++) {
    const point = points[i]!
    const [longitude, latitude] = point.geometry.coordinates

    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
      valid.push(point)
    } else {
      invalidIndices.push(i)
    }
  }

  return { valid, invalidIndices }
}

const MAX_REPORTED_INDICES = 5

/**
 * Reports points dropped by {@linkcode partitionValidPoints} in development.
 *
 * Dropped points cannot cluster or render, and nothing else in the pipeline
 * surfaces their absence, so this is the only signal a caller gets.
 */
export function warnSkippedPoints(
  invalidIndices: number[],
  total: number
): void {
  if (invalidIndices.length === 0) {
    return
  }

  // `__DEV__` is a React Native global; absent outside RN, so default to warning.
  if (typeof __DEV__ !== 'undefined' && !__DEV__) {
    return
  }

  const listed = invalidIndices.slice(0, MAX_REPORTED_INDICES).join(', ')
  const more =
    invalidIndices.length > MAX_REPORTED_INDICES
      ? `, and ${invalidIndices.length - MAX_REPORTED_INDICES} more`
      : ''

  console.warn(
    `react-native-better-clustering: skipped ${invalidIndices.length} of ${total} points with non-finite coordinates (index ${listed}${more}). ` +
      'Check those points for undefined, null, or NaN latitude/longitude — they will not appear on the map.'
  )
}
