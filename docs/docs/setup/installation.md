---
id: installation
title: Platform Setup
sidebar_position: 1
---

# Platform Setup

## Install packages

```bash
npm install react-native-better-clustering react-native-nitro-modules react-native-maps
cd ios && pod install
```

| Peer dependency | Version | |
|-----------------|---------|---|
| `react-native-maps` | `>=1.20.1` | Required |
| `react-native-nitro-modules` | `>=0.32.0` | Required |
| `react-native-reanimated` | `^4.1.0` | Optional, see [Reanimated](#reanimated-optional) |

`react-native-nitro-modules` is declared as an *optional* peer dependency, as
Nitro recommends for libraries, so package managers never install it on their
own: the app picks the Nitro version. Install it yourself, at 0.32.0 or newer.
The native build fails on older versions (see
[Troubleshooting](../troubleshooting.md#nitro-version)).

### Reanimated (optional)

With [Reanimated](https://docs.swmansion.com/react-native-reanimated/)
installed, the default cluster bubbles cross-fade on zoom, and a splitting
cluster's parts glide out of it while merging clusters glide into one, all
animated on the UI thread (see [`clusterFadeInDuration`](../api/mapview.md)). Install it by
following Reanimated's own
[installation guide](https://docs.swmansion.com/react-native-reanimated/docs/fundamentals/getting-started/):
it needs `react-native-worklets` and, in bare React Native, the Worklets Babel
plugin.

Without Reanimated, clusters still render: bubbles appear and disappear without
a fade or glide, and development builds log a one-time notice. Pass
`clusterFadeInDuration={0}` to opt out of the fade and the notice.

## New Architecture

This library is a Nitro module and requires React Native's **New Architecture**.
Confirm it is enabled and rebuild the native app.

## Expo

Use a [development build](https://docs.expo.dev/develop/development-builds/introduction/), not Expo Go.

```bash
npx expo install react-native-better-clustering react-native-nitro-modules react-native-maps
```

For the [cluster fade](#reanimated-optional), add Reanimated as well;
`babel-preset-expo` configures its Babel plugin:

```bash
npx expo install react-native-reanimated react-native-worklets
```

Add the `react-native-maps` config plugin to `app.json`:

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

The plugin reads `androidGoogleMapsApiKey`, not `googleMapsApiKey`: without it,
Android apps crash with "API key not found" when a map mounts. iOS uses Apple
Maps and needs no key, unless you render with `provider={PROVIDER_GOOGLE}`;
then add `iosGoogleMapsApiKey` too.

The plugin ships with `react-native-maps` 1.22.0 and newer, which Expo SDK 55
and later install. Expo SDK 53 and 54 install 1.20.1, which has no plugin, and
`expo prebuild` stops with a `PluginError` saying `react-native-maps` has no
valid config plugin. On those SDKs, leave `react-native-maps` out of `plugins`
and set `expo.android.config.googleMaps.apiKey` instead (and
`expo.ios.config.googleMapsApiKey` for Google Maps on iOS).

Then regenerate native projects:

```bash
npx expo prebuild --clean
```

## Android Google Maps key (bare RN)

If not using Expo, add your API key to `AndroidManifest.xml`:

```xml
<meta-data
  android:name="com.google.android.geo.API_KEY"
  android:value="YOUR_GOOGLE_MAPS_API_KEY"/>
```
