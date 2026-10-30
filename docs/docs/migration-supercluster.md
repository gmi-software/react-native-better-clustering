---
id: migration-supercluster
title: Migrating from use-supercluster
sidebar_position: 3
---

# Migrating from use-supercluster

[use-supercluster](https://github.com/leighhalliday/use-supercluster) wraps
[supercluster](https://github.com/mapbox/supercluster) in a hook: you pass the
points, a bbox and a zoom, and it builds the index in JavaScript, on the JS
thread. This page is for screens that use it with `react-native-maps`, and
compares use-supercluster 1.2.0 with supercluster 8.0.1.

## Pick an entry point

- **You only need clustered `<Marker>`s on a `react-native-maps` map.** Use
  the main [`MapView`](./api/mapview.md) instead of `react-native-maps`'
  `MapView`: pass a `<Marker>` per point as children and delete the hook, the
  bbox and zoom code, and the cluster markers. It draws a default bubble, or yours with
  `renderCluster`, zooms into a cluster on press and spreads out markers that
  share a location. This is the least code, and what most screens need.
- **You render features yourself**, need the GeoJSON features (for a list, or
  aggregated cluster properties), or use another map component: use
  [`useClusterer`](./api/hooks.md). The rest of this page is about it.

With `MapView`:

```tsx
import MapView from 'react-native-better-clustering'
import { Marker } from 'react-native-maps'

function Map({ places }) {
  return (
    <MapView initialRegion={initialRegion} style={StyleSheet.absoluteFill}>
      {places.map((place) => (
        <Marker
          key={place.id}
          coordinate={{ latitude: place.latitude, longitude: place.longitude }}
        />
      ))}
    </MapView>
  )
}
```

## Arguments

| use-supercluster | `useClusterer` |
|------------------|----------------|
| `points` | `data`, the first argument: the same GeoJSON point features |
| `bounds` and `zoom` | `region` and `mapDimensions`: the map's region and its size in points. The hook computes the bbox and the zoom (see [below](#zoom-and-bbox)) |
| `options` | `options`, the fourth argument. `radius`, `minZoom`, `maxZoom`, `minPoints`, `extent` and `nodeSize` mean the same, but `minZoom` defaults to `1` and `maxZoom` to `20` here, where supercluster uses `0` and `16`: pass both to keep yours. `map` and `reduce` become [`clusterProperties`](#map-and-reduce); `log` and `generateId` are not supported |
| `disableRefresh` | No equivalent. Keep passing the previous `data` to cluster the previous points in each new region, or the previous `data`, `region` and `mapDimensions` to keep the previous clusters |
| Returns `{ clusters, supercluster }` | Returns `[clusters, supercluster]` |
| `supercluster` is `undefined` until the first effect has run | `supercluster` is always an instance; check `supercluster.isLoaded` before querying it |

Cluster features have the same `cluster`, `cluster_id`, `point_count` and
`point_count_abbreviated` properties, plus `getExpansionRegion()`, a region to
animate the map to. `getClusterExpansionZoom`, `getChildren` and `getLeaves`
carry over; `getTile` has no equivalent.

## Before and after

```diff
- import useSupercluster from 'use-supercluster'
+ import { useClusterer } from 'react-native-better-clustering/hooks'

  function Map({ points }) {
    const [region, setRegion] = useState(initialRegion)
-   const bounds = [
-     region.longitude - region.longitudeDelta / 2,
-     region.latitude - region.latitudeDelta / 2,
-     region.longitude + region.longitudeDelta / 2,
-     region.latitude + region.latitudeDelta / 2,
-   ]
-   const zoom = Math.log2(360 / region.longitudeDelta)
-   const { clusters } = useSupercluster({
-     points,
-     bounds,
-     zoom,
-     options: { radius: 40, maxZoom: 16 },
-   })
+   const [size, setSize] = useState({ width: 0, height: 0 })
+   const [clusters] = useClusterer(points, size, region, OPTIONS)

    return (
      <MapView
        initialRegion={initialRegion}
+       onLayout={(event) => setSize(event.nativeEvent.layout)}
        onRegionChangeComplete={setRegion}
        style={StyleSheet.absoluteFill}
      >
        {clusters.map((feature) => (
          <MapFeature key={featureKey(feature)} feature={feature} />
        ))}
      </MapView>
    )
  }

+ // Module scope or useMemo, so a render never passes a new object.
+ const OPTIONS = { radius: 40, minZoom: 0, maxZoom: 16, viewportTileSize: 128 }
```

Keep `points` in `useMemo` or state. A new array with the same coordinates
keeps the index, but the hook still compares every point with the previous
array. When only other properties change, a point on screen keeps its previous
feature object, old properties included, until the region changes, where
use-supercluster rebuilds and returns new objects. Read a property that
changes from `points` by a stable `id`.

## Zoom and bbox

use-supercluster clusters at the zoom you pass, rounded, inside the bbox you
pass. `useClusterer` computes both from `region` and `mapDimensions`, the way
react-native-clusterer does:

- **The bbox** is twice the region's width and height, so it includes points
  just off screen.
- **The zoom** is the highest whole zoom at which that bbox fits the map,
  counting tiles of `viewportTileSize` points (default: `extent`, `512`).

With the default, that zoom is usually two levels below
`Math.log2(360 / longitudeDelta)`, the zoom of the example above, so `radius`
reaches about four times as far on the map, and each cluster covers about 16
times the area it did. `viewportTileSize: 128`, as above, brings it to within
one level of it on a phone in portrait.
Compare the two on your map and adjust `radius` if needed. See
[Viewport tile size](./api/types.md#viewport-tile-size).

## `map` and `reduce`

supercluster's `map` and `reduce` run JavaScript for every point and cluster.
`clusterProperties` covers the common case, a sum, minimum or maximum of a
numeric property, and runs in C++ while the index builds:

```diff
  const options = {
    radius: 40,
-   map: (props) => ({ cost: props.cost, severity: props.severity }),
-   reduce: (acc, props) => {
-     acc.cost += props.cost
-     acc.severity = Math.max(acc.severity, props.severity)
-   },
+   clusterProperties: [
+     { source: 'cost', reduce: 'sum' },
+     { source: 'severity', reduce: 'max' },
+   ],
  }
  // A cluster's properties.cost and properties.severity, as before
```

Anything else, such as a count per category, has no equivalent: aggregate the
cluster's points yourself with `supercluster.getLeaves(clusterId, Infinity)`,
for the clusters you render. See
[`SuperclusterOptions`](./api/types.md#superclusteroptions).

## What runs on which thread

| Step | use-supercluster 1.2.0 + supercluster 8.0.1 | `useClusterer` |
|------|---------------------------------------------|----------------|
| Comparing the inputs | Every render: `points`, `bounds`, `zoom` and `options` are deep-compared with the previous render's; a new `points` array is compared feature by feature, properties included | Every render: `data` is compared with the previous array by identity, then point by point when it is a new array |
| Building the index | JS thread, in an effect | A background thread |
| When it rebuilds | When `points` or `options` change, and also on every change of `bounds` or `zoom` unless `options` spells out every supercluster option (see below) | Only when the points' coordinates, their order or a `clusterProperties` value changes, or an option changes |
| Clusters for the region | JS thread, in an effect, then one more render | JS thread, a synchronous native call, during the render |
| Clusters on the first render | `[]`; after the first effect | `[]`; after the first build has loaded |

The rebuild on every pan: before reusing its index, use-supercluster 1.2.0
deep-compares your `options` with `supercluster.options`. supercluster 8 keeps
its defaults on that object's prototype, so the comparison finds keys your
`options` lacks and fails, and the hook builds a new index for each new bbox or
zoom. Rendered in a test with supercluster 8.0.1 and the options of
use-supercluster's README, `{ radius: 75, maxZoom: 20 }`, a mount and four pans
built five indexes. Passing every supercluster option (`minZoom`, `maxZoom`,
`minPoints`, `radius`, `extent`, `nodeSize`, `log`, `generateId`, `reduce` and
`map`) avoids it: the same mount and pans then built one.

## Measurements

From the [hook benchmark](./performance.md#the-hook-benchmark): both hooks
with the same points and options and no map, in a Release build on the iOS
Simulator, medians of 3 runs. use-supercluster gets the region's bbox and
`Math.log2(360 / longitudeDelta)` as its zoom.

| | Library | 10,000 points | 50,000 | 100,000 |
|---|---|---|---|---|
| JS thread blocked by one index build | use-supercluster 1.2.0 | 229 ms | 1,126 ms | 2,340 ms |
| | **`useClusterer`** | **1.2 ms** | **5 ms** | **11 ms** |
| Mount to first clusters | use-supercluster 1.2.0 | 229 ms | 1,143 ms | 2,330 ms |
| | **`useClusterer`** | **15 ms** | **64 ms** | **165 ms** |
| Each pan | use-supercluster 1.2.0 | 223 ms | 1,205 ms | 2,380 ms |
| | **`useClusterer`** | **0.7 ms** | **0.8 ms** | **0.7 ms** |
| Each data change, until the new index | use-supercluster 1.2.0 | 226 ms | 1,202 ms | 2,338 ms |
| | **`useClusterer`** | **14 ms** | **59 ms** | **152 ms** |

A re-render with the same props costs both hooks under a millisecond. While a
new index builds, `useClusterer` keeps returning the previous clusters. A
simulator runs on the Mac's CPU, faster than a phone: compare the libraries,
not the absolute times.
