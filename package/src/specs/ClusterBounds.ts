/**
 * The box a cluster's leaves span, returned by
 * {@linkcode ClusterEngine.getClusterBounds}.
 *
 * In the coordinates the engine indexed: a latitude beyond ±85.05° or a
 * longitude beyond ±180° counts as that limit.
 */
export interface ClusterBounds {
  /** Northernmost leaf latitude in degrees. */
  north: number
  /** Southernmost leaf latitude in degrees. */
  south: number
  /** Easternmost leaf longitude in degrees. */
  east: number
  /** Westernmost leaf longitude in degrees. */
  west: number
}
