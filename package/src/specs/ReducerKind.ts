/**
 * Native aggregation reducer for cluster properties, in place of supercluster's
 * `map` and `reduce` functions.
 *
 * Used in `ClusterPropertyConfig.reduce` and `ClusterEngineOptions.reducers`.
 */
export type ReducerKind = 'sum' | 'min' | 'max'
