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
   */
  setOptions(options: ClusterEngineOptions): void

  /** Build the cluster index synchronously on the calling thread. */
  build(): void

  /** Build the cluster index off the JS thread. Prefer for large datasets. */
  buildAsync(): Promise<void>

  /**
   * Return clusters visible in the viewport at the given zoom.
   *
   * @throws When {@linkcode ClusterEngine.isBuilt isBuilt} is `false` — call `build()` first.
   */
  getClusters(viewport: Viewport): EngineClusterNode[]

  /**
   * Return direct children of a cluster id.
   *
   * @throws When {@linkcode ClusterEngine.isBuilt isBuilt} is `false`.
   */
  getChildren(clusterId: number): EngineClusterNode[]

  /**
   * Return leaf points under a cluster (paginated). Pass `limit <= 0` for unlimited.
   *
   * @throws When {@linkcode ClusterEngine.isBuilt isBuilt} is `false`.
   */
  getLeaves(
    clusterId: number,
    limit: number,
    offset: number
  ): EngineClusterNode[]

  /**
   * Zoom level at which a cluster expands into multiple children.
   *
   * @throws When {@linkcode ClusterEngine.isBuilt isBuilt} is `false`.
   */
  getClusterExpansionZoom(clusterId: number): number

  /** Number of valid points loaded by the last successful {@linkcode ClusterEngine.setPoints setPoints}. */
  readonly pointCount: number

  /** `true` after the most recent {@linkcode ClusterEngine.build build} completed; `false` after `setOptions`/`setPoints`. */
  readonly isBuilt: boolean
}
