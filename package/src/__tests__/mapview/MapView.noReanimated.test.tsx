/**
 * MapView in an app without react-native-reanimated, an optional peer: the
 * default bubbles render without the fade, and the developer hears about it
 * once.
 */
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
import { act, render } from '@testing-library/react'
import React from 'react'

import { CENTER, CITY_ZOOM, GROUP } from './fixtures'
import {
  Marker,
  clusterLabels,
  flush,
  mapState,
  regionAt,
  renderedMarkerIds,
  resetHarness,
} from './harness'

// Replaces the harness's Reanimated mock. Metro turns the optional `require`
// of a missing package into one that throws, which this reproduces.
mock.module('react-native-reanimated', () => {
  throw new Error("Cannot find module 'react-native-reanimated'")
})

const { default: MapView } = await import('../../compat/MapView')

type MapViewProps = React.ComponentProps<typeof MapView>

function Map(props: Partial<MapViewProps>) {
  return (
    <MapView initialRegion={regionAt(CENTER, CITY_ZOOM)} {...props}>
      {GROUP.map((point) => (
        <Marker key={point.id} testID={point.id} coordinate={point} />
      ))}
    </MapView>
  )
}

const NOTICE = /react-native-reanimated is not available/

function fadeNotices(warn: ReturnType<typeof spyOn>): unknown[][] {
  return warn.mock.calls.filter((call: unknown[]) =>
    NOTICE.test(String(call[0]))
  )
}

describe('MapView without Reanimated', () => {
  let warn: ReturnType<typeof spyOn>

  beforeEach(() => {
    resetHarness()
    warn = spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warn.mockRestore()
  })

  // The notice is once per app, so the silent cases run before it fires.
  it('stays silent when the fade is turned off', async () => {
    render(<Map clusterFadeInDuration={0} />)
    render(<Map animationEnabled={false} />)
    render(
      <Map
        renderCluster={(cluster) => {
          const [longitude, latitude] = cluster.geometry.coordinates
          return (
            <Marker
              testID="custom-cluster"
              coordinate={{ latitude, longitude }}
            />
          )
        }}
      />
    )
    await flush()

    expect(fadeNotices(warn)).toHaveLength(0)
  })

  it('renders the default bubbles and warns once that they cannot fade', async () => {
    const first = render(<Map />)
    await flush()
    expect(clusterLabels(first.container)).toEqual(['5'])

    first.unmount()
    const second = render(<Map />)
    await flush()
    expect(clusterLabels(second.container)).toEqual(['5'])

    expect(fadeNotices(warn)).toHaveLength(1)
    expect(String(fadeNotices(warn)[0]?.[0])).toContain(
      "Cannot find module 'react-native-reanimated'"
    )
  })

  it('drops a removed bubble at once instead of keeping it for a fade it cannot play', async () => {
    const { container } = render(<Map />)
    await flush()
    expect(clusterLabels(container)).toEqual(['5'])

    jest.useFakeTimers()
    try {
      act(() => {
        mapState.props?.onRegionChangeComplete?.(regionAt(GROUP[2]!, 20), {
          isGesture: true,
        })
      })

      expect(clusterLabels(container)).toEqual([])
      expect(renderedMarkerIds(container)).toEqual(GROUP.map((p) => p.id))
    } finally {
      jest.useRealTimers()
    }
  })
})
