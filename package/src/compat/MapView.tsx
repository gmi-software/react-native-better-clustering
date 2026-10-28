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
import { Supercluster } from '../engine/Supercluster'
import {
  DEFAULT_MAX_ZOOM,
  DEFAULT_MIN_ZOOM,
  GEO_VIEWPORT_TILE_SIZE,
} from '../engine/defaults'
import { cameraZoomFromRegion, clusterZoomFromRegion } from '../engine/geometry'
import {
  useClusterIndex,
  type ClusterIndexOptions,
} from '../hooks/useClusterIndex'
import ClusterMarker from './ClusterMarker'
import { nearestWithin, screenScaleOf, type LatLng } from './glide'
import {
  bboxToFitCoordinates,
  elementKey,
  isMarker,
  markerElementOf,
  markerToGeoJSONFeature,
  sortByKey,
} from './helpers'
import { reanimated, warnFadeUnavailable } from './reanimated'
import { warnTwoParameterRegionChangeComplete } from './regionChangeComplete'
import { featuresNearView } from './nearView'
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

function defaultClusterAccessibilityLabel(count: number): string {
  return `Cluster of ${count} markers`
}

/**
 * Marker features share an index only while each keeps its child index, so a
 * feature's `properties.index` keeps pointing at its own element in the latest
 * children without a rebuild (a child inserted before the markers shifts them).
 */
function isSameMarkerFeature(previous: PointFeature, next: PointFeature) {
  return previous.properties.index === next.properties.index
}

/**
 * Longest a bubble removed while the map moves stays on screen, opaque; never
 * longer than the fade. Covers the few frames MapKit takes to show the
 * annotations that replace it, and matches the default recompute interval, so
 * at that interval at most one extra bubble generation is mounted. A shorter
 * `clusterUpdateIntervalMs` can keep more.
 */
const MOVING_EXIT_HOLD_MS = 100

/**
 * How far, in cluster radii, a bubble may glide from the bubble it split from
 * or into the bubble it merged into. A zoom step spreads a cluster's parts
 * over about two radii; past this it fades in place.
 */
const GLIDE_REACH_RADII = 4

function latLngOf(feature: ClusterFeature): LatLng {
  const [longitude, latitude] = feature.geometry.coordinates
  return { latitude, longitude }
}

