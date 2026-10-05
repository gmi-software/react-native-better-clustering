---
id: compatibility
title: Compatibility
sidebar_position: 4
---

# Compatibility

| Requirement | Supported |
|-------------|-----------|
| React Native | 0.78+ (New Architecture required) |
| Map rendering | `react-native-maps` |
| Expo | Development build (not Expo Go) |
| `react-native-nitro-modules` | Required peer dependency |
| `react-native-maps` | Required peer dependency |

## Peer dependencies

| Package | Required |
|---------|----------|
| `react-native-nitro-modules` | Yes |
| `react-native-maps` | Yes (for the main `MapView` export) |

## Migrate from react-native-map-clustering

The main export **is** the clustered `MapView`.
`react-native-better-clustering/compat` is a backwards-compatible alias.

```diff
- import MapView from 'react-native-map-clustering'
+ import MapView from 'react-native-better-clustering'
```

Supported props include `radius`, `minPoints`, `minZoom`, `maxZoom`, `extent`,
`nodeSize`, `clusteringEnabled`, `onClusterPress`, `clusterColor`,
`clusterTextColor`, `spiralEnabled`, `renderCluster`, and standard
`react-native-maps` `MapView` props.

### Known fixes over react-native-map-clustering

| Issue | Status |
|-------|--------|
| Crash on `NaN` zoom ([#294](https://github.com/tomekvenits/react-native-map-clustering/issues/294)) | Guarded |
| `Map size can't be 0` on Android ([#285](https://github.com/tomekvenits/react-native-map-clustering/issues/285)) | Layout-aware |
| `maxZoom` / `spiralEnabled` ignored ([#274](https://github.com/tomekvenits/react-native-map-clustering/issues/274), [#275](https://github.com/tomekvenits/react-native-map-clustering/issues/275)) | Implemented |
| Unstable clusters on zoom ([#255](https://github.com/tomekvenits/react-native-map-clustering/issues/255)) | Stable references |
| Per-marker `cluster={false}` ([#297](https://github.com/tomekvenits/react-native-map-clustering/issues/297)) | Supported |

## Migrate from react-native-clusterer

For custom map stacks, use advanced subpaths:

| react-native-clusterer | This package |
|------------------------|--------------|
| `useClusterer` | `/hooks` |
| `Supercluster` | `/engine` |
| `isClusterFeature` | `/geojson` |

**Extra:** `clusterProperties` map/reduce aggregation via `/engine`.

## supercluster parity

The C++ engine reproduces [supercluster](https://github.com/mapbox/supercluster)
feature-for-feature: with the same points, `radius`, `extent`, `minPoints` and
zoom range, `getClusters` returns the same clusters. This is pinned by a
checked-in fixture in `package/cpp/ClusterEngineCore.test.cpp`, generated from
supercluster itself and verified in CI.

Two deliberate differences remain, neither of which changes cluster membership
in practice:

- **Precision.** supercluster stores projected coordinates as `Float32`; the C++
  engine keeps them as `double`. Cluster centroids are therefore slightly more
  accurate here, and a point sitting exactly on the radius boundary can fall on
  the other side of it.
- **Tie-breaking with `minPoints` above 2.** Clustering is a greedy single pass,
  so the order in which equidistant neighbours are visited can decide which of
  two overlapping groups wins. The engine and supercluster walk their KD-trees in
  different orders. With the default `minPoints: 2` this is unobservable.

### Zoom selection

Clustering parity also depends on which zoom a map region is queried at, and the
two upstreams disagree by a whole zoom level. `viewportTileSize` selects which
one you get:

| Entry point | `viewportTileSize` | Matches |
|-------------|--------------------|---------|
| `MapView` (main export) | `256` | react-native-map-clustering |
| `useClusterer`, `Supercluster` | `extent` (`512`) | react-native-clusterer |

Pass `viewportTileSize` explicitly to override either default. See
[`SuperclusterOptions`](./api/types.md#viewport-tile-size).

> Earlier releases normalised the cluster radius incorrectly, clustering at
> roughly half the requested `radius` on the default `extent: 512`, and queried
> `MapView` one zoom level below react-native-map-clustering. The two errors
> largely cancelled at the shipped defaults, so `MapView` looked about right
> while `useClusterer` did not. Both are fixed. If you tuned `radius` against
> the old `/engine` or `/hooks` behaviour, halve it to keep the previous look.
