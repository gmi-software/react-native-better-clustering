// Regenerates the ground-truth tables in `cpp/ClusterEngineCore.test.cpp`
// (testSuperclusterParity and testSuperclusterAntimeridianParity) from the
// reference supercluster implementation.
//
//   node scripts/generate-supercluster-parity-fixture.mjs
//
// Run from `package/`, so it uses the pinned supercluster devDependency. Paste
// each section of the output over the table it names in the test. The fixture
// is checked in so the C++ test stays independent of Node.

import Supercluster from 'supercluster'

// xorshift32. Bit-exact in JS (with >>> 0) and in C++ (uint32_t), so both sides
// generate the identical point set.
function makeRng(seed) {
  let x = seed >>> 0
  return () => {
    x ^= (x << 13) >>> 0
    x >>>= 0
    x ^= x >>> 17
    x ^= (x << 5) >>> 0
    x >>>= 0
    return x
  }
}

// Coordinates are derived from integers so JS and C++ produce identical
// doubles: IEEE-754 division of exactly representable integers is
// correctly rounded on both sides. Latitude stays well inside the mercator
// clamp so clamping never enters the comparison.
function makeFeatures(n, seed) {
  const rng = makeRng(seed)
  const features = []
  for (let i = 0; i < n; i++) {
    const a = rng()
    const b = rng()
    features.push({
      type: 'Feature',
      id: i,
      properties: {},
      geometry: {
        type: 'Point',
        coordinates: [
          -180 + (b % 3600001) / 10000,
          -60 + (a % 1200001) / 10000,
        ],
      },
    })
  }
  return features
}

// The extent 256/512/1024 rows must come out shifted by exactly one zoom level
// relative to each other — that is what pins `extent` to the projection instead
// of letting it act as a second radius control.
const CASES = [
  {
    n: 5000,
    seed: 12345,
    radius: 40,
    extent: 512,
    minZoom: 0,
    maxZoom: 16,
    minPoints: 2,
  },
  {
    n: 5000,
    seed: 12345,
    radius: 40,
    extent: 256,
    minZoom: 0,
    maxZoom: 16,
    minPoints: 2,
  },
  {
    n: 5000,
    seed: 12345,
    radius: 40,
    extent: 1024,
    minZoom: 0,
    maxZoom: 16,
    minPoints: 2,
  },
  {
    n: 3000,
    seed: 777,
    radius: 80,
    extent: 512,
    minZoom: 1,
    maxZoom: 14,
    minPoints: 2,
  },
  {
    n: 8000,
    seed: 424242,
    radius: 25,
    extent: 512,
    minZoom: 0,
    maxZoom: 12,
    minPoints: 2,
  },
]

// Hashes which points share a cluster at one zoom, independent of cluster ids
// (supercluster's ids differ from the engine's). Every point is labelled with
// the smallest id among the leaves of the feature that contains it, then the
// labels are folded with 32-bit FNV-1a in point-id order. The C++ test computes
// the same hash bit-for-bit.
function membershipHash(index, features, n) {
  const labels = new Uint32Array(n)
  for (const feature of features) {
    if (!feature.properties.cluster) {
      labels[feature.id] = feature.id
      continue
    }
    const leaves = index.getLeaves(feature.properties.cluster_id, Infinity)
    let label = leaves[0].id
    for (const leaf of leaves) {
      if (leaf.id < label) label = leaf.id
    }
    for (const leaf of leaves) {
      labels[leaf.id] = label
    }
  }

  let hash = 2166136261
  for (let i = 0; i < n; i++) {
    hash = (hash ^ labels[i]) >>> 0
    hash = Math.imul(hash, 16777619) >>> 0
  }
  return hash
}

// Hashes each cluster's expansion zoom at one zoom, keyed by the smallest id
// among its leaves: `(minLeafId, getClusterExpansionZoom)` pairs sorted by
// `minLeafId`, both folded with 32-bit FNV-1a. The C++ test computes the same
// hash bit-for-bit.
function expansionHash(index, features) {
  const pairs = []
  for (const feature of features) {
    if (!feature.properties.cluster) continue
    const clusterId = feature.properties.cluster_id
    let minLeafId = Infinity
    for (const leaf of index.getLeaves(clusterId, Infinity)) {
      if (leaf.id < minLeafId) minLeafId = leaf.id
    }
    pairs.push([minLeafId, index.getClusterExpansionZoom(clusterId)])
  }
  pairs.sort((a, b) => a[0] - b[0])

  let hash = 2166136261
  for (const pair of pairs) {
    for (const value of pair) {
      hash = (hash ^ value) >>> 0
      hash = Math.imul(hash, 16777619) >>> 0
    }
  }
  return hash
}

