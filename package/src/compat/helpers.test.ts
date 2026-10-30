import { describe, expect, it } from 'bun:test'
import React from 'react'

import {
  bboxToFitCoordinates,
  createChildrenCache,
  createMarkerFeatureCache,
  elementKey,
  flattenChildren,
  markerToGeoJSONFeature,
  sortByKey,
  splitMarkerChildren,
} from './helpers'
import { isClusterFeature } from '../geojson'

describe('markerToGeoJSONFeature', () => {
  function Marker(_props: Record<string, unknown>) {
    return null
  }

  it('keeps marker props but never the ones that mark a cluster (#14)', () => {
    const marker = React.createElement(
      Marker,
      {
        coordinate: { latitude: 52.2, longitude: 21.0 },
        title: 'Office',
        cluster: true,
        cluster_id: 7,
        point_count: 5,
        point_count_abbreviated: '5',
        getExpansionRegion: () => null,
        index: 99,
      },
      'child'
    ) as React.ReactElement<never>

    const feature = markerToGeoJSONFeature(marker, 2)

    expect(feature.geometry.coordinates).toEqual([21.0, 52.2])
    expect(feature.properties).toEqual({
      title: 'Office',
      point_count: 0,
      index: 2,
    })
    expect(isClusterFeature(feature)).toBe(false)
  })
})

