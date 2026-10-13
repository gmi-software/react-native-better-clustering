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
import type { ClusterBounds } from '../specs/ClusterBounds'
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
  getClusterBounds: jest.fn((): ClusterBounds | undefined => undefined),
  getClusterExpansionZoom: jest.fn(() => 10),
  dispose: jest.fn(),
}

const updateMemorySize = jest.fn(<T>(engine: T) => engine)

// Registered before ./Supercluster is imported (below).
mock.module('react-native-nitro-modules', () => ({
  NitroModules: {
    createHybridObject: jest.fn(() => mockEngine),
    updateMemorySize,
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

describe('Supercluster viewport tile size', () => {
  const dimensions = { width: 400, height: 800 }
  const region = {
    latitude: 52.25,
    longitude: 21.05,
    latitudeDelta: 0.05,
    longitudeDelta: 0.05,
  }

  function zoomQueriedFor(
    options?: ConstructorParameters<typeof Supercluster>[0]
  ) {
    jest.clearAllMocks()
    mockEngine.isBuilt = false
    const clusterer = new Supercluster(options).load([SAMPLE_POINT])
    clusterer.getClustersFromRegion(region, dimensions)
    const calls = mockEngine.getClusters.mock.calls as unknown as Array<
      [{ zoom: number }]
    >
    const viewport = calls[0]?.[0]
    if (viewport == null) {
      throw new Error('expected getClusters to be called')
    }
    return viewport.zoom
  }

  it('defaults to extent, keeping react-native-clusterer parity', () => {
    expect(zoomQueriedFor()).toBe(zoomQueriedFor({ viewportTileSize: 512 }))
    expect(zoomQueriedFor({ extent: 256 })).toBe(
      zoomQueriedFor({ extent: 256, viewportTileSize: 256 })
    )
  })

  it('queries one zoom higher at the geo-viewport tile size', () => {
    expect(zoomQueriedFor({ viewportTileSize: 256 })).toBe(
      zoomQueriedFor({ viewportTileSize: 512 }) + 1
    )
  })

  it('is independent of extent', () => {
    expect(zoomQueriedFor({ extent: 1024, viewportTileSize: 256 })).toBe(
      zoomQueriedFor({ extent: 256, viewportTileSize: 256 })
    )
  })
})

describe('Supercluster region zoom ceiling (#26)', () => {
  const dimensions = { width: 400, height: 800 }
  // Zoomed in far past maxZoom.
  const street = {
    latitude: 52.25,
    longitude: 21.05,
    latitudeDelta: 0.00001,
    longitudeDelta: 0.00001,
  }

  function zoomQueriedBy(
    query: (clusterer: InstanceType<typeof Supercluster>) => void
  ) {
    jest.clearAllMocks()
    mockEngine.isBuilt = false
    query(new Supercluster({ maxZoom: 10 }).load([SAMPLE_POINT]))
    const calls = mockEngine.getClusters.mock.calls as unknown as Array<
      [{ zoom: number }]
    >
    const viewport = calls[0]?.[0]
    if (viewport == null) {
      throw new Error('expected getClusters to be called')
    }
    return viewport.zoom
  }

  it('queries one zoom past maxZoom, where no point is clustered', () => {
    expect(
      zoomQueriedBy((clusterer) =>
        clusterer.getClustersFromRegion(street, dimensions)
      )
    ).toBe(11)
  })

  it('stops at maxZoom for the compat MapView', () => {
    expect(
      zoomQueriedBy((clusterer) =>
        clusterer.getClustersFromRegionUpToMaxZoom(street, dimensions)
      )
    ).toBe(10)
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

describe('Supercluster native memory', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockEngine.isBuilt = false
  })

  /** Holds the next `buildAsync()` open until the test settles it. */
  function deferNextBuild() {
    const build = {
      resolve: () => {},
      reject: (_error: Error) => {},
    }
    mockEngine.buildAsync.mockImplementationOnce(
      () =>
        new Promise<void>((resolve, reject) => {
          build.resolve = () => {
            mockEngine.isBuilt = true
            resolve()
          }
          build.reject = reject
        })
    )
    return build
  }

  it('disposes the native engine on destroy', () => {
    const clusterer = new Supercluster().load([SAMPLE_POINT])

    clusterer.destroy()
    clusterer.destroy()

    expect(mockEngine.dispose).toHaveBeenCalledTimes(1)
  })

  it('disposes an engine that is still building once the build settles', async () => {
    const build = deferNextBuild()
    const clusterer = new Supercluster()
    const loading = clusterer.loadAsync([SAMPLE_POINT])

    clusterer.destroy()
    expect(mockEngine.dispose).not.toHaveBeenCalled()

    build.resolve()
    await expect(loading).rejects.toThrow('destroyed during load')
    expect(mockEngine.dispose).toHaveBeenCalledTimes(1)
    expect(updateMemorySize).not.toHaveBeenCalled()
  })

  it('disposes an engine destroyed during a build that fails', async () => {
    const build = deferNextBuild()
    const clusterer = new Supercluster()
    const loading = clusterer.loadAsync([SAMPLE_POINT])

    clusterer.destroy()
    build.reject(new Error('build failed'))

    await expect(loading).rejects.toThrow('build failed')
    expect(mockEngine.dispose).toHaveBeenCalledTimes(1)
  })

  it('disposes the engine when the async build fails', async () => {
    const build = deferNextBuild()
    const clusterer = new Supercluster()
    const loading = clusterer.loadAsync([SAMPLE_POINT])

    build.reject(new Error('build failed'))
    await expect(loading).rejects.toThrow('build failed')
    clusterer.destroy()

    expect(mockEngine.dispose).toHaveBeenCalledTimes(1)
  })

  it('reports the index size to the JS GC after a synchronous build', () => {
    new Supercluster().load([SAMPLE_POINT])

    expect(updateMemorySize).toHaveBeenCalledTimes(1)
    expect(updateMemorySize).toHaveBeenCalledWith(mockEngine)
  })

  it('reports the index size to the JS GC once the async build settles', async () => {
    const build = deferNextBuild()
    const loading = new Supercluster().loadAsync([SAMPLE_POINT])

    await Promise.resolve()
    expect(updateMemorySize).not.toHaveBeenCalled()

    build.resolve()
    await loading

    expect(updateMemorySize).toHaveBeenCalledTimes(1)
    expect(updateMemorySize).toHaveBeenCalledWith(mockEngine)
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

describe('Supercluster.getClusterBounds', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockEngine.isBuilt = false
  })

  const BOUNDS: ClusterBounds = {
    north: 52.4,
    south: 50.0,
    east: 21.1,
    west: 16.9,
  }

  it('returns the native bounds as a [west, south, east, north] bbox', () => {
    mockEngine.getClusterBounds.mockReturnValueOnce(BOUNDS)
    const clusterer = new Supercluster().load([SAMPLE_POINT])

    expect(clusterer.getClusterBounds(42)).toEqual([16.9, 50.0, 21.1, 52.4])
    expect(mockEngine.getClusterBounds).toHaveBeenCalledWith(42)
  })

  it('returns undefined for an id the engine has no bounds for', () => {
    const clusterer = new Supercluster().load([SAMPLE_POINT])

    expect(clusterer.getClusterBounds(-1)).toBeUndefined()
  })

  it('fits the expansion region to the bounds without reading the leaves', () => {
    mockEngine.getClusterBounds.mockReturnValueOnce(BOUNDS)
    const clusterer = new Supercluster().load([SAMPLE_POINT])

    const region = clusterer.getClusterExpansionRegion(42)

    expect(region.latitude).toBeCloseTo(51.2, 10)
    expect(region.longitude).toBeCloseTo(19, 10)
    expect(region.latitudeDelta).toBeCloseTo(2.4 * 1.5, 10)
    expect(region.longitudeDelta).toBeCloseTo(4.2 * 1.5, 10)
    expect(mockEngine.getLeaves).not.toHaveBeenCalled()
  })

  it('keeps the default expansion region for an id without bounds', () => {
    const clusterer = new Supercluster().load([SAMPLE_POINT])

    expect(clusterer.getClusterExpansionRegion(-1)).toEqual({
      latitude: 0,
      longitude: 0,
      latitudeDelta: 0.01,
      longitudeDelta: 0.01,
    })
  })
})

describe('Supercluster numeric input validation', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockEngine.isBuilt = false
  })

  it('passes Infinity, supercluster-style, to the native engine as unlimited', () => {
    const clusterer = new Supercluster().load([SAMPLE_POINT])

    clusterer.getLeaves(42, Infinity)
    clusterer.getLeaves(42, NaN, 3)

    expect(mockEngine.getLeaves.mock.calls as unknown[]).toEqual([
      [42, 0, 0],
      [42, 0, 3],
    ])
  })

  it('rejects a cluster id that is not a 32-bit integer before reaching native', () => {
    const clusterer = new Supercluster().load([SAMPLE_POINT])

    for (const query of [
      () => clusterer.getChildren(1.5),
      () => clusterer.getLeaves(Infinity),
      () => clusterer.getAllLeaves(NaN),
      () => clusterer.getClusterExpansionZoom(1e12),
      () => clusterer.getClusterBounds(-0.5),
      () => clusterer.getClusterExpansionRegion(0.5),
    ]) {
      expect(query).toThrow(
        'react-native-better-clustering: clusterId must be a 32-bit integer'
      )
    }
    expect(mockEngine.getChildren).not.toHaveBeenCalled()
    expect(mockEngine.getLeaves).not.toHaveBeenCalled()
    expect(mockEngine.getClusterBounds).not.toHaveBeenCalled()
    expect(mockEngine.getClusterExpansionZoom).not.toHaveBeenCalled()
  })

  it('rejects invalid options on load, naming the option, without creating an engine', () => {
    const clusterer = new Supercluster({ maxZoom: 100 })

    expect(() => clusterer.load([SAMPLE_POINT])).toThrow(
      'react-native-better-clustering: maxZoom must be an integer from 0 to 30, got 100.'
    )
    expect(mockEngine.setOptions).not.toHaveBeenCalled()
    expect(clusterer.isLoaded).toBe(false)
  })

  it('rejects invalid options from loadAsync as a rejection', async () => {
    const clusterer = new Supercluster({ minZoom: 12, maxZoom: 10 })

    await expect(clusterer.loadAsync([SAMPLE_POINT])).rejects.toThrow(
      'minZoom (12) must not be greater than maxZoom (10)'
    )
    expect(mockEngine.buildAsync).not.toHaveBeenCalled()
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
