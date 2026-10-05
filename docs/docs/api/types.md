---
id: types
title: Types
sidebar_position: 4
---

# Types

## Main export

```tsx
import type {
  ClusteredMapViewProps,
  RenderClusterProps,
} from 'react-native-better-clustering'
```

`ClusteredMapViewProps` extends `react-native-maps` `MapViewProps` with clustering
options (`radius`, `minPoints`, `onClusterPress`, `renderCluster`, etc.).

`RenderClusterProps` is passed to `renderCluster` — a `ClusterFeature` plus
`onPress`, `clusterColor`, `clusterTextColor`, and `tracksViewChanges`.

## GeoJSON types (`/geojson`)

```tsx
import type {
  PointFeature,
  ClusterFeature,
  PointOrClusterFeature,
  BBox,
} from 'react-native-better-clustering/geojson'
```

Cluster properties include `cluster`, `cluster_id`, `point_count`,
`point_count_abbreviated`, and `getExpansionRegion()`.

## Engine types (`/engine`)

```tsx
import type {
  SuperclusterOptions,
  ClusterPropertyConfig,
  MapDimensions,
} from 'react-native-better-clustering/engine'
```

### `SuperclusterOptions`

| Option | Default | Description |
|--------|---------|-------------|
| `radius` | `40` | Cluster radius in pixels |
| `minZoom` | `1` | Min zoom for clustering |
| `maxZoom` | `20` | Max zoom for clustering |
| `minPoints` | `2` | Min points to form a cluster |
| `extent` | `512` | Tile extent used for projection math (see [note](#radius-and-extent)) |
| `nodeSize` | `64` | KD-tree leaf size |
| `clusterProperties` | `[]` | Map/reduce aggregation configs |
| `viewportTileSize` | `extent` | Tile size used to pick a zoom from a map region (see [note](#viewport-tile-size)) |

#### Radius and extent

`radius` and `extent` mean exactly what they mean in
[supercluster](https://github.com/mapbox/supercluster): `radius` is the cluster
radius in pixels of a tile that is `extent` pixels wide, so the two are read
together as `radius / extent`. Raising `extent` therefore tightens clustering
and lowering it loosens clustering, at the same `radius`.

Given the same options and zoom, this package produces the same clusters as
supercluster.

#### Viewport tile size

`viewportTileSize` is separate from `extent`. It only affects
`getClustersFromRegion` — how a map region plus a pixel size is turned into a
zoom level — and shifts the result by a whole zoom level:

| Value | Parity with |
|-------|-------------|
| `256` | react-native-map-clustering (`geo-viewport`'s default). Correct for map dimensions in logical points, which is what `onLayout` reports. |
| `512` (`= extent`, the default) | react-native-clusterer, which passes its `extent` to `geo-viewport`. One zoom level lower. |

The `MapView` compat layer sets `256` so a drop-in swap renders the same
clusters. `useClusterer` and `Supercluster` default to `extent`, keeping
react-native-clusterer parity; pass `viewportTileSize: 256` to opt in.

## Headless engine (`ClusterEngine`)

Low-level Nitro hybrid object — create via [`createClusterEngine()`](./engine.md)
from `/engine`. See the [headless engine guide](./engine.md) for lifecycle,
`isBuilt` checks, and error behavior.

```tsx
import {
  createClusterEngine,
  type ClusterEngine,
  type ClusterEngineOptions,
  type EngineClusterNode,
  type Viewport,
} from 'react-native-better-clustering/engine'
```

Each `EngineClusterNode` has `minLeafId`: the smallest point id among its leaves
(its own `id` for a point). A cluster keeps it across zoom levels while it only
gains or loses other leaves, so it can key the cluster's marker.

**Lifecycle:** `setOptions` → `setPoints` (`packPoints()` buffer) → `build()` → query.
Query methods throw when `isBuilt` is `false`; `setPoints` throws on invalid buffers.
