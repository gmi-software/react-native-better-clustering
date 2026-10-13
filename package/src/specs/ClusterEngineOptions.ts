import type { ReducerKind } from './ReducerKind'

/**
 * Configuration passed to {@linkcode ClusterEngine.setOptions}.
 *
 * Mirrors {@linkcode SuperclusterOptions} fields plus parallel {@linkcode reducers}.
 */
export interface ClusterEngineOptions {
  /** Cluster radius in pixels at max zoom: a finite number `>= 0`. */
  radius: number
  /** Minimum number of points required to form a cluster: a 32-bit integer. */
  minPoints: number
  /** Minimum zoom level at which clusters are generated: an integer from `0` to `maxZoom`. */
  minZoom: number
  /** Maximum zoom level at which clusters are generated: an integer up to `30`. */
  maxZoom: number
  /** Tile extent used for projection math: an integer `>= 1`. */
  extent: number
  /** KD-tree node size: a 32-bit integer. */
  nodeSize: number
  /** Declarative reducers aligned with packed per-point values from `packPoints`. */
  reducers: ReducerKind[]
}
