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
  /** Live fleet: position updates sent to the map since the last reset. */
  fleetUpdates: 0,
  /** Live fleet: mounts of the markers that never move, since the last reset. */
  staticMarkerMounts: 0,
  /**
   * Live fleet: how long the newest update the index serves took to get
   * there, in ms. `null` until one has, since the last reset.
   */
  indexLagMs: null as number | null,
  /** Live fleet: the longest `indexLagMs` since the last reset. */
  maxIndexLagMs: null as number | null,
}

/** Resets the counters; `markersMounted` is a live gauge, so it stays. */
export function resetStats(): void {
  stats.markerMounts = 0
  stats.engineBuilds = 0
  stats.fleetUpdates = 0
  stats.staticMarkerMounts = 0
  stats.indexLagMs = null
  stats.maxIndexLagMs = null
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

export function recordFleetUpdate(): void {
  stats.fleetUpdates += 1
}

export function recordStaticMarkerMount(): void {
  stats.staticMarkerMounts += 1
}

export function recordIndexLag(lagMs: number): void {
  stats.indexLagMs = lagMs
  stats.maxIndexLagMs = Math.max(stats.maxIndexLagMs ?? 0, lagMs)
}
