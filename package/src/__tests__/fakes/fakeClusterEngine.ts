/**
 * A JavaScript stand-in for the native `ClusterEngine` Nitro HybridObject,
 * backed by the real `supercluster` (v8, the line react-native-map-clustering
 * uses). It speaks the same API as `specs/ClusterEngine.nitro.ts`, including
 * both `packPoints` buffer layouts, so the TypeScript layers above it
 * (`Supercluster`, `useClusterer`, `MapView`) run unmodified.
 *
 * Deliberately test-runner agnostic — no `bun:test` or `jest` imports — so it
 * can later ship as a mock for consumers' own test suites. Wire it up at the
 * call site, e.g. by mocking `react-native-nitro-modules` so that
 * `NitroModules.createHybridObject('ClusterEngine')` returns
 * `createFakeClusterEngine()`.
 *
 * It follows supercluster semantics, not the C++ engine's: behaviour that the
 * native engine gets wrong (see the audit issues) is correct here, which is
 * what JS-layer tests want.
 */
import Supercluster from 'supercluster'

import type { ClusterEngineOptions } from '../../specs/ClusterEngineOptions'
import type { EngineClusterNode } from '../../specs/EngineClusterNode'
import type { ReducerKind } from '../../specs/ReducerKind'
import type { Viewport } from '../../specs/Viewport'

/** The subset of the `ClusterEngine` HybridObject the library calls. */
export interface FakeClusterEngine {
  setOptions(options: ClusterEngineOptions): void
  setPoints(buffer: ArrayBuffer): void
  build(): void
  buildAsync(): Promise<void>
  getClusters(viewport: Viewport): EngineClusterNode[]
  getChildren(clusterId: number): EngineClusterNode[]
  getLeaves(
    clusterId: number,
    limit: number,
    offset: number
  ): EngineClusterNode[]
  getClusterExpansionZoom(clusterId: number): number
  readonly isBuilt: boolean
  readonly pointCount: number
}

/** Counters shared by every fake engine, for asserting native traffic. */
export interface FakeClusterEngineStats {
  created: number
  builds: number
  getClusters: number
  getLeaves: number
  getChildren: number
  getClusterExpansionZoom: number
}

export const fakeClusterEngineStats: FakeClusterEngineStats = {
  created: 0,
  builds: 0,
  getClusters: 0,
  getLeaves: 0,
  getChildren: 0,
  getClusterExpansionZoom: 0,
}

export function resetFakeClusterEngineStats(): void {
  for (const key of Object.keys(fakeClusterEngineStats)) {
    fakeClusterEngineStats[key as keyof FakeClusterEngineStats] = 0
  }
}

// Must match PACK_POINTS_MAGIC_V2 in utils/packPoints.ts.
const MAGIC_V2 = 0x4e4d4332

interface PointProps {
  index: number
  values: number[]
}

interface ClusterProps {
  values: number[]
}

type Feature = Supercluster.PointFeature<PointProps>
type Result =
  | Supercluster.PointFeature<PointProps>
  | Supercluster.ClusterFeature<ClusterProps>

function reduceValue(kind: ReducerKind, acc: number, value: number): number {
  switch (kind) {
    case 'sum':
      return acc + value
    case 'min':
      return Math.min(acc, value)
    case 'max':
      return Math.max(acc, value)
  }
}

function parseBuffer(buffer: ArrayBuffer): Feature[] {
  const view = new DataView(buffer)
  const isV2 = view.getUint32(0, true) === MAGIC_V2
  const count = view.getUint32(isV2 ? 4 : 0, true)
  const numProps = isV2 ? view.getUint32(8, true) : 0
  const stride = 20 + numProps * 8
  let offset = isV2 ? 12 : 4

  const features: Feature[] = []
  for (let i = 0; i < count; i++) {
    const index = view.getInt32(offset, true)
    const latitude = view.getFloat64(offset + 4, true)
    const longitude = view.getFloat64(offset + 12, true)
    const values: number[] = []
    for (let k = 0; k < numProps; k++) {
      values.push(view.getFloat64(offset + 20 + k * 8, true))
    }
    offset += stride
    // The native engine drops non-finite coordinates on ingest.
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue
    features.push({
      type: 'Feature',
      properties: { index, values },
      geometry: { type: 'Point', coordinates: [longitude, latitude] },
    })
  }
  return features
}

