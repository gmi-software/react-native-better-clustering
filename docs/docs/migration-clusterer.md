---
id: migration-clusterer
title: Migrating from react-native-clusterer
sidebar_position: 3
---

# Migrating from react-native-clusterer

react-native-clusterer and this package both run supercluster in C++ over
Nitro, and their hooks take the same arguments. The difference is where the
work runs: react-native-clusterer builds its index on the JS thread, and its
`useClusterer` rebuilds it on every render. Here the index builds on a
background thread, once per change of the points. This page compares
react-native-clusterer 5.0.2.

## Imports

| react-native-clusterer | This package |
|------------------------|--------------|
| `useClusterer` | `useClusterer` from `react-native-better-clustering/hooks` |
| `Clusterer` | `Clusterer` from `react-native-better-clustering/clusterer` |
| `Supercluster` (default export) | `Supercluster` from `react-native-better-clustering/engine` |
| `isClusterFeature`, `coordsToGeoJSONFeature` | The same names, from `react-native-better-clustering/geojson` |

Both libraries need the New Architecture and `react-native-nitro-modules`. This
package also needs React Native 0.78+ and declares `react-native-maps` as a peer
dependency, though `/hooks`, `/engine` and `/geojson` don't import it. See
[Platform Setup](./setup/installation.md).

## Before and after

```diff
- import { isClusterFeature, useClusterer } from 'react-native-clusterer'
+ import { isClusterFeature } from 'react-native-better-clustering/geojson'
+ import { useClusterer } from 'react-native-better-clustering/hooks'
  import MapView, { Marker } from 'react-native-maps'

  const MAP_DIMENSIONS = { width: MAP_WIDTH, height: MAP_HEIGHT }
+ // react-native-clusterer's defaults; this package defaults to 1 and 20.
+ const OPTIONS = { minZoom: 0, maxZoom: 16 }

  function Map({ markers }) {
    const mapRef = useRef(null)
    const [region, setRegion] = useState(initialRegion)
-   const [points] = useClusterer(markers, MAP_DIMENSIONS, region)
+   const [points] = useClusterer(markers, MAP_DIMENSIONS, region, OPTIONS)

    return (
      <MapView
        ref={mapRef}
        initialRegion={initialRegion}
        onRegionChangeComplete={setRegion}
        style={MAP_DIMENSIONS}
      >
        {points.map((point) => (
          <Marker
            key={
              isClusterFeature(point)
                ? `cluster-${point.properties.cluster_id}`
                : `point-${point.properties.id}`
            }
            coordinate={{
              latitude: point.geometry.coordinates[1],
              longitude: point.geometry.coordinates[0],
            }}
            onPress={() =>
              isClusterFeature(point) &&
              mapRef.current?.animateToRegion(point.properties.getExpansionRegion())
            }
          />
        ))}
      </MapView>
    )
  }
```

`markers` is the same array of GeoJSON point features as before. Keep it in
`useMemo` or state: a new array with the same coordinates no longer rebuilds
the index, but the hook still compares every point with the previous array.

`Clusterer` takes the same props (`data`, `region`, `mapDimensions`,
`options`, `renderItem`), plus `onError`.

## Which clusters you get

