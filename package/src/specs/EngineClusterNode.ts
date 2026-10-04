/**
 * Cluster or point returned by native {@linkcode ClusterEngine} query methods.
 *
 * @see {@linkcode ClusterEngine.getClusters}
 */
export interface EngineClusterNode {
  /** Cluster or point id. */
  id: number
  /** Latitude in WGS-84 degrees. */
  latitude: number
  /** Longitude in WGS-84 degrees. */
  longitude: number
  /** Leaf count (`1` for non-cluster points). */
  count: number
  /** Whether this node represents a cluster. */
  isCluster: boolean
  /** Parent cluster id, or sentinel when none. */
  parentId: number
  /** Index into the loaded point array for leaf nodes. */
  pointIndex: number
  /**
   * Smallest point id among this node's leaves; its own {@linkcode id} for a
   * point. A cluster keeps it across zoom levels and rebuilds while it only
   * gains or loses other leaves, so it can key the cluster's marker.
   */
  minLeafId: number
  /** Aggregated numeric values, one per configured {@linkcode ReducerKind}. */
  values: number[]
}
