// Lifetime tests for HybridClusterEngine, linked against Nitro's C++ runtime.
// Build and run from package/: `bun run test:native` (ASan + UBSan), or
// `bun run test:native thread` (TSan). Needs `bun install` for Nitro, JSI and
// the generated nitrogen specs.

#include "HybridClusterEngine.hpp"
#include <NitroModules/ArrayBuffer.hpp>
#include <NitroModules/ThreadUtils.hpp>
#include <cassert>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <memory>
#include <stdexcept>

using namespace margelo::nitro;
using namespace margelo::nitro::nitromapcluster;

// Nitro implements these per platform; nothing here needs a UI thread.
namespace margelo::nitro {
std::string ThreadUtils::getThreadName() {
  return "test";
}
void ThreadUtils::setThreadName(const std::string&) {}
bool ThreadUtils::isUIThread() {
  return false;
}
std::shared_ptr<Dispatcher> ThreadUtils::createUIThreadDispatcher() {
  return nullptr;
}
} // namespace margelo::nitro

namespace {

// Exposes the size Nitro reports to the JS GC.
class ProbeEngine : public HybridClusterEngine {
public:
  ProbeEngine() : HybridObject(TAG) {}
  using HybridClusterEngine::getExternalMemorySize;
};

// A v1 packPoints() buffer spread over the globe, so the build takes a while.
std::shared_ptr<ArrayBuffer> packPoints(int32_t count) {
  auto buffer = ArrayBuffer::allocate(4 + static_cast<size_t>(count) * 20);
  uint8_t* cursor = buffer->data();
  std::memcpy(cursor, &count, 4);
  cursor += 4;
  for (int32_t i = 0; i < count; i++) {
    const double latitude = -60.0 + (i % 1000) * 0.12;
    const double longitude = -170.0 + (i / 1000) * 0.34;
    std::memcpy(cursor, &i, 4);
    std::memcpy(cursor + 4, &latitude, 8);
    std::memcpy(cursor + 12, &longitude, 8);
    cursor += 20;
  }
  return buffer;
}

std::shared_ptr<ProbeEngine> makeEngine(int32_t count) {
  auto engine = std::make_shared<ProbeEngine>();
  engine->setOptions(ClusterEngineOptions(40, 2, 0, 16, 512, 64, {}));
  engine->setPoints(packPoints(count));
  return engine;
}

bool throwsRuntimeError(void (*call)(ProbeEngine&), ProbeEngine& engine) {
  try {
    call(engine);
  } catch (const std::runtime_error&) {
    return true;
  }
  return false;
}

// dispose() while buildAsync runs, then the last JS reference goes: the build
// must finish on the core it owns instead of a destroyed engine.
void testDisposeDuringBuildAsync() {
  for (int i = 0; i < 10; i++) {
    auto engine = makeEngine(20000);
    auto build = engine->buildAsync();
    engine->dispose();
    engine.reset();
    build->await().get();
  }
}

// The JS GC finalizes the object mid-build without dispose().
void testReleaseDuringBuildAsync() {
  for (int i = 0; i < 10; i++) {
    auto engine = makeEngine(20000);
    auto build = engine->buildAsync();
    engine.reset();
    build->await().get();
  }
}

// setPoints, setOptions and queries while buildAsync runs. The rebuild works
// on its own copy, so none of them race it, and its stale index is dropped.
void testCallsDuringBuildAsync() {
  const Viewport world(85, -85, 180, -180, 3);
  for (int i = 0; i < 5; i++) {
    auto engine = makeEngine(20000);
    engine->build();
    auto build = engine->buildAsync();

    // The current index keeps answering while the rebuild runs.
    assert(engine->getIsBuilt());
    assert(!engine->getClusters(world).empty());
    assert(engine->getExternalMemorySize() > 0);

    engine->setOptions(ClusterEngineOptions(60, 2, 0, 16, 512, 64, {}));
    engine->setPoints(packPoints(1000));
    build->await().get();

    assert(!engine->getIsBuilt());
    assert(engine->getPointCount() == 1000);
    engine->build();
    assert(engine->getIsBuilt());
  }
}

void testDisposeReleasesTheIndex() {
  auto engine = makeEngine(5000);
  engine->buildAsync()->await().get();
  assert(engine->getIsBuilt());
  assert(engine->getExternalMemorySize() > 0);

  engine->dispose();

  assert(engine->getExternalMemorySize() == 0);
  assert(throwsRuntimeError([](ProbeEngine& e) { e.getPointCount(); }, *engine));
  assert(throwsRuntimeError([](ProbeEngine& e) { e.buildAsync(); }, *engine));
  assert(throwsRuntimeError([](ProbeEngine& e) { e.build(); }, *engine));
  engine->dispose(); // idempotent natively; Nitro rejects a second JS call
}

} // namespace

int main() {
  testDisposeDuringBuildAsync();
  testReleaseDuringBuildAsync();
  testCallsDuringBuildAsync();
  testDisposeReleasesTheIndex();
  std::puts("HybridClusterEngine tests passed");
  return 0;
}
