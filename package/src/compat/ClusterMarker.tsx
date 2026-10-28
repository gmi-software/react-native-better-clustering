import React, { memo, useEffect, useRef, type Ref } from 'react'
import { Platform, StyleSheet, Text, View } from 'react-native'
import { Marker, type MapMarker, type MapMarkerProps } from 'react-native-maps'
import type { ClusterFeature } from '../geojson/types'
import type { LatLng } from './glide'
import { reanimated, type Reanimated } from './reanimated'

/**
 * Width of the white ring around a bubble. It is a white circle under the
 * coloured one rather than a `borderWidth`: React Native draws a border on an
 * unclipped view into an image on the CPU, again on every layout and opacity
 * change, while a plain circle stays a GPU-drawn layer.
 */
const BUBBLE_BORDER_WIDTH = 2.5
const HALO_SCALE = 1.18
const SHADOW_PADDING = 6

/**
 * How long a fade-in or glide waits before it starts. Mounting a zoom step's
 * bubbles (a hundred or more annotations around the screen) can hold the UI
 * thread for a few hundred milliseconds, and Reanimated times animations by
 * the clock: one started before that would be over by the time the bubble
 * shows. Waiting a few frames starts it on the first frame after the mount,
 * so it plays in full.
 */
const START_DELAY_MS = 50

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
 * The position glides the same way, through the native `coordinate` prop: a
 * bubble whose cluster moves slides to its new place instead of jumping, one
 * that splits off starts at `glideFrom` and one that merges away slides to
 * `glideTo` as it fades. `react-native-maps`' own `animateMarkerToCoordinate`
 * is no substitute: it is linear, ignores a new target while it runs, and on
 * iOS under the New Architecture turns any duration under a second into 0.
 *
 * Reanimated is an optional peer dependency, so the fading marker only exists
 * when the app includes it; without it every bubble is a plain marker.
 */
