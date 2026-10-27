import { useMemo } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { Marker } from 'react-native-maps'
import MapView, {
  type RenderClusterProps,
} from 'react-native-better-clustering'
import { generatePoints, KRAKOW_BOUNDS, KRAKOW_REGION } from '../data'
import { CountedMarker } from '../hud/CountedMarker'
import { useEngineBuildCounter } from '../hud/useEngineBuildCounter'

/**
 * Defined outside the component: `MapView` re-renders every cluster when the
 * renderer's identity changes.
 */
function renderCluster({
  geometry,
  properties,
  onPress,
  tracksViewChanges,
}: RenderClusterProps) {
  const [longitude, latitude] = geometry.coordinates
  return (
    <Marker
      coordinate={{ latitude, longitude }}
      onPress={onPress}
      tracksViewChanges={tracksViewChanges}
    >
      <View style={styles.cluster}>
        <Text style={styles.clusterLabel} testID="custom-cluster">
          {properties.point_count_abbreviated}
        </Text>
      </View>
    </Marker>
  )
}

/** Clusters drawn by the app through `renderCluster`, pressable as usual. */
export function CustomClusterScreen() {
  const engineRef = useEngineBuildCounter()
  const points = useMemo(() => generatePoints(300, KRAKOW_BOUNDS, 8), [])

  return (
    <MapView
      initialRegion={KRAKOW_REGION}
      renderCluster={renderCluster}
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
  cluster: {
    minWidth: 36,
    paddingHorizontal: 6,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    backgroundColor: '#7C3AED',
  },
  clusterLabel: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
  },
})
