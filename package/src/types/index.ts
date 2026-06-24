/**
 * Map viewport region in the same shape as the `react-native-maps` `Region` type.
 *
 * Passed to `useClusterer`, `Supercluster.getClustersFromRegion`, and `MapView`.
 */
export interface MapRegion {
  /** Center latitude in degrees (WGS-84). */
  latitude: number
  /** Center longitude in degrees (WGS-84). */
  longitude: number
  /** Visible latitude span in degrees. Must be positive and finite. */
  latitudeDelta: number
  /** Visible longitude span in degrees. Must be positive and finite. */
  longitudeDelta: number
}
