import { PACK_POINTS_MAGIC_V2, packPoints } from './packPoints'

const SAMPLE_COORDINATES = [
  { latitude: 52.0, longitude: 21.0 },
  { latitude: 52.1, longitude: 21.1 },
]

describe('packPoints v1', () => {
  it('packs count and coordinates without magic header', () => {
    const { buffer, count } = packPoints(SAMPLE_COORDINATES)
    const view = new DataView(buffer)

    expect(count).toBe(2)
    expect(view.getUint32(0, true)).toBe(2)
    expect(view.getInt32(4, true)).toBe(0)
    expect(view.getFloat64(8, true)).toBeCloseTo(52.0)
    expect(view.getFloat64(16, true)).toBeCloseTo(21.0)
  })
})

describe('packPoints v2', () => {
  it('writes magic header and aggregation values', () => {
    const { buffer } = packPoints(SAMPLE_COORDINATES, {
      values: [
        [10, 1],
        [20, 2],
      ],
    })
    const view = new DataView(buffer)

    expect(view.getUint32(0, true)).toBe(PACK_POINTS_MAGIC_V2)
    expect(view.getUint32(4, true)).toBe(2)
    expect(view.getUint32(8, true)).toBe(2)
    expect(view.getFloat64(32, true)).toBeCloseTo(10)
    expect(view.getFloat64(40, true)).toBeCloseTo(1)
  })
})
