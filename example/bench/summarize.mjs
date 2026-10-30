#!/usr/bin/env node
// Summarizes reports from run.mjs: the median of every metric per library,
// version and marker count, as Markdown tables and as JSON. A report's `flow`
// picks the metrics: the map benchmark's (flow.yaml) or the hook benchmark's
// (hook-flow.yaml).
//
//   node bench/summarize.mjs results/ios-main.json results/ios-1.0.0.json [--json out.json]
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
const mb = (bytes) => (bytes == null ? null : bytes / 1e6)
const memoryOf = (sample) => sample?.footprintBytes ?? sample?.pssBytes ?? null
/** MB the app grew from sample `from` to sample `to`; null if either is missing. */
const growthMb = (from, to) => {
  const start = memoryOf(from)
  const end = memoryOf(to)
  return start == null || end == null ? null : mb(end - start)
}

/** One map benchmark run's metrics, flat. */
function mapMetrics({ memory, result }) {
  const { mount, rerender, zoom, press, live, baseline } = result
  const steps = zoom?.steps ?? []
  return {
    firstMarkersMs: mount?.firstMarkersMs,
    mountMaxGapMs: mount?.maxGapMs,
    mountBlockedMs: mount?.blockedMs,
    mountDroppedFrames: mount?.droppedFrames,
    mountMemoryMb: growthMb(memory.baseline, memory.mounted),
    mountJsHeapMb: mb(mount?.jsHeap?.heapBytes - baseline?.jsHeap?.heapBytes),
    rerenderBlockedMs: rerender?.blockedMs,
    rerenderMaxGapMs: rerender?.maxGapMs,
    rerenderDroppedFrames: rerender?.droppedFrames,
    rerenderMounts: (rerender?.markerMounts ?? 0) + (rerender?.clusterMounts ?? 0),
    rerenderMinMounted: rerender?.minMounted,
    zoomBlockedMs: zoom?.blockedMs,
    zoomMaxGapMs: zoom?.maxGapMs,
    zoomMounts: steps.reduce(
      (sum, step) => sum + step.markerMounts + step.clusterMounts,
      0
    ),
    zoomUpdatedMs: steps.reduce((sum, step) => sum + step.updatedMs, 0),
    zoom8Mounted: steps[0]?.mounted,
    pressPointCount: press?.pointCount,
    pressRegionMs: press?.regionMs,
    pressMaxGapMs: press?.maxGapMs,
    pressBlockedMs: press?.blockedMs,
    // After the press: reports from before the live phase sampled it at `done`.
    endMemoryMb: growthMb(
      memory.baseline,
      'pressed' in memory ? memory.pressed : memory.done
    ),
    liveUpdatesShown: live?.updatesShown,
    liveStalenessMs: live?.stalenessMs,
    liveLagMedianMs: live?.lagMedianMs,
    liveLagMaxMs: live?.lagMaxMs,
    liveLastUpdateMs: live?.lastUpdateMs,
    liveBuilds: live?.builds,
    liveBlockedMs: live?.blockedMs,
    liveMaxGapMs: live?.maxGapMs,
    liveDroppedFrames: live?.droppedFrames,
    liveMemoryMb: live == null ? null : growthMb(memory.baseline, memory.done),
  }
}

