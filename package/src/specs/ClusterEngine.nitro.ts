import type { HybridObject } from 'react-native-nitro-modules'
import type { ClusterEngineOptions } from './ClusterEngineOptions'
import type { EngineClusterNode } from './EngineClusterNode'
import type { Viewport } from './Viewport'

/**
 * Low-level C++ cluster engine (Nitro hybrid object).
 *
 * **Lifecycle** — call in this order:
 * 1. {@linkcode ClusterEngine.setOptions setOptions} — configure radius, zoom range, reducers, etc.
 * 2. {@linkcode ClusterEngine.setPoints setPoints} — load a binary buffer from `packPoints()`.
 * 3. {@linkcode ClusterEngine.build build} or {@linkcode ClusterEngine.buildAsync buildAsync} — build the index.
 * 4. Query — {@linkcode ClusterEngine.getClusters getClusters},
 *    {@linkcode ClusterEngine.getChildren getChildren},
 *    {@linkcode ClusterEngine.getLeaves getLeaves},
 *    {@linkcode ClusterEngine.getClusterExpansionZoom getClusterExpansionZoom}.
 *
 * Calling {@linkcode ClusterEngine.setOptions setOptions} or
 * {@linkcode ClusterEngine.setPoints setPoints} after a successful build clears
 * {@linkcode ClusterEngine.isBuilt isBuilt} until you call `build()` again.
 *
 * Prefer `createClusterEngine` or the `Supercluster` wrapper unless you need direct buffer access.
 */
export interface ClusterEngine extends HybridObject<{
  ios: 'c++'
  android: 'c++'
}> {
  /**
   * Load points from a `packPoints()` buffer (v1 or v2 layout).
   *
   * Call {@linkcode ClusterEngine.setOptions setOptions} first so `extent` and reducers apply
   * to projection/aggregation.
   *
   * @throws When `buffer` is null/undefined or the byte layout does not match `packPoints()` output.
   */
  setPoints(buffer: ArrayBuffer): void

  /**
   * Configure clustering. Resets {@linkcode ClusterEngine.isBuilt isBuilt} until the next
   * {@linkcode ClusterEngine.build build}.
   *
   * @throws When an option is outside the range documented on {@linkcode ClusterEngineOptions},
   * naming the option. The previous options and index stay.
   */
  setOptions(options: ClusterEngineOptions): void

  /** Build the cluster index synchronously on the calling thread. */
  build(): void

  /** Build the cluster index off the JS thread. Prefer for large datasets. */
  buildAsync(): Promise<void>

  /**
   * Return clusters visible in the viewport at the given zoom. See
   * {@linkcode Viewport} for how bounds across the antimeridian are read.
   *
   * @throws When {@linkcode ClusterEngine.isBuilt isBuilt} is `false` — call `build()` first.
   */
  getClusters(viewport: Viewport): EngineClusterNode[]

  /**
   * Return direct children of a cluster id, or `[]` for an id that is not a cluster.
   *
   * @throws When {@linkcode ClusterEngine.isBuilt isBuilt} is `false`.
   * @throws When `clusterId` is not a 32-bit integer.
   */
  getChildren(clusterId: number): EngineClusterNode[]

  /**
   * Return leaf points under a cluster (paginated). A `limit` of `0`, below `0`,
   * `Infinity` or `NaN` means unlimited; a negative `offset` skips none.
   *
   * @throws When {@linkcode ClusterEngine.isBuilt isBuilt} is `false`.
   * @throws When `clusterId` is not a 32-bit integer, `limit` or `offset` is
   * fractional, or `offset` is `NaN`.
   */
  getLeaves(
    clusterId: number,
    limit: number,
    offset: number
  ): EngineClusterNode[]

  /**
   * Zoom level at which a cluster expands into multiple children: the first
   * zoom where `getClusters` shows its children instead of the cluster, from
   * whichever zoom the cluster was seen at.
   *
   * Returns `maxZoom + 1` for a cluster that never splits within the zoom
   * range (points at the same coordinate, for example) and for a point id.
   *
   * @throws When {@linkcode ClusterEngine.isBuilt isBuilt} is `false`.
   * @throws When `clusterId` is not a 32-bit integer.
   */
  getClusterExpansionZoom(clusterId: number): number

  /** Number of valid points loaded by the last successful {@linkcode ClusterEngine.setPoints setPoints}. */
  readonly pointCount: number

  /** `true` after the most recent {@linkcode ClusterEngine.build build} completed; `false` after `setOptions`/`setPoints`. */
  readonly isBuilt: boolean
}
