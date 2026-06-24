import type { PointFeature } from '../geojson'

const mockEngine = {
  setOptions: jest.fn(),
  setPoints: jest.fn(),
  build: jest.fn(() => {
    mockEngine.isBuilt = true
  }),
  buildAsync: jest.fn(() => {
    mockEngine.isBuilt = true
    return Promise.resolve()
  }),
  isBuilt: false,
  getClusters: jest.fn(() => []),
  getChildren: jest.fn(() => []),
  getLeaves: jest.fn(() => []),
  getClusterExpansionZoom: jest.fn(() => 10),
}

jest.mock('react-native-nitro-modules', () => ({
  NitroModules: {
    createHybridObject: jest.fn(() => mockEngine),
  },
}))

import { Supercluster } from './Supercluster'

const SAMPLE_POINT: PointFeature = {
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [-122.42, 37.78] },
  properties: { id: 'a' },
}

const WORLD_BBOX = [-180, -90, 180, 90] as const

describe('Supercluster default options', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockEngine.isBuilt = false
  })

  it('passes canonical zoom defaults to the native engine', () => {
    new Supercluster().load([SAMPLE_POINT])

    expect(mockEngine.setOptions).toHaveBeenCalledWith(
      expect.objectContaining({ minZoom: 1, maxZoom: 20 })
    )
  })
})

describe('Supercluster.destroy', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockEngine.isBuilt = false
  })

  it('nullifies engine and loaded features', () => {
    const clusterer = new Supercluster().load([SAMPLE_POINT])

    clusterer.destroy()

    expect(() => clusterer.getClusters([...WORLD_BBOX], 10)).toThrow(
      'react-native-better-clustering: this Supercluster instance was destroyed. Create a new instance instead.'
    )
  })

  it('throws a clear error when cluster methods are called after destroy', () => {
    const clusterer = new Supercluster().load([SAMPLE_POINT])
    clusterer.destroy()

    expect(() =>
      clusterer.getClustersFromRegion(
        {
          latitude: 37.78,
          longitude: -122.42,
          latitudeDelta: 0.05,
          longitudeDelta: 0.05,
        },
        { width: 400, height: 800 }
      )
    ).toThrow(
      'react-native-better-clustering: this Supercluster instance was destroyed. Create a new instance instead.'
    )
    expect(() => clusterer.getChildren(1)).toThrow(
      'react-native-better-clustering: this Supercluster instance was destroyed. Create a new instance instead.'
    )
    expect(() => clusterer.getLeaves(1)).toThrow(
      'react-native-better-clustering: this Supercluster instance was destroyed. Create a new instance instead.'
    )
    expect(() => clusterer.getClusterExpansionZoom(1)).toThrow(
      'react-native-better-clustering: this Supercluster instance was destroyed. Create a new instance instead.'
    )
    expect(() => clusterer.getClusterExpansionRegion(1)).toThrow(
      'react-native-better-clustering: this Supercluster instance was destroyed. Create a new instance instead.'
    )
  })

  it('throws when load is called after destroy', () => {
    const clusterer = new Supercluster().load([SAMPLE_POINT])
    clusterer.destroy()

    expect(() => clusterer.load([SAMPLE_POINT])).toThrow(
      'react-native-better-clustering: this Supercluster instance was destroyed. Create a new instance instead.'
    )
  })

  it('is idempotent', () => {
    const clusterer = new Supercluster().load([SAMPLE_POINT])

    expect(() => {
      clusterer.destroy()
      clusterer.destroy()
    }).not.toThrow()
  })
})

describe('Supercluster pointIndex identity', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockEngine.isBuilt = false
  })

  it('maps native pointIndex back to the original loaded feature index', () => {
    const invalidPoint: PointFeature = {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [0, 999] },
      properties: { id: 'invalid' },
    }
    const validPoint: PointFeature = {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-122.42, 37.78] },
      properties: { id: 'valid' },
    }

    mockEngine.getClusters.mockReturnValueOnce([
      {
        id: 1,
        latitude: 37.78,
        longitude: -122.42,
        count: 1,
        isCluster: false,
        parentId: -1,
        pointIndex: 1,
        values: [],
      },
    ])

    const clusterer = new Supercluster().load([invalidPoint, validPoint])
    const [feature] = clusterer.getClusters([...WORLD_BBOX], 10)

    expect(feature).toBe(validPoint)
    expect(feature?.properties.id).toBe('valid')
  })
})

describe('Supercluster.getAllLeaves', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockEngine.isBuilt = false
  })

  it('requests unlimited leaves from the native engine with limit 0', () => {
    const clusterer = new Supercluster().load([SAMPLE_POINT])

    clusterer.getAllLeaves(42)

    expect(mockEngine.getLeaves).toHaveBeenCalledWith(42, 0, 0)
  })
})

describe('Supercluster.loadAsync', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockEngine.isBuilt = false
  })

  it('builds the native index asynchronously', async () => {
    const clusterer = new Supercluster()

    await expect(clusterer.loadAsync([SAMPLE_POINT])).resolves.toBe(clusterer)
    expect(mockEngine.buildAsync).toHaveBeenCalledTimes(1)
    expect(mockEngine.build).not.toHaveBeenCalled()
    expect(clusterer.isLoaded).toBe(true)
  })

  it('returns empty clusters from getClustersFromRegion until loaded', async () => {
    let resolveBuild: (() => void) | undefined
    mockEngine.buildAsync.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveBuild = resolve
        })
    )

    const clusterer = new Supercluster()
    const loadPromise = clusterer.loadAsync([SAMPLE_POINT])

    expect(clusterer.isLoaded).toBe(false)
    expect(
      clusterer.getClustersFromRegion(
        {
          latitude: 37.78,
          longitude: -122.42,
          latitudeDelta: 0.05,
          longitudeDelta: 0.05,
        },
        { width: 400, height: 800 }
      )
    ).toEqual([])

    resolveBuild?.()
    mockEngine.isBuilt = true
    await loadPromise

    expect(clusterer.isLoaded).toBe(true)
  })
})
