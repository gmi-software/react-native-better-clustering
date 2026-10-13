#include "HybridClusterEngine.hpp"

#include "InputValidation.hpp"
#include <stdexcept>

namespace margelo::nitro::nitromapcluster {

namespace {

constexpr const char* kNotBuiltError =
  "ClusterEngine: call build() or buildAsync() before querying. Check isBuilt when the engine state is unclear.";

constexpr const char* kDisposedError =
  "ClusterEngine: this engine was disposed. Create a new one with createClusterEngine().";

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

EngineClusterNode toFeature(const ClusterEngineCore& engine, const ClusterNode& node) {
  return EngineClusterNode(
    static_cast<double>(node.id),
    engine.nodeLatitude(node),
    engine.nodeLongitude(node),
    static_cast<double>(node.count),
    node.isCluster,
    static_cast<double>(node.parentId),
    static_cast<double>(node.pointIndex),
    static_cast<double>(node.minLeafId),
    node.values
  );
}

} // namespace

ClusterEngineCore& HybridClusterEngine::engine() {
  // Nitro detaches the JS object on dispose(), so JS should never get here.
  if (_engine == nullptr) {
    throw std::runtime_error(kDisposedError);
  }
  return *_engine;
}

void HybridClusterEngine::dispose() {
  _engine.reset();
}

void HybridClusterEngine::setPoints(const std::shared_ptr<ArrayBuffer>& buffer) {
  if (buffer == nullptr) {
    throw std::runtime_error(
      "ClusterEngine: setPoints() requires a non-null ArrayBuffer. Use packPoints() to produce a valid buffer."
    );
  }
  const bool loaded = engine().setPointsFromBuffer(
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
  ClusterEngineConfig config = toClusterEngineConfig({
    .radius = options.radius,
    .minPoints = options.minPoints,
    .minZoom = options.minZoom,
    .maxZoom = options.maxZoom,
    .extent = options.extent,
    .nodeSize = options.nodeSize,
  });
  config.reducers.reserve(options.reducers.size());
  for (const auto reducer : options.reducers) {
    config.reducers.push_back(toAggregationReducer(reducer));
  }
  engine().setOptions(config);
}

void HybridClusterEngine::build() {
  engine().build();
}

std::shared_ptr<Promise<void>> HybridClusterEngine::buildAsync() {
  // The worker owns the core, not `this`: dispose() or the JS GC can release
  // this object mid-build, and the index is freed when the build finishes.
  std::shared_ptr<ClusterEngineCore> core = _engine;
  if (core == nullptr) {
    throw std::runtime_error(kDisposedError);
  }
  return Promise<void>::async([core = std::move(core)]() {
    core->build();
  });
}

std::vector<EngineClusterNode> HybridClusterEngine::getClusters(const Viewport& viewport) {
  const ClusterEngineCore& core = engine();
  requireBuilt(core);
  ViewportBounds bounds;
  bounds.north = viewport.north;
  bounds.south = viewport.south;
  bounds.east = viewport.east;
  bounds.west = viewport.west;
  bounds.zoom = viewport.zoom;

  const auto nodes = core.getClusters(bounds);
  std::vector<EngineClusterNode> result;
  result.reserve(nodes.size());
  for (const auto& node : nodes) {
    result.push_back(toFeature(core, node));
  }
  return result;
}

std::vector<EngineClusterNode> HybridClusterEngine::getChildren(double clusterId) {
  const ClusterEngineCore& core = engine();
  requireBuilt(core);
  const auto nodes = core.getChildren(toClusterId(clusterId));
  std::vector<EngineClusterNode> result;
  result.reserve(nodes.size());
  for (const auto& node : nodes) {
    result.push_back(toFeature(core, node));
  }
  return result;
}

std::vector<EngineClusterNode> HybridClusterEngine::getLeaves(double clusterId, double limit, double offset) {
  const ClusterEngineCore& core = engine();
  requireBuilt(core);
  const auto nodes = core.getLeaves(toClusterId(clusterId), toLeafLimit(limit), toLeafOffset(offset));
  std::vector<EngineClusterNode> result;
  result.reserve(nodes.size());
  for (const auto& node : nodes) {
    result.push_back(toFeature(core, node));
  }
  return result;
}

double HybridClusterEngine::getClusterExpansionZoom(double clusterId) {
  const ClusterEngineCore& core = engine();
  requireBuilt(core);
  return static_cast<double>(core.getClusterExpansionZoom(toClusterId(clusterId)));
}

double HybridClusterEngine::getPointCount() {
  return static_cast<double>(engine().pointCount());
}

bool HybridClusterEngine::getIsBuilt() {
  return engine().isBuilt();
}

} // namespace margelo::nitro::nitromapcluster
