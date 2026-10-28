---
id: mapview
title: MapView
sidebar_position: 1
---

# MapView

The main export — a clustered `MapView` with the same API as
[react-native-map-clustering](https://github.com/tomekvenits/react-native-map-clustering).

```tsx
import MapView from 'react-native-better-clustering'
import { Marker } from 'react-native-maps'
```

`react-native-better-clustering/compat` is a backwards-compatible
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
| `radius` | `~6%` of screen width | Cluster radius in pixels. The default matches react-native-map-clustering and is smaller than the default bubble; for dense data pass about twice it (around `50` on a phone), see [Troubleshooting](../troubleshooting.md#zooming-stutters-with-many-markers) |
| `minPoints` | `2` | Minimum points to form a cluster |
| `minZoom` | `1` | Minimum zoom level |
| `maxZoom` | `20` | Maximum zoom level for clustering |
| `extent` | `512` | Tile extent, in supercluster's sense: `radius` is in pixels of an `extent`-wide tile, so a larger `extent` clusters more tightly at the same `radius` |
| `nodeSize` | `64` | KD-tree leaf size |
| `clusteringEnabled` | `true` | Toggle clustering |
| `spiralEnabled` | `true` | Spread markers that share a location (a cluster that zooming can't split) into a spiral with connector lines. See [Markers at the same location](#markers-at-the-same-location) |
| `spiderfyMinZoom` | `19` | Camera zoom from which such clusters spread without being pressed (react-native-map-clustering parity) |
| `spiderfyMaxLeaves` | `50` | Most markers a cluster spiderfies into. A larger cluster of overlapping markers stays a bubble; pressing it still calls `onClusterPress` with every marker, so you can list them instead. Spider markers are spaced about 40 pt apart on screen |
| `spiderLineColor` | `#FF0000` | Color of spider connector lines |
| `clusterColor` | `#0F52FF` | Default cluster bubble color (GMI brand blue) |
| `clusterTextColor` | `#FFFFFF` | Default cluster label color |
| `clusterFontFamily` | — | Font family for cluster count label |
| `clusterAccessibilityLabel` | ``(count) => `Cluster of ${count} markers` `` | Accessibility label for a default cluster bubble, passed to its `Marker` with the `button` role. Screen readers do not announce it yet: see [Accessibility](#accessibility) |
| `animationEnabled` | `true` | Fade and glide the default cluster bubbles on zoom (iOS + Android); see `clusterFadeInDuration` |
| `layoutAnimationConf` | — | Deprecated and ignored, accepted for react-native-map-clustering compatibility. `LayoutAnimation` cannot animate map markers on the New Architecture: they are native map annotations outside React Native's layout. Tune the fade with `clusterFadeInDuration` |
| `clusterFadeInDuration` | `250` | Cross-fade duration (ms) for default cluster bubbles on zoom: new bubbles fade in while removed ones linger and fade out, eliminating the blink from native annotations being added/removed (iOS + Android). Driven by Reanimated on the UI thread; without the optional `react-native-reanimated` peer, bubbles do not fade and removed ones disappear at once. Bubbles cross-fade when the map settles; during an active pinch/pan, new bubbles appear at once and removed ones stay for up to 100 ms (never longer than this duration) before they go, so a continuous zoom leaves no gaps; at the default `clusterUpdateIntervalMs` at most one extra generation of bubbles stays mounted. It also times the glide: on a zoom step, a splitting cluster's new bubbles start at its place and glide to theirs, a bubble whose cluster moves slides there, and merging bubbles glide into the one that takes them in (while the map moves, within the 100 ms they stay); pans and data changes only fade. Gated by `animationEnabled`; ignored with a custom `renderCluster`. Set to `0` to disable |
| `tracksViewChanges` | `false` | Forwarded to default cluster markers |
| `edgePadding` | 50px each side | Padding for `fitToCoordinates` on cluster press |
| `preserveClusterPressBehavior` | `false` | Skip auto `fitToCoordinates` on cluster press |
| `selectedClusterId` | — | Highlight a cluster by id |
| `selectedClusterColor` | `#FF5722` | Color when cluster is selected |
| `width` / `height` | window size | Seed map dimensions before `onLayout` |
| `clusterUpdateIntervalMs` | `100` | Minimum interval (ms) between cluster recomputations while the map is moving; `0` recomputes only on settle |
| `clusterRenderMargin` | `100` | How far outside the map, in points, cluster bubbles still render. Clusters are found, and reported to `onMarkersChange`, for the region plus half its size on each side, as in react-native-map-clustering; only rendering stops at this margin, and markers are not affected. A smaller margin mounts fewer native annotations on each zoom step, which keeps the UI thread free for the bubble fade; a larger one leaves fewer bubbles to appear at the edges during a fast pan. `Infinity` renders every cluster found |
| `superClusterRef` | — | Receives the [`Supercluster`](./engine.md#supercluster) behind the clusters on screen. It is replaced after each rebuild and `null` while `clusteringEnabled` is `false`; see [`superClusterRef`](../migration.md#superclusterref) |
| `mapRef` | — | Callback ref to the inner `react-native-maps` instance |

`style` applies to a `View` that wraps the map, and the map fills that view.

`radius`, `minPoints`, `minZoom`, `maxZoom`, `extent` and `nodeSize` must be in
their [valid ranges](./types.md#valid-values). An invalid one fails like a
failed build (passed to `onError`, or thrown during render without it), with a
message that names the prop.

## Callbacks

| Prop | Signature | Description |
|------|-----------|-------------|
| `onClusterPress` | `(cluster, markers) => void` | Fired when a cluster is tapped, with every marker in it. The markers are read only when you pass this prop; for a cluster of tens of thousands that read is most of what a press costs. The map fits the cluster's bounds either way |
| `onMarkersChange` | `(markers) => void` | Fired when visible markers/clusters change: once the first index has loaded, then only when the visible set changes. A re-render with the same marker coordinates does not fire it, so `onMarkersChange={setState}` is safe |
| `onRegionChangeComplete` | `(region, details, markers) => void` | Extends the maps callback with current markers, in react-native-map-clustering 4.x's order. 3.x passed `(region, markers)`: see [Coming from react-native-map-clustering 3.x](../migration.md#coming-from-react-native-map-clustering-3x) |
| `onError` | `(error) => void` | Fired when the native cluster index fails to build, for example because the app was not rebuilt after installing the library. Markers from an earlier successful build keep showing. Without it, the error is thrown during render so an error boundary (and LogBox in development) shows it — see [Troubleshooting](../troubleshooting.md#the-native-clusterengine-module-is-not-available) |

## Markers at the same location

Markers at the same coordinate (one building, or geocoding fallbacks) form a
cluster that zooming can never split. With `spiralEnabled`, `MapView` spreads
them into a spiral:

- automatically from camera zoom `spiderfyMinZoom` (19 by default), and
- at any zoom when the cluster is pressed. The map doesn't move; the spiral
  collapses when the zoom changes. This also covers maps whose maximum zoom
  (`maxZoomLevel`, or the provider's limit) sits below `spiderfyMinZoom`.

`onClusterPress` still receives the cluster and its markers. Clusters of
distinct nearby markers keep expanding by zooming, and clusters larger than
`spiderfyMaxLeaves` stay bubbles. With `preserveClusterPressBehavior`, a press
only calls `onClusterPress`.

`MapView` never clusters at a zoom above `maxZoom`, so a cluster still there at
`maxZoom` stays a cluster however far the map zooms in, and spreads out as
above. `useClusterer` instead returns its markers on their own there (see
[Above `maxZoom`](./engine.md#above-maxzoom)).

## Across the antimeridian

When the map spans ±180°, the markers on both sides show. As in supercluster,
markers on opposite sides never join one cluster.

## Which children are clustered

`MapView` clusters a child when it is an element with its own `coordinate`
prop and without `cluster={false}`, as react-native-map-clustering does. Arrays are flattened, so several
`{items.map(…)}` lists can sit side by side. Every other child renders as it
is, unclustered, and so does each marker inside it:

```tsx
<MapView>
  {/* Clustered: each child is an element with a `coordinate` prop. */}
  {shops.map((shop) => (
    <Marker key={shop.id} coordinate={shop.location} />
  ))}
  {cafes.map((cafe) => (
    <CafeMarker key={cafe.id} coordinate={cafe.location} cafe={cafe} />
  ))}

  {/* Not clustered: neither the Fragment nor `<ParkPin>` has a `coordinate` prop. */}
  <>
    {stations.map((station) => (
      <Marker key={station.id} coordinate={station.location} />
    ))}
  </>
  {parks.map((park) => (
    <ParkPin key={park.id} park={park} />
  ))}
</MapView>
```

A component such as `CafeMarker` is clustered by its `coordinate` prop and
renders as itself when it stands alone, so it must render a `Marker` at that
coordinate. Spiderfy passes it a new `coordinate`. Give every marker a stable
`key` (see [Markers flicker on zoom](../troubleshooting.md#markers-flicker-on-zoom)).

## Per-marker opt-out

Markers cluster by default (`cluster` omitted or `cluster={true}`). Exclude
individual markers from clustering:

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
} from 'react-native-better-clustering'
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

## Accessibility

Each default cluster bubble passes an `accessibilityLabel` and the `button`
role to its `Marker`. The label is `Cluster of N markers`, or what
`clusterAccessibilityLabel` returns for the number of markers:

```tsx
<MapView
  clusterAccessibilityLabel={(count) => t('map.cluster', { count })}
  {...props}
>
  {/* markers */}
</MapView>
```

Screen readers do not announce it yet. `react-native-maps` (up to 1.29) does
not pass a `Marker`'s `accessibilityLabel` or `accessibilityRole` to the
native map annotation: on iOS with Apple Maps, VoiceOver reads a cluster
bubble as "Map pin", and on Android the label does not reach the Google Maps
marker. A `renderCluster` marker has the same limit. The bubbles announce
their label once `react-native-maps` passes it on; follow
[react-native-maps#6046](https://github.com/react-native-maps/react-native-maps/issues/6046).

## Types

```tsx
import type {
  ClusteredMapViewProps,
  RenderClusterProps,
} from 'react-native-better-clustering'
```

`ClusteredMapViewProps` is the full props type for the clustered `MapView`.
