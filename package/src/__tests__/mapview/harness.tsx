/**
 * Test harness for the compat `MapView`.
 *
 * Importing this module registers module mocks for react-native,
 * react-native-maps, react-native-reanimated and react-native-nitro-modules
 * (backed by the supercluster fake engine). Test files must import it before
 * they load `MapView`, and then load `MapView` with a dynamic `import()` —
 * static imports are evaluated before any `mock.module()` call runs:
 *
 *   import { … } from './harness'
 *   const { default: MapView } = await import('../../compat/MapView')
 *
 * The mocks render host elements into happy-dom (`rn-map`, `rn-marker`,
 * `rn-polyline`, `rn-view`, `rn-text`) and record what the map was asked to
 * do, so tests can assert on rendered markers, mount/unmount churn and map
 * commands.
 */
import { mock } from 'bun:test'
import { act, fireEvent } from '@testing-library/react'
import {
  createElement,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useState,
  type ReactNode,
} from 'react'

import {
  createFakeClusterEngine,
  fakeClusterEngineStats,
  resetFakeClusterEngineStats,
} from '../fakes/fakeClusterEngine'

export { fakeClusterEngineStats }

// ---------------------------------------------------------------------------
// Controls and recorded state
// ---------------------------------------------------------------------------

export interface LatLng {
  latitude: number
  longitude: number
}

export interface MapRegionLike extends LatLng {
  latitudeDelta: number
  longitudeDelta: number
}

export interface HarnessControls {
  /** Whether the map mock reports `onMapReady` after mounting. */
  mapReady: boolean
  /** Size the container `View` reports through `onLayout`. */
  layout: { width: number; height: number }
  /** When set, `createHybridObject` throws it (native module missing). */
  createHybridObjectError: Error | null
}

export const harnessControls: HarnessControls = {
  mapReady: true,
  layout: { width: 390, height: 844 },
  createHybridObjectError: null,
}

export interface MountEvent {
  type: 'mount' | 'unmount'
  id: string
}

/** Every Marker mount and unmount, in order. */
export const mountLog: MountEvent[] = []

export interface MapMockProps {
  children?: ReactNode
  onMapReady?: () => void
  onRegionChange?: (region: MapRegionLike, details: object) => void
  onRegionChangeComplete?: (region: MapRegionLike, details: object) => void
}

export const mapState = {
  /** The props the native map received on its latest render. */
  props: null as MapMockProps | null,
  fitToCoordinates: [] as Array<{
    coordinates: LatLng[]
    options: unknown
  }>,
  animateToRegion: [] as Array<{ region: MapRegionLike; duration: unknown }>,
}

export const layoutAnimationCalls: unknown[] = []

export function resetHarness(): void {
  harnessControls.mapReady = true
  harnessControls.layout = { width: 390, height: 844 }
  harnessControls.createHybridObjectError = null
  mountLog.length = 0
  mapState.props = null
  mapState.fitToCoordinates = []
  mapState.animateToRegion = []
  layoutAnimationCalls.length = 0
  resetFakeClusterEngineStats()
}

// ---------------------------------------------------------------------------
// react-native
// ---------------------------------------------------------------------------

interface ViewMockProps {
  children?: ReactNode
  onLayout?: (event: {
    nativeEvent: {
      layout: { x: number; y: number; width: number; height: number }
    }
  }) => void
  [key: string]: unknown
}

function View({ children, onLayout }: ViewMockProps) {
  useEffect(() => {
    onLayout?.({
      nativeEvent: { layout: { x: 0, y: 0, ...harnessControls.layout } },
    })
    // Reports its size once, on mount, like a first native layout pass.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return createElement('rn-view', null, children)
}

function Text({ children }: { children?: ReactNode }) {
  return createElement('rn-text', null, children)
}

mock.module('react-native', () => ({
  Dimensions: {
    get: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 }),
  },
  LayoutAnimation: {
    Types: { easeInEaseOut: 'easeInEaseOut' },
    Properties: { opacity: 'opacity', scaleXY: 'scaleXY' },
    configureNext: (config: unknown) => {
      layoutAnimationCalls.push(config)
    },
  },
  Platform: {
    OS: 'ios',
    select: (options: Record<string, unknown>) =>
      options.ios ?? options.default,
  },
  StyleSheet: { create: <T,>(styles: T): T => styles },
  View,
  Text,
}))

// ---------------------------------------------------------------------------
// react-native-reanimated
// ---------------------------------------------------------------------------

mock.module('react-native-reanimated', () => ({
  __esModule: true,
  default: {
    createAnimatedComponent: <T,>(component: T): T => component,
  },
  useSharedValue: <T,>(value: T) => ({ value }),
  useAnimatedProps: <T,>(worklet: () => T): T => worklet(),
  withTiming: <T,>(value: T): T => value,
}))

// ---------------------------------------------------------------------------
// react-native-maps
// ---------------------------------------------------------------------------

export interface MarkerMockProps {
  coordinate: LatLng
  testID?: string
  onPress?: () => void
  cluster?: boolean
  children?: ReactNode
  [key: string]: unknown
}

function markerId({ testID, coordinate }: MarkerMockProps): string {
  return (
    testID ??
    `cluster@${coordinate.latitude.toFixed(6)},${coordinate.longitude.toFixed(6)}`
  )
}

