import { NitroModules } from 'react-native-nitro-modules'

import type { AnyProps, BBox, ClusterFeature, PointFeature } from '../geojson'
import type { ClusterEngine } from '../specs/ClusterEngine.nitro'
import type { EngineClusterNode } from '../specs/EngineClusterNode'
import type { MapRegion } from '../types'
import { packPoints } from '../utils/packPoints'
import {
  aggregatedPropsFromValues,
  extractGeoJSONAggregationValues,
} from '../utils/clusterProperties'
import {
  bboxToViewport,
  clusterZoomFromRegion,
  coordinatesToRegion,
  isValidRegion,
  regionToBBox,
  type MapDimensions,
} from './geometry'

import { createNativeClusterEngine } from './createNativeClusterEngine'
import { DEFAULT_SUPERCLUSTER_OPTIONS } from './defaults'
import type { SuperclusterOptions, ClusterPropertyConfig } from './types'
import {
  validateClusterId,
  validateSuperclusterOptions,
} from './validateOptions'
import { partitionValidPoints, warnSkippedPoints } from './validatePoints'

export type { SuperclusterOptions, ClusterPropertyConfig }

// Nitro tells the JS GC how much native memory a HybridObject holds only when
// the object crosses into JS, which happened while the engine was still empty.
// The round trip after a build reports the index's real size.
function reportNativeMemory(engine: ClusterEngine): void {
  NitroModules.updateMemorySize(engine)
}

function abbreviateCount(count: number): string {
  if (count >= 1_000_000) {
    return `${Math.round(count / 100_000) / 10}m`
  }
  if (count >= 1_000) {
    return `${Math.round(count / 100) / 10}k`
  }
  return String(count)
}

/**
 * High-level JavaScript wrapper around {@linkcode ClusterEngine} with GeoJSON I/O.
 *
 * Load points once with {@linkcode Supercluster.load} or {@linkcode Supercluster.loadAsync},
 * query clusters, then call {@linkcode Supercluster.destroy} when done.
 *
 * @see `createClusterEngine`
 */
export class Supercluster<P extends AnyProps = AnyProps> {
  private engine: ClusterEngine | null = null
  private loadedFeatures: PointFeature<P>[] = []
  private readonly minLeafIndices = new WeakMap<ClusterFeature<P>, number>()
  private destroyed = false
  private building = false
  private readonly options: Required<SuperclusterOptions>

  /**
   * Creates a clusterer with {@linkcode SuperclusterOptions}.
   *
   * Options are snapshotted at construction; mutating a passed object afterward has no effect.
   */
  constructor(options?: SuperclusterOptions) {
    const resolved = { ...DEFAULT_SUPERCLUSTER_OPTIONS, ...options }

    // `viewportTileSize` defaults to `extent` rather than to a fixed number,
    // so a custom `extent` keeps react-native-clusterer's zoom selection.
    this.options = {
      ...resolved,
      viewportTileSize: options?.viewportTileSize ?? resolved.extent,
    }
  }

  /** Whether the native cluster index has finished building. */
  get isLoaded(): boolean {
    return !this.destroyed && (this.engine?.isBuilt ?? false)
  }

  /**
   * Loads points and builds the cluster index synchronously on the JS thread.
   *
   * @throws A `RangeError` naming the first invalid option (see {@linkcode SuperclusterOptions}).
   * @throws When called more than once on the same instance.
   * @throws When the instance was {@linkcode Supercluster.destroy destroyed}.
   * @throws When the native module is missing from the app binary.
   */
  load(points: PointFeature<P>[]): this {
    this.throwIfDestroyed()

    if (this.engine != null) {
      throw new Error(
        'react-native-better-clustering: The .load() or .loadAsync() method can only be called once.'
      )
    }

    const engine = this.prepareEngine(points)
    engine.build()
    this.engine = engine
    reportNativeMemory(engine)
    return this
  }

