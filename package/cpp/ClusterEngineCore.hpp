#pragma once

// Ports the clustering pass of supercluster
// (https://github.com/mapbox/supercluster, ISC, Copyright (c) Mapbox) and the
// KD-tree of kdbush
// (https://github.com/mourner/kdbush, ISC, Copyright (c) Vladimir Agafonkin).
// Their license notices are in THIRD_PARTY_NOTICES.md.

#include "GeoUtils.hpp"
#include "InputValidation.hpp"
#include <vector>
#include <cstdint>
#include <cstring>
#include <algorithm>
#include <cmath>
#include <limits>
#include <optional>
#include <utility>

namespace margelo::nitro::nitromapcluster {

// Static KD-tree over 2D points, kdbush-style: a flat array of items is
// recursively partitioned in place on alternating axes. Query and build mirror
// each other exactly — same pivot `(left+right)/2`, same alternating axis —
// which is what makes range/within correct. Each item carries its coordinates,
// so a query reads the array in order instead of jumping through an index.
//
// A copy can be patched instead of rebuilt (see remove() and place()): its
// splits stay, items leave it as +infinity, which no query returns, and new
// items take a free slot in the leaf their coordinates fall in, or around it.
class KDTree {
public:
  struct Item {
    double x;
    double y;
    // What range/within return for this point: the caller's own index.
    int32_t index;
  };

  KDTree() = default;

  void build(std::vector<Item> items, int nodeSize) {
    _items = std::move(items);
    _nodeSize = nodeSize > 0 ? nodeSize : 1;
    if (!_items.empty()) {
      sortKD(0, static_cast<int32_t>(_items.size()) - 1, 0);
    }
  }

  void range(double minX, double minY, double maxX, double maxY, std::vector<int32_t>& result) const {
    result.clear();
    if (_items.empty()) return;
    rangeRecurse(0, static_cast<int32_t>(_items.size()) - 1, 0, minX, minY, maxX, maxY, result);
  }

  /**
   * The items whose squared distance from (x, y), as computed here, is at most
   * radius². Subtrees are pruned with room for rounding, so which items are
   * returned does not depend on how the tree is split: any tree over the same
   * items returns the same ones, in its own order.
   */
  void within(double x, double y, double radius, std::vector<int32_t>& result) const {
    result.clear();
    if (_items.empty()) return;
    withinRecurse(0, static_cast<int32_t>(_items.size()) - 1, 0, x, y, radius * radius, pruneReach(x, y, radius),
                  result);
  }

  /**
   * within(x, y, radius), returning a lower bound on the squared distance from
   * (x, y) to every item other than `self`: the nearest such item the query
   * visits, or the nearest subtree it prunes, rounding included. The query and
   * its result are within()'s. Only meaningful when the result is `self` alone.
   */
  double withinBound(double x, double y, double radius, int32_t self, std::vector<int32_t>& result) const {
    result.clear();
    double bound2 = std::numeric_limits<double>::infinity();
    if (!_items.empty()) {
      withinBoundRecurse(0, static_cast<int32_t>(_items.size()) - 1, 0, x, y, radius * radius,
                         pruneReach(x, y, radius), self, result, bound2);
    }
    return bound2;
  }

  /** Calls `visit(index)` for each item within(x, y, radius) would return, in the same order. */
  template <typename Visit>
  void forEachWithin(double x, double y, double radius, Visit&& visit) const {
    if (_items.empty()) return;
    forEachWithinRecurse(0, static_cast<int32_t>(_items.size()) - 1, 0, x, y, radius * radius,
                         pruneReach(x, y, radius), visit);
  }

  size_t size() const { return _items.size(); }

  /** The item at `position` in the tree's order. */
  const Item& item(size_t position) const { return _items[position]; }

  /**
   * Takes the item at `position` out: no query returns it any more. A leaf's
   * slot is freed for place(). A range's middle item is its split, so it
   * keeps its coordinate on the split axis, and its slot stays taken.
   */
  void remove(size_t position) {
    const double gone = std::numeric_limits<double>::infinity();
    const int32_t target = static_cast<int32_t>(position);
    int32_t left = 0;
    int32_t right = static_cast<int32_t>(_items.size()) - 1;
    int32_t axis = 0;
    while (right - left > _nodeSize) {
      const int32_t mid = (left + right) >> 1;
      if (target == mid) {
        (axis == 0 ? _items[mid].y : _items[mid].x) = gone;
        return;
      }
      if (target < mid) {
        right = mid - 1;
      } else {
        left = mid + 1;
      }
      axis ^= 1;
    }
    _items[position].x = gone;
    _items[position].y = gone;
  }

  /**
   * Puts `item` where queries find it: in a free slot of the leaf its
   * coordinates fall in, or when that leaf has none, in the smallest range
   * around it that has one, which is then sorted again. Calls
   * `moved(position, index)` for each item that lands somewhere new, `item`
   * included. False, leaving the tree as it was, when the tree has no free
   * slot.
   */
  template <typename Moved>
  bool place(const Item& item, Moved&& moved) {
    // The ranges from the root down to the leaf, deepest last.
    struct Range {
      int32_t left;
      int32_t right;
      int32_t axis;
    };
    Range path[64];
    int32_t depth = 0;
    int32_t left = 0;
    int32_t right = static_cast<int32_t>(_items.size()) - 1;
    int32_t axis = 0;
    while (right - left > _nodeSize) {
      path[depth++] = {left, right, axis};
      const int32_t mid = (left + right) >> 1;
      // Left of a split lie the items at or below its coordinate.
      if ((axis == 0 ? item.x <= _items[mid].x : item.y <= _items[mid].y)) {
        right = mid - 1;
      } else {
        left = mid + 1;
      }
      axis ^= 1;
    }
    path[depth++] = {left, right, axis};

    for (int32_t i = left; i <= right; i++) {
      if (isRemoved(_items[i])) {
        _items[i] = item;
        moved(i, item.index);
        return true;
      }
    }
    // Every item of a range satisfies the splits above it, `item` included,
    // so the range can be sorted again on its own; removed items, middle
    // ones included, are free slots for that.
    for (int32_t d = depth - 2; d >= 0; d--) {
      const Range& range = path[d];
      for (int32_t i = range.left; i <= range.right; i++) {
        if (!isRemoved(_items[i])) continue;
        _items[i] = item;
        sortKD(range.left, range.right, range.axis);
        for (int32_t j = range.left; j <= range.right; j++) {
          if (!isRemoved(_items[j])) moved(j, _items[j].index);
        }
        return true;
      }
    }
    return false;
  }

