<img width="1024" height="321" alt="react-native-better-clustering" src="./docs/static/img/readme-banner.png" />

<div align="center">

A drop-in replacement for **[react-native-map-clustering](https://github.com/tomekvenits/react-native-map-clustering)** — same API, same `react-native-maps` workflow, but clustering runs in **C++ via Nitro** instead of supercluster in JavaScript.

[![npm version](https://img.shields.io/npm/v/react-native-better-clustering.svg)](https://www.npmjs.com/package/react-native-better-clustering)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue.svg)](https://www.typescriptlang.org/)
[![Expo Compatible](https://img.shields.io/badge/Expo-Compatible-000020.svg)](https://expo.dev/)
[![CI](https://github.com/gmi-software/react-native-better-clustering/actions/workflows/ci.yml/badge.svg)](https://github.com/gmi-software/react-native-better-clustering/actions/workflows/ci.yml)

Built with [Nitro Modules](https://nitro.margelo.com/) for native clustering.

[Migration](#migration) • [Installation](#installation) • [Usage](#usage) • [Documentation](https://gmi-software.github.io/react-native-better-clustering/docs/intro) • [Example app](./example)

**Full documentation** is available at [gmi-software.github.io/react-native-better-clustering](https://gmi-software.github.io/react-native-better-clustering/docs/intro). The Docusaurus source lives in **[`docs/`](docs/)**; run `bun run docs:start` to view it locally, or `bun run docs:build` to build static files.

</div>

<div align="center">
  <img src="./docs/static/img/demo.gif" alt="Clustering demo — pan and zoom with 2,000 markers" width="360" />
</div>

---

## Migration

```diff
- import MapView from 'react-native-map-clustering'
+ import MapView from 'react-native-better-clustering'
  import { Marker } from 'react-native-maps'
```

That is it. Your `<Marker>` children, cluster props, and `react-native-maps` options carry over — the cluster index is now built in C++ on a background thread instead of in JavaScript on the JS thread. A few defaults and behaviours differ, such as the default cluster color and how `style` is applied: see [Migrating from react-native-map-clustering](https://gmi-software.github.io/react-native-better-clustering/docs/migration).

Coming from react-native-map-clustering **3.x**? `onRegionChangeComplete` receives `(region, details, markers)`, as in 4.x, not `(region, markers)`: take the markers from the third argument. Development builds warn once about a handler that declares two parameters. See [Coming from 3.x](https://gmi-software.github.io/react-native-better-clustering/docs/migration#coming-from-react-native-map-clustering-3x).

## Why switch?


|                | react-native-map-clustering         | This package                               |
| -------------- | ----------------------------------- | ------------------------------------------ |
| API            | `MapView` + `<Marker>` children     | **Same**                                   |
| Map            | `react-native-maps`                 | `react-native-maps`                        |
| Engine         | JS supercluster                     | **C++ supercluster via Nitro**             |
| Index build    | JavaScript, on the JS thread        | **C++, on a background thread**            |
| Viewport query | JavaScript, on the JS thread        | C++, a synchronous call from the JS thread |
| Markers        | One `<Marker>` per cluster or point | Same, see [Roadmap](#roadmap)              |


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
| `react-native-reanimated`    | `^4.1.0`   | Optional; fades and glides the cluster bubbles on zoom |

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
      [
        "react-native-maps",
        { "androidGoogleMapsApiKey": "YOUR_GOOGLE_MAPS_API_KEY" }
      ]
    ]
  }
}
```

Without `androidGoogleMapsApiKey`, Android apps crash when a map mounts. iOS uses Apple Maps; add `iosGoogleMapsApiKey` only if you render with `provider={PROVIDER_GOOGLE}`. The plugin needs `react-native-maps` 1.22.0 or newer (Expo SDK 55+); on SDK 53 and 54, set the key without it as described in [Platform Setup](https://gmi-software.github.io/react-native-better-clustering/docs/setup/installation#expo).

```bash
npx expo prebuild --clean
npx expo run:ios   # or: npx expo run:android
```

### Optional: animated cluster bubbles

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

## Roadmap

Today this library moves **clustering compute** to C++: `MapView` builds the index on a background thread, and each viewport query is a synchronous native call from the JS thread. Visible markers are still rendered through `react-native-maps` `<Marker>` components, which becomes the UI-thread bottleneck when hundreds of annotations are on screen at once. See the [performance model](https://gmi-software.github.io/react-native-better-clustering/docs/performance).

The long-term goal is to remove that ceiling entirely.

### Tier 1 — `react-native-maps` rendering optimizations (near term)

Improvements within the current drop-in API: image-based cluster bubbles with caching, stable marker pooling, and smarter defaults. Still bounded by per-annotation overhead from `react-native-maps`.

### Tier 2 — Native render layer (**the goal**, months)

A **native clustered map view** that draws annotations in a single native pass instead of mounting one React `<Marker>` per cluster or point. The existing C++ `ClusterEngine` feeds packed point data directly into native bubble rendering — same public `MapView` + `<Marker>` API, no N-marker mount storm on zoom.

Tier 2 is the reason this library exists beyond a native supercluster port: **render as many markers as you need without FPS collapse.** The compat API stays unchanged; rendering moves under the hood.

Track progress in [GitHub Issues](https://github.com/gmi-software/react-native-better-clustering/issues).

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

## Common problems


| Problem                  | Solution                                                                                                                                |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| Map is blank on Android  | Add a Google Maps API key. See [platform setup](https://gmi-software.github.io/react-native-better-clustering/docs/setup/installation). |
| New Architecture errors  | Confirm New Architecture is enabled and rebuild.                                                                                        |
| Does not work in Expo Go | Use a [development build](https://docs.expo.dev/develop/development-builds/introduction/).                                              |
| `native ClusterEngine module is not available` | Rebuild the native app after installing (`pod install` / `npx expo prebuild --clean`). See [troubleshooting](https://gmi-software.github.io/react-native-better-clustering/docs/troubleshooting#the-native-clusterengine-module-is-not-available). |
| Markers flicker on zoom  | Give each `Marker` a stable `key` (not the array index); memoize marker components.                                                     |


More in [troubleshooting](https://gmi-software.github.io/react-native-better-clustering/docs/troubleshooting).

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). Releases are published from CI — see [RELEASING.md](./RELEASING.md). Report vulnerabilities privately — see [SECURITY.md](./SECURITY.md).

```bash
bun install
bun run lint && bun run format:check
cd package && bun run typecheck && bun run test
```

## License

MIT — see [LICENSE](./LICENSE).