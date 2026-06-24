import { useEffect, useReducer, useRef } from 'react'

/**
 * A keyed item to render. `data` carries whatever the consumer needs to render
 * the element for {@linkcode key}.
 */
export interface PresenceItem<T> {
  key: string
  data: T
}

/**
 * A presence entry returned by {@linkcode useFadePresence}. `exiting` is `true`
 * while the item has been removed from the input but is still mounted so it can
 * play an exit animation before {@linkcode useFadePresence} drops it.
 */
export interface PresenceEntry<T> {
  key: string
  data: T
  exiting: boolean
}

/**
 * Keeps removed items mounted for {@linkcode exitDurationMs} so they can animate
 * out, enabling a cross-fade between successive item sets.
 *
 * `react-native-maps` markers are native annotations that vanish the instant
 * React unmounts them; on zoom the whole cluster set is rebuilt, so without a
 * lingering exit phase the old bubbles blink out before the new ones fade in.
 * This hook returns the current items (newest `data`) plus any recently removed
 * items flagged `exiting`, dropping each once its timer elapses (or immediately
 * when `exitDurationMs <= 0`).
 *
 * Re-adding a key before its timer fires cancels the exit and revives the entry.
 */
export function useFadePresence<T>(
  items: ReadonlyArray<PresenceItem<T>>,
  exitDurationMs: number
): Array<PresenceEntry<T>> {
  const [, forceRender] = useReducer((count: number) => count + 1, 0)
  const entriesRef = useRef<Map<string, PresenceItem<T>>>(new Map())
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map()
  )

  const output: Array<PresenceEntry<T>> = []
  const currentKeys = new Set<string>()

  for (const item of items) {
    currentKeys.add(item.key)
    output.push({ key: item.key, data: item.data, exiting: false })
  }

  // Append keys dropped from `items` in this render so they stay mounted for
  // fade-out. Removed keys must be detected here — not only in the effect —
  // otherwise React commits one frame without the bubble before the effect runs.
  if (exitDurationMs > 0) {
    for (const [key, entry] of entriesRef.current) {
      if (!currentKeys.has(key)) {
        output.push({ key: entry.key, data: entry.data, exiting: true })
      }
    }
  }

  useEffect(() => {
    const entries = entriesRef.current
    const timers = timersRef.current
    const keysInItems = new Set<string>()

    for (const item of items) {
      keysInItems.add(item.key)
      entries.set(item.key, { key: item.key, data: item.data })
      const pendingTimer = timers.get(item.key)
      if (pendingTimer != null) {
        clearTimeout(pendingTimer)
        timers.delete(item.key)
      }
    }

    for (const key of [...entries.keys()]) {
      if (keysInItems.has(key)) {
        continue
      }
      if (exitDurationMs <= 0) {
        const pendingTimer = timers.get(key)
        if (pendingTimer != null) {
          clearTimeout(pendingTimer)
          timers.delete(key)
        }
        entries.delete(key)
        continue
      }
      if (!timers.has(key)) {
        const timer = setTimeout(() => {
          timers.delete(key)
          entriesRef.current.delete(key)
          forceRender()
        }, exitDurationMs)
        timers.set(key, timer)
      }
    }
  }, [items, exitDurationMs])

  useEffect(() => {
    const timers = timersRef.current
    return () => {
      for (const timer of timers.values()) {
        clearTimeout(timer)
      }
      timers.clear()
    }
  }, [])

  return output
}
