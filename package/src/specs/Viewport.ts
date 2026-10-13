/**
 * Map viewport bounds for native cluster queries via {@linkcode ClusterEngine.getClusters}.
 *
 * Built from a `BBox` and zoom by `bboxToViewport`. Longitudes are normalized
 * the way supercluster normalizes a bbox, so a viewport across the antimeridian
 * can be passed unwrapped (`west: 170, east: 190`) or wrapped
 * (`west: 170, east: -170`), and a span of 360° or more covers the whole world.
 * Latitudes are clamped to ±90°. A `NaN` or infinite bound returns no features.
 */
export interface Viewport {
  /** Northern latitude bound in degrees. */
  north: number
  /** Southern latitude bound in degrees. */
  south: number
  /** Eastern longitude bound in degrees. */
  east: number
  /** Western longitude bound in degrees. */
  west: number
  /**
   * Zoom level used for the query, floored and clamped to `minZoom` through
   * `maxZoom + 1` as supercluster does. At `maxZoom + 1` no point is clustered.
   */
  zoom: number
}