  size_t memoryBytes() const {
    return _items.capacity() * sizeof(Item);
  }

private:
  // Collects a range query's hits in a leaf and appends them to the result in
  // batches. A push_back per hit is a function call wherever the inliner
  // keeps it out of line (GCC 13 on x86-64 does in the core benchmark), and
  // the call then costs more than the test itself. A viewport leaf often
  // hits most of its points; a `within` leaf hits a few, so it keeps
  // push_back, which a batch per leaf would cost more than it saves.
  class LeafHits {
  public:
    explicit LeafHits(std::vector<int32_t>& result) : _result(result) {}

    void add(int32_t index) {
      _hits[_count++] = index;
      if (_count == kCapacity) flush();
    }

    void flush() {
      if (_count > 0) {
        _result.insert(_result.end(), _hits, _hits + _count);
        _count = 0;
      }
    }

  private:
    static constexpr int32_t kCapacity = 64;
    std::vector<int32_t>& _result;
    int32_t _hits[kCapacity];
    int32_t _count = 0;
  };

  std::vector<Item> _items;
  int32_t _nodeSize = 64;

  // Whether remove() took the item out: a coordinate is +infinity.
  static bool isRemoved(const Item& item) {
    return item.x == std::numeric_limits<double>::infinity() || item.y == std::numeric_limits<double>::infinity();
  }

  void sortKD(int32_t left, int32_t right, int32_t axis) {
    if (right - left <= _nodeSize) return;

    const int32_t mid = (left + right) >> 1;
    const auto first = _items.begin() + left;
    const auto nth = _items.begin() + mid;
    const auto last = _items.begin() + right + 1;
    if (axis == 0) {
      std::nth_element(first, nth, last, [](const Item& a, const Item& b) { return a.x < b.x; });
    } else {
      std::nth_element(first, nth, last, [](const Item& a, const Item& b) { return a.y < b.y; });
    }

    sortKD(left, mid - 1, axis ^ 1);
    sortKD(mid + 1, right, axis ^ 1);
  }

  void rangeRecurse(int32_t left, int32_t right, int32_t axis,
                    double minX, double minY, double maxX, double maxY,
                    std::vector<int32_t>& result) const {
    if (right - left <= _nodeSize) {
      LeafHits hits(result);
      for (int32_t i = left; i <= right; i++) {
        const Item& item = _items[i];
        if (item.x >= minX && item.x <= maxX && item.y >= minY && item.y <= maxY) {
          hits.add(item.index);
        }
      }
      hits.flush();
      return;
    }

    const int32_t mid = (left + right) >> 1;
    const Item& item = _items[mid];

    if (item.x >= minX && item.x <= maxX && item.y >= minY && item.y <= maxY) {
      result.push_back(item.index);
    }

    const double coord = axis == 0 ? item.x : item.y;
    const double lo = axis == 0 ? minX : minY;
    const double hi = axis == 0 ? maxX : maxY;

    if (lo <= coord) {
      rangeRecurse(left, mid - 1, axis ^ 1, minX, minY, maxX, maxY, result);
    }
    if (hi >= coord) {
      rangeRecurse(mid + 1, right, axis ^ 1, minX, minY, maxX, maxY, result);
    }
  }

  // `reach` is the radius widened by pruneReach(): a subtree is pruned only
  // when no item in it can pass the `r2` test.
  void withinRecurse(int32_t left, int32_t right, int32_t axis,
                     double x, double y, double r2, double reach,
                     std::vector<int32_t>& result) const {
    if (right - left <= _nodeSize) {
      for (int32_t i = left; i <= right; i++) {
        const Item& item = _items[i];
        const double dx = item.x - x;
        const double dy = item.y - y;
        if (dx * dx + dy * dy <= r2) {
          result.push_back(item.index);
        }
      }
      return;
    }

    const int32_t mid = (left + right) >> 1;
    const Item& item = _items[mid];
    const double dx = item.x - x;
    const double dy = item.y - y;

    if (dx * dx + dy * dy <= r2) {
      result.push_back(item.index);
    }

    const double coord = axis == 0 ? item.x : item.y;
    const double q = axis == 0 ? x : y;

    if (q - reach <= coord) {
      withinRecurse(left, mid - 1, axis ^ 1, x, y, r2, reach, result);
    }
    if (q + reach >= coord) {
      withinRecurse(mid + 1, right, axis ^ 1, x, y, r2, reach, result);
    }
  }

  // withinRecurse, also lowering `bound2` to each item it reads other than
  // `self` and to each subtree it prunes.
  void withinBoundRecurse(int32_t left, int32_t right, int32_t axis, double x, double y, double r2, double reach,
                          int32_t self, std::vector<int32_t>& result, double& bound2) const {
    // With a second hit the node has a neighbour, so no bound is wanted.
    if (result.size() > 1) {
      withinRecurse(left, right, axis, x, y, r2, reach, result);
      return;
    }
    if (right - left <= _nodeSize) {
      for (int32_t i = left; i <= right; i++) {
        const Item& item = _items[i];
        const double dx = item.x - x;
        const double dy = item.y - y;
        const double d2 = dx * dx + dy * dy;
        if (d2 <= r2) result.push_back(item.index);
        if (item.index != self && d2 < bound2) bound2 = d2;
      }
      return;
    }

    const int32_t mid = (left + right) >> 1;
    const Item& item = _items[mid];
    const double dx = item.x - x;
    const double dy = item.y - y;
    const double d2 = dx * dx + dy * dy;

    if (d2 <= r2) result.push_back(item.index);
    if (item.index != self && d2 < bound2) bound2 = d2;

    const double coord = axis == 0 ? item.x : item.y;
    const double q = axis == 0 ? x : y;

    if (q - reach <= coord) {
      withinBoundRecurse(left, mid - 1, axis ^ 1, x, y, r2, reach, self, result, bound2);
    } else {
      bound2 = std::min(bound2, prunedGap2(q - coord, q, coord));
    }
    if (q + reach >= coord) {
      withinBoundRecurse(mid + 1, right, axis ^ 1, x, y, r2, reach, self, result, bound2);
    } else {
      bound2 = std::min(bound2, prunedGap2(coord - q, q, coord));
    }
  }

