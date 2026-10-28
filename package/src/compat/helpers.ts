import React from 'react'
import type { BBox, PointFeature } from '../geojson/types'

/**
 * Whether a React child is a clusterable `react-native-maps` `Marker`.
 *
 * Returns `false` for non-elements and markers with `cluster={false}`.
 *
 * @see {@linkcode markerToGeoJSONFeature}
 */
export function isMarker(
  child: React.ReactNode
): child is React.ReactElement<MarkerLikeProps> {
  if (!React.isValidElement(child)) {
    return false
  }

  const props = child.props as MarkerLikeProps
  return props.coordinate != null && props.cluster !== false
}

interface MarkerLikeProps {
  coordinate: { latitude: number; longitude: number }
  cluster?: boolean
  children?: React.ReactNode
  [key: string]: unknown
}

/** Properties attached to each marker-derived {@linkcode PointFeature}. */
export type MarkerFeatureProperties = Record<string, unknown> & {
  point_count: 0
  index: number
}

/** The `Marker` element each marker-derived feature was created from. */
const markerElements = new WeakMap<
  PointFeature,
  React.ReactElement<MarkerLikeProps>
>()

/**
 * Converts a `Marker` child into a GeoJSON point for the cluster engine.
 *
 * Preserves marker props on `properties` and stores the child index for later
 * React reconciliation. Leaves out `coordinate`, `children`, and the props that
 * name cluster properties (`cluster`, `cluster_id`, `point_count_abbreviated`,
 * `getExpansionRegion`), so a marker such as `<Marker cluster>` is never
 * mistaken for a cluster by `isClusterFeature`.
 *
 * @see {@linkcode isMarker}
 */
export function markerToGeoJSONFeature(
  marker: React.ReactElement<MarkerLikeProps>,
  index: number
): PointFeature<MarkerFeatureProperties> {
  const {
    coordinate,
    children: _children,
    cluster: _cluster,
    cluster_id: _clusterId,
    point_count_abbreviated: _pointCountAbbreviated,
    getExpansionRegion: _getExpansionRegion,
    ...rest
  } = marker.props
  const properties: MarkerFeatureProperties = {
    ...rest,
    point_count: 0,
    index,
  }

  const feature: PointFeature<MarkerFeatureProperties> = {
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [coordinate.longitude, coordinate.latitude],
    },
    properties,
  }
  markerElements.set(feature, marker)
  return feature
}

/**
 * The `Marker` element a feature was created from by
 * {@linkcode markerToGeoJSONFeature}, or `undefined` for any other feature.
 *
 * Lets features from a previous children array render their own element
 * while the index for the current children is still building.
 */
export function markerElementOf(
  feature: PointFeature
): React.ReactElement<MarkerLikeProps> | undefined {
  return markerElements.get(feature)
}

/**
 * Top-level children past which {@linkcode flattenChildren} leaves them to a
 * single `Children.toArray` call: it flattens each one on its own, which costs
 * more the further along it is.
 */
const MAX_FLATTENED_ONE_BY_ONE = 64

/**
 * The nested child arrays {@linkcode flattenChildren} flattened for one map,
 * kept between renders. Create it with {@linkcode createChildrenCache}.
 */
export type ChildrenCache = WeakMap<
  readonly React.ReactNode[],
  {
    /** Where the array was among the top-level children. */
    position: number
    /** The children it held then. */
    source: React.ReactNode[]
    /** What `Children.toArray` made of them there. */
    nodes: React.ReactNode[]
  }
>

export function createChildrenCache(): ChildrenCache {
  return new WeakMap()
}

/** `child` at `position` of an otherwise empty array. */
function childAt(position: number, child: React.ReactNode): React.ReactNode[] {
  const holder = new Array<React.ReactNode>(position + 1)
  holder[position] = child
  return holder
}

function sameChildren(
  previous: readonly React.ReactNode[],
  next: readonly React.ReactNode[]
): boolean {
  if (previous.length !== next.length) {
    return false
  }
  for (let i = 0; i < next.length; i++) {
    if (previous[i] !== next[i]) {
      return false
    }
  }
  return true
}

/**
 * `runs` joined into one array: the only run itself, or else a copy. `concat`
 * copies 50k items many times faster than `flat` on Hermes.
 */
function concatRuns<T>(runs: T[][]): T[] {
  return runs.length === 1 ? runs[0]! : ([] as T[]).concat(...runs)
}

/**
 * The runs each array {@linkcode flattenChildren} returned was joined from, in
 * order. A nested array kept at its position is the same run on every render,
 * so {@linkcode splitMarkerChildren} can reuse what it made of it.
 */
const flattenedRuns = new WeakMap<
  readonly React.ReactNode[],
  React.ReactNode[][]
>()

/**
 * `Children.toArray(children)`, without cloning the elements of a nested
 * array again while it stays at the same position and holds the same
 * children, such as markers created once with `useMemo`.
 *
 * Each top-level child is flattened on its own, at its position in an
 * otherwise empty array, so React gives every element the key it would get
 * from flattening all of `children`.
 */
export function flattenChildren(
  children: React.ReactNode,
  cache: ChildrenCache
): React.ReactNode[] {
  if (!Array.isArray(children) || children.length > MAX_FLATTENED_ONE_BY_ONE) {
    return React.Children.toArray(children)
  }

  const parts: React.ReactNode[][] = []
  for (let position = 0; position < children.length; position++) {
    const child = children[position] as React.ReactNode
    if (!Array.isArray(child)) {
      parts.push(React.Children.toArray(childAt(position, child)))
      continue
    }
    const cached = cache.get(child)
    if (
      cached != null &&
      cached.position === position &&
      sameChildren(cached.source, child)
    ) {
      parts.push(cached.nodes)
      continue
    }
    const nodes = React.Children.toArray(childAt(position, child))
    cache.set(child, { position, source: child.slice(), nodes })
    parts.push(nodes)
  }
  const flattened = concatRuns(parts)
  flattenedRuns.set(flattened, parts)
  return flattened
}