With the same options, the two libraries choose the same zoom for a region and
query the same area. In the
[hook benchmark](./performance.md#the-hook-benchmark) they returned the same
number of features at every step, at 10,000 to 100,000 points.

- **Zoom range.** `minZoom` is `1` and `maxZoom` is `20` here, where
  react-native-clusterer uses supercluster's `0` and `16`. Pass both, as above,
  to keep your clusters.
- **Zoom selection.** `useClusterer` and `Supercluster` pick the zoom for a
  region the way react-native-clusterer does: with `geo-viewport`'s method and
  a tile size equal to `extent` (`512`). `viewportTileSize` changes the tile
  size; see [Zoom selection](./compatibility.md#zoom-selection).
- **`radius`** is used as given. react-native-clusterer truncates it to an
  integer, so a fractional `radius` clusters slightly differently.
- **Above `maxZoom`**, both return every point on its own (see
  [Above `maxZoom`](./api/engine.md#above-maxzoom)).
- **`generateId`** is not an option here; supercluster only uses it for
  `getTile`.

## Aggregating properties

react-native-clusterer supports neither supercluster's `map` and `reduce` nor
another way to aggregate: its options parser reads only `radius`, `minZoom`,
`maxZoom`, `extent`, `minPoints` and `generateId`. Here, `clusterProperties`
sums, or takes the minimum or maximum of, numeric point properties into each
cluster, in C++ while the index builds:

```tsx
const [points] = useClusterer(markers, MAP_DIMENSIONS, region, {
  clusterProperties: [
    { source: 'price', key: 'totalPrice', reduce: 'sum' },
    { source: 'rating', key: 'bestRating', reduce: 'max' },
  ],
})
// A cluster's properties.totalPrice and properties.bestRating
```

`source` can be a dot path (`details.price`); `key` defaults to its last
segment. See [`SuperclusterOptions`](./api/types.md#superclusteroptions).

## What runs on which thread

| Step | react-native-clusterer 5.0.2 | This package |
|------|------------------------------|--------------|
| Reading the points | JS thread: native code reads each feature's coordinates through JSI | JS thread: the points are checked and packed into one buffer, copied to native in one call |
| Building the index | JS thread, in the same synchronous call | A background thread |
| When it rebuilds | On every render of the component that calls the hook, and again when `data` or an option changes | Only when the points' coordinates, their order or a `clusterProperties` value changes, or an option changes |
| Clusters for a region | JS thread, a synchronous native call, in an effect after the render | JS thread, a synchronous native call, during the render |
| Clusters on the first render | Yes: the index is built during that render | No: `[]` until the first build has loaded |
| Freeing the index | When the garbage collector finalizes it | `destroy()`, which the hook calls on unmount and after replacing an index |

The rebuild on every render comes from how `useClusterer` creates its index in
react-native-clusterer 5.0.2:

```ts
const [supercluster, setSupercluster] = useState(
  new SuperclusterClass(options).load(data)
)
```

`useState` keeps only the first value, but the argument is evaluated on every
render: each render builds a full index and throws it away. A pan builds two,
since the region change renders once and the new clusters render again. The
index for a new `data` array is built in an effect, so it blocks the JS
thread too.

The other side: react-native-clusterer has clusters on the first render, and
here the hook returns `[]` until the first build loads, then keeps the previous
clusters while a new build runs. Show a placeholder if a blank first frame
matters, and use `supercluster.isLoaded` before calling query methods yourself.

## Measurements

From the [hook benchmark](./performance.md#the-hook-benchmark): both hooks with
react-native-clusterer's default options, the same points and no map, in a
Release build on the iOS Simulator, medians of 3 runs.

| | Library | 10,000 points | 50,000 | 100,000 |
|---|---|---|---|---|
| JS thread blocked by one index build | react-native-clusterer 5.0.2 | 19 ms | 104 ms | 234 ms |
| | **This package** | **1.2 ms** | **5 ms** | **11 ms** |
| Mount to first clusters | react-native-clusterer 5.0.2 | 40 ms | 221 ms | 502 ms |
| | **This package** | **15 ms** | **64 ms** | **165 ms** |
| Each pan | react-native-clusterer 5.0.2 | 43 ms | 216 ms | 455 ms |
| | **This package** | **0.7 ms** | **0.8 ms** | **0.7 ms** |
| Each data change, until the new index | react-native-clusterer 5.0.2 | 63 ms | 321 ms | 674 ms |
| | **This package** | **14 ms** | **59 ms** | **152 ms** |
| Index builds over 10 re-renders and 10 pans | react-native-clusterer 5.0.2 | 30 | 30 | 30 |
| | **This package** | **0** | **0** | **0** |

A simulator runs on the Mac's CPU, faster than a phone: compare the libraries,
not the absolute times.

## Other differences

- **Point features.** Queries return your input feature objects for points.
  react-native-clusterer creates new ones on every query, with your
  `properties` object inside.
- **`getExpansionRegion()`** fits every point of the cluster, from its bounds,
  with the same 1.5× margin. react-native-clusterer fits the cluster's
  children at the first zoom where it splits.
- **`getTile`** has no equivalent.
- **Errors.** A failed build is thrown during render, or passed to `onError`
  (see [Hooks](./api/hooks.md)).
- **More methods.** `Supercluster` adds `loadAsync`, `getClusterBounds`,
  `getAllLeaves` and `destroy` (see [Headless engine](./api/engine.md)).