  /**
   * Loads points and builds the cluster index without blocking the JS thread.
   *
   * Prefer this for large datasets (10k+ points).
   *
   * @throws A `RangeError` naming the first invalid option (see {@linkcode SuperclusterOptions}).
   * @throws When called more than once on the same instance.
   * @throws When the instance was destroyed during the async build.
   * @throws When the native module is missing from the app binary.
   */
  async loadAsync(points: PointFeature<P>[]): Promise<this> {
    this.throwIfDestroyed()

    if (this.engine != null) {
      throw new Error(
        'react-native-better-clustering: The .load() or .loadAsync() method can only be called once.'
      )
    }

    const engine = this.prepareEngine(points)
    this.engine = engine
    this.building = true

    // destroy() leaves an engine that is still building to be disposed here,
    // once the build has settled.
    try {
      await engine.buildAsync()
    } catch (error) {
      this.engine = null
      engine.dispose()
      throw error
    } finally {
      this.building = false
    }

    if (this.destroyed) {
      engine.dispose()
      throw new Error(
        'react-native-better-clustering: this Supercluster instance was destroyed during load.'
      )
    }

    reportNativeMemory(engine)
    return this
  }

  /**
   * Swaps the point features that queries return for an array with the same
   * coordinates in the same order, without rebuilding the native index.
   *
   * @internal `useClusterer` calls this when only properties the engine never
   * sees changed, so leaves carry the latest properties. The caller guarantees
   * the coordinates match; only the length is checked here. Points with
   * non-finite coordinates are skipped, as on load, so the swapped features
   * stay index-aligned with the native index.
   * @throws When the instance was destroyed or has not been loaded.
   * @throws When `points` has a different number of indexable points than were loaded.
   */
  replaceLoadedFeatures(points: PointFeature<P>[]): void {
    this.throwIfNotInitialized()

    const { valid } = partitionValidPoints(points)
    if (valid.length !== this.loadedFeatures.length) {
      throw new Error(
        'react-native-better-clustering: replaceLoadedFeatures() needs as many points as were loaded.'
      )
    }

    this.loadedFeatures = valid
  }

  /**
   * Releases native resources held by this instance.
   *
   * Frees the native index right away, or as soon as a pending
   * {@linkcode Supercluster.loadAsync loadAsync} build settles, instead of
   * waiting for garbage collection.
   *
   * Idempotent — safe to call multiple times. Further queries throw.
   */
  destroy(): void {
    if (this.destroyed) {
      return
    }

    const engine = this.engine
    this.destroyed = true
    this.engine = null
    this.loadedFeatures = []

    if (engine != null && !this.building) {
      engine.dispose()
    }
  }

  /**
   * Returns clusters visible in a geographic {@linkcode BBox} at the given zoom.
   *
   * As in supercluster, the zoom is floored and clamped to `minZoom` through
   * `maxZoom + 1`: above `maxZoom` every point in the bbox is returned on its
   * own, unclustered. A bbox across the antimeridian can be unwrapped
   * (`[170, s, 190, n]`) or wrapped (`[170, s, -170, n]`), and one spanning 360°
   * or more returns the whole world.
   *
   * @throws When {@linkcode Supercluster.load load} has not completed.
   */
  getClusters(
    bbox: BBox,
    zoom: number
  ): Array<PointFeature<P> | ClusterFeature<P>> {
    this.throwIfNotInitialized()

    const viewport = bboxToViewport(bbox, zoom)
    return this.engine!.getClusters(viewport).map((feature) =>
      this.engineFeatureToGeoJSON(feature)
    )
  }

  /**
   * Returns clusters visible for a {@linkcode MapRegion} and {@linkcode MapDimensions}.
   *
   * Zoomed in past `maxZoom`, it returns every point on its own, as
   * react-native-clusterer does (see {@linkcode Supercluster.getClusters getClusters}).
   *
   * Returns `[]` while loading, when the region is invalid, or when dimensions are non-positive.
   */
  getClustersFromRegion(
    region: MapRegion,
    mapDimensions: MapDimensions
  ): Array<PointFeature<P> | ClusterFeature<P>> {
    return this.queryRegion(region, mapDimensions, this.options.maxZoom + 1)
  }

