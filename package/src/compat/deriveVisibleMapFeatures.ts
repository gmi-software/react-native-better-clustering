import type {
  ClusterFeature,
  GeoJSONFeature,
  PointFeature,
} from '../geojson/types'
import type { Supercluster } from '../engine/Supercluster'
import type { MapDimensions } from '../engine/geometry'
import type { MapRegion } from '../types'

/**
 * Single source of truth for which GeoJSON features are visible for a map
 * region. Rendering, onMarkersChange, and onRegionChangeComplete should all
 * consume snapshots from this helper instead of closing over divergent state.
 */
export function deriveVisibleMapFeatures(
  region: MapRegion,
  mapDimensions: MapDimensions,
  markerFeatures: PointFeature[],
  clusteringEnabled: boolean,
  supercluster: Supercluster | null
): Array<PointFeature | ClusterFeature> {
  if (!clusteringEnabled) {
    return markerFeatures
  }

  if (supercluster == null) {
    return []
  }

  return supercluster.getClustersFromRegion(region, mapDimensions)
}

export function deriveVisibleMapFeaturesAsGeoJSON(
  region: MapRegion,
  mapDimensions: MapDimensions,
  markerFeatures: PointFeature[],
  clusteringEnabled: boolean,
  supercluster: Supercluster | null
): GeoJSONFeature[] {
  return deriveVisibleMapFeatures(
    region,
    mapDimensions,
    markerFeatures,
    clusteringEnabled,
    supercluster
  )
}
