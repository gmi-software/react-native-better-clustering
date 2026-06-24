import React, {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
  type Ref,
} from 'react'
import {
  Dimensions,
  LayoutAnimation,
  Platform,
  StyleSheet,
  View,
  type LayoutAnimationConfig,
  type LayoutChangeEvent,
} from 'react-native'
import MapView, {
  type Details,
  type EdgePadding,
  type MapViewProps,
  type Region,
} from 'react-native-maps'
import type { MapRegion } from '../types'
import type {
  ClusterFeature,
  GeoJSONFeature,
  PointFeature,
} from '../geojson/types'
import { isClusterFeature } from '../geojson'
import { Supercluster, type SuperclusterOptions } from '../engine/Supercluster'
import { DEFAULT_MAX_ZOOM, DEFAULT_MIN_ZOOM } from '../engine/defaults'
import { clusterZoomFromRegion } from '../engine/geometry'
import { useClusterer } from '../hooks/useClusterer'
import ClusterMarker from './ClusterMarker'
import {
  computeClusterLayoutSignature,
  isMarker,
  markerToGeoJSONFeature,
} from './helpers'
import { renderSpiderClusterMarkers } from './renderSpiderClusterMarkers'
import { useFadePresence } from './useFadePresence'
import {
  cancelThrottledRegionSync,
  createThrottleRegionSyncState,
  flushThrottledRegionSync,
  scheduleThrottledRegionSync,
} from './throttleRegionSync'

const { width: WINDOW_WIDTH, height: WINDOW_HEIGHT } = Dimensions.get('window')

/**
 * Stable no-op for default callback props. Using a module-level reference (instead
 * of an inline `() => {}` default) keeps `onClusterPress`/`onRegionChangeComplete`/
 * `onMarkersChange` identity-stable across renders, so memoized handlers that depend
 * on them (e.g. `handleClusterPress`) stay stable and `ClusterMarker` memo holds.
 */
const noop = () => {}

const DEFAULT_EDGE_PADDING: EdgePadding = {
  top: 50,
  left: 50,
  right: 50,
  bottom: 50,
}

/**
 * Shorter than `LayoutAnimation.Presets.spring` (700ms overshoot) and tuned for
 * cluster bubble create/update/delete instead of a generic full-tree relayout.
 * Override via `layoutAnimationConf`.
 */
const DEFAULT_LAYOUT_ANIMATION: LayoutAnimationConfig = {
  duration: 200,
  create: {
    type: LayoutAnimation.Types.easeInEaseOut,
    property: LayoutAnimation.Properties.opacity,
  },
  update: {
    type: LayoutAnimation.Types.easeInEaseOut,
    property: LayoutAnimation.Properties.scaleXY,
  },
  delete: {
    type: LayoutAnimation.Types.easeInEaseOut,
    property: LayoutAnimation.Properties.opacity,
  },
}

/**
 * Props passed to {@linkcode ClusteredMapViewProps.renderCluster}.
 *
 * @see {@linkcode ClusteredMapViewProps}
 */
export type RenderClusterProps = ClusterFeature & {
  /** Invoked when the cluster marker is pressed. */
  onPress: () => void
  /** Background color for the default cluster bubble. */
  clusterColor: string
  /** Text color for the default cluster bubble. */
  clusterTextColor: string
  /** Forwarded to the underlying map marker. */
  tracksViewChanges: boolean
}

/**
 * Props for the drop-in clustering map component exported as default/`MapView`.
 *
 * Extends `react-native-maps` `MapViewProps` with clustering options compatible
 * with `react-native-map-clustering`.
 *
 * @see {@linkcode RenderClusterProps}
 */
export interface ClusteredMapViewProps extends Omit<
  MapViewProps,
  'onRegionChangeComplete'