  template <typename Visit>
  void forEachWithinRecurse(int32_t left, int32_t right, int32_t axis, double x, double y, double r2, double reach,
                            Visit& visit) const {
    if (right - left <= _nodeSize) {
      for (int32_t i = left; i <= right; i++) {
        const Item& item = _items[i];
        const double dx = item.x - x;
        const double dy = item.y - y;
        if (dx * dx + dy * dy <= r2) visit(item.index);
      }
      return;
    }

    const int32_t mid = (left + right) >> 1;
    const Item& item = _items[mid];
    const double dx = item.x - x;
    const double dy = item.y - y;
    if (dx * dx + dy * dy <= r2) visit(item.index);

    const double coord = axis == 0 ? item.x : item.y;
    const double q = axis == 0 ? x : y;
    if (q - reach <= coord) forEachWithinRecurse(left, mid - 1, axis ^ 1, x, y, r2, reach, visit);
    if (q + reach >= coord) forEachWithinRecurse(mid + 1, right, axis ^ 1, x, y, r2, reach, visit);
  }

  // The radius a within query prunes with. An item of a pruned subtree lies
  // more than this from (x, y) along the axis, so even with the rounding of
  // that difference, of its square and of the sum, its squared distance
  // exceeds radius² as rounded: a few ulps of the radius and of the
  // coordinates.
  static double pruneReach(double x, double y, double radius) {
    return radius + (radius + std::fabs(x) + std::fabs(y)) * 4 * std::numeric_limits<double>::epsilon();
  }

  // The squared distance every item of a pruned subtree is at least: its
  // items lie `gap` or more away along the axis, less what rounding can take
  // off a computed difference of `q` and `coord`.
  static double prunedGap2(double gap, double q, double coord) {
    const double slack = (std::fabs(q) + std::fabs(coord)) * 4 * std::numeric_limits<double>::epsilon();
    const double g = gap - slack;
    return g > 0 ? g * g : 0.0;
  }
};

class ClusterEngineCore {
public:
  /** Throws `std::invalid_argument` for an invalid config, leaving the engine unchanged. */
  void setOptions(const ClusterEngineConfig& options) {
    validateClusterEngineConfig(options);
    _options = options;
    resetDerivedState();
  }

  void setPoints(const int32_t* ids, const double* lats, const double* lngs, size_t count) {
    setPoints(ids, lats, lngs, count, nullptr, 0);
  }

  // `values` is a row-major (count x numProps) matrix of raw aggregation
  // inputs; pass nullptr/0 to disable aggregation.
  void setPoints(const int32_t* ids, const double* lats, const double* lngs, size_t count,
                 const double* values, size_t numProps) {
    _points.clear();
    _points.reserve(count);
    for (size_t i = 0; i < count; i++) {
      if (!isValidGeoCoordinate(lats[i], lngs[i])) {
        continue;
      }
      PointData p;
      p.id = ids[i];
      p.latitude = clampLatitude(lats[i]);
      p.longitude = clampLongitude(lngs[i]);
      p.x = lngToX(p.longitude, _options.extent);
      p.y = latToY(p.latitude, _options.extent);
      if (numProps > 0 && values != nullptr) {
        p.values.assign(values + i * numProps, values + (i + 1) * numProps);
      }
      _points.push_back(std::move(p));
    }
    resetDerivedState();
  }

  // Magic header for the v2 buffer that carries per-point aggregation values.
  // Bytes 'C','2','M','N' written little-endian by packPoints.
  static constexpr uint32_t kBufferMagicV2 = 0x4E4D4332u;

  /** Returns false when the buffer layout is invalid (state is reset). */
  bool setPointsFromBuffer(const uint8_t* data, size_t byteLength) {
    if (!parseBuffer(data, byteLength)) {
      resetDerivedState(true);
      return false;
    }
    resetDerivedState();
    return true;
  }

