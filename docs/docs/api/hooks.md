---
id: hooks
title: Hooks
sidebar_position: 3
---

# Hooks (advanced)

Use these when you render your own `react-native-maps` `MapView` and only need
cluster computation, not the bundled clustered `MapView`.

Import from `/hooks`:

```tsx
import { useClusterer } from 'react-native-better-clustering/hooks'
```

## `useClusterer(data, mapDimensions, region, options?)`

Computes clusters for the current viewport using the C++ engine.

**Returns:** `[features, supercluster]` where `features` is an array of GeoJSON
point or cluster features to render as markers.

```tsx
const [clusters, supercluster] = useClusterer(
  geoJsonPoints,
  { width: mapWidth, height: mapHeight },
  region,
  { radius: 40, minPoints: 2, maxZoom: 20 }
)
```

| Argument | Type | Description |
|----------|------|-------------|
| `data` | `PointFeature[]` | GeoJSON points (memoize with `useMemo`) |
| `mapDimensions` | `{ width, height }` | Map view size in pixels |
| `region` | `MapRegion` | Current map region |
| `options` | `UseClustererOptions` | `radius`, `minZoom`, `maxZoom`, `minPoints`, `extent`, `nodeSize`, `clusterProperties`, `viewportTileSize`, `onError` |

Cluster features include `properties.getExpansionRegion()` for zoom-on-tap.

Zoomed in past `maxZoom`, the hook returns every point on its own, as
react-native-clusterer does (see [Above `maxZoom`](./engine.md#above-maxzoom)):
markers at the same coordinate then sit on top of each other. The bundled
`MapView` keeps them clustered and spreads them out instead.

The hook destroys the underlying `Supercluster` engine on unmount, which frees
its native index right away instead of at the next garbage collection. The
index builds on a background thread via `loadAsync()`; comparing the points
with the previous ones and packing them for the engine still run on the JS
thread (see [Performance model](../performance.md)). Clusters stay empty until
the first build has loaded; check `supercluster.isLoaded` before calling query
methods directly.

The index is rebuilt only when the points' coordinates, their order, or a
`clusterProperties` source value changes:

- A new `data` array with the same content keeps the index and the returned
  `features` array. Leaf queries (`getLeaves`, `getChildren`) return the newest
  feature objects, so changed properties show up there without a rebuild.
  Point features already in `features` keep their identity until the region
  changes.
- When the content does change, the hook keeps returning the previous clusters
  while the new index builds, then swaps to the new engine and destroys the old
  one. A `supercluster` reference you hold goes stale after that swap; use the
  one the hook returns.
- One build runs at a time, and every build rebuilds the whole index. When
  `data` changes again during a build, the hook swaps to that build once it
  loads and then builds the newest `data`, skipping the arrays in between. Data
  that changes faster than a build loads, such as a live feed of moving
  markers, therefore updates the clusters once per build.

If a build fails (most often because the native module is missing from the
app binary, or because an option is outside its
[valid values](./types.md#valid-values)), the hook throws the error during render, so the nearest error
boundary (and LogBox in development) shows it. Pass `onError` to handle it
yourself instead: the hook then keeps returning the clusters from the last
successful build (`[]` before the first). A build that fails after newer data
has arrived, or after unmount, is never reported.

```tsx
const [clusters] = useClusterer(geoJsonPoints, dimensions, region, {
  radius: 40,
  onError: (error) => reportToCrashlytics(error),
})
```

> **Memoize `data`:** build GeoJSON features with `coordsToGeoJSONFeature` inside
> `useMemo`. Inline arrays no longer rebuild the C++ index, but each render
> still compares every point against the previous array.

## `stabilizeClusterFeatures`

Helper to keep cluster identity stable across region updates, reducing flicker
when rendering markers yourself:

```tsx
import { stabilizeClusterFeatures } from 'react-native-better-clustering/hooks'

const stable = stabilizeClusterFeatures(previous, next)
```

It matches a point across snapshots by its `id` (on `properties` or the
feature) and its coordinates, so give an `id` to points that can share a
coordinate: without one, two such points match the same prior feature. To
match on a key of your own, pass it as the third argument. It must be unique
within each array, and a feature whose key matches gets the previous object
back, so include whatever must refresh it, such as its coordinates:

```tsx
import { isClusterFeature } from 'react-native-better-clustering/geojson'

stabilizeClusterFeatures(previous, next, (feature) => {
  const [longitude, latitude] = feature.geometry.coordinates
  return isClusterFeature(feature)
    ? `c:${feature.properties.cluster_id}:${feature.properties.point_count}:${latitude}:${longitude}`
    : `p:${feature.properties.uuid}:${latitude}:${longitude}`
})
```

`useClusterer` and `MapView` already tell co-located points apart, with or
without an `id`.

For most apps, the main [`MapView`](./mapview.md) handles this automatically.

Prefer [`Clusterer`](./clusterer.md) when you want a declarative `renderItem` API
instead of calling the hook directly.
