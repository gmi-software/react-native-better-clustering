---
id: engine
title: Headless engine
sidebar_position: 5
---

# Headless engine (advanced)

Use the low-level C++ `ClusterEngine` when you own map rendering and only need
cluster computation — for example a custom map SDK or server-side viewport
queries in a native module.

Import from `/engine`:

```tsx
import {
  createClusterEngine,
  bboxToViewport,
  DEFAULT_SUPERCLUSTER_OPTIONS,
} from '@gmisoftware/react-native-better-clustering/engine'
import { packPoints } from '@gmisoftware/react-native-better-clustering/utils'
```

For GeoJSON input and supercluster-compatible helpers, prefer
[`Supercluster`](./types.md#superclusteroptions) (used internally by
[`useClusterer`](./hooks.md)). Reach for `createClusterEngine()` only when you
need direct buffer control.

## Lifecycle

Call methods in this order:

1. **`setOptions`** — radius, zoom range, reducers, tile extent, etc.
2. **`setPoints`** — binary buffer from `packPoints()` (`/utils` export; must match options).
3. **`build()`** or **`buildAsync()`** — build the spatial index.
4. **Query** — `getClusters`, `getChildren`, `getLeaves`, `getClusterExpansionZoom`.

`setOptions` or `setPoints` clears the index. After either call, `isBuilt` is
`false` until you run `build()` again.

```tsx
const engine = createClusterEngine()

engine.setOptions({
  radius: 40,
  minPoints: 2,
  minZoom: 1,
  maxZoom: 20,
  extent: 512,
  nodeSize: 64,
  reducers: [],
})

const { buffer } = packPoints([
  { latitude: 52.23, longitude: 21.01 },
  { latitude: 52.24, longitude: 21.02 },
])

engine.setPoints(buffer)

if (!engine.isBuilt) {
  await engine.buildAsync() // or engine.build() for small datasets
}

const viewport = bboxToViewport([-180, -90, 180, 90], 10)
const clusters = engine.getClusters(viewport)
```

Always guard queries with `isBuilt` when options or points can change between
renders:

```tsx
function queryClusters(engine: ClusterEngine, viewport: Viewport) {
  if (!engine.isBuilt) {
    return []
  }
  return engine.getClusters(viewport)
}
```

## Errors

Direct `ClusterEngine` callers get explicit failures instead of silent empty
results:

| Call | Condition | Result |
|------|-----------|--------|
| `setPoints` | `null` / wrong layout | throws |
| `getClusters`, `getChildren`, `getLeaves`, `getClusterExpansionZoom` | `isBuilt === false` | throws |

Invalid buffers and missing `build()` throw with messages prefixed
`ClusterEngine:`. Use `packPoints()` for buffers and check `isBuilt` after
reloads.

## Types

See [Types — Headless engine](./types.md#headless-engine-clusterengine) for
`ClusterEngine`, `ClusterEngineOptions`, `Viewport`, and `EngineClusterNode`.
