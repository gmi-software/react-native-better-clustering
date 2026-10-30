#!/usr/bin/env node
// Summarizes reports from run.mjs: the median of every metric per library,
// version and marker count, as a Markdown table and as JSON.
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

/** One run's metrics, flat. */
function metrics({ memory, result }) {
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

const columns = [
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
const table = (tableColumns, rows) => [
  `| ${tableColumns.map(([, title]) => title).join(' | ')} |`,
  `| ${tableColumns.map(() => '---').join(' | ')} |`,
  ...rows.map(
    (row) =>
      `| ${tableColumns.map(([key]) => (row[key] ?? '–').toLocaleString?.('en-US') ?? row[key]).join(' | ')} |`
  ),
]
console.log(`Devices: ${[...devices].join(', ')}\n`)
console.log(table(columns, summary).join('\n'))
const liveRows = summary.filter((row) => row.liveUpdatesShown != null)
if (liveRows.length > 0) {
  console.log(`\nLive updates:\n`)
  console.log(table(liveColumns, liveRows).join('\n'))
}
if (jsonOut != null) {
  writeFileSync(
    jsonOut,
    `${JSON.stringify({ devices: [...devices].map((d) => JSON.parse(d)), summary }, null, 2)}\n`
  )
}
