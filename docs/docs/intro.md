---
id: intro
title: Introduction
sidebar_position: 1
slug: /intro
---

# React Native Better Clustering

`react-native-better-clustering` is a faster
**[react-native-map-clustering](https://github.com/tomekvenits/react-native-map-clustering)** —
same `MapView` + `<Marker>` API, with a **C++ supercluster engine** via
[Nitro Modules](https://nitro.margelo.com) instead of JS on the RN bridge.

## Migration

```diff
- import MapView from 'react-native-map-clustering'
+ import MapView from 'react-native-better-clustering'
```

## Why C++/Nitro?

Clustering large datasets in JavaScript causes dropped frames on every region
change. This library builds the index in C++ and returns only visible
features for the current viewport — without changing how you write map screens.

## Advanced APIs

Need full control over rendering? Use subpath exports:

- `/hooks` — `useClusterer` when you own the `MapView`
- `/engine` — `Supercluster` class and geometry helpers
- `/geojson` — GeoJSON conversion utilities

## Next steps

- [Quick Start](./quick-start.md) — install and render your first clustered map.
- [Platform Setup](./setup/installation.md) — peers and prebuild.
- [MapView API](./api/mapview.md) — props, callbacks, and customization.
- [Hooks API](./api/hooks.md) — `useClusterer` for custom stacks.
