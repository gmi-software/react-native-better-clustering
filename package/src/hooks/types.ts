import type { SuperclusterOptions } from '../engine/types'

/**
 * Options for `useClusterer`: the {@linkcode SuperclusterOptions} that configure
 * the index, plus how a failed build is reported.
 */
export interface UseClustererOptions extends SuperclusterOptions {
  /**
   * Called when the native index fails to build, for example because the app
   * was not rebuilt after installing the library. Clusters from an earlier
   * successful build keep showing.
   *
   * Without it, the error is thrown during render, so the nearest error
   * boundary (and LogBox in development) shows it. A build that is superseded
   * or unmounted before it finishes is never reported.
   */
  onError?: (error: Error) => void
}
