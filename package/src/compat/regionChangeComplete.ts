let warnedTwoParameterHandler = false

/**
 * Tells the developer, once and in development only, that an
 * `onRegionChangeComplete` handler declaring two parameters may expect
 * react-native-map-clustering 3.x's `(region, markers)`.
 *
 * `MapView` calls it with 4.x's `(region, details, markers)`, so a 3.x handler
 * reads `details` as the markers, and a handler with untyped parameters still
 * type-checks. `Function.length` stops at the first parameter with a default
 * value, so such a handler is not reported.
 */
export function warnTwoParameterRegionChangeComplete(
  handler: (...args: never[]) => unknown
): void {
  if (warnedTwoParameterHandler || handler.length !== 2) {
    return
  }

  // `__DEV__` is a React Native global; absent outside RN, so default to warning.
  if (typeof __DEV__ !== 'undefined' && !__DEV__) {
    return
  }

  warnedTwoParameterHandler = true
  console.warn(
    'react-native-better-clustering: onRegionChangeComplete is called with (region, details, markers), as in react-native-map-clustering 4.x. ' +
      'Your handler declares two parameters: if it was written for 3.x as (region, markers), its second argument is now the `details` of react-native-maps, so read the markers from the third. ' +
      'A handler that means (region, details) can declare the third parameter to silence this notice.'
  )
}
