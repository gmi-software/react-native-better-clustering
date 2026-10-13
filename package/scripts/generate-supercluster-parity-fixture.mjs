// Regenerates the ground-truth table in `cpp/ClusterEngineCore.test.cpp`
// (testSuperclusterParity) from the reference supercluster implementation.
//
//   node scripts/generate-supercluster-parity-fixture.mjs
//
// Run from `package/`, so it uses the pinned supercluster devDependency. Paste
// the output over the `cases` table in the test. The fixture is checked in so
// the C++ test stays independent of Node.

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

const lines = []
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

console.log(lines.join('\n'))
