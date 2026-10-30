import { memo, useEffect, useRef, useState } from 'react'
import { Dimensions, Platform, ScrollView, StyleSheet, Text } from 'react-native'
import type { Region } from 'react-native-maps'
import type { PointFeature } from 'react-native-better-clustering/geojson'
import { ControlPanel, ControlRow, StatusText } from '../components/Controls'
import {
  generatePoints,
  POLAND_BOUNDS,
  POLAND_REGION,
  regionAtZoom,
} from '../data'
import { Chip } from './BenchmarkScreen'
import {
  frameStats,
  medianFrameInterval,
  round,
  startFrameMonitor,
  type FrameMonitor,
} from './frameMonitor'
import {
  countHookBuilds,
  HOOK_LIBRARIES,
  hookBuilds,
  type HookLibrary,
  type HookLibraryId,
  type MapDimensions,
} from './hookLibraries'

const COUNTS = [10_000, 50_000, 100_000]
/** The seed `LargeDatasetScreen` and the map benchmark use: the same points across Poland. */
const SEED = 7
const IDLE_MS = 1000
/** Index builds timed outside React, after one that warms up. */
const ENGINE_BUILDS = 3
const RERENDERS = 10
const STEP_INTERVAL_MS = 500
const UPDATES = 5
const UPDATE_INTERVAL_MS = 1000
/** A step has settled once nothing committed and no frame was late for this long. */
const QUIET_MS = 300
const TIMEOUT_MS = 120_000

const { width, height } = Dimensions.get('window')
/** The map size every hook is given: a full-screen map. Module scope, so it never changes. */
const DIMENSIONS: MapDimensions = { width, height }

/** Into Kraków at zoom 8, then a third of the screen at a time east and back. */
const KRAKOW_AT_8 = regionAtZoom(50.0647, 19.945, 8)
const PAN_REGIONS: Region[] = [0, 1, 2, 3, 4, 5, 4, 3, 2, 1].map((thirds) => ({
  ...KRAKOW_AT_8,
  longitude:
    KRAKOW_AT_8.longitude + (thirds * KRAKOW_AT_8.longitudeDelta) / 3,
}))

type Phase =
  | 'setup'
  | 'ready'
  | 'building'
  | 'mounting'
  | 'rerendering'
  | 'panning'
  | 'updating'
  | 'done'
  | 'failed'

/** What the hook returned at the last commit, written by `HookProbe`. */
const probe = {
  committedAt: 0,
  firstClustersAt: null as number | null,
  /** When the hook last returned a different index object. */
  indexChangedAt: 0,
  features: [] as readonly unknown[],
  index: null as unknown,
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms))

