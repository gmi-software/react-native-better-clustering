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

## `NitroModules cannot be found!` {#nitro-version}

The native build stops with one or both of:

```
react-native-better-clustering needs react-native-nitro-modules 0.32.0 or newer.
Upgrade it, then reinstall pods (iOS) or rebuild (Android).
```

```
NitroModules cannot be found! Are you sure you installed NitroModules properly?
```

The library's generated Nitro bindings need `react-native-nitro-modules` 0.32.0
or newer. Against an older Nitro they fail with the second message even though
Nitro is installed; the first one, from the library's own code, names the cause.

- **Nitro is older than 0.32.0:** upgrade it, then rebuild (`cd ios && pod
  install` in bare React Native, `npx expo prebuild --clean` with Expo).
- **Nitro is not in your `package.json`:** install it. It is a peer dependency
  that package managers do not install for you, so the app decides which Nitro
  version it runs.

## Android Gradle Plugin 9: built-in Kotlin or the new DSL

With Android Gradle Plugin 9, the Android build fails with an error about the
Kotlin Gradle plugin (`Cannot add extension with name 'kotlin'`), or about
`libraryVariants` / `applicationVariants`, once an app turns on AGP 9's
built-in Kotlin or its new DSL. The React Native 0.87 and 0.88 app templates
and `react-native-nitro-modules` (0.37.1 and earlier) still apply the Kotlin
plugin themselves, so keep the opt-outs those templates set in
`android/gradle.properties`:

```properties
android.builtInKotlin=false
android.newDsl=false
```

## The native ClusterEngine module is not available

```
react-native-better-clustering: the native ClusterEngine module is not
available. Rebuild the app after installing the library (`pod install` on iOS,
a Gradle build on Android, or `npx expo prebuild` and a development build with
Expo); Expo Go is not supported. Cause: …
```

The JavaScript side is installed but the app binary does not contain the native
engine. Rebuild the native app after installing or upgrading the library:

- **Bare React Native:** `cd ios && pod install`, then rebuild both platforms.
- **Expo:** `npx expo prebuild --clean`, then build a development build. Expo Go
  cannot load it.

`MapView`, `Clusterer` and `useClusterer` throw this error during render, so an
error boundary (and LogBox in development) shows it. To handle it yourself
instead, pass `onError`; the map then renders without the clustered markers.

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

Give every `Marker` a stable `key` (its id, not its array index). `MapView`
keeps that key, so adding or removing a marker doesn't remount the others, and
it keys each cluster bubble by its first marker's key, so a cluster that splits
or merges on zoom, or survives a data update, keeps its native marker instead
of being removed and re-added. Memoize custom marker components too.

With `/hooks`, use `stabilizeClusterFeatures` and key your markers by a stable
point `id`.

## Zooming stutters with many markers

The default `radius` matches react-native-map-clustering, so a drop-in swap
draws the same clusters. With the default `extent: 512` it clusters markers
that are about 12–24 pt apart on screen, while a default cluster bubble is
32–56 pt wide. Dense data therefore covers the map with overlapping bubbles,
and every zoom step mounts hundreds of new native markers, which stalls the
map.

Pass a larger `radius`, about twice the default: roughly 12% of the map width,
which is around 50 on a phone:

```tsx
<MapView radius={Dimensions.get('window').width * 0.12}>{markers}</MapView>
```

In the example app's 50,000-marker scenario on an iOS simulator, doubling the
radius cut the bubbles on screen by about two thirds and made the longest frame
during a pinch about four times shorter. Each cluster then covers a larger
area, so pressing one zooms in less.

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
