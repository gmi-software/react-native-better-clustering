/**
 * `useClusterer` rebuilds on content, not on array identity (#12).
 *
 * Runs the real `Supercluster` on the supercluster-backed fake engine, so the
 * engine count and leaf lookups reflect what the native module would do.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { act, renderHook } from '@testing-library/react'

import type { PointFeature } from '../geojson'
import type { SuperclusterOptions } from '../engine/types'
import type { MapRegion } from '../types'
import {
  createFakeClusterEngine,
  fakeClusterEngineStats,
  resetFakeClusterEngineStats,
} from '../__tests__/fakes/fakeClusterEngine'

mock.module('react-native-nitro-modules', () => ({
  NitroModules: {
    createHybridObject: () => createFakeClusterEngine(),
  },
}))

const { isClusterFeature } = await import('../geojson')
const { useClusterer } = await import('./useClusterer')

const REGION: MapRegion = {
  latitude: 37.78,
  longitude: -122.42,
  latitudeDelta: 0.05,
  longitudeDelta: 0.05,
}

const MAP_DIMENSIONS = { width: 400, height: 800 }

// A type alias, not an interface: it must satisfy AnyProps' index signature.
type Props = {
  id: string
  title: string
  weight: number
}

function point(
  id: string,
  longitude: number,
  latitude: number,
  title = 'old',
  weight = 1
): PointFeature<Props> {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [longitude, latitude] },
    properties: { id, title, weight },
  }
}

/** Two points ~15 m apart (one cluster) and one ~2 km away (on its own). */
function points(title = 'old', weight = 1): PointFeature<Props>[] {
  return [
    point('a', -122.42, 37.78, title, weight),
    point('b', -122.4201, 37.7801, title, weight),
    point('c', -122.4, 37.79, title, weight),
  ]
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20))
  })
}

function renderClusterer(
  data: PointFeature<Props>[],
  options?: SuperclusterOptions
) {
  return renderHook(
    ({ data }) => useClusterer(data, MAP_DIMENSIONS, REGION, options),
    { initialProps: { data } }
  )
}

beforeEach(() => {
  resetFakeClusterEngineStats()
})

describe('useClusterer content keying (#12)', () => {
  it('keeps the engine and the clusters when the data is re-created with the same content', async () => {
    const { result, rerender } = renderClusterer(points())
    await flush()
    const [clusters, supercluster] = result.current
    expect(clusters).toHaveLength(2)

    rerender({ data: points() })
    await flush()

    expect(fakeClusterEngineStats.created).toBe(1)
    expect(result.current[0]).toBe(clusters)
    expect(result.current[1]).toBe(supercluster)
  })

  it('serves the latest properties from leaves after a prop-only change', async () => {
    const { result, rerender } = renderClusterer(points('old'))
    await flush()
    const [clusters] = result.current

    rerender({ data: points('new') })
    await flush()

    expect(fakeClusterEngineStats.created).toBe(1)
    expect(result.current[0]).toBe(clusters)
    const cluster = result.current[0].find(isClusterFeature)!
    const leaves = result.current[1].getAllLeaves(cluster.properties.cluster_id)
    expect(leaves.map((leaf) => leaf.properties.title)).toEqual(['new', 'new'])
  })

  it('keeps serving the previous clusters until a changed dataset has loaded', async () => {
    const { result, rerender } = renderClusterer(points())
    await flush()
    const [clusters, supercluster] = result.current

    rerender({ data: [...points(), point('d', -122.44, 37.77)] })

    expect(result.current[0]).toBe(clusters)
    expect(result.current[1]).toBe(supercluster)

    await flush()

    expect(fakeClusterEngineStats.created).toBe(2)
    expect(result.current[0]).toHaveLength(3)
    expect(result.current[1]).not.toBe(supercluster)
    expect(supercluster.isLoaded).toBe(false)
  })

  it('rebuilds when a clusterProperties source value changes', async () => {
    const options: SuperclusterOptions = {
      clusterProperties: [{ source: 'weight', reduce: 'sum' }],
    }
    const { result, rerender } = renderClusterer(points('old', 1), options)
    await flush()

    rerender({ data: points('old', 2) })
    await flush()

    expect(fakeClusterEngineStats.created).toBe(2)
    const cluster = result.current[0].find(isClusterFeature)!
    expect(cluster.properties.weight).toBe(4)
  })

  it('builds from the newest data when a clusterProperties source is added', async () => {
    const sum: SuperclusterOptions = {
      clusterProperties: [{ source: 'weight', reduce: 'sum' }],
    }
    const { result, rerender } = renderHook(
      ({ data, options }) =>
        useClusterer(data, MAP_DIMENSIONS, REGION, options),
      {
        initialProps: {
          data: points('old', 1),
          options: undefined as SuperclusterOptions | undefined,
        },
      }
    )
    await flush()

    // Same coordinates, so no rebuild; the new weights are not aggregated yet.
    const heavier = points('old', 2)
    rerender({ data: heavier, options: undefined })
    await flush()
    expect(fakeClusterEngineStats.created).toBe(1)

    rerender({ data: heavier, options: sum })
    await flush()

    expect(fakeClusterEngineStats.created).toBe(2)
    const cluster = result.current[0].find(isClusterFeature)!
    expect(cluster.properties.weight).toBe(4)
  })

  it('does not rebuild on every render when a coordinate is NaN', async () => {
    const withNaN = () => [...points(), point('n', Number.NaN, 37.78)]
    const { rerender } = renderClusterer(withNaN())
    await flush()

    rerender({ data: withNaN() })
    await flush()

    expect(fakeClusterEngineStats.created).toBe(1)
  })
})
