import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import type { Region } from 'react-native-maps'
import { ControlPanel, ControlRow, StatusText } from '../components/Controls'
import { useSetHudHidden } from '../hud/HudVisibility'
import {
  generatePoints,
  pointAt,
  POLAND_BOUNDS,
  POLAND_REGION,
  regionAtZoom,
  type MapPoint,
} from '../data'
import {
  BenchMarker,
  benchBuilds,
  benchCounters,
  BenchVehicle,
  createBuildCounterRef,
  liveShown,
  mountedClusters,
  renderBenchCluster,
  resetBenchCounters,
} from './BenchMarkers'
import {
  frameStats,
  medianFrameInterval,
  round,
  startFrameMonitor,
  type FrameMonitor,
} from './frameMonitor'
import {
  BENCH_LIBRARIES,
  type BenchClusterProps,
  type BenchLibrary,
  type BenchLibraryId,
} from './libraries'

const COUNTS = [10_000, 50_000, 100_000]
/** The seed `LargeDatasetScreen` uses: the same markers across Poland. */
const SEED = 7
const IDLE_MS = 1000
const QUIET_MS = 1000
const MOUNT_TIMEOUT_MS = 120_000
const RERENDERS = 10
const RERENDER_INTERVAL_MS = 500
const REGION_TIMEOUT_MS = 15_000

/** Into Kraków and back out: clusters split into markers and merge again. */
const KRAKOW = { latitude: 50.0647, longitude: 19.945 }
const ZOOM_STEPS: Array<{ zoom: number; region: Region }> = [
  ...[8, 10, 12, 14, 10].map((zoom) => ({
    zoom,
    region: regionAtZoom(KRAKOW.latitude, KRAKOW.longitude, zoom),
  })),
  { zoom: 6, region: POLAND_REGION },
]

/**
 * The live phase: vehicles that move on a fixed schedule over the static
 * markers, as a feed would move them, seen at a street-level zoom.
 */
const LIVE_ZOOM = 12
const LIVE_VEHICLES = 20
const LIVE_RATE_HZ = 10
const LIVE_UPDATES = 100
const LIVE_INTERVAL_MS = 1000 / LIVE_RATE_HZ
/** How long the map may take to show the last update. */
const LIVE_TIMEOUT_MS = 60_000
/** Vehicles drive loops of this radius at most, in degrees of latitude. */
const LIVE_LOOP_RADIUS = 0.01
/** Where loops are centred, around Kraków, so every vehicle stays in view. */
const LIVE_LOOP_CENTRES = {
  minLat: KRAKOW.latitude - 0.02,
  maxLat: KRAKOW.latitude + 0.02,
  minLng: KRAKOW.longitude - 0.02,
  maxLng: KRAKOW.longitude + 0.02,
}
const LIVE_SEED = 13
/** `pointAt` over this gives two seeded numbers in [0, 1). */
const UNIT = { minLat: 0, maxLat: 1, minLng: 0, maxLng: 1 }

/** Where vehicle `index` is at `update`: on a loop of its own, in and out of clusters. */
function vehicleAt(index: number, update: number): MapPoint {
  const centre = pointAt(LIVE_LOOP_CENTRES, LIVE_SEED, index)
  const shape = pointAt(UNIT, LIVE_SEED + 1, index)
  const radius = LIVE_LOOP_RADIUS * (0.4 + 0.6 * shape.latitude)
  const loopUpdates = 40 + Math.round(80 * shape.longitude)
  const direction = index % 2 === 0 ? 1 : -1
  const angle =
    2 * Math.PI * (shape.latitude + (direction * update) / loopUpdates)
  return {
    id: `vehicle-${index}`,
    latitude: centre.latitude + radius * Math.sin(angle),
    longitude:
      centre.longitude +
      (radius * Math.cos(angle)) / Math.cos((KRAKOW.latitude * Math.PI) / 180),
  }
}


type Phase =
  | 'setup'
  | 'ready'
  | 'mounting'
  | 'mounted'
  | 'rerendering'
  | 'rerendered'
  | 'zooming'
  | 'pressed'
  | 'live'
  | 'done'
  | 'failed'

/** Phases that wait for `bench-next`, so a host script can sample memory first. */
const WAITING: Phase[] = ['ready', 'mounted', 'rerendered', 'pressed']

interface MapHandle {
  animateToRegion(region: Region, duration?: number): void
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms))

