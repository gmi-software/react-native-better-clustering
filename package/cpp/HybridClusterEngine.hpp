#pragma once

#include "HybridClusterEngineSpec.hpp"
#include "ThreadSafeClusterEngine.hpp"
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

protected:
  size_t getExternalMemorySize() noexcept override {
    return _engine.snapshot()->memorySize();
  }

private:
  ThreadSafeClusterEngine _engine;
};

} // namespace margelo::nitro::nitromapcluster
