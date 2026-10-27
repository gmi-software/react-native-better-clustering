/** A map position, as `react-native-maps` takes it. */
export interface LatLng {
  latitude: number
  longitude: number
}

/**
 * Screen points per degree of longitude (`x`) and latitude (`y`) in the
 * region on screen. Enough to compare short distances between bubbles.
 */
export interface ScreenScale {
  x: number
  y: number
}

/** Screen points per degree in `region` for a map of the given size. */
export function screenScaleOf(
  region: { latitudeDelta: number; longitudeDelta: number },
  size: { width: number; height: number }
): ScreenScale | null {
  const x = size.width / region.longitudeDelta
  const y = size.height / region.latitudeDelta
  return Number.isFinite(x) && x > 0 && Number.isFinite(y) && y > 0
    ? { x, y }
    : null
}

/**
 * The candidate nearest to `point` on screen, if it is at most
 * `maxDistance` points away.
 *
 * A bubble that appears when the map zooms in glides out of the bubble it
 * split from, and one that goes when it zooms out glides into the bubble that
 * took it in. The index does not say which bubble that is, so this picks the
 * nearest, as Google's android-maps-utils does: at one zoom step a cluster's
 * parts lie within a few radii of it. The cap keeps a bubble from flying
 * across the screen when nothing related is near.
 */
export function nearestWithin(
  point: LatLng,
  candidates: Iterable<LatLng>,
  scale: ScreenScale,
  maxDistance: number
): LatLng | undefined {
  let nearest: LatLng | undefined
  let nearestSquared = maxDistance * maxDistance
  for (const candidate of candidates) {
    const dx = (candidate.longitude - point.longitude) * scale.x
    const dy = (candidate.latitude - point.latitude) * scale.y
    const squared = dx * dx + dy * dy
    if (squared <= nearestSquared) {
      nearest = candidate
      nearestSquared = squared
    }
  }
  return nearest
}
