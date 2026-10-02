import React, { type ReactNode } from 'react'
import type { ClusterFeature, PointFeature } from '../geojson/types'
import type { Supercluster } from '../engine/Supercluster'
import SpiderMarker from './SpiderMarker'
import { isMarker } from './helpers'
import { generateSpiral } from './spiral'

/**
 * @param markerFor - Resolves a leaf to the `Marker` child it renders as.
 */
export function renderSpiderClusterMarkers(
  cluster: ClusterFeature,
  markerFor: (leaf: PointFeature) => ReactNode,
  supercluster: Supercluster,
  spiderLineColor: string
): React.ReactElement[] {
  const clusterId = cluster.properties.cluster_id
  const leaves = supercluster.getAllLeaves(clusterId)
  const [longitude, latitude] = cluster.geometry.coordinates
  const positions = generateSpiral({ latitude, longitude }, leaves, 0)
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
