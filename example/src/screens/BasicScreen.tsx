import { useMemo } from 'react'
import { StyleSheet } from 'react-native'
import MapView from 'react-native-better-clustering'
import { generatePoints, KRAKOW_REGION, POLAND_BOUNDS } from '../data'
import { CountedMarker } from '../hud/CountedMarker'
import { useEngineBuildCounter } from '../hud/useEngineBuildCounter'

/** The original demo: 2,000 static markers across Poland, nothing else. */
export function BasicScreen() {
  const engineRef = useEngineBuildCounter()
  const points = useMemo(() => generatePoints(2000, POLAND_BOUNDS, 1), [])

  return (
    <MapView
      initialRegion={KRAKOW_REGION}
      style={styles.map}
      superClusterRef={engineRef}
    >
      {points.map((point) => (
        <CountedMarker
          key={point.id}
          coordinate={{
            latitude: point.latitude,
            longitude: point.longitude,
          }}
        />
      ))}
    </MapView>
  )
}

const styles = StyleSheet.create({
  map: {
    flex: 1,
  },
})
