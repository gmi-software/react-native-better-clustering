// Standalone sanity test for ClusterEngineCore getLeaves/indexes.
// Compile: c++ -std=c++20 -I. ClusterEngineCore.test.cpp -o cluster_test && ./cluster_test

#include "ClusterEngineCore.hpp"
#include <cassert>
#include <cstdint>
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

static void testMinLeafIdIsTheSmallestLeafAtEveryZoom() {
  ClusterEngineCore engine;
  ClusterEngineConfig config;
  config.radius = 40.0;
  config.minPoints = 2;
  config.minZoom = 0;
  config.maxZoom = 16;
  engine.setOptions(config);

  // Pairs that merge into ever larger clusters as the zoom drops.
  const int32_t count = 64;
  std::vector<int32_t> ids(count);
  std::vector<double> lats(count);
  std::vector<double> lngs(count);
  for (int32_t i = 0; i < count; i++) {
    ids[i] = i;
    lats[i] = 52.0 + (i % 8) * 0.002 + (i / 8) * 0.00001;
    lngs[i] = 21.0 + (i / 8) * 0.003;
  }
  engine.setPoints(ids.data(), lats.data(), lngs.data(), static_cast<size_t>(count));
  engine.build();

  int32_t clustersChecked = 0;
  for (int32_t z = config.minZoom; z <= config.maxZoom; z++) {
    for (const auto& node : engine.getClusters({85.0, -85.0, 180.0, -180.0, static_cast<double>(z)})) {
      if (!node.isCluster) {
        assert(node.minLeafId == node.id);
        continue;
      }
      int32_t smallest = count;
      for (const auto& leaf : engine.getLeaves(node.id, 0, 0)) {
        smallest = std::min(smallest, leaf.pointIndex);
      }
      assert(node.minLeafId == smallest);
      clustersChecked++;
    }
  }
  assert(clustersChecked > 10);
}

// Node counts produced by the reference supercluster implementation
// (supercluster@8.0.1) for the same points, options and viewport. Clustering
// output must match feature-for-feature at every zoom, otherwise `radius`,
// `extent` and `minPoints` do not mean what a migrating user expects.
//
// Regenerate with:
//   npx --yes -p supercluster@8 node scripts/generate-supercluster-parity-fixture.mjs
struct SuperclusterParityCase {
  int pointCount;
  uint32_t seed;
  double radius;
  int32_t extent;
  int32_t minZoom;
  int32_t maxZoom;
  int32_t minPoints;
  std::vector<int> expectedNodes;    // features returned per zoom, minZoom first
  std::vector<int> expectedClusters; // of which are clusters
};

// xorshift32, bit-identical to the JS generator in the fixture script.
static uint32_t parityRandom(uint32_t& state) {
  state ^= state << 13;
  state ^= state >> 17;
  state ^= state << 5;
  return state;
}

