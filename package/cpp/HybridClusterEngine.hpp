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

  // Frees the index now, not at GC; a pending buildAsync frees it when done.
  void dispose() override;

protected:
  size_t getExternalMemorySize() noexcept override {
    return _engine != nullptr ? _engine->memorySize() : 0;
  }

private:
  // Shared so a pending buildAsync keeps the index alive without capturing `this`.
  std::shared_ptr<ClusterEngineCore> _engine = std::make_shared<ClusterEngineCore>();
  ClusterEngineCore& engine();
  EngineClusterNode toFeature(const ClusterNode& node) const;
};

} // namespace margelo::nitro::nitromapcluster
