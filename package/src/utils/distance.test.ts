import {
  formatDistance,
  getNearestPoints,
  haversineDistance,
  sortPointsByDistance,
  type GeoCoordinate,
} from './distance'

const WARSAW = { latitude: 52.2297, longitude: 21.0122 }
const KRAKOW = { latitude: 50.0647, longitude: 19.945 }
const LODZ = { latitude: 51.7592, longitude: 19.456 }

const POINTS: Array<GeoCoordinate & { id: string }> = [
  { id: 'warsaw', ...WARSAW },
  { id: 'krakow', ...KRAKOW },
  { id: 'lodz', ...LODZ },
]

describe('haversineDistance', () => {
  it('returns 0 for identical coordinates', () => {
    expect(haversineDistance(WARSAW, WARSAW)).toBe(0)
  })

  it('returns a sensible Warsaw–Krakow distance', () => {
    const meters = haversineDistance(WARSAW, KRAKOW)
    expect(meters).toBeGreaterThan(250_000)
    expect(meters).toBeLessThan(260_000)
  })

  it('returns NaN for invalid coordinates', () => {
    expect(
      haversineDistance(WARSAW, { latitude: Number.NaN, longitude: 21 })
    ).toBeNaN()
  })
})

describe('sortPointsByDistance', () => {
  it('sorts points ascending by distance from origin', () => {
    const sorted = sortPointsByDistance(POINTS, WARSAW)

    expect(sorted.map((point) => point.id)).toEqual([
      'warsaw',
      'lodz',
      'krakow',
    ])
    expect(sorted[0]?.distanceMeters).toBe(0)
    expect(sorted[1]?.distanceMeters).toBeGreaterThan(0)
    expect(sorted[2]?.distanceMeters).toBeGreaterThan(sorted[1]!.distanceMeters)
  })

  it('excludes points with invalid coordinates', () => {
    const sorted = sortPointsByDistance(
      [{ id: 'bad', latitude: Number.NaN, longitude: 0 }, ...POINTS],
      WARSAW
    )

    expect(sorted).toHaveLength(3)
    expect(sorted.some((point) => point.id === 'bad')).toBe(false)
  })
})

describe('getNearestPoints', () => {
  it('returns the closest points up to limit', () => {
    const nearest = getNearestPoints(POINTS, WARSAW, 2)

    expect(nearest.map((point) => point.id)).toEqual(['warsaw', 'lodz'])
  })

  it('filters by radiusKm before applying limit', () => {
    const nearest = getNearestPoints(POINTS, WARSAW, 10, 150)

    expect(nearest.map((point) => point.id)).toEqual(['warsaw', 'lodz'])
    expect(nearest.every((point) => point.distanceMeters <= 150_000)).toBe(true)
  })

  it('returns an empty array for non-positive limit', () => {
    expect(getNearestPoints(POINTS, WARSAW, 0)).toEqual([])
    expect(getNearestPoints(POINTS, WARSAW, -1)).toEqual([])
  })
})

describe('formatDistance', () => {
  it('formats sub-kilometer distances in meters', () => {
    expect(formatDistance(350)).toBe('350 m')
    expect(formatDistance(999)).toBe('999 m')
  })

  it('formats kilometer distances with one decimal', () => {
    expect(formatDistance(2100)).toBe('2.1 km')
    expect(formatDistance(10_000)).toBe('10 km')
  })

  it('handles invalid values gracefully', () => {
    expect(formatDistance(Number.NaN)).toBe('0 m')
    expect(formatDistance(-5)).toBe('0 m')
  })
})
