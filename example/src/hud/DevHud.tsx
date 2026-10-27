import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { resetStats, stats } from './stats'

const SAMPLE_INTERVAL_MS = 500

interface Sample {
  fps: number
  markersMounted: number
  markerMounts: number
  engineBuilds: number
}

/**
 * JS FPS, marker mounts and engine builds, sampled twice a second. It owns its
 * state, so its updates never re-render the scenario under it.
 */
export function DevHud() {
  const [sample, setSample] = useState<Sample>(() => ({ fps: 0, ...stats }))

  useEffect(() => {
    // A frame callback runs only when the JS thread is free, so the callback
    // rate is the JS frame rate.
    let frames = 0
    let frameId = requestAnimationFrame(function countFrame() {
      frames += 1
      frameId = requestAnimationFrame(countFrame)
    })
    let sampledAt = performance.now()
    const interval = setInterval(() => {
      const now = performance.now()
      setSample({
        fps: Math.round((frames * 1000) / (now - sampledAt)),
        ...stats,
      })
      frames = 0
      sampledAt = now
    }, SAMPLE_INTERVAL_MS)

    return () => {
      cancelAnimationFrame(frameId)
      clearInterval(interval)
    }
  }, [])

  return (
    <View style={styles.hud} pointerEvents="box-none">
      <Text style={styles.line} testID="hud-fps">
        JS FPS: {sample.fps}
      </Text>
      <Text style={styles.line} testID="hud-markers-mounted">
        Markers mounted: {sample.markersMounted}
      </Text>
      <Text style={styles.line} testID="hud-marker-mounts">
        Marker mounts: {sample.markerMounts}
      </Text>
      <Text style={styles.line} testID="hud-engine-builds">
        Engine builds: {sample.engineBuilds}
      </Text>
      <Pressable
        accessibilityRole="button"
        hitSlop={8}
        onPress={() => {
          resetStats()
          setSample((previous) => ({ ...previous, ...stats }))
        }}
        style={styles.reset}
        testID="hud-reset"
      >
        <Text style={styles.resetLabel}>Reset counters</Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  hud: {
    position: 'absolute',
    top: 8,
    right: 8,
    padding: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(17, 24, 39, 0.82)',
  },
  line: {
    color: '#F9FAFB',
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  reset: {
    marginTop: 6,
    paddingVertical: 4,
    borderRadius: 4,
    backgroundColor: 'rgba(249, 250, 251, 0.18)',
  },
  resetLabel: {
    color: '#F9FAFB',
    fontSize: 12,
    textAlign: 'center',
  },
})
