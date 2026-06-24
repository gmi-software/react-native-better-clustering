# ADR 0001: Single MapView entry point

- **Status:** Accepted
- **Date:** 2026-06-23

## Context

The library wraps a C++ supercluster engine (via Nitro) for React Native map
clustering. Multiple API surfaces were available during development:

1. **`useClusterer` hook** — compute clusters, developer renders markers
2. **`./compat` MapView** — drop-in replacement for `react-native-map-clustering`
3. **Headless `createClusterEngine()`** — low-level C++ access
4. **`<Clusterer>` component** — thin wrapper around `useClusterer`

The target audience is developers migrating from
[react-native-map-clustering](https://github.com/tomekvenits/react-native-map-clustering),
which exposes a single `MapView` with `<Marker>` children.

## Decision

The **root package export is the clustered `MapView`** (formerly `./compat`):

```tsx
import MapView from '@gmisoftware/react-native-better-clustering'
import { Marker } from 'react-native-maps'
```

Advanced APIs remain on subpaths (`/hooks`, `/engine`, `/geojson`, `/utils`).
The `/compat` subpath is kept as a backwards-compatible alias.
The `/clusterer` subpath remains exported but is not documented.

## Alternatives considered

### Hooks-first (root exports `useClusterer`)

- **Pros:** Maximum flexibility; aligns with `react-native-clusterer`.
- **Cons:** Requires boilerplate (map dimensions, region state, marker rendering).
  Poor migration story from `react-native-map-clustering`.

### Multi-entry with no default

- **Pros:** No opinion on usage pattern.
- **Cons:** Confusing for new users; README would need multiple "getting started"
  paths; worse DX for the primary use case.

### Keep three equal options in docs

- **Pros:** Documents all capabilities upfront.
- **Cons:** Decision fatigue; obscures the one-line migration path.

## Consequences

### Positive

- One-line migration from `react-native-map-clustering`.
- README and docs have a single getting-started path.
- Example app demonstrates the same API developers will use in production.

### Negative

- Developers who only need cluster computation must discover `/hooks` in docs.
- Root export pulls in `react-native-maps` types via the compat layer's import
  graph (acceptable — maps is a required peer for the main API).
- Breaking change for any early adopters who imported `useClusterer` from root
  (none shipped to npm at time of decision).

## References

- [README](../../README.md) — migration diff and props table
- [docs/docs/api/mapview.md](../docs/api/mapview.md) — MapView reference
- [docs/docs/api/hooks.md](../docs/api/hooks.md) — advanced hooks
