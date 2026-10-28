// JS-path benchmark: the library's JavaScript between a MapView's children and
// the native engine, measured in Node (V8). Informational: V8 is not Hermes, so
// only a large regression (compare.mjs gates at 2x) says anything about an app.
//
//   node bench/js/run.mjs                       # this checkout → bench/results/js-latest.json
//   node bench/js/run.mjs --pkg ../base/package --label base --out base-js.json
//
// Options:
//   --pkg <dir>        the package whose src/ is measured (default: this one)
//   --sizes 1000,…     point counts (default: 1000,10000,50000)
//   --out <file>       report path, `-` for stdout
//   --label <name>     recorded in the report
//   --quick            fewer samples
//
// It bundles <pkg>/src with `bun build --target node`, so it runs a checkout's
// TypeScript as is, with React in production mode. It exits 3 when that
// checkout cannot be bundled with this harness (a measured function is missing
// or moved), 2 on a usage error and 1 on any other failure.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { generateDataset } from '../datasets.mjs'

const jsBenchDir = path.dirname(fileURLToPath(import.meta.url))

const SCHEMA_VERSION = 1
const DATASET = 'city'
const DEFAULT_SIZES = [1000, 10000, 50000]
const EXIT_FAILURE = 1
const EXIT_USAGE = 2
const EXIT_HARNESS_UNAVAILABLE = 3

// What the bundle exports, from the measured package's src/. Changing a path
// here makes older checkouts unbundleable (exit 3), never mismeasured.
const ENTRY = `
export {
  createChildrenCache,
  createMarkerFeatureCache,
  flattenChildren,
  isMarker,
  markerToGeoJSONFeature,
  splitMarkerChildren,
} from './src/compat/helpers'
export { partitionValidPoints } from './src/engine/validatePoints'
export { coordsToGeoJSONFeature } from './src/geojson/utils'
export { stabilizeClusterFeatures } from './src/hooks/stabilizeClusters'
export { packPoints } from './src/utils/packPoints'
export * as React from 'react'
export { default as Supercluster } from 'supercluster'
`

class BenchError extends Error {
  constructor(message, exitCode = EXIT_FAILURE) {
    super(message)
    this.exitCode = exitCode
  }
}

function parseArgs(argv) {
  const options = {
    pkg: path.join(jsBenchDir, '..', '..'),
    sizes: DEFAULT_SIZES,
    out: path.join(jsBenchDir, '..', 'results', 'js-latest.json'),
    label: 'local',
    quick: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const value = () => {
      if (i + 1 >= argv.length) usage(`missing value for ${arg}`)
      return argv[++i]
    }
    if (arg === '--') continue
    if (arg === '--pkg') options.pkg = path.resolve(value())
    else if (arg === '--sizes') options.sizes = value().split(',').map(Number)
    else if (arg === '--out') options.out = value()
    else if (arg === '--label') options.label = value()
    else if (arg === '--quick') options.quick = true
    else usage(`unknown argument ${arg}`)
  }
  if (options.sizes.some((size) => !Number.isInteger(size) || size <= 0)) {
    usage('--sizes must be positive integers')
  }
  return options
}

function usage(message) {
  throw new BenchError(message, EXIT_USAGE)
}

// The entry sits inside the package, so `react` and `supercluster` resolve
// from its node_modules exactly as the library's own imports do.
async function loadBundle(pkg) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'cluster-bench-js-'))
  const entry = path.join(pkg, `.bench-js-entry-${process.pid}.ts`)
  const bundle = path.join(work, 'bundle.mjs')
  fs.writeFileSync(entry, ENTRY)
  try {
    console.error(`bench-js: bundling ${path.join(pkg, 'src')}`)
    const result = spawnSync(
      'bun',
      [
        'build',
        entry,
        '--target=node',
        '--format=esm',
        '--define',
        'process.env.NODE_ENV="production"',
        `--outfile=${bundle}`,
      ],
      { encoding: 'utf8' }
    )
    if (result.error) {
      throw new BenchError(`cannot run bun: ${result.error.message}`)
    }
    if (result.status !== 0) {
      process.stderr.write(result.stderr)
      throw new BenchError(
        'the package cannot be bundled with this harness',
        EXIT_HARNESS_UNAVAILABLE
      )
    }
  } finally {
    fs.rmSync(entry, { force: true })
  }
  return import(pathToFileURL(bundle).href)
}

// Every result is folded into this export, so V8 cannot drop the calls as dead
// code.
export let blackhole = 0

// Each sample batches calls until it lasts at least `minSampleNs`, so fast
// operations are not dominated by the timer.
function measure(fn, { samples, minSampleNs }) {
  let sink = 0
  for (let i = 0; i < 3; i++) sink += fn()

  let batch = 1
  for (;;) {
    const start = process.hrtime.bigint()
    for (let i = 0; i < batch; i++) sink += fn()
    if (Number(process.hrtime.bigint() - start) >= minSampleNs) break
    batch *= 2
  }

  const perCall = []
  for (let s = 0; s < samples; s++) {
    const start = process.hrtime.bigint()
    for (let i = 0; i < batch; i++) sink += fn()
    perCall.push(Number(process.hrtime.bigint() - start) / batch)
  }
  blackhole += sink
  perCall.sort((a, b) => a - b)
  const median = perCall[Math.floor(perCall.length / 2)]
  const deviations = perCall
    .map((value) => Math.abs(value - median))
    .sort((a, b) => a - b)
  return {
    medianNs: Math.round(median),
    minNs: Math.round(perCall[0]),
    madNs: Math.round(deviations[Math.floor(deviations.length / 2)]),
    samples,
    batch,
  }
}

