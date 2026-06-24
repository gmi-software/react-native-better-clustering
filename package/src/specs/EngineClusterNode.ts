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
  /** Aggregated numeric values, one per configured {@linkcode ReducerKind}. */
  values: number[]
}
