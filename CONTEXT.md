# Nitro Map Cluster — Glossary

## Point / Marker
A single geographic location (e.g. parcel locker) with `id`, `latitude`, `longitude`, and optional `data`.

## Cluster
An aggregation of nearby points at a given zoom level. The library computes clusters; **you render them** on your map (e.g. `react-native-maps` `<Marker>`).

## Cluster bubble
The visual badge representing a cluster on the map — **rendered by the app**, not by this library.

## Cluster radius
Pixel distance within which points are grouped into a cluster.

## minPoints
Minimum number of points required to form a cluster.

## Parent-child mapping
Relationship between a cluster (parent) and its points/sub-clusters (children) across zoom levels. Enables stable identity when recomputing visible clusters on pan/zoom.