const DEFAULT_EDGE_PADDING: EdgePadding = {
  top: 50,
  left: 50,
  right: 50,
  bottom: 50,
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
  /**
   * The `MapView`'s {@linkcode ClusteredMapViewProps.clusterFontFamily}, for
   * the cluster label; `undefined` when it is not set.
   */
  clusterFontFamily?: string
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
  /**
   * Called when the map region settles, with visible clustered markers. The
   * arguments follow react-native-map-clustering 4.x; 3.x passed
   * `(region, markers)`, so development builds warn once about a handler
   * that declares two parameters.
   */
  onRegionChangeComplete?: (
    region: Region,
    details: Details,
    markers: GeoJSONFeature[]
  ) => void
  /** Called whenever visible markers/clusters change. */
  onMarkersChange?: (markers: Array<PointFeature | ClusterFeature>) => void
  /**
   * Called when the native cluster index fails to build, for example because
   * the app was not rebuilt after installing the library. Markers from an
   * earlier successful build keep showing.
   *
   * Without it, the error is thrown during render, so the nearest error
   * boundary (and LogBox in development) shows it.
   */
  onError?: (error: Error) => void
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
  /**
   * When `true`, a cluster whose markers zooming can't separate (they share a
   * location) spreads them into a spiral: from
   * {@linkcode ClusteredMapViewProps.spiderfyMinZoom spiderfyMinZoom}, or at
   * any zoom when pressed.
   *
   * @default `true`
   */
  spiralEnabled?: boolean
  /**
   * Camera zoom from which clusters that can't split spiderfy without being
   * pressed. Matches react-native-map-clustering.
   *
   * @default `19`
   */
  spiderfyMinZoom?: number
  /**
   * Most markers a cluster spiderfies into. A larger cluster of overlapping
   * markers stays a cluster bubble; pressing it still calls
   * {@linkcode ClusteredMapViewProps.onClusterPress onClusterPress} with every
   * marker, so the app can list them instead.
   *
   * @default `50`
   */
  spiderfyMaxLeaves?: number
  /** Line color for spiderfied connector lines. */
  spiderLineColor?: string
  /** Custom renderer for cluster markers. */
  renderCluster?: (cluster: RenderClusterProps) => React.ReactElement
  /** Font family for default cluster labels. */
  clusterFontFamily?: string
  /**
   * Accessibility label for a default cluster bubble, from the number of
   * markers in it. It is passed to the bubble's `Marker` with the `button`
   * role. react-native-maps 1.27 does not forward either to the native map
   * annotation yet, so screen readers may still announce the map's own
   * marker label. Ignored when a custom
   * {@linkcode ClusteredMapViewProps.renderCluster renderCluster} is provided.
   *
   * @default (count) => `Cluster of ${count} markers`
   */
  clusterAccessibilityLabel?: (count: number) => string
  /** Highlights a selected cluster id. */
  selectedClusterId?: string | number
  /** Background color for the selected cluster. */
  selectedClusterColor?: string
  /**
   * Animates the default cluster bubbles on zoom: they fade in and out, and
   * on a zoom step a cluster's parts glide out of it and merging clusters
   * glide into one. See {@linkcode clusterFadeInDuration}. @default `true`
   */
  animationEnabled?: boolean
  /**
   * Accepted for react-native-map-clustering compatibility and ignored.
   *
   * @deprecated `LayoutAnimation` cannot animate map markers on the New
   * Architecture, which this library requires: markers are native map
   * annotations outside React Native's layout. Use
   * {@linkcode clusterFadeInDuration} to tune the bubble fade.
   */
  layoutAnimationConf?: LayoutAnimationConfig
  /**
   * Fade-in duration (ms) for cluster bubbles when they (re)mount on zoom, which
   * softens the blink caused by native annotations being removed/added. Applies
   * on both iOS and Android to the default cluster markers; ignored when
   * {@linkcode animationEnabled} is `false` or a custom {@linkcode renderCluster}
   * is provided. Set to `0` to disable.
   *
   * Bubbles cross-fade when the map settles. While it moves, new bubbles
   * appear at once and removed ones stay for up to 100 ms (never longer than
   * this duration) before they go, so a continuous zoom leaves no gaps; at
   * the default {@linkcode clusterUpdateIntervalMs} at most one extra
   * generation of bubbles stays mounted.
   *
   * It also times the glide: when a zoom step splits a cluster, the new
   * bubbles start at its place and glide to theirs, a bubble whose cluster
   * moves slides there, and merging bubbles glide into the one that takes
   * them in (while the map moves, within the 100 ms they stay). Pans and data
   * changes only fade.
   *
   * Needs `react-native-reanimated`, an optional peer dependency: without it
   * the bubbles do not fade or glide, and development builds warn once.
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
  /**
   * How far outside the map, in points, cluster bubbles still render. The
   * clusters are found, and reported to {@linkcode onMarkersChange}, for the
   * region plus half its size on each side, as react-native-map-clustering
   * does; only rendering stops at this margin. Markers are not affected.
   *
   * A smaller margin mounts fewer native annotations on each zoom step, which
   * keeps the UI thread free for the bubbles' fade and glide; a larger one
   * leaves fewer bubbles to appear at the edges during a fast pan. Pass
   * `Infinity` to render every cluster found.
   *
   * @default `100`
   */
  clusterRenderMargin?: number
}

