// Threading tests for ThreadSafeClusterEngine, run under ThreadSanitizer.
// Compile: c++ -std=c++20 -I. -g -O1 -fsanitize=thread -pthread ThreadSafeClusterEngine.test.cpp -o thread_test && ./thread_test

#include "ThreadSafeClusterEngine.hpp"
#include <atomic>
#include <cassert>
#include <chrono>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <memory>
#include <stdexcept>
#include <thread>
#include <vector>

using namespace margelo::nitro::nitromapcluster;

namespace {

const ViewportBounds kWorld{85.0, -85.0, 180.0, -180.0, 3.0};

ClusterEngineConfig makeConfig(int32_t extent = 512) {
  ClusterEngineConfig config;
  config.radius = 40.0;
  config.minPoints = 2;
  config.minZoom = 0;
  config.maxZoom = 16;
  config.extent = extent;
  config.nodeSize = 64;
  return config;
}

// The v1 layout packPoints() writes: an int32 count, then per point an int32
// id and float64 latitude and longitude.
std::vector<uint8_t> packGrid(int32_t count, double originLat, double originLng) {
  std::vector<uint8_t> buffer(4 + static_cast<size_t>(count) * 20);
  uint8_t* ptr = buffer.data();
  std::memcpy(ptr, &count, 4);
  ptr += 4;
  for (int32_t i = 0; i < count; i++) {
    const double lat = originLat + (i % 50) * 0.01;
    const double lng = originLng + (i / 50) * 0.01;
    std::memcpy(ptr, &i, 4);
    std::memcpy(ptr + 4, &lat, 8);
    std::memcpy(ptr + 12, &lng, 8);
    ptr += 20;
  }
  return buffer;
}

void load(ThreadSafeClusterEngine& engine, const std::vector<uint8_t>& buffer) {
  const bool loaded = engine.setPointsFromBuffer(buffer.data(), buffer.size());
  assert(loaded);
  (void)loaded;
}

// Walks the whole snapshot through every query, the way JS would after a build.
size_t queryEverything(const ClusterEngineCore& core) {
  size_t visited = 0;
  for (const auto& node : core.getClusters(kWorld)) {
    visited++;
    (void)core.nodeLatitude(node);
    (void)core.nodeLongitude(node);
    if (node.isCluster) {
      visited += core.getChildren(node.id).size();
      visited += core.getLeaves(node.id, 0, 0).size();
      visited += static_cast<size_t>(core.getClusterExpansionZoom(node.id));
    }
  }
  visited += core.pointCount() + core.memorySize();
  return visited;
}

} // namespace

static void testBuildPublishesTheSameIndexAsTheCore() {
  const auto buffer = packGrid(500, 52.0, 21.0);

  ThreadSafeClusterEngine engine;
  engine.setOptions(makeConfig());
  load(engine, buffer);
  assert(!engine.snapshot()->isBuilt());
  engine.build();

  ClusterEngineCore direct;
  direct.setOptions(makeConfig());
  direct.setPointsFromBuffer(buffer.data(), buffer.size());
  direct.build();

  const auto snapshot = engine.snapshot();
  assert(snapshot->isBuilt());
  assert(snapshot->pointCount() == direct.pointCount());
  const auto expected = direct.getClusters(kWorld);
  const auto actual = snapshot->getClusters(kWorld);
  assert(actual.size() == expected.size());
  for (size_t i = 0; i < actual.size(); i++) {
    assert(actual[i].id == expected[i].id);
    assert(actual[i].count == expected[i].count);
    assert(actual[i].x == expected[i].x);
    assert(actual[i].y == expected[i].y);
  }
}