function createFadingMarker({
  default: Animated,
  Easing,
  useAnimatedProps,
  useSharedValue,
  withDelay,
  withTiming,
}: Reanimated) {
  const AnimatedMarker = Animated.createAnimatedComponent(Marker)
  const glideEasing = Easing.out(Easing.cubic)

  return function FadingMarker({
    ref,
    coordinate,
    fadeInDuration,
    fadeOutDuration,
    appearInstantly,
    exiting,
    glideFrom,
    glideTo,
    glideDuration,
    ...markerProps
  }: MapMarkerProps & {
    ref: Ref<MapMarker>
    coordinate: LatLng
    fadeInDuration: number
    fadeOutDuration: number
    appearInstantly: boolean
    exiting: boolean
    glideFrom: LatLng | undefined
    glideTo: LatLng | undefined
    glideDuration: number
  }) {
    // These only take the value from the first render.
    const opacity = useSharedValue(appearInstantly ? 1 : 0)
    const target = useRef(appearInstantly ? 1 : 0)
    const start = useRef(glideFrom ?? coordinate).current
    const latitude = useSharedValue(start.latitude)
    const longitude = useSharedValue(start.longitude)
    const placed = useRef<LatLng>(start)

    // Animates only when the target changes, so a re-render, or the second
    // effect run under StrictMode, does not restart the fade.
    useEffect(() => {
      const next = exiting ? 0 : 1
      // A bubble exiting without a fade-out stays as it is until unmounted.
      if (target.current === next || (exiting && fadeOutDuration <= 0)) {
        return
      }
      target.current = next
      const fade = withTiming(next, {
        duration: exiting ? fadeOutDuration : fadeInDuration,
      })
      opacity.value = exiting ? fade : withDelay(START_DELAY_MS, fade)
    }, [exiting, fadeInDuration, fadeOutDuration, opacity])

    // Glides only when the place it heads for changes, so a re-render does
    // not restart it; a new place mid-glide continues from where it is.
    const destination = exiting ? (glideTo ?? placed.current) : coordinate
    const { latitude: toLatitude, longitude: toLongitude } = destination
    useEffect(() => {
      if (
        placed.current.latitude === toLatitude &&
        placed.current.longitude === toLongitude
      ) {
        return
      }
      placed.current = { latitude: toLatitude, longitude: toLongitude }
      if (glideDuration > 0) {
        // An exiting bubble is already on screen and has only its hold to go.
        const glide = (to: number) => {
          const timing = withTiming(to, {
            duration: glideDuration,
            easing: glideEasing,
          })
          return exiting ? timing : withDelay(START_DELAY_MS, timing)
        }
        latitude.value = glide(toLatitude)
        longitude.value = glide(toLongitude)
      } else {
        latitude.value = toLatitude
        longitude.value = toLongitude
      }
    }, [exiting, toLatitude, toLongitude, glideDuration, latitude, longitude])

    const animatedProps = useAnimatedProps(() => ({
      opacity: opacity.value,
      coordinate: { latitude: latitude.value, longitude: longitude.value },
    }))

    // The static `coordinate` stays where the bubble mounted. A React commit
    // applies it to the native marker, and Reanimated does not put the
    // animated one back until it next changes: passing the new place here
    // jumped every bubble that was still waiting to glide straight there.
    return (
      <AnimatedMarker
        ref={ref}
        {...markerProps}
        coordinate={start}
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
  /**
   * Accessibility label passed to the `Marker`, with the `button` role.
   *
   * @default `Cluster of ${point_count} markers`
   */
  accessibilityLabel?: string
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
  /**
   * Where a fading bubble starts when it mounts, to glide to its own place:
   * the bubble it split from. Read only when the bubble mounts.
   */
  glideFrom?: LatLng
  /**
   * Where an {@linkcode exiting} bubble glides as it fades out: the bubble it
   * merged into. Without it, it fades where it is.
   */
  glideTo?: LatLng
  /**
   * Duration (ms) of every glide: from {@linkcode glideFrom}, to a new place,
   * and to {@linkcode glideTo}. `0` moves the bubble at once.
   *
   * @default `fadeInDuration`
   */
  glideDuration?: number
}

function ClusterMarker({
  feature,
  onPress,
  clusterColor,
  clusterTextColor,
  clusterFontFamily,
  accessibilityLabel,
  tracksViewChanges = false,
  fadeInDuration = 0,
  fadeOutDuration = fadeInDuration,
  appearInstantly = false,
  exiting = false,
  glideFrom,
  glideTo,
  glideDuration = fadeInDuration,
}: ClusterMarkerProps) {
  const points = feature.properties.point_count
  const { width, height, fontSize, size, haloSize } =
    clusterBubbleMetrics(points)
  const innerSize = size - BUBBLE_BORDER_WIDTH * 2
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
    accessibilityLabel: accessibilityLabel ?? `Cluster of ${points} markers`,
    accessibilityRole: 'button' as const,
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
          styles.ring,
          styles.bubbleShadow,
          { width: size, height: size, borderRadius: size / 2 },
        ]}
      >
        <View
          style={[
            styles.bubble,
            {
              backgroundColor: clusterColor,
              width: innerSize,
              height: innerSize,
              borderRadius: innerSize / 2,
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
        glideFrom={glideFrom}
        glideTo={glideTo}
        glideDuration={glideDuration}
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
  ring: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    zIndex: 1,
  },
  bubble: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
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

function sameLatLng(a: LatLng | undefined, b: LatLng | undefined): boolean {
  return (
    a === b ||
    (a != null &&
      b != null &&
      a.latitude === b.latitude &&
      a.longitude === b.longitude)
  )
}

/**
 * Leaves out `appearInstantly` and `glideFrom`, which only matter when the
 * bubble mounts.
 */
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
    prev.accessibilityLabel === next.accessibilityLabel &&
    prev.tracksViewChanges === next.tracksViewChanges &&
    prev.fadeInDuration === next.fadeInDuration &&
    prev.fadeOutDuration === next.fadeOutDuration &&
    prev.exiting === next.exiting &&
    sameLatLng(prev.glideTo, next.glideTo) &&
    prev.glideDuration === next.glideDuration
  )
}

export { areClusterMarkerPropsEqual }

export default memo(ClusterMarker, areClusterMarkerPropsEqual)