/** What {@linkcode splitMarkerChildren} made of one run of children. */
interface SplitRun {
  /** The child index the run started at, which its points carry. */
  offset: number
  markerFeatures: PointFeature<MarkerFeatureProperties>[]
  otherChildren: React.ReactNode[]
}

/**
 * The points {@linkcode splitMarkerChildren} made for one map, kept between
 * renders. Create it with {@linkcode createMarkerFeatureCache}.
 */
export interface MarkerFeatureCache {
  /** The point made from each marker's props, and the key it had then. */
  points: WeakMap<
    object,
    { feature: PointFeature<MarkerFeatureProperties>; key: string | null }
  >
  /** What each run of children was split into, by the run's array. */
  runs: WeakMap<readonly React.ReactNode[], SplitRun>
  /** The runs the last call split, in order. */
  lastRuns: SplitRun[]
  /** The points the last call returned. */
  last: PointFeature<MarkerFeatureProperties>[]
}

export function createMarkerFeatureCache(): MarkerFeatureCache {
  return { points: new WeakMap(), runs: new WeakMap(), lastRuns: [], last: [] }
}

/** Splits one run of children that starts at child index `offset`. */
function splitRun(
  run: readonly React.ReactNode[],
  offset: number,
  points: MarkerFeatureCache['points']
): SplitRun {
  const markerFeatures: PointFeature<MarkerFeatureProperties>[] = []
  const otherChildren: React.ReactNode[] = []

  run.forEach((child, i) => {
    if (!isMarker(child)) {
      otherChildren.push(child)
      return
    }
    const index = offset + i
    const cached = points.get(child.props)
    let feature = cached?.feature
    if (
      feature == null ||
      feature.properties.index !== index ||
      cached!.key !== child.key
    ) {
      feature = markerToGeoJSONFeature(child, index)
      points.set(child.props, { feature, key: child.key })
    }
    markerFeatures.push(feature)
  })

  return { offset, markerFeatures, otherChildren }
}

/** Whether `split` holds the same points as `previous`, in the same order. */
function samePoints(split: SplitRun, previous: SplitRun | undefined): boolean {
  if (split === previous) {
    return true
  }
  if (
    previous == null ||
    split.markerFeatures.length !== previous.markerFeatures.length
  ) {
    return false
  }
  return split.markerFeatures.every(
    (feature, i) => feature === previous.markerFeatures[i]
  )
}

/**
 * Splits children, as `Children.toArray` returns them, into the GeoJSON
 * points of the clusterable markers and every other child.
 *
 * A re-render that changes a few markers converts only those: a marker keeps
 * its point while its props object, key and child index stay the same
 * (`Children.toArray` clones an element but keeps its props), and while every
 * point stays the same the previous list comes back, so the cluster index
 * sees no new data at all.
 *
 * Children that {@linkcode flattenChildren} returned are split one run at a
 * time, and a run that starts at the same child index as before keeps its
 * split without a visit to its markers: a live update that re-creates a few
 * markers next to a kept array of thousands walks only those few.
 */
export function splitMarkerChildren(
  children: React.ReactNode[],
  cache: MarkerFeatureCache
): {
  otherChildren: React.ReactNode[]
  markerFeatures: PointFeature<MarkerFeatureProperties>[]
} {
  const runs = flattenedRuns.get(children) ?? [children]
  const splits: SplitRun[] = []
  let unchanged = runs.length === cache.lastRuns.length
  let offset = 0

  runs.forEach((run, i) => {
    let split = cache.runs.get(run)
    if (split == null || split.offset !== offset) {
      split = splitRun(run, offset, cache.points)
      cache.runs.set(run, split)
    }
    unchanged &&= samePoints(split, cache.lastRuns[i])
    splits.push(split)
    offset += run.length
  })
  cache.lastRuns = splits

  const otherChildren = concatRuns(splits.map((split) => split.otherChildren))
  if (!unchanged) {
    cache.last = concatRuns(splits.map((split) => split.markerFeatures))
  }
  return { otherChildren, markerFeatures: cache.last }
}

/**
 * A copy of `items` ordered by `keyOf`, so markers that stay on screen keep
 * their order among the map's children whatever order the engine returns them
 * in.
 *
 * Fabric removes and re-inserts a child that changes place among its siblings,
 * and react-native-maps turns that into removing and re-adding the native
 * annotation: a marker whose relative order changes blinks out for a frame or
 * more. The engine's order changes with the zoom, so on every zoom step most
 * markers that stayed would blink at once.
 */
export function sortByKey<T>(
  items: ReadonlyArray<T>,
  keyOf: (item: T) => string
): T[] {
  return items
    .map((item) => ({ item, key: keyOf(item) }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map(({ item }) => item)
}

/** The React key of a rendered child, for {@linkcode sortByKey}. */
export function elementKey(node: React.ReactNode): string {
  return React.isValidElement(node) && node.key != null ? node.key : ''
}

/**
 * Coordinates for `fitToCoordinates` that fit `bbox`: its corners with its
 * centre between them. Google Maps grows the fitted box point by point, each
 * time the shorter way round the globe, so the corners alone would fit the
 * other side of the world for a box wider than 180° of longitude.
 */
export function bboxToFitCoordinates([west, south, east, north]: BBox): Array<{
  latitude: number
  longitude: number
}> {
  return [
    { latitude: south, longitude: west },
    { latitude: (south + north) / 2, longitude: (west + east) / 2 },
    { latitude: north, longitude: east },
  ]
}
