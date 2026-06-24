jest.mock('react-native', () => ({
  Platform: { select: (options: Record<string, unknown>) => options.default },
  StyleSheet: { create: (styles: unknown) => styles },
  Text: 'Text',
  View: 'View',
}))

jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: { createAnimatedComponent: (component: unknown) => component },
  useSharedValue: (value: unknown) => ({ value }),
  useAnimatedProps: (worklet: () => unknown) => worklet(),
  withTiming: (value: unknown) => value,
}))

jest.mock('react-native-maps', () => ({
  Marker: 'Marker',
}))

import type { ClusterFeature } from '../geojson/types'
import {
  areClusterMarkerPropsEqual,
  type ClusterMarkerProps,
} from './ClusterMarker'

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