static void testSetPointsDuringABuildDropsTheStaleIndex() {
  ThreadSafeClusterEngine engine;
  engine.setOptions(makeConfig());
  load(engine, packGrid(100, 52.0, 21.0));

  // What buildAsync() captures when it is called...
  const auto pending = engine.snapshot();
  // ...then new points arrive before its worker finishes.
  load(engine, packGrid(300, 10.0, 10.0));
  engine.build(pending);

  assert(!engine.snapshot()->isBuilt());
  assert(engine.snapshot()->pointCount() == 300);

  engine.build();
  assert(engine.snapshot()->isBuilt());
  assert(engine.snapshot()->pointCount() == 300);
}

static void testSetOptionsDuringABuildDropsTheStaleIndex() {
  ThreadSafeClusterEngine engine;
  engine.setOptions(makeConfig());
  load(engine, packGrid(100, 52.0, 21.0));
  engine.build();

  const auto pending = engine.snapshot();
  ClusterEngineConfig wider = makeConfig();
  wider.radius = 80.0;
  engine.setOptions(wider);
  assert(!engine.snapshot()->isBuilt());
  engine.build(pending);

  assert(!engine.snapshot()->isBuilt());
  assert(engine.snapshot()->options().radius == 80.0);
  assert(engine.snapshot()->pointCount() == 100);
}

static void testOverlappingBuildsPublishOnce() {
  ThreadSafeClusterEngine engine;
  engine.setOptions(makeConfig());
  load(engine, packGrid(200, 52.0, 21.0));

  const auto input = engine.snapshot();
  engine.build(input);
  const auto published = engine.snapshot();
  assert(published->isBuilt());

  // The second build of the same input finishes after the first published.
  engine.build(input);
  assert(engine.snapshot() == published);
}

static void testRebuildingABuiltIndexReplacesIt() {
  ThreadSafeClusterEngine engine;
  engine.setOptions(makeConfig());
  load(engine, packGrid(200, 52.0, 21.0));
  engine.build();
  const auto first = engine.snapshot();

  engine.build();
  const auto second = engine.snapshot();
  assert(second != first);
  assert(second->isBuilt());
  assert(second->getClusters(kWorld).size() == first->getClusters(kWorld).size());
}

static void testHeldSnapshotKeepsItsOwnOptionsAndIndex() {
  ThreadSafeClusterEngine engine;
  engine.setOptions(makeConfig(512));
  load(engine, packGrid(200, 52.0, 21.0));
  engine.build();

  const auto held = engine.snapshot();
  const auto before = held->getClusters(kWorld);
  assert(!before.empty());
  const double latitude = held->nodeLatitude(before.front());

  engine.setOptions(makeConfig(1024));
  load(engine, packGrid(10, 0.0, 0.0));

  assert(held->isBuilt());
  assert(held->options().extent == 512);
  const auto after = held->getClusters(kWorld);
  assert(after.size() == before.size());
  assert(held->nodeLatitude(after.front()) == latitude);
}

static void testInvalidOptionsLeaveTheEngineUnchanged() {
  ThreadSafeClusterEngine engine;
  engine.setOptions(makeConfig());
  load(engine, packGrid(50, 52.0, 21.0));
  engine.build();
  const auto built = engine.snapshot();

  ClusterEngineConfig invalid = makeConfig();
  invalid.minZoom = 10;
  invalid.maxZoom = 5;
  bool threw = false;
  try {
    engine.setOptions(invalid);
  } catch (const std::invalid_argument&) {
    threw = true;
  }
  assert(threw);
  assert(engine.snapshot() == built);
}

static void testInvalidBufferClearsThePoints() {
  ThreadSafeClusterEngine engine;
  engine.setOptions(makeConfig(256));
  load(engine, packGrid(50, 52.0, 21.0));
  engine.build();

  const uint8_t truncated[] = {10, 0, 0, 0, 1, 2};
  assert(!engine.setPointsFromBuffer(truncated, sizeof(truncated)));
  assert(!engine.snapshot()->isBuilt());
  assert(engine.snapshot()->pointCount() == 0);
  assert(engine.snapshot()->options().extent == 256);
}