function toNode(feature: Result): EngineClusterNode {
  const [longitude, latitude] = feature.geometry.coordinates
  const properties = feature.properties
  if ('cluster' in properties && properties.cluster) {
    return {
      id: properties.cluster_id,
      latitude: latitude!,
      longitude: longitude!,
      count: properties.point_count,
      isCluster: true,
      parentId: -1,
      pointIndex: -1,
      values: properties.values ?? [],
    }
  }
  const point = properties as PointProps
  return {
    id: point.index,
    latitude: latitude!,
    longitude: longitude!,
    count: 1,
    isCluster: false,
    parentId: -1,
    pointIndex: point.index,
    values: point.values,
  }
}

export function createFakeClusterEngine(): FakeClusterEngine {
  fakeClusterEngineStats.created++

  let options: ClusterEngineOptions | null = null
  let points: Feature[] = []
  let index: Supercluster<PointProps, ClusterProps> | null = null
  let built = false

  const requireIndex = (): Supercluster<PointProps, ClusterProps> => {
    if (!built || index == null) {
      // Same contract as the native engine.
      throw new Error(
        'ClusterEngine: call build() or buildAsync() before querying.'
      )
    }
    return index
  }

  const engine: FakeClusterEngine = {
    setOptions(next) {
      options = next
      built = false
    },
    setPoints(buffer) {
      if (buffer == null) {
        throw new Error('ClusterEngine: setPoints() requires an ArrayBuffer.')
      }
      points = parseBuffer(buffer)
      built = false
    },
    build() {
      if (options == null) {
        throw new Error('ClusterEngine: call setOptions() before build().')
      }
      const { reducers } = options
      fakeClusterEngineStats.builds++
      index = new Supercluster<PointProps, ClusterProps>({
        radius: options.radius,
        extent: options.extent,
        minZoom: options.minZoom,
        maxZoom: options.maxZoom,
        minPoints: options.minPoints,
        nodeSize: options.nodeSize,
        map: (props) => ({ values: [...props.values] }),
        reduce: (acc, props) => {
          acc.values = acc.values.map((value, k) =>
            reduceValue(reducers[k]!, value, props.values[k] ?? 0)
          )
        },
      }).load(points)
      built = true
    },
    buildAsync() {
      // The native build runs on a thread pool and resolves on a later tick.
      return new Promise<void>((resolve, reject) => {
        setTimeout(() => {
          try {
            engine.build()
            resolve()
          } catch (error) {
            reject(error)
          }
        }, 0)
      })
    },
    getClusters(viewport) {
      fakeClusterEngineStats.getClusters++
      return requireIndex()
        .getClusters(
          [viewport.west, viewport.south, viewport.east, viewport.north],
          viewport.zoom
        )
        .map(toNode)
    },
    getChildren(clusterId) {
      fakeClusterEngineStats.getChildren++
      return requireIndex().getChildren(clusterId).map(toNode)
    },
    getLeaves(clusterId, limit, offset) {
      fakeClusterEngineStats.getLeaves++
      return requireIndex()
        .getLeaves(clusterId, limit <= 0 ? Infinity : limit, offset)
        .map(toNode)
    },
    getClusterExpansionZoom(clusterId) {
      fakeClusterEngineStats.getClusterExpansionZoom++
      return requireIndex().getClusterExpansionZoom(clusterId)
    },
    get isBuilt() {
      return built
    },
    get pointCount() {
      return points.length
    },
  }
  return engine
}
