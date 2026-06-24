---
id: quick-start
title: Quick Start
sidebar_position: 2
---

# Quick Start

## Requirements

- React Native **0.78+** with the **New Architecture** enabled.
- `react-native-nitro-modules` (required).
- `react-native-maps` (required).

## Install

```bash
npm install @gmisoftware/react-native-better-clustering react-native-nitro-modules react-native-maps
cd ios && pod install
```

Expo requires a [development build](https://docs.expo.dev/develop/development-builds/introduction/):

```bash
npx expo install @gmisoftware/react-native-better-clustering react-native-nitro-modules react-native-maps
```

See [Platform Setup](./setup/installation.md) for `react-native-maps` plugin config.

## Clustered map

```tsx
import MapView from '@gmisoftware/react-native-better-clustering'
import { Marker } from 'react-native-maps'

const points = [
  { id: '1', latitude: 52.23, longitude: 21.01 },
  { id: '2', latitude: 52.24, longitude: 21.02 },
]

export function MapScreen() {
  return (
    <MapView
      style={{ flex: 1 }}
      initialRegion={{
        latitude: 52.0,
        longitude: 19.0,
        latitudeDelta: 8,
        longitudeDelta: 8,
      }}
      radius={50}
      minPoints={2}
      clusterColor="#0F52FF"
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
  )
}
```

## Migrating from react-native-map-clustering

Change one import — props and `<Marker>` children stay the same:

```diff
- import MapView from 'react-native-map-clustering'
+ import MapView from '@gmisoftware/react-native-better-clustering'
```

## Custom map stack

If you render your own `react-native-maps` `MapView` and only need cluster
computation, use `useClusterer` from `/hooks`:

```tsx
import { useMemo, useState } from 'react'
import MapView, { Marker } from 'react-native-maps'
import { useClusterer } from '@gmisoftware/react-native-better-clustering/hooks'
import {
  coordsToGeoJSONFeature,
  isClusterFeature,
} from '@gmisoftware/react-native-better-clustering/geojson'
```

See [Hooks API](./api/hooks.md).