/** One hook benchmark run's metrics, flat. */
function hookMetrics({ result }) {
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

const mapColumns = [
  ['count', 'Markers'],
  ['library', 'Library'],
  ['version', 'Version'],
  ['runs', 'Runs'],
  ['firstMarkersMs', 'First markers (ms)'],
  ['mountMaxGapMs', 'Longest JS freeze, mount (ms)'],
  ['mountMemoryMb', 'Memory after mount (+MB)'],
  ['rerenderBlockedMs', 'JS blocked, 10 re-renders (ms)'],
  ['rerenderMounts', 'Remounts, 10 re-renders'],
  ['rerenderMinMounted', 'Fewest on map, re-renders'],
  ['zoomBlockedMs', 'JS blocked, zoom (ms)'],
  ['zoom8Mounted', 'Markers rendered at zoom 8'],
  ['pressPointCount', 'Pressed cluster (points)'],
  ['pressRegionMs', 'Press to camera settled (ms)'],
  ['pressMaxGapMs', 'Longest JS freeze, press (ms)'],
]
const liveColumns = [
  ['count', 'Markers'],
  ['library', 'Library'],
  ['version', 'Version'],
  ['runs', 'Runs'],
  ['liveStalenessMs', 'Age of the map, mean (ms)'],
  ['liveUpdatesShown', 'Updates shown (of 100)'],
  ['liveLagMedianMs', 'Lag, median (ms)'],
  ['liveLagMaxMs', 'Lag, max (ms)'],
  ['liveLastUpdateMs', 'Last update shown after (ms)'],
  ['liveBuilds', 'Index builds'],
  ['liveBlockedMs', 'JS blocked, live (ms)'],
  ['liveMaxGapMs', 'Longest JS freeze, live (ms)'],
  ['liveDroppedFrames', 'Dropped JS frames, live'],
  ['liveMemoryMb', 'Memory after live (+MB)'],
]
const keyColumns = [
  ['count', 'Points'],
  ['library', 'Library'],
  ['version', 'Version'],
  ['runs', 'Runs'],
]
const buildColumns = [
  ...keyColumns,
  ['buildJsMs', 'Index build, JS blocked (ms)'],
  ['buildTotalMs', 'Index build, until queryable (ms)'],
  ['firstClustersMs', 'Mount to first clusters (ms)'],
  ['mountMaxGapMs', 'Longest JS freeze, mount (ms)'],
  ['mountBuilds', 'Index builds, mount'],
]
const afterMountColumns = [
  ...keyColumns,
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
/** What each flow `run.mjs` drives reports: its metrics and tables. */
const SUITES = {
  'flow.yaml': {
    metrics: mapMetrics,
    tables: [
      { columns: mapColumns },
      {
        title: 'Live updates',
        columns: liveColumns,
        include: (row) => row.liveUpdatesShown != null,
      },
    ],
  },
  'hook-flow.yaml': {
    metrics: hookMetrics,
    tables: [
      { columns: buildColumns },
      { title: 'After the mount', columns: afterMountColumns },
    ],
  },
}

const groups = new Map()
const devices = new Set()
for (const file of files) {
  const report = JSON.parse(readFileSync(file, 'utf8'))
  // Reports from before run.mjs recorded the flow ran flow.yaml.
  const flow = report.flow ?? 'flow.yaml'
  const suite = SUITES[flow]
  if (suite == null) {
    throw new Error(`${file}: no summary for flow ${flow}`)
  }
  devices.add(JSON.stringify(report.device))
  for (const run of report.runs) {
    if (run.result?.error != null) {
      continue
    }
    const key = `${flow}|${run.result.library}@${run.result.version}|${run.count}`
    const group = groups.get(key) ?? {
      flow,
      library: run.result.library,
      version: run.result.version,
      count: run.count,
      runs: [],
    }
    group.runs.push(suite.metrics(run))
    groups.set(key, group)
  }
}

const summaries = new Map()
for (const { flow, library, version, count, runs } of groups.values()) {
  const medians = {}
  for (const name of Object.keys(runs[0])) {
    const value = median(runs.map((run) => run[name]))
    medians[name] = value == null ? null : Math.round(value * 10) / 10
  }
  const rows = summaries.get(flow) ?? []
  rows.push({ library, version, count, runs: runs.length, ...medians })
  summaries.set(flow, rows)
}
const summary = []
for (const rows of summaries.values()) {
  rows.sort((a, b) => a.count - b.count || a.library.localeCompare(b.library))
  summary.push(...rows)
}

const table = (tableColumns, rows) => [
  `| ${tableColumns.map(([, title]) => title).join(' | ')} |`,
  `| ${tableColumns.map(() => '---').join(' | ')} |`,
  ...rows.map(
    (row) =>
      `| ${tableColumns.map(([key]) => (row[key] ?? '–').toLocaleString?.('en-US') ?? row[key]).join(' | ')} |`
  ),
]
console.log(`Devices: ${[...devices].join(', ')}\n`)
for (const [flow, rows] of summaries) {
  for (const { title, columns, include = () => true } of SUITES[flow].tables) {
    const tableRows = rows.filter(include)
    if (tableRows.length === 0) {
      continue
    }
    if (title != null) {
      console.log(`\n${title}:\n`)
    }
    console.log(table(columns, tableRows).join('\n'))
  }
}
if (jsonOut != null) {
  writeFileSync(
    jsonOut,
    `${JSON.stringify({ devices: [...devices].map((d) => JSON.parse(d)), summary }, null, 2)}\n`
  )
}
