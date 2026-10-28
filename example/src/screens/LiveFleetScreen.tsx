import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from 'react'
import { StyleSheet } from 'react-native'
import type { MapMarkerProps } from 'react-native-maps'
import MapView from 'react-native-better-clustering'
import {
  isClusterFeature,
  type ClusterFeature,
  type PointFeature,
} from 'react-native-better-clustering/geojson'
import {
  ActionButton,
  ControlPanel,
  ControlRow,
  StatusText,
  Toggle,
} from '../components/Controls'
import {
  generatePoints,
  KRAKOW_BOUNDS,
  KRAKOW_REGION,
  pointAt,
  type Bounds,
  type MapPoint,
} from '../data'
import { CountedMarker } from '../hud/CountedMarker'
import {
  recordFleetUpdate,
  recordIndexLag,
  recordStaticMarkerMount,
  stats,
} from '../hud/stats'
import { useEngineBuildCounter } from '../hud/useEngineBuildCounter'

const STATIC_SEED = 11
const VEHICLE_SEED = 12
const STATIC_COUNTS = [1_000, 10_000, 50_000]
const RATES_HZ = [1, 4, 10]
const VEHICLE_COUNT = 20
const SAMPLE_INTERVAL_MS = 500

/** Largest loop a vehicle drives, in degrees of latitude. */
const MAX_LOOP_RADIUS = 0.02

/** Where loops are centred: inside the static points by a loop's radius. */
const LOOP_CENTRES: Bounds = {
  minLat: KRAKOW_BOUNDS.minLat + MAX_LOOP_RADIUS,
  maxLat: KRAKOW_BOUNDS.maxLat - MAX_LOOP_RADIUS,
  minLng: KRAKOW_BOUNDS.minLng + MAX_LOOP_RADIUS * 1.6,
  maxLng: KRAKOW_BOUNDS.maxLng - MAX_LOOP_RADIUS * 1.6,
}

/** `pointAt` over this gives two seeded numbers in [0, 1). */
const UNIT: Bounds = { minLat: 0, maxLat: 1, minLng: 0, maxLng: 1 }

/**
 * The probe's loop around the static points, in degrees. Far enough from them
 * to stay out of every cluster at the initial region, which always shows it.
 */
const PROBE_RADIUS_LAT = 0.11
const PROBE_RADIUS_LNG = 0.14
const PROBE_LOOP_UPDATES = 200

/**
 * Where vehicle `index` is at `update`. Vehicle 0 is the probe, which loops
 * around the city; the others loop through it, in and out of clusters.
 */
function vehicleAt(index: number, update: number): MapPoint {
  const { latitude, longitude } = KRAKOW_REGION
  if (index === 0) {
    const angle = (2 * Math.PI * update) / PROBE_LOOP_UPDATES
    return {
      id: 'vehicle-0',
      latitude: latitude + PROBE_RADIUS_LAT * Math.sin(angle),
      longitude: longitude + PROBE_RADIUS_LNG * Math.cos(angle),
    }
  }
  const centre = pointAt(LOOP_CENTRES, VEHICLE_SEED, index)
  const shape = pointAt(UNIT, VEHICLE_SEED + 1, index)
  const radius = MAX_LOOP_RADIUS * (0.4 + 0.6 * shape.latitude)
  const loopUpdates = 40 + Math.round(80 * shape.longitude)
  const direction = index % 2 === 0 ? 1 : -1
  const angle =
    2 * Math.PI * (shape.latitude + (direction * update) / loopUpdates)
  return {
    id: `vehicle-${index}`,
    latitude: centre.latitude + radius * Math.sin(angle),
    longitude:
      centre.longitude +
      (radius * Math.cos(angle)) / Math.cos((latitude * Math.PI) / 180),
  }
}

/** A marker that never moves, counted apart from the vehicles. */
function StaticMarker(props: MapMarkerProps) {
  useEffect(() => recordStaticMarkerMount(), [])
  return <CountedMarker {...props} />
}

/**
 * A vehicle. `MapView` reads `cluster` and keeps the other marker props on
 * the features it reports, so `update` tells `onMarkersChange` which update
 * the index holds. Neither is a `react-native-maps` prop.
 */
function VehicleMarker({
  cluster: _cluster,
  update: _update,
  ...props
}: MapMarkerProps & { cluster: boolean; update: number }) {
  return <CountedMarker {...props} />
}

interface FleetSample {
  updates: number
  staticMarkerMounts: number
  indexLagMs: number | null
  maxIndexLagMs: number | null
  /** Updates sent that the index does not hold yet; `null` before it holds one. */
  behind: number | null
}

/**
 * The scenario's numbers, sampled like the HUD, so they never re-render the
 * map. Reset with the HUD's counters.
 */
