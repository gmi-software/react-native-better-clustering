import { useEffect, useReducer, useState } from 'react'
import { StyleSheet } from 'react-native'
import MapView from 'react-native-better-clustering'
import {
  ActionButton,
  ControlPanel,
  ControlRow,
  StatusText,
  Toggle,
} from '../components/Controls'
import {
  countPoints,
  KRAKOW_BOUNDS,
  KRAKOW_REGION,
  pointAt,
  type MapPoint,
} from '../data'
import { CountedMarker } from '../hud/CountedMarker'
import { useEngineBuildCounter } from '../hud/useEngineBuildCounter'

const SEED = 3
const INITIAL_COUNT = 100

interface LiveData {
  points: MapPoint[]
  /** Index of the next point to append, so a removed point never comes back. */
  nextIndex: number
}

type Action =
  | { type: 'append'; count: number }
  | { type: 'removeNewest' }
  | { type: 'removeOldest' }

function reducer(state: LiveData, action: Action): LiveData {
  switch (action.type) {
    case 'append': {
      const added = Array.from({ length: action.count }, (_, offset) =>
        pointAt(KRAKOW_BOUNDS, SEED, state.nextIndex + offset)
      )
      return {
        points: [...state.points, ...added],
        nextIndex: state.nextIndex + action.count,
      }
    }
    case 'removeNewest':
      return { ...state, points: state.points.slice(0, -1) }
    case 'removeOldest':
      return { ...state, points: state.points.slice(1) }
  }
}

function initLiveData(): LiveData {
  return reducer(
    { points: [], nextIndex: 0 },
    { type: 'append', count: INITIAL_COUNT }
  )
}

/**
 * Markers that arrive and leave while the map is on screen. The map must keep
 * showing the previous markers while it rebuilds, and keep the markers that
 * stay mounted.
 */
export function LiveDataScreen() {
  const engineRef = useEngineBuildCounter()
  const [{ points }, dispatch] = useReducer(reducer, undefined, initLiveData)
  const [visiblePoints, setVisiblePoints] = useState(0)
  const [appending, setAppending] = useState(false)

  useEffect(() => {
    if (!appending) {
      return
    }
    const interval = setInterval(
      () => dispatch({ type: 'append', count: 1 }),
      1000
    )
    return () => clearInterval(interval)
  }, [appending])

  return (
    <>
      <MapView
        initialRegion={KRAKOW_REGION}
        onMarkersChange={(features) => setVisiblePoints(countPoints(features))}
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
      <ControlPanel>
        <ControlRow>
          <StatusText testID="marker-count">
            Markers: {points.length}
          </StatusText>
          <StatusText testID="visible-points">
            Visible points: {visiblePoints}
          </StatusText>
        </ControlRow>
        <ControlRow>
          <ActionButton
            label="+1"
            onPress={() => dispatch({ type: 'append', count: 1 })}
            testID="append-1"
          />
          <ActionButton
            label="+100"
            onPress={() => dispatch({ type: 'append', count: 100 })}
            testID="append-100"
          />
          <ActionButton
            label="−1 newest"
            onPress={() => dispatch({ type: 'removeNewest' })}
            testID="remove-newest"
          />
          <ActionButton
            label="−1 oldest"
            onPress={() => dispatch({ type: 'removeOldest' })}
            testID="remove-oldest"
          />
        </ControlRow>
        <Toggle
          label="Append one per second"
          onValueChange={setAppending}
          testID="append-toggle"
          value={appending}
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