  void build() {
    resetDerivedState();
    _firstClusterId = firstFreeClusterId();

    if (_points.empty()) {
      _built = true;
      return;
    }

    if (!_options.clusteringEnabled) {
      _built = true;
      return;
    }

    const size_t np = _options.reducers.size();
    const size_t pointCount = _points.size();

    // Every point and cluster lives in `_nodes` exactly once, as it was
    // created: points first, in `_points` order, then clusters in the order
    // they form. Everything else refers to a node by its index there.
    _nodes.reserve(pointCount);
    for (size_t i = 0; i < pointCount; i++) {
      ClusterNode node;
      node.id = _points[i].id;
      node.x = _points[i].x;
      node.y = _points[i].y;
      node.count = 1;
      node.parentId = -1;
      node.pointIndex = _points[i].id;
      node.isCluster = false;
      node.zoom = _options.maxZoom + 1;
      node.minLeafId = node.id;
      if (np > 0) {
        node.values.assign(np, 0.0);
        const auto& v = _points[i].values;
        for (size_t k = 0; k < np && k < v.size(); k++) {
          node.values[k] = v[k];
        }
      }
      _nodes.push_back(std::move(node));
    }
    _childOffsets.push_back(0);

    // The nodes at the level being clustered, in the order supercluster walks
    // them, and the zoom each node was last processed at. supercluster marks a
    // node by lowering its `zoom`; the mark lives here so that `_nodes` keeps
    // each node's creation zoom, which getClusterExpansionZoom() starts from.
    std::vector<int32_t> current(pointCount);
    for (size_t i = 0; i < pointCount; i++) {
      current[i] = static_cast<int32_t>(i);
    }
    std::vector<int32_t> processedAt(pointCount, _options.maxZoom + 1);

    // maxZoom+1 is the clustering input. getClusters answers it from the
    // maxZoom tree (see pointsInBounds), so its own tree is only kept if
    // maxZoom turns out to hold the very same nodes.
    KDTree inputTree = buildTree(current);

    const int32_t levels = _options.maxZoom - _options.minZoom + 1;
    _treeByZoom.assign(static_cast<size_t>(levels), -1);
    // No reallocation, so `tree` below stays valid while the next one is added.
    _trees.reserve(static_cast<size_t>(levels));

    std::vector<int32_t> next;
    std::vector<int32_t> neighbors;

    // At high zooms nearly every node is alone within the level's radius, yet
    // each would still be queried at every level. `certificate[i]` is a lower
    // bound on the squared distance from node i to every other node of the
    // level being clustered (0 when unknown): while it exceeds the radius
    // squared, the query would find only node i, so the node skips it. A lonely
    // node's query certifies it with the nearest item it reads or subtree it
    // prunes, up to kCertificateReach radii; each cluster a level forms lowers
    // the certificates of the nodes near it, and nodes that leave only make the
    // others conservative. The trees, the order of the nodes and every query
    // that does run are unchanged, so the index is the same.
    bool certifying = _skipLonelyQueries;
    // Empty until a node is first certified, so dense data never allocates it.
    std::vector<float> certificate;
    float largestCertificate = 0.0f;

    // A level that changes few nodes patches a copy of the tree above it
    // rather than building one: its nodes absorbed into clusters leave their
    // slots, and its clusters take free slots (see KDTree::place). The slots
    // left free make queries scan a little more, so a level that has lost a
    // share of the nodes of the last level built afresh, `baseSize`, gets a
    // fresh tree again. A query returns the same nodes from a patched tree as
    // from a fresh one (see KDTree::within), in another order, so the
    // clustering over a patched tree folds each cluster's nodes in node
    // order: the index then does not depend on which tree a level got.
    // getClusters still returns a patched level's nodes in its tree's order.
    // With minPoints above 2 the walk order of a level depends on the order
    // its queries return nodes, so every level gets a fresh tree.
    const bool patchable = _options.minPoints <= 2;
    size_t baseSize = pointCount;
    // Whether the tree over `current` is one a level patches, by the rule
    // above, even when a cluster found no free slot or the tests switched
    // patching off.
    bool patched = false;
    // Where each node of the last patched tree sits in it; `slotsValid` is
    // false while it does not describe the tree over `current`.
    std::vector<int32_t> slotOf;
    bool slotsValid = false;

    for (int32_t z = _options.maxZoom; z >= _options.minZoom; z--) {
      const double r = clusterRadiusAtZoom(_options.radius, static_cast<double>(z));
      const double r2 = r * r;
      const size_t slot = static_cast<size_t>(z - _options.minZoom);
      // The tree over `current`: the one getClusters() queries at z + 1.
      const KDTree& tree = z == _options.maxZoom ? inputTree : _trees[_treeByZoom[slot + 1]];

      // Certificates only serve the levels below this one.
      const bool probing = certifying && z > _options.minZoom;
      const double reach = r * kCertificateReach;
      const double reach2 = reach * reach;
      const size_t firstNewNode = _nodes.size();
      size_t visited = 0;
      size_t lonely = 0;

      next.clear();
      next.reserve(current.size());

      // supercluster-faithful pass: walk nodes in order, mark each once
      // processed at this level, and only fold in neighbours that haven't been
      // processed yet at this level.
      for (const int32_t index : current) {
        if (processedAt[index] <= z) continue;
        processedAt[index] = z;
        visited++;

        if (certifying && !certificate.empty() && r2 < certificate[index]) {
          // The query would find only this node, which survives unclustered,
          // as it does below.
          next.push_back(index);
          lonely++;
          continue;
        }

        const double originX = _nodes[index].x;
        const double originY = _nodes[index].y;
        if (probing && certifying) {
          const double bound2 = tree.withinBound(originX, originY, r, index, neighbors);
          if (neighbors.size() == 1) {
            if (certificate.empty()) {
              // Room for some clusters too; certifying stops rather than
              // reallocate when they outgrow it.
              certificate.reserve(std::max(_nodes.size(), pointCount + pointCount / 8));
              certificate.assign(_nodes.size(), 0.0f);
            }
            certificate[index] = certifiedBound(std::min(bound2, reach2));
            largestCertificate = std::max(largestCertificate, certificate[index]);
          }
        } else {
          tree.within(originX, originY, r, neighbors);
        }
        if (neighbors.size() == 1) lonely++;

        const int32_t numPointsOrigin = _nodes[index].count;
        int32_t numPoints = numPointsOrigin;
        for (const int32_t nb : neighbors) {
          if (processedAt[nb] > z) numPoints += _nodes[nb].count;
        }

        if (numPoints > numPointsOrigin && numPoints >= _options.minPoints) {
          if (patched) {
            std::sort(neighbors.begin(), neighbors.end());
          }
          double wx = originX * numPointsOrigin;
          double wy = originY * numPointsOrigin;

          ClusterNode cluster;
          cluster.id = _firstClusterId + static_cast<int32_t>(_nodes.size() - pointCount);
          cluster.count = numPoints;
          cluster.parentId = -1;
          cluster.pointIndex = -1;
          cluster.isCluster = true;
          cluster.zoom = z;
          cluster.minLeafId = _nodes[index].minLeafId;
          if (np > 0) {
            // Seed the accumulator with the origin node's values, then fold.
            cluster.values = _nodes[index].values;
            cluster.values.resize(np, 0.0);
          }

          linkChild(cluster.id, index);

          for (const int32_t nb : neighbors) {
            if (processedAt[nb] <= z) continue;
            processedAt[nb] = z;
            const ClusterNode& child = _nodes[nb];
            const int32_t np2 = child.count;
            wx += child.x * np2;
            wy += child.y * np2;
            cluster.minLeafId = std::min(cluster.minLeafId, child.minLeafId);
            for (size_t k = 0; k < np; k++) {
              const double v = k < child.values.size()
                ? child.values[k]
                : reducerSeed(_options.reducers[k]);
              cluster.values[k] = reducerApply(_options.reducers[k], cluster.values[k], v);
            }
            linkChild(cluster.id, nb);
          }

          cluster.x = wx / numPoints;
          cluster.y = wy / numPoints;
          next.push_back(static_cast<int32_t>(_nodes.size()));
          _childOffsets.push_back(static_cast<int32_t>(_childNodes.size()));
          processedAt.push_back(z);
          if (certifying && !certificate.empty()) {
            if (certificate.size() == certificate.capacity()) {
              certifying = false;
            } else {
              certificate.push_back(0.0f);
            }
          }
          _nodes.push_back(std::move(cluster));
        } else {
          // The origin survives unclustered at this level.
          next.push_back(index);

          // Mark (but don't cluster) any mergeable neighbours so they aren't
          // reprocessed; they survive individually at this level too.
          if (numPoints > 1) {
            for (const int32_t nb : neighbors) {
              if (processedAt[nb] <= z) continue;
              processedAt[nb] = z;
              next.push_back(nb);
            }
          }
        }
      }

      // A level that merged nothing holds the same nodes in the same order as
      // the one above it, so it gets the same tree; sparse data skips most of
      // the high zooms this way. Otherwise the level gets a tree of its own,
      // patched or fresh (see above), which getClusters() range-queries and
      // the next level clusters over.
      if (next == current) {
        if (z == _options.maxZoom) {
          _trees.push_back(std::move(inputTree));
          _treeByZoom[slot] = static_cast<int32_t>(_trees.size() - 1);
        } else {
          _treeByZoom[slot] = _treeByZoom[slot + 1];
        }
      } else {
        patched = patchable && (baseSize - next.size()) * kSlotsPerFreeSlot <= baseSize;
        bool fresh = true;
        if (patched && _reuseTrees) {
          KDTree tree = z == _options.maxZoom ? std::move(inputTree) : _trees[_treeByZoom[slot + 1]];
          if (!slotsValid) {
            // Each cluster formed adds a free slot at least, so patching
            // stops before more than baseSize / kSlotsPerFreeSlot of them.
            slotOf.reserve(_nodes.size() + baseSize / kSlotsPerFreeSlot + 1);
            slotOf.resize(_nodes.size());
            for (size_t i = 0; i < tree.size(); i++) {
              slotOf[tree.item(i).index] = static_cast<int32_t>(i);
            }
          }
          if (patchTree(tree, firstNewNode, slotOf)) {
            _trees.push_back(std::move(tree));
            fresh = false;
          }
        }
        if (fresh) {
          _trees.push_back(buildTree(next));
        }
        slotsValid = !fresh;
        if (!patched) {
          baseSize = next.size();
        }
        _treeByZoom[slot] = static_cast<int32_t>(_trees.size() - 1);
      }

      // Once most nodes have neighbours, certifying costs more than it saves.
      if (static_cast<double>(lonely) < kMinLonelyShare * static_cast<double>(visited)) {
        certifying = false;
      }
      if (probing && certifying && !certificate.empty() && firstNewNode < _nodes.size()) {
        if ((_nodes.size() - firstNewNode) * kClustersPerNodeQuery <= next.size()) {
          certifyNewClusters(_trees[_treeByZoom[slot]], firstNewNode, largestCertificate, certificate);
        } else {
          lowerCertificates(next, firstNewNode, r, certificate);
        }
      }
      std::swap(current, next);
    }

    indexPointIds();
    _built = true;
  }

