import React, { type ReactNode } from 'react'
import type { ClusterFeature } from '../geojson/types'
import type { Supercluster } from '../engine/Supercluster'
import SpiderMarker from './SpiderMarker'
import { isMarker } from './helpers'
import { generateSpiral } from './spiral'

export function renderSpiderClusterMarkers(
  cluster: ClusterFeature,
  propsChildren: ReactNode[],
  supercluster: Supercluster,
  spiderLineColor: string
): React.ReactElement[] {
  const clusterId = cluster.properties.cluster_id
  const leaves = supercluster.getAllLeaves(clusterId)
  const [longitude, latitude] = cluster.geometry.coordinates
  const positions = generateSpiral({ latitude, longitude }, leaves, 0)

  return positions.flatMap((position) => {
    const child =
      typeof position.index === 'number' ? propsChildren[position.index] : null

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
