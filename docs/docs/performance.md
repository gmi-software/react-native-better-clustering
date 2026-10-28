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
| Packing the points into a buffer (`packPoints`) and copying them into the engine (`setPoints`) | JS thread; the copy is a synchronous native call | When markers are added, removed, moved or reordered |
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
