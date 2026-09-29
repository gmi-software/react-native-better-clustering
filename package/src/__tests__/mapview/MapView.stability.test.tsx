/**
 * Mount stability, data updates and the known MapView bugs.
 *
 * `it.failing` tests pin down open issues: each one passes while its bug is
 * present and turns red once the bug is fixed, telling the fix to drop the
 * `.failing` and keep the test as a regression guard.
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
  spyOn,
} from 'bun:test'
import { act, render } from '@testing-library/react'
import React, { useState } from 'react'

import {
  CENTER,
  CITY_ZOOM,
  GROUP,
  SAME_SPOT,
  SINGLES,
  type TestPoint,
} from './fixtures'
import {
  Marker,
  clusterLabels,
  fakeClusterEngineStats,
  flush,
  harnessControls,
  mapState,
  mountLog,
  polylineCount,
  regionAt,
  renderedMarkerIds,
  renderedMarkers,
  resetHarness,
  settleRegion,
  unmountsSince,
} from './harness'

const { default: MapView } = await import('../../compat/MapView')

type MapViewProps = React.ComponentProps<typeof MapView>

function Map({
  points = [...GROUP, ...SINGLES],
  ...props
}: Partial<MapViewProps> & { points?: TestPoint[] }) {
  return (
    <MapView
      initialRegion={regionAt(CENTER, CITY_ZOOM)}
      clusterFadeInDuration={0}
      {...props}
    >
      {points.map((point) => (
        <Marker
          key={point.id}
          testID={point.id}
          coordinate={{ latitude: point.latitude, longitude: point.longitude }}
          cluster={point.cluster}
        />
      ))}
    </MapView>
  )
}

/** Far enough from GROUP and SINGLES to render on its own at CITY_ZOOM. */
const EXTRA: TestPoint = { id: 'x0', latitude: 52.21, longitude: 21.0 }

beforeEach(() => {
  resetHarness()
})

describe('MapView mount stability', () => {
  it('keeps every marker mounted when a pan settles on the same clusters', async () => {
    const { container } = render(<Map />)
    await flush()
    const before = renderedMarkers(container).length
    const start = mountLog.length

    await settleRegion(
      regionAt(
        { latitude: CENTER.latitude + 0.0005, longitude: CENTER.longitude },
        CITY_ZOOM
      )
    )

    expect(unmountsSince(start)).toEqual([])
    expect(renderedMarkers(container)).toHaveLength(before)
  })

  it('shows a newly added marker once the index has rebuilt', async () => {
    const { container, rerender } = render(<Map />)
    await flush()

    rerender(<Map points={[...GROUP, ...SINGLES, EXTRA]} />)
    await flush()

    expect(renderedMarkerIds(container)).toEqual(['s0', 's1', 's2', 'x0'])
    expect(fakeClusterEngineStats.created).toBe(2)
  })

  it('keeps a removed default bubble mounted while it fades out', async () => {
    // Default clusterFadeInDuration (250 ms): the old bubble lingers, marked as
    // exiting, while the new markers fade in.
    const { container } = render(
      <MapView initialRegion={regionAt(CENTER, CITY_ZOOM)}>
        {GROUP.map((point) => (
          <Marker key={point.id} testID={point.id} coordinate={point} />
        ))}
      </MapView>
    )
    await flush()
    expect(clusterLabels(container)).toEqual(['5'])

    jest.useFakeTimers()
    try {
      act(() => {
        mapState.props?.onRegionChangeComplete?.(regionAt(GROUP[2]!, 20), {
          isGesture: true,
        })
      })
      expect(clusterLabels(container)).toEqual(['5'])
      expect(renderedMarkerIds(container)).toEqual(GROUP.map((p) => p.id))

      act(() => {
        jest.advanceTimersByTime(250)
      })
      expect(clusterLabels(container)).toEqual([])
    } finally {
      jest.useRealTimers()
    }
  })
})

