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

/** A screen offset from the spiral centre, in points (`x` east, `y` north). */
export interface SpiralOffset {
  x: number
  y: number
}

/**
 * Screen distance between neighbouring spiderfied markers: room for a ~32 pt
 * marker plus 8 pt of gap.
 */
export const SPIRAL_SPACING_PT = 40

const MIN_COS_LAT = 0.01

/**
 * Offsets for `count` markers along an Archimedean spiral whose turns are
 * `spacing` apart, stepping about `spacing` along the curve between markers.
 *
 * The first marker sits one `spacing` from the centre, so no marker covers
 * the point the connector lines meet at.
 */
export function spiralOffsets(count: number, spacing: number): SpiralOffset[] {
  const offsets: SpiralOffset[] = []
  const growthPerRadian = spacing / (2 * Math.PI)
  let angle = 0

  for (let i = 0; i < count; i++) {
    const radius = spacing + growthPerRadian * angle
    offsets.push({ x: radius * Math.cos(angle), y: radius * Math.sin(angle) })
    angle += spacing / radius
  }

  return offsets
}

/**
 * Spiral layout for a cluster's overlapping markers at max zoom, with
 * neighbours {@linkcode SPIRAL_SPACING_PT} apart on screen.
 *
 * Leaves without a numeric child `index` are skipped without leaving a gap.
 *
 * @param longitudePerPoint - Degrees of longitude one screen point spans at
 *   the current zoom (`longitudeDelta / width`).
 */
export function generateSpiral(
  center: SpiralCenter,
  leaves: PointFeature[],
  longitudePerPoint: number
): SpiralPosition[] {
  // Web Mercator is conformal: one screen point spans `cos(latitude)` times as
  // many degrees of latitude as of longitude.
  const cosLat = Math.max(
    Math.cos((center.latitude * Math.PI) / 180),
    MIN_COS_LAT
  )
  const latitudePerPoint = longitudePerPoint * cosLat

  const indices: number[] = []
  for (const leaf of leaves) {
    const childIndex = leaf.properties.index
    if (typeof childIndex === 'number') {
      indices.push(childIndex)
    }
  }

  const offsets = spiralOffsets(indices.length, SPIRAL_SPACING_PT)
  return indices.map((index, i) => {
    const offset = offsets[i]!
    return {
      index,
      latitude: center.latitude + offset.y * latitudePerPoint,
      longitude: center.longitude + offset.x * longitudePerPoint,
      centerPoint: center,
    }
  })
}
