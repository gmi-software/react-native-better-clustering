---
id: mapview
title: MapView
sidebar_position: 1
---

# MapView

The main export — a clustered `MapView` with the same API as
[react-native-map-clustering](https://github.com/tomekvenits/react-native-map-clustering).

```tsx
import MapView from '@gmisoftware/react-native-better-clustering'
import { Marker } from 'react-native-maps'
```

`@gmisoftware/react-native-better-clustering/compat` is a backwards-compatible
alias of the same component.

## Basic usage

```tsx
<MapView
  style={{ flex: 1 }}
  initialRegion={{
    latitude: 52.23,
    longitude: 21.01,
    latitudeDelta: 0.35,
    longitudeDelta: 0.35,
  }}
  radius={56}
  minPoints={2}
  clusterColor="#FFCC00"
  clusterTextColor="#000000"
>
  {points.map((point) => (
    <Marker
      key={point.id}
      coordinate={{
        latitude: point.latitude,
        longitude: point.longitude,
      }}
    />
  ))}
</MapView>
```

## Clustering props

All standard [`react-native-maps` `MapView` props](https://github.com/react-native-maps/react-native-maps/blob/master/docs/mapview.md)
are supported, plus:

| Prop | Default | Description |
|------|---------|-------------|
| `radius` | `~6%` of screen width | Cluster radius in pixels |
| `minPoints` | `2` | Minimum points to form a cluster |
| `minZoom` | `1` | Minimum zoom level |
| `maxZoom` | `20` | Maximum zoom level for clustering |
| `extent` | `512` | Tile extent (supercluster) |
| `nodeSize` | `64` | KD-tree leaf size |
| `clusteringEnabled` | `true` | Toggle clustering |
| `spiralEnabled` | `true` | Spider layout at max zoom |
| `spiderLineColor` | `#FF0000` | Color of spider connector lines |
| `clusterColor` | `#0F52FF` | Default cluster bubble color (GMI brand blue) |
| `clusterTextColor` | `#FFFFFF` | Default cluster label color |
| `clusterFontFamily` | — | Font family for cluster count label |
| `animationEnabled` | `true` | Animate cluster changes (iOS only) |
| `layoutAnimationConf` | 200ms easeInEaseOut create/delete + scale update | LayoutAnimation config when `animationEnabled` (tuned for cluster bubble transitions; pass a custom config to override) |
| `clusterFadeInDuration` | `250` | Cross-fade duration (ms) for default cluster bubbles on zoom: new bubbles fade in while removed ones linger and fade out, eliminating the blink from native annotations being added/removed (iOS + Android). Driven by Reanimated on the UI thread. The fade-out cross-fade is applied to the settled cluster set only — during an active pinch/pan, removed bubbles are dropped immediately so a continuous zoom does not stack multiple bubble generations and overload the JS thread. Gated by `animationEnabled`; ignored with a custom `renderCluster`. Set to `0` to disable |
| `tracksViewChanges` | `false` | Forwarded to default cluster markers |
| `edgePadding` | 50px each side | Padding for `fitToCoordinates` on cluster press |
| `preserveClusterPressBehavior` | `false` | Skip auto `fitToCoordinates` on cluster press |
| `selectedClusterId` | — | Highlight a cluster by id |
| `selectedClusterColor` | `#FF5722` | Color when cluster is selected |
| `width` / `height` | window size | Seed map dimensions before `onLayout` |
| `clusterUpdateIntervalMs` | `100` | Minimum interval (ms) between cluster recomputations while the map is moving; `0` recomputes only on settle |
| `superClusterRef` | — | Ref to access the underlying `Supercluster` engine |
| `mapRef` | — | Callback ref to the inner `react-native-maps` instance |

## Callbacks

| Prop | Signature | Description |
|------|-----------|-------------|
| `onClusterPress` | `(cluster, markers) => void` | Fired when a cluster is tapped |
| `onMarkersChange` | `(markers) => void` | Fired when visible markers/clusters change |
| `onRegionChangeComplete` | `(region, details, markers) => void` | Extends the maps callback with current markers |

## Per-marker opt-out

Exclude individual markers from clustering:

```tsx
<Marker
  cluster={false}
  coordinate={{ latitude: 52.23, longitude: 21.01 }}
/>
```

## Custom cluster UI

Pass `renderCluster` for full control over the cluster bubble:

```tsx
import MapView, {
  type RenderClusterProps,
} from '@gmisoftware/react-native-better-clustering'
import { Marker } from 'react-native-maps'

const renderCluster = (cluster: RenderClusterProps) => {
  const [longitude, latitude] = cluster.geometry.coordinates

  return (
    <Marker
      coordinate={{ latitude, longitude }}
      onPress={cluster.onPress}
      tracksViewChanges={cluster.tracksViewChanges}
    >
      {/* your cluster bubble */}
    </Marker>
  )
}

<MapView renderCluster={renderCluster} {...props}>
  {/* markers */}
</MapView>
```

Cluster features include `properties.point_count`,
`properties.point_count_abbreviated`, and
`properties.getExpansionRegion()` for zoom-on-tap.

## Types

```tsx
import type {
  ClusteredMapViewProps,
  RenderClusterProps,
} from '@gmisoftware/react-native-better-clustering'
```

`ClusteredMapViewProps` is the full props type for the clustered `MapView`.
