import { useState, type MutableRefObject } from 'react'
import type { Supercluster } from 'react-native-better-clustering/engine'
import { recordEngineBuild } from './stats'

/**
 * A `superClusterRef` for `MapView` that counts engine builds for the dev HUD.
 *
 * `MapView` assigns the ref each time it swaps in a newly built index, and
 * each build is a new `Supercluster`, so counting the loaded instances it has
 * not seen counts builds. The placeholder before the first build is never
 * loaded, and toggling clustering off and on reassigns a seen instance.
 */
export function useEngineBuildCounter(): MutableRefObject<Supercluster | null> {
  const [ref] = useState(() => {
    const seen = new WeakSet<Supercluster>()
    let current: Supercluster | null = null
    return {
      get current() {
        return current
      },
      set current(next: Supercluster | null) {
        if (next != null && next.isLoaded && !seen.has(next)) {
          seen.add(next)
          recordEngineBuild()
        }
        current = next
      },
    }
  })
  return ref
}
