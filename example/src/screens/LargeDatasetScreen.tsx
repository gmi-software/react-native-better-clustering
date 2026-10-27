import { useEffect, useMemo, useRef, useState } from 'react'
import { StyleSheet } from 'react-native'
import MapView from 'react-native-better-clustering'
import { ControlPanel, ControlRow, StatusText } from '../components/Controls'
import {
  countPoints,
  generatePoints,
  POLAND_BOUNDS,
  POLAND_REGION,
} from '../data'
import { CountedMarker } from '../hud/CountedMarker'
import { useEngineBuildCounter } from '../hud/useEngineBuildCounter'

/**
 * `count` markers across Poland, all inside the initial region. Reports the
 * time from mount to the first markers, the cold-mount number #20 tracks.
 */
export function LargeDatasetScreen({ count }: { count: number }) {
  const engineRef = useEngineBuildCounter()
  const [visiblePoints, setVisiblePoints] = useState(0)
  const [firstMarkersMs, setFirstMarkersMs] = useState<number | null>(null)
  const mountedAtRef = useRef(0)

  useEffect(() => {
    mountedAtRef.current = performance.now()
  }, [])

  // Built once: new children on every status update would make `MapView`
  // convert and compare every marker again.
  const markers = useMemo(
    () =>
      generatePoints(count, POLAND_BOUNDS, 7).map((point) => (
        <CountedMarker
          key={point.id}
          coordinate={{
            latitude: point.latitude,
            longitude: point.longitude,
          }}
        />
      )),
    [count]
  )

  return (
    <>
      <MapView
        initialRegion={POLAND_REGION}
        // About twice the default: at the default radius this many markers
        // cover the map with overlapping bubbles and stall every zoom step.
        radius={56}
        onMarkersChange={(features) => {
          setVisiblePoints(countPoints(features))
          setFirstMarkersMs(
            (previous) =>
              previous ?? Math.round(performance.now() - mountedAtRef.current)
          )
        }}
        style={styles.map}
        superClusterRef={engineRef}
      >
        {markers}
      </MapView>
      <ControlPanel>
        <ControlRow>
          <StatusText testID="marker-count">Markers: {count}</StatusText>
          <StatusText testID="visible-points">
            Visible points: {visiblePoints}
          </StatusText>
        </ControlRow>
        <StatusText testID="first-markers">
          First markers:{' '}
          {firstMarkersMs == null ? 'loading…' : `${firstMarkersMs} ms`}
        </StatusText>
      </ControlPanel>
    </>
  )
}

const styles = StyleSheet.create({
  map: {
    flex: 1,
  },
})
