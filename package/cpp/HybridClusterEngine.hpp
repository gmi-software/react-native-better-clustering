#pragma once

#include "ClusterEngineCore.hpp"
#include "HybridClusterEngineSpec.hpp"
#include <NitroModules/ArrayBuffer.hpp>
#include <memory>

namespace margelo::nitro::nitromapcluster {

class HybridClusterEngine : public HybridClusterEngineSpec {
public:
  HybridClusterEngine() : HybridObject(TAG) {}

  void setPoints(const std::shared_ptr<ArrayBuffer>& buffer) override;
  void setOptions(const ClusterEngineOptions& options) override;
  void build() override;
  std::shared_ptr<Promise<void>> buildAsync() override;
  std::vector<EngineClusterNode> getClusters(const Viewport& viewport) override;
  std::vector<EngineClusterNode> getChildren(double clusterId) override;
  std::vector<EngineClusterNode> getLeaves(double clusterId, double limit, double offset) override;
  double getClusterExpansionZoom(double clusterId) override;
  double getPointCount() override;
  bool getIsBuilt() override;

  // Releases the index now instead of when the JS GC finalizes this object.
  // A build in flight holds its own reference and frees the index when done.
  void dispose() override;

protected:
  size_t getExternalMemorySize() noexcept override {
    return _engine != nullptr ? _engine->memorySize() : 0;
  }

private:
  // Shared so buildAsync can keep the index alive without capturing `this`.
  std::shared_ptr<ClusterEngineCore> _engine = std::make_shared<ClusterEngineCore>();
  ClusterEngineCore& engine();
};

} // namespace margelo::nitro::nitromapcluster
