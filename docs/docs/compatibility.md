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
| `react-native-reanimated` | `^4.1.0` | No: only animates the default cluster bubbles |

- **`react-native-maps`**: 1.20.1 is the version Expo SDK 54 installs. It runs
  on the New Architecture through React Native's interop layer; 1.21.0 is the
  first release with native Fabric components.
- **`react-native-nitro-modules`**: the generated bindings need 0.32.0 or newer
  and fail to compile against older versions. The package declares it as an
  optional `*` peer, as Nitro recommends for libraries, so the app chooses the
  Nitro version and a pre-release Nitro never gets a second, stable copy
  installed next to it. Install it yourself.
- **`react-native-reanimated`**: when it is missing, cluster bubbles render
  without the fade or glide. `react-native-worklets` is Reanimated's own dependency, not
  this library's; install the version your Reanimated asks for.

## Migrate from react-native-map-clustering

Change one import; the props and `<Marker>` children carry over. See
[Migrating from react-native-map-clustering](./migration.md) for the
differences, and for `onRegionChangeComplete` when you come from 3.x.

## Migrate from react-native-clusterer

`useClusterer`, `Clusterer` and `Supercluster` take the same arguments, from
the `/hooks`, `/clusterer` and `/engine` subpaths. Pass `minZoom: 0` and
`maxZoom: 16` to keep react-native-clusterer's zoom range. See
[Migrating from react-native-clusterer](./migration-clusterer.md) for the
differences and what runs on which thread.

## Migrate from use-supercluster

Render your markers as children of the main `MapView`, or pass your points,
region and map size to `useClusterer`. See
[Migrating from use-supercluster](./migration-supercluster.md).

## supercluster parity

The C++ engine reproduces [supercluster](https://github.com/mapbox/supercluster)'s
algorithm feature-for-feature. Checked-in fixtures in
`package/cpp/ClusterEngineCore.test.cpp`, generated from supercluster 8.0.1
and verified in CI, pin it:

- **Six seeded cases** of 3,000–8,000 points spread over the world (`extent`
  256, 512 and 1024, `minPoints: 2`): at every zoom from `minZoom` to
  `maxZoom + 1`, where every point stands on its own, the engine must return
  the same number of features and of clusters, group the same points into
  each cluster, and give each cluster the same expansion zoom.
- **The six benchmark datasets** (uniform, a city, blobs, identical points, a
  grid and points across the antimeridian, 5,000 points each) at every zoom
  from 1 to 21, with and without `clusterProperties`: the same checks, plus
  each cluster's centroid and its `sum`, `min` and `max` aggregates.
- **Viewport queries around the antimeridian**, with the bbox written
  unwrapped, wrapped, far outside ±180° and 360° or wider.

Two deliberate differences remain:

- **Precision.** supercluster rounds projected coordinates to `Float32` and
  keeps its KD-trees in a `Float32Array`; the C++ engine keeps them as
  `double`. Centroids are therefore slightly more accurate here (supercluster's
  can be off by up to about 2e-5° of longitude), and on dense data a point near
  the edge of the radius can fall on the other side of it, which changes which
  points share a cluster. On the benchmark's city dataset (5,000 points within
  about 50 km) that happens at 10 of 21 zooms: 64 to 131 points end up in
  another cluster at zooms 7 to 10, where clusters are largest, and 1 to 11
  from zoom 11 up. The sparser datasets differ for one point at one zoom, or
  not at all. The fixtures compare against
  supercluster with that rounding taken out, which the engine matches exactly,
  and list the zooms where stock supercluster differs.
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
