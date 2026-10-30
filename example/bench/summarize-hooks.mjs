#!/usr/bin/env node
// Summarizes hook benchmark reports from run.mjs (`--flow hook-flow.yaml`):
// the median of every metric per library, version and point count, as
// Markdown tables and as JSON.
//
//   node bench/summarize-hooks.mjs results/ios-hooks.json [--json out.json]
import { readFileSync, writeFileSync } from 'node:fs'

const argv = process.argv.slice(2)
const jsonIndex = argv.indexOf('--json')
const jsonOut = jsonIndex === -1 ? null : argv[jsonIndex + 1]
const files = argv.filter(
  (_, index) =>
    jsonIndex === -1 || (index !== jsonIndex && index !== jsonIndex + 1)
)

const median = (values) => {
  const sorted = values.filter((value) => value != null).sort((a, b) => a - b)
  if (sorted.length === 0) {
    return null
  }
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2
}

/** One run's metrics, flat. */
function metrics({ result }) {
  const { engine, mount, rerender, pan, update } = result
  return {
    buildJsMs: engine?.jsMs,
    buildTotalMs: engine?.totalMs,
    firstClustersMs: mount?.firstClustersMs,
    mountMaxGapMs: mount?.maxGapMs,
    mountBlockedMs: mount?.blockedMs,
    mountBuilds: mount?.builds,
    mountFeatures: mount?.features,
    rerenderMs: rerender?.renderMs,
    rerenderBuilds: rerender?.builds,
    rerenderBlockedMs: rerender?.blockedMs,
    rerenderMaxGapMs: rerender?.maxGapMs,
    panUpdatedMs: pan?.updatedMs,
    panBuilds: pan?.builds,
    panBlockedMs: pan?.blockedMs,
    panMaxGapMs: pan?.maxGapMs,
    panFeatures: pan?.steps?.[0]?.features,
    updateIndexMs: update?.indexMs,
    updateBuilds: update?.builds,
    updateBlockedMs: update?.blockedMs,
    updateMaxGapMs: update?.maxGapMs,
  }
}

const groups = new Map()
const devices = new Set()
for (const file of files) {
  const report = JSON.parse(readFileSync(file, 'utf8'))
  devices.add(JSON.stringify(report.device))
  for (const run of report.runs) {
    if (run.result?.error != null) {
      continue
    }
    const key = `${run.result.library}@${run.result.version}|${run.count}`
    const group = groups.get(key) ?? {
      library: run.result.library,
      version: run.result.version,
      count: run.count,
      runs: [],
    }
    group.runs.push(metrics(run))
    groups.set(key, group)
  }
}

const summary = [...groups.values()]
  .sort((a, b) => a.count - b.count || a.library.localeCompare(b.library))
  .map(({ library, version, count, runs }) => {
    const medians = {}
    for (const name of Object.keys(runs[0])) {
      const value = median(runs.map((run) => run[name]))
      medians[name] = value == null ? null : Math.round(value * 10) / 10
    }
    return { library, version, count, runs: runs.length, ...medians }
  })

const key = [
  ['count', 'Points'],
  ['library', 'Library'],
  ['version', 'Version'],
  ['runs', 'Runs'],
]
const buildColumns = [
  ...key,
  ['buildJsMs', 'Index build, JS blocked (ms)'],
  ['buildTotalMs', 'Index build, until queryable (ms)'],
  ['firstClustersMs', 'Mount to first clusters (ms)'],
  ['mountMaxGapMs', 'Longest JS freeze, mount (ms)'],
  ['mountBuilds', 'Index builds, mount'],
]
const afterMountColumns = [
  ...key,
  ['rerenderMs', 'Per re-render (ms)'],
  ['rerenderBuilds', 'Index builds, 10 re-renders'],
  ['rerenderBlockedMs', 'JS blocked, 10 re-renders (ms)'],
  ['panUpdatedMs', 'Per pan, until new clusters (ms)'],
  ['panBuilds', 'Index builds, 10 pans'],
  ['panBlockedMs', 'JS blocked, 10 pans (ms)'],
  ['updateIndexMs', 'Per data change, until new index (ms)'],
  ['updateBuilds', 'Index builds, 5 data changes'],
  ['updateBlockedMs', 'JS blocked, 5 data changes (ms)'],
  ['updateMaxGapMs', 'Longest JS freeze, data changes (ms)'],
]
const table = (tableColumns, rows) => [
  `| ${tableColumns.map(([, title]) => title).join(' | ')} |`,
  `| ${tableColumns.map(() => '---').join(' | ')} |`,
  ...rows.map(
    (row) =>
      `| ${tableColumns.map(([name]) => (row[name] ?? '–').toLocaleString?.('en-US') ?? row[name]).join(' | ')} |`
  ),
]
console.log(`Devices: ${[...devices].join(', ')}\n`)
console.log(table(buildColumns, summary).join('\n'))
console.log(`\nAfter the mount:\n`)
console.log(table(afterMountColumns, summary).join('\n'))
if (jsonOut != null) {
  writeFileSync(
    jsonOut,
    `${JSON.stringify({ devices: [...devices].map((d) => JSON.parse(d)), summary }, null, 2)}\n`
  )
}