describe('splitMarkerChildren', () => {
  function Marker(_props: Record<string, unknown>) {
    return null
  }

  function marker(key: string, latitude: number, cluster?: boolean) {
    return React.createElement(Marker, {
      key,
      cluster,
      coordinate: { latitude, longitude: 21.0 },
    })
  }

  function split(
    children: React.ReactNode[],
    cache: ReturnType<typeof createMarkerFeatureCache>
  ) {
    return splitMarkerChildren(React.Children.toArray(children), cache)
  }

  it('keeps the point of a marker whose props and child index stay the same', () => {
    const cache = createMarkerFeatureCache()
    const a = marker('a', 52.0)
    const first = split([a, marker('b', 52.1)], cache)
    const second = split([a, marker('b', 52.2)], cache)

    expect(second.markerFeatures[0]).toBe(first.markerFeatures[0]!)
    expect(second.markerFeatures[1]).not.toBe(first.markerFeatures[1]!)
    expect(second.markerFeatures[1]!.geometry.coordinates).toEqual([21.0, 52.2])
  })

  it('makes a new point for a marker at another child index', () => {
    const cache = createMarkerFeatureCache()
    const a = marker('a', 52.0)
    const first = split([a], cache)
    const second = split([marker('x', 52.3), a], cache)

    expect(second.markerFeatures[1]).not.toBe(first.markerFeatures[0]!)
    expect(second.markerFeatures[1]!.properties.index).toBe(1)
  })

  it('makes a new point for a marker whose key changed at the same index', () => {
    const cache = createMarkerFeatureCache()
    const a = marker('a', 52.0)
    const first = split([a], cache)
    // Nested one slot later, `Children.toArray` keys it `.1:$a` instead of `.$a`.
    const second = split([null, [a]], cache)

    expect(second.markerFeatures[0]!.properties.index).toBe(0)
    expect(second.markerFeatures[0]).not.toBe(first.markerFeatures[0]!)
  })

  it('returns the previous list while every point stays the same', () => {
    const cache = createMarkerFeatureCache()
    const a = marker('a', 52.0)
    const b = marker('b', 52.1)
    const first = split([a, b, marker('v', 52.5, false)], cache)
    const second = split([a, b, marker('v', 52.6, false)], cache)

    expect(second.markerFeatures).toBe(first.markerFeatures)
    expect(second.otherChildren).toHaveLength(1)
  })

  it('leaves unclustered markers and other children out of the points', () => {
    const cache = createMarkerFeatureCache()
    const { markerFeatures, otherChildren } = split(
      [marker('a', 52.0), marker('v', 52.5, false), 'label'],
      cache
    )

    expect(markerFeatures).toHaveLength(1)
    expect(otherChildren).toHaveLength(2)
  })

  describe('of flattened children', () => {
    function caches() {
      return {
        children: createChildrenCache(),
        features: createMarkerFeatureCache(),
      }
    }

    function splitFlattened(
      children: React.ReactNode[],
      { children: childrenCache, features }: ReturnType<typeof caches>
    ) {
      return splitMarkerChildren(
        flattenChildren(children, childrenCache),
        features
      )
    }

    /** Counts the per-marker lookups `splitMarkerChildren` makes. */
    function countLookups(cache: ReturnType<typeof createMarkerFeatureCache>) {
      const points = cache.points
      const counter = { lookups: 0 }
      cache.points = {
        get: (props: object) => {
          counter.lookups++
          return points.get(props)
        },
        set: (props: object, value: never) => points.set(props, value),
      } as never
      return counter
    }

    const kept = Array.from({ length: 100 }, (_, index) =>
      marker(`s${index}`, 52.0 + index / 1000)
    )

    it('visits only the markers of the runs that changed', () => {
      const cache = caches()
      const first = splitFlattened([kept, [marker('v', 52.5)]], cache)
      const counter = countLookups(cache.features)
      const second = splitFlattened([kept, [marker('v', 52.6)]], cache)

      expect(counter.lookups).toBe(1)
      expect(second.markerFeatures).not.toBe(first.markerFeatures)
      expect(second.markerFeatures.slice(0, 100)).toEqual(
        first.markerFeatures.slice(0, 100)
      )
      second.markerFeatures.slice(0, 100).forEach((feature, index) => {
        expect(feature).toBe(first.markerFeatures[index]!)
      })
      expect(second.markerFeatures[100]!.geometry.coordinates).toEqual([
        21.0, 52.6,
      ])
      expect(second.markerFeatures[100]!.properties.index).toBe(100)
    })

    it('returns the previous list when only unclustered children change', () => {
      const cache = caches()
      const first = splitFlattened(
        [kept, [marker('v', 52.5, false), 'label']],
        cache
      )
      const second = splitFlattened(
        [kept, [marker('v', 52.6, false), 'label']],
        cache
      )

      expect(second.markerFeatures).toBe(first.markerFeatures)
      expect(second.otherChildren).toHaveLength(2)
    })

    it('makes the points of a kept run again when it starts at another index', () => {
      const cache = caches()
      const first = splitFlattened([[marker('v', 52.5)], kept], cache)
      const second = splitFlattened(
        [[marker('v', 52.5), marker('w', 52.6)], kept],
        cache
      )

      expect(second.markerFeatures[2]).not.toBe(first.markerFeatures[1]!)
      second.markerFeatures.forEach((feature, index) => {
        expect(feature.properties.index).toBe(index)
      })
    })

    it('matches a split of Children.toArray', () => {
      const cache = caches()
      const children = [
        [marker('a', 52.0), 'label'],
        marker('b', 52.1),
        [marker('c', 52.2, false), marker('d', 52.3)],
      ]
      splitFlattened(children, cache)
      const reused = splitFlattened(children, cache)
      const expected = split(children, createMarkerFeatureCache())

      expect(reused.markerFeatures).toEqual(expected.markerFeatures)
      expect(reused.otherChildren).toHaveLength(2)
      expect(reused.otherChildren[0]).toBe('label')
    })
  })
})

