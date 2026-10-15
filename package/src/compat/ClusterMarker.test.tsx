import { beforeEach, describe, expect, it, jest, mock } from 'bun:test'
import { render } from '@testing-library/react'
import React from 'react'

import { fakeReanimated } from '../__tests__/fakes/fakeReanimated'
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

const withTiming = jest.fn(fakeReanimated.withTiming)
mock.module('react-native-reanimated', () => ({
  ...fakeReanimated,
  withTiming,
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

describe('ClusterMarker fade', () => {
  beforeEach(() => {
    markerProps.length = 0
  })

  it('drives the native opacity through Reanimated when a fade is requested', () => {
    render(<ClusterMarker {...baseProps({ fadeInDuration: 250 })} />)

    // Mounts transparent; the effect then animates the shared value to 1.
    expect(markerProps.at(-1)?.animatedProps).toEqual({
      opacity: 0,
      coordinate: { latitude: 37.78, longitude: -122.42 },
    })
  })

  it('mounts opaque when it appears instantly', () => {
    render(
      <ClusterMarker
        {...baseProps({ fadeInDuration: 250, appearInstantly: true })}
      />
    )

    expect(markerProps.at(-1)?.animatedProps).toEqual({
      opacity: 1,
      coordinate: { latitude: 37.78, longitude: -122.42 },
    })
  })

  it('fades an exiting bubble out over its fade-out duration', () => {
    const props = baseProps({ fadeInDuration: 250, appearInstantly: true })
    const { rerender } = render(<ClusterMarker {...props} />)
    withTiming.mockClear()

    rerender(<ClusterMarker {...props} exiting />)

    expect(withTiming).toHaveBeenCalledWith(0, { duration: 250 })
  })

  it('keeps an exiting bubble as it is when its fade-out is 0', () => {
    const props = baseProps({
      fadeInDuration: 250,
      fadeOutDuration: 0,
      appearInstantly: true,
    })
    const { rerender } = render(<ClusterMarker {...props} />)
    withTiming.mockClear()

    rerender(<ClusterMarker {...props} exiting />)

    expect(withTiming).not.toHaveBeenCalled()
  })

  it('does not restart the fade when a re-render keeps its target', () => {
    const props = baseProps({ fadeInDuration: 250 })
    const { rerender } = render(<ClusterMarker {...props} />)
    withTiming.mockClear()

    rerender(<ClusterMarker {...props} fadeInDuration={300} />)

    expect(withTiming).not.toHaveBeenCalled()
  })

  it('renders a plain marker when the fade is off', () => {
    render(<ClusterMarker {...baseProps({ fadeInDuration: 0 })} />)

    expect(markerProps.at(-1)).not.toHaveProperty('animatedProps')
  })
})

describe('ClusterMarker glide', () => {
  const at = (latitude: number, longitude: number): ClusterFeature => ({
    ...CLUSTER,
    geometry: { type: 'Point', coordinates: [longitude, latitude] },
  })
  const GLIDE = { duration: 250, easing: 'out(cubic)' }

  beforeEach(() => {
    markerProps.length = 0
    withTiming.mockClear()
  })

  it('mounts at the bubble it split from and glides to its own place', () => {
    render(
      <ClusterMarker
        {...baseProps({
          fadeInDuration: 250,
          glideFrom: { latitude: 37.7, longitude: -122.5 },
        })}
      />
    )

    expect(markerProps.at(-1)?.animatedProps).toMatchObject({
      coordinate: { latitude: 37.7, longitude: -122.5 },
    })
    expect(withTiming).toHaveBeenCalledWith(37.78, GLIDE)
    expect(withTiming).toHaveBeenCalledWith(-122.42, GLIDE)
  })

  it('glides to the new place when its cluster moves', () => {
    const onPress = jest.fn()
    const { rerender } = render(
      <ClusterMarker {...baseProps({ onPress, fadeInDuration: 250 })} />
    )
    withTiming.mockClear()

    rerender(
      <ClusterMarker
        {...baseProps({
          onPress,
          fadeInDuration: 250,
          feature: at(37.8, -122.4),
        })}
      />
    )

    expect(withTiming).toHaveBeenCalledWith(37.8, GLIDE)
    expect(withTiming).toHaveBeenCalledWith(-122.4, GLIDE)
  })

  it('glides an exiting bubble into the one that took it in', () => {
    const props = baseProps({ fadeInDuration: 250, appearInstantly: true })
    const { rerender } = render(<ClusterMarker {...props} />)
    withTiming.mockClear()

    rerender(
      <ClusterMarker
        {...props}
        exiting
        glideTo={{ latitude: 37.9, longitude: -122.3 }}
        glideDuration={100}
      />
    )

    const timing = { duration: 100, easing: 'out(cubic)' }
    expect(withTiming).toHaveBeenCalledWith(37.9, timing)
    expect(withTiming).toHaveBeenCalledWith(-122.3, timing)
  })

  it('fades an exiting bubble in place without a bubble to glide into', () => {
    const props = baseProps({ fadeInDuration: 250, appearInstantly: true })
    const { rerender } = render(<ClusterMarker {...props} />)
    withTiming.mockClear()

    rerender(<ClusterMarker {...props} exiting />)

    expect(withTiming).toHaveBeenCalledTimes(1)
    expect(withTiming).toHaveBeenCalledWith(0, { duration: 250 })
  })

  it('moves at once when the glide duration is 0', () => {
    const onPress = jest.fn()
    const props = baseProps({ onPress, fadeInDuration: 250, glideDuration: 0 })
    const { rerender } = render(<ClusterMarker {...props} />)
    withTiming.mockClear()

    rerender(<ClusterMarker {...props} feature={at(37.8, -122.4)} />)

    expect(withTiming).not.toHaveBeenCalled()
  })

  it('does not restart the glide when a re-render keeps its place', () => {
    const onPress = jest.fn()
    const { rerender } = render(
      <ClusterMarker
        {...baseProps({
          onPress,
          fadeInDuration: 250,
          glideFrom: { latitude: 37.7, longitude: -122.5 },
        })}
      />
    )
    withTiming.mockClear()

    rerender(
      <ClusterMarker
        {...baseProps({ onPress, fadeInDuration: 250, glideDuration: 300 })}
      />
    )

    expect(withTiming).not.toHaveBeenCalled()
  })
})

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

  it('redraws a fading bubble through its animated marker', () => {
    const onPress = jest.fn()
    const { rerender } = render(
      <ClusterMarker
        {...baseProps({ onPress, fadeInDuration: 250, feature: withCount(12) })}
      />
    )

    rerender(
      <ClusterMarker
        {...baseProps({ onPress, fadeInDuration: 250, feature: withCount(7) })}
      />
    )

    expect(markerProps.at(-1)).toHaveProperty('animatedProps')
    expect(redraw).toHaveBeenCalledTimes(1)
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

  it('returns true when only appearInstantly changes', () => {
    const onPress = jest.fn()
    const prev = baseProps({ onPress, appearInstantly: true })
    const next = baseProps({ onPress, appearInstantly: false })

    expect(areClusterMarkerPropsEqual(prev, next)).toBe(true)
  })

  it('returns true when only glideFrom changes', () => {
    const onPress = jest.fn()
    const prev = baseProps({ onPress })
    const next = baseProps({
      onPress,
      glideFrom: { latitude: 1, longitude: 2 },
    })

    expect(areClusterMarkerPropsEqual(prev, next)).toBe(true)
  })

  it('compares glideTo by position', () => {
    const onPress = jest.fn()
    const glideTo = (latitude: number) => ({ latitude, longitude: 2 })

    expect(
      areClusterMarkerPropsEqual(
        baseProps({ onPress, glideTo: glideTo(1) }),
        baseProps({ onPress, glideTo: glideTo(1) })
      )
    ).toBe(true)
    expect(
      areClusterMarkerPropsEqual(
        baseProps({ onPress, glideTo: glideTo(1) }),
        baseProps({ onPress, glideTo: glideTo(3) })
      )
    ).toBe(false)
    expect(
      areClusterMarkerPropsEqual(
        baseProps({ onPress }),
        baseProps({ onPress, glideTo: glideTo(1) })
      )
    ).toBe(false)
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
