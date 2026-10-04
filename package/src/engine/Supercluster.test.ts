import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
  mock,
  spyOn,
} from 'bun:test'

import type { ClusterFeature, PointFeature } from '../geojson'
import type { EngineClusterNode } from '../specs/EngineClusterNode'

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
  getClusters: jest.fn((): EngineClusterNode[] => []),
  getChildren: jest.fn(() => []),
  getLeaves: jest.fn(() => []),
  getClusterExpansionZoom: jest.fn(() => 10),
}

// Registered before ./Supercluster is imported (below).
mock.module('react-native-nitro-modules', () => ({
  NitroModules: {
    createHybridObject: jest.fn(() => mockEngine),
  },
}))

const { Supercluster } = await import('./Supercluster')

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
        minLeafId: 1,
        values: [],
      },
    ])

    const clusterer = new Supercluster().load([invalidPoint, validPoint])
    const [feature] = clusterer.getClusters([...WORLD_BBOX], 10)

    expect(feature).toBe(validPoint)
    expect(feature?.properties.id).toBe('valid')
  })
})

describe('Supercluster coordinate validation', () => {
  let warn: ReturnType<typeof spyOn>

  beforeEach(() => {
    jest.clearAllMocks()
    mockEngine.isBuilt = false
    warn = spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warn.mockRestore()
  })

  const nonFinitePoint: PointFeature = {
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [21, undefined as unknown as number],
    },
    properties: { id: 'broken' },
  }
  const firstValid: PointFeature = {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [-122.42, 37.78] },
    properties: { id: 'first' },
  }
  const secondValid: PointFeature = {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [-122.41, 37.79] },
    properties: { id: 'second' },
  }

  it('never packs a non-finite coordinate for the native engine', () => {
    new Supercluster().load([nonFinitePoint, firstValid, secondValid])

    const buffer = mockEngine.setPoints.mock.calls[0]![0] as ArrayBuffer
    expect(new DataView(buffer).getUint32(0, true)).toBe(2)
  })

  it('warns instead of letting the point vanish silently', () => {
    new Supercluster().load([nonFinitePoint, firstValid])

    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]![0]).toContain('skipped 1 of 2 points')
  })

  it('does not warn when every coordinate is finite', () => {
    new Supercluster().load([firstValid, secondValid])

    expect(warn).not.toHaveBeenCalled()
  })

  it('keeps pointIndex aligned after a leading point is dropped', () => {
    mockEngine.getClusters.mockReturnValueOnce([
      {
        id: 0,
        latitude: 37.78,
        longitude: -122.42,
        count: 1,
        isCluster: false,
        parentId: -1,
        pointIndex: 0,
        minLeafId: 0,
        values: [],
      },
      {
        id: 1,
        latitude: 37.79,
        longitude: -122.41,
        count: 1,
        isCluster: false,
        parentId: -1,
        pointIndex: 1,
        minLeafId: 1,
        values: [],
      },
    ])

    const clusterer = new Supercluster().load([
      nonFinitePoint,
      firstValid,
      secondValid,
    ])
    const features = clusterer.getClusters([...WORLD_BBOX], 10)

    expect(features).toEqual([firstValid, secondValid])
  })

  it('skips the same points when swapping in newer features', () => {
    mockEngine.getClusters.mockReturnValueOnce([
      {
        id: 0,
        latitude: 37.78,
        longitude: -122.42,
        count: 1,
        isCluster: false,
        parentId: -1,
        pointIndex: 0,
        minLeafId: 0,
        values: [],
      },
    ])
    const clusterer = new Supercluster().load([nonFinitePoint, firstValid])
    const newerFirst: PointFeature = {
      ...firstValid,
      properties: { id: 'first', selected: true },
    }

    clusterer.replaceLoadedFeatures([{ ...nonFinitePoint }, newerFirst])
    const [feature] = clusterer.getClusters([...WORLD_BBOX], 10)

    expect(feature).toBe(newerFirst)
  })
})

describe('Supercluster.getClusterMinLeaf', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockEngine.isBuilt = false
  })

  const point = (id: string, longitude: number): PointFeature => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [longitude, 52] },
    properties: { id },
  })
  const clusterNode = (minLeafId: number): EngineClusterNode => ({
    id: 10,
    latitude: 52,
    longitude: 21,
    count: 2,
    isCluster: true,
    parentId: -1,
    pointIndex: -1,
    minLeafId,
    values: [],
  })

  it('resolves the min leaf index the engine reports to the loaded feature', () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {})
    mockEngine.getClusters.mockReturnValueOnce([clusterNode(0)])
    const unindexable = point('broken', Number.NaN)
    const first = point('first', 21)
    const clusterer = new Supercluster().load([
      unindexable,
      first,
      point('second', 21.0001),
    ])

    const [cluster] = clusterer.getClusters([...WORLD_BBOX], 10)

    // Index 0 is the first indexable point, after the skipped one.
    expect(clusterer.getClusterMinLeaf(cluster as ClusterFeature)).toBe(first)
    warn.mockRestore()
  })

  it('returns the newer feature after replaceLoadedFeatures', () => {
    mockEngine.getClusters.mockReturnValueOnce([clusterNode(1)])
    const clusterer = new Supercluster().load([
      point('a', 21),
      point('b', 21.0001),
    ])
    const [cluster] = clusterer.getClusters([...WORLD_BBOX], 10)
    const newerB = point('b', 21.0001)

    clusterer.replaceLoadedFeatures([point('a', 21), newerB])

    expect(clusterer.getClusterMinLeaf(cluster as ClusterFeature)).toBe(newerB)
  })

  it('returns undefined for a cluster another instance returned', () => {
    mockEngine.getClusters.mockReturnValueOnce([clusterNode(0)])
    const [cluster] = new Supercluster()
      .load([point('a', 21)])
      .getClusters([...WORLD_BBOX], 10)

    expect(
      new Supercluster()
        .load([point('a', 21)])
        .getClusterMinLeaf(cluster as ClusterFeature)
    ).toBeUndefined()
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
