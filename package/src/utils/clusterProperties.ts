import type { ClusterPropertyConfig } from '../engine/types'

/**
 * Reads a finite numeric value from nested GeoJSON `properties` using a dot path.
 *
 * Returns `0` when the path is missing or not a finite number.
 *
 * @see {@linkcode extractGeoJSONAggregationValues}
 */
export function getNumericProperty(
  props: Record<string, unknown>,
  path: string
): number {
  const parts = path.split('.')
  let current: unknown = props

  for (const part of parts) {
    if (current == null || typeof current !== 'object') {
      return 0
    }
    current = (current as Record<string, unknown>)[part]
  }

  return typeof current === 'number' && Number.isFinite(current) ? current : 0
}

/**
 * Resolves the output property key for a {@linkcode ClusterPropertyConfig}.
 *
 * Uses `key` when provided; otherwise the last segment of `source`.
 */
export function clusterPropertyOutputKey(
  config: ClusterPropertyConfig
): string {
  if (config.key != null && config.key.length > 0) {
    return config.key
  }
  const segments = config.source.split('.')
  return segments[segments.length - 1] ?? config.source
}

/**
 * Extracts per-point numeric columns for native cluster reducers.
 *
 * Row `i` column `k` matches `configs[k].source` on `points[i].properties`.
 *
 * @see {@linkcode SuperclusterOptions.clusterProperties}
 */
export function extractGeoJSONAggregationValues(
  points: Array<{ properties?: Record<string, unknown> }>,
  configs: ClusterPropertyConfig[]
): number[][] {
  return points.map((feature) =>
    configs.map((config) =>
      getNumericProperty(
        (feature.properties ?? {}) as Record<string, unknown>,
        config.source
      )
    )
  )
}

/**
 * Maps native reducer output values back to cluster property keys.
 *
 * @see {@linkcode ClusterPropertyConfig}
 */
export function aggregatedPropsFromValues(
  configs: ClusterPropertyConfig[],
  values: number[]
): Record<string, number> {
  const result: Record<string, number> = {}
  for (let i = 0; i < configs.length; i++) {
    result[clusterPropertyOutputKey(configs[i]!)] = values[i] ?? 0
  }
  return result
}
