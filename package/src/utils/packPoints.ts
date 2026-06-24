/** Latitude/longitude pair accepted by {@linkcode packPoints}. */
export interface PackableCoordinate {
  latitude: number
  longitude: number
}

const POINT_SIZE = 20 // int32 id + float64 lat + float64 lng
const VALUE_SIZE = 8 // float64 per aggregated property

/**
 * Magic header for v2 buffers: bytes `'C'`, `'2'`, `'M'`, `'N'` little-endian.
 *
 * @see {@linkcode packPoints}
 */
export const PACK_POINTS_MAGIC_V2 = 0x4e4d4332

/** Options for {@linkcode packPoints}. */
export interface PackPointsOptions {
  /** Row-major numeric values: `values[pointIndex][propIndex]`. Enables v2 buffer layout. */
  values?: number[][]
}

/** Result of {@linkcode packPoints}. */
export interface PackedPoints {
  /** Binary buffer consumed by `ClusterEngine.setPoints`. */
  buffer: ArrayBuffer
  /** Number of coordinates encoded in the buffer. */
  count: number
}

/**
 * Pack map points into a binary `ArrayBuffer` for zero-copy transfer to C++.
 *
 * v1 layout (no aggregation):
 * - uint32 point count
 * - per point: int32 index, float64 lat, float64 lng (20 bytes)
 *
 * v2 layout (with aggregation values):
 * - uint32 magic ({@linkcode PACK_POINTS_MAGIC_V2})
 * - uint32 point count
 * - uint32 numProps
 * - per point: int32 index, float64 lat, float64 lng, numProps × float64
 *
 * @see `ClusterEngine.setPoints`
 * @see `Supercluster.load`
 */
export function packPoints(
  coordinates: ReadonlyArray<PackableCoordinate>,
  options?: PackPointsOptions
): PackedPoints {
  const count = coordinates.length
  const numProps = options?.values?.[0]?.length ?? 0
  const hasValues = numProps > 0 && options?.values != null

  if (hasValues) {
    const stride = POINT_SIZE + numProps * VALUE_SIZE
    const buffer = new ArrayBuffer(12 + count * stride)
    const view = new DataView(buffer)

    view.setUint32(0, PACK_POINTS_MAGIC_V2, true)
    view.setUint32(4, count, true)
    view.setUint32(8, numProps, true)

    let offset = 12
    for (let i = 0; i < count; i++) {
      const coord = coordinates[i]!
      const row = options!.values![i] ?? []

      view.setInt32(offset, i, true)
      offset += 4
      view.setFloat64(offset, coord.latitude, true)
      offset += 8
      view.setFloat64(offset, coord.longitude, true)
      offset += 8

      for (let k = 0; k < numProps; k++) {
        view.setFloat64(offset, row[k] ?? 0, true)
        offset += 8
      }
    }

    return { buffer, count }
  }

  const buffer = new ArrayBuffer(4 + count * POINT_SIZE)
  const view = new DataView(buffer)

  view.setUint32(0, count, true)

  let offset = 4
  for (let i = 0; i < count; i++) {
    const coord = coordinates[i]!
    view.setInt32(offset, i, true)
    offset += 4
    view.setFloat64(offset, coord.latitude, true)
    offset += 8
    view.setFloat64(offset, coord.longitude, true)
    offset += 8
  }

  return { buffer, count }
}
