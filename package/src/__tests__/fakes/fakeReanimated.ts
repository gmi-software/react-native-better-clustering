/**
 * The parts of `react-native-reanimated` the library uses, shaped like what
 * `require('react-native-reanimated')` returns under Metro: the CommonJS exports
 * object, with the hooks as named exports and `Animated` as `default`.
 *
 * The library loads Reanimated through an optional `require`
 * (`compat/reanimated.ts`). Register the fake as the whole module:
 *
 *   mock.module('react-native-reanimated', () => fakeReanimated)
 *
 * Keep `__esModule` out of it: with that key, Bun's `require` of the mock
 * returns its `default` export instead of the module.
 *
 * The hooks run synchronously: `useAnimatedProps` returns its worklet's result
 * and `withTiming` its target value.
 */
export const fakeReanimated = {
  default: {
    createAnimatedComponent: <T>(component: T): T => component,
  },
  useSharedValue: <T>(value: T) => ({ value }),
  useAnimatedProps: <T>(worklet: () => T): T => worklet(),
  withTiming: <T>(value: T): T => value,
}