describe('flattenChildren', () => {
  function Marker(_props: Record<string, unknown>) {
    return null
  }

  /** A `null` key makes an unkeyed marker: React turns `key: null` into `"null"`. */
  function marker(key: string | null, latitude = 52.0) {
    return React.createElement(Marker, {
      key: key ?? undefined,
      coordinate: { latitude, longitude: 21.0 },
    })
  }

  /** What a flattened child is to React: its key, type and props object. */
  function shape(nodes: React.ReactNode[]) {
    return nodes.map((node) =>
      React.isValidElement(node)
        ? { key: node.key, type: node.type, props: node.props }
        : node
    )
  }

  function expectSameAsToArray(children: React.ReactNode) {
    const flattened = flattenChildren(children, createChildrenCache())
    const expected = shape(React.Children.toArray(children))
    expect(shape(flattened)).toEqual(expected)
    flattened.forEach((node, index) => {
      if (React.isValidElement(node)) {
        // The same props object, as `Children.toArray` keeps it.
        expect(node.props).toBe(
          (expected[index] as { props: unknown }).props as never
        )
      }
    })
  }

  it('matches Children.toArray for nested arrays among other children', () => {
    expectSameAsToArray([
      [marker('a'), marker('b')],
      marker('c'),
      null,
      false,
      'label',
      [marker(null), [marker('d'), marker(null)]],
      undefined,
      [],
      marker(null),
    ])
  })

  it('matches Children.toArray for keys that need escaping', () => {
    expectSameAsToArray([[marker('a:b'), marker('c=d'), marker('e/f')]])
  })

  it('matches Children.toArray for an iterable among the children', () => {
    expectSameAsToArray([
      marker('a'),
      new Set([marker('b'), marker(null)]),
      [marker('c')],
    ])
  })

  it('matches Children.toArray for a single child and for many children', () => {
    expectSameAsToArray(marker('a'))
    expectSameAsToArray(
      Array.from({ length: 100 }, (_, index) => marker(`m${index}`))
    )
  })

  it('reuses the elements of a nested array kept at its position', () => {
    const cache = createChildrenCache()
    const kept = [marker('a'), marker('b')]
    const first = flattenChildren([kept, [marker('v', 52.1)]], cache)
    const second = flattenChildren([kept, [marker('v', 52.2)]], cache)

    expect(second[0]).toBe(first[0])
    expect(second[1]).toBe(first[1])
    expect(second[2]).not.toBe(first[2])
  })

  it('flattens a nested array again when it moves or changes in place', () => {
    const cache = createChildrenCache()
    const kept = [marker('a')]
    const first = flattenChildren([kept], cache)

    const moved = flattenChildren([null, kept], cache)
    expect(moved[0]).not.toBe(first[0])
    expect(shape(moved)).toEqual(shape(React.Children.toArray([null, kept])))

    kept.push(marker('b'))
    const grown = flattenChildren([null, kept], cache)
    expect(shape(grown)).toEqual(shape(React.Children.toArray([null, kept])))
  })

  describe('of elements created again', () => {
    const many = (latitude = 52.0) =>
      Array.from({ length: 100 }, (_, index) => marker(`m${index}`, latitude))
    /** `element` first among markers long enough to be compared one by one. */
    const amongMany = (element: React.ReactElement) => [
      element,
      ...many().slice(1),
    ]

    it('reuses the clones of elements with props of the same values', () => {
      const cache = createChildrenCache()
      const first = flattenChildren([many(), null], cache)
      const second = flattenChildren([many(), null], cache)

      second.forEach((node, index) => expect(node).toBe(first[index]))
    })

    it('reuses them for children that are one long array too', () => {
      const cache = createChildrenCache()
      const first = flattenChildren(many(), cache)
      const second = flattenChildren(many(), cache)

      expect(second).toBe(first)
    })

    it('hands the same points to the index, so it compares nothing', () => {
      const childrenCache = createChildrenCache()
      const featureCache = createMarkerFeatureCache()
      const first = splitMarkerChildren(
        flattenChildren([many(), null], childrenCache),
        featureCache
      )
      const second = splitMarkerChildren(
        flattenChildren([many(), null], childrenCache),
        featureCache
      )

      expect(second.markerFeatures).toBe(first.markerFeatures)
    })

    it('clones only an element with other props, under the key it had', () => {
      const cache = createChildrenCache()
      const first = flattenChildren([many(), null], cache)
      const children = many()
      children[7] = marker('m7', 53.0)
      const second = flattenChildren([children, null], cache)

      expect(shape(second)).toEqual(shape(React.Children.toArray([children])))
      second.forEach((node, index) =>
        index === 7
          ? expect(node).not.toBe(first[index])
          : expect(node).toBe(first[index])
      )
    })

    it('makes a point only for the element with other props', () => {
      const childrenCache = createChildrenCache()
      const featureCache = createMarkerFeatureCache()
      const first = splitMarkerChildren(
        flattenChildren(many(), childrenCache),
        featureCache
      ).markerFeatures
      const children = many()
      children[7] = marker('m7', 53.0)
      const second = splitMarkerChildren(
        flattenChildren(children, childrenCache),
        featureCache
      ).markerFeatures

      second.forEach((feature, index) =>
        index === 7
          ? expect(feature.geometry.coordinates[1]).toBe(53.0)
          : expect(feature).toBe(first[index]!)
      )
    })

    it('never reuses an element given a new callback or new children', () => {
      const withProps = (props: Record<string, unknown>) =>
        amongMany(
          React.createElement(Marker, {
            key: 'a',
            coordinate: { latitude: 52.0, longitude: 21.0 },
            ...props,
          })
        )
      const cache = createChildrenCache()
      flattenChildren([withProps({ onPress: () => 1 })], cache)
      const onPress = () => 2
      const [pressed] = flattenChildren([withProps({ onPress })], cache)
      expect(
        (pressed as React.ReactElement<{ onPress: unknown }>).props.onPress
      ).toBe(onPress)

      const child = React.createElement(Marker, { title: 'b' })
      const [withChild] = flattenChildren(
        [withProps({ children: child })],
        cache
      )
      expect(
        (withChild as React.ReactElement<{ children: unknown }>).props.children
      ).toBe(child)
    })

    it('compares plain objects one level deep, and nothing else', () => {
      const withStyle = (style: unknown) =>
        amongMany(
          React.createElement(Marker, {
            key: 'a',
            coordinate: { latitude: 52.0, longitude: 21.0 },
            style,
          })
        )
      const cache = createChildrenCache()
      const [first] = flattenChildren([withStyle({ opacity: 1 })], cache)
      const [same] = flattenChildren([withStyle({ opacity: 1 })], cache)
      expect(same).toBe(first)

      const [nested] = flattenChildren(
        [withStyle({ transform: [{ rotate: '45deg' }] })],
        cache
      )
      const [nestedAgain] = flattenChildren(
        [withStyle({ transform: [{ rotate: '45deg' }] })],
        cache
      )
      expect(nestedAgain).not.toBe(nested)

      const [list] = flattenChildren([withStyle([1])], cache)
      const [listAgain] = flattenChildren([withStyle([1])], cache)
      expect(listAgain).not.toBe(list)
    })

    it('reuses the rest of an array that starts with markers that moved', () => {
      const withMoving = (latitude: number) => [
        ...Array.from({ length: 20 }, (_, index) =>
          marker(`v${index}`, latitude)
        ),
        ...many(),
      ]
      const cache = createChildrenCache()
      const first = flattenChildren([withMoving(52.0), null], cache)
      const second = flattenChildren([withMoving(53.0), null], cache)

      expect(shape(second)).toEqual(
        shape(React.Children.toArray([withMoving(53.0), null]))
      )
      second.forEach((node, index) =>
        index < 20
          ? expect(node).not.toBe(first[index])
          : expect(node).toBe(first[index])
      )
    })

    it('flattens anew when most elements have other props', () => {
      const cache = createChildrenCache()
      const first = flattenChildren([many(52.0), null], cache)
      const moved = many(53.0)
      const second = flattenChildren([moved, null], cache)

      expect(shape(second)).toEqual(
        shape(React.Children.toArray([moved, null]))
      )
      second.forEach((node, index) => {
        expect(node).not.toBe(first[index])
        // `Children.toArray` keeps the props object; a clone of one would not.
        expect((node as React.ReactElement).props).toBe(moved[index]!.props)
      })
    })

    it('flattens anew when keys, order or length change', () => {
      const cache = createChildrenCache()
      flattenChildren([many(), null], cache)

      const renamed = many()
      renamed[3] = marker('other')
      const reordered = many().reverse()
      const shorter = many().slice(1)
      for (const children of [renamed, reordered, shorter, many()]) {
        expect(shape(flattenChildren([children, null], cache))).toEqual(
          shape(React.Children.toArray([children, null]))
        )
      }
    })

    it('flattens anew an array that also holds other children', () => {
      const cache = createChildrenCache()
      const withNull = () => [null, [marker('a'), marker('b')], marker('c')]
      const first = flattenChildren([withNull()], cache)
      const second = flattenChildren([withNull()], cache)

      expect(shape(second)).toEqual(shape(React.Children.toArray([withNull()])))
      expect(second[0]).not.toBe(first[0])

      // As many clones as children, but not one per child.
      const inner = [marker('a'), marker('b')]
      const shifted = (latitude: number) => [
        null,
        marker('x', latitude),
        inner,
        ...many().slice(2),
      ]
      flattenChildren([shifted(52.0)], cache)
      expect(shape(flattenChildren([shifted(53.0)], cache))).toEqual(
        shape(React.Children.toArray([shifted(53.0)]))
      )
    })

    it('never reuses an element given another prop', () => {
      const cache = createChildrenCache()
      const [first] = flattenChildren([amongMany(marker('a'))], cache)
      const [titled] = flattenChildren(
        [
          amongMany(
            React.createElement(Marker, {
              key: 'a',
              coordinate: { latitude: 52.0, longitude: 21.0 },
              title: 'Office',
            })
          ),
        ],
        cache
      )

      expect(titled).not.toBe(first)
      expect(
        (titled as React.ReactElement<{ title: string }>).props.title
      ).toBe('Office')
    })

    it('flattens a short array anew once anything in it changes', () => {
      const cache = createChildrenCache()
      const short = () => [marker('a'), marker('b')]
      const first = flattenChildren([short()], cache)
      const second = flattenChildren([short()], cache)

      expect(shape(second)).toEqual(shape(React.Children.toArray([short()])))
      expect(second[0]).not.toBe(first[0])
    })

    it('notices an element replaced in place in a kept array', () => {
      const cache = createChildrenCache()
      const kept = many()
      const first = flattenChildren([kept, null], cache)
      kept[5] = marker('m5', 53.0)
      const second = flattenChildren([kept, null], cache)

      expect(second[5]).not.toBe(first[5])
      expect(
        (second[5] as React.ReactElement<{ coordinate: { latitude: number } }>)
          .props.coordinate.latitude
      ).toBe(53.0)
    })
  })
})

