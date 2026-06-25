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
| `options` | `SuperclusterOptions` | `radius`, `minZoom`, `maxZoom`, `minPoints`, `extent`, `nodeSize`, `clusterProperties` |

Cluster features include `properties.getExpansionRegion()` for zoom-on-tap.

The hook destroys the underlying `Supercluster` engine on unmount. Index
building runs asynchronously via `loadAsync()` so large datasets (10k+ points)
do not block the JS thread. Clusters stay empty until loading finishes; check
`supercluster.isLoaded` before calling query methods directly.

> **Memoize `data`:** build GeoJSON features with `coordsToGeoJSONFeature` inside
> `useMemo`. Inline arrays rebuild the full C++ index on every render.

## `stabilizeClusterFeatures`

Helper to keep cluster identity stable across region updates, reducing flicker
when rendering markers yourself:

```tsx
import { stabilizeClusterFeatures } from 'react-native-better-clustering/hooks'
```

For most apps, the main [`MapView`](./mapview.md) handles this automatically.

Prefer [`Clusterer`](./clusterer.md) when you want a declarative `renderItem` API
instead of calling the hook directly.
