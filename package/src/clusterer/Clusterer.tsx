import React, { useMemo, type ReactElement } from 'react'

import type { AnyProps, ClusterFeature, PointFeature } from '../geojson/types'
import { useClusterer } from '../hooks/useClusterer'
import type { MapRegion } from '../types'
import type { SuperclusterOptions } from '../engine/types'
import type { MapDimensions } from '../engine/geometry'

/**
 * Props for {@linkcode Clusterer}.
 *
 * @see {@linkcode useClusterer}
 */
export interface ClustererProps<P extends AnyProps = AnyProps> {
  /** Point features to cluster. */
  data: PointFeature<P>[]
  /** Current map region ({@linkcode MapRegion}). */
  region: MapRegion
  /** Map size in pixels ({@linkcode MapDimensions}). */
  mapDimensions: MapDimensions
  /** Optional {@linkcode SuperclusterOptions}. */
  options?: SuperclusterOptions
  /** Render function invoked for each visible point or cluster. */
  renderItem: (feature: PointFeature<P> | ClusterFeature<P>) => ReactElement
}

/**
 * Declarative renderer that maps clustered features to React elements.
 *
 * Thin adapter over {@linkcode useClusterer} for apps that prefer a component over a hook.
 */
export function Clusterer<P extends AnyProps = AnyProps>({
  data,
  region,
  mapDimensions,
  options,
  renderItem,
}: ClustererProps<P>): ReactElement {
  const [clusters] = useClusterer(data, mapDimensions, region, options)

  const rendered = useMemo(
    () => clusters.map(renderItem),
    [clusters, renderItem]
  )

  return <>{rendered}</>
}
