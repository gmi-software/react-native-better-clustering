import { beforeEach, describe, expect, it, jest, mock } from 'bun:test'
import { render } from '@testing-library/react'
import React from 'react'

import type { ClusterFeature } from '../geojson/types'
import type { ClusterMarkerProps } from './ClusterMarker'

// Registered before the module under test is imported (below), so its
// react-native / reanimated / maps imports resolve to these stubs.
mock.module('react-native', () => ({
  Platform: { select: (options: Record<string, unknown>) => options.default },
  StyleSheet: { create: (styles: unknown) => styles },
  Text: 'Text',
  View: 'View',
}))

mock.module('react-native-reanimated', () => ({
  __esModule: true,
  default: { createAnimatedComponent: (component: unknown) => component },
  useSharedValue: (value: unknown) => ({ value }),
  useAnimatedProps: (worklet: () => unknown) => worklet(),
  withTiming: (value: unknown) => value,
}))

const redraw = jest.fn()

mock.module('react-native-maps', () => ({
  Marker: class Marker extends React.Component<{ children?: React.ReactNode }> {
    redraw = redraw
    render() {
      return React.createElement('rn-marker', null, this.props.children)
    }
  },
}))

const { default: ClusterMarker, areClusterMarkerPropsEqual } =
  await import('./ClusterMarker')

const CLUSTER: ClusterFeature = {
  type: 'Feature',
  id: 'cluster-1',
  geometry: { type: 'Point', coordinates: [-122.42, 37.78] },
  properties: {
    cluster: true,
    cluster_id: 1,
    point_count: 12,
    point_count_abbreviated: '12',
    getExpansionRegion: () => ({
      latitude: 37.78,
      longitude: -122.42,
      latitudeDelta: 0.01,
      longitudeDelta: 0.01,
    }),
  },
}

function baseProps(
  overrides: Partial<ClusterMarkerProps> = {}
): ClusterMarkerProps {
  return {
    feature: CLUSTER,
    onPress: jest.fn(),
    clusterColor: '#00B386',
    clusterTextColor: '#FFFFFF',
    ...overrides,
  }
}

describe('ClusterMarker redraw', () => {
  const withCount = (count: number): ClusterFeature => ({
    ...CLUSTER,
    properties: { ...CLUSTER.properties, point_count: count },
  })

  beforeEach(() => {
    redraw.mockClear()
  })

  it('redraws a mounted bubble when its count or colour changes', () => {
    const onPress = jest.fn()
    const { rerender } = render(
      <ClusterMarker {...baseProps({ onPress, feature: withCount(12) })} />
    )
    expect(redraw).not.toHaveBeenCalled()

    rerender(
      <ClusterMarker {...baseProps({ onPress, feature: withCount(7) })} />
    )
    expect(redraw).toHaveBeenCalledTimes(1)

    rerender(
      <ClusterMarker
        {...baseProps({
          onPress,
          feature: withCount(7),
          clusterColor: '#FF5722',
        })}
      />
    )
    expect(redraw).toHaveBeenCalledTimes(2)
  })

  it('does not redraw when only the position changes', () => {
    const onPress = jest.fn()
    const { rerender } = render(<ClusterMarker {...baseProps({ onPress })} />)

    rerender(
      <ClusterMarker
        {...baseProps({
          onPress,
          feature: {
            ...CLUSTER,
            geometry: { type: 'Point', coordinates: [-122.43, 37.79] },
          },
        })}
      />
    )

    expect(redraw).not.toHaveBeenCalled()
  })

  it('leaves redrawing to the map while tracksViewChanges is on', () => {
    const onPress = jest.fn()
    const { rerender } = render(
      <ClusterMarker {...baseProps({ onPress, tracksViewChanges: true })} />
    )

    rerender(
      <ClusterMarker
        {...baseProps({
          onPress,
          tracksViewChanges: true,
          feature: withCount(7),
        })}
      />
    )

    expect(redraw).not.toHaveBeenCalled()
  })
})

describe('areClusterMarkerPropsEqual', () => {
  it('returns true when feature and stable onPress reference are unchanged', () => {
    const onPress = jest.fn()
    const prev = baseProps({ onPress })
    const next = baseProps({ onPress })

    expect(areClusterMarkerPropsEqual(prev, next)).toBe(true)
  })

  it('returns false when onPress reference changes', () => {
    const prev = baseProps({ onPress: jest.fn() })
    const next = baseProps({ onPress: jest.fn() })

    expect(areClusterMarkerPropsEqual(prev, next)).toBe(false)
  })

  it('returns false when fadeInDuration changes', () => {
    const onPress = jest.fn()
    const prev = baseProps({ onPress, fadeInDuration: 0 })
    const next = baseProps({ onPress, fadeInDuration: 250 })

    expect(areClusterMarkerPropsEqual(prev, next)).toBe(false)
  })

  it('returns false when feature reference changes', () => {
    const onPress = jest.fn()
    const otherCluster: ClusterFeature = {
      ...CLUSTER,
      id: 'cluster-2',
      properties: { ...CLUSTER.properties, cluster_id: 2 },
    }

    const prev = baseProps({ onPress, feature: CLUSTER })
    const next = baseProps({ onPress, feature: otherCluster })

    expect(areClusterMarkerPropsEqual(prev, next)).toBe(false)
  })
})
