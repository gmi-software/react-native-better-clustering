// JavaScript port of datasets.hpp: the same seeded point sets, bit for bit.
// Every coordinate is `A + B / C` with integer B and C, a correctly rounded
// division and addition, so V8 produces the doubles the C++ generator does;
// datasetHash() proves it against the `datasetHash` in a core benchmark report.
//
// Used by the supercluster parity fixture (scripts/
// generate-supercluster-parity-fixture.mjs) and the JS-path benchmark.

export const DATASET_NAMES = [
  'uniform',
  'city',
  'blobs',
  'identical',
  'grid',
  'antimeridian',
]
export const DATASET_SEED = 20260929

// xorshift32, as in datasets.hpp.
class XorShift32 {
  constructor(seed) {
    this.state = seed === 0 ? 1 : seed >>> 0
  }

  next() {
    let x = this.state
    x = (x ^ (x << 13)) >>> 0
    x = (x ^ (x >>> 17)) >>> 0
    x = (x ^ (x << 5)) >>> 0
    this.state = x
    return x
  }

  upTo(steps) {
    return this.next() % (steps + 1)
  }

  sumOf(draws, steps) {
    let sum = 0
    for (let i = 0; i < draws; i++) sum += this.upTo(steps)
    return sum
  }
}

function wrapLongitude(lng) {
  if (lng > 180) return lng - 360
  if (lng < -180) return lng + 360
  return lng
}

function generateUniform(d, n, rng) {
  d.focusLat = 0
  d.focusLng = 0
  for (let i = 0; i < n; i++) {
    d.lats.push(-60 + rng.upTo(1200000) / 10000)
    d.lngs.push(-180 + rng.upTo(3600000) / 10000)
  }
}

function generateCity(d, n, rng) {
  d.focusLat = 52.2297
  d.focusLng = 21.0122
  for (let i = 0; i < n; i++) {
    const dLat = rng.sumOf(3, 20000) - 30000
    const dLng = rng.sumOf(3, 30000) - 45000
    d.lats.push(d.focusLat + dLat / 100000)
    d.lngs.push(d.focusLng + dLng / 100000)
  }
}

function generateBlobs(d, n, rng) {
  const blobs = 24
  const centerLats = []
  const centerLngs = []
  const spreads = []
  for (let k = 0; k < blobs; k++) {
    centerLats.push(-50 + rng.upTo(1000000) / 10000)
    centerLngs.push(-180 + rng.upTo(3600000) / 10000)
    spreads.push(1 + rng.upTo(39))
  }
  d.focusLat = centerLats[0]
  d.focusLng = centerLngs[0]
  for (let i = 0; i < n; i++) {
    const k = rng.next() % blobs
    const dLat = (rng.sumOf(2, 2000) - 2000) * spreads[k]
    const dLng = (rng.sumOf(2, 2000) - 2000) * spreads[k]
    d.lats.push(centerLats[k] + dLat / 40000)
    d.lngs.push(wrapLongitude(centerLngs[k] + dLng / 40000))
  }
}

function generateIdentical(d, n) {
  d.focusLat = 52.2297
  d.focusLng = 21.0122
  for (let i = 0; i < n; i++) {
    d.lats.push(d.focusLat)
    d.lngs.push(d.focusLng)
  }
}

function generateGrid(d, n) {
  let cols = 1
  while (cols * cols < n) cols++
  const rows = Math.floor((n + cols - 1) / cols)
  d.focusLat = 50 + Math.floor(rows / 2) / 1000
  d.focusLng = 19 + Math.floor(cols / 2) / 1000
  for (let i = 0; i < n; i++) {
    d.lats.push(50 + Math.floor(i / cols) / 1000)
    d.lngs.push(19 + (i % cols) / 1000)
  }
}

function generateAntimeridian(d, n, rng) {
  d.focusLat = -17.5
  d.focusLng = 180
  for (let i = 0; i < n; i++) {
    d.lats.push(-25 + rng.upTo(150000) / 10000)
    d.lngs.push(wrapLongitude(170 + rng.upTo(200000) / 10000))
  }
}

/** The named dataset with `n` points: `{ name, lats, lngs, focusLat, focusLng }`. */
export function generateDataset(name, n) {
  const d = { name, lats: [], lngs: [], focusLat: 0, focusLng: 0 }
  const rng = new XorShift32(DATASET_SEED)
  if (name === 'uniform') generateUniform(d, n, rng)
  else if (name === 'city') generateCity(d, n, rng)
  else if (name === 'blobs') generateBlobs(d, n, rng)
  else if (name === 'identical') generateIdentical(d, n)
  else if (name === 'grid') generateGrid(d, n)
  else if (name === 'antimeridian') generateAntimeridian(d, n, rng)
  else throw new Error(`unknown dataset: ${name}`)
  return d
}

/** datasetHash() of datasets.hpp, as the 8-digit hex a benchmark report records. */
export function datasetHash(d) {
  const bytes = new Uint8Array(8)
  const view = new DataView(bytes.buffer)
  let hash = 2166136261
  const fold = (value) => {
    view.setFloat64(0, value, true)
    for (const byte of bytes) {
      hash = Math.imul((hash ^ byte) >>> 0, 16777619) >>> 0
    }
  }
  for (let i = 0; i < d.lats.length; i++) {
    fold(d.lats[i])
    fold(d.lngs[i])
  }
  return hash.toString(16).padStart(8, '0')
}
