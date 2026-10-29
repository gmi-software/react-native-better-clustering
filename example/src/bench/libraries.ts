import type { ComponentType, ReactNode } from 'react'
import type { Region } from 'react-native-maps'
import BetterClusteringMapView from 'react-native-better-clustering'
import MapClusteringMapView from 'react-native-map-clustering'

/** The props the benchmark passes: the API both libraries share. */
export interface BenchMapViewProps {
  initialRegion: Region
  mapRef: (map: unknown) => void
  onRegionChangeComplete: (region: Region) => void
  renderCluster: (cluster: BenchClusterProps) => ReactNode
  /** Assigned each built index: counts builds (see `createBuildCounterRef`). */
  superClusterRef: { current: unknown }
  style: object
  children: ReactNode
}

/** What both libraries pass to `renderCluster`: a GeoJSON cluster and a press handler. */
export interface BenchClusterProps {
  id?: number | string
  geometry: { coordinates: number[] }
  properties: { cluster_id: number; point_count: number }
  onPress: () => void
}

export type BenchLibraryId = 'rnmc' | 'rnbc'

export interface BenchLibrary {
  id: BenchLibraryId
  name: string
  version: string
  MapView: ComponentType<BenchMapViewProps>
}

// Inlined by babel-preset-expo at bundle time.
declare const process: { env: Record<string, string | undefined> }

/**
 * The library this build links as react-native-better-clustering. Its native
 * code is compiled in, so one build measures one version; the benchmark's
 * README says how to build against the published 1.0.0.
 */
const BETTER_CLUSTERING_VERSION =
  process.env.EXPO_PUBLIC_BENCH_RNBC_VERSION ?? 'main'

export const BENCH_LIBRARIES: Record<BenchLibraryId, BenchLibrary> = {
  rnmc: {
    id: 'rnmc',
    name: 'react-native-map-clustering',
    version: '4.0.0',
    MapView: MapClusteringMapView as unknown as ComponentType<BenchMapViewProps>,
  },
  rnbc: {
    id: 'rnbc',
    name: 'react-native-better-clustering',
    version: BETTER_CLUSTERING_VERSION,
    MapView:
      BetterClusteringMapView as unknown as ComponentType<BenchMapViewProps>,
  },
}
