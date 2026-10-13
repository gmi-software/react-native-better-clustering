#pragma once

#include "GeoUtils.hpp"
#include "InputValidation.hpp"
#include <vector>
#include <cstdint>
#include <cstring>
#include <algorithm>
#include <cmath>
#include <limits>
#include <utility>

namespace margelo::nitro::nitromapcluster {

// Static KD-tree over 2D points, kdbush-style: a flat array of items is
// recursively partitioned in place on alternating axes. Query and build mirror
// each other exactly — same pivot `(left+right)/2`, same alternating axis —
// which is what makes range/within correct. Each item carries its coordinates,
// so a query reads the array in order instead of jumping through an index.
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

  void within(double x, double y, double radius, std::vector<int32_t>& result) const {
    result.clear();
    if (_items.empty()) return;
    withinRecurse(0, static_cast<int32_t>(_items.size()) - 1, 0, x, y, radius * radius, radius, result);
  }

  size_t memoryBytes() const {
    return _items.capacity() * sizeof(Item);
  }

private:
  std::vector<Item> _items;
  int32_t _nodeSize = 64;

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
      for (int32_t i = left; i <= right; i++) {
        const Item& item = _items[i];
        if (item.x >= minX && item.x <= maxX && item.y >= minY && item.y <= maxY) {
          result.push_back(item.index);
        }
      }
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