/** Data retained per default cluster bubble so it can be cross-faded out. */
interface ClusterBubbleData {
  feature: ClusterFeature
  clusterColor: string
  clusterTextColor: string
  clusterFontFamily?: string
  accessibilityLabel: string
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
    onError,
    preserveClusterPressBehavior = false,
    clusteringEnabled = true,
    clusterColor = '#0F52FF',
    clusterTextColor = '#FFFFFF',
    clusterFontFamily,
    clusterAccessibilityLabel = defaultClusterAccessibilityLabel,
    selectedClusterId,
    selectedClusterColor = '#FF5722',
    animationEnabled = true,
    // Kept out of `restProps`, so it is not passed on to the native map.
    layoutAnimationConf: _layoutAnimationConf,
    clusterFadeInDuration = 250,
    tracksViewChanges = false,
    width,
    height,
    clusterUpdateIntervalMs = 100,
    clusterRenderMargin = 100,
    spiralEnabled = true,
    spiderfyMinZoom = 19,
    spiderfyMaxLeaves = 50,
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
  // gesture. While moving, removed bubbles only linger briefly (see
  // `bubbleExitMs`) so a continuous zoom does not stack multiple bubble
  // generations and saturate the JS thread.
  const [isMapMoving, setIsMapMoving] = useState(false)
  // Mirrors `isMapMoving` so the per-frame `onRegionChange` sets it only once
  // per gesture: React bails out of an equal update only after rendering again.
  const isMapMovingRef = useRef(false)
  const regionThrottleStateRef = useRef(createThrottleRegionSyncState())
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

  const clustererOptions = useMemo<ClusterIndexOptions>(
    () => ({
      radius,
      maxZoom,
      minZoom,
      minPoints,
      extent,
      nodeSize,
      // react-native-map-clustering calls `GeoViewport.viewport` without a tile
      // size, so it gets geo-viewport's 256 default. Matching it keeps the
      // drop-in swap rendering the same clusters at the same region.
      viewportTileSize: GEO_VIEWPORT_TILE_SIZE,
      // Past maxZoom, markers that share a location would turn into a stack
      // of markers; spiderfy spreads their cluster out instead.
      stopAtMaxZoom: true,
      onError,
    }),
    [radius, maxZoom, minZoom, minPoints, extent, nodeSize, onError]
  )

  const { clusters, supercluster, isCurrent } = useClusterIndex(
    markerFeatures,
    mapDimensions,
    currentRegion,
    clustererOptions,
    isSameMarkerFeature
  )

  // Callbacks are read through refs, so a new callback identity alone never
  // fires them: `onMarkersChange={setState}` with inline children would loop.
  const onMarkersChangeRef = useRef(onMarkersChange)
  const onRegionChangeCompleteRef = useRef(onRegionChangeComplete)
  useEffect(() => {
    onMarkersChangeRef.current = onMarkersChange
    onRegionChangeCompleteRef.current = onRegionChangeComplete
  })

  useEffect(() => {
    warnTwoParameterRegionChangeComplete(onRegionChangeComplete)
  }, [onRegionChangeComplete])

  // `clusters` is the single source of truth for what is visible in the current
  // region. Reuse it for `onMarkersChange` instead of querying the engine again
  // (the previous `visibleFeatures` recomputed the exact same set, doubling the
  // synchronous JSI round-trips on every region change). It is stabilized, so
  // this fires only when the visible set actually changes, and not before the
  // first index has loaded.
  useEffect(() => {
    if (supercluster.isLoaded) {
      onMarkersChangeRef.current(clusters)
    }
  }, [clusters, supercluster])

  // The zoom `clusters` are queried at, so it must use the same tile size as
  // `clustererOptions`. A pressed spider collapses when it changes, which is
  // exactly when the cluster it belongs to can be replaced.
  const currentZoom = useMemo(
    () =>
      clusterZoomFromRegion(
        currentRegion,
        mapDimensions,
        minZoom,
        maxZoom,
        GEO_VIEWPORT_TILE_SIZE
      ),
    [currentRegion, mapDimensions, minZoom, maxZoom]
  )

  const spiderfyByZoom =
    spiralEnabled &&
    cameraZoomFromRegion(currentRegion, mapDimensions) >= spiderfyMinZoom

  // Read through a ref by the press handler, so the handler keeps one identity
  // across zooms and the `ClusterMarker` memo holds.
  const currentZoomRef = useRef(currentZoom)
  useEffect(() => {
    currentZoomRef.current = currentZoom
  })

  // A cluster spiderfied by a press, until the zoom changes.
  const [pressedSpider, setPressedSpider] = useState<{
    supercluster: Supercluster
    clusterId: number
    zoom: number
  } | null>(null)
  const pressedSpiderId =
    pressedSpider != null &&
    pressedSpider.supercluster === supercluster &&
    pressedSpider.zoom === currentZoom
      ? pressedSpider.clusterId
      : null

