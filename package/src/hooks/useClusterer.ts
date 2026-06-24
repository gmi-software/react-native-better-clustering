import { useEffect, useMemo, useRef, useState } from 'react'

import type {
  AnyProps,
  ClusterFeature,
  PointFeature,
  PointOrClusterFeature,
} from '../geojson/types'
import type { MapRegion } from '../types'
import { DEFAULT_SUPERCLUSTER_OPTIONS } from '../engine/defaults'
import { Supercluster } from '../engine/Supercluster'
import type { MapDimensions } from '../engine/geometry'
import type { SuperclusterOptions } from '../engine/types'
import { stabilizeClusterFeatures } from './stabilizeClusters'

export type { MapDimensions }

/**
 * React hook that clusters GeoJSON points for the current map region.
 *
 * Returns visible {@linkcode PointOrClusterFeature} items and the underlying
 * {@linkcode Supercluster} instance (useful for expansion queries).
 *
 * The hook loads asynchronously, returns `[]` until {@linkcode Supercluster.isLoaded},
 * and destroys the native engine on unmount or when inputs change.
 *
 * @param data - Point features to cluster.
 * @param mapDimensions - Map size in pixels ({@linkcode MapDimensions}).
 * @param region - Current map region ({@linkcode MapRegion}).
 * @param options - Optional {@linkcode SuperclusterOptions}; defaults match {@linkcode DEFAULT_SUPERCLUSTER_OPTIONS}.
 *
 * @see `Clusterer`
 */
export function useClusterer<P extends AnyProps = AnyProps>(
  data: PointFeature<P>[],
  mapDimensions: MapDimensions,
  region: MapRegion,
  options?: SuperclusterOptions
): [Array<PointFeature<P> | ClusterFeature<P>>, Supercluster<P>] {
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

  const [supercluster, setSupercluster] = useState<Supercluster<P> | null>(null)
  const [isLoaded, setIsLoaded] = useState(false)
  const placeholderRef = useRef<Supercluster<P>>(new Supercluster<P>())

  useEffect(() => {
    let cancelled = false
    const clusterer = new Supercluster<P>({
      radius,
      minZoom,
      maxZoom,
      minPoints,
      extent,
      nodeSize,
      clusterProperties,
    })

    setSupercluster(clusterer)
    setIsLoaded(false)

    void clusterer
      .loadAsync(data)
      .then(() => {
        if (!cancelled) {
          setIsLoaded(true)
        }
      })
      .catch(() => {
        // Ignore rejections when load is cancelled (unmount/reload) or fails.
      })

    return () => {
      cancelled = true
      setIsLoaded(false)
      clusterer.destroy()
    }
    // Keep option properties as individual dependencies in case "options" is inline.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    data,
    radius,
    minZoom,
    maxZoom,
    minPoints,
    extent,
    nodeSize,
    clusterPropertiesKey,
  ])

  const { latitude, longitude, latitudeDelta, longitudeDelta } = region
  const { width, height } = mapDimensions

  const previousClustersRef = useRef<Array<PointOrClusterFeature<P>>>([])

  const clusters = useMemo(() => {
    if (!isLoaded || supercluster == null) {
      return []
    }

    const next = supercluster.getClustersFromRegion(
      {
        latitude,
        longitude,
        latitudeDelta,
        longitudeDelta,
      },
      { width, height }
    )

    const stable = stabilizeClusterFeatures(previousClustersRef.current, next)
    previousClustersRef.current = stable
    return stable
  }, [
    isLoaded,
    supercluster,
    latitude,
    longitude,
    latitudeDelta,
    longitudeDelta,
    width,
    height,
  ])

  return [clusters, supercluster ?? placeholderRef.current]
}
