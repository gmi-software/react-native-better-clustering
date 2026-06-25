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
| `extent` | `512` | Tile extent |
| `nodeSize` | `64` | KD-tree leaf size |
| `clusterProperties` | `[]` | Map/reduce aggregation configs |

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

**Lifecycle:** `setOptions` → `setPoints` (`packPoints()` buffer) → `build()` → query.
Query methods throw when `isBuilt` is `false`; `setPoints` throws on invalid buffers.
