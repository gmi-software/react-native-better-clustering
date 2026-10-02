import type { AnyProps, ClusterFeature, PointFeature } from '../geojson/types'
import type { MapRegion } from '../types'
import type { Supercluster } from '../engine/Supercluster'
import type { MapDimensions } from '../engine/geometry'
import type { SuperclusterOptions } from '../engine/types'
import { useClusterIndex } from './useClusterIndex'

export type { MapDimensions }

/**
 * React hook that clusters GeoJSON points for the current map region.
 *
 * Returns the visible points and clusters and the underlying
 * {@linkcode Supercluster} instance (useful for expansion queries).
 *
 * The hook builds the native index asynchronously and returns `[]` until the
 * first build has loaded. It rebuilds only when the coordinates (or the
 * `clusterProperties` inputs) of `data` change; a new array with the same
 * content keeps the index, and leaf queries return the newest feature
 * objects. During a rebuild it keeps returning the previous clusters, then
 * swaps and destroys the previous engine. The engine is destroyed on unmount.
 *
 * @param data - Point features to cluster.
 * @param mapDimensions - Map size in pixels ({@linkcode MapDimensions}).
 * @param region - Current map region ({@linkcode MapRegion}).
 * @param options - Optional {@linkcode SuperclusterOptions}; defaults match `DEFAULT_SUPERCLUSTER_OPTIONS`.
 *
 * @see `Clusterer`
 */
export function useClusterer<P extends AnyProps = AnyProps>(
  data: PointFeature<P>[],
  mapDimensions: MapDimensions,
  region: MapRegion,
  options?: SuperclusterOptions
): [Array<PointFeature<P> | ClusterFeature<P>>, Supercluster<P>] {
  const { clusters, supercluster } = useClusterIndex(
    data,
    mapDimensions,
    region,
    options
  )
  return [clusters, supercluster]
}
