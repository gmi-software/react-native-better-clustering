import { Supercluster as BetterSupercluster } from 'react-native-better-clustering/engine'
import { useClusterer as useBetterClusterer } from 'react-native-better-clustering/hooks'
import type { PointFeature } from 'react-native-better-clustering/geojson'
import ClustererSupercluster, {
  useClusterer as useClustererClusterer,
} from 'react-native-clusterer'
import type { Region } from 'react-native-maps'
import Supercluster from 'supercluster'
import useSupercluster from 'use-supercluster'

// Inlined by babel-preset-expo at bundle time.
declare const process: { env: Record<string, string | undefined> }

/**
 * The options every library gets: react-native-clusterer's and supercluster's
 * defaults, spelled as an app migrating from them would keep them. Module
 * scope, so no library sees a new object on a re-render.
 */
export const HOOK_OPTIONS = {
  radius: 40,
  minZoom: 0,
  maxZoom: 16,
  minPoints: 2,
  extent: 512,
}

export interface MapDimensions {
  width: number
  height: number
}

export type HookLibraryId = 'rnc' | 'usc' | 'rnbc'

export interface HookLibrary {
  id: HookLibraryId
  name: string
  version: string
  /**
   * The library's hook, called the way its README calls it. `index` is the
   * object it returns for queries, so a new one means a new index.
   */
  useClusters(
    data: PointFeature[],
    dimensions: MapDimensions,
    region: Region
  ): { features: readonly unknown[]; index: unknown }
  /**
   * Builds one index outside React, as the hook does. `jsMs` is the part that
   * blocks the JS thread, `totalMs` the time until the index answers queries.
   */
  buildOnce(data: PointFeature[]): Promise<{ jsMs: number; totalMs: number }>
}

/** Index builds the libraries started, counted at the method each hook calls. */
export const hookBuilds = { count: 0 }

function countCalls<T extends object>(prototype: T, method: keyof T) {
  const original = prototype[method] as (...args: unknown[]) => unknown
  prototype[method] = function (this: unknown, ...args: unknown[]) {
    hookBuilds.count += 1
    return original.apply(this, args)
  } as T[keyof T]
}

countCalls(ClustererSupercluster.prototype, 'load')
countCalls(Supercluster.prototype, 'load')
countCalls(BetterSupercluster.prototype, 'loadAsync')

/** use-supercluster takes a bbox and a zoom: the region's own bbox, and the zoom its width spans. */
function regionToBoundsAndZoom(region: Region) {
  return {
    bounds: [
      region.longitude - region.longitudeDelta / 2,
      region.latitude - region.latitudeDelta / 2,
      region.longitude + region.longitudeDelta / 2,
      region.latitude + region.latitudeDelta / 2,
    ] as [number, number, number, number],
    zoom: Math.log2(360 / region.longitudeDelta),
  }
}

export const HOOK_LIBRARIES: Record<HookLibraryId, HookLibrary> = {
  rnc: {
    id: 'rnc',
    name: 'react-native-clusterer',
    version: '5.0.2',
    useClusters(data, dimensions, region) {
      const [features, index] = useClustererClusterer(
        data,
        dimensions,
        region,
        HOOK_OPTIONS
      )
      return { features, index }
    },
    async buildOnce(data) {
      const start = performance.now()
      new ClustererSupercluster(HOOK_OPTIONS).load(data)
      const ms = performance.now() - start
      return { jsMs: ms, totalMs: ms }
    },
  },
  usc: {
    id: 'usc',
    name: 'use-supercluster',
    version: '1.2.0',
    useClusters(data, _dimensions, region) {
      const { bounds, zoom } = regionToBoundsAndZoom(region)
      const { clusters, supercluster } = useSupercluster({
        points: data,
        bounds,
        zoom,
        options: HOOK_OPTIONS,
      })
      return { features: clusters, index: supercluster }
    },
    async buildOnce(data) {
      const start = performance.now()
      new Supercluster(HOOK_OPTIONS).load(data)
      const ms = performance.now() - start
      return { jsMs: ms, totalMs: ms }
    },
  },
  rnbc: {
    id: 'rnbc',
    name: 'react-native-better-clustering',
    version: process.env.EXPO_PUBLIC_BENCH_RNBC_VERSION ?? 'main',
    useClusters(data, dimensions, region) {
      const [features, index] = useBetterClusterer(
        data,
        dimensions,
        region,
        HOOK_OPTIONS
      )
      return { features, index }
    },
    async buildOnce(data) {
      const engine = new BetterSupercluster(HOOK_OPTIONS)
      const start = performance.now()
      const loaded = engine.loadAsync(data)
      const jsMs = performance.now() - start
      await loaded
      const totalMs = performance.now() - start
      engine.destroy()
      return { jsMs, totalMs }
    },
  },
}
