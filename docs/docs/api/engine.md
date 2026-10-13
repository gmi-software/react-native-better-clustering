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
} from 'react-native-better-clustering/engine'
import { packPoints } from 'react-native-better-clustering/utils'
```

For GeoJSON input and supercluster-compatible helpers, prefer
[`Supercluster`](./types.md#superclusteroptions) (used internally by
[`useClusterer`](./hooks.md)). Reach for `createClusterEngine()` only when you
need direct buffer control.

`createClusterEngine()`, `Supercluster.load()` and `Supercluster.loadAsync()`
throw if the native module is missing from the app binary; the error says how to
rebuild (see [Troubleshooting](../troubleshooting.md#the-native-clusterengine-module-is-not-available)).

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

`getClusters` reads the viewport as supercluster reads a bbox: across the
antimeridian, pass the longitudes unwrapped (`west: 170, east: 190`) or wrapped
(`west: 170, east: -170`); a span of 360° or more returns the whole world, with
each feature once.

`getClusterExpansionZoom(id)` returns the first zoom at which the cluster has
split into its children, whichever zoom you saw it at, so "zoom to the expansion
zoom on press" always reveals the children. It returns `maxZoom + 1` for a
cluster that never splits within the zoom range (points at the same
coordinate) and for a point id.

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

## Threading

`buildAsync()` builds on a background thread from the points and options the
engine has when you call it. Every method stays safe to call while a build is
pending:

- **Queries** read one complete index each. While a build is pending they
  answer from the current index, or throw if `isBuilt` is `false`; they never
  see a half-built one.
- **`setPoints` and `setOptions`** apply to the next build. They clear
  `isBuilt` as usual, and the pending build's index is discarded when it
  finishes: its promise still resolves, but `isBuilt` stays `false` until you
  build again.
- **Overlapping builds** (`buildAsync()` twice, or `build()` while
  `buildAsync()` is pending) each settle on their own. The first to finish
  publishes the index; a later one of the same points and options is dropped.
- **`dispose()`**, or dropping the last reference to the engine, is safe
  mid-build: the build keeps the native engine alive until it finishes.

```tsx
const pending = engine.buildAsync()
engine.setPoints(nextBuffer) // the pending build is now stale
await pending
engine.isBuilt // false: build again for nextBuffer
```

## Errors

Direct `ClusterEngine` callers get explicit failures instead of silent empty
results:

| Call | Condition | Result |
|------|-----------|--------|
| `setOptions` | an option outside its [valid values](./types.md#valid-values) | throws, naming the option; the previous options and index stay |
| `setPoints` | `null` / wrong layout | throws |
| `getClusters`, `getChildren`, `getLeaves`, `getClusterExpansionZoom` | `isBuilt === false` | throws |
| `getChildren`, `getLeaves`, `getClusterExpansionZoom` | `clusterId` is not a 32-bit integer (`NaN`, `Infinity`, `1.5`) | throws |
| `getLeaves` | fractional `limit` or `offset`, or `NaN` `offset` | throws |

Invalid buffers, invalid numbers and missing `build()` throw with messages
prefixed `ClusterEngine:`. Use `packPoints()` for buffers and check `isBuilt`
after reloads.

`getLeaves` reads a `limit` of `0`, a negative number, `Infinity` or `NaN` as no
limit, so supercluster's `getLeaves(id, Infinity)` returns every leaf. A
negative `offset` skips none. For an id that is a whole number but no node, such
as `-1`, `getChildren` and `getLeaves` return `[]`.

## Types

See [Types — Headless engine](./types.md#headless-engine-clusterengine) for
`ClusterEngine`, `ClusterEngineOptions`, `Viewport`, and `EngineClusterNode`.
