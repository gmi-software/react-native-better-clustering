import type { MapRegion } from '../types'

/**
 * Geographic bounding box as `[westLng, southLat, eastLng, northLat]`.
 *
 * Used by `Supercluster.getClusters` and `regionToBBox`.
 */
export type BBox = [number, number, number, number]

/**
 * Open-ended GeoJSON feature properties bag.
 *
 * Generic parameter on {@linkcode PointFeature} and {@linkcode ClusterFeature}.
 */
export type AnyProps = Record<string, unknown>

/** GeoJSON Point geometry for map features in this library. */
export interface PointGeometry {
  type: 'Point'
  /** `[longitude, latitude]` in WGS-84 degrees. */
  coordinates: [number, number]
}

/**
 * GeoJSON Point feature consumed by `Supercluster.load` and `useClusterer`.
 *
 * @see `coordsToGeoJSONFeature`
 * @see {@linkcode ClusterFeature}
 */
export interface PointFeature<P = AnyProps> {
  type: 'Feature'
  geometry: PointGeometry
  properties: P
  /** Optional stable feature id used for cluster stabilization. */
  id?: string | number
}

/**
 * Properties present on cluster features returned from clustering queries.
 */
export interface ClusterProperties {
  /** Discriminator — always `true` on cluster features. */
  cluster: true
  /** Native cluster id for `Supercluster.getChildren` and related queries. */
  cluster_id: number
  /** Number of leaf points represented by this cluster. */
  point_count: number
  /** Human-readable count label (e.g. `"1.2k"`). */
  point_count_abbreviated: string
  /**
   * Returns a {@linkcode MapRegion} that fits all leaves in this cluster.
   *
   * @see `Supercluster.getClusterExpansionRegion`
   */
  getExpansionRegion: () => MapRegion
}

/**
 * GeoJSON Point feature representing a native cluster.
 *
 * Narrow with `isClusterFeature`.
 *
 * @see {@linkcode PointFeature}
 * @see {@linkcode PointOrClusterFeature}
 */
export type ClusterFeature<P = AnyProps> = PointFeature<ClusterProperties & P>

/**
 * Either a single point or a cluster returned from clustering queries.
 *
 * @see `useClusterer`
 * @see `Supercluster.getClusters`
 */
export type PointOrClusterFeature<P = AnyProps> =
  | PointFeature<P>
  | ClusterFeature<P>

/**
 * Alias for {@linkcode PointOrClusterFeature} used in compat callbacks.
 *
 * @see `ClusteredMapViewProps.onRegionChangeComplete`
 */
export type GeoJSONFeature<P = AnyProps> = PointOrClusterFeature<P>
