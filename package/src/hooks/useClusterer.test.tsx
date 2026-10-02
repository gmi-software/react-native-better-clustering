import { describe, expect, it, jest, mock } from 'bun:test'
import { act, renderHook } from '@testing-library/react'

import type { PointFeature } from '../geojson'
import type { MapRegion } from '../types'

// Only the native boundary is mocked; the real Supercluster runs on top of it.
// (Module mocks are process-wide in bun, so internal modules are not mocked.)
mock.module('react-native-nitro-modules', () => ({
  NitroModules: {
    createHybridObject: () => {
      const engine = {
        isBuilt: false,
        setOptions: () => {},
        setPoints: () => {},
        build: () => {
          engine.isBuilt = true
        },
        buildAsync: () => {
          engine.isBuilt = true
          return Promise.resolve()
        },
        getClusters: () => [],
        getChildren: () => [],
        getLeaves: () => [],
        getClusterExpansionZoom: () => 0,
      }
      return engine
    },
  },
}))

const { Supercluster } = await import('../engine/Supercluster')
const { useClusterer } = await import('./useClusterer')

const REGION: MapRegion = {
  latitude: 37.78,
  longitude: -122.42,
  latitudeDelta: 0.05,
  longitudeDelta: 0.05,
}

const MAP_DIMENSIONS = { width: 400, height: 800 }

const POINT_A: PointFeature = {
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [-122.42, 37.78] },
  properties: { id: 'a' },
}

const POINT_B: PointFeature = {
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [-122.41, 37.79] },
  properties: { id: 'b' },
}

describe('useClusterer cleanup', () => {
  it('destroys the previous engine once its replacement has loaded, and on unmount', async () => {
    const destroy = jest.spyOn(Supercluster.prototype, 'destroy')

    const { rerender, unmount } = renderHook(
      ({ data }) => useClusterer(data, MAP_DIMENSIONS, REGION),
      { initialProps: { data: [POINT_A] } }
    )
    await act(async () => {})

    expect(destroy).not.toHaveBeenCalled()

    rerender({ data: [POINT_B] })

    // The loaded engine keeps serving queries while the new one builds.
    expect(destroy).not.toHaveBeenCalled()

    await act(async () => {})

    expect(destroy).toHaveBeenCalledTimes(1)

    unmount()

    expect(destroy).toHaveBeenCalledTimes(2)

    destroy.mockRestore()
  })
})
