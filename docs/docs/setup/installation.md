---
id: installation
title: Platform Setup
sidebar_position: 1
---

# Platform Setup

## Install packages

```bash
npm install @gmisoftware/react-native-better-clustering react-native-nitro-modules
```

For map rendering (required):

```bash
npm install react-native-maps
cd ios && pod install
```

## New Architecture

This library is a Nitro module and requires React Native's **New Architecture**.
Confirm it is enabled and rebuild the native app.

## Expo

Use a [development build](https://docs.expo.dev/develop/development-builds/introduction/) — not Expo Go.

```bash
npx expo install @gmisoftware/react-native-better-clustering react-native-nitro-modules react-native-maps
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
