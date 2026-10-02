---
id: hooks
title: Hooks
sidebar_position: 3
---

# Hooks (advanced)

Use these when you render your own `react-native-maps` `MapView` and only need
cluster computation — not the bundled clustered `MapView`.

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
| `options` | `UseClustererOptions` | `radius`, `minZoom`, `maxZoom`, `minPoints`, `extent`, `nodeSize`, `clusterProperties`, `onError` |

Cluster features include `properties.getExpansionRegion()` for zoom-on-tap.

The hook destroys the underlying `Supercluster` engine on unmount. Index
building runs asynchronously via `loadAsync()` so large datasets (10k+ points)
do not block the JS thread. Clusters stay empty until the first build has
loaded; check `supercluster.isLoaded` before calling query methods directly.

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

If a build fails — most often because the native module is missing from the
app binary — the hook throws the error during render, so the nearest error
boundary (and LogBox in development) shows it. Pass `onError` to handle it
yourself instead: the hook then keeps returning the clusters from the last
successful build (`[]` before the first). Builds superseded by newer data or
interrupted by unmount are never reported.

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
```

For most apps, the main [`MapView`](./mapview.md) handles this automatically.

Prefer [`Clusterer`](./clusterer.md) when you want a declarative `renderItem` API
instead of calling the hook directly.
