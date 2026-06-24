import type { BBox } from '../geojson/types'
import type { MapRegion } from '../types'
import type { Viewport } from '../specs/Viewport'
import { DEFAULT_MAX_ZOOM, DEFAULT_MIN_ZOOM } from './defaults'

/**
 * Pixel dimensions of the map view used for zoom calculations.
 *
 * Passed to `useClusterer` and {@linkcode clusterZoomFromRegion}.
 */
export interface MapDimensions {
  /** Map view width in pixels. Must be positive for clustering queries. */
  width: number
  /** Map view height in pixels. Must be positive for clustering queries. */
  height: number
}

/** World bounding box: [westLng, southLat, eastLng, northLat] */
const WORLD_BBOX: BBox = [-180, -90, 180, 90]

/**
 * Returns whether a {@linkcode MapRegion} has finite, positive deltas.
 *
 * @see {@linkcode regionToBBox}
 * @see {@linkcode clusterZoomFromRegion}
 */
export function isValidRegion(region: MapRegion): boolean {
  const { longitude, latitude, longitudeDelta, latitudeDelta } = region

  return (
    Number.isFinite(longitude) &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitudeDelta) &&
    Number.isFinite(latitudeDelta) &&
    longitudeDelta > 0 &&
    latitudeDelta > 0
  )
}

/**
 * Converts a {@linkcode MapRegion} to a geographic {@linkcode BBox}.
 *
 * Returns the world bbox when the region is invalid.
 *
 * @see {@linkcode isValidRegion}
 * @see {@linkcode clusterZoomFromRegion}
 */
export function regionToBBox(region: MapRegion): BBox {
  if (!isValidRegion(region)) {
    return WORLD_BBOX
  }

  const bbox: BBox = [
    region.longitude - region.longitudeDelta,
    region.latitude - region.latitudeDelta,
    region.longitude + region.longitudeDelta,
    region.latitude + region.latitudeDelta,
  ]

  if (bbox.some((value) => !Number.isFinite(value))) {
    return WORLD_BBOX
  }

  return bbox
}

function lngLatToPixel(
  lng: number,
  lat: number,
  zoom: number,
  extent: number
): { x: number; y: number } {
  const scale = extent * 2 ** zoom
  const sinLat = Math.sin((lat * Math.PI) / 180)
  const x = ((lng + 180) / 360) * scale
  const y =
    (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale
  return { x, y }
}

/**
 * Supercluster zoom from a bbox and map size — matches `geo-viewport` /
 * react-native-clusterer (uses width and height, not longitudeDelta alone).
 *
 * @see {@linkcode clusterZoomFromRegion}
 * @see {@linkcode MapDimensions}
 */
export function bboxToZoom(
  bbox: BBox,
  mapDimensions: MapDimensions,
  minZoom = DEFAULT_MIN_ZOOM,
  maxZoom = DEFAULT_MAX_ZOOM,
  extent = 512
): number {
  const { width, height } = mapDimensions
  if (width <= 0 || height <= 0) {
    return minZoom
  }

  const [west, south, east, north] = bbox
  if (
    !Number.isFinite(west) ||
    !Number.isFinite(south) ||
    !Number.isFinite(east) ||
    !Number.isFinite(north)
  ) {
    return minZoom
  }

  const base = maxZoom + 1
  const bl = lngLatToPixel(west, south, base, extent)
  const tr = lngLatToPixel(east, north, base, extent)
  const widthPx = tr.x - bl.x
  const heightPx = bl.y - tr.y

  if (widthPx <= 0 || heightPx <= 0) {
    return minZoom
  }

  const ratioX = widthPx / width
  const ratioY = heightPx / height
  const adjusted = Math.floor(
    Math.min(base - Math.log2(ratioX), base - Math.log2(ratioY))
  )

  if (!Number.isFinite(adjusted)) {
    return minZoom
  }

  return Math.max(minZoom, Math.min(maxZoom, adjusted))
}

/**
 * Zoom level for `Supercluster.getClustersFromRegion` — matches
 * [react-native-clusterer v5](https://github.com/JiriHoffmann/react-native-clusterer)
 * (`GeoViewport.viewport` + `longitudeDelta >= 40` shortcut).
 *
 * @see {@linkcode bboxToZoom}
 * @see {@linkcode regionToBBox}
 */
export function clusterZoomFromRegion(
  region: MapRegion,
  mapDimensions: MapDimensions,
  minZoom = DEFAULT_MIN_ZOOM,
  maxZoom = DEFAULT_MAX_ZOOM,
  extent = 512
): number {
  if (!isValidRegion(region)) {
    return minZoom
  }

  if (region.longitudeDelta >= 40) {
    return minZoom
  }

  return bboxToZoom(
    regionToBBox(region),
    mapDimensions,
    minZoom,
    maxZoom,
    extent
  )
}

/**
 * Builds a {@linkcode Viewport} from a {@linkcode BBox} and integer zoom.
 *
 * Consumed by `ClusterEngine.getClusters`.
 */
export function bboxToViewport(bbox: BBox, zoom: number): Viewport {
  const [west, south, east, north] = bbox

  return {
    west,
    south,
    east,
    north,
    zoom,
  }
}

const calculateDelta = (max: number, min: number): number =>
  max > min ? max - min : min - max

const calculateAverage = (...values: number[]): number => {
  if (values.length === 0) {
    return 0
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

/**
 * Region that fits marker coordinates with a 1.5× margin (react-native-clusterer parity).
 *
 * Used by cluster `getExpansionRegion` helpers and `Supercluster.getClusterExpansionRegion`.
 */
export function coordinatesToRegion(
  coordinates: Array<{ latitude: number; longitude: number }>
): MapRegion {
  if (coordinates.length === 0) {
    return {
      latitude: 0,
      longitude: 0,
      latitudeDelta: 0.01,
      longitudeDelta: 0.01,
    }
  }

  let minLat = coordinates[0]!.latitude
  let maxLat = coordinates[0]!.latitude
  let minLng = coordinates[0]!.longitude
  let maxLng = coordinates[0]!.longitude

  for (let i = 1; i < coordinates.length; i++) {
    const point = coordinates[i]!
    minLat = Math.min(minLat, point.latitude)
    maxLat = Math.max(maxLat, point.latitude)
    minLng = Math.min(minLng, point.longitude)
    maxLng = Math.max(maxLng, point.longitude)
  }

  const latitudeDelta = calculateDelta(maxLat, minLat) * 1.5
  const longitudeDelta = calculateDelta(maxLng, minLng) * 1.5

  return {
    latitude: calculateAverage(minLat, maxLat),
    longitude: calculateAverage(minLng, maxLng),
    latitudeDelta: Math.max(latitudeDelta, 0.001),
    longitudeDelta: Math.max(longitudeDelta, 0.001),
  }
}
