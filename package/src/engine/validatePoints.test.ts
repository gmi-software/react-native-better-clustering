import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'

import type { PointFeature } from '../geojson'

import { partitionValidPoints, warnSkippedPoints } from './validatePoints'

function point(longitude: number, latitude: number, id: string): PointFeature {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [longitude, latitude] },
    properties: { id },
  }
}

describe('partitionValidPoints', () => {
  it('keeps finite coordinates in their original order', () => {
    const points = [point(21, 52, 'a'), point(-122.42, 37.78, 'b')]

    const { valid, invalidIndices } = partitionValidPoints(points)

    expect(valid).toEqual(points)
    expect(invalidIndices).toEqual([])
  })

  it('drops undefined, null, and NaN coordinates', () => {
    const points = [
      point(21, undefined as unknown as number, 'undefined-lat'),
      point(21, 52, 'valid'),
      point(null as unknown as number, 52, 'null-lng'),
      point(21, NaN, 'nan-lat'),
      point(Infinity, 52, 'infinite-lng'),
    ]

    const { valid, invalidIndices } = partitionValidPoints(points)

    expect(valid.map((p) => p.properties.id)).toEqual(['valid'])
    expect(invalidIndices).toEqual([0, 2, 3, 4])
  })

  it('keeps out-of-range coordinates, which the native side clamps', () => {
    const points = [point(21, 999, 'clamped'), point(999, 52, 'clamped-lng')]

    const { valid, invalidIndices } = partitionValidPoints(points)

    expect(valid).toHaveLength(2)
    expect(invalidIndices).toEqual([])
  })

  it('returns an empty partition for no points', () => {
    expect(partitionValidPoints([])).toEqual({ valid: [], invalidIndices: [] })
  })
})

describe('warnSkippedPoints', () => {
  let warn: ReturnType<typeof spyOn>

  beforeEach(() => {
    warn = spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warn.mockRestore()
  })

  it('stays silent when nothing was skipped', () => {
    warnSkippedPoints([], 10)

    expect(warn).not.toHaveBeenCalled()
  })

  it('reports the count and the offending indices', () => {
    warnSkippedPoints([2, 7], 10)

    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]?.[0])).toContain('skipped 2 of 10 points')
    expect(String(warn.mock.calls[0]?.[0])).toContain('index 2, 7')
  })

  it('truncates long index lists instead of printing every one', () => {
    warnSkippedPoints([0, 1, 2, 3, 4, 5, 6], 100)

    expect(String(warn.mock.calls[0]?.[0])).toContain(
      'index 0, 1, 2, 3, 4, and 2 more'
    )
  })
})
