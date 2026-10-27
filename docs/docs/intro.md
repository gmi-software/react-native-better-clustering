---
id: intro
title: Introduction
sidebar_position: 1
slug: /intro
---

# React Native Better Clustering

`react-native-better-clustering` is a drop-in replacement for
**[react-native-map-clustering](https://github.com/tomekvenits/react-native-map-clustering)** —
same `MapView` + `<Marker>` API, with a **C++ supercluster engine** via
[Nitro Modules](https://nitro.margelo.com) instead of supercluster in JavaScript.

## Migration

```diff
- import MapView from 'react-native-map-clustering'
+ import MapView from 'react-native-better-clustering'
```

See [Migrating from react-native-map-clustering](./migration.md) for the
differences.

## Why C++/Nitro?

react-native-map-clustering builds its supercluster index in JavaScript, on
the JS thread, so a large dataset holds up touches and renders while it loads.
`MapView` here builds the index in C++ on a background thread instead — without
changing how you write map screens. Reading the clusters for the visible region
is a synchronous native call from the JS thread, and markers still render
through `react-native-maps`.

## Advanced APIs

Need full control over rendering? Use subpath exports:

- `/hooks` — `useClusterer` when you own the `MapView`
- `/engine` — `Supercluster` class and geometry helpers
- `/geojson` — GeoJSON conversion utilities

## Next steps

- [Quick Start](./quick-start.md) — install and render your first clustered map.
- [Platform Setup](./setup/installation.md) — peers and prebuild.
- [Migrating from react-native-map-clustering](./migration.md) — what differs.
- [MapView API](./api/mapview.md) — props, callbacks, and customization.
- [Hooks API](./api/hooks.md) — `useClusterer` for custom stacks.
