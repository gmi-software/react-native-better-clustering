/**
 * How the default cluster bubbles glide on zoom: the parts of a splitting
 * cluster glide out of it, merging bubbles glide into the one that takes
 * them in, and pans only fade.
 */
import { beforeEach, describe, expect, it } from 'bun:test'
import { act, render } from '@testing-library/react'
import React from 'react'

import type { TestPoint } from './fixtures'
import {
  Marker,
  flush,
  glideAnimations,
  mapState,
  regionAt,
  renderedMarkers,
  resetHarness,
  settleRegion,
  type LatLng,
} from './harness'

const { default: MapView } = await import('../../compat/MapView')

/**
 * Two tight groups ~270 m apart: one bubble of 6 up to camera zoom 14, a
 * bubble of 3 each from 15.
 */
const PAIR: TestPoint[] = [
  ...Array.from({ length: 3 }, (_, i) => ({
    id: `a${i}`,
    latitude: 52.2 + i * 0.00001,
    longitude: 21.0,
  })),
  ...Array.from({ length: 3 }, (_, i) => ({
    id: `b${i}`,
    latitude: 52.2 + i * 0.00001,
    longitude: 21.004,
  })),
]
const BETWEEN: LatLng = { latitude: 52.2, longitude: 21.002 }

function GlidingMap({ initialRegion }: { initialRegion: object }) {
  return (
    <MapView initialRegion={initialRegion as never}>
      {PAIR.map((point) => (
        <Marker key={point.id} testID={point.id} coordinate={point} />
      ))}
    </MapView>
  )
}

const bubbles = (container: HTMLElement) =>
  renderedMarkers(container).filter((marker) => marker.isCluster)

const at = ({ latitude, longitude }: LatLng) => ({ latitude, longitude })

/**
 * How long each glide to about `longitude` takes: where bubbles head east or
 * west. The index puts a cluster within a few metres of its points' mean.
 */
const glidesTo = (longitude: number) =>
  glideAnimations
    .filter(
      ({ to }) => typeof to === 'number' && Math.abs(to - longitude) < 1e-4
    )
    .map(({ duration }) => duration)

// The two groups' and the bubble of 6's longitudes.
const WEST = 21.0
const EAST = 21.004
const MIDDLE = 21.002

beforeEach(() => {
  resetHarness()
})

describe('MapView bubble glide', () => {
  it('glides the parts of a cluster that splits on zoom in out of it', async () => {
    const { container } = render(
      <GlidingMap initialRegion={regionAt(BETWEEN, 14)} />
    )
    await flush()
    const [merged] = bubbles(container)
    expect(merged?.label).toBe('6')

    await settleRegion(regionAt(BETWEEN, 15))

    // The new eastern part mounts where the bubble of 6 was, and the bubble
    // of 6 becomes the western part: both glide from there to their places.
    const parts = bubbles(container)
    expect(parts.map((bubble) => bubble.label)).toEqual(['3', '3'])
    for (const part of parts) {
      expect(part.start).toEqual(at(merged!.start!))
    }
    expect(glidesTo(EAST)).toEqual([250])
    expect(glidesTo(WEST)).toEqual([250])
  })

  it('glides a bubble that merges on zoom out into the one that takes it in', async () => {
    const { container } = render(
      <GlidingMap initialRegion={regionAt(BETWEEN, 15)} />
    )
    await flush()

    await settleRegion(regionAt(BETWEEN, 14))

    expect(bubbles(container).map((bubble) => bubble.label)).toEqual(['6', '3'])
    // The western bubble becomes the bubble of 6 and slides to its middle;
    // the eastern one goes and glides there as it fades.
    expect(glidesTo(MIDDLE)).toEqual([250, 250])
  })

  it('glides a merging bubble within its hold while the map moves', async () => {
    const { container } = render(
      <GlidingMap initialRegion={regionAt(BETWEEN, 15)} />
    )
    await flush()

    act(() => {
      mapState.props?.onRegionChange?.(regionAt(BETWEEN, 14), {
        isGesture: true,
      })
    })

    expect(bubbles(container)).toHaveLength(2)
    expect(glidesTo(MIDDLE)).toContain(100)
  })

  it('fades in a bubble that comes into view on a pan without gliding', async () => {
    // At this zoom and centre, the region queried around the map reaches the
    // western group but not the eastern one.
    const west = { latitude: 52.2, longitude: 20.9946 }
    const { container } = render(
      <GlidingMap initialRegion={regionAt(west, 16)} />
    )
    await flush()
    expect(bubbles(container)).toHaveLength(1)

    await settleRegion(regionAt(BETWEEN, 16))

    const entering = bubbles(container).find(
      (bubble) => bubble.longitude > MIDDLE
    )
    expect(entering?.start).toEqual(at(entering!))
    expect(glideAnimations).toEqual([])
  })
})
