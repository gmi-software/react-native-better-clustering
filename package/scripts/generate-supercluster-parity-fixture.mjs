// Regenerates the ground-truth table in `cpp/ClusterEngineCore.test.cpp`
// (testSuperclusterParity) from the reference supercluster implementation.
//
//   npx --yes -p supercluster@8 node scripts/generate-supercluster-parity-fixture.mjs
//
// Paste the output over the `CASES` table in the test. supercluster is not a
// dependency of this package — the fixture is checked in so CI stays offline.

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
  for (let z = testCase.minZoom; z <= testCase.maxZoom; z++) {
    const features = index.getClusters([-180, -85, 180, 85], z)
    nodes.push(features.length)
    clusters.push(
      features.filter((feature) => feature.properties.cluster).length
    )
  }

  lines.push(
    `  // n=${testCase.n} seed=${testCase.seed} radius=${testCase.radius} extent=${testCase.extent} zoom ${testCase.minZoom}..${testCase.maxZoom} minPoints=${testCase.minPoints}`,
    `  {${testCase.n}, ${testCase.seed}u, ${testCase.radius}.0, ${testCase.extent}, ${testCase.minZoom}, ${testCase.maxZoom}, ${testCase.minPoints},`,
    `   {${nodes.join(', ')}},`,
    `   {${clusters.join(', ')}}},`
  )
}

console.log(lines.join('\n'))
