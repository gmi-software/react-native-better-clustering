import type { PointFeature } from '../geojson/types'

export interface SpiralCenter {
  latitude: number
  longitude: number
}

export interface SpiralPosition {
  index: number
  latitude: number
  longitude: number
  centerPoint: SpiralCenter
}

/** Base spiral radius in degrees of latitude (≈ 22 m per step at any latitude). */
const SPIRAL_STEP_DEG = 0.0002

const MIN_COS_LAT = 0.01

/**
 * Archimedean spiral layout for overlapping markers at max zoom.
 *
 * The latitude offset is applied directly (degrees of latitude map to a
 * constant ground distance), while the longitude offset is divided by
 * `cos(latitude)` so east–west spacing stays visually even with the
 * north–south spacing. Without this correction, markers bunch up
 * horizontally as you move away from the equator.
 */
export function generateSpiral(
  center: SpiralCenter,
  leaves: PointFeature[],
  _clusterIndex = 0
): SpiralPosition[] {
  const positions: SpiralPosition[] = []

  const cosLat = Math.max(
    Math.cos((center.latitude * Math.PI) / 180),
    MIN_COS_LAT
  )

  for (let i = 0; i < leaves.length; i++) {
    const leaf = leaves[i]
    if (leaf == null) {
      continue
    }

    const childIndex = leaf.properties.index
    if (typeof childIndex !== 'number') {
      continue
    }

    const angle = 0.25 * (i * 0.5)
    const radius = SPIRAL_STEP_DEG * angle
    positions.push({
      index: childIndex,
      latitude: center.latitude + radius * Math.cos(angle),
      longitude: center.longitude + (radius * Math.sin(angle)) / cosLat,
      centerPoint: center,
    })
  }

  return positions
}
