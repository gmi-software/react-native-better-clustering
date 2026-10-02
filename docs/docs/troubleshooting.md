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
instance. `useClusterer` handles lifecycle automatically, but it destroys the
previous engine once a rebuild for changed data has loaded: use the
`supercluster` from the latest render rather than one kept from earlier.

## Clusters rebuild every render

The index rebuilds only when coordinates, their order, or a `clusterProperties`
source value change. If it still rebuilds on every render, the data itself
changes: for example, coordinates recomputed with floating-point noise, or a
list re-sorted on each render. Memoize your GeoJSON input:

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

## Some markers never appear on the map

Points whose `latitude` or `longitude` is not a finite number — `undefined`,
`null`, or `NaN` — cannot be projected, so they are skipped when the index is
built. This is common with data straight from an API, where a missing field
turns into `undefined`.

In development the library warns once per load with the count and the first few
offending indices:

```
react-native-better-clustering: skipped 2 of 480 points with non-finite
coordinates (index 17, 291). Check those points for undefined, null, or NaN
latitude/longitude — they will not appear on the map.
```

Filter or repair those points before loading them:

```tsx
const usablePoints = useMemo(
  () =>
    points.filter(
      (point) =>
        Number.isFinite(point.latitude) && Number.isFinite(point.longitude)
    ),
  [points]
)
```

Out-of-range values behave differently: a latitude beyond ±85.05 or a longitude
beyond ±180 is **clamped** to the Web Mercator limits rather than skipped, so
such a marker still renders — just at the edge of the projection.
