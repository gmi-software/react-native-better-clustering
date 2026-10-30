import { useEffect, useMemo, useRef, useState } from 'react'

import { isClusterFeature } from '../geojson'
import type { AnyProps, ClusterFeature, PointFeature } from '../geojson/types'
import type { MapRegion } from '../types'
import { DEFAULT_SUPERCLUSTER_OPTIONS } from '../engine/defaults'
import { Supercluster } from '../engine/Supercluster'
import type { MapDimensions } from '../engine/geometry'
import { hasSameIndexContent, type SameFeature } from './indexContent'
import { stabilizeClusterFeatures } from './stabilizeClusters'
import type { UseClustererOptions } from './types'

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

/** {@linkcode useClusterIndex} options: `useClusterer`'s, and the compat `MapView`'s. */
export interface ClusterIndexOptions extends UseClustererOptions {
  /**
   * Query no zoom above `maxZoom`, past which `useClusterer` returns every
   * point on its own. The compat `MapView` spiderfies the clusters that
   * zooming can't split instead. Defaults to `false`.
   */
  stopAtMaxZoom?: boolean
}

const NO_FEATURES: never[] = []

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

/**
 * `stabilized`, position-aligned with `raw`, with every point taken from
 * `raw`. A query returns a point's newest object, where the reused one may
 * carry properties a props-only change has since replaced; clusters keep
 * their reused identity. Copies only when a point differs, so an equivalent
 * query still returns `stabilized` itself.
 */
function withQueriedPoints<P extends AnyProps>(
  stabilized: Features<P>,
  raw: Features<P>
): Features<P> {
  let result = stabilized
  for (let i = 0; i < raw.length; i++) {
    const feature = raw[i]!
    if (result[i] !== feature && !isClusterFeature(feature)) {
      if (result === stabilized) {
        result = stabilized.slice()
      }
      result[i] = feature
    }
  }
  return result
}

/**
 * Internal engine behind `useClusterer` and the compat `MapView`.
 *
 * - Rebuilds the native index when the index content of `data` changes (see
 *   {@linkcode hasSameIndexContent}), not when only its identity does. When
 *   only other properties change, leaves are refreshed without a rebuild.
 * - Double-buffers: the previous engine keeps serving queries until its
 *   replacement has loaded, and is destroyed after the commit that retires it.
 * - Runs one build at a time. A build that newer data overtakes still replaces
 *   the active engine once it loads, and then the newest array builds, so data
 *   that changes faster than a build loads still moves the index forward.
 * - Reuses cluster identities across equivalent queries of the same engine,
 *   never across engines, so a rendered cluster's `getExpansionRegion` always
 *   resolves on a live engine. Points come from each query, which returns the
 *   same object until a props-only change swaps in the newest ones.
 * - Reports a failed build to `options.onError`, or throws it during render
 *   when there is none. Builds that newer data overtook, or that settle after
 *   unmount, stay silent.
 *
 * @param isSameFeature - Extra equality a caller needs to share an index, on
 *   top of coordinates and `clusterProperties` inputs.
 */
export function useClusterIndex<P extends AnyProps = AnyProps>(
  data: PointFeature<P>[],
  mapDimensions: MapDimensions,
  region: MapRegion,
  options?: ClusterIndexOptions,
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
    // Left undefined on purpose: `Supercluster` defaults it to `extent`.
    viewportTileSize,
    stopAtMaxZoom = false,
    onError,
  } = options ?? {}

  // Read through a ref, so a new callback identity never restarts a build.
  const onErrorRef = useRef(onError)
  useEffect(() => {
    onErrorRef.current = onError
  })
  const [buildError, setBuildError] = useState<Error | null>(null)

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

  // Everything a build depends on. Only `clusterPropertiesKey` is not a
  // number, so keeping it last keeps different inputs apart.
  const buildKey = [
    version,
    radius,
    minZoom,
    maxZoom,
    minPoints,
    extent,
    nodeSize,
    viewportTileSize,
    clusterPropertiesKey,
  ].join('|')

  // Builds run one at a time. They settle after the render that started them,
  // so what they need to know about later renders lives in refs.
  const mountedRef = useRef(false)
  const buildingRef = useRef(false)
  /** The inputs of the build started last. */
  const startedKeyRef = useRef<string | null>(null)
  /** The newest inputs, which a settling build compares its own against. */
  const latestKeyRef = useRef(buildKey)
  // Bumped when a build settles, so the effect below can start the next one.
  const [settledBuilds, setSettledBuilds] = useState(0)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      // Unmounted or hidden: the `active` cleanup destroys the active engine,
      // so build again if this shows again, unless a running build lands then.
      if (!buildingRef.current) {
        startedKeyRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    latestKeyRef.current = buildKey
    // Inputs that change during a build wait for it, then build from the
    // newest array, skipping the ones in between.
    if (buildingRef.current || startedKeyRef.current === buildKey) {
      return
    }
    startedKeyRef.current = buildKey
    buildingRef.current = true
    const next = new Supercluster<P>({
      radius,
      minZoom,
      maxZoom,
      minPoints,
      extent,
      nodeSize,
      clusterProperties,
      viewportTileSize,
    })

    next.loadAsync(indexed).then(
      () => {
        buildingRef.current = false
        // Unmounted or hidden: build again if this shows again.
        if (!mountedRef.current) {
          startedKeyRef.current = null
          next.destroy()
          return
        }
        // Lands even when newer inputs have arrived: it is still newer than
        // the active engine, which the `active` cleanup then destroys.
        setActive({ supercluster: next, version })
        setSettledBuilds((count) => count + 1)
      },
      (error: unknown) => {
        buildingRef.current = false
        next.destroy()
        // Unmounted or overtaken: a newer build reports its own failure.
        if (!mountedRef.current) {
          startedKeyRef.current = null
          return
        }
        if (latestKeyRef.current !== buildKey) {
          setSettledBuilds((count) => count + 1)
          return
        }
        // Whatever index is active keeps serving queries.
        const failure = toError(error)
        const report = onErrorRef.current
        if (report != null) {
          report(failure)
        } else {
          setBuildError(failure)
        }
      }
    )
    // `buildKey` covers every option, so a new inline `options` object never
    // starts a build. Running again for a settled build starts the next one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indexed, buildKey, settledBuilds])

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

  // Same index content, newer feature objects: serve them from leaf queries,
  // and from the next region query. Never re-query by setting state here: a
  // component that builds `data` inline would get a new array each render,
  // and so render forever.
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

    const visibleRegion = { latitude, longitude, latitudeDelta, longitudeDelta }
    return stopAtMaxZoom
      ? supercluster.getClustersFromRegionUpToMaxZoom(visibleRegion, {
          width,
          height,
        })
      : supercluster.getClustersFromRegion(visibleRegion, { width, height })
  }, [
    supercluster,
    stopAtMaxZoom,
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
      supercluster != null && stable.supercluster === supercluster
        ? withQueriedPoints(
            stabilizeClusterFeatures(stable.clusters, raw, (feature) =>
              supercluster.getFeatureId(feature)
            ),
            raw
          )
        : raw
    setStable({ raw, supercluster, clusters })
  }

  const [placeholder] = useState(() => new Supercluster<P>())

  if (buildError != null) {
    throw buildError
  }

  return {
    clusters,
    supercluster: supercluster ?? placeholder,
    isCurrent: active != null && active.version === version,
  }
}