> {
  /**
   * Cluster radius in pixels at max zoom.
   *
   * @default ~6% of window width (`Dimensions.get('window').width * 0.06`)
   */
  radius?: number
  /** Maximum zoom level at which clusters are generated. @default `20` */
  maxZoom?: number
  /** Minimum zoom level at which clusters are generated. @default `1` */
  minZoom?: number
  /** Minimum number of points required to form a cluster. @default `2` */
  minPoints?: number
  /** Tile extent used for projection math. @default `512` */
  extent?: number
  /** KD-tree node size. @default `64` */
  nodeSize?: number
  /** Edge padding passed to `fitToCoordinates` on cluster press. */
  edgePadding?: EdgePadding
  /** Called when a cluster is pressed with the cluster and its leaf markers. */
  onClusterPress?: (cluster: ClusterFeature, markers: PointFeature[]) => void
  /** Called when the map region settles, with visible clustered markers. */
  onRegionChangeComplete?: (
    region: Region,
    details: Details,
    markers: GeoJSONFeature[]
  ) => void
  /** Called whenever visible markers/clusters change. */
  onMarkersChange?: (markers: Array<PointFeature | ClusterFeature>) => void
  /** When `true`, cluster press does not auto-zoom (caller handles expansion). */
  preserveClusterPressBehavior?: boolean
  /** Toggle clustering without unmounting the map. @default `true` */
  clusteringEnabled?: boolean
  /** Default cluster bubble color. */
  clusterColor?: string
  /** Default cluster label color. */
  clusterTextColor?: string
  /** Receives the internal {@linkcode Supercluster} instance for imperative queries. */
  superClusterRef?: MutableRefObject<Supercluster | null>
  /** Callback ref for the underlying `react-native-maps` map instance. */
  mapRef?: (map: MapView | null) => void
  /** When `true`, overlapping markers spiderfy on cluster press. */
  spiralEnabled?: boolean
  /** Line color for spiderfied connector lines. */
  spiderLineColor?: string
  /** Custom renderer for cluster markers. */
  renderCluster?: (cluster: RenderClusterProps) => React.ReactElement
  /** Font family for default cluster labels. */
  clusterFontFamily?: string
  /** Highlights a selected cluster id. */
  selectedClusterId?: string | number
  /** Background color for the selected cluster. */
  selectedClusterColor?: string
  /** Animate cluster implode/explode on zoom (iOS only). @default `true` */
  animationEnabled?: boolean
  /** LayoutAnimation preset/config used when `animationEnabled` (iOS only). */
  layoutAnimationConf?: LayoutAnimationConfig
  /**
   * Fade-in duration (ms) for cluster bubbles when they (re)mount on zoom, which
   * softens the blink caused by native annotations being removed/added. Applies
   * on both iOS and Android to the default cluster markers; ignored when
   * {@linkcode animationEnabled} is `false` or a custom {@linkcode renderCluster}
   * is provided. Set to `0` to disable.
   *
   * @default `250`
   */
  clusterFadeInDuration?: number
  /** Forwarded to default cluster markers. @default `false` for performance */
  tracksViewChanges?: boolean
  /** Seed initial map width before `onLayout` measures. @default window width */
  width?: number
  /** Seed initial map height before `onLayout` measures. @default window height */
  height?: number
  /**
   * Minimum interval (ms) between cluster recomputations while the map is
   * moving. `0` recomputes only when the gesture settles.
   *
   * @default `100`
   */
  clusterUpdateIntervalMs?: number
}

/** Data retained per default cluster bubble so it can be cross-faded out. */
interface ClusterBubbleData {
  feature: ClusterFeature
  clusterColor: string
  clusterTextColor: string
  clusterFontFamily?: string
  tracksViewChanges: boolean
}

function toMapRegion(region?: Region): MapRegion {
  if (!region) {
    return {
      latitude: 0,
      longitude: 0,
      latitudeDelta: 1,
      longitudeDelta: 1,
    }
  }

  return {
    latitude: region.latitude,
    longitude: region.longitude,
    latitudeDelta: region.latitudeDelta,
    longitudeDelta: region.longitudeDelta,
  }
}

/**
 * Drop-in replacement for `react-native-map-clustering`'s `MapView`.
 *
 * Accepts `react-native-maps` `Marker` children, clusters them with the native
 * {@linkcode Supercluster} engine, and exposes the same callback surface as the
 * original library.
 *
 * @see {@linkcode ClusteredMapViewProps}
 */
