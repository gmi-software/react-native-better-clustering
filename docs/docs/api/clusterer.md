---
id: clusterer
title: Clusterer component
sidebar_position: 2
---

# Clusterer component (advanced)

Use when you prefer a declarative component over
[`useClusterer`](./hooks.md) but still render your own map.

Import from `/clusterer`:

```tsx
import { Clusterer } from 'react-native-better-clustering/clusterer'
```

## `Clusterer`

Maps visible clustered features to React elements via `renderItem`.

```tsx
<Clusterer
  data={geoJsonPoints}
  region={region}
  mapDimensions={{ width: mapWidth, height: mapHeight }}
  options={{ radius: 40, minPoints: 2, maxZoom: 20 }}
  renderItem={(feature) => (
    <MyMarker key={featureKey(feature)} feature={feature} />
  )}
/>
```

| Prop | Type | Description |
|------|------|-------------|
| `data` | `PointFeature[]` | Points to cluster (memoize with `useMemo`) |
| `region` | `MapRegion` | Current map region |
| `mapDimensions` | `{ width, height }` | Map size in pixels |
| `options` | `SuperclusterOptions` | Optional clustering options |
| `renderItem` | `(feature) => ReactElement` | Render each visible point or cluster |

Thin adapter over `useClusterer` — same lifecycle, defaults, and performance
notes apply. For full control, use the hook directly.
