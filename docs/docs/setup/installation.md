---
id: installation
title: Platform Setup
sidebar_position: 1
---

# Platform Setup

## Install packages

```bash
npm install react-native-better-clustering react-native-nitro-modules
```

For map rendering (required):

```bash
npm install react-native-maps
cd ios && pod install
```

### Reanimated (required)

Cluster bubbles fade in on zoom using [Reanimated](https://docs.swmansion.com/react-native-reanimated/),
which runs the animation on the UI thread:

```bash
npm install react-native-reanimated react-native-worklets
cd ios && pod install
```

In **bare React Native**, add the Worklets Babel plugin (must be last) to `babel.config.js`:

```js
module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: ['react-native-worklets/plugin'],
}
```

With **Expo**, `babel-preset-expo` adds this plugin automatically — no Babel changes needed.

## New Architecture

This library is a Nitro module and requires React Native's **New Architecture**.
Confirm it is enabled and rebuild the native app.

## Expo

Use a [development build](https://docs.expo.dev/develop/development-builds/introduction/) — not Expo Go.

```bash
npx expo install react-native-better-clustering react-native-nitro-modules react-native-maps react-native-reanimated react-native-worklets
```

Add the `react-native-maps` config plugin to `app.json`:

```json
{
  "expo": {
    "plugins": [
      ["react-native-maps", { "googleMapsApiKey": "YOUR_GOOGLE_MAPS_API_KEY" }]
    ]
  }
}
```

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
