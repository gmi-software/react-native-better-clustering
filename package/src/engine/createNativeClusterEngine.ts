import { NitroModules } from 'react-native-nitro-modules'
import type { ClusterEngine } from '../specs/ClusterEngine.nitro'

/**
 * Creates the native {@linkcode ClusterEngine}, turning a native module that is
 * missing from the app binary into an error that says how to fix it.
 *
 * @throws When the `ClusterEngine` native module is not registered: the app was
 * not rebuilt after installing the library, or it runs in Expo Go. The original
 * error is kept as `cause`.
 */
export function createNativeClusterEngine(): ClusterEngine {
  try {
    return NitroModules.createHybridObject<ClusterEngine>('ClusterEngine')
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(
      'react-native-better-clustering: the native ClusterEngine module is not available. ' +
        'Rebuild the app after installing the library (`pod install` on iOS, a Gradle build on Android, ' +
        'or `npx expo prebuild` and a development build with Expo); Expo Go is not supported. ' +
        `Cause: ${reason}`,
      { cause: error }
    )
  }
}
