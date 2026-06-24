import type { AnyProps } from '../geojson/types'
import type { ReducerKind } from '../specs/ReducerKind'

export type { ReducerKind }

/**
 * Declarative cluster property aggregation (supercluster map/reduce equivalent).
 *
 * Configured through {@linkcode SuperclusterOptions.clusterProperties}.
 *
 * @see {@linkcode ReducerKind}
 */
export interface ClusterPropertyConfig {
  /** Dot-path into point `properties` (e.g. `myValue` or `data.price`). */
  source: string
  /** Output key on cluster properties. Defaults to the last segment of `source`. */
  key?: string
  /** Aggregation reducer applied across cluster leaves. */
  reduce: ReducerKind
}

/**
 * Options for `Supercluster` and the `useClusterer` hook.
 *
 * Unset fields fall back to `DEFAULT_SUPERCLUSTER_OPTIONS`.
 */
export interface SuperclusterOptions {
  /** Minimum zoom level at which clusters are generated. @default `1` */
  minZoom?: number
  /** Maximum zoom level at which clusters are generated. @default `20` */
  maxZoom?: number
  /** Minimum number of points required to form a cluster. @default `2` */
  minPoints?: number
  /** Cluster radius in pixels at max zoom. @default `40` */
  radius?: number
  /** Tile extent used for projection math. @default `512` */
  extent?: number
  /** KD-tree node size. @default `64` */
  nodeSize?: number
  /** Numeric properties to fold into clusters natively in C++. @default `[]` */
  clusterProperties?: ClusterPropertyConfig[]
}

export type { AnyProps }