describe('MapView known issues', () => {
  let consoleError: ReturnType<typeof spyOn>

  beforeEach(() => {
    consoleError = spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleError.mockRestore()
  })

  it.failing(
    '#12: an unrelated parent re-render keeps the index and every marker mounted',
    async () => {
      function Parent({ tick }: { tick: number }) {
        return <Map key="map" accessibilityLabel={`tick ${tick}`} />
      }
      const { rerender } = render(<Parent tick={0} />)
      await flush()
      const start = mountLog.length

      rerender(<Parent tick={1} />)
      await flush()

      expect(fakeClusterEngineStats.created).toBe(1)
      expect(unmountsSince(start)).toEqual([])
    }
  )

  it.failing(
    '#12: onMarkersChange={setState} with inline children settles',
    async () => {
      let renders = 0
      function Parent() {
        const [, setVisible] = useState<unknown[]>([])
        renders++
        // Stop feeding the loop after 30 renders so the test terminates.
        return <Map onMarkersChange={renders < 30 ? setVisible : undefined} />
      }
      render(<Parent />)
      for (let i = 0; i < 10; i++) await flush()

      expect(renders).toBeLessThanOrEqual(4)
    }
  )

  it.failing(
    '#12: a data update keeps the previous markers until the rebuild lands',
    async () => {
      const { container, rerender } = render(<Map />)
      await flush()

      rerender(<Map points={[...GROUP, ...SINGLES, EXTRA]} />)

      expect(renderedMarkers(container).length).toBeGreaterThan(0)
    }
  )

  it.failing(
    '#13: getExpansionRegion still works after the index is rebuilt',
    async () => {
      const seen: Array<{ properties: { getExpansionRegion: () => unknown } }> =
        []
      function Parent({ tick }: { tick: number }) {
        return (
          <Map
            accessibilityLabel={`tick ${tick}`}
            renderCluster={(cluster) => {
              seen.push(cluster)
              const [longitude, latitude] = cluster.geometry.coordinates
              return (
                <Marker testID="custom" coordinate={{ latitude, longitude }} />
              )
            }}
          />
        )
      }
      const { rerender } = render(<Parent tick={0} />)
      await flush()
      rerender(<Parent tick={1} />)
      await flush()

      expect(() => seen.at(-1)!.properties.getExpansionRegion()).not.toThrow()
    }
  )

  it.failing(
    '#14: markers with cluster={true} are clustered and rendered as themselves',
    async () => {
      const { container } = render(
        <Map points={SINGLES.map((point) => ({ ...point, cluster: true }))} />
      )
      await flush()

      expect(renderedMarkerIds(container)).toEqual(['s0', 's1', 's2'])
    }
  )

  it.failing(
    '#15: a native engine that cannot be created is reported, not swallowed',
    async () => {
      harnessControls.createHybridObjectError = new Error(
        'HybridObject ClusterEngine is not registered'
      )
      let thrown: unknown = null
      try {
        render(<Map />)
        await flush()
      } catch (error) {
        thrown = error
      }

      expect(thrown != null || consoleError.mock.calls.length > 0).toBe(true)
    }
  )

  it.failing(
    '#16: spiderfy caps how many markers and connector lines it renders',
    async () => {
      const crowd: TestPoint[] = Array.from({ length: 200 }, (_, i) => ({
        id: `c${i}`,
        latitude: CENTER.latitude,
        longitude: CENTER.longitude,
      }))
      const { container } = render(
        <Map points={crowd} initialRegion={regionAt(CENTER, 23)} />
      )
      await flush()

      // The cap's value is the fix's call (about 50 is suggested); any cap
      // renders fewer markers and lines than there are leaves.
      expect(renderedMarkers(container).length).toBeLessThan(crowd.length)
      expect(polylineCount(container)).toBeLessThan(crowd.length)
    }
  )

  it.failing('#22: co-located markers spiderfy by camera zoom 19', async () => {
    // Today spiderfy needs camera zoom 22+, beyond Google Maps' maximum.
    const { container } = render(
      <Map points={SAME_SPOT} initialRegion={regionAt(CENTER, 19)} />
    )
    await flush()

    expect(clusterLabels(container)).toEqual([])
    expect(renderedMarkerIds(container)).toHaveLength(SAME_SPOT.length)
  })

  it.failing(
    '#28: inserting a marker at the start does not remount the others',
    async () => {
      const { rerender } = render(<Map points={SINGLES} />)
      await flush()
      const start = mountLog.length

      rerender(<Map points={[EXTRA, ...SINGLES]} />)
      await flush()

      expect(unmountsSince(start)).toEqual([])
    }
  )
})
