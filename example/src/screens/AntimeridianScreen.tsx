import { useRef, useState } from 'react'
import { StyleSheet } from 'react-native'
import type RNMapView from 'react-native-maps'
import MapView from 'react-native-better-clustering'
import { ActionButton, ControlPanel, StatusText } from '../components/Controls'
import { countPoints, generatePoints } from '../data'
import { CountedMarker } from '../hud/CountedMarker'
import { useEngineBuildCounter } from '../hud/useEngineBuildCounter'

const FIJI_LATITUDES = { minLat: -18.3, maxLat: -16.8 }

/** 20 points just west of 180° (positive longitudes) and 20 just east of it. */
const POINTS = [
  ...generatePoints(
    20,
    { ...FIJI_LATITUDES, minLng: 179.2, maxLng: 179.98 },
    5
  ),
  ...generatePoints(
    20,
    { ...FIJI_LATITUDES, minLng: -179.98, maxLng: -179.2 },
    6
  ),
]

const ANTIMERIDIAN_REGION = {
  latitude: -17.55,
  longitude: 180,
  latitudeDelta: 3,
  longitudeDelta: 3,
}

/**
 * Markers on both sides of ±180°, all on screen. Every one of them should be
 * clustered and shown; fewer reproduces #18.
 */
export function AntimeridianScreen() {
  const engineRef = useEngineBuildCounter()
  const mapRef = useRef<RNMapView>(null)
  const [visiblePoints, setVisiblePoints] = useState(0)

  return (
    <>
      <MapView
        ref={mapRef}
        initialRegion={ANTIMERIDIAN_REGION}
        onMarkersChange={(features) => setVisiblePoints(countPoints(features))}
        style={styles.map}
        superClusterRef={engineRef}
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
        <StatusText testID="visible-points">
          Visible points: {visiblePoints} of {POINTS.length}
        </StatusText>
        <StatusText testID="antimeridian-hint">
          All {POINTS.length} are on screen; fewer is #18.
        </StatusText>
        <ActionButton
          label="Centre on 180°"
          onPress={() =>
            mapRef.current?.animateToRegion(ANTIMERIDIAN_REGION, 600)
          }
          testID="recentre"
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
