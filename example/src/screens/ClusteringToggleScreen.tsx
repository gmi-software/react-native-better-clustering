import { useState } from 'react'
import { StyleSheet } from 'react-native'
import MapView from 'react-native-better-clustering'
import {
  ControlPanel,
  ControlRow,
  StatusText,
  Toggle,
} from '../components/Controls'
import { generatePoints, KRAKOW_BOUNDS, KRAKOW_REGION } from '../data'
import { CountedMarker } from '../hud/CountedMarker'
import { useEngineBuildCounter } from '../hud/useEngineBuildCounter'

const POINTS = generatePoints(300, KRAKOW_BOUNDS, 9)

/**
 * `clusteringEnabled` on a mounted map: off renders every marker as is, on
 * clusters them again.
 */
export function ClusteringToggleScreen() {
  const engineRef = useEngineBuildCounter()
  const [clusteringEnabled, setClusteringEnabled] = useState(true)

  return (
    <>
      <MapView
        clusteringEnabled={clusteringEnabled}
        initialRegion={KRAKOW_REGION}
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
        <ControlRow>
          <Toggle
            label="Clustering"
            onValueChange={setClusteringEnabled}
            testID="clustering-toggle"
            value={clusteringEnabled}
          />
          <StatusText testID="marker-count">
            Markers: {POINTS.length}
          </StatusText>
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
