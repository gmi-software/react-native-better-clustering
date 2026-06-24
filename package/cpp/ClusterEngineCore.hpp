#pragma once

#include "GeoUtils.hpp"
#include <vector>
#include <cstdint>
#include <cstring>
#include <unordered_map>
#include <algorithm>
#include <cmath>
#include <limits>

namespace margelo::nitro::nitromapcluster {

// Static KD-tree over 2D points, kdbush-style: a flat permutation of point
// ids (`_ids`) is recursively partitioned in place on alternating axes. Query
// and build mirror each other exactly — same pivot `(left+right)/2`, same
// alternating axis — which is what makes range/within correct.
class KDTree {
public:
  KDTree() = default;

  void build(const std::vector<double>& xs, const std::vector<double>& ys, int nodeSize) {
    _xs = xs;
    _ys = ys;
    _nodeSize = nodeSize > 0 ? nodeSize : 1;
    _ids.clear();
    _ids.reserve(xs.size());
    for (size_t i = 0; i < xs.size(); i++) {
      _ids.push_back(static_cast<int32_t>(i));
    }
    if (!_ids.empty()) {
      sortKD(0, static_cast<int32_t>(_ids.size()) - 1, 0);
    }
  }

  void range(double minX, double minY, double maxX, double maxY, std::vector<int32_t>& result) const {
    result.clear();
    if (_ids.empty()) return;
    rangeRecurse(0, static_cast<int32_t>(_ids.size()) - 1, 0, minX, minY, maxX, maxY, result);
  }

  void within(double x, double y, double radius, std::vector<int32_t>& result) const {
    result.clear();
    if (_ids.empty()) return;
    withinRecurse(0, static_cast<int32_t>(_ids.size()) - 1, 0, x, y, radius, result);
  }

  size_t memoryBytes() const {
    return _xs.capacity() * sizeof(double)
         + _ys.capacity() * sizeof(double)
         + _ids.capacity() * sizeof(int32_t);
  }

private:
  std::vector<double> _xs;
  std::vector<double> _ys;
  std::vector<int32_t> _ids;
  int32_t _nodeSize = 64;

  void sortKD(int32_t left, int32_t right, int32_t axis) {
    if (right - left <= _nodeSize) return;

    const int32_t mid = (left + right) >> 1;
    std::nth_element(
      _ids.begin() + left,
      _ids.begin() + mid,
      _ids.begin() + right + 1,
      [&](int32_t a, int32_t b) {
        return axis == 0 ? _xs[a] < _xs[b] : _ys[a] < _ys[b];
      }
    );

    sortKD(left, mid - 1, axis ^ 1);
    sortKD(mid + 1, right, axis ^ 1);
  }