  std::vector<ClusterNode> getClusters(const ViewportBounds& viewport) const {
    std::vector<ClusterNode> result;
    if (!_built || _points.empty()) return result;

    // Accepts the bbox a map region produces as-is, e.g. west 170, east 190
    // around the antimeridian. The ranges are disjoint, so no node is
    // collected twice.
    const NormalizedViewport bounds = normalizeViewport(viewport);

    if (!_options.clusteringEnabled) {
      result.reserve(_points.size());
      for (size_t i = 0; i < _points.size(); i++) {
        const PointData& p = _points[i];
        if (p.latitude > bounds.north || p.latitude < bounds.south) continue;
        bool inLng = false;
        for (int r = 0; r < bounds.rangeCount; r++) {
          inLng = inLng || (p.longitude >= bounds.ranges[r].west && p.longitude <= bounds.ranges[r].east);
        }
        if (!inLng) continue;

        ClusterNode node;
        node.id = p.id;
        node.x = p.x;
        node.y = p.y;
        node.count = 1;
        node.parentId = -1;
        node.pointIndex = p.id;
        node.isCluster = false;
        node.zoom = 0;
        node.minLeafId = p.id;
        node.values = p.values;
        result.push_back(std::move(node));
      }
      return result;
    }

    // As supercluster's _limitZoom: any zoom above maxZoom is maxZoom + 1,
    // the clustering input, where every point stands on its own.
    const int32_t z = static_cast<int32_t>(clamp(
      std::floor(viewport.zoom),
      static_cast<double>(_options.minZoom),
      static_cast<double>(_options.maxZoom) + 1.0
    ));

    // maxZoom + 1 has no tree of its own: it is read from maxZoom's (see
    // pointsInBounds).
    const bool pointsOnly = z > _options.maxZoom;
    const size_t slot = static_cast<size_t>((pointsOnly ? _options.maxZoom : z) - _options.minZoom);
    if (slot >= _treeByZoom.size()) return result;
    const KDTree& tree = _trees[_treeByZoom[slot]];

    // Y grows southward (latToY is monotonically decreasing in latitude), so
    // north maps to the smaller Y and south to the larger Y.
    const double minY = latToY(bounds.north, _options.extent);
    const double maxY = latToY(bounds.south, _options.extent);

    std::vector<int32_t> idxBuf;
    // appendAtLevel is called from this loop only: with a second call site
    // GCC 13 stops inlining it, and every returned node pays for a call.
    auto collect = [&](double minX, double maxX) {
      if (pointsOnly) {
        pointsInBounds(tree, minX, minY, maxX, maxY, idxBuf);
      } else {
        tree.range(minX, minY, maxX, maxY, idxBuf);
      }
      result.reserve(result.size() + idxBuf.size());
      for (int32_t idx : idxBuf) {
        appendAtLevel(result, _nodes[idx], z);
      }
    };

    for (int r = 0; r < bounds.rangeCount; r++) {
      collect(lngToX(bounds.ranges[r].west, _options.extent), lngToX(bounds.ranges[r].east, _options.extent));
    }

    return result;
  }

  std::vector<ClusterNode> getChildren(int32_t clusterId) const {
    std::vector<ClusterNode> result;
    if (!_built) return result;

    const int32_t index = findNode(clusterId);
    if (index < 0 || !_nodes[index].isCluster) return result;

    const size_t cluster = static_cast<size_t>(index) - _points.size();
    const int32_t begin = _childOffsets[cluster];
    const int32_t end = _childOffsets[cluster + 1];
    result.reserve(static_cast<size_t>(end - begin));
    for (int32_t i = begin; i < end; i++) {
      result.push_back(_nodes[_childNodes[i]]);
    }
    return result;
  }

  std::vector<ClusterNode> getLeaves(int32_t clusterId, int32_t limit, int32_t offset) const {
    std::vector<ClusterNode> result;
    if (!_built) return result;

    const int32_t root = findNode(clusterId);
    if (root < 0) return result;

    std::vector<int32_t> stack;
    stack.push_back(root);
    int32_t skipped = 0;

    const bool unlimited = limit <= 0;
    while (!stack.empty() && (unlimited || static_cast<int32_t>(result.size()) < limit)) {
      const int32_t index = stack.back();
      stack.pop_back();
      const ClusterNode& node = _nodes[index];

      if (!node.isCluster) {
        if (skipped < offset) {
          skipped++;
        } else {
          result.push_back(node);
        }
      } else if (offset - skipped >= node.count) {
        // The whole sub-cluster lies before the page: skip it by its count,
        // as supercluster does, instead of walking its leaves.
        skipped += node.count;
      } else {
        const size_t cluster = static_cast<size_t>(index) - _points.size();
        for (int32_t i = _childOffsets[cluster + 1] - 1; i >= _childOffsets[cluster]; i--) {
          stack.push_back(_childNodes[i]);
        }
      }
    }
    return result;
  }

