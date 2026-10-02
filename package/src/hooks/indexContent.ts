import type { AnyProps, PointFeature } from '../geojson/types'
import type { ClusterPropertyConfig } from '../engine/types'
import { getNumericProperty } from '../utils/clusterProperties'

/** Extra per-feature equality a caller can require on top of the index content. */
export type SameFeature<P extends AnyProps> = (
  previous: PointFeature<P>,
  next: PointFeature<P>
) => boolean

/**
 * Whether two point arrays would build the same native cluster index: the same
 * coordinates in the same order and, for each `clusterProperties` source, the
 * same aggregated input. Other properties do not reach the engine, so arrays
 * that differ only there can share one index.
 *
 * Compares with `Object.is`, so a `NaN` coordinate equals itself.
 */
export function hasSameIndexContent<P extends AnyProps>(
  previous: PointFeature<P>[],
  next: PointFeature<P>[],
  clusterProperties: ClusterPropertyConfig[],
  isSameFeature?: SameFeature<P>
): boolean {
  if (previous === next) {
    return true
  }
  if (previous.length !== next.length) {
    return false
  }

  for (let i = 0; i < next.length; i++) {
    const a = previous[i]!
    const b = next[i]!
    if (a === b) {
      continue
    }

    const [aLongitude, aLatitude] = a.geometry.coordinates
    const [bLongitude, bLatitude] = b.geometry.coordinates
    if (
      !Object.is(aLongitude, bLongitude) ||
      !Object.is(aLatitude, bLatitude)
    ) {
      return false
    }

    for (const config of clusterProperties) {
      const aValue = getNumericProperty(
        (a.properties ?? {}) as Record<string, unknown>,
        config.source
      )
      const bValue = getNumericProperty(
        (b.properties ?? {}) as Record<string, unknown>,
        config.source
      )
      if (!Object.is(aValue, bValue)) {
        return false
      }
    }

    if (isSameFeature != null && !isSameFeature(a, b)) {
      return false
    }
  }

  return true
}
