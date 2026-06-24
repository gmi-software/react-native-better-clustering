import type { Region } from 'react-native-maps'

export interface ThrottleRegionSyncState {
  lastSyncAt: number
  latestRegion: Region | null
  timerId: ReturnType<typeof setTimeout> | null
}

export function createThrottleRegionSyncState(): ThrottleRegionSyncState {
  return {
    lastSyncAt: Number.NEGATIVE_INFINITY,
    latestRegion: null,
    timerId: null,
  }
}

export interface ThrottleRegionSyncDeps {
  intervalMs: number
  now?: () => number
  schedule?: (
    callback: () => void,
    delayMs: number
  ) => ReturnType<typeof setTimeout>
  clearSchedule?: (timerId: ReturnType<typeof setTimeout>) => void
}

/**
 * Throttles cluster region syncs during continuous map movement.
 *
 * When `intervalMs` is 0, skips in-gesture syncs (caller should flush on settle).
 * Otherwise performs an immediate sync when the interval has elapsed (leading edge)
 * and schedules a trailing sync for the latest region when calls arrive faster
 * than `intervalMs`.
 */
export function scheduleThrottledRegionSync(
  region: Region,
  sync: (region: Region) => void,
  state: ThrottleRegionSyncState,
  deps: ThrottleRegionSyncDeps
): void {
  state.latestRegion = region

  if (deps.intervalMs <= 0) {
    return
  }

  const now = deps.now?.() ?? Date.now()
  const elapsed = now - state.lastSyncAt

  if (elapsed >= deps.intervalMs) {
    const clearSchedule = deps.clearSchedule ?? clearTimeout
    if (state.timerId != null) {
      clearSchedule(state.timerId)
      state.timerId = null
    }
    sync(region)
    state.lastSyncAt = now
    return
  }

  if (state.timerId != null) {
    return
  }

  const schedule = deps.schedule ?? setTimeout
  const delay = deps.intervalMs - elapsed

  state.timerId = schedule(() => {
    state.timerId = null
    const latestRegion = state.latestRegion
    if (latestRegion == null) {
      return
    }
    sync(latestRegion)
    state.lastSyncAt = deps.now?.() ?? Date.now()
  }, delay)
}

/** Cancels any pending trailing sync and performs an immediate sync. */
export function flushThrottledRegionSync(
  region: Region,
  sync: (region: Region) => void,
  state: ThrottleRegionSyncState,
  deps: Pick<ThrottleRegionSyncDeps, 'now' | 'clearSchedule'> = {}
): void {
  const clearSchedule = deps.clearSchedule ?? clearTimeout

  if (state.timerId != null) {
    clearSchedule(state.timerId)
    state.timerId = null
  }

  state.latestRegion = region
  sync(region)
  state.lastSyncAt = deps.now?.() ?? Date.now()
}

/** Clears a pending trailing sync without syncing (e.g. on unmount). */
export function cancelThrottledRegionSync(
  state: ThrottleRegionSyncState,
  clearSchedule: typeof clearTimeout = clearTimeout
): void {
  if (state.timerId != null) {
    clearSchedule(state.timerId)
    state.timerId = null
  }
}
