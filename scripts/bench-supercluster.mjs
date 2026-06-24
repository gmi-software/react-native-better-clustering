import SuperCluster from '../node_modules/.bun/supercluster@8.0.1/node_modules/supercluster/index.js'

function genPoints(n) {
  const features = []
  for (let i = 0; i < n; i++) {
    features.push({
      type: 'Feature',
      properties: { id: String(i) },
      geometry: {
        type: 'Point',
        coordinates: [
          21.0 + (i % 100) * 0.01,
          52.0 + Math.floor(i / 100) * 0.01,
        ],
      },
    })
  }
  return features
}

function bench(n, warmup, runs, queriesPerRun) {
  const data = genPoints(n)
  const bbox = [20.5, 51.5, 22.0, 53.0]
  const zoom = 10

  for (let w = 0; w < warmup; w++) {
    const sc = new SuperCluster({ radius: 50, minPoints: 2, maxZoom: 16 })
    sc.load(data)
    for (let q = 0; q < queriesPerRun; q++) {
      sc.getClusters(bbox, zoom)
    }
  }

  let buildTotal = 0
  let queryTotal = 0

  for (let r = 0; r < runs; r++) {
    const t0 = performance.now()
    const sc = new SuperCluster({ radius: 50, minPoints: 2, maxZoom: 16 })
    sc.load(data)
    const t1 = performance.now()

    for (let q = 0; q < queriesPerRun; q++) {
      sc.getClusters(bbox, zoom)
    }
    const t2 = performance.now()

    buildTotal += t1 - t0
    queryTotal += (t2 - t1) / queriesPerRun
  }

  console.log(
    `js,n=${n},build_ms=${(buildTotal / runs).toFixed(3)},query_ms=${(queryTotal / runs).toFixed(4)},runs=${runs},queries=${queriesPerRun}`
  )
}

const warmup = 2
const runs = 10
const queries = 100

for (const n of [1000, 5000, 10000, 20000, 30000, 50000]) {
  bench(n, warmup, runs, queries)
}
