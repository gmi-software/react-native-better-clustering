import { describe, expect, it } from 'bun:test'

import type { PointFeature } from '../geojson/types'
import {
  SPIRAL_SPACING_PT,
  generateSpiral,
  spiralOffsets,
  type SpiralOffset,
} from './spiral'

function minPairwiseDistance(offsets: SpiralOffset[]): number {
  let min = Infinity
  for (let i = 0; i < offsets.length; i++) {
    for (let j = i + 1; j < offsets.length; j++) {
      const a = offsets[i]!
      const b = offsets[j]!
      min = Math.min(min, Math.hypot(a.x - b.x, a.y - b.y))
    }
  }
  return min
}

function leaf(index: unknown): PointFeature {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [21, 52.2] },
    properties: { index },
  }
}

describe('spiralOffsets (#16)', () => {
  it.each([2, 10, 50, 100, 1000])(
    'keeps %i markers at least about one spacing apart',
    (count) => {
      const offsets = spiralOffsets(count, SPIRAL_SPACING_PT)

      expect(offsets).toHaveLength(count)
      expect(minPairwiseDistance(offsets)).toBeGreaterThanOrEqual(
        0.9 * SPIRAL_SPACING_PT
      )
    }
  )

  it('starts one spacing from the centre and never comes closer', () => {
    const offsets = spiralOffsets(50, SPIRAL_SPACING_PT)
    const distances = offsets.map(({ x, y }) => Math.hypot(x, y))

    expect(distances[0]).toBeCloseTo(SPIRAL_SPACING_PT)
    expect(Math.min(...distances)).toBeCloseTo(SPIRAL_SPACING_PT)
  })
})

describe('generateSpiral (#16)', () => {
  const center = { latitude: 60, longitude: 21 }
  const longitudePerPoint = 1e-6

  it('converts screen offsets to degrees at the centre latitude', () => {
    const positions = generateSpiral(
      center,
      [leaf(0), leaf(1), leaf(2)],
      longitudePerPoint
    )
    const offsets = spiralOffsets(3, SPIRAL_SPACING_PT)
    const latitudePerPoint = longitudePerPoint * Math.cos((60 * Math.PI) / 180)

    positions.forEach((position, i) => {
      expect(position.longitude - center.longitude).toBeCloseTo(
        offsets[i]!.x * longitudePerPoint,
        12
      )
      expect(position.latitude - center.latitude).toBeCloseTo(
        offsets[i]!.y * latitudePerPoint,
        12
      )
      expect(position.centerPoint).toBe(center)
    })
  })

  it('skips leaves without a child index without leaving a gap', () => {
    const positions = generateSpiral(
      center,
      [leaf(undefined), leaf(4), leaf('x'), leaf(7)],
      longitudePerPoint
    )
    const [first] = spiralOffsets(1, SPIRAL_SPACING_PT)

    expect(positions.map((position) => position.index)).toEqual([4, 7])
    expect(positions[0]!.longitude - center.longitude).toBeCloseTo(
      first!.x * longitudePerPoint,
      12
    )
  })
})