  /**
   * {@linkcode Supercluster.getClustersFromRegion getClustersFromRegion},
   * queried at `maxZoom` at most, so points that zooming never splits stay
   * clustered however far the map zooms in.
   *
   * @internal The compat `MapView` spiderfies those clusters instead of
   * stacking their markers on top of each other.
   */
  getClustersFromRegionUpToMaxZoom(
    region: MapRegion,
    mapDimensions: MapDimensions
  ): Array<PointFeature<P> | ClusterFeature<P>> {
    return this.queryRegion(region, mapDimensions, this.options.maxZoom)
  }

  private queryRegion(
    region: MapRegion,
    mapDimensions: MapDimensions,
    maxQueryZoom: number
  ): Array<PointFeature<P> | ClusterFeature<P>> {
    this.throwIfDestroyed()

    if (!this.isLoaded) {
      return []
    }

    if (
      !isValidRegion(region) ||
      mapDimensions.width <= 0 ||
      mapDimensions.height <= 0
    ) {
      return []
    }

    const bbox = regionToBBox(region)
    const zoom = clusterZoomFromRegion(
      region,
      mapDimensions,
      this.options.minZoom,
      maxQueryZoom,
      this.options.viewportTileSize
    )

    return this.getClusters(bbox, zoom)
  }

  /**
   * Returns direct child features of a cluster id, or `[]` for an id that is
   * not a cluster.
   *
   * @throws When {@linkcode Supercluster.load load} has not completed.
   * @throws A `RangeError` when `clusterId` is not a 32-bit integer.
   */
  getChildren(clusterId: number): Array<PointFeature<P> | ClusterFeature<P>> {
    this.throwIfNotInitialized()
    validateClusterId(clusterId)

    return this.engine!.getChildren(clusterId).map((feature) =>
      this.engineFeatureToGeoJSON(feature)
    )
  }

  /**
   * Returns leaf point features under a cluster (paginated).
   *
   * A `limit` of `Infinity` (as in supercluster) or `0` returns every leaf.
   *
   * @throws When {@linkcode Supercluster.load load} has not completed.
   * @throws A `RangeError` when `clusterId` is not a 32-bit integer.
   * @throws When `limit` or `offset` is fractional, or `offset` is `NaN`.
   */
  getLeaves(clusterId: number, limit = 10, offset = 0): PointFeature<P>[] {
    this.throwIfNotInitialized()
    validateClusterId(clusterId)

    // The native engine reads `limit <= 0` as unlimited.
    const nativeLimit = Number.isFinite(limit) ? limit : 0
    return this.engine!.getLeaves(clusterId, nativeLimit, offset).map(
      (feature) => this.engineFeatureToGeoJSON(feature) as PointFeature<P>
    )
  }

  /** Returns every leaf in a cluster. Native limit `<= 0` means unlimited. */
  getAllLeaves(clusterId: number, offset = 0): PointFeature<P>[] {
    return this.getLeaves(clusterId, 0, offset)
  }

  /**
   * Zoom level at which a cluster expands into multiple children: the first
   * zoom where {@linkcode Supercluster.getClusters getClusters} shows its
   * children instead of the cluster, from whichever zoom it was seen at.
   *
   * Returns `maxZoom + 1` for a cluster still there at `maxZoom` (points at
   * the same coordinate, for example), which `getClusters` returns as its
   * points from that zoom on, and for a point id.
   *
   * @throws When {@linkcode Supercluster.load load} has not completed.
   * @throws A `RangeError` when `clusterId` is not a 32-bit integer.
   */
  getClusterExpansionZoom(clusterId: number): number {
    this.throwIfNotInitialized()
    validateClusterId(clusterId)
    return this.engine!.getClusterExpansionZoom(clusterId)
  }

