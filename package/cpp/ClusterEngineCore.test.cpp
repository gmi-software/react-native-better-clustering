// Standalone sanity test for ClusterEngineCore getLeaves/indexes.
// Compile: c++ -std=c++20 -I. ClusterEngineCore.test.cpp -o cluster_test && ./cluster_test

#include "ClusterEngineCore.hpp"
#include <cassert>
#include <cstdio>
#include <cstring>
#include <limits>
#include <vector>

using namespace margelo::nitro::nitromapcluster;

static void testGetLeavesReturnsAllPointsInCluster() {
  ClusterEngineCore engine;
  ClusterEngineConfig config;
  config.radius = 40.0;
  config.minPoints = 2;
  config.minZoom = 0;
  config.maxZoom = 16;
  config.extent = 512;
  config.nodeSize = 64;
  engine.setOptions(config);

  const int32_t count = 100;
  std::vector<int32_t> ids(count);
  std::vector<double> lats(count);
  std::vector<double> lngs(count);
  for (int32_t i = 0; i < count; i++) {
    ids[i] = i;
    // Tight grid so points merge into one top-level cluster at low zoom.
    lats[i] = 52.0 + (i % 10) * 0.0001;
    lngs[i] = 21.0 + (i / 10) * 0.0001;
  }
  engine.setPoints(ids.data(), lats.data(), lngs.data(), static_cast<size_t>(count));
  engine.build();

  const auto clusters = engine.getClusters({52.5, 51.5, 22.0, 20.0, 0.0});
  assert(!clusters.empty());
  const int32_t rootClusterId = clusters.front().id;

  const auto leaves = engine.getLeaves(rootClusterId, count, 0);
  assert(static_cast<int32_t>(leaves.size()) == count);

  for (const auto& leaf : leaves) {
    assert(!leaf.isCluster);
    assert(leaf.pointIndex >= 0);
    assert(leaf.pointIndex < count);
  }

  const auto page = engine.getLeaves(rootClusterId, 10, 5);
  assert(static_cast<int32_t>(page.size()) == 10);
}

static void testGetLeavesPagination() {
  ClusterEngineCore engine;
  ClusterEngineConfig config;
  config.minPoints = 2;
  config.maxZoom = 16;
  engine.setOptions(config);

  std::vector<int32_t> ids = {0, 1, 2, 3};
  std::vector<double> lats = {52.0, 52.0001, 52.0002, 52.0003};
  std::vector<double> lngs = {21.0, 21.0001, 21.0002, 21.0003};
  engine.setPoints(ids.data(), lats.data(), lngs.data(), ids.size());
  engine.build();

  const auto clusters = engine.getClusters({53.0, 51.0, 22.0, 20.0, 0.0});
  assert(!clusters.empty());

  const auto all = engine.getLeaves(clusters.front().id, 100, 0);
  assert(all.size() == 4);

  const auto offset = engine.getLeaves(clusters.front().id, 100, 2);
  assert(offset.size() == 2);
}

static void testPropertyAggregationSumMinMax() {
  ClusterEngineCore engine;
  ClusterEngineConfig config;
  config.radius = 40.0;
  config.minPoints = 2;
  config.minZoom = 0;
  config.maxZoom = 16;
  config.extent = 512;
  config.nodeSize = 64;
  config.reducers = {AggregationReducer::Sum, AggregationReducer::Min, AggregationReducer::Max};
  engine.setOptions(config);

  const int32_t count = 4;
  std::vector<int32_t> ids = {0, 1, 2, 3};
  std::vector<double> lats = {52.0, 52.0001, 52.0002, 52.0003};
  std::vector<double> lngs = {21.0, 21.0001, 21.0002, 21.0003};
  const double vals[] = {
    10, 10, 10,
    20, 20, 20,
    30, 30, 30,
    40, 40, 40,
  };
  engine.setPoints(ids.data(), lats.data(), lngs.data(), static_cast<size_t>(count), vals, 3);
  engine.build();

  const auto clusters = engine.getClusters({53.0, 51.0, 22.0, 20.0, 0.0});
  assert(clusters.size() == 1);
  const auto& cluster = clusters.front();
  assert(cluster.isCluster);
  assert(cluster.count == 4);
  assert(cluster.values.size() == 3);
  assert(cluster.values[0] == 100.0);
  assert(cluster.values[1] == 10.0);
  assert(cluster.values[2] == 40.0);
}

