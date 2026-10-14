import React, { memo, useEffect, useRef, type Ref } from 'react'
import { Platform, StyleSheet, Text, View } from 'react-native'
import { Marker, type MapMarker, type MapMarkerProps } from 'react-native-maps'
import type { ClusterFeature } from '../geojson/types'
import { reanimated, type Reanimated } from './reanimated'

const BUBBLE_BORDER_WIDTH = 2.5
const HALO_SCALE = 1.18
const SHADOW_PADDING = 6

/**
 * `react-native-maps` markers are native annotations: a bubble that unmounts and
 * remounts is removed and re-added in one commit, a visible blink. `MapView`
 * keys bubbles by their cluster's smallest marker, so most survive zoom steps;
 * those that genuinely appear or disappear fade.
 *
 * Animating the bubble `<View>` opacity does not help because `tracksViewChanges`
 * is `false` (a single bitmap snapshot is taken). The only lever that affects the
 * live annotation is the native `opacity` prop.
 *
 * The fade is driven by Reanimated (`useAnimatedProps`) so the per-frame opacity
 * update runs on the UI thread. A previous JS-driven `Animated` implementation
 * pushed `setNativeProps` from JS every frame for every bubble, which dominated
 * the CPU profile (~23% self-time) when dozens of clusters remounted on each zoom.
 *
 * Reanimated is an optional peer dependency, so the fading marker only exists
 * when the app includes it; without it every bubble is a plain marker.
 */
function createFadingMarker({
  default: Animated,
  useAnimatedProps,
  useSharedValue,
  withTiming,
}: Reanimated) {
  const AnimatedMarker = Animated.createAnimatedComponent(Marker)

  return function FadingMarker({
    ref,
    fadeInDuration,
    fadeOutDuration,
    appearInstantly,
    exiting,
    ...markerProps
  }: MapMarkerProps & {
    ref: Ref<MapMarker>
    fadeInDuration: number
    fadeOutDuration: number
    appearInstantly: boolean
    exiting: boolean
  }) {
    // Both only take the value from the first render.
    const opacity = useSharedValue(appearInstantly ? 1 : 0)
    const target = useRef(appearInstantly ? 1 : 0)

    // Animates only when the target changes, so a re-render, or the second
    // effect run under StrictMode, does not restart the fade.
    useEffect(() => {
      const next = exiting ? 0 : 1
      // A bubble exiting without a fade-out stays as it is until unmounted.
      if (target.current === next || (exiting && fadeOutDuration <= 0)) {
        return
      }
      target.current = next
      opacity.value = withTiming(next, {
        duration: exiting ? fadeOutDuration : fadeInDuration,
      })
    }, [exiting, fadeInDuration, fadeOutDuration, opacity])

    const animatedProps = useAnimatedProps(() => ({ opacity: opacity.value }))

    return (
      <AnimatedMarker
        ref={ref}
        {...markerProps}
        animatedProps={animatedProps}
      />
    )
  }
}

const FadingMarker = reanimated ? createFadingMarker(reanimated) : null

function clusterBubbleMetrics(pointCount: number): {
  width: number
  height: number
  size: number
  fontSize: number
  haloSize: number
} {
  const size = Math.min(
    56,
    Math.max(32, 26 + Math.log2(Math.max(pointCount, 1)) * 7)
  )
  const fontSize = Math.min(18, Math.max(12, Math.round(size * 0.34)))
  const haloSize = Math.round(size * HALO_SCALE)
  const outerExtent = Math.max(haloSize, size + SHADOW_PADDING * 2)
  const padding = Math.ceil((outerExtent - size) / 2) + 2
  return {
    width: size + padding * 2,
    height: size + padding * 2,
    size,
    fontSize,
    haloSize,
  }
}

function formatClusterCount(count: number): string {
  if (count >= 10_000) {
    return `${Math.round(count / 1000)}k`
  }
  if (count >= 1000) {
    const compact = (count / 1000).toFixed(1).replace(/\.0$/, '')
    return `${compact}k`
  }
  return String(count)
}

export interface ClusterMarkerProps {
  feature: ClusterFeature
  onPress: (feature: ClusterFeature) => void
  clusterColor: string
  clusterTextColor: string
  clusterFontFamily?: string
  tracksViewChanges?: boolean
  /**
   * Fade-in duration (ms) applied to the native marker `opacity` when this bubble
   * mounts. `0` disables the animation and renders a plain (non-animated) marker,
   * as does an app without `react-native-reanimated`.
   *
   * @default 0
   */
  fadeInDuration?: number
  /**
   * Fade-out duration (ms) used when {@linkcode exiting} becomes `true`. `0`
   * keeps an exiting bubble as it is until the caller unmounts it.
   *
   * @default `fadeInDuration`
   */
  fadeOutDuration?: number
  /**
   * When `true`, a fading bubble mounts fully opaque instead of fading in.
   * Read only when the bubble mounts, so changing it re-renders nothing.
   *
   * @default false
   */
  appearInstantly?: boolean
  /**
   * When `true`, the bubble animates its opacity to `0` (cross-fade out). The
   * caller is responsible for keeping it mounted until the animation finishes.
   * Press handling is disabled while exiting so stale cluster data cannot fire
   * `onPress` during the fade.
   *
   * @default false
   */
  exiting?: boolean
}

