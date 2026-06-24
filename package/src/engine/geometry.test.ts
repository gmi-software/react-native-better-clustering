import type { MapRegion } from '../types'

import {
  bboxToZoom,
  clusterZoomFromRegion,
  isValidRegion,
  regionToBBox,
  type MapDimensions,
} from './geometry'

const VALID_REGION: MapRegion = {
  latitude: 37.78,
  longitude: -122.42,
  latitudeDelta: 0.05,
  longitudeDelta: 0.05,
}

const MAP_DIMENSIONS: MapDimensions = { width: 400, height: 800 }
const MIN_ZOOM = 2
const MAX_ZOOM = 16
const WORLD_BBOX = [-180, -90, 180, 90] as const

function assertFiniteBBox(bbox: ReturnType<typeof regionToBBox>): void {
  for (const value of bbox) {
    expect(Number.isFinite(value)).toBe(true)
  }
}

function assertFiniteZoom(zoom: number): void {
  expect(Number.isFinite(zoom)).toBe(true)
}

describe('isValidRegion', () => {
  it('accepts a well-formed region', () => {
    expect(isValidRegion(VALID_REGION)).toBe(true)
  })

  it('rejects the six invalid input classes', () => {
    const invalidRegions: MapRegion[] = [
      { ...VALID_REGION, latitude: Number.NaN },
      { ...VALID_REGION, longitude: Number.POSITIVE_INFINITY },
      { ...VALID_REGION, latitudeDelta: Number.NEGATIVE_INFINITY },
      {
        ...VALID_REGION,
        longitudeDelta: undefined as unknown as number,
      },
      { ...VALID_REGION, longitudeDelta: 0 },
      { ...VALID_REGION, latitudeDelta: -0.01 },
    ]

    for (const region of invalidRegions) {
      expect(isValidRegion(region)).toBe(false)
    }
  })
})

describe('regionToBBox', () => {
  it('returns a finite bbox for valid input', () => {
    const bbox = regionToBBox(VALID_REGION)

    assertFiniteBBox(bbox)
    expect(bbox).toEqual([
      VALID_REGION.longitude - VALID_REGION.longitudeDelta,
      VALID_REGION.latitude - VALID_REGION.latitudeDelta,
      VALID_REGION.longitude + VALID_REGION.longitudeDelta,
      VALID_REGION.latitude + VALID_REGION.latitudeDelta,
    ])
  })

  it('never returns NaN for the six invalid input classes', () => {
    const invalidRegions: MapRegion[] = [
      { ...VALID_REGION, latitude: Number.NaN },
      { ...VALID_REGION, longitude: Number.POSITIVE_INFINITY },
      { ...VALID_REGION, latitudeDelta: Number.NEGATIVE_INFINITY },
      {
        ...VALID_REGION,
        longitudeDelta: undefined as unknown as number,
      },
      { ...VALID_REGION, longitudeDelta: 0 },
      { ...VALID_REGION, latitudeDelta: -0.01 },
    ]

    for (const region of invalidRegions) {
      const bbox = regionToBBox(region)

      assertFiniteBBox(bbox)
      expect(bbox).toEqual(WORLD_BBOX)
    }
  })
})

describe('clusterZoomFromRegion', () => {
  it('returns a finite zoom for valid input', () => {
    const zoom = clusterZoomFromRegion(
      VALID_REGION,
      MAP_DIMENSIONS,
      MIN_ZOOM,
      MAX_ZOOM
    )

    assertFiniteZoom(zoom)
    expect(zoom).toBeGreaterThanOrEqual(MIN_ZOOM)
    expect(zoom).toBeLessThanOrEqual(MAX_ZOOM)
  })

  it('never returns NaN for the six invalid input classes', () => {
    const invalidRegions: MapRegion[] = [
      { ...VALID_REGION, latitude: Number.NaN },
      { ...VALID_REGION, longitude: Number.POSITIVE_INFINITY },
      { ...VALID_REGION, latitudeDelta: Number.NEGATIVE_INFINITY },
      {
        ...VALID_REGION,
        longitudeDelta: undefined as unknown as number,
      },
      { ...VALID_REGION, longitudeDelta: 0 },
      { ...VALID_REGION, latitudeDelta: -0.01 },
    ]

    for (const region of invalidRegions) {
      const zoom = clusterZoomFromRegion(
        region,
        MAP_DIMENSIONS,
        MIN_ZOOM,
        MAX_ZOOM
      )

      assertFiniteZoom(zoom)
      expect(zoom).toBe(MIN_ZOOM)
    }
  })

  it('falls back to minZoom when zoom math is non-finite', () => {
    const zoom = clusterZoomFromRegion(
      VALID_REGION,
      { width: Number.NaN, height: 800 },
      MIN_ZOOM,
      MAX_ZOOM
    )

    assertFiniteZoom(zoom)
    expect(zoom).toBe(MIN_ZOOM)
  })

  it('returns a usable zoom for continent-scale regions', () => {
    const europeRegion: MapRegion = {
      latitude: 54,
      longitude: 15,
      latitudeDelta: 30,
      longitudeDelta: 60,
    }

    const zoom = clusterZoomFromRegion(
      europeRegion,
      MAP_DIMENSIONS,
      MIN_ZOOM,
      MAX_ZOOM
    )

    assertFiniteZoom(zoom)
    expect(zoom).toBeGreaterThanOrEqual(MIN_ZOOM)
    expect(zoom).toBeLessThanOrEqual(MAX_ZOOM)
  })
  it('uses minZoom when longitudeDelta >= 40 (react-native-clusterer parity)', () => {
    const zoom = clusterZoomFromRegion(
      {
        latitude: 54,
        longitude: 15,
        latitudeDelta: 30,
        longitudeDelta: 40,
      },
      MAP_DIMENSIONS,
      MIN_ZOOM,
      MAX_ZOOM
    )

    expect(zoom).toBe(MIN_ZOOM)
  })
})

describe('bboxToZoom', () => {
  it('accounts for map height (geo-viewport parity)', () => {
    const polandBBox = [14.1, 49.0, 24.2, 54.9] as const
    const wideMap: MapDimensions = { width: 400, height: 200 }
    const tallMap: MapDimensions = { width: 400, height: 800 }

    const wideZoom = bboxToZoom([...polandBBox], wideMap, MIN_ZOOM, MAX_ZOOM)
    const tallZoom = bboxToZoom([...polandBBox], tallMap, MIN_ZOOM, MAX_ZOOM)

    assertFiniteZoom(wideZoom)
    assertFiniteZoom(tallZoom)
    expect(tallZoom).toBeGreaterThan(wideZoom)
  })
})