  void withinRecurse(int32_t left, int32_t right, int32_t axis,
                     double x, double y, double r2, double radius,
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

    if (q - radius <= coord) {
      withinRecurse(left, mid - 1, axis ^ 1, x, y, r2, radius, result);
    }
    if (q + radius >= coord) {
      withinRecurse(mid + 1, right, axis ^ 1, x, y, r2, radius, result);
    }
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
    if (data == nullptr || byteLength < 4) {
      resetDerivedState(true);
      return false;
    }

    uint32_t magic = 0;
    std::memcpy(&magic, data, 4);

    if (magic == kBufferMagicV2) {
      return parseBufferV2(data, byteLength);
    }

    return parseBufferV1(data, byteLength);
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

    // maxZoom+1 is the clustering input but is never queried directly
    // (getClusters clamps zoom to [minZoom, maxZoom]), so its tree is only
    // kept if maxZoom turns out to hold the very same nodes.
    KDTree inputTree = buildTree(current);

    const int32_t levels = _options.maxZoom - _options.minZoom + 1;
    _treeByZoom.assign(static_cast<size_t>(levels), -1);
    // No reallocation, so `tree` below stays valid while the next one is added.
    _trees.reserve(static_cast<size_t>(levels));

    std::vector<int32_t> next;
    std::vector<int32_t> neighbors;

    for (int32_t z = _options.maxZoom; z >= _options.minZoom; z--) {
      const double r = clusterRadiusAtZoom(_options.radius, static_cast<double>(z));
      const size_t slot = static_cast<size_t>(z - _options.minZoom);
      // The tree over `current`: the one getClusters() queries at z + 1.
      const KDTree& tree = z == _options.maxZoom ? inputTree : _trees[_treeByZoom[slot + 1]];

      next.clear();
      next.reserve(current.size());

      // supercluster-faithful pass: walk nodes in order, mark each once
      // processed at this level, and only fold in neighbours that haven't been
      // processed yet at this level.
      for (const int32_t index : current) {
        if (processedAt[index] <= z) continue;
        processedAt[index] = z;

        const double originX = _nodes[index].x;
        const double originY = _nodes[index].y;
        tree.within(originX, originY, r, neighbors);

        const int32_t numPointsOrigin = _nodes[index].count;
        int32_t numPoints = numPointsOrigin;
        for (const int32_t nb : neighbors) {
          if (processedAt[nb] > z) numPoints += _nodes[nb].count;
        }

        if (numPoints > numPointsOrigin && numPoints >= _options.minPoints) {
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
      // which getClusters() range-queries and the next level clusters over.
      if (next == current) {
        if (z == _options.maxZoom) {
          _trees.push_back(std::move(inputTree));
          _treeByZoom[slot] = static_cast<int32_t>(_trees.size() - 1);
        } else {
          _treeByZoom[slot] = _treeByZoom[slot + 1];
        }
      } else {
        _trees.push_back(buildTree(next));
        _treeByZoom[slot] = static_cast<int32_t>(_trees.size() - 1);
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

    const int32_t z = static_cast<int32_t>(clamp(
      std::floor(viewport.zoom),
      static_cast<double>(_options.minZoom),
      static_cast<double>(_options.maxZoom)
    ));

    const size_t slot = static_cast<size_t>(z - _options.minZoom);
    if (slot >= _treeByZoom.size()) return result;
    const KDTree& tree = _trees[_treeByZoom[slot]];

    // Y grows southward (latToY is monotonically decreasing in latitude), so
    // north maps to the smaller Y and south to the larger Y.
    const double minY = latToY(bounds.north, _options.extent);
    const double maxY = latToY(bounds.south, _options.extent);

    std::vector<int32_t> idxBuf;
    auto collect = [&](double minX, double maxX) {
      tree.range(minX, minY, maxX, maxY, idxBuf);
      result.reserve(result.size() + idxBuf.size());
      for (int32_t idx : idxBuf) {
        // A node as it stands at this level: processed at z, and not yet
        // folded into a parent here.
        ClusterNode node = _nodes[idx];
        node.zoom = z;
        node.parentId = -1;
        result.push_back(std::move(node));
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
      } else {
        const size_t cluster = static_cast<size_t>(index) - _points.size();
        for (int32_t i = _childOffsets[cluster + 1] - 1; i >= _childOffsets[cluster]; i--) {
          stack.push_back(_childNodes[i]);
        }
      }
    }
    return result;
  }

  int32_t getClusterExpansionZoom(int32_t clusterId) const {
    if (!_built) return _options.minZoom;

    int32_t index = findNode(clusterId);
    if (index < 0) return _options.maxZoom;

    // Mirrors supercluster: start at the zoom the cluster was created at and
    // walk down single-child chains until it splits into multiple children.
    // A cluster created at maxZoom never splits and returns maxZoom + 1; so
    // does a point id, whose node is created at maxZoom + 1.
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

  /** A copy with the same options and points and no index, ready to `build()`. */
  ClusterEngineCore withoutIndex() const {
    ClusterEngineCore copy;
    copy._options = _options;
    copy._points = _points;
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

  bool parseBufferV1(const uint8_t* data, size_t byteLength) {
    int32_t count = 0;
    std::memcpy(&count, data, 4);
    const size_t expectedSize = 4 + static_cast<size_t>(count) * 20;
    if (byteLength < expectedSize || count < 0) {
      resetDerivedState(true);
      return false;
    }

    _points.clear();
    _points.reserve(static_cast<size_t>(count));
    const uint8_t* ptr = data + 4;
    for (int32_t i = 0; i < count; i++) {
      PointData p;
      std::memcpy(&p.id, ptr, 4);
      ptr += 4;
      std::memcpy(&p.latitude, ptr, 8);
      ptr += 8;
      std::memcpy(&p.longitude, ptr, 8);
      ptr += 8;
      if (!isValidGeoCoordinate(p.latitude, p.longitude)) {
        continue;
      }
      p.latitude = clampLatitude(p.latitude);
      p.longitude = clampLongitude(p.longitude);
      p.x = lngToX(p.longitude, _options.extent);
      p.y = latToY(p.latitude, _options.extent);
      _points.push_back(std::move(p));
    }
    resetDerivedState();
    return true;
  }

  bool parseBufferV2(const uint8_t* data, size_t byteLength) {
    if (byteLength < 12) {
      resetDerivedState(true);
      return false;
    }

    int32_t count = 0;
    uint32_t numProps = 0;
    std::memcpy(&count, data + 4, 4);
    std::memcpy(&numProps, data + 8, 4);

    const size_t stride = 20 + static_cast<size_t>(numProps) * 8;
    const size_t expectedSize = 12 + static_cast<size_t>(count) * stride;
    if (byteLength < expectedSize || count < 0) {
      resetDerivedState(true);
      return false;
    }

    _points.clear();
    _points.reserve(static_cast<size_t>(count));
    const uint8_t* ptr = data + 12;
    for (int32_t i = 0; i < count; i++) {
      PointData p;
      std::memcpy(&p.id, ptr, 4);
      ptr += 4;
      std::memcpy(&p.latitude, ptr, 8);
      ptr += 8;
      std::memcpy(&p.longitude, ptr, 8);
      ptr += 8;
      bool valid = isValidGeoCoordinate(p.latitude, p.longitude);
      if (valid) {
        p.latitude = clampLatitude(p.latitude);
        p.longitude = clampLongitude(p.longitude);
        p.x = lngToX(p.longitude, _options.extent);
        p.y = latToY(p.latitude, _options.extent);
        if (numProps > 0) {
          p.values.resize(numProps);
          std::memcpy(p.values.data(), ptr, static_cast<size_t>(numProps) * 8);
        }
      }
      ptr += static_cast<size_t>(numProps) * 8;
      if (valid) {
        _points.push_back(std::move(p));
      }
    }
    resetDerivedState();
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
};

} // namespace margelo::nitro::nitromapcluster