  /**
   * The leaf of `cluster` with the smallest point index. A cluster keeps it
   * across zoom levels, and across rebuilds that keep that leaf first, while
   * it only gains or loses other leaves.
   *
   * @internal The compat `MapView` keys cluster markers by it. Returns
   * `undefined` for a cluster this instance did not return.
   */
  getClusterMinLeaf(cluster: ClusterFeature<P>): PointFeature<P> | undefined {
    const index = this.minLeafIndices.get(cluster)
    return index == null ? undefined : this.loadedFeatures[index]
  }

  /**
   * {@linkcode MapRegion} that fits all leaves in a cluster.
   *
   * Used by cluster {@linkcode ClusterFeature} `getExpansionRegion` callbacks.
   */
  getClusterExpansionRegion(clusterId: number): MapRegion {
    this.throwIfNotInitialized()

    const leaves = this.getAllLeaves(clusterId)
    return coordinatesToRegion(
      leaves.map((leaf) => {
        const [longitude, latitude] = leaf.geometry.coordinates
        return { latitude, longitude }
      })
    )
  }

  private prepareEngine(points: PointFeature<P>[]): ClusterEngine {
    validateSuperclusterOptions(this.options)

    // Filtered first so `loadedFeatures` stays index-aligned with the packed
    // buffer that `pointIndex` is reported against.
    const { valid, invalidIndices } = partitionValidPoints(points)
    warnSkippedPoints(invalidIndices, points.length)

    this.loadedFeatures = valid
    const clusterProperties = this.options.clusterProperties
    const aggregationValues =
      clusterProperties.length > 0
        ? extractGeoJSONAggregationValues(valid, clusterProperties)
        : undefined
    const engine = createNativeClusterEngine()

    engine.setOptions({
      radius: this.options.radius,
      minPoints: this.options.minPoints,
      minZoom: this.options.minZoom,
      maxZoom: this.options.maxZoom,
      extent: this.options.extent,
      nodeSize: this.options.nodeSize,
      reducers: clusterProperties.map((config) => config.reduce),
    })
    engine.setPoints(
      packPoints(
        valid.map((feature) => {
          const [longitude, latitude] = feature.geometry.coordinates
          return { latitude, longitude }
        }),
        { values: aggregationValues }
      ).buffer
    )

    return engine
  }

  private throwIfDestroyed(): void {
    if (this.destroyed) {
      throw new Error(
        'react-native-better-clustering: this Supercluster instance was destroyed. Create a new instance instead.'
      )
    }
  }

  private throwIfNotInitialized(): void {
    this.throwIfDestroyed()

    if (this.engine == null) {
      throw new Error(
        'react-native-better-clustering: this Supercluster has no features. Use the load() method to add features.'
      )
    }
  }

  private engineFeatureToGeoJSON(
    feature: EngineClusterNode
  ): PointFeature<P> | ClusterFeature<P> {
    if (feature.isCluster) {
      return this.toClusterFeature(feature)
    }

    const original = this.loadedFeatures[feature.pointIndex]
    if (original != null) {
      return original
    }

    return {
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [feature.longitude, feature.latitude],
      },
      properties: {} as P,
    }
  }

  private toClusterFeature(feature: EngineClusterNode): ClusterFeature<P> {
    const clusterId = feature.id
    const aggregated =
      this.options.clusterProperties.length > 0
        ? aggregatedPropsFromValues(
            this.options.clusterProperties,
            feature.values
          )
        : {}

    const cluster: ClusterFeature<P> = {
      type: 'Feature',
      id: clusterId,
      geometry: {
        type: 'Point',
        coordinates: [feature.longitude, feature.latitude],
      },
      properties: {
        cluster: true,
        cluster_id: clusterId,
        point_count: feature.count,
        point_count_abbreviated: abbreviateCount(feature.count),
        getExpansionRegion: () => this.getClusterExpansionRegion(clusterId),
        ...aggregated,
      } as ClusterFeature<P>['properties'],
    }
    this.minLeafIndices.set(cluster, feature.minLeafId)
    return cluster
  }
}
