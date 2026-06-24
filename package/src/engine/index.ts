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

import { NitroModules } from 'react-native-nitro-modules'
import type { ClusterEngine } from '../specs/ClusterEngine.nitro'
import type { Supercluster } from './Supercluster'

/**
 * Create a standalone C++ cluster engine for headless use.
 *
 * Follow the lifecycle documented on {@linkcode ClusterEngine}: `setOptions` → `setPoints`
 * → `build` or `buildAsync` → query. Check {@linkcode ClusterEngine.isBuilt isBuilt} before
 * querying when options or points may have changed.
 *
 * @see {@linkcode Supercluster}
 */
export function createClusterEngine(): ClusterEngine {
  return NitroModules.createHybridObject<ClusterEngine>('ClusterEngine')
}
