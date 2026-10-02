import { useEffect, useMemo, useState } from 'react'

import type { AnyProps, ClusterFeature, PointFeature } from '../geojson/types'
import type { MapRegion } from '../types'
import { DEFAULT_SUPERCLUSTER_OPTIONS } from '../engine/defaults'
import { Supercluster } from '../engine/Supercluster'
import type { MapDimensions } from '../engine/geometry'
import type { SuperclusterOptions } from '../engine/types'
import { hasSameIndexContent, type SameFeature } from './indexContent'
import { stabilizeClusterFeatures } from './stabilizeClusters'

type Features<P extends AnyProps> = Array<PointFeature<P> | ClusterFeature<P>>

/** The `data` the hook has seen, and the array its index content came from. */
interface IndexInput<P extends AnyProps> {
  /** The latest `data` array. */
  latest: PointFeature<P>[]
  /** The first array with the current index content; builds are keyed on it. */
  indexed: PointFeature<P>[]
  /** Bumped whenever the index content changes. */
  version: number
  /** The `clusterProperties` the content was compared under. */
  clusterPropertiesKey: string
}

/** The loaded engine that queries go to, and the content version it holds. */
interface ActiveIndex<P extends AnyProps> {
  supercluster: Supercluster<P>
  version: number
}

/** The last stabilized query result, and what it was stabilized from. */
interface StableClusters<P extends AnyProps> {
  raw: Features<P>
  supercluster: Supercluster<P> | null
  clusters: Features<P>
}

/** Result of {@linkcode useClusterIndex}. */
export interface ClusterIndex<P extends AnyProps> {
  /** Visible points and clusters, stabilized across equivalent queries. */
  clusters: Features<P>
  /** The engine serving `clusters`, or an unloaded placeholder before the first load. */
  supercluster: Supercluster<P>
  /**
   * Whether `supercluster` holds the current `data` content. `false` while a
   * rebuild is pending, when `clusters` still come from the previous content.
   */
  isCurrent: boolean
}

const NO_FEATURES: never[] = []

/**
 * Internal engine behind `useClusterer` and the compat `MapView`.
 *
 * - Rebuilds the native index when the index content of `data` changes (see
 *   {@linkcode hasSameIndexContent}), not when only its identity does. When
 *   only other properties change, leaves are refreshed without a rebuild.
 * - Double-buffers: the previous engine keeps serving queries until its
 *   replacement has loaded, and is destroyed after the commit that retires it.
 * - Reuses feature identities across equivalent queries of the same engine,
 *   never across engines, so a rendered cluster's `getExpansionRegion` always
 *   resolves on a live engine.
 *
 * @param isSameFeature - Extra equality a caller needs to share an index, on
 *   top of coordinates and `clusterProperties` inputs.
 */
export function useClusterIndex<P extends AnyProps = AnyProps>(
  data: PointFeature<P>[],
  mapDimensions: MapDimensions,
  region: MapRegion,
  options?: SuperclusterOptions,
  isSameFeature?: SameFeature<P>
): ClusterIndex<P> {
  const {
    radius = DEFAULT_SUPERCLUSTER_OPTIONS.radius,
    minZoom = DEFAULT_SUPERCLUSTER_OPTIONS.minZoom,
    maxZoom = DEFAULT_SUPERCLUSTER_OPTIONS.maxZoom,
    minPoints = DEFAULT_SUPERCLUSTER_OPTIONS.minPoints,
    extent = DEFAULT_SUPERCLUSTER_OPTIONS.extent,
    nodeSize = DEFAULT_SUPERCLUSTER_OPTIONS.nodeSize,
    clusterProperties = DEFAULT_SUPERCLUSTER_OPTIONS.clusterProperties,
  } = options ?? {}

  const clusterPropertiesKey = clusterProperties
    .map((config) => `${config.source}:${config.key ?? ''}:${config.reduce}`)
    .join('|')

  // Compare content only when a new array arrives, so equal re-renders cost
  // one pass over the points and no native work. New `clusterProperties`
  // change what counts as content, so they start a new version from the
  // newest array.
  const [input, setInput] = useState<IndexInput<P>>(() => ({
    latest: data,
    indexed: data,
    version: 0,
    clusterPropertiesKey,
  }))
  let current = input
  if (
    data !== input.latest ||
    clusterPropertiesKey !== input.clusterPropertiesKey
  ) {
    current =
      clusterPropertiesKey === input.clusterPropertiesKey &&
      hasSameIndexContent(input.latest, data, clusterProperties, isSameFeature)
        ? { ...input, latest: data }
        : {
            latest: data,
            indexed: data,
            version: input.version + 1,
            clusterPropertiesKey,
          }
    setInput(current)
  }
  const { latest, indexed, version } = current

  const [active, setActive] = useState<ActiveIndex<P> | null>(null)

  useEffect(() => {
    let cancelled = false
    let activated = false
    const next = new Supercluster<P>({
      radius,
      minZoom,
      maxZoom,
      minPoints,
      extent,
      nodeSize,
      clusterProperties,
    })

    next.loadAsync(indexed).then(
      () => {
        if (!cancelled) {
          activated = true
          setActive({ supercluster: next, version })
        }
      },
      () => {
        // Cancelled (superseded or unmounted) or failed: whatever index is
        // active keeps serving queries.
      }
    )

    return () => {
      cancelled = true
      // Once active, the engine belongs to the effect below.
      if (!activated) {
        next.destroy()
      }
    }
    // Keep option properties as individual dependencies in case "options" is inline.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    indexed,
    version,
    radius,
    minZoom,
    maxZoom,
    minPoints,
    extent,
    nodeSize,
    clusterPropertiesKey,
  ])

  // Destroy a retired engine only after the commit that stopped rendering it:
  // handlers from the previous commit may still query it until then.
  useEffect(() => {
    if (active == null) {
      return
    }
    const { supercluster } = active
    return () => {
      supercluster.destroy()
    }
  }, [active])

  // Same index content, newer feature objects: serve them from leaf queries.
  useEffect(() => {
    if (
      active != null &&
      active.version === version &&
      active.supercluster.isLoaded
    ) {
      active.supercluster.replaceLoadedFeatures(latest)
    }
  }, [active, version, latest])

  const supercluster = active?.supercluster ?? null
  const { latitude, longitude, latitudeDelta, longitudeDelta } = region
  const { width, height } = mapDimensions

  const raw = useMemo<Features<P>>(() => {
    if (supercluster == null || !supercluster.isLoaded) {
      return NO_FEATURES
    }

    return supercluster.getClustersFromRegion(
      { latitude, longitude, latitudeDelta, longitudeDelta },
      { width, height }
    )
  }, [
    supercluster,
    latitude,
    longitude,
    latitudeDelta,
    longitudeDelta,
    width,
    height,
  ])

  const [stable, setStable] = useState<StableClusters<P>>(() => ({
    raw,
    supercluster,
    clusters: raw,
  }))
  let clusters = stable.clusters
  if (raw !== stable.raw) {
    clusters =
      stable.supercluster === supercluster
        ? stabilizeClusterFeatures(stable.clusters, raw)
        : raw
    setStable({ raw, supercluster, clusters })
  }

  const [placeholder] = useState(() => new Supercluster<P>())

  return {
    clusters,
    supercluster: supercluster ?? placeholder,
    isCurrent: active != null && active.version === version,
  }
}
