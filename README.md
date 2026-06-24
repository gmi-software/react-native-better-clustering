<img width="1024" height="321" alt="react-native-better-clustering" src="./docs/static/img/readme-banner.png" />

<div align="center">

A faster **[react-native-map-clustering](https://github.com/tomekvenits/react-native-map-clustering)** — same API, same `react-native-maps` workflow, but clustering runs in **C++ via Nitro** instead of JavaScript on the RN bridge.

[![npm version](https://img.shields.io/npm/v/@gmisoftware/react-native-better-clustering.svg)](https://www.npmjs.com/package/@gmisoftware/react-native-better-clustering)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue.svg)](https://www.typescriptlang.org/)
[![Expo Compatible](https://img.shields.io/badge/Expo-Compatible-000020.svg)](https://expo.dev/)
[![CI](https://github.com/gmi-software/react-native-better-clustering/actions/workflows/ci.yml/badge.svg)](https://github.com/gmi-software/react-native-better-clustering/actions/workflows/ci.yml)

Built with [Nitro Modules](https://nitro.margelo.com/) for high-performance native clustering.

[Migration](#migration) • [Installation](#installation) • [Usage](#usage) • [Documentation](https://gmi-software.github.io/react-native-better-clustering/docs/intro) • [Example app](./example)

**Full documentation** is available at [gmi-software.github.io/react-native-better-clustering](https://gmi-software.github.io/react-native-better-clustering/docs/intro). The Docusaurus source lives in **[`docs/`](docs/)**; run `bun run docs:start` to view it locally, or `bun run docs:build` to build static files.

</div>

---

## Migration

```diff
- import MapView from 'react-native-map-clustering'
+ import MapView from '@gmisoftware/react-native-better-clustering'
  import { Marker } from 'react-native-maps'
```

That is it. Your `<Marker>` children, cluster props, and `react-native-maps` options keep working — clustering just moves off the JS thread.

## Why switch?


|        | react-native-map-clustering     | This package                        |
| ------ | ------------------------------- | ----------------------------------- |
| API    | `MapView` + `<Marker>` children | **Same**                            |
| Map    | `react-native-maps`             | `react-native-maps`                 |
| Engine | JS supercluster                 | **C++ supercluster via Nitro**      |
| Scale  | Good                            | **10k+ points without bridge jank** |


## Supported platforms

- [x] iOS
- [x] Android
- [ ] Web

> [!NOTE]
> Requires React Native **0.78+** with the **New Architecture**. Does not work in Expo Go — use a [development build](https://docs.expo.dev/develop/development-builds/introduction/).

## Installation

### Bare React Native

```bash
npm install @gmisoftware/react-native-better-clustering react-native-nitro-modules react-native-maps react-native-reanimated react-native-worklets
cd ios && pod install && cd ..
```

Rebuild the native app after installing. Add the Worklets Babel plugin (last in the list) to `babel.config.js`:

```js
plugins: ['react-native-worklets/plugin']
```

### Expo

```bash
npx expo install @gmisoftware/react-native-better-clustering react-native-nitro-modules react-native-maps react-native-reanimated react-native-worklets
```

`babel-preset-expo` wires up the Worklets plugin automatically.

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
import MapView from '@gmisoftware/react-native-better-clustering'
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
} from '@gmisoftware/react-native-better-clustering'
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
| `spiralEnabled`                | `true`                | Spider layout at max zoom         |
| `spiderLineColor`              | `#FF0000`             | Color of spider connector lines   |
| `clusterColor`                 | `#0F52FF`             | Default cluster bubble color (GMI brand blue) |
| `clusterTextColor`             | `#FFFFFF`             | Default cluster label color       |
| `animationEnabled`             | `true`                | Animate cluster changes (iOS)     |
| `onClusterPress`               | —                     | `(cluster, markers) => void`      |
| `renderCluster`                | —                     | Custom cluster renderer           |
| `preserveClusterPressBehavior` | `false`               | Skip auto `fitToCoordinates`      |
| `superClusterRef`              | —                     | Access the underlying engine      |
| `width` / `height`             | window size           | Seed map dimensions before layout |
| `clusterUpdateIntervalMs`      | `100`                 | Min interval (ms) between cluster updates while moving; `0` = only on settle |


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

Today this library solves **clustering compute** — the C++ engine indexes 10k+ points and returns viewport clusters off the JS thread. Visible markers are still rendered through `react-native-maps` `<Marker>` components, which becomes the UI-thread bottleneck when hundreds of annotations are on screen at once.

The long-term goal is to remove that ceiling entirely.

### Tier 1 — `react-native-maps` rendering optimizations (near term)

Improvements within the current drop-in API: image-based cluster bubbles with caching, stable marker pooling, and smarter defaults. Expected to roughly **3–5×** improve FPS at mid zoom levels, but still bounded by per-annotation overhead from `react-native-maps`.

### Tier 2 — Native render layer (**the goal**, months)

A **native clustered map view** that draws annotations in a single native pass instead of mounting one React `<Marker>` per cluster or point. The existing C++ `ClusterEngine` feeds packed point data directly into native bubble rendering — same public `MapView` + `<Marker>` API, no N-marker mount storm on zoom.

| Approach | Typical visible markers @ ~60 FPS |
| -------- | --------------------------------- |
| View-child `<Marker>` (today) | ~50–150 |
| Image `<Marker>` + pooling (Tier 1) | ~200–400 |
| Native clustered map view (Tier 2) | **1000+** |

Tier 2 is the reason this library exists beyond a faster supercluster port: **render as many markers as you need without FPS collapse.** The compat API stays unchanged; rendering moves under the hood.

Track progress in [GitHub Issues](https://github.com/gmi-software/react-native-better-clustering/issues).

## Example app

A minimal full-screen map with ~2,000 randomly scattered markers across Poland — default green cluster bubbles and standard map pins, modeled on the [react-native-map-clustering demo](https://github.com/tomekvenits/react-native-map-clustering).

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
| `@gmisoftware/react-native-better-clustering/hooks`     | `useClusterer` — you own the `MapView`                  |
| `@gmisoftware/react-native-better-clustering/clusterer` | `Clusterer` — declarative `renderItem` over `useClusterer` |
| `@gmisoftware/react-native-better-clustering/engine`    | `Supercluster`, `createClusterEngine`, geometry helpers — see [headless lifecycle](https://gmi-software.github.io/react-native-better-clustering/docs/api/engine) |
| `@gmisoftware/react-native-better-clustering/geojson` | GeoJSON types and conversion                            |
| `@gmisoftware/react-native-better-clustering/utils`   | `packPoints`, distance helpers                          |


See the [docs](https://gmi-software.github.io/react-native-better-clustering/docs/intro) for details. The `/compat` subpath is an alias of the main export.

## Common problems


| Problem                  | Solution                                                                                                                                |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| Map is blank on Android  | Add a Google Maps API key. See [platform setup](https://gmi-software.github.io/react-native-better-clustering/docs/setup/installation). |
| New Architecture errors  | Confirm New Architecture is enabled and rebuild.                                                                                        |
| Does not work in Expo Go | Use a [development build](https://docs.expo.dev/develop/development-builds/introduction/).                                              |
| Markers flicker on zoom  | Memoize marker components; give each point a stable `id`.                                                                               |


More in [troubleshooting](https://gmi-software.github.io/react-native-better-clustering/docs/troubleshooting).

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

```bash
bun install
cd package && bun run typecheck && bun run lint && bun run test
```

## License

MIT — see [LICENSE](./LICENSE).