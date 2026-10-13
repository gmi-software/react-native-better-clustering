import { Dimensions } from 'react-native'
import type { Region } from 'react-native-maps'
import { isClusterFeature } from 'react-native-better-clustering/geojson'
import type {
  ClusterFeature,
  PointFeature,
} from 'react-native-better-clustering/geojson'

export interface MapPoint {
  id: string
  latitude: number
  longitude: number
}

export interface Bounds {
  minLat: number
  maxLat: number
  minLng: number
  maxLng: number
}

export const POLAND_BOUNDS: Bounds = {
  minLat: 49.0,
  maxLat: 54.8,
  minLng: 14.1,
  maxLng: 24.1,
}

export const POLAND_REGION: Region = {
  latitude: 51.9,
  longitude: 19.1,
  latitudeDelta: 7,
  longitudeDelta: 11,
}

export const KRAKOW_REGION: Region = {
  latitude: 50.0647,
  longitude: 19.945,
  latitudeDelta: 0.3,
  longitudeDelta: 0.3,
}

/** Inside {@linkcode KRAKOW_REGION} on any phone screen, so every point is on the map. */
export const KRAKOW_BOUNDS: Bounds = {
  minLat: 50.0047,
  maxLat: 50.1247,
  minLng: 19.885,
  maxLng: 20.005,
}

/** mulberry32: a tiny seeded PRNG, so every run (and benchmark) sees the same points. */
function createRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * The point at `index` of a seeded dataset. Depends only on its arguments, so
 * a dataset can grow or shrink one point at a time and keep its other points.
 */
export function pointAt(bounds: Bounds, seed: number, index: number): MapPoint {
  const random = createRandom(Math.imul(seed, 0x9e3779b1) ^ index)
  return {
    id: `${seed}-${index}`,
    latitude: bounds.minLat + random() * (bounds.maxLat - bounds.minLat),
    longitude: bounds.minLng + random() * (bounds.maxLng - bounds.minLng),
  }
}

export function generatePoints(
  count: number,
  bounds: Bounds,
  seed: number
): MapPoint[] {
  return Array.from({ length: count }, (_, index) =>
    pointAt(bounds, seed, index)
  )
}

/** `count` points sharing one coordinate, like the units of one building. */
export function colocatedPoints(
  count: number,
  latitude: number,
  longitude: number,
  idPrefix: string
): MapPoint[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${idPrefix}-${index}`,
    latitude,
    longitude,
  }))
}

/**
 * A region centred on a coordinate at a camera zoom level (256-pt tiles, as
 * the library computes it) for a map as wide as the window.
 */
export function regionAtZoom(
  latitude: number,
  longitude: number,
  zoom: number
): Region {
  const { width } = Dimensions.get('window')
  const longitudeDelta = (360 * width) / (256 * 2 ** zoom)
  return {
    latitude,
    longitude,
    longitudeDelta,
    // Half the height a square region would need, so the map fits the region
    // by its width on any portrait map and the camera lands on `zoom`.
    latitudeDelta: longitudeDelta * Math.cos((latitude * Math.PI) / 180) * 0.5,
  }
}

/** How many markers the visible features stand for: clusters count their leaves. */
export function countPoints(
  features: Array<PointFeature | ClusterFeature>
): number {
  let count = 0
  for (const feature of features) {
    count += isClusterFeature(feature) ? feature.properties.point_count : 1
  }
  return count
}
