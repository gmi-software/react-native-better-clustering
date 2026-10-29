---
id: performance
title: Performance model
sidebar_position: 5
---

# Performance model

The index builds asynchronously, queries are synchronous, and rendering is the
ceiling. Where each step runs decides what a large dataset costs.

## What runs where

| Step | Where it runs | When |
|------|---------------|------|
| Turning `<Marker>` children into points, and comparing them with the previous points | JS thread | Each render with new children |
| Packing the points into a buffer and copying them into the engine (`setPoints`) | JS thread; the copy is a synchronous native call | When markers are added, removed, moved or reordered |
| Building the index | A background thread | After each copy |
| Finding the clusters in the region (`getClusters`) | JS thread, a synchronous native call | Each region update; while the map moves, at most every `clusterUpdateIntervalMs` |
| Reading a cluster's markers (`getLeaves`) | JS thread, a synchronous native call | On a cluster press with `onClusterPress`, and for spiderfy |
| Mounting and drawing markers and cluster bubbles | `react-native-maps`, on the UI thread | Whenever the visible markers and clusters change |
| Fading and gliding the default bubbles | Reanimated, on the UI thread | On zoom |

## What it means

- **Building.** react-native-map-clustering builds its supercluster index on
  the JS thread. Here, turning the children into points, packing them and
  copying them into the engine run there, but the build does not. Those steps
  still grow with the number of markers.
- **Querying.** A query blocks the JS thread for as long as it takes, and
  returns only the features in the region.
- **Rendering is the ceiling.** Each visible marker and cluster is a native map
  annotation that `react-native-maps` mounts. With hundreds on screen, a zoom
  step that replaces them costs more than clustering. Keep the count down with
  a larger `radius` (see
  [Zooming stutters with many markers](./troubleshooting.md#zooming-stutters-with-many-markers)),
  a smaller `clusterRenderMargin`, and stable `key`s on your markers.

## Measurements

The [core benchmark](https://github.com/gmi-software/react-native-better-clustering/tree/main/package/bench)
measures the C++ engine alone on a desktop CPU: build and query times, and
memory, for six datasets of up to 100k points. It says nothing about Hermes,
the JS layer or rendering on a phone, so it cannot back a claim about app
frame rates.

The [device benchmark](https://github.com/gmi-software/react-native-better-clustering/tree/main/example/bench)
measures the whole pipeline instead: the example app in a Release build on
Hermes, rendering included, running this library and react-native-map-clustering
4.0.0 through the same script. Its
[first run](https://github.com/gmi-software/react-native-better-clustering/blob/main/example/bench/results/ios-simulator-2026-10-14/README.md),
on the iOS Simulator, reports the time to the first markers, JS freezes, memory,
zoom and cluster presses for 10k, 50k and 100k markers. Since
29 October 2026, on the
[iOS Simulator](https://github.com/gmi-software/react-native-better-clustering/blob/main/example/bench/results/ios-simulator-2026-10-29/README.md)
and an
[Android emulator](https://github.com/gmi-software/react-native-better-clustering/blob/main/example/bench/results/android-emulator-2026-10-29/README.md),
it also moves 20 vehicles over the markers 10 times a second, and reports how
many updates reach the map, how late and how old the map is, and how long JS
is blocked meanwhile. A simulator runs on the Mac's CPU, faster than a phone:
compare the libraries, not the absolute times.

## Roadmap

Today this library moves clustering compute to C++. Visible markers are still
rendered through `react-native-maps` `<Marker>` components, which is the ceiling
described above.

- **Near term**, within `react-native-maps`: image-based cluster bubbles with
  caching, stable marker pooling and smarter defaults. Still bounded by the cost
  of each annotation.
- **The goal**: a native render layer. The C++ engine feeds packed point data
  directly into native bubble rendering, drawn in a single native pass instead
  of one React `<Marker>` per cluster or point, behind the same `MapView` +
  `<Marker>` API.

Track progress in
[GitHub Issues](https://github.com/gmi-software/react-native-better-clustering/issues).
