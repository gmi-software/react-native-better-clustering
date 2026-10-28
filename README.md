<img width="1024" height="321" alt="react-native-better-clustering" src="./docs/static/img/readme-banner.png" />

<div align="center">

**Your `react-native-maps` screen freezes with thousands of markers? Change one import.**

A drop-in replacement for **[react-native-map-clustering](https://github.com/tomekvenits/react-native-map-clustering)** — same API, same `react-native-maps` workflow, but the cluster index is built in **C++ via [Nitro](https://nitro.margelo.com/)** on a background thread, not in JavaScript on the JS thread.

[![npm version](https://img.shields.io/npm/v/react-native-better-clustering.svg)](https://www.npmjs.com/package/react-native-better-clustering)
[![npm downloads](https://img.shields.io/npm/dw/react-native-better-clustering.svg)](https://www.npmjs.com/package/react-native-better-clustering)
[![GitHub stars](https://img.shields.io/github/stars/gmi-software/react-native-better-clustering?style=flat)](https://github.com/gmi-software/react-native-better-clustering/stargazers)
[![New Architecture](https://img.shields.io/badge/New_Architecture-required-0F52FF.svg)](https://reactnative.dev/architecture/landing-page)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![CI](https://github.com/gmi-software/react-native-better-clustering/actions/workflows/ci.yml/badge.svg)](https://github.com/gmi-software/react-native-better-clustering/actions/workflows/ci.yml)

[Benchmark](#benchmark) • [Migration](#migration) • [Installation](#installation) • [Usage](#usage) • [Documentation](https://gmi-software.github.io/react-native-better-clustering/docs/intro) • [Example app](./example)

</div>

<div align="center">
  <img src="./docs/static/img/demo.gif" alt="Clustering demo — pan and zoom with 2,000 markers" width="360" />
</div>

## Benchmark

The same app, the same markers, the same cluster bubble, both libraries with their default props. Medians of 5 runs of a Release build (Hermes), from the [device benchmark](./example/bench):

| Markers | | First markers on the map | Longest JS freeze while mounting | JS blocked over 10 parent re-renders |
| --- | --- | --- | --- | --- |
| 10,000 | react-native-map-clustering 4.0.0 | 359 ms | 360 ms | 2,877 ms |
| | **react-native-better-clustering** | **193 ms** | **27 ms** | **0 ms** |
| 50,000 | react-native-map-clustering 4.0.0 | 1,834 ms | 1,835 ms | 17,794 ms |
| | **react-native-better-clustering** | **232 ms** | **92 ms** | **464 ms** |
| 100,000 | react-native-map-clustering 4.0.0 | 3,557 ms | 3,558 ms | 35,899 ms |
| | **react-native-better-clustering** | **434 ms** | **170 ms** | **1,719 ms** |

- **Mount.** react-native-map-clustering builds its index on the JS thread, so no touch, timer or state update runs until the first markers appear. Here the build runs on a background thread.
- **Re-renders.** With the same markers as new inline children, react-native-map-clustering rebuilds its index on every render. This library keeps the index and every mounted marker.
- **Zoom.** react-native-map-clustering queries four times the screen's area; at zoom 8 it renders about 3–4× as many markers and bubbles, most of them off screen.

Measured on the iOS Simulator (iPhone 17 Pro, Apple M5 Pro) against the 1.1.0 release candidate, which runs faster than a phone: compare the libraries, not the absolute times. The [full results](./example/bench/results/ios-simulator-2026-10-14/README.md) include memory, zoom and cluster presses — including where this library is slower: after a cluster press, the camera settles about 0.45 s later.

## Migration

```diff
- import MapView from 'react-native-map-clustering'
+ import MapView from 'react-native-better-clustering'
  import { Marker } from 'react-native-maps'
```

That is it. Your `<Marker>` children, cluster props, and `react-native-maps` options carry over. A few defaults and behaviours differ, such as the default cluster color and how `style` is applied: see [Migrating from react-native-map-clustering](https://gmi-software.github.io/react-native-better-clustering/docs/migration), and [Coming from 3.x](#coming-from-react-native-map-clustering-3x) below.

## Fixes over react-native-map-clustering


| Issue                                                                                                                                                                                              | Status                                    |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Crash on `NaN` zoom ([#294](https://github.com/tomekvenits/react-native-map-clustering/issues/294))                                                                                                | Guarded with finite zoom fallback         |
| `Map size can't be 0` on Android ([#285](https://github.com/tomekvenits/react-native-map-clustering/issues/285))                                                                                   | Layout-aware `fitToCoordinates`           |
| `maxZoom` / `spiralEnabled` ignored ([#274](https://github.com/tomekvenits/react-native-map-clustering/issues/274), [#275](https://github.com/tomekvenits/react-native-map-clustering/issues/275)) | Implemented                               |
| Unstable clusters on zoom ([#255](https://github.com/tomekvenits/react-native-map-clustering/issues/255))                                                                                          | Stable cluster references between renders |
| Per-marker `cluster={false}` ([#297](https://github.com/tomekvenits/react-native-map-clustering/issues/297))                                                                                       | Supported                                 |


> [!CAUTION]
> Bugs in `react-native-maps` itself (ghost markers on Android, navigation crashes) may still occur — this library replaces clustering, not the map renderer.

## Supported platforms

- [x] iOS
- [x] Android
- [ ] Web

> [!NOTE]
> Requires React Native **0.78+** with the **New Architecture**. Does not work in Expo Go — use a [development build](https://docs.expo.dev/develop/development-builds/introduction/).

## Installation

| Peer dependency              | Version    | Notes                                       |
| ---------------------------- | ---------- | ------------------------------------------- |
| `react-native-maps`          | `>=1.20.1` | Required                                    |
| `react-native-nitro-modules` | `>=0.32.0` | Required; install it next to the library    |
| `react-native-reanimated`    | `^4.1.0`   | Optional; fades and glides the cluster bubbles on zoom, see [Animated cluster bubbles](#animated-cluster-bubbles) |

### Bare React Native

```bash
npm install react-native-better-clustering react-native-nitro-modules react-native-maps
cd ios && pod install && cd ..
```

Rebuild the native app after installing.

### Expo

```bash
npx expo install react-native-better-clustering react-native-nitro-modules react-native-maps
```

Add the `react-native-maps` plugin to `app.json`:

```json
{
  "expo": {
    "plugins": [
      ["react-native-maps", { "googleMapsApiKey": "YOUR_GOOGLE_MAPS_API_KEY" }]
    ]
  }
}
```

```bash
npx expo prebuild --clean
npx expo run:ios   # or: npx expo run:android
```

## Usage

```tsx
import MapView from 'react-native-better-clustering'
import { Marker } from 'react-native-maps'

export function MapScreen() {
  return (
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
      spiralEnabled
      animationEnabled
      onClusterPress={(cluster, markers) => {
        console.log(cluster.properties.point_count, markers.length)
      }}
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

      {/* Keep a marker outside clusters */}
      <Marker
        cluster={false}
        coordinate={{ latitude: 52.23, longitude: 21.01 }}
      />
    </MapView>
  )
}
```

### Custom cluster UI

Pass `renderCluster` when you need full control over the cluster bubble:

```tsx
import MapView, {
  type RenderClusterProps,
} from 'react-native-better-clustering'
import { Marker } from 'react-native-maps'

const renderCluster = (cluster: RenderClusterProps) => {
  const [longitude, latitude] = cluster.geometry.coordinates
  return (
    <Marker coordinate={{ latitude, longitude }} onPress={cluster.onPress}>
      {/* your cluster bubble */}
    </Marker>
  )
}

<MapView renderCluster={renderCluster} {...props}>
  {/* markers */}
</MapView>
```

## Props

Everything from `react-native-maps` `MapView`, plus:


| Prop                           | Default               | Description                       |
| ------------------------------ | --------------------- | --------------------------------- |
| `radius`                       | `~6%` of screen width | Cluster radius in pixels          |
| `minPoints`                    | `2`                   | Minimum points to form a cluster  |
| `minZoom`                      | `1`                   | Minimum zoom level                |
| `maxZoom`                      | `20`                  | Maximum zoom level for clustering |
| `clusteringEnabled`            | `true`                | Toggle clustering                 |
| `spiralEnabled`                | `true`                | Spread markers that share a location into a spiral |
| `spiderfyMinZoom`              | `19`                  | Camera zoom from which they spread without a press |
| `spiderfyMaxLeaves`            | `50`                  | Most markers a cluster spiderfies into; larger ones stay a bubble |
| `spiderLineColor`              | `#FF0000`             | Color of spider connector lines   |
| `clusterColor`                 | `#0F52FF`             | Default cluster bubble color (GMI brand blue) |
| `clusterTextColor`             | `#FFFFFF`             | Default cluster label color       |
| `clusterAccessibilityLabel`    | `Cluster of N markers` | `(count) => string` — accessibility label for the default cluster bubbles; not announced by screen readers yet, see [Accessibility](https://gmi-software.github.io/react-native-better-clustering/docs/api/mapview#accessibility) |
| `animationEnabled`             | `true`                | Fade and glide cluster bubbles on zoom |
| `onClusterPress`               | —                     | `(cluster, markers) => void`      |
| `onError`                      | throws during render  | `(error) => void` — native index build failed or an option is invalid |
| `renderCluster`                | —                     | Custom cluster renderer           |
| `clusterFontFamily`            | —                     | Font family for the cluster count label; also passed to `renderCluster` |
| `preserveClusterPressBehavior` | `false`               | Skip auto `fitToCoordinates`      |
| `superClusterRef`              | —                     | Access the underlying engine      |
| `width` / `height`             | window size           | Seed map dimensions before layout |
| `clusterUpdateIntervalMs`      | `100`                 | Min interval (ms) between cluster updates while moving; `0` = only on settle |
| `clusterRenderMargin`          | `100`                 | How far outside the map (pt) cluster bubbles still render; `Infinity` = every cluster found |


Per-marker opt-out: `<Marker cluster={false} ... />`.

## What runs where


|                | react-native-map-clustering         | This package                               |
| -------------- | ----------------------------------- | ------------------------------------------ |
| API            | `MapView` + `<Marker>` children     | **Same**                                   |
| Map            | `react-native-maps`                 | `react-native-maps`                        |
| Engine         | JS supercluster                     | **C++ supercluster via Nitro**             |
| Index build    | JavaScript, on the JS thread        | **C++, on a background thread**            |
| Viewport query | JavaScript, on the JS thread        | C++, a synchronous call from the JS thread |
| Markers        | One `<Marker>` per cluster or point | Same, see [Roadmap](#roadmap)              |

See the [performance model](https://gmi-software.github.io/react-native-better-clustering/docs/performance).

## Common problems


| Problem                  | Solution                                                                                                                                |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| Map is blank on Android  | Add a Google Maps API key. See [platform setup](https://gmi-software.github.io/react-native-better-clustering/docs/setup/installation). |
| New Architecture errors  | Confirm New Architecture is enabled and rebuild.                                                                                        |
| Does not work in Expo Go | Use a [development build](https://docs.expo.dev/develop/development-builds/introduction/).                                              |
| `native ClusterEngine module is not available` | Rebuild the native app after installing (`pod install` / `npx expo prebuild --clean`). See [troubleshooting](https://gmi-software.github.io/react-native-better-clustering/docs/troubleshooting#the-native-clusterengine-module-is-not-available). |
| Markers flicker on zoom  | Give each `Marker` a stable `key` (not the array index); memoize marker components.                                                     |


More in [troubleshooting](https://gmi-software.github.io/react-native-better-clustering/docs/troubleshooting).

## Coming from react-native-map-clustering 3.x

`onRegionChangeComplete` receives `(region, details, markers)`, as in 4.x, not `(region, markers)`: take the markers from the third argument. Development builds warn once about a handler that declares two parameters. See [Coming from 3.x](https://gmi-software.github.io/react-native-better-clustering/docs/migration#coming-from-react-native-map-clustering-3x).

## Animated cluster bubbles

With [Reanimated](https://docs.swmansion.com/react-native-reanimated/) installed,
the default cluster bubbles cross-fade on zoom, and glide: a splitting
cluster's parts slide out of it and merging clusters slide into one. Follow Reanimated's own
[installation guide](https://docs.swmansion.com/react-native-reanimated/docs/fundamentals/getting-started/)
(it also needs `react-native-worklets`), or with Expo:

```bash
npx expo install react-native-reanimated react-native-worklets
```

Without it, bubbles appear and disappear without a fade or glide, and development builds
log a one-time notice unless you pass `clusterFadeInDuration={0}`.

## Example app

A menu of scenarios that exercise real-world usage. A dev HUD on each one shows JS FPS, mounted markers, marker mounts and engine builds, and the datasets are seeded, so every run sees the same markers.

| Scenario | What it exercises |
| --- | --- |
| Basic | 2,000 static markers across Poland |
| Parent state | A selection and a visible list from `onMarkersChange={setState}` with inline children, plus a 2 Hz parent re-render |
| Live data | Appending and removing markers, on demand or one per second |
| Co-located markers | Spiderfy from zoom 19 or on press; 1,000 markers at one spot stay a bubble |
| Antimeridian | Markers on both sides of ±180° |
| 10k / 50k markers | Large datasets, with the time to first markers |
| Custom `renderCluster` | Clusters drawn by the app |
| `clusteringEnabled` toggle | Clustering turned off and on with the map mounted |
| Benchmark | The [device benchmark](./example/bench) against react-native-map-clustering |

```bash
cd example
bun install
npx expo prebuild --clean
bun run ios   # or: bun run android
```

## Advanced APIs

Low-level hooks and headless access live under subpath exports for custom map stacks:


| Import                                                  | Use when                                                |
| ------------------------------------------------------- | ------------------------------------------------------- |
| `react-native-better-clustering/hooks`     | `useClusterer` — you own the `MapView`                  |
| `react-native-better-clustering/clusterer` | `Clusterer` — declarative `renderItem` over `useClusterer` |
| `react-native-better-clustering/engine`    | `Supercluster`, `createClusterEngine`, geometry helpers — see [headless lifecycle](https://gmi-software.github.io/react-native-better-clustering/docs/api/engine) |
| `react-native-better-clustering/geojson` | GeoJSON types and conversion                            |
| `react-native-better-clustering/utils`   | `packPoints`, distance helpers                          |


See the [docs](https://gmi-software.github.io/react-native-better-clustering/docs/intro) for details. The `/compat` subpath is an alias of the main export.

## Roadmap

Today this library moves **clustering compute** to C++. Visible markers are still rendered through `react-native-maps` `<Marker>` components, which becomes the UI-thread bottleneck with hundreds of annotations on screen at once.

The goal is a **native render layer**: the C++ engine feeds native bubble rendering directly in a single pass, behind the same `MapView` + `<Marker>` API, so you can render as many markers as you need without FPS collapse. Before that, near-term work stays within `react-native-maps`: image-based cluster bubbles with caching, stable marker pooling and smarter defaults.

Track progress in [GitHub Issues](https://github.com/gmi-software/react-native-better-clustering/issues).

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). Releases are published from CI — see [RELEASING.md](./RELEASING.md). Report vulnerabilities privately — see [SECURITY.md](./SECURITY.md).

```bash
bun install
bun run lint && bun run format:check
cd package && bun run typecheck && bun run test
```

The [documentation](https://gmi-software.github.io/react-native-better-clustering/docs/intro) is built with Docusaurus from [`docs/`](docs/): `bun run docs:start` to view it locally, `bun run docs:build` to build static files.

## License

MIT — see [LICENSE](./LICENSE).

---

<div align="center">

Built and maintained by [GMI Software](https://gmi.software/open-source). If it saves your map screen, a ⭐ helps other React Native developers find it.

</div>