function Marker() {
  return null
}

// Every operation returns a number derived from its result, which measure()
// folds into `blackhole`.
function operationsFor(lib, size) {
  const { React } = lib
  const dataset = generateDataset(DATASET, size)
  const coordinates = dataset.lats.map((latitude, i) => ({
    latitude,
    longitude: dataset.lngs[i],
  }))
  const values = coordinates.map((_, i) => [(i % 7) + 1, i % 3])

  // What a MapView receives: one <Marker> element per point.
  const children = coordinates.map((coordinate, i) =>
    React.createElement(Marker, {
      key: `m${i}`,
      coordinate,
      title: `Marker ${i}`,
    })
  )

  const features = coordinates.map((coordinate, i) =>
    lib.coordsToGeoJSONFeature(coordinate, { id: i })
  )

  // A live update as MapView sees it: the markers above, created once, and
  // 20 vehicle markers next to them, re-created with new coordinates on
  // every update. The caches live as long as the map would.
  const liveUpdate = (cluster) => {
    const childrenCache = lib.createChildrenCache()
    const featureCache = lib.createMarkerFeatureCache()
    let update = 0
    return () => {
      update++
      const vehicles = Array.from({ length: 20 }, (_, i) =>
        React.createElement(Marker, {
          key: `v${i}`,
          cluster,
          coordinate: {
            latitude: coordinates[i].latitude + update * 1e-6,
            longitude: coordinates[i].longitude,
          },
        })
      )
      const flattened = lib.flattenChildren([children, vehicles], childrenCache)
      return lib.splitMarkerChildren(flattened, featureCache).markerFeatures
        .length
    }
  }

  // A cluster snapshot as useClusterer sees it on two renders: the same
  // features, and features of which every tenth has moved.
  const index = new lib.Supercluster({ radius: 40, maxZoom: 20 }).load(features)
  const snapshot = index.getClusters([-180, -85, 180, 85], 12)
  const sameSnapshot = snapshot.map((feature) => structuredClone(feature))
  const changedSnapshot = sameSnapshot.map((feature, i) => {
    if (i % 10 !== 0) return feature
    const [lng, lat] = feature.geometry.coordinates
    return {
      ...feature,
      geometry: { ...feature.geometry, coordinates: [lng + 1e-4, lat] },
    }
  })

  return {
    'children_to_features': () => {
      const result = []
      React.Children.toArray(children).forEach((child, i) => {
        if (lib.isMarker(child)) {
          result.push(lib.markerToGeoJSONFeature(child, i))
        }
      })
      return result.length
    },
    'live_update': liveUpdate(undefined),
    'live_update_unclustered': liveUpdate(false),
    'partition_points': () => lib.partitionValidPoints(features).valid.length,
    'pack_points': () => lib.packPoints(coordinates).buffer.byteLength,
    'pack_points_values': () =>
      lib.packPoints(coordinates, { values }).buffer.byteLength,
    'coords_to_features': () =>
      coordinates.map((coordinate, i) =>
        lib.coordsToGeoJSONFeature(coordinate, { id: i })
      ).length,
    'stabilize_same': () =>
      lib.stabilizeClusterFeatures(snapshot, sameSnapshot).length,
    'stabilize_changed': () =>
      lib.stabilizeClusterFeatures(snapshot, changedSnapshot).length,
    // supercluster itself, as a yardstick for the numbers above; a dependency,
    // so compare.mjs never gates on it.
    'reference:supercluster_load': () =>
      new lib.Supercluster({ radius: 40, maxZoom: 20 }).load(features).trees
        .length,
    'reference:supercluster_query': () =>
      index.getClusters([-180, -85, 180, 85], 12).length,
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const lib = await loadBundle(options.pkg)
  const settings = options.quick
    ? { samples: 5, minSampleNs: 2e6 }
    : { samples: 15, minSampleNs: 1e7 }

  const cases = []
  for (const size of options.sizes) {
    const operations = {}
    for (const [name, fn] of Object.entries(operationsFor(lib, size))) {
      console.error(`bench-js: ${DATASET} ${size} ${name}`)
      operations[name] = measure(fn, settings)
    }
    cases.push({ dataset: DATASET, size, operations })
  }

  const report = {
    schemaVersion: SCHEMA_VERSION,
    kind: 'js',
    label: options.label,
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      cpu: os.cpus()[0]?.model ?? 'unknown',
      runner: process.env.GITHUB_ACTIONS === 'true' ? 'github' : 'local',
    },
    cases,
  }
  const json = `${JSON.stringify(report, null, 2)}\n`
  if (options.out === '-') {
    process.stdout.write(json)
  } else {
    fs.mkdirSync(path.dirname(path.resolve(options.out)), { recursive: true })
    fs.writeFileSync(options.out, json)
    console.error(`bench-js: wrote ${options.out}`)
  }
}

main().catch((error) => {
  console.error(`bench-js: ${error.message}`)
  process.exit(error instanceof BenchError ? error.exitCode : EXIT_FAILURE)
})