function FleetStatus({
  sentRef,
  onMapRef,
  unclustered,
}: {
  sentRef: MutableRefObject<number>
  onMapRef: MutableRefObject<number | null>
  unclustered: boolean
}) {
  const [sample, setSample] = useState<FleetSample>({
    updates: 0,
    staticMarkerMounts: 0,
    indexLagMs: null,
    maxIndexLagMs: null,
    behind: null,
  })

  useEffect(() => {
    const interval = setInterval(() => {
      setSample({
        updates: stats.fleetUpdates,
        staticMarkerMounts: stats.staticMarkerMounts,
        indexLagMs: stats.indexLagMs,
        maxIndexLagMs: stats.maxIndexLagMs,
        behind:
          onMapRef.current == null ? null : sentRef.current - onMapRef.current,
      })
    }, SAMPLE_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [onMapRef, sentRef])

  let index: string
  if (unclustered) {
    index = 'Index: vehicles not indexed'
  } else if (sample.behind == null) {
    index = 'Index: loading…'
  } else if (sample.behind === 0) {
    index = 'Index: current'
  } else {
    index = `Index: ${sample.behind} update${sample.behind === 1 ? '' : 's'} behind`
  }

  return (
    <>
      <ControlRow>
        <StatusText testID="fleet-updates">
          Updates: {sample.updates}
        </StatusText>
        <StatusText testID="fleet-index">{index}</StatusText>
      </ControlRow>
      <StatusText testID="fleet-lag">
        Index lag:{' '}
        {sample.indexLagMs == null
          ? '–'
          : `${sample.indexLagMs} ms (max ${sample.maxIndexLagMs} ms)`}
      </StatusText>
      <StatusText testID="fleet-static-mounts">
        Static marker mounts: {sample.staticMarkerMounts}
      </StatusText>
    </>
  )
}

/**
 * Static markers with vehicles that move several times a second, the live
 * counterpart of the Parent state scenario. Every move changes coordinates,
 * so the index rebuilds over every marker; builds run one at a time, so the
 * map shows the newest update the last build had. The probe vehicle never
 * clusters, so `onMarkersChange` always reports which update the map shows,
 * and how long it took to get there.
 */
export function LiveFleetScreen() {
  const engineRef = useEngineBuildCounter()
  const [staticCount, setStaticCount] = useState(10_000)
  const [rateHz, setRateHz] = useState(4)
  const [streaming, setStreaming] = useState(false)
  const [unclustered, setUnclustered] = useState(false)
  const [update, setUpdate] = useState(0)

  /** The newest update sent. */
  const sentRef = useRef(0)
  /** The newest update the index holds; `null` before the first build. */
  const onMapRef = useRef<number | null>(null)
  /** When each update not yet in the index was sent. */
  const sentAtRef = useRef(new Map<number, number>())

  useEffect(() => {
    if (!streaming) {
      return
    }
    const interval = setInterval(() => {
      const next = sentRef.current + 1
      sentRef.current = next
      // Unclustered vehicles never reach the index, so no lag to measure.
      if (!unclustered) {
        sentAtRef.current.set(next, performance.now())
      }
      recordFleetUpdate()
      setUpdate(next)
    }, 1000 / rateHz)
    return () => clearInterval(interval)
  }, [streaming, rateHz, unclustered])

  const handleMarkersChange = useCallback(
    (features: Array<PointFeature | ClusterFeature>) => {
      let onMap: number | null = null
      for (const feature of features) {
        const { update: featureUpdate } = feature.properties
        if (!isClusterFeature(feature) && typeof featureUpdate === 'number') {
          onMap = Math.max(onMap ?? featureUpdate, featureUpdate)
        }
      }
      if (onMap == null || (onMapRef.current ?? -1) >= onMap) {
        return
      }
      onMapRef.current = onMap
      const sentAt = sentAtRef.current.get(onMap)
      if (sentAt != null) {
        recordIndexLag(Math.round(performance.now() - sentAt))
      }
      for (const sent of sentAtRef.current.keys()) {
        if (sent <= onMap) {
          sentAtRef.current.delete(sent)
        }
      }
    },
    []
  )

  // Built once per count: only the vehicles change between updates.
  const staticMarkers = useMemo(
    () =>
      generatePoints(staticCount, KRAKOW_BOUNDS, STATIC_SEED).map((point) => (
        <StaticMarker
          key={point.id}
          coordinate={{
            latitude: point.latitude,
            longitude: point.longitude,
          }}
        />
      )),
    [staticCount]
  )

  const vehicles = Array.from({ length: VEHICLE_COUNT }, (_, index) =>
    vehicleAt(index, update)
  )

  return (
    <>
      <MapView
        initialRegion={KRAKOW_REGION}
        onMarkersChange={handleMarkersChange}
        style={styles.map}
        superClusterRef={engineRef}
      >
        {staticMarkers}
        {vehicles.map((vehicle) => (
          <VehicleMarker
            key={vehicle.id}
            cluster={!unclustered}
            coordinate={{
              latitude: vehicle.latitude,
              longitude: vehicle.longitude,
            }}
            pinColor="#16A34A"
            update={update}
          />
        ))}
      </MapView>
      <ControlPanel>
        <ControlRow>
          <StatusText testID="static-count">Static: {staticCount}</StatusText>
          {STATIC_COUNTS.map((count) => (
            <ActionButton
              key={count}
              label={`${count / 1000}k`}
              onPress={() => setStaticCount(count)}
              testID={`static-${count}`}
            />
          ))}
        </ControlRow>
        <ControlRow>
          <StatusText testID="rate">Rate: {rateHz} Hz</StatusText>
          {RATES_HZ.map((rate) => (
            <ActionButton
              key={rate}
              label={`${rate} Hz`}
              onPress={() => setRateHz(rate)}
              testID={`rate-${rate}`}
            />
          ))}
        </ControlRow>
        <ControlRow>
          <Toggle
            label="Stream"
            onValueChange={setStreaming}
            testID="stream-toggle"
            value={streaming}
          />
          <Toggle
            label="Vehicles cluster={false}"
            onValueChange={setUnclustered}
            testID="unclustered-toggle"
            value={unclustered}
          />
        </ControlRow>
        <FleetStatus
          onMapRef={onMapRef}
          sentRef={sentRef}
          unclustered={unclustered}
        />
      </ControlPanel>
    </>
  )
}

const styles = StyleSheet.create({
  map: {
    flex: 1,
  },
})
