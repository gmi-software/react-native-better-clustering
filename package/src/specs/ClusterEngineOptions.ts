import type { ReducerKind } from './ReducerKind'

/**
 * Configuration passed to {@linkcode ClusterEngine.setOptions}.
 *
 * Mirrors {@linkcode SuperclusterOptions} fields plus parallel {@linkcode reducers}.
 */
export interface ClusterEngineOptions {
  /** Cluster radius in pixels at max zoom. */
  radius: number
  /** Minimum number of points required to form a cluster. */
  minPoints: number
  /** Minimum zoom level at which clusters are generated. */
  minZoom: number
  /** Maximum zoom level at which clusters are generated. */
  maxZoom: number
  /** Tile extent used for projection math. */
  extent: number
  /** KD-tree node size. */
  nodeSize: number
  /** Declarative reducers aligned with packed per-point values from `packPoints`. */
  reducers: ReducerKind[]
}
