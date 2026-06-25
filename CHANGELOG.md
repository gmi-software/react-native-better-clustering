# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-06-25

First stable release.

### Added

- **`MapView` as the main export** — drop-in replacement for
  `react-native-map-clustering` with the same `<Marker>` children API.
- **C++ `ClusterEngine`** via [Nitro Modules](https://nitro.margelo.com) —
  supercluster-style KD-tree hierarchy off the JS thread.
- **Clustering props** on `MapView`: `radius`, `minPoints`, `minZoom`, `maxZoom`,
  `clusteringEnabled`, `spiralEnabled`, `spiderLineColor`, `clusterColor`,
  `clusterTextColor`, `animationEnabled`, `onClusterPress`, `renderCluster`,
  `preserveClusterPressBehavior`, `superClusterRef`, `clusterUpdateIntervalMs`.
- **Reanimated cluster fade** — cross-fade on cluster changes after the map
  gesture settles; exit ghosts suppressed while panning/zooming.
- Per-marker opt-out via `<Marker cluster={false} />`.
- Advanced subpath exports: `/hooks` (`useClusterer`), `/clusterer`
  (`Clusterer`), `/engine` (`Supercluster`, `createClusterEngine`), `/geojson`,
  `/utils`.
- `/compat` alias of the main export for backwards compatibility.
- Guarded zoom calculation (no `NaN` crash) and layout-aware
  `fitToCoordinates` on Android.
- Stable cluster references between renders via `stabilizeClusterFeatures`.
- Example Expo app and [Docusaurus documentation](https://gmi-software.github.io/react-native-better-clustering/docs/intro).

### Fixed

- C++, Android, and iOS native build failures in CI.

### Requirements

- React Native **0.78+** with New Architecture enabled.
- `react-native-nitro-modules` (required peer).
- `react-native-maps` (required for the main `MapView` export).
- `react-native-reanimated` and `react-native-worklets` (required peers).

[1.0.0]: https://github.com/gmi-software/react-native-better-clustering/releases/tag/v1.0.0