describe('bboxToFitCoordinates', () => {
  it('returns the south-west corner, the centre and the north-east corner', () => {
    expect(bboxToFitCoordinates([16.9, 50.0, 21.1, 52.4])).toEqual([
      { latitude: 50.0, longitude: 16.9 },
      { latitude: 51.2, longitude: 19 },
      { latitude: 52.4, longitude: 21.1 },
    ])
  })

  it('keeps every step under 180° of longitude for a box wider than that', () => {
    const [southWest, centre, northEast] = bboxToFitCoordinates([
      -100, -10, 100, 10,
    ])

    expect(centre!.longitude - southWest!.longitude).toBe(100)
    expect(northEast!.longitude - centre!.longitude).toBe(100)
  })
})

describe('sortByKey', () => {
  it('orders items by key without changing the input', () => {
    const items = [{ key: 'b' }, { key: 'c' }, { key: 'a' }]

    expect(sortByKey(items, (item) => item.key)).toEqual([
      { key: 'a' },
      { key: 'b' },
      { key: 'c' },
    ])
    expect(items.map((item) => item.key)).toEqual(['b', 'c', 'a'])
  })

  it('orders rendered children by their React key', () => {
    const children = ['s2', 's0', 's1'].map((key) =>
      React.createElement('marker', { key })
    )

    expect(sortByKey(children, elementKey).map(elementKey)).toEqual([
      's0',
      's1',
      's2',
    ])
  })
})
