import { useRef, useState } from 'react'
import { StyleSheet } from 'react-native'
import type RNMapView from 'react-native-maps'
import MapView from 'react-native-better-clustering'
import {
  ActionButton,
  ControlPanel,
  ControlRow,
  StatusText,
} from '../components/Controls'
import {
  colocatedPoints,
  countPoints,
  generatePoints,
  POLAND_REGION,
  regionAtZoom,
} from '../data'
import { CountedMarker } from '../hud/CountedMarker'
import { useEngineBuildCounter } from '../hud/useEngineBuildCounter'

/** Five units of one building: small enough to spiderfy. */
const SMALL_SPOT = { latitude: 50.0617, longitude: 19.9373 }
/** A thousand geocoding fallbacks: more than `spiderfyMaxLeaves`, so it stays a bubble. */
const LARGE_SPOT = { latitude: 52.2318, longitude: 21.006 }
/** Distinct but close: these split by zooming, not by spiderfying. */
const NEARBY_SPOT = { latitude: 54.3485, longitude: 18.6533 }

const POINTS = [
  ...colocatedPoints(5, SMALL_SPOT.latitude, SMALL_SPOT.longitude, 'small'),
  ...colocatedPoints(1000, LARGE_SPOT.latitude, LARGE_SPOT.longitude, 'large'),
  ...generatePoints(
    12,
    {
      minLat: NEARBY_SPOT.latitude - 0.0003,
      maxLat: NEARBY_SPOT.latitude + 0.0003,
      minLng: NEARBY_SPOT.longitude - 0.0004,
      maxLng: NEARBY_SPOT.longitude + 0.0004,
    },
    4
  ),
]

/** Below `spiderfyMinZoom` (19): the 5 markers spiderfy only when pressed. */
const PRESS_ZOOM = 15
const SPIDERFY_ZOOM = 19.5
const ANIMATION_MS = 600

/**
 * Markers that share a coordinate never split by zooming. Small groups
 * spiderfy from zoom 19 or when pressed; large ones stay a bubble and hand
 * every marker to `onClusterPress`.
 */
export function CoLocatedScreen() {
  const engineRef = useEngineBuildCounter()
  const mapRef = useRef<RNMapView>(null)
  const [pressedCount, setPressedCount] = useState<number | null>(null)
  const [visiblePoints, setVisiblePoints] = useState(0)

  const flyTo = (spot: { latitude: number; longitude: number }, zoom: number) =>
    mapRef.current?.animateToRegion(
      regionAtZoom(spot.latitude, spot.longitude, zoom),
      ANIMATION_MS
    )

  return (
    <>
      <MapView
        ref={mapRef}
        initialRegion={POLAND_REGION}
        onClusterPress={(_cluster, markers) => setPressedCount(markers.length)}
        onMarkersChange={(features) => setVisiblePoints(countPoints(features))}
        style={styles.map}
        superClusterRef={engineRef}
        testID="map"
      >
        {POINTS.map((point) => (
          <CountedMarker
            key={point.id}
            coordinate={{
              latitude: point.latitude,
              longitude: point.longitude,
            }}
          />
        ))}
      </MapView>
      <ControlPanel>
        <ControlRow>
          <StatusText testID="visible-points">
            Visible points: {visiblePoints}
          </StatusText>
          <StatusText testID="last-press">
            Last cluster press:{' '}
            {pressedCount == null ? 'none' : `${pressedCount} markers`}
          </StatusText>
        </ControlRow>
        <ControlRow>
          <ActionButton
            label="5 at one spot"
            onPress={() => flyTo(SMALL_SPOT, PRESS_ZOOM)}
            testID="go-small"
          />
          <ActionButton
            label="Zoom to 19.5"
            onPress={() => flyTo(SMALL_SPOT, SPIDERFY_ZOOM)}
            testID="go-small-close"
          />
        </ControlRow>
        <ControlRow>
          <ActionButton
            label="1,000 at one spot"
            onPress={() => flyTo(LARGE_SPOT, PRESS_ZOOM)}
            testID="go-large"
          />
          <ActionButton
            label="12 nearby"
            onPress={() => flyTo(NEARBY_SPOT, PRESS_ZOOM)}
            testID="go-nearby"
          />
        </ControlRow>
      </ControlPanel>
    </>
  )
}

const styles = StyleSheet.create({
  map: {
    flex: 1,
  },
})
