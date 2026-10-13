#pragma once

// The generated bindings include NitroModules/PropNameIDCache.hpp, which
// react-native-nitro-modules added in 0.32.0. Against an older Nitro they stop
// at "NitroModules cannot be found!", which sends people looking for a missing
// install; say what is actually wrong first.
#if __has_include(<NitroModules/HybridObject.hpp>) && !__has_include(<NitroModules/PropNameIDCache.hpp>)
#error react-native-better-clustering needs react-native-nitro-modules 0.32.0 or newer. Upgrade it, then reinstall pods (iOS) or rebuild (Android).
#endif

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

  // Frees the index now, not at GC; a pending buildAsync frees it when done.
  void dispose() override;

protected:
  size_t getExternalMemorySize() noexcept override {
    return _engine != nullptr ? _engine->snapshot()->memorySize() : 0;
  }

private:
  // Shared so a pending buildAsync can publish into it without capturing `this`.
  std::shared_ptr<ThreadSafeClusterEngine> _engine = std::make_shared<ThreadSafeClusterEngine>();
  ThreadSafeClusterEngine& engine();
};

} // namespace margelo::nitro::nitromapcluster