  // The box getLeaves() would span, without collecting the leaves: a cluster
  // press needs four numbers, not every point. A point id spans its own point;
  // an id that is no node, or an index not built yet, has no box.
  std::optional<LeafBounds> getClusterBounds(int32_t clusterId) const {
    if (!_built) return std::nullopt;

    const int32_t root = findNode(clusterId);
    if (root < 0) return std::nullopt;

    LeafBounds bounds{
      -std::numeric_limits<double>::infinity(),
      std::numeric_limits<double>::infinity(),
      -std::numeric_limits<double>::infinity(),
      std::numeric_limits<double>::infinity(),
    };
    std::vector<int32_t> stack;
    stack.push_back(root);

    while (!stack.empty()) {
      const size_t index = static_cast<size_t>(stack.back());
      stack.pop_back();

      // Points come first in `_nodes`, in `_points` order, so a leaf's
      // coordinates are read where they were loaded, as JS has them.
      if (index < _points.size()) {
        const PointData& point = _points[index];
        bounds.north = std::max(bounds.north, point.latitude);
        bounds.south = std::min(bounds.south, point.latitude);
        bounds.east = std::max(bounds.east, point.longitude);
        bounds.west = std::min(bounds.west, point.longitude);
      } else {
        const size_t cluster = index - _points.size();
        for (int32_t i = _childOffsets[cluster]; i < _childOffsets[cluster + 1]; i++) {
          stack.push_back(_childNodes[i]);
        }
      }
    }
    return bounds;
  }

  int32_t getClusterExpansionZoom(int32_t clusterId) const {
    if (!_built) return _options.minZoom;

    int32_t index = findNode(clusterId);
    if (index < 0) return _options.maxZoom;

    // Mirrors supercluster: start at the zoom the cluster was created at and
    // walk down single-child chains until it splits into multiple children.
    // A cluster created at maxZoom returns maxZoom + 1, where getClusters
    // returns its points on their own; so does a point id, whose node is
    // created at maxZoom + 1.
    int32_t expansionZoom = _nodes[index].zoom;

    while (expansionZoom <= _options.maxZoom) {
      expansionZoom++;
      if (!_nodes[index].isCluster) break;
      const size_t cluster = static_cast<size_t>(index) - _points.size();
      if (_childOffsets[cluster + 1] - _childOffsets[cluster] != 1) break;
      index = _childNodes[_childOffsets[cluster]];
    }

    return expansionZoom;
  }

  size_t pointCount() const { return _points.size(); }
  bool isBuilt() const { return _built; }
  const ClusterEngineConfig& options() const { return _options; }

  /**
   * Whether build() skips the neighbour query of a node that provably has no
   * other node within the level's radius. On by default; the index is the same
   * either way, which the tests check by turning it off.
   */
  void setSkipLonelyQueries(bool skip) { _skipLonelyQueries = skip; }

  /**
   * Whether build() patches the tree of a level that changes few nodes from
   * the tree above it rather than building one. On by default. Off, such a
   * level gets a fresh tree instead, and everything but the order of
   * getClusters() results is the same, which the tests check.
   */
  void setReuseTrees(bool reuse) { _reuseTrees = reuse; }

  /** A copy with the same options and points and no index, ready to `build()`. */
  ClusterEngineCore withoutIndex() const {
    ClusterEngineCore copy;
    copy._options = _options;
    copy._points = _points;
    copy._skipLonelyQueries = _skipLonelyQueries;
    copy._reuseTrees = _reuseTrees;
    return copy;
  }

  /** Approximate native heap bytes owned by point data, indexes, and cluster graphs. */
  size_t memorySize() const {
    size_t bytes = _points.capacity() * sizeof(PointData);
    for (const auto& point : _points) {
      bytes += point.values.capacity() * sizeof(double);
    }

    bytes += _nodes.capacity() * sizeof(ClusterNode);
    for (const auto& node : _nodes) {
      bytes += node.values.capacity() * sizeof(double);
    }

    bytes += _trees.capacity() * sizeof(KDTree);
    for (const auto& tree : _trees) {
      bytes += tree.memoryBytes();
    }

    bytes += _treeByZoom.capacity() * sizeof(int32_t);
    bytes += _childOffsets.capacity() * sizeof(int32_t);
    bytes += _childNodes.capacity() * sizeof(int32_t);
    bytes += _nodeByPointId.capacity() * sizeof(int32_t);
    bytes += _sparsePointIds.capacity() * sizeof(std::pair<int32_t, int32_t>);
    bytes += _options.reducers.capacity() * sizeof(AggregationReducer);

    return bytes;
  }

  double nodeLatitude(const ClusterNode& node) const {
    return yToLat(node.y, _options.extent);
  }

  double nodeLongitude(const ClusterNode& node) const {
    return xToLng(node.x, _options.extent);
  }

private:
  void resetDerivedState(bool clearPoints = false) {
    if (clearPoints) {
      _points.clear();
    }
    _built = false;
    // Swapped out rather than cleared, so an engine re-pointed at new data
    // gives the old index's memory back.
    std::vector<ClusterNode>().swap(_nodes);
    std::vector<KDTree>().swap(_trees);
    std::vector<int32_t>().swap(_treeByZoom);
    std::vector<int32_t>().swap(_childOffsets);
    std::vector<int32_t>().swap(_childNodes);
    std::vector<int32_t>().swap(_nodeByPointId);
    std::vector<std::pair<int32_t, int32_t>>().swap(_sparsePointIds);
  }

