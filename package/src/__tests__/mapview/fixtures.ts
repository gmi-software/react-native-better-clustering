import type { LatLng } from './harness'

export interface TestPoint extends LatLng {
  id: string
  /** Passed through as the Marker `cluster` prop. */
  cluster?: boolean
}

export const CENTER: LatLng = { latitude: 52.2, longitude: 21.0 }

/** Camera zoom at which GROUP is one cluster and SINGLES stay single. */
export const CITY_ZOOM = 14

/** Five points ~10 m apart: always one cluster at CITY_ZOOM. */
export const GROUP: TestPoint[] = Array.from({ length: 5 }, (_, i) => ({
  id: `g${i}`,
  latitude: CENTER.latitude + i * 0.0001,
  longitude: CENTER.longitude + i * 0.0001,
}))

/** Three points ~700 m apart and away from GROUP: never clustered at CITY_ZOOM. */
export const SINGLES: TestPoint[] = [
  { id: 's0', latitude: 52.2, longitude: 21.01 },
  { id: 's1', latitude: 52.2, longitude: 21.02 },
  { id: 's2', latitude: 52.2, longitude: 20.99 },
]

/** Five points at exactly the same coordinate (same building). */
export const SAME_SPOT: TestPoint[] = Array.from({ length: 5 }, (_, i) => ({
  id: `same${i}`,
  latitude: CENTER.latitude,
  longitude: CENTER.longitude,
}))
