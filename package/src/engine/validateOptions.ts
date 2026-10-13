import type { SuperclusterOptions } from './types'

/**
 * Highest zoom the native engine builds levels for. supercluster encodes the
 * origin zoom of a cluster id in 5 bits, which caps it at the same value.
 */
const MAX_SUPPORTED_ZOOM = 30

const INT32_MIN = -(2 ** 31)
const INT32_MAX = 2 ** 31 - 1

function describeValue(value: unknown): string {
  return typeof value === 'string' ? JSON.stringify(value) : String(value)
}

function fail(name: string, requirement: string, value: unknown): never {
  throw new RangeError(
    `react-native-better-clustering: ${name} must be ${requirement}, got ${describeValue(value)}.`
  )
}

function describeIntegerRange(min: number, max: number): string {
  if (min === INT32_MIN && max === INT32_MAX) {
    return 'a 32-bit integer'
  }
  if (max === INT32_MAX) {
    return `an integer >= ${min}`
  }
  return `an integer from ${min} to ${max}`
}

function requireInteger(
  name: string,
  value: number,
  min = INT32_MIN,
  max = INT32_MAX
): void {
  if (!(Number.isInteger(value) && value >= min && value <= max)) {
    fail(name, describeIntegerRange(min, max), value)
  }
}

/**
 * Throws a `RangeError` naming the first option the native engine cannot
 * build a bounded, non-empty index from. Mirrors the native checks in
 * `cpp/InputValidation.hpp`, so the error carries this package's prefix.
 *
 * Values that are unusual but well defined, such as `radius` 0 or `minPoints`
 * below 2, pass.
 */
export function validateSuperclusterOptions(
  options: Required<SuperclusterOptions>
): void {
  const {
    radius,
    minZoom,
    maxZoom,
    minPoints,
    extent,
    nodeSize,
    viewportTileSize,
  } = options

  if (!(Number.isFinite(radius) && radius >= 0)) {
    fail('radius', 'a finite number >= 0', radius)
  }
  requireInteger('minZoom', minZoom, 0, MAX_SUPPORTED_ZOOM)
  requireInteger('maxZoom', maxZoom, 0, MAX_SUPPORTED_ZOOM)
  if (minZoom > maxZoom) {
    throw new RangeError(
      `react-native-better-clustering: minZoom (${minZoom}) must not be greater than maxZoom (${maxZoom}).`
    )
  }
  requireInteger('minPoints', minPoints)
  requireInteger('extent', extent, 1)
  requireInteger('nodeSize', nodeSize)
  if (!(Number.isFinite(viewportTileSize) && viewportTileSize > 0)) {
    fail('viewportTileSize', 'a finite number > 0', viewportTileSize)
  }
}

/** Throws a `RangeError` unless `clusterId` can name a node in the native index. */
export function validateClusterId(clusterId: number): void {
  requireInteger('clusterId', clusterId)
}
