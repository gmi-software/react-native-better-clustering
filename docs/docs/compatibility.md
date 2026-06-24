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
`@gmisoftware/react-native-better-clustering/compat` is a backwards-compatible alias.

```diff
- import MapView from 'react-native-map-clustering'
+ import MapView from '@gmisoftware/react-native-better-clustering'
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
