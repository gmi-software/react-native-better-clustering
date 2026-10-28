---
id: migration
title: Migrating from react-native-map-clustering
sidebar_position: 3
---

# Migrating from react-native-map-clustering

The main export **is** the clustered `MapView`, with the props and callbacks of
react-native-map-clustering 4.0. `react-native-better-clustering/compat` is a
backwards-compatible alias. Change one import:

```diff
- import MapView from 'react-native-map-clustering'
+ import MapView from 'react-native-better-clustering'
```

Your `<Marker>` children, clustering props and `react-native-maps` props carry
over. Children are picked for clustering by the same rule (see
[Which children are clustered](./api/mapview.md#which-children-are-clustered)).
Check the [differences](#differences) below, and if you come from 3.x, the
[`onRegionChangeComplete` arguments](#coming-from-react-native-map-clustering-3x).

Unlike react-native-map-clustering, this package has native code: it needs
React Native 0.78+ with the New Architecture, `react-native-nitro-modules`, and
a rebuild of the app (a development build with Expo, not Expo Go). See
[Platform Setup](./setup/installation.md).

## Differences

| | react-native-map-clustering 4.0 | This package |
|---|---|---|
| `onRegionChangeComplete` | `(region, details, markers)`; 3.x passed `(region, markers)` | `(region, details, markers)`, called once the clusters for the settled region are computed. Development builds warn about a handler that declares two parameters ([from 3.x](#coming-from-react-native-map-clustering-3x)) |
| `onMarkersChange` | Called each time the region settles | Called once the first index has loaded, then whenever the visible markers and clusters change, also while the map moves |
| `clusterColor` default | `#00B386` (green) | `#0F52FF` (blue). Pass `clusterColor="#00B386"` to keep the old color |
| Default cluster bubble | Two circles in `clusterColor`, with the full count | A ring and a shadow, with counts from 1,000 abbreviated (`1.2k`). Pass `renderCluster` to draw your own |
| `style` | Applied to the map | Applied to a `View` that wraps the map; the map fills that view. Sizing and positioning styles behave the same, but `padding` now insets the map |
| `animationEnabled` | Runs `layoutAnimationConf` when the region settles, on iOS | Fades and glides the default cluster bubbles on zoom, on iOS and Android, with the optional `react-native-reanimated` (see [`clusterFadeInDuration`](./api/mapview.md#clustering-props)) |
| `layoutAnimationConf` | `LayoutAnimation` config, `spring` by default | Accepted and ignored: `LayoutAnimation` cannot animate map markers on the New Architecture |
| Spiderfy | From camera zoom 19, once a cluster has been pressed | From camera zoom `spiderfyMinZoom` (19), or at any zoom when pressed; only clusters that zooming can't split, of at most `spiderfyMaxLeaves` markers. See [Markers at the same location](./api/mapview.md#markers-at-the-same-location) |
| Zoomed in past `maxZoom` | With a `maxZoom` below 20, every marker shows on its own, and markers at one location stack | Clusters stay as they are at `maxZoom`, and spiderfy as above |
| Cluster press | Fits the map to every marker in the cluster | Fits the map to the cluster's bounds: the same region, without reading every marker unless you pass `onClusterPress` |
| `superClusterRef` | A [supercluster](https://github.com/mapbox/supercluster) instance, rebuilt on the JS thread whenever the children change | A [`Supercluster`](./api/engine.md#supercluster) on the native engine, built in the background (see [below](#superclusterref)) |
| Build failures | — | A failed native build, or an invalid clustering prop, is thrown during render, unless you pass `onError` |

`MapView` also adds props react-native-map-clustering does not have, such as
`spiderfyMinZoom`, `spiderfyMaxLeaves`, `clusterFadeInDuration`,
`clusterUpdateIntervalMs`, `clusterRenderMargin` and `onError`. See the
[MapView API](./api/mapview.md).

## Coming from react-native-map-clustering 3.x

`onRegionChangeComplete` follows react-native-map-clustering 4.x: it receives
`(region, details, markers)`. 3.x passed `(region, markers)`, so a handler
written for 3.x now gets the `details` of `react-native-maps` where it expects
the markers. TypeScript only catches this when the handler's parameters have
types. Take the markers from the third argument:

```diff
  <MapView
-   onRegionChangeComplete={(region, markers) => setVisible(markers)}
+   onRegionChangeComplete={(region, details, markers) => setVisible(markers)}
  >
```

In development, `MapView` warns once when the handler declares exactly two
parameters (a parameter with a default value, and every one after it, does not
count). A handler that means `(region, details)` can declare the third
parameter, `(region, details, _markers) => …`, to silence the notice.

## `superClusterRef`

`superClusterRef.current` is a [`Supercluster`](./api/engine.md#supercluster),
not a supercluster instance. It has supercluster's query methods
(`getClusters`, `getChildren`, `getLeaves`, `getClusterExpansionZoom`), but
no `getTile`, and it changes at different times:

- The index builds on a background thread. Until the first build has loaded,
  `current` is an engine whose `isLoaded` is `false`, and its query methods
  throw.
- When markers are added, removed, moved or reordered, the previous engine
  keeps serving queries until the new index has loaded. Then `current` is
  replaced and the previous engine destroyed, so read `superClusterRef.current`
  when you query instead of keeping the instance: a destroyed one throws.
- With `clusteringEnabled={false}`, `current` is `null`.

## Known fixes over react-native-map-clustering

| Issue | Status |
|-------|--------|
| Crash on `NaN` zoom ([#294](https://github.com/tomekvenits/react-native-map-clustering/issues/294)) | Guarded |
| `Map size can't be 0` on Android ([#285](https://github.com/tomekvenits/react-native-map-clustering/issues/285)) | Layout-aware |
| `maxZoom` / `spiralEnabled` ignored ([#274](https://github.com/tomekvenits/react-native-map-clustering/issues/274), [#275](https://github.com/tomekvenits/react-native-map-clustering/issues/275)) | Implemented |
| Unstable clusters on zoom ([#255](https://github.com/tomekvenits/react-native-map-clustering/issues/255)) | Stable references |
| Per-marker `cluster={false}` ([#297](https://github.com/tomekvenits/react-native-map-clustering/issues/297)) | Supported |
