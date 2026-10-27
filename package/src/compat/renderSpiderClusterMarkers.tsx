import React, { type ReactNode } from 'react'
import type { ClusterFeature, PointFeature } from '../geojson/types'
import SpiderMarker from './SpiderMarker'
import { isMarker } from './helpers'
import { generateSpiral } from './spiral'

/**
 * @param leaves - Every leaf of `cluster`.
 * @param markerFor - Resolves a leaf to the `Marker` child it renders as.
 * @param longitudePerPoint - Degrees of longitude per screen point at the current zoom.
 */
export function renderSpiderClusterMarkers(
  cluster: ClusterFeature,
  leaves: PointFeature[],
  markerFor: (leaf: PointFeature) => ReactNode,
  longitudePerPoint: number,
  spiderLineColor: string
): React.ReactElement[] {
  const clusterId = cluster.properties.cluster_id
  const [longitude, latitude] = cluster.geometry.coordinates
  const positions = generateSpiral(
    { latitude, longitude },
    leaves,
    longitudePerPoint
  )
  const leafByIndex = new Map(
    leaves.map((leaf) => [leaf.properties.index, leaf])
  )

  return positions.flatMap((position) => {
    const leaf = leafByIndex.get(position.index)
    const child = leaf == null ? null : markerFor(leaf)

    if (!isMarker(child)) {
      return []
    }

    return [
      <SpiderMarker
        key={`spider-${clusterId}-${position.index}`}
        marker={child}
        position={position}
        spiderLineColor={spiderLineColor}
      />,
    ]
  })
}
