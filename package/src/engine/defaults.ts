import type { SuperclusterOptions } from './types'

/** Minimum zoom used when {@linkcode SuperclusterOptions.minZoom} is omitted. */
export const DEFAULT_MIN_ZOOM = 1

/** Maximum zoom used when {@linkcode SuperclusterOptions.maxZoom} is omitted. */
export const DEFAULT_MAX_ZOOM = 20

/**
 * Slippy-map tile size the viewport zoom is measured against when
 * {@linkcode SuperclusterOptions.viewportTileSize} is omitted.
 *
 * Matches react-native-clusterer, which passes its `extent` to `geo-viewport`.
 * The `MapView` compat layer overrides this with
 * {@linkcode GEO_VIEWPORT_TILE_SIZE} for react-native-map-clustering parity.
 */
export const DEFAULT_VIEWPORT_TILE_SIZE = 512

/**
 * `geo-viewport`'s own default tile size, used by react-native-map-clustering.
 *
 * Correct for map dimensions measured in logical points.
 */
export const GEO_VIEWPORT_TILE_SIZE = 256

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
  viewportTileSize: DEFAULT_VIEWPORT_TILE_SIZE,
}
