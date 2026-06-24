import React, { memo, useEffect } from 'react'
import { Platform, StyleSheet, Text, View } from 'react-native'
import Animated, {
  useAnimatedProps,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'
import { Marker } from 'react-native-maps'
import type { ClusterFeature } from '../geojson/types'

const BUBBLE_BORDER_WIDTH = 2.5
const HALO_SCALE = 1.18
const SHADOW_PADDING = 6

/**
 * `react-native-maps` markers are native annotations: on zoom the cluster set is
 * rebuilt with new `cluster_id`s, so React unmounts/remounts every bubble and the
 * native side removes/adds annotations in one commit, producing a visible blink.
 *
 * Animating the bubble `<View>` opacity does not help because `tracksViewChanges`
 * is `false` (a single bitmap snapshot is taken). The only lever that affects the
 * live annotation is the native `opacity` prop.
 *
 * The fade is driven by Reanimated (`useAnimatedProps`) so the per-frame opacity
 * update runs on the UI thread. A previous JS-driven `Animated` implementation
 * pushed `setNativeProps` from JS every frame for every bubble, which dominated
 * the CPU profile (~23% self-time) when dozens of clusters remounted on each zoom.
 */
const AnimatedMarker = Animated.createAnimatedComponent(Marker)

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
   * mounts. `0` disables the animation and renders a plain (non-animated) marker.
   *
   * @default 0
   */
  fadeInDuration?: number
  /**
   * Fade-out duration (ms) used when {@linkcode exiting} becomes `true`.
   *
   * @default `fadeInDuration`
   */
  fadeOutDuration?: number
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
  exiting = false,
}: ClusterMarkerProps) {
  const points = feature.properties.point_count
  const { width, height, fontSize, size, haloSize } =
    clusterBubbleMetrics(points)
  const [longitude, latitude] = feature.geometry.coordinates
  const label = formatClusterCount(points)

  const fadeEnabled = fadeInDuration > 0
  const opacity = useSharedValue(fadeEnabled ? 0 : 1)

  useEffect(() => {
    if (!fadeEnabled) {
      return
    }
    if (exiting) {
      opacity.value = withTiming(0, { duration: fadeOutDuration })
    } else {
      opacity.value = withTiming(1, { duration: fadeInDuration })
    }
  }, [fadeEnabled, exiting, fadeInDuration, fadeOutDuration, opacity])

  const animatedProps = useAnimatedProps(() => ({ opacity: opacity.value }))

  const MarkerComponent = fadeEnabled ? AnimatedMarker : Marker

  return (
    <MarkerComponent
      coordinate={{ latitude, longitude }}
      onPress={exiting ? undefined : () => onPress(feature)}
      tracksViewChanges={tracksViewChanges}
      // Drive the native `opacity` prop on the UI thread; omit when fade is off.
      animatedProps={fadeEnabled ? animatedProps : undefined}
    >
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
    </MarkerComponent>
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
