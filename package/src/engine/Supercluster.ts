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

import { DEFAULT_SUPERCLUSTER_OPTIONS } from './defaults'
import type { SuperclusterOptions, ClusterPropertyConfig } from './types'

export type { SuperclusterOptions, ClusterPropertyConfig }

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
  private destroyed = false
  private readonly options: Required<SuperclusterOptions>

  /**
   * Creates a clusterer with {@linkcode SuperclusterOptions}.
   *
   * Options are snapshotted at construction; mutating a passed object afterward has no effect.
   */
  constructor(options?: SuperclusterOptions) {
    this.options = { ...DEFAULT_SUPERCLUSTER_OPTIONS, ...options }
  }

  /** Whether the native cluster index has finished building. */
  get isLoaded(): boolean {
    return !this.destroyed && (this.engine?.isBuilt ?? false)
  }

  /**
   * Loads points and builds the cluster index synchronously on the JS thread.
   *
   * @throws When called more than once on the same instance.
   * @throws When the instance was {@linkcode Supercluster.destroy destroyed}.
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
    return this
  }

  /**
   * Loads points and builds the cluster index without blocking the JS thread.
   *
   * Prefer this for large datasets (10k+ points).
   *
   * @throws When called more than once on the same instance.
   * @throws When the instance was destroyed during the async build.
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

    try {
      await engine.buildAsync()
    } catch (error) {
      this.engine = null
      throw error
    }

    if (this.destroyed) {
      this.engine = null
      throw new Error(
        'react-native-better-clustering: this Supercluster instance was destroyed during load.'
      )
    }

    return this
  }

  /**
   * Releases native resources held by this instance.
   *
   * Idempotent — safe to call multiple times. Further queries throw.
   */
  destroy(): void {
    if (this.destroyed) {
      return
    }

    this.destroyed = true
    this.engine = null
    this.loadedFeatures = []
  }

  /**
   * Returns clusters visible in a geographic {@linkcode BBox} at the given zoom.
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
   * Returns `[]` while loading, when the region is invalid, or when dimensions are non-positive.
   */
  getClustersFromRegion(
    region: MapRegion,
    mapDimensions: MapDimensions
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
      this.options.maxZoom,
      this.options.extent
    )

    return this.getClusters(bbox, zoom)
  }

  /**
   * Returns direct child features of a cluster id.
   *
   * @throws When {@linkcode Supercluster.load load} has not completed.
   */
  getChildren(clusterId: number): Array<PointFeature<P> | ClusterFeature<P>> {
    this.throwIfNotInitialized()

    return this.engine!.getChildren(clusterId).map((feature) =>
      this.engineFeatureToGeoJSON(feature)
    )
  }

  /**
   * Returns leaf point features under a cluster (paginated).
   *
   * @throws When {@linkcode Supercluster.load load} has not completed.
   */
  getLeaves(clusterId: number, limit = 10, offset = 0): PointFeature<P>[] {
    this.throwIfNotInitialized()

    return this.engine!.getLeaves(clusterId, limit, offset).map(
      (feature) => this.engineFeatureToGeoJSON(feature) as PointFeature<P>
    )
  }

  /** Returns every leaf in a cluster. Native limit `<= 0` means unlimited. */
  getAllLeaves(clusterId: number, offset = 0): PointFeature<P>[] {
    return this.getLeaves(clusterId, 0, offset)
  }

  /**
   * Zoom level at which a cluster expands into multiple children.
   *
   * @throws When {@linkcode Supercluster.load load} has not completed.
   */
  getClusterExpansionZoom(clusterId: number): number {
    this.throwIfNotInitialized()
    return this.engine!.getClusterExpansionZoom(clusterId)
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
    this.loadedFeatures = points
    const clusterProperties = this.options.clusterProperties
    const aggregationValues =
      clusterProperties.length > 0
        ? extractGeoJSONAggregationValues(points, clusterProperties)
        : undefined
    const engine =
      NitroModules.createHybridObject<ClusterEngine>('ClusterEngine')

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
        points.map((feature) => {
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

    return {
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
  }
}
