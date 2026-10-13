import { useEffect, useState } from 'react'
import { FlatList, Pressable, StyleSheet, Text } from 'react-native'
import MapView from 'react-native-better-clustering'
import { isClusterFeature } from 'react-native-better-clustering/geojson'
import type {
  ClusterFeature,
  PointFeature,
} from 'react-native-better-clustering/geojson'
import {
  ControlPanel,
  ControlRow,
  StatusText,
  Toggle,
} from '../components/Controls'
import {
  countPoints,
  generatePoints,
  KRAKOW_BOUNDS,
  KRAKOW_REGION,
} from '../data'
import { CountedMarker } from '../hud/CountedMarker'
import { useEngineBuildCounter } from '../hud/useEngineBuildCounter'

const POINTS = generatePoints(60, KRAKOW_BOUNDS, 2)

/** Close enough that some markers stand alone, so remounts would show. */
const INITIAL_REGION = {
  ...KRAKOW_REGION,
  latitudeDelta: 0.15,
  longitudeDelta: 0.15,
}

type Feature = PointFeature | ClusterFeature

type Selection =
  | { kind: 'marker'; id: string }
  | { kind: 'cluster'; id: number; pointCount: number }

function markerIdOf(feature: PointFeature): string {
  // `MapView` copies each marker's props onto its feature.
  return String(feature.properties.identifier)
}

function describe(selection: Selection | null): string {
  if (selection == null) {
    return 'nothing'
  }
  return selection.kind === 'marker'
    ? `marker ${selection.id}`
    : `cluster of ${selection.pointCount}`
}

/**
 * Parent state the way apps hold it: a selection, and a list of what is
 * visible fed straight from `onMarkersChange={setVisible}` with inline
 * children. Neither may rebuild the index or remount markers.
 */
export function ParentStateScreen() {
  const engineRef = useEngineBuildCounter()
  const [visible, setVisible] = useState<Feature[]>([])
  const [selection, setSelection] = useState<Selection | null>(null)
  const [rerendering, setRerendering] = useState(false)
  const [rerenders, setRerenders] = useState(0)

  useEffect(() => {
    if (!rerendering) {
      return
    }
    const interval = setInterval(() => setRerenders((count) => count + 1), 500)
    return () => clearInterval(interval)
  }, [rerendering])

  const select = (feature: Feature) => {
    setSelection(
      isClusterFeature(feature)
        ? {
            kind: 'cluster',
            id: feature.properties.cluster_id,
            pointCount: feature.properties.point_count,
          }
        : { kind: 'marker', id: markerIdOf(feature) }
    )
  }

  return (
    <>
      <MapView
        initialRegion={INITIAL_REGION}
        onMarkersChange={setVisible}
        selectedClusterId={
          selection?.kind === 'cluster' ? selection.id : undefined
        }
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
            identifier={point.id}
            onPress={() => setSelection({ kind: 'marker', id: point.id })}
            pinColor={
              selection?.kind === 'marker' && selection.id === point.id
                ? '#FF5722'
                : '#0F52FF'
            }
          />
        ))}
      </MapView>
      <ControlPanel>
        <ControlRow>
          <StatusText testID="selection">
            Selected: {describe(selection)}
          </StatusText>
          <StatusText testID="visible-points">
            Visible points: {countPoints(visible)}
          </StatusText>
        </ControlRow>
        <ControlRow>
          <Toggle
            label="Re-render at 2 Hz"
            onValueChange={setRerendering}
            testID="rerender-toggle"
            value={rerendering}
          />
          <StatusText testID="rerenders">Re-renders: {rerenders}</StatusText>
        </ControlRow>
        <FlatList
          data={visible}
          keyExtractor={(feature) =>
            isClusterFeature(feature)
              ? `cluster-${feature.properties.cluster_id}`
              : `marker-${markerIdOf(feature)}`
          }
          renderItem={({ item, index }) => (
            <Pressable
              onPress={() => select(item)}
              style={styles.row}
              testID={`visible-row-${index}`}
            >
              <Text style={styles.rowText}>
                {isClusterFeature(item)
                  ? `Cluster of ${item.properties.point_count}`
                  : `Marker ${markerIdOf(item)}`}
              </Text>
            </Pressable>
          )}
          style={styles.list}
        />
      </ControlPanel>
    </>
  )
}

const styles = StyleSheet.create({
  map: {
    flex: 1,
  },
  list: {
    height: 160,
  },
  row: {
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
  },
  rowText: {
    color: '#111827',
    fontSize: 14,
  },
})
