import { describe, expect, it } from 'bun:test'

import { nearestWithin, screenScaleOf } from './glide'

// 100 points per degree both ways, so distances read in points.
const SCALE = { x: 100, y: 100 }

describe('screenScaleOf', () => {
  it('gives points per degree of the region on screen', () => {
    expect(
      screenScaleOf(
        { latitudeDelta: 2, longitudeDelta: 4 },
        { width: 400, height: 800 }
      )
    ).toEqual({ x: 100, y: 400 })
  })

  it('gives null for an empty region or map', () => {
    expect(
      screenScaleOf(
        { latitudeDelta: 0, longitudeDelta: 4 },
        { width: 400, height: 800 }
      )
    ).toBeNull()
    expect(
      screenScaleOf(
        { latitudeDelta: 2, longitudeDelta: 4 },
        { width: 0, height: 800 }
      )
    ).toBeNull()
  })
})

describe('nearestWithin', () => {
  const origin = { latitude: 0, longitude: 0 }

  it('picks the nearest candidate on screen', () => {
    const near = { latitude: 0.3, longitude: 0 }
    const far = { latitude: 0, longitude: 0.5 }

    expect(nearestWithin(origin, [far, near], SCALE, 100)).toBe(near)
  })

  it('weighs each axis by its own scale', () => {
    // 0.3° of latitude is 30 points here, 0.2° of longitude 40.
    const north = { latitude: 0.3, longitude: 0 }
    const east = { latitude: 0, longitude: 0.2 }

    expect(nearestWithin(origin, [east, north], { x: 200, y: 100 }, 100)).toBe(
      north
    )
  })

  it('leaves out candidates past the reach', () => {
    const far = { latitude: 0, longitude: 1.5 }

    expect(nearestWithin(origin, [far], SCALE, 100)).toBeUndefined()
  })

  it('keeps a candidate exactly at the reach', () => {
    const edge = { latitude: 0, longitude: 1 }

    expect(nearestWithin(origin, [edge], SCALE, 100)).toBe(edge)
  })

  it('finds nothing without candidates', () => {
    expect(nearestWithin(origin, [], SCALE, 100)).toBeUndefined()
  })
})