  // Reads packPoints' layout into `_points`. v1: uint32 count, then per point
  // int32 id, float64 lat, float64 lng. v2: the magic, uint32 count, uint32
  // numProps, and each point followed by numProps float64 values.
  bool parseBuffer(const uint8_t* data, size_t byteLength) {
    if (data == nullptr || byteLength < 4) return false;
    uint32_t magic = 0;
    std::memcpy(&magic, data, 4);
    const bool v2 = magic == kBufferMagicV2;
    const size_t header = v2 ? 12 : 4;
    if (byteLength < header) return false;

    int32_t count = 0;
    uint32_t numProps = 0;
    std::memcpy(&count, data + (v2 ? 4 : 0), 4);
    if (v2) std::memcpy(&numProps, data + 8, 4);

    // Both counts come from the buffer, so the size check divides rather than
    // multiplies: `count * stride` wraps size_t, on a 32-bit ABI from a 4-byte
    // count alone. The stride itself only wraps a 32-bit size_t.
    const uint64_t maxNumProps = (std::numeric_limits<size_t>::max() - 20) / 8;
    if (count < 0 || static_cast<uint64_t>(numProps) > maxNumProps) return false;
    const size_t valuesSize = static_cast<size_t>(numProps) * 8;
    const size_t stride = 20 + valuesSize;
    if (static_cast<size_t>(count) > (byteLength - header) / stride) return false;

    // Cluster ids continue from the largest point id (firstFreeClusterId), and
    // there are fewer clusters than points, so this leaves room for all of them
    // in int32. packPoints writes ids below `count`.
    const int32_t maxPointId = std::numeric_limits<int32_t>::max() - count;

    _points.clear();
    _points.reserve(static_cast<size_t>(count));
    for (int32_t i = 0; i < count; i++) {
      const uint8_t* record = data + header + static_cast<size_t>(i) * stride;
      PointData p;
      std::memcpy(&p.id, record, 4);
      std::memcpy(&p.latitude, record + 4, 8);
      std::memcpy(&p.longitude, record + 12, 8);
      if (p.id > maxPointId) return false;
      if (!isValidGeoCoordinate(p.latitude, p.longitude)) continue;
      p.latitude = clampLatitude(p.latitude);
      p.longitude = clampLongitude(p.longitude);
      p.x = lngToX(p.longitude, _options.extent);
      p.y = latToY(p.latitude, _options.extent);
      if (numProps > 0) {
        p.values.resize(numProps);
        std::memcpy(p.values.data(), record + 20, valuesSize);
      }
      _points.push_back(std::move(p));
    }
    return true;
  }

  // Point and cluster ids share one space (findNode, parentId), so the cluster
  // counter must start above every surviving point id. `_points.size()` is smaller than that
  // as soon as ingestion drops a point for a non-finite coordinate.
  int32_t firstFreeClusterId() const {
    int32_t maxPointId = -1;
    for (const auto& point : _points) {
      maxPointId = std::max(maxPointId, point.id);
    }
    return maxPointId + 1;
  }

  // The farthest a certificate reaches in build(), in radii of the level that
  // set it: it covers up to log2 of this many levels below, and bounds how far
  // around a new cluster certificates need updating.
  static constexpr double kCertificateReach = 32.0;
  // Below this share of lonely nodes in a level, build() stops certifying:
  // the cluster updates would cost more than the queries they save.
  static constexpr double kMinLonelyShare = 0.9;
  // A level that forms more than one cluster per this many nodes lowers every
  // certificate at once instead of querying around each cluster.
  static constexpr size_t kClustersPerNodeQuery = 64;
  // build() patches the tree of a level while its free slots stay at most one
  // per this many slots.
  static constexpr size_t kSlotsPerFreeSlot = 16;

  // `d2` less a margin, as a float no larger than that: a lower bound on a
  // squared distance that the same distance computed elsewhere (operands
  // swapped, or fused differently) cannot undercut.
  static float certifiedBound(double d2) {
    const double bound = d2 * (1.0 - 1e-9);
    if (!(bound < static_cast<double>(std::numeric_limits<float>::max()))) {
      return std::numeric_limits<float>::max();
    }
    float result = static_cast<float>(bound);
    if (static_cast<double>(result) > bound) {
      result = std::nextafter(result, 0.0f);
    }
    return result;
  }

  // Lowers the certificate of every node near a cluster created from
  // `firstNewNode` on, and certifies those clusters, by querying `tree`, the
  // tree that holds them all. No certificate exceeds `largest`, so a node
  // farther than that from a cluster keeps its own.
  void certifyNewClusters(const KDTree& tree, size_t firstNewNode, float largest,
                          std::vector<float>& certificate) const {
    // Room for rounding in the tree's pruning tests, as in prunedGap2().
    const double reach = std::sqrt(static_cast<double>(largest)) * (1.0 + 1e-6) +
                         static_cast<double>(_options.extent) * 16 * std::numeric_limits<double>::epsilon();
    for (size_t cluster = firstNewNode; cluster < _nodes.size(); cluster++) {
      const ClusterNode& node = _nodes[cluster];
      float nearest = largest;
      tree.forEachWithin(node.x, node.y, reach, [&](int32_t nb) {
        if (static_cast<size_t>(nb) == cluster) return;
        const double dx = _nodes[nb].x - node.x;
        const double dy = _nodes[nb].y - node.y;
        const float bound = certifiedBound(dx * dx + dy * dy);
        certificate[nb] = std::min(certificate[nb], bound);
        nearest = std::min(nearest, bound);
      });
      certificate[cluster] = nearest;
    }
  }

  // After a level that formed the clusters from `firstNewNode` on, with radius
  // `r`: every cluster lies within `r` of the node it grew from, which was at
  // least a certificate's distance from each node in `nodes`, so that distance
  // less `r` still bounds them. The new clusters start uncertified.
  void lowerCertificates(const std::vector<int32_t>& nodes, size_t firstNewNode, double r,
                         std::vector<float>& certificate) const {
    const double margin = r * (1.0 + 1e-6) + static_cast<double>(_options.extent) * 16 *
                                                  std::numeric_limits<double>::epsilon();
    for (const int32_t index : nodes) {
      if (static_cast<size_t>(index) >= firstNewNode) {
        certificate[index] = 0.0f;
        continue;
      }
      const double distance = std::sqrt(static_cast<double>(certificate[index])) - margin;
      certificate[index] = distance > 0 ? certifiedBound(distance * distance) : 0.0f;
    }
  }

  // Patches `tree`, the tree over the nodes of the level above, into the tree
  // of the level that formed the clusters from `firstNewNode` on: their
  // children leave it and they take free slots, all recorded in `slotOf`, which
  // must say where each node of `tree` sits. Each cluster frees two slots or
  // more, so there is always one to take; were there none, this returns false
  // with `tree` half patched.
  bool patchTree(KDTree& tree, size_t firstNewNode, std::vector<int32_t>& slotOf) const {
    const size_t firstChild = static_cast<size_t>(_childOffsets[firstNewNode - _points.size()]);
    for (size_t c = firstChild; c < _childNodes.size(); c++) {
      tree.remove(static_cast<size_t>(slotOf[_childNodes[c]]));
    }
    slotOf.resize(_nodes.size());
    for (size_t cluster = firstNewNode; cluster < _nodes.size(); cluster++) {
      if (!tree.place({_nodes[cluster].x, _nodes[cluster].y, static_cast<int32_t>(cluster)},
                      [&](int32_t position, int32_t index) { slotOf[index] = position; })) {
        return false;
      }
    }
    return true;
  }