static void testBufferV2Aggregation() {
  ClusterEngineCore engine;
  ClusterEngineConfig config;
  config.minPoints = 2;
  config.reducers = {AggregationReducer::Sum};
  engine.setOptions(config);

  const int32_t count = 3;
  const uint32_t magic = 0x4E4D4332u;
  std::vector<uint8_t> buf;
  auto pushU32 = [&](uint32_t v) {
    for (int b = 0; b < 4; b++) buf.push_back(static_cast<uint8_t>((v >> (b * 8)) & 0xFF));
  };
  auto pushF64 = [&](double v) {
    uint8_t tmp[8];
    std::memcpy(tmp, &v, 8);
    for (int b = 0; b < 8; b++) buf.push_back(tmp[b]);
  };
  pushU32(magic);
  pushU32(static_cast<uint32_t>(count));
  pushU32(1);
  const double lats[] = {52.0, 52.0001, 52.0002};
  const double lngs[] = {21.0, 21.0001, 21.0002};
  const double values[] = {5.0, 7.0, 11.0};
  for (int32_t i = 0; i < count; i++) {
    pushU32(static_cast<uint32_t>(i));
    pushF64(lats[i]);
    pushF64(lngs[i]);
    pushF64(values[i]);
  }

  engine.setPointsFromBuffer(buf.data(), buf.size());
  engine.build();

  const auto clusters = engine.getClusters({53.0, 51.0, 22.0, 20.0, 0.0});
  assert(clusters.size() == 1);
  assert(clusters.front().count == 3);
  assert(clusters.front().values.size() == 1);
  assert(clusters.front().values[0] == 23.0);
}

static void testPointIndexPreservesOriginalInputIndex() {
  ClusterEngineCore engine;
  ClusterEngineConfig config;
  config.minPoints = 2;
  config.maxZoom = 16;
  engine.setOptions(config);

  // Index 0 is invalid; index 1 is the only valid point. pointIndex must stay 1.
  std::vector<int32_t> ids = {0, 1};
  std::vector<double> lats = {999.0, 52.0};
  std::vector<double> lngs = {21.0, 21.0};
  engine.setPoints(ids.data(), lats.data(), lngs.data(), ids.size());
  engine.build();

  const auto clusters = engine.getClusters({53.0, 51.0, 22.0, 20.0, 0.0});
  assert(clusters.size() == 1);
  assert(!clusters.front().isCluster);
  assert(clusters.front().pointIndex == 1);
}

static void testClusterIdsSkipSurvivingPointIds() {
  ClusterEngineCore engine;
  ClusterEngineConfig config;
  config.minPoints = 2;
  config.minZoom = 0;
  config.maxZoom = 16;
  engine.setOptions(config);

  // Point 0 is dropped for a non-finite latitude, so the surviving count (2) is
  // smaller than the largest live point id (2). A cluster counter seeded from
  // the count would hand out id 2 and overwrite point 2 in the node index.
  std::vector<int32_t> ids = {0, 1, 2};
  std::vector<double> lats = {std::numeric_limits<double>::quiet_NaN(), 52.0, 52.0001};
  std::vector<double> lngs = {21.0, 21.0, 21.0001};
  engine.setPoints(ids.data(), lats.data(), lngs.data(), ids.size());
  engine.build();

  const auto clusters = engine.getClusters({53.0, 51.0, 22.0, 20.0, 0.0});
  assert(clusters.size() == 1);
  const auto& cluster = clusters.front();
  assert(cluster.isCluster);
  assert(cluster.count == 2);
  assert(cluster.id > 2);

  // A cluster reporting point_count == n must yield n leaves.
  const auto leaves = engine.getLeaves(cluster.id, 0, 0);
  assert(leaves.size() == 2);
  assert(engine.getChildren(cluster.id).size() == 2);

  bool sawPoint1 = false;
  bool sawPoint2 = false;
  for (const auto& leaf : leaves) {
    assert(!leaf.isCluster);
    if (leaf.pointIndex == 1) sawPoint1 = true;
    if (leaf.pointIndex == 2) sawPoint2 = true;
  }
  assert(sawPoint1 && sawPoint2);
}

static void testClusterIdsSkipSurvivingPointIdsFromBuffer() {
  ClusterEngineCore engine;
  ClusterEngineConfig config;
  config.minPoints = 2;
  config.minZoom = 0;
  config.maxZoom = 16;
  engine.setOptions(config);

  // Same collision through the packPoints() v1 buffer, which is how a marker
  // with an undefined latitude actually reaches C++.
  const int32_t count = 3;
  std::vector<uint8_t> buf;
  auto pushU32 = [&](uint32_t v) {
    for (int b = 0; b < 4; b++) buf.push_back(static_cast<uint8_t>((v >> (b * 8)) & 0xFF));
  };
  auto pushF64 = [&](double v) {
    uint8_t tmp[8];
    std::memcpy(tmp, &v, 8);
    for (int b = 0; b < 8; b++) buf.push_back(tmp[b]);
  };
  pushU32(static_cast<uint32_t>(count));
  const double lats[] = {std::numeric_limits<double>::quiet_NaN(), 52.0, 52.0001};
  const double lngs[] = {21.0, 21.0, 21.0001};
  for (int32_t i = 0; i < count; i++) {
    pushU32(static_cast<uint32_t>(i));
    pushF64(lats[i]);
    pushF64(lngs[i]);
  }

  assert(engine.setPointsFromBuffer(buf.data(), buf.size()));
  assert(engine.pointCount() == 2);
  engine.build();

  const auto clusters = engine.getClusters({53.0, 51.0, 22.0, 20.0, 0.0});
  assert(clusters.size() == 1);
  assert(clusters.front().count == 2);
  assert(engine.getLeaves(clusters.front().id, 0, 0).size() == 2);
}