  void rangeRecurse(int32_t left, int32_t right, int32_t axis,
                    double minX, double minY, double maxX, double maxY,
                    std::vector<int32_t>& result) const {
    if (right - left <= _nodeSize) {
      for (int32_t i = left; i <= right; i++) {
        const int32_t idx = _ids[i];
        const double x = _xs[idx];
        const double y = _ys[idx];
        if (x >= minX && x <= maxX && y >= minY && y <= maxY) {
          result.push_back(idx);
        }
      }
      return;
    }

    const int32_t mid = (left + right) >> 1;
    const int32_t midIdx = _ids[mid];
    const double x = _xs[midIdx];
    const double y = _ys[midIdx];

    if (x >= minX && x <= maxX && y >= minY && y <= maxY) {
      result.push_back(midIdx);
    }

    const double coord = axis == 0 ? x : y;
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
                     double x, double y, double radius,
                     std::vector<int32_t>& result) const {
    const double r2 = radius * radius;

    if (right - left <= _nodeSize) {
      for (int32_t i = left; i <= right; i++) {
        const int32_t idx = _ids[i];
        const double dx = _xs[idx] - x;
        const double dy = _ys[idx] - y;
        if (dx * dx + dy * dy <= r2) {
          result.push_back(idx);
        }
      }
      return;
    }

    const int32_t mid = (left + right) >> 1;
    const int32_t midIdx = _ids[mid];
    const double midX = _xs[midIdx];
    const double midY = _ys[midIdx];
    const double dx = midX - x;
    const double dy = midY - y;

    if (dx * dx + dy * dy <= r2) {
      result.push_back(midIdx);
    }

    const double coord = axis == 0 ? midX : midY;
    const double q = axis == 0 ? x : y;

    if (q - radius <= coord) {
      withinRecurse(left, mid - 1, axis ^ 1, x, y, radius, result);
    }
    if (q + radius >= coord) {
      withinRecurse(mid + 1, right, axis ^ 1, x, y, radius, result);
    }
  }
};

class ClusterEngineCore {
public:
  void setOptions(const ClusterEngineConfig& options) {
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
    _resultTrees.clear();
    _clustersByZoom.clear();
    _nodeById.clear();
    _childrenByParent.clear();
    _nextClusterId = static_cast<int32_t>(_points.size());

    if (_points.empty()) {
      _built = true;
      return;
    }

    if (!_options.clusteringEnabled) {
      _built = true;
      return;
    }

    const size_t np = _options.reducers.size();

    std::vector<ClusterNode> current;
    current.reserve(_points.size());
    for (size_t i = 0; i < _points.size(); i++) {
      ClusterNode node;
      node.id = _points[i].id;
      node.x = _points[i].x;
      node.y = _points[i].y;
      node.count = 1;
      node.parentId = -1;
      node.pointIndex = _points[i].id;
      node.isCluster = false;
      node.zoom = _options.maxZoom + 1;
      if (np > 0) {
        node.values.assign(np, 0.0);
        const auto& v = _points[i].values;
        for (size_t k = 0; k < np && k < v.size(); k++) {
          node.values[k] = v[k];
        }
      }
      _nodeById[node.id] = node;
      current.push_back(std::move(node));
    }

    // maxZoom+1 is the clustering input but is never queried directly
    // (getClusters clamps zoom to [minZoom, maxZoom]), so it isn't stored.
    for (int32_t z = _options.maxZoom; z >= _options.minZoom; z--) {
      const double r = _options.radius / zoomScale(static_cast<double>(z), _options.extent);

      std::vector<double> xs, ys;
      xs.reserve(current.size());
      ys.reserve(current.size());
      for (const auto& n : current) {
        xs.push_back(n.x);
        ys.push_back(n.y);
      }

      // Build-time tree over the clustering input (`current`). Only used by the
      // `within` neighbourhood queries below, so it stays local to this scope.
      KDTree tree;
      tree.build(xs, ys, _options.nodeSize);

      std::vector<ClusterNode> next;
      next.reserve(current.size());
      std::vector<int32_t> neighbors;

      // supercluster-faithful pass: walk nodes in order, mark each by lowering
      // its `zoom` to the current level once processed, and only fold in
      // neighbours that haven't been processed yet at this level.
      for (size_t i = 0; i < current.size(); i++) {
        if (current[i].zoom <= z) continue;
        current[i].zoom = z;

        tree.within(current[i].x, current[i].y, r, neighbors);

        const int32_t numPointsOrigin = current[i].count;
        int32_t numPoints = numPointsOrigin;
        for (int32_t nb : neighbors) {
          if (current[nb].zoom > z) numPoints += current[nb].count;
        }

        if (numPoints > numPointsOrigin && numPoints >= _options.minPoints) {
          double wx = current[i].x * numPointsOrigin;
          double wy = current[i].y * numPointsOrigin;

          ClusterNode cluster;
          cluster.id = _nextClusterId++;
          cluster.count = numPoints;
          cluster.parentId = -1;
          cluster.pointIndex = -1;
          cluster.isCluster = true;
          cluster.zoom = z;
          if (np > 0) {
            // Seed the accumulator with the origin node's values, then fold.
            cluster.values = current[i].values;
            cluster.values.resize(np, 0.0);
          }

          linkChild(cluster.id, current[i].id);

          for (int32_t nb : neighbors) {
            if (current[nb].zoom <= z) continue;
            current[nb].zoom = z;
            const int32_t np2 = current[nb].count;
            wx += current[nb].x * np2;
            wy += current[nb].y * np2;
            for (size_t k = 0; k < np; k++) {
              const double v = k < current[nb].values.size()
                ? current[nb].values[k]
                : reducerSeed(_options.reducers[k]);
              cluster.values[k] = reducerApply(_options.reducers[k], cluster.values[k], v);
            }
            linkChild(cluster.id, current[nb].id);
          }

          cluster.x = wx / numPoints;
          cluster.y = wy / numPoints;
          _nodeById[cluster.id] = cluster;
          next.push_back(std::move(cluster));
        } else {
          // The origin survives unclustered at this level.
          _nodeById[current[i].id] = current[i];
          next.push_back(current[i]);

          // Mark (but don't cluster) any mergeable neighbours so they aren't
          // reprocessed; they survive individually at this level too.
          if (numPoints > 1) {
            for (int32_t nb : neighbors) {
              if (current[nb].zoom <= z) continue;
              current[nb].zoom = z;
              _nodeById[current[nb].id] = current[nb];
              next.push_back(current[nb]);
            }
          }
        }
      }

      _clustersByZoom[z] = std::move(next);
      current = _clustersByZoom[z];

      // Result tree over the clusters at this zoom, indexed 1:1 with
      // `_clustersByZoom[z]`. This is what getClusters() range-queries.
      std::vector<double> rxs, rys;
      rxs.reserve(current.size());
      rys.reserve(current.size());
      for (const auto& n : current) {
        rxs.push_back(n.x);
        rys.push_back(n.y);
      }
      KDTree resultTree;
      resultTree.build(rxs, rys, _options.nodeSize);
      _resultTrees[z] = std::move(resultTree);
    }

    _built = true;
  }

