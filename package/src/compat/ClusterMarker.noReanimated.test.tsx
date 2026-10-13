import { beforeEach, describe, expect, it, jest, mock } from 'bun:test'
import { render } from '@testing-library/react'
import React from 'react'

import type { ClusterFeature } from '../geojson/types'

// An app without react-native-reanimated: Metro turns the optional `require`
// into one that throws, which a throwing mock reproduces.
mock.module('react-native-reanimated', () => {
  throw new Error("Cannot find module 'react-native-reanimated'")
})

mock.module('react-native', () => ({
  Platform: { select: (options: Record<string, unknown>) => options.default },
  StyleSheet: { create: (styles: unknown) => styles },
  Text: 'rn-text',
  View: 'rn-view',
}))

const redraw = jest.fn()
const markerProps: Array<Record<string, unknown>> = []

mock.module('react-native-maps', () => ({
  Marker: class Marker extends React.Component<{ children?: React.ReactNode }> {
    redraw = redraw
    render() {
      markerProps.push(this.props)
      return React.createElement('rn-marker', null, this.props.children)
    }
  },
}))

const { reanimated } = await import('./reanimated')
const { default: ClusterMarker } = await import('./ClusterMarker')

const withCount = (count: number): ClusterFeature => ({
  type: 'Feature',
  id: 'cluster-1',
  geometry: { type: 'Point', coordinates: [-122.42, 37.78] },
  properties: {
    cluster: true,
    cluster_id: 1,
    point_count: count,
    point_count_abbreviated: String(count),
    getExpansionRegion: () => ({
      latitude: 37.78,
      longitude: -122.42,
      latitudeDelta: 0.01,
      longitudeDelta: 0.01,
    }),
  },
})

describe('ClusterMarker without Reanimated', () => {
  beforeEach(() => {
    markerProps.length = 0
    redraw.mockClear()
  })

  it('loads no Reanimated module', () => {
    expect(reanimated).toBeNull()
  })

  it('renders a plain marker when a fade is requested', () => {
    const onPress = jest.fn()
    render(
      <ClusterMarker
        feature={withCount(12)}
        onPress={onPress}
        clusterColor="#00B386"
        clusterTextColor="#FFFFFF"
        fadeInDuration={250}
      />
    )

    expect(markerProps).toHaveLength(1)
    expect(markerProps.at(-1)).not.toHaveProperty('animatedProps')
  })

  it('still redraws the plain marker when its count changes', () => {
    const onPress = jest.fn()
    const props = {
      onPress,
      clusterColor: '#00B386',
      clusterTextColor: '#FFFFFF',
      fadeInDuration: 250,
    }
    const { rerender } = render(
      <ClusterMarker {...props} feature={withCount(12)} />
    )

    rerender(<ClusterMarker {...props} feature={withCount(7)} />)

    expect(redraw).toHaveBeenCalledTimes(1)
  })
})