static void testClusterIdsSkipSparsePointIds() {
  ClusterEngineCore engine;
  ClusterEngineConfig config;
  config.minPoints = 2;
  config.minZoom = 0;
  config.maxZoom = 16;
  engine.setOptions(config);

  // Caller-supplied ids need not be dense: {2, 3} would collide with a counter
  // seeded from the point count even though nothing was dropped.
  std::vector<int32_t> ids = {2, 3};
  std::vector<double> lats = {52.0, 52.0001};
  std::vector<double> lngs = {21.0, 21.0001};
  engine.setPoints(ids.data(), lats.data(), lngs.data(), ids.size());
  engine.build();

  const auto clusters = engine.getClusters({53.0, 51.0, 22.0, 20.0, 0.0});
  assert(clusters.size() == 1);
  assert(clusters.front().count == 2);
  assert(clusters.front().id > 3);
  assert(engine.getLeaves(clusters.front().id, 0, 0).size() == 2);
}

static void testGetLeavesUnlimited() {
  ClusterEngineCore engine;
  ClusterEngineConfig config;
  config.minPoints = 2;
  config.maxZoom = 16;
  engine.setOptions(config);

  std::vector<int32_t> ids = {0, 1, 2, 3};
  std::vector<double> lats = {52.0, 52.0001, 52.0002, 52.0003};
  std::vector<double> lngs = {21.0, 21.0001, 21.0002, 21.0003};
  engine.setPoints(ids.data(), lats.data(), lngs.data(), ids.size());
  engine.build();

  const auto clusters = engine.getClusters({53.0, 51.0, 22.0, 20.0, 0.0});
  assert(!clusters.empty());

  const auto all = engine.getLeaves(clusters.front().id, 0, 0);
  assert(all.size() == 4);
}

static void testInvalidBufferRejected() {
  ClusterEngineCore engine;
  ClusterEngineConfig config;
  config.minPoints = 2;
  engine.setOptions(config);

  const uint8_t tooShort[] = {0, 0, 0};
  assert(!engine.setPointsFromBuffer(tooShort, sizeof(tooShort)));
  assert(engine.pointCount() == 0);
  assert(!engine.isBuilt());

  std::vector<uint8_t> truncated = {4, 0, 0, 0, 1, 0, 0, 0};
  assert(!engine.setPointsFromBuffer(truncated.data(), truncated.size()));
  assert(engine.pointCount() == 0);
}

static void testMemorySizeReflectsNativeAllocations() {
  ClusterEngineCore engine;
  const size_t baseline = engine.memorySize();

  ClusterEngineConfig config;
  config.minPoints = 2;
  config.minZoom = 0;
  config.maxZoom = 4;
  engine.setOptions(config);

  const int32_t count = 50;
  std::vector<int32_t> ids(count);
  std::vector<double> lats(count);
  std::vector<double> lngs(count);
  for (int32_t i = 0; i < count; i++) {
    ids[i] = i;
    lats[i] = 52.0 + (i % 10) * 0.0001;
    lngs[i] = 21.0 + (i / 10) * 0.0001;
  }
  engine.setPoints(ids.data(), lats.data(), lngs.data(), static_cast<size_t>(count));
  const size_t afterPoints = engine.memorySize();
  assert(afterPoints > baseline);

  engine.build();
  assert(engine.memorySize() > afterPoints);
}

int main() {
  testGetLeavesReturnsAllPointsInCluster();
  testGetLeavesPagination();
  testPropertyAggregationSumMinMax();
  testBufferV2Aggregation();
  testPointIndexPreservesOriginalInputIndex();
  testClusterIdsSkipSurvivingPointIds();
  testClusterIdsSkipSurvivingPointIdsFromBuffer();
  testClusterIdsSkipSparsePointIds();
  testGetLeavesUnlimited();
  testInvalidBufferRejected();
  testMemorySizeReflectsNativeAllocations();
  std::printf("ClusterEngineCore tests passed.\n");
  return 0;
}
