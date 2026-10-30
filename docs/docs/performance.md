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

### The hook benchmark

The [hook benchmark](https://github.com/gmi-software/react-native-better-clustering/tree/main/example/bench#the-hook-benchmark)
runs `useClusterer`, react-native-clusterer 5.0.2's `useClusterer` and
use-supercluster 1.2.0 (on supercluster 8.0.1) in the same Release build, with
the same points and options and no map: what clustering costs the JS thread,
not rendering. Its
[first run](https://github.com/gmi-software/react-native-better-clustering/blob/main/example/bench/results/ios-simulator-2026-10-30/README.md),
on the iOS Simulator, medians of 3:

| Points | Library | Index build, on the JS thread | Index build, until it answers queries | Each re-render, same props | Each pan | Each data change, until the new index |
|--------|---------|------|------|------|------|------|
| 10,000 | react-native-clusterer 5.0.2 | 19 ms | 19 ms | 21 ms | 43 ms | 63 ms |
| | use-supercluster 1.2.0 | 229 ms | 229 ms | 0.7 ms | 223 ms | 226 ms |
| | **This library** | **1.2 ms** | **9.5 ms** | **0.7 ms** | **0.7 ms** | **14 ms** |
| 50,000 | react-native-clusterer 5.0.2 | 104 ms | 104 ms | 111 ms | 216 ms | 321 ms |
| | use-supercluster 1.2.0 | 1,126 ms | 1,126 ms | 0.7 ms | 1,205 ms | 1,202 ms |
| | **This library** | **5 ms** | **50 ms** | **0.6 ms** | **0.8 ms** | **59 ms** |
| 100,000 | react-native-clusterer 5.0.2 | 234 ms | 234 ms | 238 ms | 455 ms | 674 ms |
| | use-supercluster 1.2.0 | 2,340 ms | 2,340 ms | 0.7 ms | 2,380 ms | 2,338 ms |
| | **This library** | **11 ms** | **125 ms** | **0.7 ms** | **0.7 ms** | **152 ms** |

- **Building.** react-native-clusterer reads the points and builds its index
  in one synchronous JSI call, and supercluster builds in JavaScript: the whole
  build blocks the JS thread. Here only checking and packing the points does.
- **Re-renders and pans.** react-native-clusterer 5.0.2 builds a full index on
  every render of the component that calls its hook, so one for each re-render
  and two for each pan. use-supercluster builds one for each pan unless its
  options spell out every supercluster option, which the benchmark's don't (see
  [Migrating from use-supercluster](./migration-supercluster.md#what-runs-on-which-thread)).
  Here a pan only queries the index. Times below a frame (16.7 ms) are mostly
  the wait for React to commit.
- **Where this library is behind.** Its hook has no clusters on the first
  render: they arrive with the first build, 15 ms after the mount at 10,000
  points and 165 ms at 100,000. react-native-clusterer has them on the first
  render, by building during it. While a new index builds, the hook keeps
  returning the clusters of the previous points: 152 ms at 100,000 here.
- **Feature counts.** With the same options, `useClusterer` and
  react-native-clusterer returned the same number of features at every step.

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
