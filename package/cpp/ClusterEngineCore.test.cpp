// Standalone sanity test for ClusterEngineCore getLeaves/indexes.
// Compile: c++ -std=c++20 -I. -fsanitize=address,undefined,float-cast-overflow -fno-sanitize-recover=all ClusterEngineCore.test.cpp -o cluster_test && ./cluster_test

#include "ClusterEngineCore.hpp"
#include "../bench/datasets.hpp"
#include <algorithm>
#include <array>
#include <cassert>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <limits>
#include <stdexcept>
#include <string>
#include <utility>
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

// An offset skips whole sub-clusters by their count. Every page of a large,
// nested cluster must still be the same slice of the full leaf order.
static void testGetLeavesPaginationOfLargeCluster() {
  ClusterEngineCore engine;
  ClusterEngineConfig config;
  config.minPoints = 2;
  config.maxZoom = 16;
  engine.setOptions(config);

  const int32_t count = 3000;
  std::vector<int32_t> ids(count);
  std::vector<double> lats(count);
  std::vector<double> lngs(count);
  uint32_t seed = 12345;
  const auto next = [&seed] {
    seed = seed * 1664525u + 1013904223u;
    return static_cast<double>(seed >> 8) / static_cast<double>(1u << 24);
  };
  for (int32_t i = 0; i < count; i++) {
    ids[i] = i;
    lats[i] = 52.0 + next() * 0.5;
    lngs[i] = 21.0 + next() * 0.5;
  }
  engine.setPoints(ids.data(), lats.data(), lngs.data(), static_cast<size_t>(count));
  engine.build();

  const auto clusters = engine.getClusters({53.0, 51.0, 22.0, 20.0, 0.0});
  const auto top = std::max_element(clusters.begin(), clusters.end(), [](const ClusterNode& a, const ClusterNode& b) {
    return a.count < b.count;
  });
  assert(top != clusters.end() && top->isCluster && top->count > 1000);
  const auto children = engine.getChildren(top->id);
  assert(std::any_of(children.begin(), children.end(), [](const ClusterNode& c) { return c.isCluster && c.count > 10; }));

  const auto all = engine.getLeaves(top->id, 0, 0);
  assert(static_cast<int32_t>(all.size()) == top->count);

  const auto expectSlice = [&](int32_t limit, int32_t offset) {
    const auto page = engine.getLeaves(top->id, limit, offset);
    const int32_t begin = std::clamp(offset, 0, top->count);
    const int32_t end = limit <= 0 ? top->count : std::min(top->count, begin + limit);
    assert(static_cast<int32_t>(page.size()) == end - begin);
    for (int32_t i = 0; i < end - begin; i++) {
      assert(page[i].id == all[begin + i].id);
    }
  };

  for (int32_t offset = -1; offset <= top->count + 1; offset++) {
    expectSlice(7, offset);
  }
  for (const int32_t limit : {0, 1, 10, 100, 1000}) {
    for (const int32_t offset : {0, 1, 9, 10, 500, top->count - 10, top->count - 1, top->count}) {
      expectSlice(limit, offset);
    }
  }
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

static void testClusterBoundsSpanTheLeaves() {
  ClusterEngineCore engine;
  ClusterEngineConfig config;
  config.minPoints = 2;
  config.minZoom = 0;
  config.maxZoom = 16;
  engine.setOptions(config);

  const int32_t count = 2000;
  std::vector<int32_t> ids(count);
  std::vector<double> lats(count);
  std::vector<double> lngs(count);
  uint32_t seed = 7;
  const auto next = [&seed] {
    seed = seed * 1664525u + 1013904223u;
    return static_cast<double>(seed) / 4294967296.0;
  };
  for (int32_t i = 0; i < count; i++) {
    ids[i] = i;
    lats[i] = 50.0 + next() * 4.0;
    lngs[i] = 18.0 + next() * 6.0;
  }

  assert(!engine.getClusterBounds(0).has_value());

  engine.setPoints(ids.data(), lats.data(), lngs.data(), static_cast<size_t>(count));
  engine.build();

  // Exactly the extremes of the coordinates each leaf was loaded with.
  size_t checked = 0;
  for (const double zoom : {0.0, 4.0, 8.0}) {
    for (const auto& node : engine.getClusters({90.0, -90.0, 180.0, -180.0, zoom})) {
      if (!node.isCluster) continue;
      double north = -std::numeric_limits<double>::infinity();
      double south = std::numeric_limits<double>::infinity();
      double east = -std::numeric_limits<double>::infinity();
      double west = std::numeric_limits<double>::infinity();
      for (const auto& leaf : engine.getLeaves(node.id, 0, 0)) {
        north = std::max(north, lats[leaf.pointIndex]);
        south = std::min(south, lats[leaf.pointIndex]);
        east = std::max(east, lngs[leaf.pointIndex]);
        west = std::min(west, lngs[leaf.pointIndex]);
      }
      const auto bounds = engine.getClusterBounds(node.id);
      assert(bounds.has_value());
      assert(bounds->north == north && bounds->south == south);
      assert(bounds->east == east && bounds->west == west);
      checked++;
    }
  }
  assert(checked > 10);

  // A point spans itself; an id that is no node has no box.
  const auto point = engine.getClusterBounds(42);
  assert(point.has_value());
  assert(point->north == lats[42] && point->south == lats[42]);
  assert(point->east == lngs[42] && point->west == lngs[42]);
  assert(!engine.getClusterBounds(-1).has_value());
  assert(!engine.getClusterBounds(std::numeric_limits<int32_t>::max()).has_value());
}

static void testClusterBoundsUseClampedLatitudes() {
  ClusterEngineCore engine;
  ClusterEngineConfig config;
  config.minPoints = 2;
  config.minZoom = 0;
  config.maxZoom = 16;
  engine.setOptions(config);

  std::vector<int32_t> ids = {0, 1};
  std::vector<double> lats = {89.0, 84.0};
  std::vector<double> lngs = {10.0, 10.0};
  engine.setPoints(ids.data(), lats.data(), lngs.data(), ids.size());
  engine.build();

  const auto clusters = engine.getClusters({90.0, -90.0, 180.0, -180.0, 0.0});
  assert(clusters.size() == 1 && clusters.front().isCluster);
  const auto bounds = engine.getClusterBounds(clusters.front().id);
  assert(bounds.has_value());
  assert(bounds->north == CLAMP_MAX_LATITUDE && bounds->south == 84.0);
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

// The record count and the property count come from the buffer, so the size
// check must not multiply them: `count * 20` wraps a 32-bit size_t (as on
// armeabi-v7a) from a 4-byte count, and `count * stride` wraps even a 64-bit
// one once numProps is large.
static void testBufferSizeOverflowRejected() {
  ClusterEngineCore engine;
  ClusterEngineConfig config;
  config.minPoints = 2;
  engine.setOptions(config);

  // 0x0CCCCCCD * 20 = 2^32 + 4.
  const uint8_t v1[] = {0xCD, 0xCC, 0xCC, 0x0C, 0, 0, 0, 0};
  assert(!engine.setPointsFromBuffer(v1, sizeof(v1)));
  assert(engine.pointCount() == 0);

  // 12 + 1380655685 * (20 + 1670107204 * 8) = 2^64 + 16, which a 64-bit
  // size_t wraps to exactly this buffer's 16 bytes.
  std::vector<uint8_t> v2(16, 0);
  const uint32_t header[] = {ClusterEngineCore::kBufferMagicV2, 1380655685u, 1670107204u};
  std::memcpy(v2.data(), header, sizeof(header));
  assert(!engine.setPointsFromBuffer(v2.data(), v2.size()));
  assert(engine.pointCount() == 0);

  // numProps alone overflowing the stride.
  const uint32_t wide[] = {ClusterEngineCore::kBufferMagicV2, 1u, 0xFFFFFFFFu};
  assert(!engine.setPointsFromBuffer(reinterpret_cast<const uint8_t*>(wide), sizeof(wide)));
}

// Cluster ids continue from the largest point id, so a point id that leaves no
// room for them would overflow int32. packPoints writes ids below the count.
static void testBufferPointIdsLeaveRoomForClusterIds() {
  ClusterEngineCore engine;
  ClusterEngineConfig config;
  config.minPoints = 2;
  engine.setOptions(config);

  auto buffer = [](std::vector<int32_t> ids) {
    std::vector<uint8_t> buf(4 + ids.size() * 20, 0);
    const uint32_t count = static_cast<uint32_t>(ids.size());
    std::memcpy(buf.data(), &count, 4);
    for (size_t i = 0; i < ids.size(); i++) {
      const double lat = 52.0;
      const double lng = 21.0 + static_cast<double>(i) * 1e-5;
      std::memcpy(buf.data() + 4 + i * 20, &ids[i], 4);
      std::memcpy(buf.data() + 8 + i * 20, &lat, 8);
      std::memcpy(buf.data() + 16 + i * 20, &lng, 8);
    }
    return buf;
  };

  const int32_t max = std::numeric_limits<int32_t>::max();
  auto rejected = buffer({0, max});
  assert(!engine.setPointsFromBuffer(rejected.data(), rejected.size()));
  assert(engine.pointCount() == 0);

  // The largest id that still leaves room for one cluster per point.
  auto accepted = buffer({-7, max - 2});
  assert(engine.setPointsFromBuffer(accepted.data(), accepted.size()));
  engine.build();
  const auto nodes = engine.getClusters({90.0, -90.0, 180.0, -180.0, 0.0});
  assert(nodes.size() == 1 && nodes.front().isCluster);
  assert(nodes.front().id == max - 1);
  assert(engine.getLeaves(nodes.front().id, 0, 0).size() == 2);
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

// Output of the reference supercluster implementation (supercluster@8.0.1) for
// the same points, options and viewport: node and cluster counts, a hash of
// which points share a cluster, and a hash of each cluster's expansion zoom.
// Clustering must match feature-for-feature at every zoom, members included,
// otherwise `radius`, `extent` and `minPoints` do not mean what a migrating
// user expects, and zooming to the expansion zoom must split the same clusters.
//
// Regenerate from `package/` with:
//   node scripts/generate-supercluster-parity-fixture.mjs
struct SuperclusterParityCase {
  int pointCount;
  uint32_t seed;
  double radius;
  int32_t extent;
  int32_t minZoom;
  int32_t maxZoom;
  int32_t minPoints;
  std::vector<int> expectedNodes;           // features returned per zoom, minZoom to maxZoom + 1
  std::vector<int> expectedClusters;        // of which are clusters
  std::vector<uint32_t> expectedMembership; // parityMembershipHash per zoom
  std::vector<uint32_t> expectedExpansion;  // parityExpansionHash per zoom
};

// xorshift32, bit-identical to the JS generator in the fixture script.
static uint32_t parityRandom(uint32_t& state) {
  state ^= state << 13;
  state ^= state >> 17;
  state ^= state << 5;
  return state;
}

// Hashes which points share a cluster, independent of cluster ids. Every point
// is labelled with the smallest id among the leaves of the node that contains
// it, then the labels are folded with 32-bit FNV-1a in point-id order.
// Bit-identical to membershipHash in the fixture script.
static uint32_t parityMembershipHash(const ClusterEngineCore& engine,
                                     const std::vector<ClusterNode>& nodes,
                                     int pointCount) {
  std::vector<uint32_t> labels(static_cast<size_t>(pointCount), 0);
  for (const auto& node : nodes) {
    if (!node.isCluster) {
      labels[static_cast<size_t>(node.id)] = static_cast<uint32_t>(node.id);
      continue;
    }
    const auto leaves = engine.getLeaves(node.id, 0, 0);
    int32_t label = leaves.front().id;
    for (const auto& leaf : leaves) label = std::min(label, leaf.id);
    for (const auto& leaf : leaves) labels[static_cast<size_t>(leaf.id)] = static_cast<uint32_t>(label);
  }

  uint32_t hash = 2166136261u;
  for (const uint32_t label : labels) {
    hash ^= label;
    hash *= 16777619u;
  }
  return hash;
}

// Hashes each cluster's expansion zoom, keyed by the smallest id among its
// leaves: `(minLeafId, getClusterExpansionZoom)` pairs sorted by `minLeafId`,
// both folded with 32-bit FNV-1a. Bit-identical to expansionHash in the
// fixture script.
static uint32_t parityExpansionHash(const ClusterEngineCore& engine,
                                    const std::vector<ClusterNode>& nodes) {
  std::vector<std::pair<int32_t, int32_t>> pairs;
  for (const auto& node : nodes) {
    if (!node.isCluster) continue;
    pairs.emplace_back(node.minLeafId, engine.getClusterExpansionZoom(node.id));
  }
  std::sort(pairs.begin(), pairs.end());

  uint32_t hash = 2166136261u;
  for (const auto& [minLeafId, expansionZoom] : pairs) {
    hash ^= static_cast<uint32_t>(minLeafId);
    hash *= 16777619u;
    hash ^= static_cast<uint32_t>(expansionZoom);
    hash *= 16777619u;
  }
  return hash;
}

static void testSuperclusterParity() {
  // Note the one-zoom shift between the 256/512/1024 rows: doubling `extent`
  // halves the radius in supercluster's [0,1] projection, which is exactly one
  // zoom level. `extent` belongs to the projection, not to the radius.
  const std::vector<SuperclusterParityCase> cases = {
  // n=5000 seed=12345 radius=40 extent=512 zoom 0..16 minPoints=2
  {5000, 12345u, 40.0, 512, 0, 16, 2,
   {37, 154, 561, 1673, 3369, 4470, 4847, 4967, 4992, 4997, 4998, 4999, 5000, 5000, 5000, 5000, 5000, 5000},
   {37, 149, 517, 1210, 1184, 491, 152, 33, 8, 3, 2, 1, 0, 0, 0, 0, 0, 0},
   {1805767755u, 606907344u, 251924099u, 3592547414u, 220092997u, 4170046084u, 2925551006u, 3474631211u, 1333171577u, 2017577864u, 2480066375u, 1314005163u, 2356979101u, 2356979101u, 2356979101u, 2356979101u, 2356979101u, 2356979101u},
   {908295453u, 1735606782u, 3222375310u, 3309277285u, 2388417153u, 203899112u, 3887135902u, 649398139u, 2678596316u, 2291465887u, 3885708800u, 4185239937u, 2166136261u, 2166136261u, 2166136261u, 2166136261u, 2166136261u, 2166136261u}},
  // n=5000 seed=12345 radius=40 extent=256 zoom 0..16 minPoints=2
  {5000, 12345u, 40.0, 256, 0, 16, 2,
   {11, 37, 154, 561, 1673, 3369, 4470, 4847, 4967, 4992, 4997, 4998, 4999, 5000, 5000, 5000, 5000, 5000},
   {11, 37, 149, 517, 1210, 1184, 491, 152, 33, 8, 3, 2, 1, 0, 0, 0, 0, 0},
   {2501411492u, 1805767755u, 606907344u, 251924099u, 3592547414u, 220092997u, 4170046084u, 2925551006u, 3474631211u, 1333171577u, 2017577864u, 2480066375u, 1314005163u, 2356979101u, 2356979101u, 2356979101u, 2356979101u, 2356979101u},
   {2901069191u, 446459210u, 1109370185u, 2470694807u, 1559555949u, 2215230431u, 2090804177u, 2143146402u, 698438652u, 3793120724u, 3800605278u, 3074938394u, 4168462318u, 2166136261u, 2166136261u, 2166136261u, 2166136261u, 2166136261u}},
  // n=5000 seed=12345 radius=40 extent=1024 zoom 0..16 minPoints=2
  {5000, 12345u, 40.0, 1024, 0, 16, 2,
   {154, 561, 1673, 3369, 4470, 4847, 4967, 4992, 4997, 4998, 4999, 5000, 5000, 5000, 5000, 5000, 5000, 5000},
   {149, 517, 1210, 1184, 491, 152, 33, 8, 3, 2, 1, 0, 0, 0, 0, 0, 0, 0},
   {606907344u, 251924099u, 3592547414u, 220092997u, 4170046084u, 2925551006u, 3474631211u, 1333171577u, 2017577864u, 2480066375u, 1314005163u, 2356979101u, 2356979101u, 2356979101u, 2356979101u, 2356979101u, 2356979101u, 2356979101u},
   {2008030271u, 2096192001u, 86362713u, 719690823u, 4183232535u, 3830296254u, 3938549614u, 3787935432u, 2530141240u, 998378074u, 4202017556u, 2166136261u, 2166136261u, 2166136261u, 2166136261u, 2166136261u, 2166136261u, 2166136261u}},
  // n=3000 seed=777 radius=80 extent=512 zoom 1..14 minPoints=2
  {3000, 777u, 80.0, 512, 1, 14, 2,
   {39, 148, 510, 1382, 2342, 2779, 2947, 2984, 2996, 2999, 3000, 3000, 3000, 3000, 3000},
   {38, 143, 447, 832, 539, 212, 52, 16, 4, 1, 0, 0, 0, 0, 0},
   {993833477u, 2141167518u, 3161340709u, 3918890464u, 1036665440u, 3212688082u, 492023470u, 4180803411u, 921193384u, 4107195081u, 3305376653u, 3305376653u, 3305376653u, 3305376653u, 3305376653u},
   {2013879702u, 2123372854u, 3188312041u, 1403982669u, 2167766900u, 1877615968u, 3665749095u, 2929400263u, 1421908612u, 723098213u, 2166136261u, 2166136261u, 2166136261u, 2166136261u, 2166136261u}},
  // n=5000 seed=12345 radius=40 extent=512 zoom 0..8 minPoints=2
  {5000, 12345u, 40.0, 512, 0, 8, 2,
   {37, 154, 561, 1673, 3369, 4470, 4847, 4967, 4992, 5000},
   {37, 149, 517, 1210, 1184, 491, 152, 33, 8, 0},
   {1805767755u, 606907344u, 251924099u, 3592547414u, 220092997u, 4170046084u, 2925551006u, 3474631211u, 1333171577u, 2356979101u},
   {908295453u, 1735606782u, 3222375310u, 4114412131u, 418889501u, 206123500u, 1546608014u, 2620859791u, 3955589788u, 2166136261u}},
  // n=8000 seed=424242 radius=25 extent=512 zoom 0..12 minPoints=2
  {8000, 424242u, 25.0, 512, 0, 12, 2,
   {94, 372, 1341, 3613, 6142, 7474, 7864, 7969, 7991, 7998, 7999, 8000, 8000, 8000},
   {93, 360, 1200, 2210, 1526, 511, 134, 30, 9, 2, 1, 0, 0, 0},
   {2473319454u, 999143822u, 3072884681u, 2567654997u, 3013614691u, 3374615311u, 3762316709u, 909188336u, 3632899351u, 26060799u, 1832098647u, 2459957253u, 2459957253u, 2459957253u},
   {193477675u, 364685338u, 1078684228u, 1842364820u, 2604891972u, 3412529013u, 202904108u, 3785568585u, 843412277u, 1752323339u, 831472737u, 2166136261u, 2166136261u, 2166136261u}},
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

    for (int32_t z = testCase.minZoom; z <= testCase.maxZoom + 1; z++) {
      const size_t slot = static_cast<size_t>(z - testCase.minZoom);
      const auto nodes = engine.getClusters({85.0, -85.0, 180.0, -180.0, static_cast<double>(z)});

      int clusterCount = 0;
      for (const auto& node : nodes) {
        if (node.isCluster) clusterCount++;
      }

      const uint32_t membership = parityMembershipHash(engine, nodes, testCase.pointCount);
      const uint32_t expansion = parityExpansionHash(engine, nodes);

      if (static_cast<int>(nodes.size()) != testCase.expectedNodes[slot] ||
          clusterCount != testCase.expectedClusters[slot] ||
          membership != testCase.expectedMembership[slot] ||
          expansion != testCase.expectedExpansion[slot]) {
        std::printf(
          "supercluster parity failed: radius=%.0f extent=%d minPoints=%d zoom=%d "
          "-> nodes %d (want %d), clusters %d (want %d), membership %u (want %u), "
          "expansion %u (want %u)\n",
          testCase.radius, testCase.extent, testCase.minPoints, z,
          static_cast<int>(nodes.size()), testCase.expectedNodes[slot],
          clusterCount, testCase.expectedClusters[slot],
          membership, testCase.expectedMembership[slot],
          expansion, testCase.expectedExpansion[slot]);
        assert(false && "clustering diverged from supercluster");
      }
    }
  }
}

// supercluster@8.0.1 results for viewport queries around the antimeridian,
// over points within 10 degrees of it on both sides: how many features each
// query returns and a hash of which. Covers every form a caller can pass:
// unwrapped past 180 (what a map region produces), wrapped with west > east,
// far outside [-180, 180], latitudes past the poles, and 360 degrees or wider.
//
// Regenerated by the same script as testSuperclusterParity.
struct AntimeridianParityQuery {
  double west;
  double south;
  double east;
  double north;
  int32_t zoom;
  int expectedNodes;
  uint32_t expectedHash; // parityFeatureSetHash
};

// `(minLeafId, count)` per returned node, sorted, folded with 32-bit FNV-1a, so
// a missing or duplicated node changes it. Bit-identical to featureSetHash in
// the fixture script.
static uint32_t parityFeatureSetHash(const std::vector<ClusterNode>& nodes) {
  std::vector<std::pair<int32_t, int32_t>> pairs;
  pairs.reserve(nodes.size());
  for (const auto& node : nodes) pairs.emplace_back(node.minLeafId, node.count);
  std::sort(pairs.begin(), pairs.end());

  uint32_t hash = 2166136261u;
  for (const auto& [minLeafId, count] : pairs) {
    hash ^= static_cast<uint32_t>(minLeafId);
    hash *= 16777619u;
    hash ^= static_cast<uint32_t>(count);
    hash *= 16777619u;
  }
  return hash;
}

static void testSuperclusterAntimeridianParity() {
  const std::vector<AntimeridianParityQuery> queries = {
  {165.0, -40.0, 185.0, 10.0, 2, 7, 4023661163u},
  {165.0, -40.0, 185.0, 10.0, 6, 741, 1169371758u},
  {165.0, -40.0, 185.0, 10.0, 10, 1462, 3658265493u},
  {165.0, -40.0, 185.0, 10.0, 16, 1468, 2192578885u},
  {165.0, -40.0, 185.0, 10.0, 17, 1468, 2192578885u},
  {165.0, -40.0, -175.0, 10.0, 2, 7, 4023661163u},
  {165.0, -40.0, -175.0, 10.0, 6, 741, 1169371758u},
  {165.0, -40.0, -175.0, 10.0, 10, 1462, 3658265493u},
  {165.0, -40.0, -175.0, 10.0, 16, 1468, 2192578885u},
  {165.0, -40.0, -175.0, 10.0, 17, 1468, 2192578885u},
  {-195.0, -40.0, -175.0, 10.0, 2, 7, 4023661163u},
  {-195.0, -40.0, -175.0, 10.0, 6, 741, 1169371758u},
  {-195.0, -40.0, -175.0, 10.0, 10, 1462, 3658265493u},
  {-195.0, -40.0, -175.0, 10.0, 16, 1468, 2192578885u},
  {-195.0, -40.0, -175.0, 10.0, 17, 1468, 2192578885u},
  {535.0, -40.0, 545.0, 10.0, 2, 4, 2256261759u},
  {535.0, -40.0, 545.0, 10.0, 6, 486, 486665498u},
  {535.0, -40.0, 545.0, 10.0, 10, 941, 1572366166u},
  {535.0, -40.0, 545.0, 10.0, 16, 942, 1083405345u},
  {535.0, -40.0, 545.0, 10.0, 17, 942, 1083405345u},
  {175.0, -25.0, 179.5, -5.0, 2, 0, 2166136261u},
  {175.0, -25.0, 179.5, -5.0, 6, 139, 3628311341u},
  {175.0, -25.0, 179.5, -5.0, 10, 256, 148373853u},
  {175.0, -25.0, 179.5, -5.0, 16, 256, 148373853u},
  {175.0, -25.0, 179.5, -5.0, 17, 256, 148373853u},
  {178.0, -100.0, 182.0, 100.0, 2, 1, 2628540102u},
  {178.0, -100.0, 182.0, 100.0, 6, 193, 230248810u},
  {178.0, -100.0, 182.0, 100.0, 10, 369, 3980967683u},
  {178.0, -100.0, 182.0, 100.0, 16, 369, 3980967683u},
  {178.0, -100.0, 182.0, 100.0, 17, 369, 3980967683u},
  {-180.0, -90.0, 180.0, 90.0, 2, 10, 2712912158u},
  {-180.0, -90.0, 180.0, 90.0, 6, 1000, 2865334831u},
  {-180.0, -90.0, 180.0, 90.0, 10, 1994, 1817453981u},
  {-180.0, -90.0, 180.0, 90.0, 16, 2000, 3839929109u},
  {-180.0, -90.0, 180.0, 90.0, 17, 2000, 3839929109u},
  {0.0, -90.0, 360.0, 90.0, 2, 10, 2712912158u},
  {0.0, -90.0, 360.0, 90.0, 6, 1000, 2865334831u},
  {0.0, -90.0, 360.0, 90.0, 10, 1994, 1817453981u},
  {0.0, -90.0, 360.0, 90.0, 16, 2000, 3839929109u},
  {0.0, -90.0, 360.0, 90.0, 17, 2000, 3839929109u},
  {-200.0, -90.0, 200.0, 90.0, 2, 10, 2712912158u},
  {-200.0, -90.0, 200.0, 90.0, 6, 1000, 2865334831u},
  {-200.0, -90.0, 200.0, 90.0, 10, 1994, 1817453981u},
  {-200.0, -90.0, 200.0, 90.0, 16, 2000, 3839929109u},
  {-200.0, -90.0, 200.0, 90.0, 17, 2000, 3839929109u},
  };

  // Must match ANTIMERIDIAN and makeAntimeridianFeatures in the fixture script.
  const int pointCount = 2000;
  uint32_t state = 2024u;
  std::vector<int32_t> ids(static_cast<size_t>(pointCount));
  std::vector<double> lats(static_cast<size_t>(pointCount));
  std::vector<double> lngs(static_cast<size_t>(pointCount));
  for (int i = 0; i < pointCount; i++) {
    const uint32_t a = parityRandom(state);
    const uint32_t b = parityRandom(state);
    int64_t lngE4 = 1700000 + static_cast<int64_t>(b % 200001u);
    if (lngE4 > 1800000) lngE4 -= 3600000;
    ids[static_cast<size_t>(i)] = i;
    lats[static_cast<size_t>(i)] = -30.0 + static_cast<double>(a % 300001u) / 10000.0;
    lngs[static_cast<size_t>(i)] = static_cast<double>(lngE4) / 10000.0;
  }

  ClusterEngineCore engine;
  ClusterEngineConfig config;
  config.radius = 40.0;
  config.minPoints = 2;
  config.minZoom = 0;
  config.maxZoom = 16;
  config.extent = 512;
  config.nodeSize = 64;
  engine.setOptions(config);
  engine.setPoints(ids.data(), lats.data(), lngs.data(), static_cast<size_t>(pointCount));
  engine.build();

  for (const auto& query : queries) {
    const auto nodes = engine.getClusters(
      {query.north, query.south, query.east, query.west, static_cast<double>(query.zoom)});
    const uint32_t hash = parityFeatureSetHash(nodes);

    if (static_cast<int>(nodes.size()) != query.expectedNodes || hash != query.expectedHash) {
      std::printf(
        "supercluster antimeridian parity failed: bbox [%g, %g, %g, %g] zoom=%d "
        "-> nodes %d (want %d), hash %u (want %u)\n",
        query.west, query.south, query.east, query.north, query.zoom,
        static_cast<int>(nodes.size()), query.expectedNodes, hash, query.expectedHash);
      assert(false && "antimeridian query diverged from supercluster");
    }
  }
}

// supercluster@8.0.1 on the core benchmark's datasets (bench/datasets.hpp:
// uniform, city, blobs, identical, grid, antimeridian), at every zoom from
// minZoom to maxZoom + 1. Besides the counts, membership and expansion hashes
// of testSuperclusterParity, it compares the clusters' centroids (the sums of
// their longitudes and latitudes, to 1e-6 degrees per cluster) and
// clusterProperties: an integer weight reduced with sum, min and max. Each
// dataset runs twice, with and without the reducers, since aggregation takes
// its own path through build().
//
// The reference is supercluster with its float32 rounding taken out, and the
// engine must match it exactly. Stock supercluster rounds projected
// coordinates to float32 and keeps its KD-trees in a Float32Array, so on dense
// data a point near the edge of a radius can fall on the other side of it, and
// centroids move by up to 2^-24 of the world (about 2e-5 degrees). The comment
// above each case lists the zooms where stock supercluster clusters
// differently.
//
// Regenerated by the same script as testSuperclusterParity.
struct DatasetParityCase {
  const char* dataset;
  std::vector<int> expectedNodes;
  std::vector<int> expectedClusters;
  std::vector<uint32_t> expectedMembership; // parityMembershipHash per zoom
  std::vector<uint32_t> expectedExpansion;  // parityExpansionHash per zoom
  std::vector<uint32_t> expectedAggregate;  // parityAggregateHash per zoom
  std::vector<double> expectedLngSum;       // of cluster centroids per zoom
  std::vector<double> expectedLatSum;
};

// `(minLeafId, sum, min, max)` per cluster, sorted, folded with 32-bit FNV-1a.
// Bit-identical to aggregateHash in the fixture script.
static uint32_t parityAggregateHash(const std::vector<ClusterNode>& nodes) {
  std::vector<std::array<uint32_t, 4>> rows;
  for (const auto& node : nodes) {
    if (!node.isCluster) continue;
    rows.push_back({static_cast<uint32_t>(node.minLeafId), static_cast<uint32_t>(node.values[0]),
                    static_cast<uint32_t>(node.values[1]), static_cast<uint32_t>(node.values[2])});
  }
  std::sort(rows.begin(), rows.end());

  uint32_t hash = 2166136261u;
  for (const auto& row : rows) {
    for (const uint32_t value : row) {
      hash ^= value;
      hash *= 16777619u;
    }
  }
  return hash;
}

static void testSuperclusterDatasetParity() {
  const std::vector<DatasetParityCase> cases = {
  // uniform: stock (float32) supercluster clusters differently at no zoom
  {"uniform",
   {144, 547, 1677, 3411, 4478, 4881, 4962, 4988, 4996, 5000, 5000, 5000, 5000, 5000, 5000, 5000, 5000, 5000, 5000, 5000, 5000},
   {143, 517, 1237, 1176, 483, 115, 38, 12, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0},
   {3479156714u, 1765785884u, 1390503994u, 3434480556u, 1379582160u, 3650110973u, 193581191u, 524662914u, 2568856255u, 2356979101u, 2356979101u, 2356979101u, 2356979101u, 2356979101u, 2356979101u, 2356979101u, 2356979101u, 2356979101u, 2356979101u, 2356979101u, 2356979101u},
   {3419311976u, 1425683657u, 1035439177u, 2269140351u, 1994857345u, 1159526827u, 1821202431u, 2276121639u, 2161951567u, 2166136261u, 2166136261u, 2166136261u, 2166136261u, 2166136261u, 2166136261u, 2166136261u, 2166136261u, 2166136261u, 2166136261u, 2166136261u, 2166136261u},
   {3242046870u, 2301988678u, 1395137815u, 1642191424u, 1541573611u, 2672824487u, 3492772351u, 2606013123u, 4149367729u, 2166136261u, 2166136261u, 2166136261u, 2166136261u, 2166136261u, 2166136261u, 2166136261u, 2166136261u, 2166136261u, 2166136261u, 2166136261u, 2166136261u},
   {124.24906434858849, -1290.5389009467772, 620.6232495417571, -45.243308333342895, 1162.2094916666867, -605.7985500000021, -532.7448999999995, 9.674900000000093, 16.992050000000006, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0},
   {-107.73081941531132, 242.2254320682852, -991.4957913885364, -138.56829566939965, -504.00009862579407, 21.652980293587007, 54.14815598217952, -122.71351086737778, -15.21145126826984, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0}},
  // city: stock (float32) supercluster clusters differently at zoom 7, 8, 9, 10, 11, 12, 13, 14, 15, 18
  {"city",
   {1, 1, 1, 1, 1, 2, 9, 35, 121, 386, 1102, 2453, 3874, 4657, 4907, 4973, 4994, 4998, 4999, 5000, 5000},
   {1, 1, 1, 1, 1, 2, 9, 33, 106, 320, 796, 1233, 914, 331, 93, 27, 6, 2, 1, 0, 0},
   {1266526053u, 1266526053u, 1266526053u, 1266526053u, 1266526053u, 3801114494u, 3360746106u, 616462470u, 2144419407u, 4220865050u, 4143449986u, 2060104832u, 3948847317u, 2305438090u, 2364557413u, 240295011u, 632369689u, 374733890u, 3908413697u, 2356979101u, 2356979101u},
   {192319067u, 192319067u, 192319067u, 192319067u, 192319067u, 1541727182u, 4022624943u, 1156112516u, 4082560499u, 1693194741u, 4093502696u, 1056093673u, 374897734u, 2285312433u, 3184030734u, 2484939446u, 1652902683u, 2962029446u, 1049899859u, 2166136261u, 2166136261u},
   {409980304u, 409980304u, 409980304u, 409980304u, 409980304u, 3287436595u, 2608986500u, 3014647342u, 3434736224u, 476413369u, 1407414633u, 286069951u, 3633807498u, 3591485868u, 1347909398u, 1183887420u, 3075079150u, 1527889547u, 4268625839u, 2166136261u, 2166136261u},
   {21.011810760000014, 21.011810760000014, 21.011810760000014, 21.011810760000014, 21.011810760000014, 41.68685783868848, 188.89566924176387, 693.6347587745428, 2227.4050583741873, 6726.72014447853, 16726.449512806874, 25906.669074178593, 19202.16442450002, 6958.498099999997, 1953.93108, 567.574535, 126.18876999999998, 42.06322, 21.07666499999997, 0.0, 0.0},
   {52.22898524487812, 52.22898524487812, 52.22898524487812, 52.22898524487812, 52.22898524487812, 104.27086841186988, 469.796242180133, 1722.9799075438286, 5535.02480838542, 16712.596449777386, 41573.29153415303, 64396.52986224403, 47736.88144560364, 17288.75968691631, 4856.688485016774, 1410.4125500013038, 313.1728900000332, 104.36166500000704, 52.20768500000253, 0.0, 0.0}},
  // blobs: stock (float32) supercluster clusters differently at zoom 13
  {"blobs",
   {20, 23, 23, 45, 132, 427, 1162, 2301, 3332, 4094, 4587, 4848, 4960, 4994, 4998, 4999, 4999, 4999, 4999, 4999, 5000},
   {20, 23, 23, 39, 119, 371, 795, 933, 723, 459, 275, 130, 38, 6, 2, 1, 1, 1, 1, 1, 0},
   {2297208507u, 2725116627u, 2725116627u, 4048551282u, 354862388u, 405149448u, 2653013922u, 3842720027u, 2217362898u, 1201147012u, 2087076948u, 870520173u, 2634197667u, 3119738846u, 632868259u, 3934922889u, 3934922889u, 3934922889u, 3934922889u, 3934922889u, 2356979101u},
   {2369167380u, 832552962u, 832552962u, 2813022756u, 3071785308u, 1615399785u, 681023116u, 835742580u, 2300897823u, 926358310u, 1453095658u, 3877955641u, 3502471183u, 141462116u, 3409808352u, 3777672245u, 3777672245u, 3777672245u, 3777672245u, 3777672245u, 2166136261u},
   {177545840u, 590089424u, 590089424u, 1769940642u, 691904606u, 3996168308u, 1178245847u, 614742171u, 287876133u, 4210294974u, 3834679757u, 2988097159u, 3418786524u, 1269574397u, 1133622447u, 1890734006u, 1890734006u, 1890734006u, 1890734006u, 1890734006u, 2166136261u},
   {-196.14826691886566, -385.8231525918603, -385.8231525918603, 213.86525206827105, 1347.2116139128227, 3528.1226200255314, 5080.782199278573, -8596.082222854515, -25496.242764450973, -25989.957658548923, -13522.280979166662, -3318.7316924999977, -611.9107500000002, -624.0256000000002, -21.291000000000025, 151.01004999999998, 151.01004999999998, 151.01004999999998, 151.01004999999998, 151.01004999999998, 0.0},
   {-213.55829320952697, -287.13706420004127, -287.13706420004127, -596.7482559567084, -1145.5843173534934, -2766.4622243847757, -6712.798477053103, -9950.070064568079, -10421.532649952733, -8958.322357204108, -7032.161604993427, -3549.451670701391, -997.9286750924961, -142.6656000024995, -27.920775000285545, 4.957700000000017, 4.957700000000017, 4.957700000000017, 4.957700000000017, 4.957700000000017, 0.0}},
  // identical: stock (float32) supercluster clusters differently at no zoom
  {"identical",
   {1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 5000},
   {1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0},
   {1266526053u, 1266526053u, 1266526053u, 1266526053u, 1266526053u, 1266526053u, 1266526053u, 1266526053u, 1266526053u, 1266526053u, 1266526053u, 1266526053u, 1266526053u, 1266526053u, 1266526053u, 1266526053u, 1266526053u, 1266526053u, 1266526053u, 1266526053u, 2356979101u},
   {4235622078u, 4235622078u, 4235622078u, 4235622078u, 4235622078u, 4235622078u, 4235622078u, 4235622078u, 4235622078u, 4235622078u, 4235622078u, 4235622078u, 4235622078u, 4235622078u, 4235622078u, 4235622078u, 4235622078u, 4235622078u, 4235622078u, 4235622078u, 2166136261u},
   {409980304u, 409980304u, 409980304u, 409980304u, 409980304u, 409980304u, 409980304u, 409980304u, 409980304u, 409980304u, 409980304u, 409980304u, 409980304u, 409980304u, 409980304u, 409980304u, 409980304u, 409980304u, 409980304u, 409980304u, 2166136261u},
   {21.012200000010516, 21.012200000010516, 21.012200000010516, 21.012200000010516, 21.012200000010516, 21.012200000010516, 21.012200000010516, 21.012200000010516, 21.012200000010516, 21.012200000010516, 21.012200000010516, 21.012200000010516, 21.012200000010516, 21.012200000010516, 21.012200000010516, 21.012200000010516, 21.012200000010516, 21.012200000010516, 21.012200000010516, 21.012200000010516, 0.0},
   {52.22970000000117, 52.22970000000117, 52.22970000000117, 52.22970000000117, 52.22970000000117, 52.22970000000117, 52.22970000000117, 52.22970000000117, 52.22970000000117, 52.22970000000117, 52.22970000000117, 52.22970000000117, 52.22970000000117, 52.22970000000117, 52.22970000000117, 52.22970000000117, 52.22970000000117, 52.22970000000117, 52.22970000000117, 52.22970000000117, 0.0}},
  // grid: stock (float32) supercluster clusters differently at no zoom
  {"grid",
   {1, 1, 1, 1, 1, 1, 1, 1, 3, 10, 35, 157, 630, 2500, 5000, 5000, 5000, 5000, 5000, 5000, 5000},
   {1, 1, 1, 1, 1, 1, 1, 1, 3, 10, 35, 157, 630, 2465, 0, 0, 0, 0, 0, 0, 0},
   {1266526053u, 1266526053u, 1266526053u, 1266526053u, 1266526053u, 1266526053u, 1266526053u, 1266526053u, 2213112145u, 1240385801u, 2741722193u, 1534260169u, 1579417665u, 3869118707u, 2356979101u, 2356979101u, 2356979101u, 2356979101u, 2356979101u, 2356979101u, 2356979101u},
   {141986210u, 141986210u, 141986210u, 141986210u, 141986210u, 141986210u, 141986210u, 141986210u, 493072547u, 1511260911u, 3587613083u, 4215880278u, 3815337673u, 2967008240u, 2166136261u, 2166136261u, 2166136261u, 2166136261u, 2166136261u, 2166136261u, 2166136261u},
   {409980304u, 409980304u, 409980304u, 409980304u, 409980304u, 409980304u, 409980304u, 409980304u, 2556003488u, 3593418832u, 1084178222u, 3405477248u, 448231015u, 2477711757u, 2166136261u, 2166136261u, 2166136261u, 2166136261u, 2166136261u, 2166136261u, 2166136261u},
   {19.034877000000016, 19.034877000000016, 19.034877000000016, 19.034877000000016, 19.034877000000016, 19.034877000000016, 19.034877000000016, 19.034877000000016, 57.07086820548424, 190.36037416353946, 666.2977082765511, 2988.677220160719, 11992.633894444438, 46920.986666666584, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0},
   {50.034717303792405, 50.034717303792405, 50.034717303792405, 50.034717303792405, 50.034717303792405, 50.034717303792405, 50.034717303792405, 50.034717303792405, 150.14821626027955, 500.414617024789, 1751.2569526730647, 7855.690889682475, 31522.3487410801, 123335.56167307352, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0}},
  // antimeridian: stock (float32) supercluster clusters differently at no zoom
  {"antimeridian",
   {2, 4, 15, 58, 224, 804, 2236, 3863, 4653, 4896, 4971, 4995, 4998, 5000, 5000, 5000, 5000, 5000, 5000, 5000, 5000},
   {2, 4, 15, 57, 218, 717, 1380, 959, 339, 104, 29, 5, 2, 0, 0, 0, 0, 0, 0, 0, 0},
   {3579318049u, 1158333910u, 485415588u, 4238002253u, 3052359563u, 1944511562u, 1257890060u, 1868482700u, 731289794u, 1948043975u, 395156035u, 2408234680u, 247590738u, 2356979101u, 2356979101u, 2356979101u, 2356979101u, 2356979101u, 2356979101u, 2356979101u, 2356979101u},
   {2781221104u, 2915252966u, 1859693971u, 3567975538u, 796421068u, 239373219u, 3342864571u, 3979770170u, 3267530767u, 4231003840u, 244200992u, 3192482756u, 782406850u, 2166136261u, 2166136261u, 2166136261u, 2166136261u, 2166136261u, 2166136261u, 2166136261u, 2166136261u},
   {2337882669u, 264065397u, 4176570118u, 2980918691u, 4159961400u, 305635477u, 3356347302u, 3000292168u, 3281920309u, 411699760u, 711628137u, 1511940179u, 502881442u, 2166136261u, 2166136261u, 2166136261u, 2166136261u, 2166136261u, 2166136261u, 2166136261u, 2166136261u},
   {-0.11055063417640554, -0.4598493286784162, -174.99899906536695, -529.0352074971556, 712.5207552125771, 1914.342506622098, 1671.948091150752, -1969.6831700000223, 781.4745166666655, -2494.053050000003, 167.81175000000115, -527.3213999999999, -353.50964999999997, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0},
   {-35.071324233270374, -65.35307968775271, -257.5039632272246, -999.7493018002345, -3869.15963247824, -12605.67986382564, -24089.09381874023, -16823.77889308272, -5937.838808257989, -1796.9213619615189, -467.9103507572362, -76.48480001996643, -26.532000001969763, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0}},
  };

  // Must match DATASET_PARITY in the fixture script.
  const int32_t pointCount = 5000;
  const int32_t minZoom = 1;
  const int32_t maxZoom = 20;
  const int32_t extent = 512;

  for (const auto& testCase : cases) {
    const bench::Dataset dataset = bench::generateDataset(testCase.dataset, pointCount);
    std::vector<int32_t> ids(static_cast<size_t>(pointCount));
    std::vector<double> values;
    for (int32_t i = 0; i < pointCount; i++) {
      ids[static_cast<size_t>(i)] = i;
      const double weight = static_cast<double>(i % 7 + 1); // datasetWeight in the fixture script
      values.insert(values.end(), {weight, weight, weight});
    }

    for (const bool aggregate : {false, true}) {
      ClusterEngineCore engine;
      ClusterEngineConfig config;
      config.radius = 40.0;
      config.minPoints = 2;
      config.minZoom = minZoom;
      config.maxZoom = maxZoom;
      config.extent = extent;
      config.nodeSize = 64;
      if (aggregate) config.reducers = {AggregationReducer::Sum, AggregationReducer::Min, AggregationReducer::Max};
      engine.setOptions(config);
      engine.setPoints(ids.data(), dataset.lats.data(), dataset.lngs.data(), ids.size(),
                       aggregate ? values.data() : nullptr, aggregate ? 3 : 0);
      engine.build();

      for (int32_t z = minZoom; z <= maxZoom + 1; z++) {
        const size_t slot = static_cast<size_t>(z - minZoom);
        const auto nodes = engine.getClusters({85.0, -85.0, 180.0, -180.0, static_cast<double>(z)});

        int clusterCount = 0;
        double lngSum = 0.0;
        double latSum = 0.0;
        for (const auto& node : nodes) {
          if (!node.isCluster) continue;
          clusterCount++;
          lngSum += xToLng(node.x, extent);
          latSum += yToLat(node.y, extent);
        }
        const double tolerance = 1e-6 * std::max(clusterCount, 1);

        const uint32_t membership = parityMembershipHash(engine, nodes, pointCount);
        const uint32_t expansion = parityExpansionHash(engine, nodes);
        const uint32_t aggregateHash = aggregate ? parityAggregateHash(nodes) : testCase.expectedAggregate[slot];

        if (static_cast<int>(nodes.size()) != testCase.expectedNodes[slot] ||
            clusterCount != testCase.expectedClusters[slot] ||
            membership != testCase.expectedMembership[slot] ||
            expansion != testCase.expectedExpansion[slot] ||
            aggregateHash != testCase.expectedAggregate[slot] ||
            std::fabs(lngSum - testCase.expectedLngSum[slot]) > tolerance ||
            std::fabs(latSum - testCase.expectedLatSum[slot]) > tolerance) {
          std::printf(
            "supercluster dataset parity failed: %s%s zoom=%d -> nodes %d (want %d), "
            "clusters %d (want %d), membership %u (want %u), expansion %u (want %u), "
            "aggregate %u (want %u), centroid sums %.9f, %.9f (want %.9f, %.9f)\n",
            testCase.dataset, aggregate ? " with clusterProperties" : "", z,
            static_cast<int>(nodes.size()), testCase.expectedNodes[slot],
            clusterCount, testCase.expectedClusters[slot],
            membership, testCase.expectedMembership[slot],
            expansion, testCase.expectedExpansion[slot],
            aggregateHash, testCase.expectedAggregate[slot],
            lngSum, latSum, testCase.expectedLngSum[slot], testCase.expectedLatSum[slot]);
          assert(false && "clustering diverged from supercluster");
        }
      }
    }
  }
}

// Points on both sides of the antimeridian are found whichever form the
// viewport's longitudes take, with and without clustering, and never twice.
static void testGetClustersAcrossAntimeridian() {
  for (const bool clusteringEnabled : {true, false}) {
    ClusterEngineCore engine;
    ClusterEngineConfig config;
    config.minZoom = 0;
    config.maxZoom = 16;
    config.clusteringEnabled = clusteringEnabled;
    engine.setOptions(config);

    std::vector<int32_t> ids = {0, 1, 2};
    std::vector<double> lats = {-17.8, -17.8, -17.8};
    std::vector<double> lngs = {179.9, -179.9, -179.5};
    engine.setPoints(ids.data(), lats.data(), lngs.data(), ids.size());
    engine.build();

    auto idsIn = [&engine](double west, double east) {
      std::vector<int32_t> found;
      for (const auto& node : engine.getClusters({-10.0, -25.0, east, west, 16.0})) {
        found.push_back(node.id);
      }
      std::sort(found.begin(), found.end());
      return found;
    };
    const std::vector<int32_t> all = {0, 1, 2};

    // A region centred on 179.9 with a 1 degree delta, as regionToBBox builds
    // it, and the same span written three other ways.
    assert(idsIn(178.9, 180.9) == all);
    assert(idsIn(178.9, -179.1) == all);
    assert(idsIn(-181.1, -179.1) == all);
    assert(idsIn(538.9, 540.9) == all);
    // One side only.
    assert(idsIn(179.0, 179.95) == std::vector<int32_t>({0}));
    assert(idsIn(-180.0, -179.0) == std::vector<int32_t>({1, 2}));
    // The whole world, however it is written, returns each point once.
    assert(idsIn(-180.0, 180.0) == all);
    assert(idsIn(0.0, 360.0) == all);
    assert(idsIn(-720.0, 720.0) == all);
    // Non-finite bounds return nothing, infinities included.
    const double inf = std::numeric_limits<double>::infinity();
    assert(idsIn(std::numeric_limits<double>::quiet_NaN(), 180.0).empty());
    assert(idsIn(-inf, inf).empty());
    assert(idsIn(-inf, 180.0).empty());
    assert(engine.getClusters({inf, -25.0, 180.0, -180.0, 16.0}).empty());
    assert(engine.getClusters({-10.0, -inf, 180.0, -180.0, 16.0}).empty());
  }
}

static ViewportBounds worldAt(int32_t zoom) {
  return {85.0, -85.0, 180.0, -180.0, static_cast<double>(zoom)};
}

static ClusterEngineConfig expansionConfig() {
  ClusterEngineConfig config;
  config.radius = 40.0;
  config.minPoints = 2;
  config.minZoom = 0;
  config.maxZoom = 16;
  config.extent = 512;
  config.nodeSize = 64;
  return config;
}

static void testExpansionZoomOfClusterSurvivingToLowerZooms() {
  ClusterEngineCore engine;
  const ClusterEngineConfig config = expansionConfig();
  engine.setOptions(config);

  // ~700 m apart: one cluster from minZoom up to the zoom where they split.
  std::vector<int32_t> ids = {0, 1};
  std::vector<double> lats = {52.2, 52.2};
  std::vector<double> lngs = {21.0, 21.01};
  engine.setPoints(ids.data(), lats.data(), lngs.data(), ids.size());
  engine.build();

  int32_t splitZoom = config.minZoom;
  while (engine.getClusters(worldAt(splitZoom)).size() == 1) splitZoom++;
  assert(splitZoom > config.minZoom + 1);
  assert(splitZoom <= config.maxZoom);

  // Queried from any zoom it is visible at, the cluster expands where it
  // splits, not one level below wherever it was last seen.
  for (int32_t z = config.minZoom; z < splitZoom; z++) {
    const auto clusters = engine.getClusters(worldAt(z));
    assert(clusters.size() == 1);
    assert(clusters.front().isCluster);
    assert(engine.getClusterExpansionZoom(clusters.front().id) == splitZoom);
  }
}

static void testExpansionZoomOfIdenticalPoints() {
  ClusterEngineCore engine;
  const ClusterEngineConfig config = expansionConfig();
  engine.setOptions(config);

  const int32_t count = 1000;
  std::vector<int32_t> ids(count);
  std::vector<double> lats(count, 52.2);
  std::vector<double> lngs(count, 21.0);
  for (int32_t i = 0; i < count; i++) ids[i] = i;
  engine.setPoints(ids.data(), lats.data(), lngs.data(), static_cast<size_t>(count));
  engine.build();

  // Points that never split expand past maxZoom, as in supercluster.
  for (int32_t z = config.minZoom; z <= config.maxZoom; z++) {
    const auto clusters = engine.getClusters(worldAt(z));
    assert(clusters.size() == 1);
    assert(clusters.front().count == count);
    assert(engine.getClusterExpansionZoom(clusters.front().id) == config.maxZoom + 1);
  }
  // Where getClusters returns them on their own, one on top of another.
  assert(engine.getClusters(worldAt(config.maxZoom + 1)).size() == static_cast<size_t>(count));
}

static void testExpansionZoomOfPointId() {
  ClusterEngineCore engine;
  const ClusterEngineConfig config = expansionConfig();
  engine.setOptions(config);

  // A lone point far from a pair: it survives unclustered down to minZoom.
  std::vector<int32_t> ids = {0, 1, 2};
  std::vector<double> lats = {52.2, 52.2001, -33.9};
  std::vector<double> lngs = {21.0, 21.0001, 151.2};
  engine.setPoints(ids.data(), lats.data(), lngs.data(), ids.size());
  engine.build();

  assert(engine.getClusterExpansionZoom(2) == config.maxZoom + 1);
}

// Every cluster at every zoom expands at the first zoom where it has split:
// it is still there one level up from that zoom, and at that zoom it is gone
// and at least two of its children show instead.
static void testExpansionZoomsMatchWhereClustersSplit() {
  ClusterEngineCore engine;
  const ClusterEngineConfig config = expansionConfig();
  engine.setOptions(config);

  // Seeded city-like data: dense blobs over a sparse background.
  const int32_t count = 2000;
  std::vector<int32_t> ids(count);
  std::vector<double> lats(count);
  std::vector<double> lngs(count);
  uint32_t seed = 12345u;
  auto random = [&seed]() {
    seed = seed * 1664525u + 1013904223u;
    return static_cast<double>(seed >> 8) / static_cast<double>(1u << 24);
  };
  for (int32_t i = 0; i < count; i++) {
    ids[i] = i;
    if (i % 4 == 0) {
      lats[i] = 52.0 + random() * 0.5;
      lngs[i] = 20.8 + random() * 0.5;
    } else {
      const double blob = static_cast<double>(i % 7);
      lats[i] = 52.1 + blob * 0.05 + (random() - 0.5) * 0.01;
      lngs[i] = 20.9 + blob * 0.04 + (random() - 0.5) * 0.01;
    }
  }
  engine.setPoints(ids.data(), lats.data(), lngs.data(), static_cast<size_t>(count));
  engine.build();

  // Up to maxZoom + 1, where the clusters created at maxZoom split.
  std::vector<std::vector<int32_t>> idsAtZoom(config.maxZoom + 2);
  for (int32_t z = config.minZoom; z <= config.maxZoom + 1; z++) {
    for (const auto& node : engine.getClusters(worldAt(z))) {
      idsAtZoom[z].push_back(node.id);
    }
    std::sort(idsAtZoom[z].begin(), idsAtZoom[z].end());
  }
  auto shownAt = [&idsAtZoom](int32_t zoom, int32_t id) {
    return std::binary_search(idsAtZoom[zoom].begin(), idsAtZoom[zoom].end(), id);
  };

  int32_t checked = 0;
  for (int32_t z = config.minZoom; z <= config.maxZoom; z++) {
    for (const auto& node : engine.getClusters(worldAt(z))) {
      if (!node.isCluster) continue;
      const int32_t expansion = engine.getClusterExpansionZoom(node.id);
      assert(expansion > z);
      assert(shownAt(expansion - 1, node.id));
      checked++;

      assert(!shownAt(expansion, node.id));
      int32_t childrenShown = 0;
      for (const auto& child : engine.getChildren(node.id)) {
        if (shownAt(expansion, child.id)) childrenShown++;
      }
      assert(childrenShown >= 2);
    }
  }
  assert(checked > 100);
}

// Sorted ids of the points a query should return at maxZoom + 1: every point
// inside the viewport, tested the way getClusters reads a viewport.
static std::vector<int32_t> idsOfPointsInside(const std::vector<double>& lats, const std::vector<double>& lngs,
                                              const ViewportBounds& viewport, int32_t extent) {
  const NormalizedViewport bounds = normalizeViewport(viewport);
  const double minY = latToY(bounds.north, extent);
  const double maxY = latToY(bounds.south, extent);
  std::vector<int32_t> ids;
  for (size_t i = 0; i < lats.size(); i++) {
    const double x = lngToX(lngs[i], extent);
    const double y = latToY(lats[i], extent);
    if (y < minY || y > maxY) continue;
    for (int r = 0; r < bounds.rangeCount; r++) {
      if (x >= lngToX(bounds.ranges[r].west, extent) && x <= lngToX(bounds.ranges[r].east, extent)) {
        ids.push_back(static_cast<int32_t>(i));
        break;
      }
    }
  }
  return ids;
}

static std::vector<int32_t> sortedIds(const std::vector<ClusterNode>& nodes) {
  std::vector<int32_t> ids;
  for (const auto& node : nodes) ids.push_back(node.id);
  std::sort(ids.begin(), ids.end());
  return ids;
}

// Above maxZoom every point stands on its own, as in supercluster, however
// far past maxZoom the zoom goes.
static void testPointsStandAloneAboveMaxZoom() {
  ClusterEngineCore engine;
  const ClusterEngineConfig config = expansionConfig();
  engine.setOptions(config);

  // About 0.7 m apart: one cluster up to maxZoom.
  std::vector<int32_t> ids = {0, 1};
  std::vector<double> lats = {52.2, 52.2};
  std::vector<double> lngs = {21.0, 21.00001};
  engine.setPoints(ids.data(), lats.data(), lngs.data(), ids.size());
  engine.build();

  const auto clustered = engine.getClusters(worldAt(config.maxZoom));
  assert(clustered.size() == 1);
  assert(clustered.front().isCluster);

  const double inf = std::numeric_limits<double>::infinity();
  for (const double zoom : {config.maxZoom + 1.0, config.maxZoom + 1.5, 25.0, 1e9, inf}) {
    const auto points = engine.getClusters({85.0, -85.0, 180.0, -180.0, zoom});
    assert(sortedIds(points) == ids);
    for (const auto& point : points) {
      assert(!point.isCluster);
      assert(point.count == 1);
      assert(point.zoom == config.maxZoom + 1);
    }
  }
}

// A point inside the viewport is returned at maxZoom + 1 even when the
// cluster it belongs to at maxZoom is centred outside the viewport.
static void testPointsAboveMaxZoomOfClustersCentredOutside() {
  ClusterEngineCore engine;
  const ClusterEngineConfig config = expansionConfig();
  engine.setOptions(config);

  // One cluster at maxZoom, centred on 21.00017.
  std::vector<int32_t> ids = {0, 1, 2};
  std::vector<double> lats = {52.2, 52.2, 52.2};
  std::vector<double> lngs = {21.0, 21.0002, 21.0003};
  engine.setPoints(ids.data(), lats.data(), lngs.data(), ids.size());
  engine.build();
  assert(engine.getClusters(worldAt(config.maxZoom)).size() == 1);

  auto idsIn = [&engine](double west, double east, int32_t zoom) {
    return sortedIds(engine.getClusters({52.3, 52.1, east, west, static_cast<double>(zoom)}));
  };
  // East of the centroid, then west of it.
  assert(idsIn(21.00025, 21.01, config.maxZoom).empty());
  assert(idsIn(21.00025, 21.01, config.maxZoom + 1) == std::vector<int32_t>({2}));
  assert(idsIn(20.99, 21.0001, config.maxZoom).empty());
  assert(idsIn(20.99, 21.0001, config.maxZoom + 1) == std::vector<int32_t>({0}));
}

// Identical points can sum to a centroid an ulp north of them. With radius 0
// nothing but the rounding slack reaches their cluster from a viewport whose
// north edge is their own latitude. (Not a longitude: the viewport's are
// wrapped, which rounds them.) Which latitudes round that way depends on the
// libm behind latToY, so the test looks for one.
static void testPointsAboveMaxZoomOnTheViewportEdge() {
  ClusterEngineConfig config = expansionConfig();
  config.radius = 0.0;

  double lat = 0.0;
  int32_t count = 0;
  for (int32_t k = 1; k <= 1000 && count == 0; k++) {
    const double candidate = 52.2 + k / 100000.0;
    const double y = latToY(candidate, config.extent);
    for (int32_t n = 3; n <= 8; n++) {
      // The sum build() forms for a cluster of n points at y.
      double sum = y;
      for (int32_t i = 1; i < n; i++) sum += y;
      if (sum / n < y) {
        lat = candidate;
        count = n;
        break;
      }
    }
  }
  assert(count > 0);

  ClusterEngineCore engine;
  engine.setOptions(config);
  std::vector<int32_t> ids(static_cast<size_t>(count));
  for (int32_t i = 0; i < count; i++) ids[static_cast<size_t>(i)] = i;
  std::vector<double> lats(ids.size(), lat);
  std::vector<double> lngs(ids.size(), 21.0);
  engine.setPoints(ids.data(), lats.data(), lngs.data(), ids.size());
  engine.build();

  const auto clusters = engine.getClusters(worldAt(config.maxZoom));
  assert(clusters.size() == 1);
  assert(clusters.front().y < latToY(lat, config.extent));

  const ViewportBounds fromTheEdge = {lat, 52.1, 21.01, 20.99, static_cast<double>(config.maxZoom)};
  assert(engine.getClusters(fromTheEdge).empty());
  ViewportBounds above = fromTheEdge;
  above.zoom = config.maxZoom + 1;
  assert(sortedIds(engine.getClusters(above)) == ids);
}

// getClusters at maxZoom + 1 returns exactly the points inside the viewport,
// each once, on dense data whose maxZoom clusters the viewports cut through,
// around the antimeridian too.
static void testPointsAboveMaxZoomMatchABruteForceFilter() {
  // Blobs a few hundred metres wide, one of them across the antimeridian, and
  // stacks of identical points.
  const std::vector<std::pair<double, double>> centres = {
    {52.23, 21.01}, {52.25, 21.05}, {-17.8, 179.999}, {40.7, -74.0},
  };
  const int32_t count = 4000;
  std::vector<int32_t> ids(count);
  std::vector<double> lats(count);
  std::vector<double> lngs(count);
  uint32_t seed = 2026u;
  auto random = [&seed]() {
    seed = seed * 1664525u + 1013904223u;
    return static_cast<double>(seed >> 8) / static_cast<double>(1u << 24);
  };
  for (int32_t i = 0; i < count; i++) {
    const auto& [lat, lng] = centres[static_cast<size_t>(i) % centres.size()];
    ids[i] = i;
    if (i % 10 == 0) {
      lats[i] = lat;
      lngs[i] = lng;
    } else {
      lats[i] = lat + (random() - 0.5) * 0.004;
      lngs[i] = wrapLongitude(lng + (random() - 0.5) * 0.006);
    }
  }

  ClusterEngineConfig dense = expansionConfig();
  dense.maxZoom = 14;
  ClusterEngineConfig minPoints = expansionConfig();
  minPoints.radius = 60.0;
  minPoints.minPoints = 3;
  minPoints.maxZoom = 13;

  for (const auto& config : {dense, minPoints}) {
    ClusterEngineCore engine;
    engine.setOptions(config);
    engine.setPoints(ids.data(), lats.data(), lngs.data(), static_cast<size_t>(count));
    engine.build();

    int32_t viewportsCuttingClusters = 0;
    for (int32_t q = 0; q < 400; q++) {
      const auto& [lat, lng] = centres[static_cast<size_t>(q) % centres.size()];
      const double halfHeight = 0.0002 + random() * 0.003;
      const double halfWidth = 0.0002 + random() * 0.004;
      const double centreLat = lat + (random() - 0.5) * 0.004;
      // Unwrapped, as regionToBBox leaves a region across the antimeridian.
      const double centreLng = lng + (random() - 0.5) * 0.006;
      ViewportBounds viewport = {centreLat + halfHeight, centreLat - halfHeight, centreLng + halfWidth,
                                 centreLng - halfWidth, static_cast<double>(config.maxZoom + 1)};

      const auto points = engine.getClusters(viewport);
      const std::vector<int32_t> expected = idsOfPointsInside(lats, lngs, viewport, config.extent);
      assert(sortedIds(points) == expected);
      for (const auto& point : points) assert(!point.isCluster);

      // The points the maxZoom nodes inside the viewport hold differ from
      // those inside it when the viewport cuts through a cluster.
      viewport.zoom = config.maxZoom;
      size_t heldInside = 0;
      for (const auto& node : engine.getClusters(viewport)) {
        heldInside += static_cast<size_t>(node.count);
      }
      if (heldInside != expected.size()) viewportsCuttingClusters++;
    }
    assert(viewportsCuttingClusters > 20);
  }
}

// Numbers JS can pass where the engine needs an int32. Run this file under
// `-fsanitize=undefined,float-cast-overflow` so a raw cast of any of them fails.
static const double kBoundaryInputs[] = {
  std::numeric_limits<double>::infinity(),
  -std::numeric_limits<double>::infinity(),
  std::numeric_limits<double>::quiet_NaN(),
  1e12,
  -1e12,
  -1.0,
  0.5,
};

template <typename Call>
static bool throwsInvalidArgument(Call call, const char* expectedMessage) {
  try {
    call();
  } catch (const std::invalid_argument& error) {
    assert(std::strstr(error.what(), expectedMessage) != nullptr);
    return true;
  }
  return false;
}

static RawClusterEngineOptions validRawOptions() {
  return {.radius = 40.0, .minPoints = 2.0, .minZoom = 0.0, .maxZoom = 16.0, .extent = 512.0, .nodeSize = 64.0};
}

// One cluster of four co-located points, built through the same helpers
// HybridClusterEngine uses.
static ClusterEngineCore builtBoundaryEngine(int32_t& rootClusterId) {
  ClusterEngineCore engine;
  engine.setOptions(toClusterEngineConfig(validRawOptions()));
  std::vector<int32_t> ids = {0, 1, 2, 3};
  std::vector<double> lats = {52.0, 52.0001, 52.0002, 52.0003};
  std::vector<double> lngs = {21.0, 21.0001, 21.0002, 21.0003};
  engine.setPoints(ids.data(), lats.data(), lngs.data(), ids.size());
  engine.build();
  const auto clusters = engine.getClusters(worldAt(0));
  assert(clusters.size() == 1 && clusters.front().isCluster);
  rootClusterId = clusters.front().id;
  return engine;
}

static void testBoundaryClusterIds() {
  int32_t root = 0;
  const ClusterEngineCore engine = builtBoundaryEngine(root);

  for (const double id : kBoundaryInputs) {
    if (id == -1.0) {
      // A whole number that is no node: the same empty answer as any unknown id.
      assert(engine.getChildren(toClusterId(id)).empty());
      assert(engine.getLeaves(toClusterId(id), 0, 0).empty());
      assert(engine.getClusterExpansionZoom(toClusterId(id)) == 16);
      continue;
    }
    assert(throwsInvalidArgument([&] { engine.getChildren(toClusterId(id)); }, "clusterId"));
    assert(throwsInvalidArgument([&] { engine.getLeaves(toClusterId(id), toLeafLimit(10), toLeafOffset(0)); }, "clusterId"));
    assert(throwsInvalidArgument([&] { engine.getClusterExpansionZoom(toClusterId(id)); }, "clusterId"));
  }

  assert(toClusterId(static_cast<double>(root)) == root);
}

static void testBoundaryLeafLimits() {
  int32_t root = 0;
  const ClusterEngineCore engine = builtBoundaryEngine(root);

  // supercluster's idiomatic "every leaf".
  const double infinity = std::numeric_limits<double>::infinity();
  assert(engine.getLeaves(root, toLeafLimit(infinity), toLeafOffset(0)).size() == 4);

  for (const double limit : kBoundaryInputs) {
    if (limit == 0.5) {
      assert(throwsInvalidArgument([&] { toLeafLimit(limit); }, "limit"));
      continue;
    }
    assert(engine.getLeaves(root, toLeafLimit(limit), toLeafOffset(0)).size() == 4);
  }

  assert(engine.getLeaves(root, toLeafLimit(3), toLeafOffset(0)).size() == 3);
}

static void testBoundaryLeafOffsets() {
  int32_t root = 0;
  const ClusterEngineCore engine = builtBoundaryEngine(root);

  for (const double offset : kBoundaryInputs) {
    if (std::isnan(offset) || offset == 0.5) {
      assert(throwsInvalidArgument([&] { toLeafOffset(offset); }, "offset"));
      continue;
    }
    const auto leaves = engine.getLeaves(root, toLeafLimit(0), toLeafOffset(offset));
    // Negative offsets skip nothing; offsets past every leaf skip them all.
    assert(leaves.size() == (offset < 0 ? 4u : 0u));
  }

  assert(engine.getLeaves(root, toLeafLimit(0), toLeafOffset(1)).size() == 3);
}

static void testBoundaryOptions() {
  int32_t root = 0;
  ClusterEngineCore engine = builtBoundaryEngine(root);
  const auto before = engine.getClusters(worldAt(0));

  struct Field {
    const char* name;
    double RawClusterEngineOptions::*member;
  };
  const Field fields[] = {
    {"radius", &RawClusterEngineOptions::radius},
    {"minPoints", &RawClusterEngineOptions::minPoints},
    {"minZoom", &RawClusterEngineOptions::minZoom},
    {"maxZoom", &RawClusterEngineOptions::maxZoom},
    {"extent", &RawClusterEngineOptions::extent},
    {"nodeSize", &RawClusterEngineOptions::nodeSize},
  };

  for (const Field& field : fields) {
    for (const double value : kBoundaryInputs) {
      RawClusterEngineOptions options = validRawOptions();
      options.*field.member = value;
      const bool rejected = throwsInvalidArgument(
        [&] { engine.setOptions(toClusterEngineConfig(options)); },
        field.name
      );

      const std::string name = field.name;
      // Unusual but well defined: a large or fractional radius, and any
      // 32-bit minPoints or nodeSize (below 2 and 1, they act as 2 and 1).
      const bool accepted = (name == "radius" && (value == 1e12 || value == 0.5)) ||
        ((name == "minPoints" || name == "nodeSize") && value == -1.0);
      assert(rejected != accepted);

      if (rejected) {
        // A rejected config leaves the built index serving as before.
        assert(engine.isBuilt());
        assert(engine.getClusters(worldAt(0)).size() == before.size());
      } else {
        engine = builtBoundaryEngine(root);
      }
    }
  }
}

static void testInvalidOptionsNameTheOption() {
  ClusterEngineCore engine;

  ClusterEngineConfig inverted;
  inverted.minZoom = 12;
  inverted.maxZoom = 10;
  assert(throwsInvalidArgument([&] { engine.setOptions(inverted); }, "minZoom (12) must not be greater than maxZoom (10)"));

  ClusterEngineConfig zeroExtent;
  zeroExtent.extent = 0;
  assert(throwsInvalidArgument([&] { engine.setOptions(zeroExtent); }, "extent must be an integer >= 1, got 0."));

  ClusterEngineConfig nanRadius;
  nanRadius.radius = std::numeric_limits<double>::quiet_NaN();
  assert(throwsInvalidArgument([&] { engine.setOptions(nanRadius); }, "radius must be a finite number >= 0"));

  RawClusterEngineOptions deepZoom = validRawOptions();
  deepZoom.maxZoom = 100;
  assert(throwsInvalidArgument(
    [&] { toClusterEngineConfig(deepZoom); },
    "ClusterEngine: maxZoom must be an integer from 0 to 30, got 100."
  ));

  RawClusterEngineOptions hugeNodeSize = validRawOptions();
  hugeNodeSize.nodeSize = 3e9;
  assert(throwsInvalidArgument([&] { toClusterEngineConfig(hugeNodeSize); }, "nodeSize must be a 32-bit integer, got 3000000000."));

  // The supported zoom range itself is accepted.
  RawClusterEngineOptions fullRange = validRawOptions();
  fullRange.minZoom = 0;
  fullRange.maxZoom = kMaxSupportedZoom;
  engine.setOptions(toClusterEngineConfig(fullRange));
}

// Seeded random buffers, valid and corrupted (truncated, bit-flipped, with
// rewritten counts, and with non-finite coordinates, negative, duplicate and
// extreme ids), fed to setPointsFromBuffer. Under ASan and UBSan (the compile
// line at the top of this file) any read past the buffer or overflow fails it;
// on its own it checks that the engine either rejects a buffer or indexes it
// consistently.
static bool sameBits(double a, double b) {
  return std::memcmp(&a, &b, sizeof(double)) == 0;
}

static bool sameNode(const ClusterNode& a, const ClusterNode& b) {
  if (a.id != b.id || !sameBits(a.x, b.x) || !sameBits(a.y, b.y) || a.count != b.count ||
      a.parentId != b.parentId || a.pointIndex != b.pointIndex || a.isCluster != b.isCluster ||
      a.zoom != b.zoom || a.minLeafId != b.minLeafId || a.values.size() != b.values.size()) {
    return false;
  }
  for (size_t k = 0; k < a.values.size(); k++) {
    if (!sameBits(a.values[k], b.values[k])) return false;
  }
  return true;
}

static bool sameNodes(const std::vector<ClusterNode>& a, const std::vector<ClusterNode>& b) {
  if (a.size() != b.size()) return false;
  for (size_t i = 0; i < a.size(); i++) {
    if (!sameNode(a[i], b[i])) return false;
  }
  return true;
}

static std::vector<ClusterNode> byId(std::vector<ClusterNode> nodes) {
  std::sort(nodes.begin(), nodes.end(), [](const ClusterNode& a, const ClusterNode& b) { return a.id < b.id; });
  return nodes;
}

// Builds every bench dataset at 5000 points under several configurations,
// with `toggle(engine, true)` and with `toggle(engine, false)`, and checks that
// every node at every zoom and every cluster's children and expansion zoom are
// bit-identical. getClusters() must return the nodes in the same order too,
// unless `anyOrder`.
template <typename Toggle>
static void checkToggleKeepsTheIndex(const char* what, Toggle toggle, bool anyOrder) {
  struct Config {
    double radius;
    int32_t minPoints;
    int32_t nodeSize;
    bool aggregate;
    int32_t maxZoom;
    int32_t extent;
  };
  const Config configs[] = {
    {390 * 0.06, 2, 64, false, 20, 512}, // the compat MapView's on a 390 pt wide phone
    {40.0, 2, 64, true, 20, 512},
    {40.0, 3, 16, false, 20, 512},
    {60.0, 5, 64, false, 20, 512},
    // Radii a few ulps of the coordinates wide, where rounding decides.
    {2.0, 2, 64, false, 30, 1 << 20},
  };

  const int32_t size = 5000;
  for (const char* name : bench::kDatasetNames) {
    const bench::Dataset dataset = bench::generateDataset(name, size);
    std::vector<int32_t> ids(static_cast<size_t>(size));
    std::vector<double> values;
    for (int32_t i = 0; i < size; i++) {
      ids[static_cast<size_t>(i)] = i;
      const double weight = static_cast<double>(i % 7 + 1);
      values.insert(values.end(), {weight, weight * 2});
    }

    for (const Config& c : configs) {
      auto build = [&](bool on) {
        ClusterEngineCore engine;
        ClusterEngineConfig config;
        config.radius = c.radius;
        config.minPoints = c.minPoints;
        config.minZoom = 1;
        config.maxZoom = c.maxZoom;
        config.extent = c.extent;
        config.nodeSize = c.nodeSize;
        if (c.aggregate) config.reducers = {AggregationReducer::Sum, AggregationReducer::Max};
        engine.setOptions(config);
        engine.setPoints(ids.data(), dataset.lats.data(), dataset.lngs.data(), ids.size(),
                         c.aggregate ? values.data() : nullptr, c.aggregate ? 2 : 0);
        toggle(engine, on);
        engine.build();
        return engine;
      };
      const ClusterEngineCore withToggle = build(true);
      const ClusterEngineCore without = build(false);

      for (int32_t z = 1; z <= c.maxZoom + 1; z++) {
        const ViewportBounds world{85.0, -85.0, 180.0, -180.0, static_cast<double>(z)};
        const auto nodes = withToggle.getClusters(world);
        const auto expected = without.getClusters(world);
        if (anyOrder ? !sameNodes(byId(nodes), byId(expected)) : !sameNodes(nodes, expected)) {
          std::printf("%s changed the index: %s %d radius %.1f minPoints %d zoom %d\n", what, name, size, c.radius,
                      c.minPoints, z);
          assert(false);
        }
        for (const auto& node : nodes) {
          if (!node.isCluster) continue;
          assert(sameNodes(withToggle.getChildren(node.id), without.getChildren(node.id)));
          assert(withToggle.getClusterExpansionZoom(node.id) == without.getClusterExpansionZoom(node.id));
        }
      }
    }
  }
}

// build() skips the neighbour query of a node that provably has no other node
// within the level's radius. Nothing may depend on that, including with
// minPoints above 2, where the order of a query's results shapes the levels
// below.
static void testSkippedQueriesBuildTheSameIndex() {
  checkToggleKeepsTheIndex(
    "skipped queries", [](ClusterEngineCore& engine, bool on) { engine.setSkipLonelyQueries(on); }, false);
}

// A node that skips its queries must still notice a cluster that forms far
// from it and comes closer than every node it was certified against. Node j
// is certified at maxZoom with its exact distance to a pair of nodes, which
// zoom 16 merges. Their centroid lies between them, a hair nearer to j than
// either, and beyond the reach of the queries around the new cluster, so only
// lowering j's certificate makes j query at zoom 10, where the centroid is
// within the radius and the pair isn't. A few or many other nodes, far away,
// make the level lower every certificate at once or query around its cluster.
static void testSkippingNodesSeeDistantClusters() {
  const int32_t extent = 512;
  const double radius = 40.0;
  const double r16 = clusterRadiusAtZoom(radius, 16);
  const double r10 = clusterRadiusAtZoom(radius, 10);
  // The pair is 0.9 * r16 apart: merged at zoom 16, not at 17.
  const double h = 0.45 * r16;
  // j to the centroid: D. j to the pair: sqrt(D² + h²). r10² falls between.
  const double d = std::sqrt(r10 * r10 - h * h / 2);
  for (const int32_t others : {10, 70}) {
    std::vector<double> xs = {256.0, 256.0 + d, 256.0 + d};
    std::vector<double> ys = {256.0, 256.0 - h, 256.0 + h};
    for (int32_t k = 0; k < others; k++) {
      xs.push_back(266.0 + k);
      ys.push_back(256.0);
    }
    std::vector<int32_t> ids(xs.size());
    std::vector<double> lats(xs.size());
    std::vector<double> lngs(xs.size());
    for (size_t i = 0; i < xs.size(); i++) {
      ids[i] = static_cast<int32_t>(i);
      lngs[i] = xToLng(xs[i], extent);
      lats[i] = yToLat(ys[i], extent);
    }
    auto build = [&](bool skip) {
      ClusterEngineCore engine;
      ClusterEngineConfig config;
      config.radius = radius;
      config.extent = extent;
      engine.setOptions(config);
      engine.setPoints(ids.data(), lats.data(), lngs.data(), ids.size());
      engine.setSkipLonelyQueries(skip);
      engine.build();
      return engine;
    };
    const ClusterEngineCore skipping = build(true);
    const ClusterEngineCore querying = build(false);

    const ViewportBounds world{85.0, -85.0, 180.0, -180.0, 10.0};
    const auto nodes = querying.getClusters(world);
    // The scenario holds: j and the pair are one cluster at zoom 10.
    assert(std::any_of(nodes.begin(), nodes.end(), [](const ClusterNode& node) {
      return node.isCluster && node.count == 3 && node.minLeafId == 0;
    }));
    for (int32_t z = 1; z <= 21; z++) {
      const ViewportBounds view{85.0, -85.0, 180.0, -180.0, static_cast<double>(z)};
      assert(sameNodes(skipping.getClusters(view), querying.getClusters(view)));
    }
  }
}

// Certificates are stored as floats, rounded down: rounded to nearest, a
// distance just below a float's halfway point would come out above itself.
// Here two nodes are exactly the zoom 10 radius apart, so they merge there,
// at a distance whose square rounds up to a float.
static void testCertificatesRoundDown() {
  const int32_t extent = 512;
  // About half of all distances qualify.
  double lng = 1e-3;
  double gap = 0.0;
  bool found = false;
  for (int32_t step = 0; step < 10000; step++, lng += 1e-9) {
    gap = lngToX(lng, extent) - 256.0;
    const double d2 = gap * gap;
    if (static_cast<double>(static_cast<float>(d2 * (1.0 - 1e-9))) > d2) {
      found = true;
      break;
    }
  }
  assert(found);
  const int32_t ids[] = {0, 1};
  const double lats[] = {0.0, 0.0};
  const double lngs[] = {0.0, lng};
  auto build = [&](bool skip) {
    ClusterEngineCore engine;
    ClusterEngineConfig config;
    // clusterRadiusAtZoom(radius, 10) is `gap`, exactly.
    config.radius = gap * 1024;
    config.extent = extent;
    engine.setOptions(config);
    engine.setPoints(ids, lats, lngs, 2);
    engine.setSkipLonelyQueries(skip);
    engine.build();
    return engine;
  };
  for (const bool skip : {true, false}) {
    const ClusterEngineCore engine = build(skip);
    assert(engine.getClusters({85.0, -85.0, 180.0, -180.0, 11.0}).size() == 2);
    const auto nodes = engine.getClusters({85.0, -85.0, 180.0, -180.0, 10.0});
    assert(nodes.size() == 1 && nodes[0].count == 2);
  }
}

// A level of build() that changes few nodes patches the tree of the level
// above it. Nothing may depend on that but the order in which getClusters()
// returns a level's nodes.
static void testPatchedTreesBuildTheSameIndex() {
  checkToggleKeepsTheIndex(
    "patched trees", [](ClusterEngineCore& engine, bool on) { engine.setReuseTrees(on); }, true);

  // ...which needs some level to get a patched tree: it returns its nodes in
  // another order than a fresh one.
  const bench::Dataset dataset = bench::generateDataset("city", 5000);
  std::vector<int32_t> ids(dataset.lats.size());
  for (size_t i = 0; i < ids.size(); i++) ids[i] = static_cast<int32_t>(i);
  auto build = [&](bool reuse) {
    ClusterEngineCore engine;
    ClusterEngineConfig config;
    config.radius = 390 * 0.06;
    engine.setOptions(config);
    engine.setPoints(ids.data(), dataset.lats.data(), dataset.lngs.data(), ids.size());
    engine.setReuseTrees(reuse);
    engine.build();
    return engine;
  };
  const ClusterEngineCore patching = build(true);
  const ClusterEngineCore building = build(false);
  int32_t patchedLevels = 0;
  for (int32_t z = 1; z <= 20; z++) {
    const ViewportBounds world{85.0, -85.0, 180.0, -180.0, static_cast<double>(z)};
    if (!sameNodes(patching.getClusters(world), building.getClusters(world))) patchedLevels++;
  }
  assert(patchedLevels > 0);
}

// KDTree::within() returns every item whose squared distance, as it computes
// it, is within the radius squared, however the tree is split: build() relies
// on that when a level patches a tree. Here an item lies a hair beyond the
// radius, 1 + 2^-53 from the query point along x, but that difference rounds to
// exactly 1, the radius, so it passes. The tree splits at the item, and the
// query point's x plus the radius rounds to 1, short of the split: a subtree
// pruned on that rounded sum would drop the item. Mirrored, the same holds for
// the query point's x minus the radius.
static void testWithinFindsItemsOnTheRoundingEdge() {
  const double edge = 1.0 + std::ldexp(1.0, -52);
  const double q = std::ldexp(1.0, -53);
  for (const double side : {1.0, -1.0}) {
    // Sorted by x: one item well within the radius, and two at the split, one
    // of which nth_element puts in the subtree beyond it.
    std::vector<KDTree::Item> items = {{-side * 0.5, 0.0, 0}, {side * edge, 0.0, 1}, {side * edge, 0.0, 2}};
    KDTree tree;
    tree.build(items, 1);
    std::vector<int32_t> found;
    tree.within(side * q, 0.0, 1.0, found);
    std::sort(found.begin(), found.end());
    assert((found == std::vector<int32_t>{0, 1, 2}));
  }
}

// KDTree::remove() and place() patch a tree so that its queries return what a
// fresh tree over its items would. Here a tree loses random items and gains
// new ones crowded into one corner, which fills the corner's leaves and makes
// place() sort ranges again, and every round is checked against a scan of the
// items. Coordinates lie on a grid of quarters, so many tie on a split and
// every distance is exact.
static void testPatchedTreeMatchesAScan() {
  uint32_t state = 0x2545F491u;
  auto next = [&state] { return parityRandom(state); };
  auto coordinate = [&next](uint32_t cells) { return static_cast<double>(next() % cells) / 4.0; };
  for (const int32_t nodeSize : {4, 64}) {
    std::vector<KDTree::Item> items;
    for (int32_t i = 0; i < 3000; i++) items.push_back({coordinate(2048), coordinate(2048), i});
    KDTree tree;
    tree.build(items, nodeSize);
    // By item index: where it sits, and whether the tree still holds it.
    std::vector<int32_t> position(items.size());
    for (size_t p = 0; p < tree.size(); p++) position[static_cast<size_t>(tree.item(p).index)] = static_cast<int32_t>(p);
    std::vector<bool> held(items.size(), true);

    for (int round = 0; round < 20; round++) {
      for (int k = 0; k < 100; k++) {
        size_t i;
        do {
          i = next() % items.size();
        } while (!held[i]);
        held[i] = false;
        tree.remove(static_cast<size_t>(position[i]));
      }
      for (int k = 0; k < 60; k++) {
        const KDTree::Item item{coordinate(64), coordinate(64), static_cast<int32_t>(items.size())};
        items.push_back(item);
        held.push_back(true);
        position.push_back(-1);
        const bool placed = tree.place(item, [&](int32_t p, int32_t index) { position[static_cast<size_t>(index)] = p; });
        assert(placed);
      }

      for (size_t i = 0; i < items.size(); i++) {
        if (!held[i]) continue;
        const KDTree::Item& item = tree.item(static_cast<size_t>(position[i]));
        assert(item.index == static_cast<int32_t>(i) && item.x == items[i].x && item.y == items[i].y);
      }
      for (int q = 0; q < 50; q++) {
        const double x = coordinate(2048);
        const double y = coordinate(2048);
        const double r = coordinate(400);
        std::vector<int32_t> found;
        std::vector<int32_t> nearby;
        std::vector<int32_t> inBox;
        for (size_t i = 0; i < items.size(); i++) {
          if (!held[i]) continue;
          const double dx = items[i].x - x;
          const double dy = items[i].y - y;
          if (dx * dx + dy * dy <= r * r) nearby.push_back(static_cast<int32_t>(i));
          if (std::fabs(dx) <= r && std::fabs(dy) <= r) inBox.push_back(static_cast<int32_t>(i));
        }
        tree.within(x, y, r, found);
        std::sort(found.begin(), found.end());
        assert(found == nearby);
        tree.range(x - r, y - r, x + r, y + r, found);
        std::sort(found.begin(), found.end());
        assert(found == inBox);
      }
    }
  }
}

static void testBufferFuzz() {
  uint32_t state = 0x9E3779B9u;
  auto next = [&state] { return parityRandom(state); };
  auto chance = [&next](uint32_t percent) { return next() % 100u < percent; };

  const int iterations = 10000;
  int clustered = 0;
  for (int iteration = 0; iteration < iterations; iteration++) {
    const bool v2 = chance(50);
    const uint32_t count = next() % 48u;
    const uint32_t numProps = v2 ? next() % 4u : 0u;

    std::vector<uint8_t> buf;
    auto pushU32 = [&buf](uint32_t v) {
      for (int b = 0; b < 4; b++) buf.push_back(static_cast<uint8_t>((v >> (b * 8)) & 0xFF));
    };
    auto pushF64 = [&buf](double v) {
      uint8_t tmp[8];
      std::memcpy(tmp, &v, 8);
      buf.insert(buf.end(), tmp, tmp + 8);
    };
    auto randomDouble = [&]() -> double {
      switch (next() % 16u) {
        case 0: return std::numeric_limits<double>::quiet_NaN();
        case 1: return std::numeric_limits<double>::infinity();
        case 2: return -std::numeric_limits<double>::infinity();
        case 3: return 1e300;
        case 4: return -1e-300;
        default: return -200.0 + static_cast<double>(next() % 4000001u) / 10000.0;
      }
    };

    if (v2) pushU32(ClusterEngineCore::kBufferMagicV2);
    pushU32(count);
    if (v2) pushU32(numProps);
    for (uint32_t i = 0; i < count; i++) {
      uint32_t id = i;
      if (chance(2)) {
        const uint32_t extremes[] = {0u, 1u, 0x7FFFFFFFu, 0x80000000u, 0xFFFFFFFFu};
        id = chance(50) ? extremes[next() % 5u] : next();
      }
      pushU32(id);
      // Mostly valid coordinates, so most buffers reach clustering.
      pushF64(chance(85) ? -80.0 + static_cast<double>(next() % 1600001u) / 10000.0 : randomDouble());
      pushF64(chance(85) ? -180.0 + static_cast<double>(next() % 3600001u) / 10000.0 : randomDouble());
      for (uint32_t k = 0; k < numProps; k++) pushF64(randomDouble());
    }

    if (chance(20)) buf.resize(next() % (buf.size() + 1));
    if (chance(20)) {
      // The count, or in v2 the count or numProps.
      const size_t at = v2 ? 4 + 4 * (next() % 2u) : 0;
      const uint32_t v = next();
      if (buf.size() >= at + 4) std::memcpy(buf.data() + at, &v, 4);
    }
    if (chance(20) && !buf.empty()) {
      for (uint32_t flips = 1 + next() % 8u; flips > 0; flips--) {
        buf[next() % buf.size()] ^= static_cast<uint8_t>(1u << (next() % 8u));
      }
    }

    ClusterEngineCore engine;
    ClusterEngineConfig config;
    config.minZoom = 0;
    config.maxZoom = static_cast<int32_t>(next() % 21u);
    config.radius = 10.0 + static_cast<double>(next() % 90u);
    config.minPoints = 2 + static_cast<int32_t>(next() % 3u);
    config.clusteringEnabled = chance(85);
    const AggregationReducer reducers[] = {AggregationReducer::Sum, AggregationReducer::Min, AggregationReducer::Max};
    for (uint32_t k = next() % 4u; k > 0; k--) config.reducers.push_back(reducers[next() % 3u]);
    engine.setOptions(config);

    // A copy sized exactly, so ASan sees a read one byte past the end.
    std::vector<uint8_t> exact(buf.begin(), buf.end());
    if (!engine.setPointsFromBuffer(exact.data(), exact.size())) {
      assert(engine.pointCount() == 0);
      continue;
    }

    engine.build();
    if (engine.pointCount() > 1 && config.clusteringEnabled) clustered++;
    for (const int32_t z : {config.minZoom, config.maxZoom, config.maxZoom + 1}) {
      const auto nodes = engine.getClusters({90.0, -90.0, 180.0, -180.0, static_cast<double>(z)});
      size_t total = 0;
      for (const auto& node : nodes) {
        total += static_cast<size_t>(node.count);
        if (!node.isCluster) continue;
        assert(engine.getLeaves(node.id, 0, 0).size() == static_cast<size_t>(node.count));
        assert(engine.getClusterBounds(node.id).has_value());
        const int32_t expansion = engine.getClusterExpansionZoom(node.id);
        assert(expansion > node.zoom || expansion > config.maxZoom);
        (void)engine.getChildren(node.id);
      }
      assert(total == engine.pointCount());
    }
  }
  // About half the buffers are corrupted on purpose and rejected; the rest must
  // get through, or the fuzz only exercises rejection.
  assert(clustered > iterations / 3);
}

int main() {
  testGetLeavesReturnsAllPointsInCluster();
  testGetLeavesPagination();
  testGetLeavesPaginationOfLargeCluster();
  testPropertyAggregationSumMinMax();
  testBufferV2Aggregation();
  testPointIndexPreservesOriginalInputIndex();
  testClusterIdsSkipSurvivingPointIds();
  testClusterIdsSkipSurvivingPointIdsFromBuffer();
  testClusterIdsSkipSparsePointIds();
  testGetLeavesUnlimited();
  testClusterBoundsSpanTheLeaves();
  testClusterBoundsUseClampedLatitudes();
  testInvalidBufferRejected();
  testBufferSizeOverflowRejected();
  testBufferPointIdsLeaveRoomForClusterIds();
  testMemorySizeReflectsNativeAllocations();
  testMinLeafIdIsTheSmallestLeafAtEveryZoom();
  testSuperclusterParity();
  testSuperclusterAntimeridianParity();
  testSuperclusterDatasetParity();
  testGetClustersAcrossAntimeridian();
  testExpansionZoomOfClusterSurvivingToLowerZooms();
  testExpansionZoomOfIdenticalPoints();
  testExpansionZoomOfPointId();
  testExpansionZoomsMatchWhereClustersSplit();
  testPointsStandAloneAboveMaxZoom();
  testPointsAboveMaxZoomOfClustersCentredOutside();
  testPointsAboveMaxZoomOnTheViewportEdge();
  testPointsAboveMaxZoomMatchABruteForceFilter();
  testBoundaryClusterIds();
  testBoundaryLeafLimits();
  testBoundaryLeafOffsets();
  testBoundaryOptions();
  testInvalidOptionsNameTheOption();
  testSkippedQueriesBuildTheSameIndex();
  testSkippingNodesSeeDistantClusters();
  testCertificatesRoundDown();
  testPatchedTreesBuildTheSameIndex();
  testWithinFindsItemsOnTheRoundingEdge();
  testPatchedTreeMatchesAScan();
  testBufferFuzz();
  std::printf("ClusterEngineCore tests passed.\n");
  return 0;
}