async function waitUntil(condition: () => boolean, timeoutMs: number) {
  const deadline = performance.now() + timeoutMs
  while (!condition()) {
    if (performance.now() > deadline) {
      throw new Error('timed out')
    }
    await sleep(50)
  }
}

/** Hermes' heap statistics, in release builds too. */
function jsHeap(): { heapBytes: number; allocatedBytes: number } | null {
  const hermes = (
    globalThis as {
      HermesInternal?: {
        getInstrumentedStats?: () => Record<string, number>
      }
    }
  ).HermesInternal
  const stats = hermes?.getInstrumentedStats?.()
  return stats == null
    ? null
    : {
        heapBytes: stats.js_heapSize,
        allocatedBytes: stats.js_allocatedBytes,
      }
}

/**
 * The map under test. Memoized so only `tick` and `liveUpdate` re-render it:
 * any other parent update would hand both libraries new children and start a
 * rebuild.
 */
const BenchMap = memo(function BenchMap({
  library,
  points,
  tick,
  liveUpdate,
  buildCounterRef,
  onMap,
  onRegionChangeComplete,
}: {
  library: BenchLibrary
  points: MapPoint[]
  tick: number
  /** The live phase's latest update, or null before it: no vehicles. */
  liveUpdate: number | null
  buildCounterRef: { current: unknown }
  onMap: (map: unknown) => void
  onRegionChangeComplete: (region: Region) => void
}) {
  const { MapView } = library
  // Inline children, as apps write them: new elements on every re-render of
  // the parent (`tick`). Live updates keep them, as an app that only moves
  // its vehicles keeps the elements of the markers that did not change;
  // recreating them costs what a re-render costs, which its phase measures.
  const markers = useMemo(
    () =>
      points.map((point) => (
        <BenchMarker
          key={point.id}
          coordinate={{ latitude: point.latitude, longitude: point.longitude }}
        />
      )),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [points, tick]
  )
  return (
    <MapView
      initialRegion={POLAND_REGION}
      mapRef={onMap}
      onRegionChangeComplete={onRegionChangeComplete}
      renderCluster={renderBenchCluster}
      style={styles.map}
      superClusterRef={buildCounterRef}
    >
      {markers}
      {liveUpdate == null
        ? null
        : Array.from({ length: LIVE_VEHICLES }, (_, index) => {
            const vehicle = vehicleAt(index, liveUpdate)
            return (
              <BenchVehicle
                key={vehicle.id}
                coordinate={{
                  latitude: vehicle.latitude,
                  longitude: vehicle.longitude,
                }}
                update={liveUpdate}
              />
            )
          })}
    </MapView>
  )
})

/** Time since the run started, redrawn on every JS frame: it stops when JS does. */
function JsClock({
  startedAt,
  large,
}: {
  startedAt: number
  large: boolean
}) {
  const [now, setNow] = useState(startedAt)
  useEffect(() => {
    let frameId = requestAnimationFrame(function onFrame() {
      setNow(performance.now())
      frameId = requestAnimationFrame(onFrame)
    })
    return () => cancelAnimationFrame(frameId)
  }, [])
  return (
    <Text style={[styles.clock, large && styles.clockLarge]} testID="bench-clock">
      {(Math.max(0, now - startedAt) / 1000).toFixed(2)} s
    </Text>
  )
}

/**
 * The device benchmark: one library, one marker count, one scripted run.
 *
 * 1. ready: points generated, map not mounted (waits for `bench-next`)
 * 2. mounting: mount the map with every marker until markers settle
 * 3. rerendering: re-render the parent at 2 Hz with the same markers
 * 4. zooming: jump into Kraków and back, then press the largest cluster
 * 5. live: at street level in Kraków, move vehicles over the markers at 10 Hz
 *
 * Results are JSON in `bench-result`; `example/bench/` runs it over Maestro.
 */
