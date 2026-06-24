/**
 * Native aggregation reducer for cluster properties (supercluster map/reduce equivalent).
 *
 * Used in `ClusterPropertyConfig.reduce` and `ClusterEngineOptions.reducers`.
 */
export type ReducerKind = 'sum' | 'min' | 'max'
