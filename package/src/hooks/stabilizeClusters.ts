import { isClusterFeature } from '../geojson'
import type {
  AnyProps,
  ClusterFeature,
  PointFeature,
  PointOrClusterFeature,
} from '../geojson/types'

function featureKey<P extends AnyProps>(
  feature: PointOrClusterFeature<P>
): string {
  const [longitude, latitude] = feature.geometry.coordinates

  if (isClusterFeature(feature)) {
    return `c:${feature.properties.cluster_id}:${latitude}:${longitude}:${feature.properties.point_count}`
  }

  const id =
    (feature.properties as { id?: string | number }).id ?? feature.id ?? ''
  return `p:${id}:${latitude}:${longitude}`
}

/**
 * Reuses prior {@linkcode PointOrClusterFeature} object identities when consecutive
 * cluster snapshots are equivalent.
 *
 * Reduces React re-renders when panning/zooming produces the same visible clusters.
 * Used internally by `useClusterer`.
 */
export function stabilizeClusterFeatures<P extends AnyProps>(
  previous: Array<PointOrClusterFeature<P>>,
  next: Array<PointOrClusterFeature<P>>
): Array<PointOrClusterFeature<P>> {
  if (next.length === 0 || previous.length === 0) {
    return next
  }

  const prevByKey = new Map<string, PointOrClusterFeature<P>>()
  for (const feature of previous) {
    prevByKey.set(featureKey(feature), feature)
  }

  let reusedAll = true
  const result = next.map((feature) => {
    const prior = prevByKey.get(featureKey(feature))
    if (prior != null) {
      return prior
    }
    reusedAll = false
    return feature
  })

  if (
    reusedAll &&
    next.length === previous.length &&
    next.every(
      (feature, index) => featureKey(feature) === featureKey(previous[index]!)
    )
  ) {
    return previous
  }

  return result
}

export type { PointFeature, ClusterFeature, PointOrClusterFeature }