// Points within 10 degrees of the antimeridian on both sides. Longitudes come
// from integers, as in makeFeatures, and are wrapped into [-180, 180].
function makeAntimeridianFeatures(n, seed) {
  const rng = makeRng(seed)
  const features = []
  for (let i = 0; i < n; i++) {
    const a = rng()
    const b = rng()
    let lngE4 = 1700000 + (b % 200001)
    if (lngE4 > 1800000) lngE4 -= 3600000
    features.push({
      type: 'Feature',
      id: i,
      properties: {},
      geometry: {
        type: 'Point',
        coordinates: [lngE4 / 10000, -30 + (a % 300001) / 10000],
      },
    })
  }
  return features
}

// Must match the constants in testSuperclusterAntimeridianParity.
const ANTIMERIDIAN = {
  n: 2000,
  seed: 2024,
  radius: 40,
  extent: 512,
  minZoom: 0,
  maxZoom: 16,
  minPoints: 2,
}

// Query bboxes in every form a caller can pass around the antimeridian:
// unwrapped past 180 (what a map region produces), wrapped with west > east,
// far outside [-180, 180], latitudes past the poles, and 360 degrees or wider.
const ANTIMERIDIAN_BBOXES = [
  [165, -40, 185, 10],
  [165, -40, -175, 10],
  [-195, -40, -175, 10],
  [535, -40, 545, 10],
  [175, -25, 179.5, -5],
  [178, -100, 182, 100],
  [-180, -90, 180, 90],
  [0, -90, 360, 90],
  [-200, -90, 200, 90],
]
const ANTIMERIDIAN_ZOOMS = [2, 6, 10, 16]

// Hashes the set of features a query returns: `(minLeafId, point count)` per
// feature, sorted, folded with 32-bit FNV-1a. A missing or duplicated feature
// changes it.
function featureSetHash(index, features) {
  const pairs = []
  for (const feature of features) {
    if (!feature.properties.cluster) {
      pairs.push([feature.id, 1])
      continue
    }
    let minLeafId = Infinity
    for (const leaf of index.getLeaves(
      feature.properties.cluster_id,
      Infinity
    )) {
      if (leaf.id < minLeafId) minLeafId = leaf.id
    }
    pairs.push([minLeafId, feature.properties.point_count])
  }
  pairs.sort((a, b) => a[0] - b[0])

  let hash = 2166136261
  for (const pair of pairs) {
    for (const value of pair) {
      hash = (hash ^ value) >>> 0
      hash = Math.imul(hash, 16777619) >>> 0
    }
  }
  return hash
}

function cppDouble(value) {
  return Number.isInteger(value) ? `${value}.0` : `${value}`
}

const lines = ['// testSuperclusterParity: cases']
for (const testCase of CASES) {
  const index = new Supercluster({
    radius: testCase.radius,
    extent: testCase.extent,
    minZoom: testCase.minZoom,
    maxZoom: testCase.maxZoom,
    minPoints: testCase.minPoints,
    nodeSize: 64,
  }).load(makeFeatures(testCase.n, testCase.seed))

  const nodes = []
  const clusters = []
  const memberships = []
  const expansions = []
  for (let z = testCase.minZoom; z <= testCase.maxZoom; z++) {
    const features = index.getClusters([-180, -85, 180, 85], z)
    nodes.push(features.length)
    clusters.push(
      features.filter((feature) => feature.properties.cluster).length
    )
    memberships.push(`${membershipHash(index, features, testCase.n)}u`)
    expansions.push(`${expansionHash(index, features)}u`)
  }

  lines.push(
    `  // n=${testCase.n} seed=${testCase.seed} radius=${testCase.radius} extent=${testCase.extent} zoom ${testCase.minZoom}..${testCase.maxZoom} minPoints=${testCase.minPoints}`,
    `  {${testCase.n}, ${testCase.seed}u, ${testCase.radius}.0, ${testCase.extent}, ${testCase.minZoom}, ${testCase.maxZoom}, ${testCase.minPoints},`,
    `   {${nodes.join(', ')}},`,
    `   {${clusters.join(', ')}},`,
    `   {${memberships.join(', ')}},`,
    `   {${expansions.join(', ')}}},`
  )
}

const antimeridianIndex = new Supercluster({
  radius: ANTIMERIDIAN.radius,
  extent: ANTIMERIDIAN.extent,
  minZoom: ANTIMERIDIAN.minZoom,
  maxZoom: ANTIMERIDIAN.maxZoom,
  minPoints: ANTIMERIDIAN.minPoints,
  nodeSize: 64,
}).load(makeAntimeridianFeatures(ANTIMERIDIAN.n, ANTIMERIDIAN.seed))

lines.push('// testSuperclusterAntimeridianParity: queries')
for (const bbox of ANTIMERIDIAN_BBOXES) {
  for (const zoom of ANTIMERIDIAN_ZOOMS) {
    const features = antimeridianIndex.getClusters(bbox, zoom)
    lines.push(
      `  {${bbox.map(cppDouble).join(', ')}, ${zoom}, ${features.length}, ${featureSetHash(antimeridianIndex, features)}u},`
    )
  }
}

console.log(lines.join('\n'))