  // Spiderfying is the only way to tell these markers apart: zooming never
  // splits the cluster within the index's zoom range.
  const canSpiderfy = useCallback(
    (cluster: ClusterFeature) => {
      const { cluster_id: clusterId, point_count: pointCount } =
        cluster.properties
      // A `NaN` cap fails `<=`, so it disables spiderfy rather than the cap.
      return (
        spiralEnabled &&
        pointCount <= spiderfyMaxLeaves &&
        supercluster.getClusterExpansionZoom(clusterId) > maxZoom
      )
    },
    [spiralEnabled, spiderfyMaxLeaves, supercluster, maxZoom]
  )

  // Without Reanimated the bubbles cannot fade, so drop both durations: an exit
  // ghost that cannot fade out would sit on top of its replacements instead.
  const fadeRequested =
    animationEnabled && clusterFadeInDuration > 0 && renderCluster == null
  const clusterFadeIn = fadeRequested && reanimated ? clusterFadeInDuration : 0

  useEffect(() => {
    if (fadeRequested && !reanimated) {
      warnFadeUnavailable()
    }
  }, [fadeRequested])

  // Removed bubbles cross-fade out once the gesture settles. While the map is
  // moving, a 250ms exit at a ~100ms recompute cadence would keep 2-3 bubble
  // generations mounted at once, which is what dragged the JS thread to ~30fps
  // on continuous zoom-out, so they only stay for `MOVING_EXIT_HOLD_MS`.
  const bubbleExitMs = isMapMoving
    ? Math.min(clusterFadeIn, MOVING_EXIT_HOLD_MS)
    : clusterFadeIn

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
      // Reading every leaf is what makes a press on a large cluster slow, so
      // only an `onClusterPress` the app passed pays for it.
      const reportPress = () => {
        if (onClusterPress !== noop) {
          onClusterPress(cluster, supercluster.getAllLeaves(clusterId))
        }
      }

      if (preserveClusterPressBehavior) {
        reportPress()
        return
      }

      // Fitting to markers that share a location changes nothing, so spread
      // them out in place.
      if (canSpiderfy(cluster)) {
        setPressedSpider({
          supercluster,
          clusterId,
          zoom: currentZoomRef.current,
        })
        reportPress()
        return
      }

      const bounds = supercluster.getClusterBounds(clusterId)
      if (bounds != null) {
        const map = mapRef.current
        const canFitToCoordinates =
          isMapReady &&
          layoutReady &&
          mapDimensions.width > 0 &&
          mapDimensions.height > 0

        if (canFitToCoordinates) {
          map?.fitToCoordinates(bboxToFitCoordinates(bounds), { edgePadding })
        } else {
          map?.animateToRegion(cluster.properties.getExpansionRegion(), 300)
        }
      }