  std::vector<ClusterNode> getClusters(const ViewportBounds& viewport) const {
    std::vector<ClusterNode> result;
    if (!_built || _points.empty()) return result;

    if (!_options.clusteringEnabled) {
      result.reserve(_points.size());
      for (size_t i = 0; i < _points.size(); i++) {
        const PointData& p = _points[i];
        if (p.latitude > viewport.north || p.latitude < viewport.south) continue;
        const bool inLng = viewport.west <= viewport.east
          ? (p.longitude >= viewport.west && p.longitude <= viewport.east)
          : (p.longitude >= viewport.west || p.longitude <= viewport.east);
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

    auto it = _clustersByZoom.find(z);
    if (it == _clustersByZoom.end()) return result;
    auto treeIt = _resultTrees.find(z);
    if (treeIt == _resultTrees.end()) return result;

    const std::vector<ClusterNode>& nodes = it->second;
    const KDTree& tree = treeIt->second;

    // Y grows southward (latToY is monotonically decreasing in latitude), so
    // north maps to the smaller Y and south to the larger Y.
    const double minY = latToY(viewport.north, _options.extent);
    const double maxY = latToY(viewport.south, _options.extent);

    std::vector<int32_t> idxBuf;
    auto collect = [&](double minX, double maxX) {
      tree.range(minX, minY, maxX, maxY, idxBuf);
      result.reserve(result.size() + idxBuf.size());
      for (int32_t idx : idxBuf) {
        result.push_back(nodes[idx]);
      }
    };

    if (viewport.west <= viewport.east) {
      collect(lngToX(viewport.west, _options.extent), lngToX(viewport.east, _options.extent));
    } else {
      // Antimeridian crossing: the viewport wraps past 180°, so split into
      // [west, 180°] and [-180°, east]. The two X ranges are disjoint, so no
      // node is collected twice.
      collect(lngToX(viewport.west, _options.extent), lngToX(180.0, _options.extent));
      collect(lngToX(-180.0, _options.extent), lngToX(viewport.east, _options.extent));
    }

    return result;
  }

  std::vector<ClusterNode> getChildren(int32_t clusterId) const {
    std::vector<ClusterNode> result;
    if (!_built) return result;

    auto childrenIt = _childrenByParent.find(clusterId);
    if (childrenIt == _childrenByParent.end()) return result;

    result.reserve(childrenIt->second.size());
    for (int32_t childId : childrenIt->second) {
      auto nodeIt = _nodeById.find(childId);
      if (nodeIt != _nodeById.end()) {
        result.push_back(nodeIt->second);
      }
    }
    return result;
  }

  std::vector<ClusterNode> getLeaves(int32_t clusterId, int32_t limit, int32_t offset) const {
    std::vector<ClusterNode> result;
    if (!_built) return result;

    if (_nodeById.find(clusterId) == _nodeById.end()) return result;

    std::vector<int32_t> stack;
    stack.push_back(clusterId);
    int32_t skipped = 0;

    const bool unlimited = limit <= 0;
    while (!stack.empty() && (unlimited || static_cast<int32_t>(result.size()) < limit)) {
      const int32_t id = stack.back();
      stack.pop_back();

      auto nodeIt = _nodeById.find(id);
      if (nodeIt == _nodeById.end()) continue;
      const ClusterNode& node = nodeIt->second;

      if (!node.isCluster) {
        if (skipped < offset) {
          skipped++;
        } else {
          result.push_back(node);
        }
      } else {
        auto childrenIt = _childrenByParent.find(id);
        if (childrenIt != _childrenByParent.end()) {
          for (auto it = childrenIt->second.rbegin(); it != childrenIt->second.rend(); ++it) {
            stack.push_back(*it);
          }
        }
      }
    }
    return result;
  }

  int32_t getClusterExpansionZoom(int32_t clusterId) const {
    if (!_built) return _options.minZoom;

    auto it = _nodeById.find(clusterId);
    if (it == _nodeById.end()) return _options.maxZoom;

    // Mirrors supercluster: start at the cluster's origin zoom and walk down
    // single-child chains until the cluster splits into multiple children.
    int32_t expansionZoom = it->second.zoom;
    int32_t currentId = clusterId;

    while (expansionZoom <= _options.maxZoom) {
      const auto children = getChildren(currentId);
      expansionZoom++;
      if (children.size() != 1) break;
      currentId = children.front().id;
    }

    return expansionZoom;
  }

  size_t pointCount() const { return _points.size(); }
  bool isBuilt() const { return _built; }

  /** Approximate native heap bytes owned by point data, indexes, and cluster graphs. */
  size_t memorySize() const {
    size_t bytes = _points.capacity() * sizeof(PointData);
    for (const auto& point : _points) {
      bytes += point.values.capacity() * sizeof(double);
    }

    for (const auto& [zoom, tree] : _resultTrees) {
      bytes += tree.memoryBytes();
      (void)zoom;
    }

    for (const auto& [zoom, nodes] : _clustersByZoom) {
      bytes += nodes.capacity() * sizeof(ClusterNode);
      for (const auto& node : nodes) {
        bytes += node.values.capacity() * sizeof(double);
      }
      (void)zoom;
    }

    for (const auto& [id, node] : _nodeById) {
      bytes += sizeof(ClusterNode) + node.values.capacity() * sizeof(double);
      (void)id;
    }

    for (const auto& [parentId, children] : _childrenByParent) {
      bytes += children.capacity() * sizeof(int32_t);
      (void)parentId;
    }

    bytes += _options.reducers.capacity() * sizeof(AggregationReducer);

    bytes += _resultTrees.bucket_count() * sizeof(void*);
    bytes += _clustersByZoom.bucket_count() * sizeof(void*);
    bytes += _nodeById.bucket_count() * sizeof(void*);
    bytes += _childrenByParent.bucket_count() * sizeof(void*);

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
    _nodeById.clear();
    _childrenByParent.clear();
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

  void linkChild(int32_t parentId, int32_t childId) {
    if (parentId < 0 || parentId == childId) return;
    _nodeById[childId].parentId = parentId;
    _childrenByParent[parentId].push_back(childId);
  }

  ClusterEngineConfig _options;
  std::vector<PointData> _points;
  std::unordered_map<int32_t, KDTree> _resultTrees;
  std::unordered_map<int32_t, std::vector<ClusterNode>> _clustersByZoom;
  std::unordered_map<int32_t, ClusterNode> _nodeById;
  std::unordered_map<int32_t, std::vector<int32_t>> _childrenByParent;
  int32_t _nextClusterId = 0;
  bool _built = false;
};

} // namespace margelo::nitro::nitromapcluster