static void testSuperclusterParity() {
  // Note the one-zoom shift between the 256/512/1024 rows: doubling `extent`
  // halves the radius in supercluster's [0,1] projection, which is exactly one
  // zoom level. `extent` belongs to the projection, not to the radius.
  const std::vector<SuperclusterParityCase> cases = {
  // n=5000 seed=12345 radius=40 extent=512 zoom 0..16 minPoints=2
  {5000, 12345u, 40.0, 512, 0, 16, 2,
   {37, 154, 561, 1673, 3369, 4470, 4847, 4967, 4992, 4997, 4998, 4999, 5000, 5000, 5000, 5000, 5000},
   {37, 149, 517, 1210, 1184, 491, 152, 33, 8, 3, 2, 1, 0, 0, 0, 0, 0}},
  // n=5000 seed=12345 radius=40 extent=256 zoom 0..16 minPoints=2
  {5000, 12345u, 40.0, 256, 0, 16, 2,
   {11, 37, 154, 561, 1673, 3369, 4470, 4847, 4967, 4992, 4997, 4998, 4999, 5000, 5000, 5000, 5000},
   {11, 37, 149, 517, 1210, 1184, 491, 152, 33, 8, 3, 2, 1, 0, 0, 0, 0}},
  // n=5000 seed=12345 radius=40 extent=1024 zoom 0..16 minPoints=2
  {5000, 12345u, 40.0, 1024, 0, 16, 2,
   {154, 561, 1673, 3369, 4470, 4847, 4967, 4992, 4997, 4998, 4999, 5000, 5000, 5000, 5000, 5000, 5000},
   {149, 517, 1210, 1184, 491, 152, 33, 8, 3, 2, 1, 0, 0, 0, 0, 0, 0}},
  // n=3000 seed=777 radius=80 extent=512 zoom 1..14 minPoints=2
  {3000, 777u, 80.0, 512, 1, 14, 2,
   {39, 148, 510, 1382, 2342, 2779, 2947, 2984, 2996, 2999, 3000, 3000, 3000, 3000},
   {38, 143, 447, 832, 539, 212, 52, 16, 4, 1, 0, 0, 0, 0}},
  // n=8000 seed=424242 radius=25 extent=512 zoom 0..12 minPoints=2
  {8000, 424242u, 25.0, 512, 0, 12, 2,
   {94, 372, 1341, 3613, 6142, 7474, 7864, 7969, 7991, 7998, 7999, 8000, 8000},
   {93, 360, 1200, 2210, 1526, 511, 134, 30, 9, 2, 1, 0, 0}},
  };

  for (const auto& testCase : cases) {
    uint32_t state = testCase.seed;
    std::vector<int32_t> ids(static_cast<size_t>(testCase.pointCount));
    std::vector<double> lats(static_cast<size_t>(testCase.pointCount));
    std::vector<double> lngs(static_cast<size_t>(testCase.pointCount));
    for (int i = 0; i < testCase.pointCount; i++) {
      const uint32_t a = parityRandom(state);
      const uint32_t b = parityRandom(state);
      ids[static_cast<size_t>(i)] = i;
      lats[static_cast<size_t>(i)] = -60.0 + static_cast<double>(a % 1200001u) / 10000.0;
      lngs[static_cast<size_t>(i)] = -180.0 + static_cast<double>(b % 3600001u) / 10000.0;
    }

    ClusterEngineCore engine;
    ClusterEngineConfig config;
    config.radius = testCase.radius;
    config.minPoints = testCase.minPoints;
    config.minZoom = testCase.minZoom;
    config.maxZoom = testCase.maxZoom;
    config.extent = testCase.extent;
    config.nodeSize = 64;
    engine.setOptions(config);
    engine.setPoints(ids.data(), lats.data(), lngs.data(), static_cast<size_t>(testCase.pointCount));
    engine.build();

    for (int32_t z = testCase.minZoom; z <= testCase.maxZoom; z++) {
      const size_t slot = static_cast<size_t>(z - testCase.minZoom);
      const auto nodes = engine.getClusters({85.0, -85.0, 180.0, -180.0, static_cast<double>(z)});

      int clusterCount = 0;
      for (const auto& node : nodes) {
        if (node.isCluster) clusterCount++;
      }

      if (static_cast<int>(nodes.size()) != testCase.expectedNodes[slot] ||
          clusterCount != testCase.expectedClusters[slot]) {
        std::printf(
          "supercluster parity failed: radius=%.0f extent=%d minPoints=%d zoom=%d "
          "-> nodes %d (want %d), clusters %d (want %d)\n",
          testCase.radius, testCase.extent, testCase.minPoints, z,
          static_cast<int>(nodes.size()), testCase.expectedNodes[slot],
          clusterCount, testCase.expectedClusters[slot]);
        assert(false && "clustering diverged from supercluster");
      }
    }
  }
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
  testMinLeafIdIsTheSmallestLeafAtEveryZoom();
  testSuperclusterParity();
  std::printf("ClusterEngineCore tests passed.\n");
  return 0;
}