      reportPress()
    },
    [
      supercluster,
      preserveClusterPressBehavior,
      canSpiderfy,
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
      if (!isMapMovingRef.current) {
        isMapMovingRef.current = true
        setIsMapMoving(true)
      }
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
      isMapMovingRef.current = false
      setIsMapMoving(false)
      flushThrottledRegionSync(
        region,
        syncCurrentRegion,
        regionThrottleStateRef.current
      )

      // Defer notifying the consumer until `clusters` is recomputed for the
      // settled region, so we reuse that single computation instead of querying
      // the engine a second time here (the old inline `deriveVisibleMapFeatures`
      // ran a full clustering query on the JS thread at gesture end, even when
      // no `onRegionChangeComplete` callback was provided).
      pendingRegionChangeRef.current = { region, details }
    },
    [syncCurrentRegion]
  )

  // `currentRegion` is a fresh object on every settle, so this runs once per
  // region change and forwards the already-computed `clusters` to the consumer.
  useEffect(() => {
    const pending = pendingRegionChangeRef.current
    if (pending == null) {
      return
    }
    pendingRegionChangeRef.current = null
    onRegionChangeCompleteRef.current(pending.region, pending.details, clusters)
  }, [currentRegion, clusters])

  // Leaves of the clusters that spiderfy. `clusters` keeps its identity across
  // pans and equal re-renders, so those never query the engine again; stale
  // leaf objects are fine because `markerFor` resolves them by child index.
  const spiderLeaves = useMemo(() => {
    const leavesByClusterId = new Map<number, PointFeature[]>()
    if (!spiderfyByZoom && pressedSpiderId == null) {
      return leavesByClusterId
    }

    for (const feature of clusters) {
      if (!isClusterFeature(feature)) {
        continue
      }
      const clusterId = feature.properties.cluster_id
      if (
        (spiderfyByZoom || clusterId === pressedSpiderId) &&
        canSpiderfy(feature)
      ) {
        leavesByClusterId.set(clusterId, supercluster.getAllLeaves(clusterId))
      }
    }
    return leavesByClusterId
  }, [clusters, supercluster, spiderfyByZoom, pressedSpiderId, canSpiderfy])

  // Spider spacing is fixed on screen, so it depends on the zoom. `null` while
  // nothing spiderfies, so ordinary zooms never re-render every marker.
  const { longitudeDelta: regionLongitudeDelta } = currentRegion
  const spiderLongitudePerPoint = useMemo(() => {
    if (
      spiderLeaves.size === 0 ||
      !(regionLongitudeDelta > 0) ||
      !(mapDimensions.width > 0)
    ) {
      return null
    }
    return regionLongitudeDelta / mapDimensions.width
  }, [spiderLeaves, regionLongitudeDelta, mapDimensions.width])

  // Clusters far outside the map are not rendered (see `clusterRenderMargin`).
  // Kept as the same array while the clusters it holds stay the same, so a
  // pan that changes none of them re-renders nothing below.
  const nearClustersRef = useRef<GeoJSONFeature[]>(clusters)
  const nearClusters = useMemo(() => {
    const near = featuresNearView(
      clusters,
      currentRegion,
      mapDimensions,
      clusterRenderMargin
    )
    const previous = nearClustersRef.current
    return near.length === previous.length &&
      near.every((feature, index) => feature === previous[index])
      ? previous
      : near
  }, [clusters, currentRegion, mapDimensions, clusterRenderMargin])
  useEffect(() => {
    nearClustersRef.current = nearClusters
  })

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

    // While a rebuild is pending, `clusters` still describe the previous
    // children: render those features' own elements until the index lands.
    const markerFor = (feature: PointFeature): ReactNode => {
      if (!isCurrent) {
        return markerElementOf(feature) ?? null
      }
      const index = feature.properties.index
      return typeof index === 'number' ? propsChildren[index] : null
    }

    // A cluster is keyed by its smallest leaf, which it keeps across zoom
    // levels and rebuilds while it only gains or loses other leaves, so its
    // bubble updates one native marker instead of removing and re-adding it.
    // Until a props-only change swaps in the newest features, the leaf is the
    // previous object, whose child index is the same by construction. With no
    // element for the leaf (mid-rebuild), it falls back to the engine id.
    const clusterKeyOf = (cluster: ClusterFeature): string => {
      const minLeaf = supercluster.getClusterMinLeaf(cluster)
      const element = minLeaf == null ? null : markerFor(minLeaf)
      return React.isValidElement(element) && element.key != null
        ? `cluster:${element.key}`
        : `cluster-${cluster.id}`
    }

    for (const feature of nearClusters) {
      if (!isClusterFeature(feature)) {
        // Keeps the key `Children.toArray` gave it, so each marker stays one
        // React instance when others are inserted or removed before it.
        const child = markerFor(feature)
        if (isMarker(child)) {
          immediate.push(child)
        }
        continue
      }

      const cluster = feature as ClusterFeature
      const clusterId = cluster.properties.cluster_id

      const leaves = spiderLeaves.get(clusterId)
      if (leaves != null && spiderLongitudePerPoint != null) {
        immediate.push(
          ...renderSpiderClusterMarkers(
            cluster,
            leaves,
            markerFor,
            spiderLongitudePerPoint,
            spiderLineColor
          )
        )
        continue
      }

      const clusterKey = clusterKeyOf(cluster)
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
              clusterFontFamily,
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
          accessibilityLabel: clusterAccessibilityLabel(
            cluster.properties.point_count
          ),
          tracksViewChanges,
        },
      })
    }

    return {
      immediateMarkers: sortByKey(immediate, elementKey),
      clusterBubbleItems: bubbles,
    }
  }, [
    clusteringEnabled,
    nearClusters,
    isCurrent,
    propsChildren,
    handleClusterPress,
    clusterColor,
    clusterTextColor,
    clusterFontFamily,
    clusterAccessibilityLabel,
    selectedClusterId,
    selectedClusterColor,
    renderCluster,
    tracksViewChanges,
    supercluster,
    spiderLeaves,
    spiderLongitudePerPoint,
    spiderLineColor,
  ])

  // Sorted after `useFadePresence`, which lists exiting bubbles last: an
  // exiting bubble keeps its place too, so it fades out instead of blinking.
  const presentBubbles = useFadePresence(clusterBubbleItems, bubbleExitMs)
  const clusterBubbleEntries = sortByKey(presentBubbles, (entry) => entry.key)

  // Where bubbles glide, judged against the bubbles of the last commit. Only a
  // zoom step glides bubbles in or out: zooming in, a new bubble starts at
  // the one it split from; zooming out, a bubble that goes slides into the one
  // that took it in. A pan or a data change only fades, so a bubble coming
  // into view never flies out of a neighbour.
  const placedBubblesRef = useRef<{
    zoom: number
    positions: Map<string, LatLng>
  }>({ zoom: currentZoom, positions: new Map() })
  // Where each exiting bubble glides, fixed when it starts to go.
  const exitGlidesRef = useRef<Map<string, LatLng | undefined>>(new Map())
  const placedBubbles = placedBubblesRef.current
  const zoomStep = Math.sign(currentZoom - placedBubbles.zoom)
  const screenScale =
    clusterFadeIn > 0 && zoomStep !== 0
      ? screenScaleOf(currentRegion, mapDimensions)
      : null
  const glideReach = GLIDE_REACH_RADII * radius
  const bubblePositions = new Map<string, LatLng>()
  for (const { key, data, exiting } of clusterBubbleEntries) {
    if (!exiting) {
      bubblePositions.set(key, latLngOf(data.feature))
    }
  }
  const exitGlides = new Map<string, LatLng | undefined>()
  const glideFromOf = (key: string, position: LatLng) =>
    zoomStep > 0 && screenScale != null && !placedBubbles.positions.has(key)
      ? nearestWithin(
          position,
          placedBubbles.positions.values(),
          screenScale,
          glideReach
        )
      : undefined
  const glideToOf = (key: string, position: LatLng) => {
    const glide = exitGlidesRef.current.has(key)
      ? exitGlidesRef.current.get(key)
      : zoomStep < 0 && screenScale != null
        ? nearestWithin(
            position,
            bubblePositions.values(),
            screenScale,
            glideReach
          )
        : undefined
    exitGlides.set(key, glide)
    return glide
  }

  useEffect(() => {
    placedBubblesRef.current = { zoom: currentZoom, positions: bubblePositions }
    exitGlidesRef.current = exitGlides
  })

  // Bubbles that mount while the map moves appear at once, so the bubble they
  // replace does not leave a gap when it goes. Only exiting bubbles see the
  // fade-out change between moving (`0`: stay opaque until dropped) and
  // settled, so starting or ending a gesture re-renders no other bubble;
  // `appearInstantly` is read only when a bubble mounts.
  // An exiting bubble glides for as long as it stays: the fade when settled,
  // the hold while the map moves.
  const clusterBubbleMarkers = clusterBubbleEntries.map(
    ({ key, data, exiting }) => {
      const position = latLngOf(data.feature)
      return (
        <ClusterMarker
          key={key}
          feature={data.feature}
          onPress={handleClusterPress}
          clusterColor={data.clusterColor}
          clusterTextColor={data.clusterTextColor}
          clusterFontFamily={data.clusterFontFamily}
          accessibilityLabel={data.accessibilityLabel}
          tracksViewChanges={data.tracksViewChanges}
          fadeInDuration={clusterFadeIn}
          fadeOutDuration={exiting && isMapMoving ? 0 : clusterFadeIn}
          appearInstantly={isMapMoving}
          exiting={exiting}
          glideFrom={exiting ? undefined : glideFromOf(key, position)}
          glideTo={exiting ? glideToOf(key, position) : undefined}
          glideDuration={exiting ? bubbleExitMs : clusterFadeIn}
        />
      )
    }
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
