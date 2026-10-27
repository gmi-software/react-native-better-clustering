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
 * Unset fields fall back to `DEFAULT_SUPERCLUSTER_OPTIONS`. Loading points
 * throws a `RangeError` naming the first field outside its documented range.
 */
export interface SuperclusterOptions {
  /** Minimum zoom level at which clusters are generated: an integer from `0` to `maxZoom`. @default `1` */
  minZoom?: number
  /** Maximum zoom level at which clusters are generated: an integer up to `30`. @default `20` */
  maxZoom?: number
  /** Minimum number of points required to form a cluster: a 32-bit integer. @default `2` */
  minPoints?: number
  /** Cluster radius in pixels at max zoom: a finite number `>= 0`. @default `40` */
  radius?: number
  /** Tile extent used for projection math: an integer `>= 1`. @default `512` */
  extent?: number
  /** KD-tree node size: a 32-bit integer. @default `64` */
  nodeSize?: number
  /** Numeric properties to fold into clusters natively in C++. @default `[]` */
  clusterProperties?: ClusterPropertyConfig[]
  /**
   * Slippy-map tile size used to pick a zoom level from the map region.
   *
   * Independent of {@linkcode SuperclusterOptions.extent}, which only affects
   * clustering. Changing this shifts the queried zoom by a whole level:
   * `256` matches react-native-map-clustering (and is what the `MapView`
   * compat layer uses), `512` matches react-native-clusterer. A finite number `> 0`.
   *
   * @default `extent`
   */
  viewportTileSize?: number
}

export type { AnyProps }