function ClusterMarker({
  feature,
  onPress,
  clusterColor,
  clusterTextColor,
  clusterFontFamily,
  tracksViewChanges = false,
  fadeInDuration = 0,
  fadeOutDuration = fadeInDuration,
  appearInstantly = false,
  exiting = false,
}: ClusterMarkerProps) {
  const points = feature.properties.point_count
  const { width, height, fontSize, size, haloSize } =
    clusterBubbleMetrics(points)
  const [longitude, latitude] = feature.geometry.coordinates
  const label = formatClusterCount(points)

  // The bubble keeps its native marker while its cluster splits, merges or
  // changes colour, but with `tracksViewChanges` off Google Maps keeps showing
  // the bitmap it took first, so ask for a new one when the look changes.
  const markerRef = useRef<MapMarker>(null)
  const appearance = `${points}|${clusterColor}|${clusterTextColor}|${clusterFontFamily ?? ''}`
  const drawnAppearance = useRef(appearance)
  useEffect(() => {
    if (drawnAppearance.current === appearance) {
      return
    }
    drawnAppearance.current = appearance
    if (!tracksViewChanges) {
      markerRef.current?.redraw()
    }
  }, [appearance, tracksViewChanges])

  const markerProps = {
    coordinate: { latitude, longitude },
    onPress: exiting ? undefined : () => onPress(feature),
    tracksViewChanges,
  }

  const bubble = (
    <View style={[styles.container, { width, height }]}>
      <View
        style={[
          styles.halo,
          {
            backgroundColor: clusterColor,
            width: haloSize,
            height: haloSize,
            borderRadius: haloSize / 2,
          },
        ]}
      />
      <View
        style={[
          styles.bubble,
          styles.bubbleShadow,
          {
            backgroundColor: clusterColor,
            width: size,
            height: size,
            borderRadius: size / 2,
            borderWidth: BUBBLE_BORDER_WIDTH,
          },
        ]}
      >
        <Text
          style={[
            styles.text,
            {
              color: clusterTextColor,
              fontSize,
              ...(clusterFontFamily ? { fontFamily: clusterFontFamily } : {}),
            },
          ]}
        >
          {label}
        </Text>
      </View>
    </View>
  )

  if (fadeInDuration > 0 && FadingMarker) {
    return (
      <FadingMarker
        ref={markerRef}
        {...markerProps}
        fadeInDuration={fadeInDuration}
        fadeOutDuration={fadeOutDuration}
        appearInstantly={appearInstantly}
        exiting={exiting}
      >
        {bubble}
      </FadingMarker>
    )
  }

  return (
    <Marker ref={markerRef} {...markerProps}>
      {bubble}
    </Marker>
  )
}

const styles = StyleSheet.create({
  container: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
  },
  halo: {
    position: 'absolute',
    opacity: 0.2,
    zIndex: 0,
  },
  bubble: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    borderColor: 'rgba(255, 255, 255, 0.92)',
    zIndex: 1,
  },
  bubbleShadow: Platform.select({
    ios: {
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.28,
      shadowRadius: 4,
    },
    android: {
      elevation: 5,
    },
    default: {},
  }),
  text: {
    fontWeight: '700',
    letterSpacing: -0.3,
    ...Platform.select({
      ios: {
        fontVariant: ['tabular-nums'],
      },
      android: {
        includeFontPadding: false,
      },
      default: {},
    }),
  },
})

/** Leaves out `appearInstantly`, which only matters when the bubble mounts. */
function areClusterMarkerPropsEqual(
  prev: ClusterMarkerProps,
  next: ClusterMarkerProps
): boolean {
  return (
    prev.feature === next.feature &&
    prev.onPress === next.onPress &&
    prev.clusterColor === next.clusterColor &&
    prev.clusterTextColor === next.clusterTextColor &&
    prev.clusterFontFamily === next.clusterFontFamily &&
    prev.tracksViewChanges === next.tracksViewChanges &&
    prev.fadeInDuration === next.fadeInDuration &&
    prev.fadeOutDuration === next.fadeOutDuration &&
    prev.exiting === next.exiting
  )
}

export { areClusterMarkerPropsEqual }

export default memo(ClusterMarker, areClusterMarkerPropsEqual)