const CompatMapView = forwardRef(function CompatMapView(
  {
    radius = WINDOW_WIDTH * 0.06,
    maxZoom = DEFAULT_MAX_ZOOM,
    minZoom = DEFAULT_MIN_ZOOM,
    minPoints = 2,
    extent = 512,
    nodeSize = 64,
    edgePadding = DEFAULT_EDGE_PADDING,
    children,
    onClusterPress = noop,
    onRegionChangeComplete = noop,
    onMarkersChange = noop,
    preserveClusterPressBehavior = false,
    clusteringEnabled = true,
    clusterColor = '#0F52FF',
    clusterTextColor = '#FFFFFF',
    clusterFontFamily,
    selectedClusterId,
    selectedClusterColor = '#FF5722',
    animationEnabled = true,
    layoutAnimationConf = DEFAULT_LAYOUT_ANIMATION,
    clusterFadeInDuration = 250,
    tracksViewChanges = false,
    width,
    height,
    clusterUpdateIntervalMs = 100,
    spiralEnabled = true,
    spiderLineColor = '#FF0000',
    renderCluster,
    superClusterRef,
    mapRef: mapRefProp,
    initialRegion,
    region: controlledRegion,
    style,
    onMapReady,
    onRegionChange,
    ...restProps
  }: ClusteredMapViewProps,
  ref: Ref<MapView>
) {
  const mapRef = useRef<MapView | null>(null)
  const pendingRegionChangeRef = useRef<{
    region: Region
    details: Details
  } | null>(null)
  // `true` between the first `onRegionChange` and `onRegionChangeComplete` of a
  // gesture. While moving we suppress cross-fade exit ghosts (see
  // `effectiveFadeOut`) so a continuous zoom does not stack multiple bubble
  // generations and saturate the JS thread.
  const isMovingRef = useRef(false)
  const regionThrottleStateRef = useRef(createThrottleRegionSyncState())
  const clusterLayoutSignatureRef = useRef('')
  const [mapDimensions, setMapDimensions] = useState(() => ({
    width: width ?? WINDOW_WIDTH,
    height: height ?? WINDOW_HEIGHT,
  }))
  const [layoutReady, setLayoutReady] = useState(false)
  const [isMapReady, setIsMapReady] = useState(false)
  const [currentRegion, setCurrentRegion] = useState<MapRegion>(() =>
    toMapRegion(
      (controlledRegion as Region | undefined) ?? initialRegion ?? undefined
    )
  )

  const propsChildren = useMemo(
    () => React.Children.toArray(children),
    [children]
  )

  const { otherChildren, markerFeatures } = useMemo(() => {
    const others: ReactNode[] = []
    const features: PointFeature[] = []

    if (!clusteringEnabled) {
      for (const child of propsChildren) {
        if (!isMarker(child)) {
          others.push(child)
        }
      }
      return {
        otherChildren: others,
        markerFeatures: [] as PointFeature[],
      }
    }

    propsChildren.forEach((child, index) => {
      if (isMarker(child)) {
        features.push(markerToGeoJSONFeature(child, index))
      } else {
        others.push(child)
      }
    })

    return {
      otherChildren: others,
      markerFeatures: features,
    }
  }, [propsChildren, clusteringEnabled])

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const { width: layoutWidth, height: layoutHeight } =
      event.nativeEvent.layout
    if (layoutWidth > 0 && layoutHeight > 0) {
      setMapDimensions({ width: layoutWidth, height: layoutHeight })
      setLayoutReady(true)
    }
  }, [])

  useEffect(() => {
    if (!layoutReady) {
      setMapDimensions({
        width: width ?? WINDOW_WIDTH,
        height: height ?? WINDOW_HEIGHT,
      })
    }
  }, [width, height, layoutReady])

  const handleMapReady = useCallback(() => {
    setIsMapReady(true)
    onMapReady?.()
  }, [onMapReady])

  const clustererOptions = useMemo<SuperclusterOptions>(
    () => ({
      radius,
      maxZoom,
      minZoom,
      minPoints,
      extent,
      nodeSize,
    }),
    [radius, maxZoom, minZoom, minPoints, extent, nodeSize]
  )

  const [clusters, supercluster] = useClusterer(
    markerFeatures,
    mapDimensions,
    currentRegion,
    clustererOptions
  )

  const clusterLayoutSignature = useMemo(
    () => computeClusterLayoutSignature(clusters),
    [clusters]
  )
  clusterLayoutSignatureRef.current = clusterLayoutSignature

  // `clusters` is the single source of truth for what is visible in the current
  // region. Reuse it for `onMarkersChange` instead of querying the engine again
  // (the previous `visibleFeatures` recomputed the exact same set, doubling the
  // synchronous JSI round-trips on every region change). It is stabilized, so
  // this fires only when the visible set actually changes.
  useEffect(() => {
    onMarkersChange(clusters)
  }, [clusters, onMarkersChange])

  const currentZoom = useMemo(
    () => clusterZoomFromRegion(currentRegion, mapDimensions, minZoom, maxZoom),
    [currentRegion, mapDimensions, minZoom, maxZoom]
  )

  const isAtMaxZoom = currentZoom >= maxZoom

  const clusterFadeIn = animationEnabled ? clusterFadeInDuration : 0

  // Cross-fade exit ghosts are only kept around once the gesture settles. While
  // the map is actively moving we drop removed bubbles immediately (duration 0):
  // at a ~100ms recompute cadence, a 250ms exit would keep 2-3 bubble
  // generations mounted at once, which is what dragged the JS thread to ~30fps
  // on continuous zoom-out. `currentRegion` re-renders on every throttle tick
  // and on settle, so reading the ref here always reflects the live state.
  const effectiveFadeOut = isMovingRef.current ? 0 : clusterFadeIn

  useEffect(() => {
    if (superClusterRef) {
      superClusterRef.current = clusteringEnabled ? supercluster : null
    }
  }, [superClusterRef, supercluster, clusteringEnabled])

  const assignMapRef = useCallback(
    (map: MapView | null) => {
      mapRef.current = map
      if (typeof ref === 'function') {
        ref(map)
      } else if (ref) {
        ref.current = map
      }
      mapRefProp?.(map)
    },
    [ref, mapRefProp]
  )

  const handleClusterPress = useCallback(
    (cluster: ClusterFeature) => {
      const clusterId = cluster.properties.cluster_id
      const leaves = supercluster.getAllLeaves(clusterId)

      if (preserveClusterPressBehavior) {
        onClusterPress(cluster, leaves)
        return
      }

      const coordinates = leaves.map((leaf) => {
        const [longitude, latitude] = leaf.geometry.coordinates
        return { latitude, longitude }
      })

      if (coordinates.length > 0) {
        const map = mapRef.current
        const canFitToCoordinates =
          isMapReady &&
          layoutReady &&
          mapDimensions.width > 0 &&
          mapDimensions.height > 0

        if (canFitToCoordinates) {
          map?.fitToCoordinates(coordinates, { edgePadding })
        } else {
          map?.animateToRegion(cluster.properties.getExpansionRegion(), 300)
        }
      }

      onClusterPress(cluster, leaves)
    },
    [
      supercluster,
      preserveClusterPressBehavior,
      onClusterPress,
      edgePadding,
      isMapReady,
      layoutReady,
      mapDimensions.width,
      mapDimensions.height,
    ]
  )

  const syncCurrentRegion = useCallback((region: Region) => {
    setCurrentRegion(toMapRegion(region))
  }, [])

  useEffect(() => {
    const regionThrottleState = regionThrottleStateRef.current
    return () => {
      cancelThrottledRegionSync(regionThrottleState)
    }
  }, [])

  const handleRegionChange = useCallback(
    (region: Region, details: Details) => {
      isMovingRef.current = true
      // Keep clusters in sync while the map moves, but throttle recomputation so
      // pinch/pan does not trigger a full re-cluster on every native frame.
      scheduleThrottledRegionSync(
        region,
        syncCurrentRegion,
        regionThrottleStateRef.current,
        { intervalMs: clusterUpdateIntervalMs }
      )
      onRegionChange?.(region, details)
    },
    [clusterUpdateIntervalMs, onRegionChange, syncCurrentRegion]
  )

  const handleRegionChangeComplete = useCallback(
    (region: Region, details: Details) => {
      // Gesture settled: re-enable cross-fade so the final cluster transition
      // animates, while intermediate frames during the move stayed instant.
      isMovingRef.current = false
      flushThrottledRegionSync(
        region,
        syncCurrentRegion,
        regionThrottleStateRef.current
      )

      const mapRegion = toMapRegion(region)
      const nextSignature =
        clusteringEnabled && supercluster.isLoaded
          ? computeClusterLayoutSignature(
              supercluster.getClustersFromRegion(mapRegion, mapDimensions)
            )
          : clusterLayoutSignatureRef.current

      if (
        animationEnabled &&
        Platform.OS === 'ios' &&
        nextSignature !== clusterLayoutSignatureRef.current
      ) {
        LayoutAnimation.configureNext(layoutAnimationConf)
      }

      // Defer notifying the consumer until `clusters` is recomputed for the
      // settled region, so we reuse that single computation instead of querying
      // the engine a second time here (the old inline `deriveVisibleMapFeatures`
      // ran a full clustering query on the JS thread at gesture end, even when
      // no `onRegionChangeComplete` callback was provided).
      pendingRegionChangeRef.current = { region, details }
    },
    [
      animationEnabled,
      clusteringEnabled,
      layoutAnimationConf,
      mapDimensions,
      supercluster,
      syncCurrentRegion,
    ]
  )

  // `currentRegion` is a fresh object on every settle, so this runs once per
  // region change and forwards the already-computed `clusters` to the consumer.
  useEffect(() => {
    const pending = pendingRegionChangeRef.current
    if (pending == null) {
      return
    }
    pendingRegionChangeRef.current = null
    onRegionChangeComplete(pending.region, pending.details, clusters)
  }, [currentRegion, clusters, onRegionChangeComplete])

  const shouldSpiderCluster = useCallback(
    (clusterId: number) => {
      if (!spiralEnabled || !isAtMaxZoom) {
        return false
      }

      return supercluster.getClusterExpansionZoom(clusterId) >= maxZoom
    },
    [spiralEnabled, isAtMaxZoom, supercluster, maxZoom]
  )

  // Split rendering: everything except the default cluster bubbles is rendered
  // immediately, while the default bubbles go through `useFadePresence` so a
  // removed bubble lingers and cross-fades out as its replacements fade in.
  const { immediateMarkers, clusterBubbleItems } = useMemo(() => {
    const immediate: ReactNode[] = []
    const bubbles: Array<{ key: string; data: ClusterBubbleData }> = []

    if (!clusteringEnabled) {
      return {
        immediateMarkers: propsChildren.filter(isMarker),
        clusterBubbleItems: bubbles,
      }
    }

    for (const feature of clusters) {
      if (!isClusterFeature(feature)) {
        const index = feature.properties.index
        const child = typeof index === 'number' ? propsChildren[index] : null
        if (isMarker(child)) {
          immediate.push(React.cloneElement(child, { key: `marker-${index}` }))
        }
        continue
      }

      const cluster = feature as ClusterFeature
      const clusterId = cluster.properties.cluster_id

      if (shouldSpiderCluster(clusterId)) {
        immediate.push(
          ...renderSpiderClusterMarkers(
            cluster,
            propsChildren,
            supercluster,
            spiderLineColor
          )
        )
        continue
      }

      const clusterKey = `cluster-${cluster.id}`
      const selected =
        selectedClusterId != null &&
        String(clusterId) === String(selectedClusterId)
      const effectiveClusterColor = selected
        ? selectedClusterColor
        : clusterColor

      if (renderCluster) {
        immediate.push(
          React.cloneElement(
            renderCluster({
              ...cluster,
              onPress: () => handleClusterPress(cluster),
              clusterColor: effectiveClusterColor,
              clusterTextColor,
              tracksViewChanges,
            }),
            { key: clusterKey }
          )
        )
        continue
      }

      bubbles.push({
        key: clusterKey,
        data: {
          feature: cluster,
          clusterColor: effectiveClusterColor,
          clusterTextColor,
          clusterFontFamily,
          tracksViewChanges,
        },
      })
    }

    return { immediateMarkers: immediate, clusterBubbleItems: bubbles }
  }, [
    clusteringEnabled,
    clusters,
    propsChildren,
    handleClusterPress,
    clusterColor,
    clusterTextColor,
    clusterFontFamily,
    selectedClusterId,
    selectedClusterColor,
    renderCluster,
    tracksViewChanges,
    shouldSpiderCluster,
    supercluster,
    spiderLineColor,
  ])

  const clusterBubbleEntries = useFadePresence(
    clusterBubbleItems,
    effectiveFadeOut
  )

  const clusterBubbleMarkers = clusterBubbleEntries.map(
    ({ key, data, exiting }) => (
      <ClusterMarker
        key={key}
        feature={data.feature}
        onPress={handleClusterPress}
        clusterColor={data.clusterColor}
        clusterTextColor={data.clusterTextColor}
        clusterFontFamily={data.clusterFontFamily}
        tracksViewChanges={data.tracksViewChanges}
        fadeInDuration={clusterFadeIn}
        fadeOutDuration={clusterFadeIn}
        exiting={exiting}
      />
    )
  )

  return (
    <View style={[styles.container, style]} onLayout={handleLayout}>
      <MapView
        {...restProps}
        ref={assignMapRef}
        style={styles.map}
        initialRegion={initialRegion}
        region={controlledRegion}
        onMapReady={handleMapReady}
        onRegionChange={handleRegionChange}
        onRegionChangeComplete={handleRegionChangeComplete}
      >
        {immediateMarkers}
        {clusterBubbleMarkers}
        {otherChildren}
      </MapView>
    </View>
  )
})

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  map: {
    flex: 1,
  },
})

export default CompatMapView
