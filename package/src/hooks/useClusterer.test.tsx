import { renderHook } from '@testing-library/react'

import type { PointFeature } from '../geojson'
import type { MapRegion } from '../types'

const mockDestroy = jest.fn()
const mockGetClustersFromRegion = jest.fn(() => [])

jest.mock('../engine/Supercluster', () => {
  class MockSupercluster {
    destroy = mockDestroy
    getClustersFromRegion = mockGetClustersFromRegion
    isLoaded = true
    load() {
      return this
    }
    loadAsync() {
      return Promise.resolve(this)
    }
  }

  return { Supercluster: MockSupercluster }
})

import { useClusterer } from './useClusterer'

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
  it('destroys the previous engine on data change and on unmount', () => {
    mockDestroy.mockClear()
    mockGetClustersFromRegion.mockClear()

    const { rerender, unmount } = renderHook(
      ({ data }) => useClusterer(data, MAP_DIMENSIONS, REGION),
      { initialProps: { data: [POINT_A] } }
    )

    expect(mockDestroy).not.toHaveBeenCalled()

    rerender({ data: [POINT_B] })

    expect(mockDestroy).toHaveBeenCalledTimes(1)

    unmount()

    expect(mockDestroy).toHaveBeenCalledTimes(2)
  })
})
