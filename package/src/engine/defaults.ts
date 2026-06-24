import type { SuperclusterOptions } from './types'

/** Minimum zoom used when {@linkcode SuperclusterOptions.minZoom} is omitted. */
export const DEFAULT_MIN_ZOOM = 1

/** Maximum zoom used when {@linkcode SuperclusterOptions.maxZoom} is omitted. */
export const DEFAULT_MAX_ZOOM = 20

/**
 * Default values applied by `Supercluster` and `useClusterer` when options are omitted.
 */
export const DEFAULT_SUPERCLUSTER_OPTIONS: Required<SuperclusterOptions> = {
  radius: 40,
  minZoom: DEFAULT_MIN_ZOOM,
  maxZoom: DEFAULT_MAX_ZOOM,
  minPoints: 2,
  extent: 512,
  nodeSize: 64,
  clusterProperties: [],
}
