import { useEffect } from 'react'
import { Marker, type MapMarkerProps } from 'react-native-maps'
import { recordMarkerMount } from './stats'

/**
 * A `Marker` that reports its mounts to the dev HUD. `MapView` clusters any
 * child with a `coordinate`, so this clusters and spiderfies like a `Marker`.
 */
export function CountedMarker(props: MapMarkerProps) {
  useEffect(() => recordMarkerMount(), [])
  return <Marker {...props} />
}
