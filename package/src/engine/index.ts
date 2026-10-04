export {
  DEFAULT_MAX_ZOOM,
  DEFAULT_MIN_ZOOM,
  DEFAULT_SUPERCLUSTER_OPTIONS,
} from './defaults'
export { Supercluster } from './Supercluster'
export type {
  SuperclusterOptions,
  ClusterPropertyConfig,
  ReducerKind,
} from './types'

export {
  bboxToViewport,
  clusterZoomFromRegion,
  coordinatesToRegion,
  isValidRegion,
  regionToBBox,
} from './geometry'
export type { MapDimensions } from './geometry'

export type { ClusterEngine } from '../specs/ClusterEngine.nitro'
export type { ClusterEngineOptions } from '../specs/ClusterEngineOptions'
export type { EngineClusterNode } from '../specs/EngineClusterNode'
export type { Viewport } from '../specs/Viewport'

import type { ClusterEngine } from '../specs/ClusterEngine.nitro'
import { createNativeClusterEngine } from './createNativeClusterEngine'

/**
 * Create a standalone C++ cluster engine for headless use.
 *
 * Follow the lifecycle documented on {@linkcode ClusterEngine}: `setOptions` → `setPoints`
 * → `build` or `buildAsync` → query. Check {@linkcode ClusterEngine.isBuilt isBuilt} before
 * querying when options or points may have changed.
 *
 * @throws When the native module is missing from the app binary: the app was not
 * rebuilt after installing the library, or it runs in Expo Go.
 * @see {@linkcode Supercluster}
 */
export function createClusterEngine(): ClusterEngine {
  return createNativeClusterEngine()
}
