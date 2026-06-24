#include "HybridClusterEngine.hpp"

#include <stdexcept>

namespace margelo::nitro::nitromapcluster {

namespace {

constexpr const char* kNotBuiltError =
  "ClusterEngine: call build() or buildAsync() before querying. Check isBuilt when the engine state is unclear.";

void requireBuilt(const ClusterEngineCore& engine) {
  if (!engine.isBuilt()) {
    throw std::runtime_error(kNotBuiltError);
  }
}

AggregationReducer toAggregationReducer(ReducerKind kind) {
  switch (kind) {
    case ReducerKind::SUM:
      return AggregationReducer::Sum;
    case ReducerKind::MIN:
      return AggregationReducer::Min;
    case ReducerKind::MAX:
      return AggregationReducer::Max;
    default:
      throw std::invalid_argument("ClusterEngine: unsupported ReducerKind value");
  }
}

} // namespace

void HybridClusterEngine::setPoints(const std::shared_ptr<ArrayBuffer>& buffer) {
  if (buffer == nullptr) {
    throw std::runtime_error(
      "ClusterEngine: setPoints() requires a non-null ArrayBuffer. Use packPoints() to produce a valid buffer."
    );
  }
  const bool loaded = _engine.setPointsFromBuffer(
    static_cast<const uint8_t*>(buffer->data()),
    buffer->size()
  );
  if (!loaded) {
    throw std::runtime_error(
      "ClusterEngine: setPoints() received an invalid buffer layout. Expected output from packPoints()."
    );
  }
}

void HybridClusterEngine::setOptions(const ClusterEngineOptions& options) {
  ClusterEngineConfig config;
  config.radius = options.radius;
  config.minPoints = static_cast<int32_t>(options.minPoints);
  config.minZoom = static_cast<int32_t>(options.minZoom);
  config.maxZoom = static_cast<int32_t>(options.maxZoom);
  config.extent = static_cast<int32_t>(options.extent);
  config.nodeSize = static_cast<int32_t>(options.nodeSize);
  config.reducers.reserve(options.reducers.size());
  for (const auto reducer : options.reducers) {
    config.reducers.push_back(toAggregationReducer(reducer));
  }
  _engine.setOptions(config);
}

void HybridClusterEngine::build() {
  _engine.build();
}

std::shared_ptr<Promise<void>> HybridClusterEngine::buildAsync() {
  return Promise<void>::async([this]() {
    _engine.build();
  });
}

EngineClusterNode HybridClusterEngine::toFeature(const ClusterNode& node) const {
  return EngineClusterNode(
    static_cast<double>(node.id),
    _engine.nodeLatitude(node),
    _engine.nodeLongitude(node),
    static_cast<double>(node.count),
    node.isCluster,
    static_cast<double>(node.parentId),
    static_cast<double>(node.pointIndex),
    node.values
  );
}

std::vector<EngineClusterNode> HybridClusterEngine::getClusters(const Viewport& viewport) {
  requireBuilt(_engine);
  ViewportBounds bounds;
  bounds.north = viewport.north;
  bounds.south = viewport.south;
  bounds.east = viewport.east;
  bounds.west = viewport.west;
  bounds.zoom = viewport.zoom;

  const auto nodes = _engine.getClusters(bounds);
  std::vector<EngineClusterNode> result;
  result.reserve(nodes.size());
  for (const auto& node : nodes) {
    result.push_back(toFeature(node));
  }
  return result;
}

std::vector<EngineClusterNode> HybridClusterEngine::getChildren(double clusterId) {
  requireBuilt(_engine);
  const auto nodes = _engine.getChildren(static_cast<int32_t>(clusterId));
  std::vector<EngineClusterNode> result;
  result.reserve(nodes.size());
  for (const auto& node : nodes) {
    result.push_back(toFeature(node));
  }
  return result;
}

std::vector<EngineClusterNode> HybridClusterEngine::getLeaves(double clusterId, double limit, double offset) {
  requireBuilt(_engine);
  const auto nodes = _engine.getLeaves(
    static_cast<int32_t>(clusterId),
    static_cast<int32_t>(limit),
    static_cast<int32_t>(offset)
  );
  std::vector<EngineClusterNode> result;
  result.reserve(nodes.size());
  for (const auto& node : nodes) {
    result.push_back(toFeature(node));
  }
  return result;
}

double HybridClusterEngine::getClusterExpansionZoom(double clusterId) {
  requireBuilt(_engine);
  return static_cast<double>(_engine.getClusterExpansionZoom(static_cast<int32_t>(clusterId)));
}

double HybridClusterEngine::getPointCount() {
  return static_cast<double>(_engine.pointCount());
}

bool HybridClusterEngine::getIsBuilt() {
  return _engine.isBuilt();
}

} // namespace margelo::nitro::nitromapcluster
