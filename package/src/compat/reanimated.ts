import type * as ReanimatedModule from 'react-native-reanimated'

export type Reanimated = typeof ReanimatedModule

let loadError: unknown

function loadReanimated(): Reanimated | null {
  try {
    // Metro bundles a `require` whose statement sits directly in a `try` block
    // as an optional dependency: an app without Reanimated still bundles, and
    // the call throws here instead.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('react-native-reanimated') as Reanimated
  } catch (error) {
    loadError = error
    return null
  }
}

/**
 * `react-native-reanimated`, or `null` when the app does not include it or it
 * fails to load.
 *
 * Reanimated is an optional peer dependency: it only drives the fade of the
 * default cluster bubbles, which are plain markers without it.
 */
export const reanimated = loadReanimated()

let warnedFadeUnavailable = false

/**
 * Tells the developer, once and in development only, that cluster bubbles do
 * not fade because Reanimated is unavailable.
 */
export function warnFadeUnavailable(): void {
  if (warnedFadeUnavailable) {
    return
  }

  // `__DEV__` is a React Native global; absent outside RN, so default to warning.
  if (typeof __DEV__ !== 'undefined' && !__DEV__) {
    return
  }

  warnedFadeUnavailable = true
  const cause =
    loadError instanceof Error ? loadError.message : String(loadError)
  console.warn(
    'react-native-better-clustering: react-native-reanimated is not available, so cluster bubbles appear without a fade. ' +
      'Install and set up react-native-reanimated (^4.1.0) to enable it, or pass `clusterFadeInDuration={0}` to silence this notice. ' +
      `Cause: ${cause}`
  )
}