  KDTree buildTree(const std::vector<int32_t>& indices) const {
    std::vector<KDTree::Item> items;
    items.reserve(indices.size());
    for (const int32_t index : indices) {
      items.push_back({_nodes[index].x, _nodes[index].y, index});
    }
    KDTree tree;
    tree.build(std::move(items), _options.nodeSize);
    return tree;
  }

  void linkChild(int32_t parentId, int32_t childIndex) {
    _nodes[childIndex].parentId = parentId;
    _childNodes.push_back(childIndex);
  }

  // Appends `node` as it stands at level `zoom`: processed at that zoom, and
  // not yet folded into a parent there. Field by field on purpose: copying
  // the whole node, or a modified local copy, costs up to half again as many
  // instructions per result (the `values` vector), and getClusters returns
  // thousands. Keep the list in step with ClusterNode.
  static void appendAtLevel(std::vector<ClusterNode>& result, const ClusterNode& node, int32_t zoom) {
    ClusterNode& out = result.emplace_back();
    out.id = node.id;
    out.x = node.x;
    out.y = node.y;
    out.count = node.count;
    out.parentId = -1;
    out.pointIndex = node.pointIndex;
    out.isCluster = node.isCluster;
    out.zoom = zoom;
    out.minLeafId = node.minLeafId;
    if (!node.values.empty()) {
      out.values = node.values;
    }
  }

  // The points inside the bounds at level maxZoom + 1, as node indices, given
  // the maxZoom tree. That level is the maxZoom one with each cluster replaced
  // by its children, all of them points (a cluster formed at maxZoom folds
  // input points only), so it is read from the maxZoom tree rather than kept as
  // a tree of its own. A child lies within r of the point its cluster grew
  // from, and so does the centroid, so within 2r of the centroid: the tree is
  // queried with the bounds widened by that, then each point is tested against
  // the bounds.
  void pointsInBounds(const KDTree& maxZoomTree, double minX, double minY, double maxX, double maxY,
                      std::vector<int32_t>& points) const {
    const double r = clusterRadiusAtZoom(_options.radius, static_cast<double>(_options.maxZoom));
    // The slack covers rounding: relative in the radius test, and up to an
    // ulp of `extent` per point summed into a centroid.
    const double margin = 2.0 * r * (1.0 + 1e-9) +
      static_cast<double>(_options.extent) * static_cast<double>(_points.size()) *
        std::numeric_limits<double>::epsilon();

    std::vector<int32_t> nodes;
    maxZoomTree.range(minX - margin, minY - margin, maxX + margin, maxY + margin, nodes);
    points.clear();
    auto addIfInside = [&](int32_t index) {
      const ClusterNode& point = _nodes[index];
      if (point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY) {
        points.push_back(index);
      }
    };
    for (const int32_t index : nodes) {
      if (!_nodes[index].isCluster) {
        addIfInside(index);
        continue;
      }
      const size_t cluster = static_cast<size_t>(index) - _points.size();
      for (int32_t c = _childOffsets[cluster]; c < _childOffsets[cluster + 1]; c++) {
        addIfInside(_childNodes[c]);
      }
    }
  }

  // Point ids come from the caller. packPoints numbers them 0..count-1, so a
  // table indexed by id is the usual case; ids too sparse for one are looked
  // up in a sorted list instead. A repeated id resolves to its last point.
  void indexPointIds() {
    const size_t count = _points.size();
    int32_t minId = std::numeric_limits<int32_t>::max();
    int32_t maxId = std::numeric_limits<int32_t>::min();
    for (const auto& point : _points) {
      minId = std::min(minId, point.id);
      maxId = std::max(maxId, point.id);
    }

    if (minId >= 0 && static_cast<size_t>(maxId) < std::max<size_t>(count * 4, 1024)) {
      _nodeByPointId.assign(static_cast<size_t>(maxId) + 1, -1);
      for (size_t i = 0; i < count; i++) {
        _nodeByPointId[static_cast<size_t>(_points[i].id)] = static_cast<int32_t>(i);
      }
      return;
    }

    _sparsePointIds.reserve(count);
    for (size_t i = 0; i < count; i++) {
      _sparsePointIds.emplace_back(_points[i].id, static_cast<int32_t>(i));
    }
    std::sort(_sparsePointIds.begin(), _sparsePointIds.end());
  }

  /** The index in `_nodes` of the point or cluster with this id, or -1. */
  int32_t findNode(int32_t id) const {
    const int64_t clusterOffset = static_cast<int64_t>(id) - _firstClusterId;
    const int64_t clusterCount = static_cast<int64_t>(_nodes.size() - _points.size());
    if (clusterOffset >= 0 && clusterOffset < clusterCount) {
      return static_cast<int32_t>(static_cast<int64_t>(_points.size()) + clusterOffset);
    }

    if (!_nodeByPointId.empty()) {
      return id >= 0 && static_cast<size_t>(id) < _nodeByPointId.size()
        ? _nodeByPointId[static_cast<size_t>(id)]
        : -1;
    }

    // The last entry with this id: pairs sort by id, then by node index.
    auto it = std::upper_bound(
      _sparsePointIds.begin(), _sparsePointIds.end(), id,
      [](int32_t value, const std::pair<int32_t, int32_t>& entry) { return value < entry.first; }
    );
    if (it == _sparsePointIds.begin()) return -1;
    --it;
    return it->first == id ? it->second : -1;
  }

  ClusterEngineConfig _options;
  std::vector<PointData> _points;
  // Built by build(): see there.
  std::vector<ClusterNode> _nodes;
  // One tree per distinct level; `_treeByZoom[z - minZoom]` picks the one for z.
  std::vector<KDTree> _trees;
  std::vector<int32_t> _treeByZoom;
  // Children of the k-th cluster (`_nodes[_points.size() + k]`):
  // `_childNodes[_childOffsets[k]]` up to `_childNodes[_childOffsets[k + 1]]`.
  std::vector<int32_t> _childOffsets;
  std::vector<int32_t> _childNodes;
  std::vector<int32_t> _nodeByPointId;
  std::vector<std::pair<int32_t, int32_t>> _sparsePointIds;
  int32_t _firstClusterId = 0;
  bool _built = false;
  bool _skipLonelyQueries = true;
  bool _reuseTrees = true;
};

} // namespace margelo::nitro::nitromapcluster
