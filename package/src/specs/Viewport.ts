/**
 * Map viewport bounds for native cluster queries via {@linkcode ClusterEngine.getClusters}.
 *
 * Built from a `BBox` and zoom by `bboxToViewport`.
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
  /** Integer zoom level used for the query. */
  zoom: number
}