// A worker building while other threads query, replace the points and options,
// and drop the last outside reference to the engine. ThreadSanitizer fails the
// run on any data race.
static void testConcurrentBuildQueriesMutationsAndDestruction() {
  const auto pointsA = packGrid(2000, 52.0, 21.0);
  const auto pointsB = packGrid(1500, -33.0, 151.0);

  for (int round = 0; round < 4; round++) {
    // Mirrors HybridClusterEngine: each build owns a reference to the engine.
    auto engine = std::make_shared<ThreadSafeClusterEngine>();
    engine->setOptions(makeConfig());
    load(*engine, pointsA);
    const auto initial = engine->snapshot();

    std::atomic<bool> mutating{true};
    std::atomic<bool> building{true};
    std::atomic<int> builtQueries{0};

    std::thread builder([engine, &mutating, &building] {
      // Builds keep going after the mutators stop, so one is sure to publish.
      int afterMutations = 0;
      while (afterMutations < 3) {
        if (!mutating.load()) {
          afterMutations++;
        }
        engine->build(engine->snapshot());
      }
      building.store(false);
    });

    std::thread querier([engine, &building, &builtQueries] {
      size_t sink = 0;
      while (building.load() || builtQueries.load() == 0) {
        const auto snapshot = engine->snapshot();
        if (snapshot->isBuilt()) {
          sink += queryEverything(*snapshot);
          builtQueries++;
        }
      }
      assert(sink > 0);
    });

    std::thread pointsWriter([engine, &pointsA, &pointsB] {
      for (int i = 0; i < 20; i++) {
        load(*engine, i % 2 == 0 ? pointsB : pointsA);
        std::this_thread::sleep_for(std::chrono::milliseconds(1));
      }
    });

    std::thread optionsWriter([engine] {
      for (int i = 0; i < 20; i++) {
        ClusterEngineConfig config = makeConfig();
        config.radius = i % 2 == 0 ? 60.0 : 40.0;
        engine->setOptions(config);
        std::this_thread::sleep_for(std::chrono::milliseconds(1));
      }
    });

    // Hold a snapshot past the engine's destruction: it stays queryable.
    std::thread snapshotHolder([held = initial] {
      std::this_thread::sleep_for(std::chrono::milliseconds(5));
      assert(held->pointCount() == 2000);
    });

    // The main thread drops its reference while the workers run, so the last
    // thread to finish destroys the engine.
    std::weak_ptr<ThreadSafeClusterEngine> observer = engine;
    engine.reset();

    pointsWriter.join();
    optionsWriter.join();
    mutating.store(false);
    builder.join();
    querier.join();
    snapshotHolder.join();
    assert(builtQueries.load() > 0);
    assert(observer.expired());
  }
}

// The engine is destroyed on the worker thread when the build holds the last
// reference, as when JS drops or dispose()s an engine mid-buildAsync().
static void testDestructionDuringABuild() {
  const auto points = packGrid(5000, 52.0, 21.0);
  for (int round = 0; round < 8; round++) {
    auto engine = std::make_shared<ThreadSafeClusterEngine>();
    engine->setOptions(makeConfig());
    load(*engine, points);

    std::thread worker([engine, input = engine->snapshot()] { engine->build(input); });
    std::weak_ptr<ThreadSafeClusterEngine> observer = engine;
    engine.reset();
    worker.join();
    assert(observer.expired());
  }
}

int main() {
  testBuildPublishesTheSameIndexAsTheCore();
  testSetPointsDuringABuildDropsTheStaleIndex();
  testSetOptionsDuringABuildDropsTheStaleIndex();
  testOverlappingBuildsPublishOnce();
  testRebuildingABuiltIndexReplacesIt();
  testHeldSnapshotKeepsItsOwnOptionsAndIndex();
  testInvalidOptionsLeaveTheEngineUnchanged();
  testInvalidBufferClearsThePoints();
  testConcurrentBuildQueriesMutationsAndDestruction();
  testDestructionDuringABuild();
  std::printf("ThreadSafeClusterEngine tests passed\n");
  return 0;
}
