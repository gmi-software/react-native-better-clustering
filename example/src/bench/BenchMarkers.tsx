import { useEffect, useRef } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { Marker, type MapMarkerProps } from 'react-native-maps'
import type { BenchClusterProps } from './libraries'

/**
 * Mounts of the benchmark's markers and cluster bubbles, written from effects.
 * Both libraries render the same two components, so these count the same
 * thing for each: what reached the map, and when.
 */
export const benchCounters = {
  markerMounts: 0,
  clusterMounts: 0,
  /** Markers and bubbles mounted right now. */
  mounted: 0,
  /** The fewest mounted since the last reset: 0 means the map went blank. */
  minMounted: 0,
  /** When the first marker or bubble mounted since the last reset. */
  firstMountAt: null as number | null,
  /** When a marker or bubble last mounted or unmounted. */
  lastActivityAt: 0,
}

/** Mounted bubbles' latest props, so the benchmark can press the largest one. */
export const mountedClusters = new Set<{ current: BenchClusterProps }>()

export function resetBenchCounters(): void {
  benchCounters.markerMounts = 0
  benchCounters.clusterMounts = 0
  benchCounters.minMounted = benchCounters.mounted
  benchCounters.firstMountAt = null
  benchCounters.lastActivityAt = performance.now()
}

function recordMount(kind: 'marker' | 'cluster'): () => void {
  const now = performance.now()
  if (kind === 'marker') {
    benchCounters.markerMounts += 1
  } else {
    benchCounters.clusterMounts += 1
  }
  benchCounters.mounted += 1
  benchCounters.firstMountAt ??= now
  benchCounters.lastActivityAt = now
  return () => {
    benchCounters.mounted -= 1
    benchCounters.minMounted = Math.min(
      benchCounters.minMounted,
      benchCounters.mounted
    )
    benchCounters.lastActivityAt = performance.now()
  }
}

/** A plain `Marker` that counts its mounts. */
export function BenchMarker(props: MapMarkerProps) {
  useEffect(() => recordMount('marker'), [])
  return <Marker {...props} tracksViewChanges={false} />
}

/** When each update of the live phase first reached the map. */
export const liveShown = new Map<number, number>()

/**
 * A vehicle of the live phase, at its position in update `update`. For a
 * point, both libraries render the marker element they were handed with it,
 * so a vehicle renders the update its library's index holds; the first
 * render of an update is when the map showed it.
 */
export function BenchVehicle({
  update,
  ...props
}: MapMarkerProps & { update: number }) {
  useEffect(() => recordMount('marker'), [])
  useEffect(() => {
    if (!liveShown.has(update)) {
      liveShown.set(update, performance.now())
    }
  }, [update])
  return <Marker {...props} pinColor="#16A34A" tracksViewChanges={false} />
}

/** Index builds since the last reset: see {@linkcode createBuildCounterRef}. */
export const benchBuilds = { count: 0 }

/**
 * A `superClusterRef` that counts index builds. Both libraries assign it a new
 * index object each time they build one. react-native-better-clustering
 * assigns an unloaded placeholder before its first build, which is not one.
 */
export function createBuildCounterRef(): { current: unknown } {
  const seen = new WeakSet<object>()
  let current: unknown = null
  return {
    get current() {
      return current
    },
    set current(next: unknown) {
      if (
        typeof next === 'object' &&
        next != null &&
        (next as { isLoaded?: boolean }).isLoaded !== false &&
        !seen.has(next)
      ) {
        seen.add(next)
        benchBuilds.count += 1
      }
      current = next
    },
  }
}

/**
 * The bubble both libraries draw through `renderCluster`, so neither is
 * measured with its own default bubble (one fades in with Reanimated, the
 * other animates with LayoutAnimation on iOS).
 */
export function BenchCluster({ cluster }: { cluster: BenchClusterProps }) {
  // Libraries pass a new props object on every render: count mounts, not renders.
  const latestRef = useRef(cluster)
  useEffect(() => {
    latestRef.current = cluster
  })
  useEffect(() => {
    mountedClusters.add(latestRef)
    const unmount = recordMount('cluster')
    return () => {
      mountedClusters.delete(latestRef)
      unmount()
    }
  }, [])

  const [longitude, latitude] = cluster.geometry.coordinates
  const count = cluster.properties.point_count
  return (
    <Marker
      coordinate={{ latitude, longitude }}
      onPress={cluster.onPress}
      tracksViewChanges={false}
    >
      <View style={styles.bubble}>
        <Text style={styles.count}>{abbreviate(count)}</Text>
      </View>
    </Marker>
  )
}

/** As the README of react-native-map-clustering keys its custom clusters. */
export function renderBenchCluster(cluster: BenchClusterProps) {
  return <BenchCluster key={`cluster-${cluster.id}`} cluster={cluster} />
}

function abbreviate(count: number): string {
  return count >= 1000 ? `${Math.round(count / 100) / 10}k` : String(count)
}

const styles = StyleSheet.create({
  bubble: {
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 36,
    height: 36,
    paddingHorizontal: 6,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    backgroundColor: '#0F52FF',
  },
  count: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
})
