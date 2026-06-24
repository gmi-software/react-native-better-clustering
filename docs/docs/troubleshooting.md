---
id: troubleshooting
title: Troubleshooting
sidebar_position: 3
---

# Troubleshooting

## The map is blank on Android

Configure a **Google Maps API key** for `react-native-maps` (Expo plugin or
`AndroidManifest.xml`). Ensure the key has "Maps SDK for Android" enabled.

## "New Architecture" errors

This library is a Nitro module and requires React Native's New Architecture.
Confirm it is enabled and rebuild the native app.

## It doesn't work in Expo Go

Correct — native modules require a
[development build](https://docs.expo.dev/develop/development-builds/introduction/).
Run `npx expo prebuild --clean` and build the app.

## `Supercluster instance was destroyed`

You called a method on a `Supercluster` after `destroy()`. Create a new
instance. `useClusterer` handles lifecycle automatically.

## Clusters rebuild every render

Memoize your GeoJSON input:

```tsx
const geoJson = useMemo(
  () =>
    points.map((point) =>
      coordsToGeoJSONFeature(
        { latitude: point.latitude, longitude: point.longitude },
        { id: point.id }
      )
    ),
  [points]
)
```

## Markers flicker on zoom

Use `stabilizeClusterFeatures` from `/hooks`, memoize marker components, and
ensure each point has a stable `id`.
