/**
 * Counters behind the dev HUD. Written from effects and refs, never during
 * render, and sampled by the HUD on a timer, so counting never re-renders a
 * scenario.
 */
export const stats = {
  /** `CountedMarker`s mounted right now. */
  markersMounted: 0,
  /** `CountedMarker` mounts since the last reset. */
  markerMounts: 0,
  /** Cluster indexes `MapView` built and swapped in since the last reset. */
  engineBuilds: 0,
}

/** Resets the counters; `markersMounted` is a live gauge, so it stays. */
export function resetStats(): void {
  stats.markerMounts = 0
  stats.engineBuilds = 0
}

/** Records a mount and returns the matching unmount, for an effect. */
export function recordMarkerMount(): () => void {
  stats.markersMounted += 1
  stats.markerMounts += 1
  return () => {
    stats.markersMounted -= 1
  }
}

export function recordEngineBuild(): void {
  stats.engineBuilds += 1
}