/** Mock `Marker`. Use `testID` to identify user markers in assertions. */
export function Marker(props: MarkerMockProps) {
  // The id a marker had when it mounted, so unmount logs name the same marker.
  const [id] = useState(() => markerId(props))
  useEffect(() => {
    mountLog.push({ type: 'mount', id })
    return () => {
      mountLog.push({ type: 'unmount', id })
    }
  }, [id])

  const { onPress } = props
  return createElement(
    'rn-marker',
    {
      'data-id': props.testID ?? '',
      'data-cluster': props.testID == null ? 'true' : 'false',
      'data-latitude': String(props.coordinate.latitude),
      'data-longitude': String(props.coordinate.longitude),
      'onClick': onPress == null ? undefined : () => onPress(),
    },
    props.children
  )
}

export function Polyline({ coordinates }: { coordinates: LatLng[] }) {
  return createElement('rn-polyline', {
    'data-points': String(coordinates.length),
  })
}

interface MapHandle {
  fitToCoordinates: (coordinates: LatLng[], options?: unknown) => void
  animateToRegion: (region: MapRegionLike, duration?: unknown) => void
}

const MapViewMock = forwardRef<MapHandle, MapMockProps>(
  function MapViewMock(props, ref) {
    useLayoutEffect(() => {
      mapState.props = props
    })
    useImperativeHandle(ref, () => ({
      fitToCoordinates: (coordinates, options) => {
        mapState.fitToCoordinates.push({ coordinates, options })
      },
      animateToRegion: (region, duration) => {
        mapState.animateToRegion.push({ region, duration })
      },
    }))
    const { onMapReady } = props
    useEffect(() => {
      if (harnessControls.mapReady) onMapReady?.()
      // The native map reports readiness once.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
    return createElement('rn-map', null, props.children)
  }
)

mock.module('react-native-maps', () => ({
  __esModule: true,
  default: MapViewMock,
  Marker,
  Polyline,
}))

// ---------------------------------------------------------------------------
// react-native-nitro-modules
// ---------------------------------------------------------------------------

mock.module('react-native-nitro-modules', () => ({
  NitroModules: {
    createHybridObject: (name: string) => {
      if (harnessControls.createHybridObjectError != null) {
        throw harnessControls.createHybridObjectError
      }
      if (name !== 'ClusterEngine') {
        throw new Error(`Unexpected HybridObject ${name}`)
      }
      return createFakeClusterEngine()
    },
  },
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * The region a `width` × `height` pt map shows at a given (fractional)
 * camera zoom, the way react-native-maps reports it (256-pt tiles).
 */
export function regionAt(
  center: LatLng,
  zoom: number,
  width = 390,
  height = 844
): MapRegionLike {
  const longitudeDelta = (360 * width) / (256 * 2 ** zoom)
  const latitudeDelta =
    longitudeDelta *
    (height / width) *
    Math.cos((center.latitude * Math.PI) / 180)
  return { ...center, latitudeDelta, longitudeDelta }
}

/** Lets pending async builds resolve and the resulting renders commit. */
export async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20))
  })
}

/**
 * The DOM members the helpers use. The package tsconfig has no DOM lib (the
 * library must not typecheck against browser globals), so RTL's `container`
 * is an empty `HTMLElement` stub to TypeScript.
 */
interface TestElement {
  getAttribute(name: string): string | null
  querySelectorAll(selectors: string): ArrayLike<TestElement>
  textContent: string | null
}

function queryAll(container: HTMLElement, selectors: string): TestElement[] {
  return Array.from((container as TestElement).querySelectorAll(selectors))
}

export interface RenderedMarker {
  element: TestElement
  /** `testID` of a user marker, or `''` for a cluster bubble. */
  id: string
  isCluster: boolean
  /** Text content — the count label for default cluster bubbles. */
  label: string
  latitude: number
  longitude: number
}

export function renderedMarkers(container: HTMLElement): RenderedMarker[] {
  return queryAll(container, 'rn-marker').map((element) => ({
    element,
    id: element.getAttribute('data-id') ?? '',
    isCluster: element.getAttribute('data-cluster') === 'true',
    label: element.textContent ?? '',
    latitude: Number(element.getAttribute('data-latitude')),
    longitude: Number(element.getAttribute('data-longitude')),
  }))
}

/** Number of spiderfy connector lines (and other `Polyline`s) on the map. */
export function polylineCount(container: HTMLElement): number {
  return queryAll(container, 'rn-polyline').length
}

export function renderedMarkerIds(container: HTMLElement): string[] {
  return renderedMarkers(container)
    .filter((marker) => !marker.isCluster)
    .map((marker) => marker.id)
    .sort()
}

export function clusterLabels(container: HTMLElement): string[] {
  return renderedMarkers(container)
    .filter((marker) => marker.isCluster)
    .map((marker) => marker.label)
    .sort()
}

export function press(marker: RenderedMarker): void {
  act(() => {
    fireEvent.click(marker.element)
  })
}

/** Reports a settled camera move, as react-native-maps does after a gesture. */
export async function settleRegion(region: MapRegionLike): Promise<void> {
  act(() => {
    mapState.props?.onRegionChangeComplete?.(region, { isGesture: true })
  })
  await flush()
}

export function unmountsSince(start: number): string[] {
  return mountLog
    .slice(start)
    .filter((event) => event.type === 'unmount')
    .map((event) => event.id)
}
