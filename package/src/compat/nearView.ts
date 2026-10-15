import { isClusterFeature } from '../geojson'
import type { GeoJSONFeature } from '../geojson/types'
import type { MapRegion } from '../types'

/**
 * The features to render: every marker, and the clusters within `margin`
 * points of the map's edges.
 *
 * The index is queried for the region plus half its size on each side, as
 * react-native-map-clustering does, so a pan does not reveal empty edges
 * before the next recompute. Every cluster in it is a native annotation once
 * rendered, and a zoom step replaces most of them at once: mounting that many
 * holds the UI thread. Clusters past the margin are left out of rendering
 * only. Markers keep rendering as before, so the app's own markers mount and
 * unmount where they always did.
 *
 * Returns `features` itself when nothing is left out.
 */
export function featuresNearView<F extends GeoJSONFeature>(
  features: F[],
  region: MapRegion,
  size: { width: number; height: number },
  margin: number
): F[] {
  if (
    !(margin < Infinity) ||
    !(size.width > 0) ||
    !(size.height > 0) ||
    !(region.longitudeDelta > 0) ||
    !(region.latitudeDelta > 0)
  ) {
    return features
  }

  const halfWidth =
    region.longitudeDelta / 2 + (margin * region.longitudeDelta) / size.width
  const halfHeight =
    region.latitudeDelta / 2 + (margin * region.latitudeDelta) / size.height
  const isNear = (feature: F) => {
    if (!isClusterFeature(feature)) {
      return true
    }
    const [longitude, latitude] = feature.geometry.coordinates
    // Wrapped, so a region across the antimeridian keeps its clusters.
    const dx = ((((longitude - region.longitude) % 360) + 540) % 360) - 180
    return (
      Math.abs(dx) <= halfWidth &&
      Math.abs(latitude - region.latitude) <= halfHeight
    )
  }

  return features.every(isNear) ? features : features.filter(isNear)
}
