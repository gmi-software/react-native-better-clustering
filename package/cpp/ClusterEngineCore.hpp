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
#include <functional>
#include <bit>
#include <cmath>
#include <limits>
#include <numeric>
#include <optional>
#include <span>
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
   * slot, or when the range to sort holds more items than `*sortBudget`,
   * which is otherwise lowered by as many.
   */
  template <typename Moved>
  bool place(const Item& item, Moved&& moved, size_t* sortBudget = nullptr) {
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
        if (sortBudget != nullptr) {
          const size_t sorted = static_cast<size_t>(range.right - range.left + 1);
          if (sorted > *sortBudget) return false;
          *sortBudget -= sorted;
        }
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

  /** The position of the item with this index and these coordinates, or -1 when no query returns it. */
  int32_t find(double x, double y, int32_t index) const {
    if (_items.empty()) return -1;
    return findRecurse(0, static_cast<int32_t>(_items.size()) - 1, 0, x, y, index);
  }

  /** The items queries return, in the tree's order. */
  std::vector<Item> liveItems() const {
    std::vector<Item> items;
    items.reserve(_items.size());
    for (const Item& item : _items) {
      if (!isRemoved(item)) items.push_back(item);
    }
    return items;
  }

  /** Replaces the index of every item queries return with `map[index]`. */
  void renumber(const std::vector<int32_t>& map) {
    for (Item& item : _items) {
      if (!isRemoved(item)) item.index = map[static_cast<size_t>(item.index)];
    }
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

  // Follows the splits the way place() does, into both sides of a split the
  // coordinate lies on, since the items equal to it may be on either.
  int32_t findRecurse(int32_t left, int32_t right, int32_t axis, double x, double y, int32_t index) const {
    if (right - left <= _nodeSize) {
      for (int32_t i = left; i <= right; i++) {
        const Item& item = _items[i];
        if (item.index == index && item.x == x && item.y == y) return i;
      }
      return -1;
    }

    const int32_t mid = (left + right) >> 1;
    const Item& item = _items[mid];
    if (item.index == index && item.x == x && item.y == y) return mid;

    const double coord = axis == 0 ? item.x : item.y;
    const double q = axis == 0 ? x : y;
    if (q <= coord) {
      const int32_t found = findRecurse(left, mid - 1, axis ^ 1, x, y, index);
      if (found >= 0) return found;
    }
    if (q >= coord) {
      return findRecurse(mid + 1, right, axis ^ 1, x, y, index);
    }
    return -1;
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

    const size_t pointCount = _points.size();

    // Every point and cluster lives in `_nodes` exactly once, as it was
    // created: points first, in `_points` order, then clusters in the order
    // they form. Everything else refers to a node by its index there.
    addPointNodes();

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
    std::vector<int32_t> members;
    std::vector<uint64_t> foldBits;

    // At high zooms nearly every node is alone within the level's radius, yet
    // each would still be queried at every level. `certificate[i]` is a lower
    // bound on the squared distance from node i to every other node of the
    // level being clustered (0 when unknown): while it exceeds the radius
    // squared, the query would find only node i, so the node skips it. A lonely
    // node's query certifies it with the nearest item it reads or subtree it
    // prunes, however far that is, so a sparse node skips its queries for as
    // many levels as its neighbours allow. Each cluster a level forms lowers the
    // certificates of the nodes it may have come closer to (see
    // certifyNewClusters and lowerCertificates), and nodes that leave only make
    // the others conservative. The trees, the order of the nodes and every
    // query that does run are unchanged, so the index is the same.
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
    // from a fresh one (see KDTree::within), in another order, and every
    // cluster folds its nodes in an order of their own (see sortForFold), so
    // the index does not depend on which tree a level got. getClusters still
    // returns a patched level's nodes in its tree's order.
    // With minPoints above 2 the walk order of a level depends on the order
    // its queries return nodes, so every level gets a fresh tree.
    const bool patchable = _options.minPoints <= 2;
    size_t baseSize = pointCount;
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
            certificate[index] = certifiedBound(bound2);
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
          // Gathered, ordered and linked a cluster at a time rather than a
          // push_back per member: a cluster of all the points has as many
          // members, and whether push_back is inlined is up to the compiler.
          if (members.size() < neighbors.size()) members.resize(neighbors.size());
          size_t memberCount = 0;
          int32_t lowest = std::numeric_limits<int32_t>::max();
          int32_t highest = -1;
          for (const int32_t nb : neighbors) {
            if (processedAt[nb] <= z) continue;
            processedAt[nb] = z;
            members[memberCount++] = nb;
            lowest = std::min(lowest, nb);
            highest = std::max(highest, nb);
          }
          const std::span<int32_t> folded(members.data(), memberCount);
          sortForFold(folded, lowest, highest, foldBits);
          ClusterNode cluster =
            foldCluster(_nodes[index], folded, z, [this](int32_t i) -> const ClusterNode& { return _nodes[i]; });
          cluster.id = _firstClusterId + static_cast<int32_t>(_nodes.size() - pointCount);

          _nodes[index].parentId = cluster.id;
          _childNodes.push_back(index);
          _childNodes.insert(_childNodes.end(), folded.begin(), folded.end());
          for (const int32_t nb : folded) {
            _nodes[nb].parentId = cluster.id;
          }

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
        // Whether this level is one to patch, by the rule above, even when a
        // cluster finds no free slot or the tests switched patching off.
        const bool patched = patchable && (baseSize - next.size()) * kSlotsPerFreeSlot <= baseSize;
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
          // No farther than any certificate reaches, which dense data keeps short.
          const double radius = std::min(r * kCertificateReach, std::sqrt(static_cast<double>(largestCertificate)));
          certifyNewClusters(_trees[_treeByZoom[slot]], next, firstNewNode, radius, r, certificate);
        } else {
          lowerCertificates(next, firstNewNode, r, certificate);
        }
      }
      std::swap(current, next);
    }

    indexPointIds();
    _built = true;
  }

  /**
   * Builds the index build() would, from the index of `base`: an engine built
   * with the same options over points of which a few have moved, changed
   * their values, come or gone since, the others in the same order (their
   * ids may differ). Only the clustering those points can reach is done
   * again, level by level, so an update of a few points among many costs a
   * small part of a build. The index is the one build() makes, but for the
   * order getClusters() returns a level's nodes in.
   *
   * False, leaving the engine unbuilt, when `base` cannot serve: it is not
   * built, has other options, clusters with minPoints above 2, too many
   * points changed, or reusing it costs more than a build. Call build() then.
   */
  bool buildFrom(const ClusterEngineCore& base);

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

    const bool unlimited = limit <= 0;
    const int32_t available = std::max(_nodes[root].count - std::max(offset, 0), 0);
    result.reserve(static_cast<size_t>(unlimited ? available : std::min(limit, available)));
    if (!_nodes[root].isCluster) {
      if (offset <= 0) result.push_back(_nodes[root]);
      return result;
    }

    std::vector<ChildRange> stack;
    stack.reserve(kChildStackDepth);
    stack.push_back(childRange(static_cast<size_t>(root)));
    int32_t skipped = 0;

    while (!stack.empty() && (unlimited || static_cast<int32_t>(result.size()) < limit)) {
      ChildRange& range = stack.back();
      if (range.next == range.end) {
        stack.pop_back();
        continue;
      }
      const int32_t index = _childNodes[static_cast<size_t>(range.next++)];
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
        stack.push_back(childRange(static_cast<size_t>(index)));
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
    // Points come first in `_nodes`, in `_points` order, so a leaf's
    // coordinates are read where they were loaded, as JS has them.
    const auto extend = [&](size_t index) {
      const PointData& point = _points[index];
      bounds.north = std::max(bounds.north, point.latitude);
      bounds.south = std::min(bounds.south, point.latitude);
      bounds.east = std::max(bounds.east, point.longitude);
      bounds.west = std::min(bounds.west, point.longitude);
    };
    if (static_cast<size_t>(root) < _points.size()) {
      extend(static_cast<size_t>(root));
      return bounds;
    }

    std::vector<ChildRange> stack;
    stack.reserve(kChildStackDepth);
    stack.push_back(childRange(static_cast<size_t>(root)));

    while (!stack.empty()) {
      ChildRange& range = stack.back();
      if (range.next == range.end) {
        stack.pop_back();
        continue;
      }
      const size_t index = static_cast<size_t>(_childNodes[static_cast<size_t>(range.next++)]);
      if (index < _points.size()) {
        extend(index);
      } else {
        stack.push_back(childRange(index));
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

  /**
   * Whether buildFrom() gives up on an update that costs more than a build,
   * and leaves the next few to build() (see buildFrom). On by default; the
   * tests switch it off to check every update.
   */
  void setCapUpdateCost(bool cap) { _capUpdateCost = cap; }

  /** A copy with the same options and points and no index, ready to `build()`. */
  ClusterEngineCore withoutIndex() const {
    ClusterEngineCore copy;
    copy._options = _options;
    copy._points = _points;
    copy._skipLonelyQueries = _skipLonelyQueries;
    copy._reuseTrees = _reuseTrees;
    copy._capUpdateCost = _capUpdateCost;
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
  class IndexUpdate;

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

  // How far around each new cluster certifyNewClusters() updates certificates
  // exactly, at most, in radii of the level that formed it.
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
  // sortForFold() orders this many members or more by a bitmap, when they
  // span at most this many indices per member.
  static constexpr size_t kBitmapFoldSize = 256;
  static constexpr size_t kBitmapFoldSpan = 16;
  // getLeaves() and getClusterBounds() walk down a cluster with one range per
  // level they descended, so this many covers the zoom range of most maps
  // without reallocating.
  static constexpr size_t kChildStackDepth = 32;

  // The children of a cluster that a walk down the index has yet to visit:
  // `_childNodes[next, end)`. A walk pushes one range per cluster rather than
  // one index per child, so its cost does not hang on push_back being inlined.
  struct ChildRange {
    int32_t next;
    int32_t end;
  };

  ChildRange childRange(size_t index) const {
    const size_t cluster = index - _points.size();
    return {_childOffsets[cluster], _childOffsets[cluster + 1]};
  }

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
      // The float below, as std::nextafter would give it, without the call:
      // `result` is positive and finite here.
      result = std::bit_cast<float>(std::bit_cast<uint32_t>(result) - 1);
    }
    return result;
  }

  // After a level that formed the clusters from `firstNewNode` on, with radius
  // `r`, updates the certificates of `nodes`, the nodes of that level, and
  // certifies those clusters, by querying `tree`, the tree that holds them
  // all, `radius` around each cluster. A node within that of a cluster gets
  // the distance to it. A node farther than that from every cluster keeps its
  // certificate up to `radius`, and beyond that what lowerCertificates() would
  // leave it: the distance less `r`. Any `radius` is safe; a larger one keeps
  // more of the certificates and queries more nodes.
  void certifyNewClusters(const KDTree& tree, const std::vector<int32_t>& nodes, size_t firstNewNode, double radius,
                          double r, std::vector<float>& certificate) const {
    // What a node farther than `radius` from every new cluster is certified for.
    const float beyondRadius = certifiedBound(radius * radius);
    const double margin = r * (1.0 + 1e-6) + static_cast<double>(_options.extent) * 16 *
                                                  std::numeric_limits<double>::epsilon();
    for (const int32_t index : nodes) {
      if (static_cast<size_t>(index) >= firstNewNode || certificate[index] <= beyondRadius) continue;
      const double distance = std::sqrt(static_cast<double>(certificate[index])) - margin;
      certificate[index] = std::max(beyondRadius, distance > 0 ? certifiedBound(distance * distance) : 0.0f);
    }
    // Room for rounding, as in prunedGap2().
    const double reach = radius * (1.0 + 1e-6) +
                         static_cast<double>(_options.extent) * 16 * std::numeric_limits<double>::epsilon();
    for (size_t cluster = firstNewNode; cluster < _nodes.size(); cluster++) {
      const ClusterNode& node = _nodes[cluster];
      float nearest = beyondRadius;
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

  // The point nodes, the first `_points.size()` of `_nodes`, unlinked.
  void addPointNodes() {
    const size_t np = _options.reducers.size();
    _nodes.reserve(_points.size());
    for (const PointData& point : _points) {
      ClusterNode node;
      node.id = point.id;
      node.x = point.x;
      node.y = point.y;
      node.count = 1;
      node.parentId = -1;
      node.pointIndex = point.id;
      node.isCluster = false;
      node.zoom = _options.maxZoom + 1;
      node.minLeafId = node.id;
      if (np > 0) {
        node.values.assign(np, 0.0);
        for (size_t k = 0; k < np && k < point.values.size(); k++) {
          node.values[k] = point.values[k];
        }
      }
      _nodes.push_back(std::move(node));
    }
    _childOffsets.push_back(0);
  }

  // Puts the nodes a cluster folds in the order it folds them, the order
  // they were created in: their index in `_nodes`. It does not depend on the
  // tree that found them, so the centroid and the aggregates round the same
  // whichever tree a level got, or when buildFrom() makes the index.
  // `lowest` and `highest` bound the indices. Points that all lie within one
  // radius fold into one cluster at maxZoom, so a large cluster is ordered
  // without comparing: by counting when its indices are consecutive, as they
  // are then, else by a bitmap over the indices it spans.
  static void sortForFold(std::span<int32_t> members, int32_t lowest, int32_t highest, std::vector<uint64_t>& bits) {
    if (members.size() < kBitmapFoldSize) {
      std::sort(members.begin(), members.end());
      return;
    }
    const size_t span = static_cast<size_t>(highest - lowest) + 1;
    if (span == members.size()) {
      std::iota(members.begin(), members.end(), lowest);
      return;
    }
    if (span / kBitmapFoldSpan > members.size()) {
      std::sort(members.begin(), members.end());
      return;
    }
    bits.assign((span + 63) / 64, 0);
    for (const int32_t member : members) {
      const size_t offset = static_cast<size_t>(member - lowest);
      bits[offset / 64] |= uint64_t{1} << (offset % 64);
    }
    size_t next = 0;
    for (size_t word = 0; word < bits.size(); word++) {
      for (uint64_t set = bits[word]; set != 0; set &= set - 1) {
        members[next++] = lowest + static_cast<int32_t>(word * 64 + static_cast<size_t>(std::countr_zero(set)));
      }
    }
  }

  // The cluster that `origin` forms at `zoom` with `members`, in fold order:
  // all but its id and parent.
  template <typename NodeAt>
  ClusterNode foldCluster(const ClusterNode& origin, std::span<const int32_t> members, int32_t zoom,
                          const NodeAt& nodeAt) const {
    const size_t np = _options.reducers.size();
    int32_t numPoints = origin.count;
    double wx = origin.x * origin.count;
    double wy = origin.y * origin.count;

    ClusterNode cluster;
    cluster.parentId = -1;
    cluster.pointIndex = -1;
    cluster.isCluster = true;
    cluster.zoom = zoom;
    cluster.minLeafId = origin.minLeafId;
    if (np > 0) {
      // Seed the accumulator with the origin node's values, then fold.
      cluster.values = origin.values;
      cluster.values.resize(np, 0.0);
    }

    for (const int32_t member : members) {
      const ClusterNode& child = nodeAt(member);
      const int32_t np2 = child.count;
      numPoints += np2;
      wx += child.x * np2;
      wy += child.y * np2;
      cluster.minLeafId = std::min(cluster.minLeafId, child.minLeafId);
      for (size_t k = 0; k < np; k++) {
        const double v = k < child.values.size() ? child.values[k] : reducerSeed(_options.reducers[k]);
        cluster.values[k] = reducerApply(_options.reducers[k], cluster.values[k], v);
      }
    }

    cluster.count = numPoints;
    cluster.x = wx / numPoints;
    cluster.y = wy / numPoints;
    return cluster;
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
  bool _capUpdateCost = true;
  // How many buildFrom() calls in a row, starting from this engine as their
  // base, give up without trying, and how many the last failure set.
  uint8_t _updatesToSkip = 0;
  uint8_t _updateBackoff = 0;
  static constexpr int kMaxUpdatesToSkip = 32;
};

// buildFrom(): carries `base`'s index over to the points of `out`.
//
// With minPoints at most 2, build() clusters a level by a greedy walk whose
// outcome has a closed form. The walk visits the level's nodes by their
// seed, the point a node grew from (a cluster's is its first child's): every
// level lists its nodes in that order. A node is an origin when no origin
// with a smaller seed lies within the radius; otherwise it folds into the
// first such origin, its owner. An origin with nodes folded into it forms a
// cluster, the others pass on unchanged. Both only depend on the positions of
// the level's nodes, and on which of those before them are origins.
//
// So when nodes of a level change, only the nodes within the radius of where
// one was or now is can change, and then the nodes after one that flips
// between origin and not, within its radius, transitively. The update visits
// those by seed, works out each one's origin and owner, and leaves every
// other node as base has it. It then compares each origin it touched with
// base: an origin whose cluster gained, lost or changed a node, moved, or
// appeared or went away, is a change of the level below, where it starts over.
//
// The points are paired with base's in order first (see align()). Nodes are
// referred to by handles while the update runs: base's node indices, which
// for points paired with new ones hold their new data, then the points
// added, then the clusters the update makes.
// Each level's tree is a copy of base's, patched by the level's changes; the
// last step numbers every node as build() would and renumbers the trees.
class ClusterEngineCore::IndexUpdate {
public:
  IndexUpdate(ClusterEngineCore& out, const ClusterEngineCore& base)
      : _out(out),
        _base(base),
        _options(out._options),
        _basePoints(base._points.size()),
        _newPoints(out._points.size()),
        _baseCount(base._nodes.size()) {}

  enum class Outcome {
    Done,
    // So many points changed that a build costs less: known up front.
    TooManyChanged,
    // The update did more work than a build would, and gave up.
    TooCostly,
  };

  Outcome run() {
    _out.addPointNodes();

    std::vector<Change> changes;
    if (!align(changes)) return Outcome::TooManyChanged;

    prepare();
    if (_out._capUpdateCost) _maxVisits = _newPoints * kVisitsPerPoint;

    const int32_t levels = _options.maxZoom - _options.minZoom + 1;
    _treeOfSlot.assign(static_cast<size_t>(levels), -1);
    _trees.reserve(static_cast<size_t>(levels));
    _freshByLevel.resize(static_cast<size_t>(levels));
    std::vector<Change> next;
    for (int32_t z = _options.maxZoom; z >= _options.minZoom; z--) {
      if (!clusterLevel(z, changes, next) || !patchTree(z, next)) return Outcome::TooCostly;
      std::swap(changes, next);
    }

    assemble();
    return Outcome::Done;
  }

private:
  // A node of a level that may differ from base's: base's node with this
  // seed, `before`, and the update's, `after`, either -1 when that level has
  // none. A point paired with one of base's that changed is both: its handle.
  struct Change {
    int32_t seed;
    int32_t before;
    int32_t after;
  };

  // Above this share of the points changed, added or removed, a build costs
  // less.
  static constexpr size_t kChangedShare = 64;
  // How far align() looks ahead for the next point both have.
  static constexpr size_t kAlignReach = 16;
  // An update gives up for a build once its queries have returned this many
  // nodes per point, or one query returned more than one point in
  // kCrowdedShare: where nodes crowd within one radius, every node it visits
  // returns them all, where build() would fold them in one query.
  static constexpr size_t kVisitsPerPoint = 2;
  static constexpr size_t kCrowdedShare = 16;
  // Above this share of a level's nodes changed, its tree is built afresh
  // rather than patched.
  static constexpr size_t kChangesPerFreshTree = 64;
  static constexpr int32_t kNever = std::numeric_limits<int32_t>::min();

  ClusterEngineCore& _out;
  const ClusterEngineCore& _base;
  const ClusterEngineConfig& _options;
  const size_t _basePoints;
  const size_t _newPoints;
  const size_t _baseCount;

  // How align() paired the points: the new index of each of base's points,
  // -1 for one removed, and the seed it gave each, the position of the pair,
  // or of the point alone, in both orders merged.
  std::vector<int32_t> _newOfBase;
  std::vector<int32_t> _baseSeed;
  // The points added, in order: handle `_baseCount + k` is new point
  // `_addedNew[k]`, with seed `_addedSeed[k]`.
  std::vector<int32_t> _addedNew;
  std::vector<int32_t> _addedSeed;
  size_t _seedCount = 0;
  // Whether a point kept by the update has another id now.
  bool _idsChanged = false;
  // The first handle of the clusters this update makes.
  size_t _freshBase = 0;
  // The points that are new or have changed, by handle.
  std::vector<int32_t> _changedPoints;
  // How many nodes the update's queries have returned, and how many make it
  // give up.
  size_t _visited = 0;
  size_t _maxVisits = std::numeric_limits<size_t>::max();
  // The clusters this update makes: handle `_freshBase + k` is `_fresh[k]`, and
  // its children are `_freshChildren[_freshChildOffsets[k]]` up to the next
  // offset, its origin first.
  std::vector<ClusterNode> _fresh;
  std::vector<int32_t> _freshChildren;
  std::vector<int32_t> _freshChildOffsets{0};
  // Per level, the clusters this update made there, by seed.
  std::vector<std::vector<int32_t>> _freshByLevel;

  // Per handle.
  std::vector<int32_t> _seed;
  std::vector<int32_t> _queuedAt;
  std::vector<int32_t> _evaluatedAt;
  std::vector<int32_t> _owner;

  // Per seed: the level that lists it as a change, with its handles there,
  // and the level that touched its origin, with its handle when unchanged.
  std::vector<int32_t> _changedAt;
  std::vector<int32_t> _before;
  std::vector<int32_t> _after;
  std::vector<int32_t> _touchedAt;
  std::vector<int32_t> _touchHandle;
  std::vector<int32_t> _touched;

  // Base's clusters that formed at a level, `[begin, end)` per slot, and
  // which of them this update replaced.
  std::vector<int32_t> _baseLevelBegin;
  std::vector<int32_t> _baseLevelEnd;
  std::vector<bool> _replaced;
  std::vector<int32_t> _replacedAt;

  std::vector<KDTree> _trees;
  std::vector<int32_t> _treeOfSlot;

  std::vector<std::pair<int32_t, int32_t>> _queue;
  std::vector<int32_t> _neighbors;
  std::vector<int32_t> _members;

  static bool sameBits(double a, double b) {
    return std::bit_cast<uint64_t>(a) == std::bit_cast<uint64_t>(b);
  }

  static bool sameValues(const std::vector<double>& a, const std::vector<double>& b) {
    if (a.size() != b.size()) return false;
    for (size_t k = 0; k < a.size(); k++) {
      if (!sameBits(a[k], b[k])) return false;
    }
    return true;
  }

  size_t slot(int32_t z) const { return static_cast<size_t>(z - _options.minZoom); }

  // The node a handle stands for in the update: points with their new data.
  const ClusterNode& node(int32_t handle) const {
    const size_t h = static_cast<size_t>(handle);
    if (h < _basePoints) {
      const int32_t now = _newOfBase[h];
      return now >= 0 ? _out._nodes[static_cast<size_t>(now)] : _base._nodes[h];
    }
    if (h < _baseCount) return _base._nodes[h];
    if (h < _freshBase) return _out._nodes[static_cast<size_t>(_addedNew[h - _baseCount])];
    return _fresh[h - _freshBase];
  }

  // Pairs base's points with the new ones, in order: a pair with the same
  // position and values is unchanged, one without is a point that changed,
  // and the points left over were removed or added. Ids play no part:
  // packPoints() numbers points by position, so one added shifts the ids of
  // all after it. Any pairing in order makes the same index, so this only
  // looks a little ahead for the next point both have, and pairs the points
  // up to it otherwise. False once more points changed than an update is
  // worth.
  bool align(std::vector<Change>& changes) {
    const auto same = [this](size_t b, size_t n) {
      const ClusterNode& was = _base._nodes[b];
      const ClusterNode& now = _out._nodes[n];
      return sameBits(was.x, now.x) && sameBits(was.y, now.y) && sameValues(was.values, now.values);
    };
    _newOfBase.assign(_basePoints, -1);
    _baseSeed.assign(_basePoints, -1);
    const size_t maxChanges = _newPoints / kChangedShare;
    size_t b = 0;
    size_t n = 0;
    const auto pair = [&](bool changed) {
      const int32_t seed = static_cast<int32_t>(_seedCount++);
      const int32_t handle = static_cast<int32_t>(b);
      _newOfBase[b] = static_cast<int32_t>(n);
      _baseSeed[b] = seed;
      _idsChanged = _idsChanged || _base._points[b].id != _out._points[n].id;
      if (changed) {
        changes.push_back({seed, handle, handle});
        _changedPoints.push_back(handle);
      }
      b++;
      n++;
    };
    const auto remove = [&]() {
      const int32_t seed = static_cast<int32_t>(_seedCount++);
      _baseSeed[b] = seed;
      changes.push_back({seed, static_cast<int32_t>(b), -1});
      b++;
    };
    const auto add = [&]() {
      const int32_t seed = static_cast<int32_t>(_seedCount++);
      const int32_t handle = static_cast<int32_t>(_baseCount + _addedNew.size());
      _addedNew.push_back(static_cast<int32_t>(n));
      _addedSeed.push_back(seed);
      changes.push_back({seed, -1, handle});
      _changedPoints.push_back(handle);
      n++;
    };

    while (b < _basePoints || n < _newPoints) {
      if (b < _basePoints && n < _newPoints && same(b, n)) {
        pair(false);
        continue;
      }
      if (b == _basePoints) {
        add();
      } else if (n == _newPoints) {
        remove();
      } else if (b + 1 == _basePoints || n + 1 == _newPoints || same(b + 1, n + 1)) {
        // One point changed, the most common case: the next pair is the same.
        pair(true);
      } else {
        size_t removed = 0;
        size_t added = 0;
        for (size_t k = 1; k <= kAlignReach && removed == 0 && added == 0; k++) {
          if (b + k < _basePoints && same(b + k, n)) removed = k;
          else if (n + k < _newPoints && same(b, n + k)) added = k;
        }
        if (removed == 0 && added == 0) pair(true);
        for (; removed > 0; removed--) remove();
        for (; added > 0; added--) add();
      }
      if (changes.size() > maxChanges) return false;
    }
    return true;
  }

  // The cluster base folded `handle`, a node of its level z + 1, into at
  // level z, or -1 when the node passes level z on.
  int32_t baseParentAt(int32_t handle, int32_t z) const {
    const int32_t parentId = _base._nodes[static_cast<size_t>(handle)].parentId;
    if (parentId < 0) return -1;
    const int32_t parent = static_cast<int32_t>(_basePoints) + (parentId - _base._firstClusterId);
    return _base._nodes[static_cast<size_t>(parent)].zoom == z ? parent : -1;
  }

  int32_t baseFirstChild(int32_t cluster) const {
    return _base._childNodes[static_cast<size_t>(_base._childOffsets[static_cast<size_t>(cluster) - _basePoints])];
  }

  // The origin that base's node `handle` of level z + 1 folded into at level
  // z: itself when it is one.
  int32_t baseOwner(int32_t handle, int32_t z) const {
    const int32_t parent = baseParentAt(handle, z);
    return parent < 0 ? handle : baseFirstChild(parent);
  }

  bool isOrigin(int32_t handle, int32_t z) const {
    const size_t h = static_cast<size_t>(handle);
    return _evaluatedAt[h] == z ? _owner[h] == handle : baseOwner(handle, z) == handle;
  }

  int32_t ownerOf(int32_t handle, int32_t z) const {
    const size_t h = static_cast<size_t>(handle);
    return _evaluatedAt[h] == z ? _owner[h] : baseOwner(handle, z);
  }

  bool changedAt(int32_t seed, int32_t z) const { return _changedAt[static_cast<size_t>(seed)] == z; }

  void prepare() {
    _freshBase = _baseCount + _addedNew.size();
    _seed.resize(_freshBase);
    std::copy(_baseSeed.begin(), _baseSeed.end(), _seed.begin());
    // Children precede their cluster.
    for (size_t i = _basePoints; i < _baseCount; i++) {
      _seed[i] = _seed[static_cast<size_t>(baseFirstChild(static_cast<int32_t>(i)))];
    }
    std::copy(_addedSeed.begin(), _addedSeed.end(), _seed.begin() + static_cast<std::ptrdiff_t>(_baseCount));
    _queuedAt.assign(_freshBase, kNever);
    _evaluatedAt.assign(_freshBase, kNever);
    _owner.assign(_freshBase, -1);

    _changedAt.assign(_seedCount, kNever);
    _before.assign(_seedCount, -1);
    _after.assign(_seedCount, -1);
    _touchedAt.assign(_seedCount, kNever);
    _touchHandle.assign(_seedCount, -1);

    // Base formed its clusters level by level, from maxZoom down.
    const size_t levels = slot(_options.maxZoom) + 1;
    _baseLevelBegin.assign(levels, 0);
    _baseLevelEnd.assign(levels, 0);
    for (size_t i = _baseCount; i-- > _basePoints;) {
      const size_t s = slot(_base._nodes[i].zoom);
      if (_baseLevelEnd[s] == 0) _baseLevelEnd[s] = static_cast<int32_t>(i) + 1;
      _baseLevelBegin[s] = static_cast<int32_t>(i);
    }
    _replaced.assign(_baseCount - _basePoints, false);
    _replacedAt.assign(levels, 0);
  }

  // The handles of the update's level z + 1 within `r` of (x, y), into `out`.
  void query(int32_t z, double x, double y, double r, std::vector<int32_t>& out) {
    if (z < _options.maxZoom) {
      _trees[static_cast<size_t>(_treeOfSlot[slot(z + 1)])].within(x, y, r, out);
      count(out.size());
      return;
    }
    // The points: base keeps no tree of them, but its maxZoom tree reaches
    // every point through the clusters formed there, each within twice the
    // radius of its centroid (see pointsInBounds). Points that changed, were
    // removed or added are read where they are now, if anywhere.
    out.clear();
    const double r2 = r * r;
    const auto addIfWithin = [&](int32_t point) {
      const ClusterNode& p = node(point);
      const double dx = p.x - x;
      const double dy = p.y - y;
      if (dx * dx + dy * dy <= r2) out.push_back(point);
    };
    const double margin = 2.0 * r * (1.0 + 1e-9) + static_cast<double>(_options.extent) *
                                                         static_cast<double>(_basePoints) *
                                                         std::numeric_limits<double>::epsilon();
    const KDTree& tree = _base._trees[static_cast<size_t>(_base._treeByZoom[slot(_options.maxZoom)])];
    tree.forEachWithin(x, y, r + margin, [&](int32_t index) {
      if (static_cast<size_t>(index) >= _basePoints) {
        const size_t cluster = static_cast<size_t>(index) - _basePoints;
        for (int32_t c = _base._childOffsets[cluster]; c < _base._childOffsets[cluster + 1]; c++) {
          const int32_t point = _base._childNodes[static_cast<size_t>(c)];
          if (!changedAt(_seed[static_cast<size_t>(point)], z)) addIfWithin(point);
        }
      } else if (!changedAt(_seed[static_cast<size_t>(index)], z)) {
        addIfWithin(index);
      }
    });
    for (const int32_t point : _changedPoints) {
      addIfWithin(point);
    }
    count(out.size());
  }

  // Counts what a query returned against the update's budget, which one
  // query alone exhausts when it returns a share of all the points: they
  // crowd within one radius, and each node after it would return them too.
  void count(size_t returned) {
    _visited += returned;
    if (returned > _maxVisits / (kVisitsPerPoint * kCrowdedShare)) _visited = _maxVisits + 1;
  }

  bool gaveUp() const { return _visited > _maxVisits; }

  void enqueue(int32_t handle, int32_t z) {
    const size_t h = static_cast<size_t>(handle);
    if (_queuedAt[h] == z) return;
    _queuedAt[h] = z;
    _queue.emplace_back(_seed[h], handle);
    std::push_heap(_queue.begin(), _queue.end(), std::greater<>());
  }

  void enqueueAround(int32_t z, double x, double y, double r) {
    query(z, x, y, r, _neighbors);
    if (gaveUp()) return;
    for (const int32_t handle : _neighbors) {
      enqueue(handle, z);
    }
  }

  void touch(int32_t handle, int32_t z) {
    const size_t seed = static_cast<size_t>(_seed[static_cast<size_t>(handle)]);
    if (_touchedAt[seed] == z) return;
    _touchedAt[seed] = z;
    _touchHandle[seed] = handle;
    _touched.push_back(static_cast<int32_t>(seed));
  }

  // Clusters level z from base's and `changes` to its nodes, the update's
  // level z + 1, into the changes of level z. False once the update has
  // queried more than a build would.
  bool clusterLevel(int32_t z, const std::vector<Change>& changes, std::vector<Change>& next) {
    const double r = clusterRadiusAtZoom(_options.radius, static_cast<double>(z));
    next.clear();
    _touched.clear();

    for (const Change& change : changes) {
      const size_t seed = static_cast<size_t>(change.seed);
      _changedAt[seed] = z;
      _before[seed] = change.before;
      _after[seed] = change.after;
    }
    for (const Change& change : changes) {
      const bool moved = change.before < 0 || change.after < 0 ||
                         !sameBits(_base._nodes[static_cast<size_t>(change.before)].x, node(change.after).x) ||
                         !sameBits(_base._nodes[static_cast<size_t>(change.before)].y, node(change.after).y);
      if (change.before >= 0) {
        touch(baseOwner(change.before, z), z);
        if (moved) {
          const ClusterNode& was = _base._nodes[static_cast<size_t>(change.before)];
          enqueueAround(z, was.x, was.y, r);
        }
      }
      if (change.after >= 0) {
        enqueue(change.after, z);
        if (moved) enqueueAround(z, node(change.after).x, node(change.after).y, r);
      }
      if (gaveUp()) return false;
    }

    while (!_queue.empty()) {
      std::pop_heap(_queue.begin(), _queue.end(), std::greater<>());
      const int32_t handle = _queue.back().second;
      _queue.pop_back();
      evaluate(handle, z, r);
      if (gaveUp()) return false;
    }

    std::sort(_touched.begin(), _touched.end());
    for (const int32_t seed : _touched) {
      compareOrigin(seed, z, r, next);
      if (gaveUp()) return false;
    }
    return true;
  }

  // Works out whether `handle` is an origin of level z, and its owner, from
  // the nodes before it, which are settled by now.
  void evaluate(int32_t handle, int32_t z, double r) {
    const size_t h = static_cast<size_t>(handle);
    const int32_t seed = _seed[h];
    const ClusterNode& self = node(handle);
    query(z, self.x, self.y, r, _neighbors);

    int32_t owner = handle;
    int32_t ownerSeed = seed;
    for (const int32_t neighbor : _neighbors) {
      const int32_t neighborSeed = _seed[static_cast<size_t>(neighbor)];
      if (neighborSeed < ownerSeed && isOrigin(neighbor, z)) {
        owner = neighbor;
        ownerSeed = neighborSeed;
      }
    }

    // Base's node with this seed, which the nodes after it took as settled.
    const int32_t before = changedAt(seed, z) ? _before[static_cast<size_t>(seed)] : handle;
    const bool wasOrigin = before >= 0 && baseOwner(before, z) == before;
    _evaluatedAt[h] = z;
    _owner[h] = owner;
    if (before < 0 || wasOrigin != (owner == handle)) {
      for (const int32_t neighbor : _neighbors) {
        if (_seed[static_cast<size_t>(neighbor)] > seed) enqueue(neighbor, z);
      }
    }
    touch(owner, z);
    if (before >= 0) touch(baseOwner(before, z), z);
  }

  // Compares the origin with this seed, which the update touched at level z,
  // with base's, and lists it as a change of level z when they differ.
  void compareOrigin(int32_t seed, int32_t z, double r, std::vector<Change>& next) {
    const size_t s = static_cast<size_t>(seed);
    const bool changed = changedAt(seed, z);
    const int32_t before = changed ? _before[s] : _touchHandle[s];
    const int32_t after = changed ? _after[s] : _touchHandle[s];

    // What base's node with this seed passed on to level z.
    int32_t baseCluster = -1;
    int32_t was = -1;
    if (before >= 0 && baseOwner(before, z) == before) {
      baseCluster = baseParentAt(before, z);
      was = baseCluster >= 0 ? baseCluster : before;
    }

    int32_t now = -1;
    if (after >= 0 && isOrigin(after, z)) {
      const ClusterNode& origin = node(after);
      query(z, origin.x, origin.y, r, _neighbors);
      // By seed: a node left as base has it names base's node as its owner,
      // which may have changed in place since, without moving.
      _members.clear();
      for (const int32_t neighbor : _neighbors) {
        if (neighbor != after && _seed[static_cast<size_t>(ownerOf(neighbor, z))] == seed) {
          _members.push_back(neighbor);
        }
      }
      if (_members.empty()) {
        now = after;
      } else {
        sortForFold(_members);
        if (!changed && baseCluster >= 0 && sameChildren(baseCluster, after, z)) return;
        now = addCluster(after, z);
      }
    }

    if (now == was && (now < 0 || !changed)) return;
    if (baseCluster >= 0) {
      _replaced[static_cast<size_t>(baseCluster) - _basePoints] = true;
      _replacedAt[slot(z)]++;
    }
    next.push_back({seed, was, now});
  }

  // build()'s fold order (see ClusterEngineCore::sortForFold): the order
  // build() creates nodes in, by level from maxZoom down, then by seed.
  void sortForFold(std::vector<int32_t>& members) const {
    std::sort(members.begin(), members.end(), [this](int32_t a, int32_t b) {
      const int32_t zoomA = node(a).zoom;
      const int32_t zoomB = node(b).zoom;
      return zoomA != zoomB ? zoomA > zoomB : _seed[static_cast<size_t>(a)] < _seed[static_cast<size_t>(b)];
    });
  }

  // Whether base's cluster holds `origin` and `_members`, none of them changed.
  bool sameChildren(int32_t cluster, int32_t origin, int32_t z) const {
    const size_t k = static_cast<size_t>(cluster) - _basePoints;
    const int32_t begin = _base._childOffsets[k];
    const int32_t end = _base._childOffsets[k + 1];
    if (static_cast<size_t>(end - begin) != _members.size() + 1 || _base._childNodes[static_cast<size_t>(begin)] != origin) {
      return false;
    }
    for (size_t i = 0; i < _members.size(); i++) {
      const int32_t member = _members[i];
      if (_base._childNodes[static_cast<size_t>(begin) + 1 + i] != member ||
          changedAt(_seed[static_cast<size_t>(member)], z)) {
        return false;
      }
    }
    return true;
  }

  // Adds the cluster `origin` forms at level z with `_members`.
  int32_t addCluster(int32_t origin, int32_t z) {
    const int32_t handle = static_cast<int32_t>(_freshBase + _fresh.size());
    _fresh.push_back(
      _out.foldCluster(node(origin), _members, z, [this](int32_t h) -> const ClusterNode& { return node(h); }));
    _freshChildren.push_back(origin);
    _freshChildren.insert(_freshChildren.end(), _members.begin(), _members.end());
    _freshChildOffsets.push_back(static_cast<int32_t>(_freshChildren.size()));
    _freshByLevel[slot(z)].push_back(handle);
    _seed.push_back(_seed[static_cast<size_t>(origin)]);
    _queuedAt.push_back(kNever);
    _evaluatedAt.push_back(kNever);
    _owner.push_back(-1);
    return handle;
  }

  // The tree of the update's level z: base's, with `changes` applied. False
  // when base's tree lacks a node it should hold, which would be a bug.
  bool patchTree(int32_t z, const std::vector<Change>& changes) {
    const size_t s = slot(z);
    const int32_t baseClusters = _baseLevelEnd[s] - _baseLevelBegin[s];
    const size_t clusters = static_cast<size_t>(baseClusters - _replacedAt[s]) + _freshByLevel[s].size();
    // A level that forms no cluster holds the nodes of the one above.
    if (clusters == 0 && z < _options.maxZoom) {
      _treeOfSlot[s] = _treeOfSlot[s + 1];
      return true;
    }

    KDTree tree = _base._trees[static_cast<size_t>(_base._treeByZoom[s])];
    for (const Change& change : changes) {
      if (change.before < 0) continue;
      const ClusterNode& was = _base._nodes[static_cast<size_t>(change.before)];
      const int32_t position = tree.find(was.x, was.y, change.before);
      if (position < 0) return false;
      tree.remove(static_cast<size_t>(position));
    }
    // A node placed where its leaf has no free slot sorts a range around it
    // again: when many change, or once that has sorted as many items as the
    // tree holds, one fresh tree costs less. So does a tree with no free
    // slot left.
    size_t placed = changes.size() * kChangesPerFreshTree > tree.size() ? 0 : changes.size();
    size_t sortBudget = tree.size();
    for (size_t i = 0; i < placed; i++) {
      const int32_t after = changes[i].after;
      if (after >= 0 && !tree.place({node(after).x, node(after).y, after}, [](int32_t, int32_t) {}, &sortBudget)) {
        placed = i;
      }
    }
    if (placed < changes.size()) {
      std::vector<KDTree::Item> items = tree.liveItems();
      for (size_t i = placed; i < changes.size(); i++) {
        const int32_t after = changes[i].after;
        if (after >= 0) items.push_back({node(after).x, node(after).y, after});
      }
      tree.build(std::move(items), _options.nodeSize);
    }
    _trees.push_back(std::move(tree));
    _treeOfSlot[s] = static_cast<int32_t>(_trees.size() - 1);
    return true;
  }

  // Numbers the nodes as build() does, points first, then the clusters of
  // each level from maxZoom down by seed, and links them. When the points
  // kept have other ids, as after one was added or removed, each cluster's
  // smallest leaf is taken from its children again.
  void assemble() {
    std::vector<int32_t> finalIndex(_freshBase + _fresh.size(), -1);
    std::copy(_newOfBase.begin(), _newOfBase.end(), finalIndex.begin());
    std::copy(_addedNew.begin(), _addedNew.end(), finalIndex.begin() + static_cast<std::ptrdiff_t>(_baseCount));

    size_t clusterCount = 0;
    for (int32_t z = _options.maxZoom; z >= _options.minZoom; z--) {
      const size_t s = slot(z);
      clusterCount += static_cast<size_t>(_baseLevelEnd[s] - _baseLevelBegin[s] - _replacedAt[s]) + _freshByLevel[s].size();
    }
    _out._nodes.reserve(_newPoints + clusterCount);
    _out._childOffsets.reserve(clusterCount + 1);
    _out._childNodes.reserve(_base._childNodes.size() + _freshChildren.size());

    const auto add = [&](int32_t handle) {
      const size_t index = _out._nodes.size();
      finalIndex[static_cast<size_t>(handle)] = static_cast<int32_t>(index);
      ClusterNode cluster = node(handle);
      cluster.id = _out._firstClusterId + static_cast<int32_t>(index - _newPoints);
      cluster.parentId = -1;
      if (_idsChanged) cluster.minLeafId = std::numeric_limits<int32_t>::max();

      const auto link = [&](int32_t child) {
        const int32_t childIndex = finalIndex[static_cast<size_t>(child)];
        _out._childNodes.push_back(childIndex);
        ClusterNode& linked = _out._nodes[static_cast<size_t>(childIndex)];
        linked.parentId = cluster.id;
        if (_idsChanged) cluster.minLeafId = std::min(cluster.minLeafId, linked.minLeafId);
      };
      if (static_cast<size_t>(handle) < _baseCount) {
        const size_t k = static_cast<size_t>(handle) - _basePoints;
        for (int32_t c = _base._childOffsets[k]; c < _base._childOffsets[k + 1]; c++) {
          link(_base._childNodes[static_cast<size_t>(c)]);
        }
      } else {
        const size_t k = static_cast<size_t>(handle) - _freshBase;
        for (int32_t c = _freshChildOffsets[k]; c < _freshChildOffsets[k + 1]; c++) {
          link(_freshChildren[static_cast<size_t>(c)]);
        }
      }
      _out._childOffsets.push_back(static_cast<int32_t>(_out._childNodes.size()));
      _out._nodes.push_back(std::move(cluster));
    };

    for (int32_t z = _options.maxZoom; z >= _options.minZoom; z--) {
      const size_t s = slot(z);
      // Both lists are in seed order: merge them.
      int32_t baseCluster = _baseLevelBegin[s];
      const std::vector<int32_t>& fresh = _freshByLevel[s];
      size_t f = 0;
      while (baseCluster < _baseLevelEnd[s] || f < fresh.size()) {
        if (baseCluster < _baseLevelEnd[s] && _replaced[static_cast<size_t>(baseCluster) - _basePoints]) {
          baseCluster++;
          continue;
        }
        if (f == fresh.size() ||
            (baseCluster < _baseLevelEnd[s] && _seed[static_cast<size_t>(baseCluster)] < _seed[static_cast<size_t>(fresh[f])])) {
          add(baseCluster++);
        } else {
          add(fresh[f++]);
        }
      }
    }

    for (KDTree& tree : _trees) {
      tree.renumber(finalIndex);
    }
    _out._trees = std::move(_trees);
    _out._treeByZoom = std::move(_treeOfSlot);
    if (_idsChanged || _basePoints != _newPoints || !_addedNew.empty()) {
      _out.indexPointIds();
    } else {
      _out._nodeByPointId = _base._nodeByPointId;
      _out._sparsePointIds = _base._sparsePointIds;
    }
  }
};

inline bool ClusterEngineCore::buildFrom(const ClusterEngineCore& base) {
  resetDerivedState();
  _firstClusterId = firstFreeClusterId();
  const ClusterEngineConfig& a = _options;
  const ClusterEngineConfig& b = base._options;
  const bool sameOptions = a.radius == b.radius && a.minPoints == b.minPoints && a.minZoom == b.minZoom &&
                           a.maxZoom == b.maxZoom && a.extent == b.extent && a.nodeSize == b.nodeSize &&
                           a.clusteringEnabled == b.clusteringEnabled && a.reducers == b.reducers;
  if (!base._built || !sameOptions || !a.clusteringEnabled || a.minPoints > 2 || _points.empty() ||
      base._points.empty()) {
    return false;
  }

  // After an update that cost more than a build, the next ones are left to
  // build(): 1, then 2, 4 and up to 32 in a row while they keep failing.
  if (_capUpdateCost && base._updatesToSkip > 0) {
    _updateBackoff = base._updateBackoff;
    _updatesToSkip = static_cast<uint8_t>(base._updatesToSkip - 1);
    return false;
  }

  IndexUpdate update(*this, base);
  const IndexUpdate::Outcome outcome = update.run();
  if (outcome != IndexUpdate::Outcome::Done) {
    resetDerivedState();
    if (outcome == IndexUpdate::Outcome::TooCostly) {
      _updateBackoff = static_cast<uint8_t>(std::min(std::max(base._updateBackoff * 2, 1), kMaxUpdatesToSkip));
      _updatesToSkip = _updateBackoff;
    }
    return false;
  }
  _built = true;
  return true;
}

} // namespace margelo::nitro::nitromapcluster