export function BenchmarkScreen() {
  const [libraryId, setLibraryId] = useState<BenchLibraryId>('rnbc')
  const [count, setCount] = useState(COUNTS[1])
  const [phase, setPhase] = useState<Phase>('setup')
  const [points, setPoints] = useState<MapPoint[] | null>(null)
  const [mapMounted, setMapMounted] = useState(false)
  const [tick, setTick] = useState(0)
  const [liveUpdate, setLiveUpdate] = useState<number | null>(null)
  const [buildCounterRef] = useState(createBuildCounterRef)
  const [startedAt, setStartedAt] = useState(0)
  const [result, setResult] = useState<string | null>(null)
  // For screen recordings: no dev HUD, a larger clock that restarts at mount.
  const [recording, setRecording] = useState(false)
  const setHudHidden = useSetHudHidden()

  const mapRef = useRef<MapHandle | null>(null)
  const nextRef = useRef<(() => void) | null>(null)
  const regionWaiterRef = useRef<(() => void) | null>(null)
  const monitorRef = useRef<FrameMonitor | null>(null)

  useEffect(() => () => monitorRef.current?.stop(), [])

  const onMap = useCallback((map: unknown) => {
    mapRef.current = map as MapHandle | null
  }, [])

  const onRegionChangeComplete = useCallback(() => {
    regionWaiterRef.current?.()
  }, [])

  const library = BENCH_LIBRARIES[libraryId]

  const run = async () => {
    const monitor = startFrameMonitor()
    monitorRef.current = monitor
    const frames = monitor.frames
    const waitForNext = (next: Phase) => {
      setPhase(next)
      return new Promise<void>((resolve) => {
        nextRef.current = resolve
      })
    }
    // No mount, unmount or long frame for `QUIET_MS`.
    const waitForQuiet = () =>
      waitUntil(() => {
        const now = performance.now()
        let lastLongFrame = 0
        for (let index = frames.length - 1; index > 0; index -= 1) {
          if (frames[index] - frames[index - 1] > 100) {
            lastLongFrame = frames[index]
            break
          }
        }
        return (
          now - Math.max(benchCounters.lastActivityAt, lastLongFrame) >=
          QUIET_MS
        )
      }, MOUNT_TIMEOUT_MS)
    let frameIntervalMs = 1000 / 60
    const statsSince = (start: number) =>
      frameStats(frames, start, performance.now(), frameIntervalMs)
    const counters = () => ({
      markerMounts: benchCounters.markerMounts,
      clusterMounts: benchCounters.clusterMounts,
      mounted: benchCounters.mounted,
      minMounted: benchCounters.minMounted,
    })

    const results: Record<string, unknown> = {
      library: library.name,
      version: library.version,
      count,
      platform: Platform.OS,
      osVersion: String(Platform.Version),
    }
    try {
      const generated = generatePoints(count, POLAND_BOUNDS, SEED)
      setPoints(generated)
      const idleStart = performance.now()
      setStartedAt(idleStart)
      setPhase('ready')
      await sleep(IDLE_MS)
      frameIntervalMs = medianFrameInterval(
        frames,
        idleStart,
        performance.now()
      )
      results.frameIntervalMs = round(frameIntervalMs)
      results.baseline = { jsHeap: jsHeap() }
      await waitForNext('ready')

      if (recording) {
        // Draw the clock at 0.00 s before the mount, so a freeze shows on it.
        setStartedAt(performance.now())
        await new Promise((resolve) => requestAnimationFrame(resolve))
        await new Promise((resolve) => requestAnimationFrame(resolve))
      }

      // Mount: from the render that hands the library its markers.
      resetBenchCounters()
      const mountStart = performance.now()
      setMapMounted(true)
      setPhase('mounting')
      await waitUntil(
        () => benchCounters.firstMountAt != null,
        MOUNT_TIMEOUT_MS
      )
      await waitForQuiet()
      results.mount = {
        firstMarkersMs: round(benchCounters.firstMountAt! - mountStart),
        settledMs: round(benchCounters.lastActivityAt - mountStart),
        ...counters(),
        ...statsSince(mountStart),
        jsHeap: jsHeap(),
      }
      await waitForNext('mounted')

      // Parent re-renders with the same markers, as a clock or a selection does.
      resetBenchCounters()
      const rerenderStart = performance.now()
      setPhase('rerendering')
      for (let index = 1; index <= RERENDERS; index += 1) {
        setTick(index)
        await sleep(RERENDER_INTERVAL_MS)
      }
      await waitForQuiet()
      results.rerender = {
        rerenders: RERENDERS,
        durationMs: round(performance.now() - rerenderStart),
        ...counters(),
        ...statsSince(rerenderStart),
        jsHeap: jsHeap(),
      }
      await waitForNext('rerendered')

      // Camera jumps: each step from the jump to the last marker update.
      setPhase('zooming')
      resetBenchCounters()
      const zoomStart = performance.now()
      const steps = []
      for (const { zoom, region } of ZOOM_STEPS) {
        const stepStart = performance.now()
        resetBenchCounters()
        const settled = new Promise<void>((resolve) => {
          regionWaiterRef.current = resolve
        })
        mapRef.current?.animateToRegion(region, 0)
        await Promise.race([settled, sleep(REGION_TIMEOUT_MS)])
        const regionMs = performance.now() - stepStart
        regionWaiterRef.current = null
        await waitForQuiet()
        steps.push({
          zoom,
          regionMs: round(regionMs),
          updatedMs: round(
            Math.max(regionMs, benchCounters.lastActivityAt - stepStart)
          ),
          ...counters(),
          ...statsSince(stepStart),
        })
      }
      results.zoom = { steps, ...statsSince(zoomStart) }

      // Press the largest cluster, as a person would on the overview.
      let largest: { current: BenchClusterProps } | null = null
      for (const cluster of mountedClusters) {
        if (
          largest == null ||
          cluster.current.properties.point_count >
            largest.current.properties.point_count
        ) {
          largest = cluster
        }
      }
      if (largest != null) {
        resetBenchCounters()
        const pressStart = performance.now()
        const pointCount = largest.current.properties.point_count
        const settled = new Promise<void>((resolve) => {
          regionWaiterRef.current = resolve
        })
        largest.current.onPress()
        await Promise.race([settled, sleep(REGION_TIMEOUT_MS)])
        const regionMs = performance.now() - pressStart
        regionWaiterRef.current = null
        await waitForQuiet()
        results.press = {
          pointCount,
          regionMs: round(regionMs),
          ...counters(),
          ...statsSince(pressStart),
        }
      }
      await waitForNext('pressed')

      // Live updates on a fixed schedule: update n is due `n - 1` intervals
      // after the start. A late timer sends the newest update due and skips
      // the ones before it, as a feed whose newest position wins would.
      setPhase('live')
      const settledAtKrakow = new Promise<void>((resolve) => {
        regionWaiterRef.current = resolve
      })
      mapRef.current?.animateToRegion(
        regionAtZoom(KRAKOW.latitude, KRAKOW.longitude, LIVE_ZOOM),
        0
      )
      await Promise.race([settledAtKrakow, sleep(REGION_TIMEOUT_MS)])
      regionWaiterRef.current = null
      await waitForQuiet()
      liveShown.clear()
      benchBuilds.count = 0
      resetBenchCounters()
      const liveStart = performance.now()
      const dueAt = (update: number) =>
        liveStart + (update - 1) * LIVE_INTERVAL_MS
      let sent = 0
      let updatesSent = 0
      while (sent < LIVE_UPDATES) {
        const due = Math.min(
          LIVE_UPDATES,
          Math.floor((performance.now() - liveStart) / LIVE_INTERVAL_MS) + 1
        )
        if (due > sent) {
          sent = due
          updatesSent += 1
          setLiveUpdate(due)
        }
        await sleep(Math.max(0, dueAt(sent + 1) - performance.now()))
      }
      const lastShown = await waitUntil(
        () => liveShown.has(LIVE_UPDATES),
        LIVE_TIMEOUT_MS
      ).then(
        () => true,
        () => false
      )
      const liveEnd = liveShown.get(LIVE_UPDATES) ?? performance.now()
      await waitForQuiet()
      // How old what the map showed was, on average over the phase: at each
      // moment, the time since the update on the map was due (since the
      // first was due, before it shows any). A library that shows few
      // updates shows old ones in between, which a lag per update misses.
      let staleArea = 0
      let showing = 1
      let since = liveStart
      const ageArea = (from: number, to: number) =>
        ((from - dueAt(showing) + (to - dueAt(showing))) / 2) * (to - from)
      const shownInOrder = [...liveShown].sort((a, b) => a[1] - b[1])
      for (const [update, shownAt] of shownInOrder) {
        if (shownAt > liveEnd) break
        staleArea += ageArea(since, shownAt)
        showing = Math.max(showing, update)
        since = shownAt
      }
      staleArea += ageArea(since, liveEnd)
      // From when each update was due to when the map first showed it.
      const lags = [...liveShown]
        .map(([update, shownAt]) => shownAt - dueAt(update))
        .sort((a, b) => a - b)
      results.live = {
        vehicles: LIVE_VEHICLES,
        rateHz: LIVE_RATE_HZ,
        zoom: LIVE_ZOOM,
        updates: LIVE_UPDATES,
        updatesSent,
        updatesShown: liveShown.size,
        stalenessMs: round(staleArea / (liveEnd - liveStart)),
        lagMedianMs:
          lags.length === 0 ? null : round(lags[Math.floor(lags.length / 2)]),
        lagMaxMs: lags.length === 0 ? null : round(lags[lags.length - 1]),
        lastUpdateMs: lastShown
          ? round(liveShown.get(LIVE_UPDATES)! - dueAt(LIVE_UPDATES))
          : null,
        builds: benchBuilds.count,
        ...counters(),
        ...statsSince(liveStart),
      }

      results.jsHeap = jsHeap()
      setResult(JSON.stringify(results))
      setPhase('done')
    } catch (error) {
      results.error = String(error)
      setResult(JSON.stringify(results))
      setPhase('failed')
    } finally {
      monitor.stop()
    }
  }

  if (phase === 'setup') {
    return (
      <ControlPanel>
        <Text style={styles.heading}>Library</Text>
        <ControlRow>
          {Object.values(BENCH_LIBRARIES).map((option) => (
            <Chip
              key={option.id}
              label={`${option.name} ${option.version}`}
              onPress={() => setLibraryId(option.id)}
              selected={option.id === libraryId}
              testID={`bench-lib-${option.id}`}
            />
          ))}
        </ControlRow>
        <Text style={styles.heading}>Markers</Text>
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
            label="Recording look"
            onPress={() => {
              setRecording(!recording)
              setHudHidden(!recording)
            }}
            selected={recording}
            testID="bench-recording"
          />
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
    <>
      <View style={styles.mapArea}>
        {mapMounted && points != null ? (
          <BenchMap
            buildCounterRef={buildCounterRef}
            library={library}
            liveUpdate={liveUpdate}
            onMap={onMap}
            onRegionChangeComplete={onRegionChangeComplete}
            points={points}
            tick={tick}
          />
        ) : null}
        <View
          style={[styles.overlay, recording && styles.overlayLarge]}
          pointerEvents="none"
        >
          <Text
            style={[styles.overlayTitle, recording && styles.overlayTitleLarge]}
            testID="bench-library"
          >
            {library.name} {library.version}
          </Text>
          <Text
            style={[styles.overlayLine, recording && styles.overlayLineLarge]}
          >
            {count.toLocaleString('en-US')} markers
          </Text>
          <JsClock large={recording} startedAt={startedAt} />
        </View>
      </View>
      <ControlPanel>
        <ControlRow>
          <StatusText testID="bench-phase">Phase: {phase}</StatusText>
          {WAITING.includes(phase) ? (
            <Chip
              label="Next"
              onPress={() => nextRef.current?.()}
              selected
              testID="bench-next"
            />
          ) : null}
        </ControlRow>
        {result != null ? (
          <Text selectable style={styles.result} testID="bench-result">
            {result}
          </Text>
        ) : null}
      </ControlPanel>
    </>
  )
}

function Chip({
  label,
  selected,
  onPress,
  testID,
}: {
  label: string
  selected: boolean
  onPress: () => void
  testID: string
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.chip, selected && styles.chipSelected]}
      testID={testID}
    >
      <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>
        {label}
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  mapArea: {
    flex: 1,
  },
  map: {
    flex: 1,
  },
  heading: {
    color: '#111827',
    fontSize: 15,
    fontWeight: '600',
  },
  overlay: {
    position: 'absolute',
    top: 8,
    left: 8,
    padding: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(17, 24, 39, 0.82)',
  },
  overlayTitle: {
    color: '#F9FAFB',
    fontSize: 12,
    fontWeight: '600',
  },
  overlayLine: {
    color: '#F9FAFB',
    fontSize: 12,
  },
  clock: {
    color: '#F9FAFB',
    fontSize: 20,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  overlayLarge: {
    right: 8,
    padding: 14,
    borderRadius: 14,
  },
  overlayTitleLarge: {
    fontSize: 15,
  },
  overlayLineLarge: {
    fontSize: 15,
  },
  clockLarge: {
    fontSize: 44,
  },
  result: {
    color: '#111827',
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
    fontSize: 9,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#9CA3AF',
  },
  chipSelected: {
    borderColor: '#0F52FF',
    backgroundColor: '#0F52FF',
  },
  chipLabel: {
    color: '#111827',
    fontSize: 14,
  },
  chipLabelSelected: {
    color: '#FFFFFF',
  },
})
