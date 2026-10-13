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

## Peer dependencies

| Package | Version | Required |
|---------|---------|----------|
| `react-native-maps` | `>=1.20.1` | Yes |
| `react-native-nitro-modules` | `>=0.32.0` | Yes (declared optional, see below) |
| `react-native-reanimated` | `^4.1.0` | No: only fades the default cluster bubbles |

- **`react-native-maps`**: 1.20.1 is the version Expo SDK 54 installs. It runs
  on the New Architecture through React Native's interop layer; 1.21.0 is the
  first release with native Fabric components.
- **`react-native-nitro-modules`**: the generated bindings need 0.32.0 or newer
  and fail to compile against older versions. The package declares it as an
  optional `*` peer, as Nitro recommends for libraries, so the app chooses the
  Nitro version and a pre-release Nitro never gets a second, stable copy
  installed next to it. Install it yourself.
- **`react-native-reanimated`**: when it is missing, cluster bubbles render
  without the fade. `react-native-worklets` is Reanimated's own dependency, not
  this library's; install the version your Reanimated asks for.

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

Spiderfy keeps react-native-map-clustering's camera zoom 19 threshold
(`spiderfyMinZoom`), but only spreads clusters that zooming can't split, caps
them at `spiderfyMaxLeaves`, and also spreads them in place when pressed. See
[Markers at the same location](./api/mapview.md#markers-at-the-same-location).

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
zoom range, `getClusters` returns the same clusters with the same members, and
`getClusterExpansionZoom` returns the same zoom for each of them. A checked-in
fixture in `package/cpp/ClusterEngineCore.test.cpp`, generated from
supercluster 8.0.1 and verified in CI, pins this for six seeded cases of
3,000–8,000 points (`extent` 256, 512 and 1024, `minPoints: 2`): at every zoom
from `minZoom` to `maxZoom + 1`, where every point stands on its own, the engine
must return the same number of features and of clusters, group the same points
into each cluster, and give each cluster the same expansion zoom. A
second table pins viewport queries around the antimeridian, with the bbox
written unwrapped, wrapped, far outside ±180° and 360° or wider.

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

`useClusterer` and `Supercluster` accept a `viewportTileSize` option to override
their default; pass `256` to query the same zoom as `MapView`. `MapView` has no
such prop and always uses `256`, as react-native-map-clustering does. See
[`SuperclusterOptions`](./api/types.md#viewport-tile-size).

> Earlier releases normalised the cluster radius incorrectly, clustering at
> roughly half the requested `radius` on the default `extent: 512`, and queried
> `MapView` one zoom level below react-native-map-clustering. The two errors
> largely cancelled at the shipped defaults, so `MapView` looked about right
> while `useClusterer` did not. Both are fixed. If you tuned `radius` against
> the old `/engine` or `/hooks` behaviour, multiply it by `256 / extent` to keep
> the previous clustering: halve it at the default `extent: 512`, keep it at
> `256`, quarter it at `1024`.

> Earlier releases also clamped every query to `maxZoom`, so `/engine` and
> `/hooks` never returned unclustered points: points closer than the cluster
> radius at `maxZoom` stayed clustered however far the map zoomed in. As in
> supercluster and react-native-clusterer, a query above `maxZoom` now returns
> every point on its own (see [Above `maxZoom`](./api/engine.md#above-maxzoom)).
> `MapView` is unchanged: it stops at `maxZoom` and spiderfies those clusters.