async function waitUntil(condition: () => boolean, timeoutMs: number) {
  const deadline = performance.now() + timeoutMs
  while (!condition()) {
    if (performance.now() > deadline) {
      throw new Error('timed out')
    }
    await sleep(25)
  }
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

function toFeatures(count: number): PointFeature[] {
  return generatePoints(count, POLAND_BOUNDS, SEED).map((point) => ({
    type: 'Feature',
    properties: { id: point.id },
    geometry: { type: 'Point', coordinates: [point.longitude, point.latitude] },
  }))
}

/**
 * Calls one library's hook and records what it returns. Memoized, so it
 * renders only when the benchmark changes its data, region or `tick`.
 */
const HookProbe = memo(function HookProbe({
  library,
  data,
  region,
  tick,
}: {
  library: HookLibrary
  data: PointFeature[]
  region: Region
  tick: number
}) {
  const { features, index } = library.useClusters(data, DIMENSIONS, region)
  // Declared after the library's hook, so it runs after the hook's own
  // effects, and again after any render they cause.
  useEffect(() => {
    const now = performance.now()
    probe.committedAt = now
    if (index !== probe.index) {
      probe.indexChangedAt = now
    }
    if (probe.firstClustersAt == null && features.length > 0) {
      probe.firstClustersAt = now
    }
    probe.features = features
    probe.index = index
  })
  return (
    <StatusText testID="hook-features">
      Features: {features.length}, render {tick}
    </StatusText>
  )
})

interface Mounted {
  data: PointFeature[]
  region: Region
  tick: number
}

/**
 * The hook benchmark: one library's hook, one point count, no map. It measures
 * what clustering costs the JS thread, not rendering.
 *
 * 1. building: time index builds outside React
 * 2. mounting: mount the hook with every point over Poland
 * 3. rerendering: re-render it 10 times with the same props
 * 4. panning: change the region 10 times at zoom 8
 * 5. updating: move one point 5 times, each a new `data` array
 *
 * Results are JSON in `bench-result`; `example/bench/` runs it over Maestro.
 */
export function HookBenchmarkScreen() {
  const [libraryId, setLibraryId] = useState<HookLibraryId>('rnbc')
  const [count, setCount] = useState(COUNTS[1])
  const [phase, setPhase] = useState<Phase>('setup')
  const [mounted, setMounted] = useState<Mounted | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const monitorRef = useRef<FrameMonitor | null>(null)

  useEffect(() => () => monitorRef.current?.stop(), [])

  const library = HOOK_LIBRARIES[libraryId]

  const run = async () => {
    countHookBuilds()
    const monitor = startFrameMonitor()
    monitorRef.current = monitor
    const frames = monitor.frames
    let frameIntervalMs = 1000 / 60
    const statsSince = (start: number) =>
      frameStats(frames, start, performance.now(), frameIntervalMs)
    // Nothing committed and no frame later than 100 ms for `QUIET_MS`.
    const settle = () =>
      waitUntil(() => {
        let lastLongFrame = 0
        for (let index = frames.length - 1; index > 0; index -= 1) {
          if (frames[index] - frames[index - 1] > 100) {
            lastLongFrame = frames[index]
            break
          }
        }
        return (
          performance.now() - Math.max(probe.committedAt, lastLongFrame) >=
          QUIET_MS
        )
      }, TIMEOUT_MS)
    const update = (change: Partial<Mounted>) =>
      setMounted((current) => (current == null ? null : { ...current, ...change }))

    const results: Record<string, unknown> = {
      library: library.name,
      version: library.version,
      count,
      platform: Platform.OS,
      osVersion: String(Platform.Version),
      dimensions: DIMENSIONS,
    }
    try {
      const features = toFeatures(count)
      const idleStart = performance.now()
      setPhase('ready')
      await sleep(IDLE_MS)
      frameIntervalMs = medianFrameInterval(frames, idleStart, performance.now())
      results.frameIntervalMs = round(frameIntervalMs)

      // Index builds alone, as each hook starts them.
      setPhase('building')
      await sleep(100)
      await library.buildOnce(features)
      const builds = []
      for (let index = 0; index < ENGINE_BUILDS; index += 1) {
        await sleep(200)
        builds.push(await library.buildOnce(features))
      }
      results.engine = {
        jsMs: round(median(builds.map((build) => build.jsMs))),
        totalMs: round(median(builds.map((build) => build.totalMs))),
        builds: builds.map((build) => ({
          jsMs: round(build.jsMs),
          totalMs: round(build.totalMs),
        })),
      }
      await sleep(500)

      // Mount: from the update that hands the hook its points.
      hookBuilds.count = 0
      const mountStart = performance.now()
      setMounted({ data: features, region: POLAND_REGION, tick: 0 })
      setPhase('mounting')
      await waitUntil(() => probe.firstClustersAt != null, TIMEOUT_MS)
      await settle()
      results.mount = {
        firstClustersMs: round(probe.firstClustersAt! - mountStart),
        settledMs: round(probe.committedAt - mountStart),
        features: probe.features.length,
        builds: hookBuilds.count,
        ...statsSince(mountStart),
      }

      // Each step: from the update to the last commit it caused. A data
      // change waits for its own new index, so a slow build is not credited
      // to the next step.
      const step = async (
        change: Partial<Mounted>,
        intervalMs: number,
        newIndex = false
      ) => {
        const start = performance.now()
        update(change)
        await sleep(intervalMs)
        if (newIndex) {
          await waitUntil(() => probe.indexChangedAt > start, TIMEOUT_MS)
        }
        await settle()
        return {
          updatedMs: round(Math.max(0, probe.committedAt - start)),
          indexMs:
            probe.indexChangedAt > start
              ? round(probe.indexChangedAt - start)
              : null,
          features: probe.features.length,
        }
      }

      // Re-renders with the same props, as a parent's state change causes.
      setPhase('rerendering')
      hookBuilds.count = 0
      const rerenderStart = performance.now()
      const rerenders = []
      for (let tick = 1; tick <= RERENDERS; tick += 1) {
        rerenders.push(await step({ tick }, STEP_INTERVAL_MS))
      }
      results.rerender = {
        renderMs: median(rerenders.map((entry) => entry.updatedMs)),
        builds: hookBuilds.count,
        ...statsSince(rerenderStart),
        steps: rerenders,
      }

      // Region changes, as onRegionChangeComplete sends them.
      setPhase('panning')
      hookBuilds.count = 0
      const panStart = performance.now()
      const pans = []
      for (const region of PAN_REGIONS) {
        pans.push(await step({ region }, STEP_INTERVAL_MS))
      }
      results.pan = {
        updatedMs: median(pans.map((entry) => entry.updatedMs)),
        builds: hookBuilds.count,
        ...statsSince(panStart),
        steps: pans,
      }

      // Data changes: one point moves, in a new array, as a feed delivers it.
      setPhase('updating')
      hookBuilds.count = 0
      const updateStart = performance.now()
      const updates = []
      const [first, ...rest] = features
      const [longitude, latitude] = first.geometry.coordinates
      for (let index = 1; index <= UPDATES; index += 1) {
        const moved: PointFeature = {
          ...first,
          geometry: {
            type: 'Point',
            coordinates: [longitude + index * 0.01, latitude],
          },
        }
        updates.push(
          await step({ data: [moved, ...rest] }, UPDATE_INTERVAL_MS, true)
        )
      }
      const indexMs = updates
        .map((entry) => entry.indexMs)
        .filter((value) => value != null)
      results.update = {
        indexMs: indexMs.length === UPDATES ? median(indexMs) : null,
        builds: hookBuilds.count,
        ...statsSince(updateStart),
        steps: updates,
      }

      setPhase('done')
    } catch (error) {
      results.error = error instanceof Error ? error.message : String(error)
      setPhase('failed')
    } finally {
      monitor.stop()
      setResult(JSON.stringify(results))
    }
  }

  if (phase === 'setup') {
    return (
      <ControlPanel>
        <Text style={styles.heading}>Library</Text>
        <ControlRow>
          {Object.values(HOOK_LIBRARIES).map((option) => (
            <Chip
              key={option.id}
              label={`${option.name} ${option.version}`}
              onPress={() => setLibraryId(option.id)}
              selected={option.id === libraryId}
              testID={`bench-lib-${option.id}`}
            />
          ))}
        </ControlRow>
        <Text style={styles.heading}>Points</Text>
        <ControlRow>
          {COUNTS.map((option) => (
            <Chip
              key={option}
              label={option.toLocaleString('en-US')}
              onPress={() => setCount(option)}
              selected={option === count}
              testID={`bench-count-${option}`}
            />
          ))}
        </ControlRow>
        <ControlRow>
          <Chip
            label="Start"
            onPress={() => void run()}
            selected
            testID="bench-start"
          />
        </ControlRow>
      </ControlPanel>
    )
  }

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.heading} testID="bench-library">
        {library.name} {library.version}, {count.toLocaleString('en-US')} points
      </Text>
      <StatusText testID="bench-phase">Phase: {phase}</StatusText>
      {mounted != null ? (
        <HookProbe
          data={mounted.data}
          library={library}
          region={mounted.region}
          tick={mounted.tick}
        />
      ) : null}
      {result != null ? (
        <Text selectable style={styles.result} testID="bench-result">
          {result}
        </Text>
      ) : null}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  content: {
    gap: 8,
    padding: 16,
  },
  heading: {
    color: '#111827',
    fontSize: 15,
    fontWeight: '600',
  },
  result: {
    color: '#111827',
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
    fontSize: 9,
  },
})
