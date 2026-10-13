// Standalone sanity test for ClusterEngineCore getLeaves/indexes.
// Compile: c++ -std=c++20 -I. -fsanitize=undefined,float-cast-overflow -fno-sanitize-recover=all ClusterEngineCore.test.cpp -o cluster_test && ./cluster_test

#include "ClusterEngineCore.hpp"
#include <algorithm>
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
  std::vector<int> expectedNodes;           // features returned per zoom, minZoom first
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
   {37, 154, 561, 1673, 3369, 4470, 4847, 4967, 4992, 4997, 4998, 4999, 5000, 5000, 5000, 5000, 5000},
   {37, 149, 517, 1210, 1184, 491, 152, 33, 8, 3, 2, 1, 0, 0, 0, 0, 0},
   {1805767755u, 606907344u, 251924099u, 3592547414u, 220092997u, 4170046084u, 2925551006u, 3474631211u, 1333171577u, 2017577864u, 2480066375u, 1314005163u, 2356979101u, 2356979101u, 2356979101u, 2356979101u, 2356979101u},
   {908295453u, 1735606782u, 3222375310u, 3309277285u, 2388417153u, 203899112u, 3887135902u, 649398139u, 2678596316u, 2291465887u, 3885708800u, 4185239937u, 2166136261u, 2166136261u, 2166136261u, 2166136261u, 2166136261u}},
  // n=5000 seed=12345 radius=40 extent=256 zoom 0..16 minPoints=2
  {5000, 12345u, 40.0, 256, 0, 16, 2,
   {11, 37, 154, 561, 1673, 3369, 4470, 4847, 4967, 4992, 4997, 4998, 4999, 5000, 5000, 5000, 5000},
   {11, 37, 149, 517, 1210, 1184, 491, 152, 33, 8, 3, 2, 1, 0, 0, 0, 0},
   {2501411492u, 1805767755u, 606907344u, 251924099u, 3592547414u, 220092997u, 4170046084u, 2925551006u, 3474631211u, 1333171577u, 2017577864u, 2480066375u, 1314005163u, 2356979101u, 2356979101u, 2356979101u, 2356979101u},
   {2901069191u, 446459210u, 1109370185u, 2470694807u, 1559555949u, 2215230431u, 2090804177u, 2143146402u, 698438652u, 3793120724u, 3800605278u, 3074938394u, 4168462318u, 2166136261u, 2166136261u, 2166136261u, 2166136261u}},
  // n=5000 seed=12345 radius=40 extent=1024 zoom 0..16 minPoints=2
  {5000, 12345u, 40.0, 1024, 0, 16, 2,
   {154, 561, 1673, 3369, 4470, 4847, 4967, 4992, 4997, 4998, 4999, 5000, 5000, 5000, 5000, 5000, 5000},
   {149, 517, 1210, 1184, 491, 152, 33, 8, 3, 2, 1, 0, 0, 0, 0, 0, 0},
   {606907344u, 251924099u, 3592547414u, 220092997u, 4170046084u, 2925551006u, 3474631211u, 1333171577u, 2017577864u, 2480066375u, 1314005163u, 2356979101u, 2356979101u, 2356979101u, 2356979101u, 2356979101u, 2356979101u},
   {2008030271u, 2096192001u, 86362713u, 719690823u, 4183232535u, 3830296254u, 3938549614u, 3787935432u, 2530141240u, 998378074u, 4202017556u, 2166136261u, 2166136261u, 2166136261u, 2166136261u, 2166136261u, 2166136261u}},
  // n=3000 seed=777 radius=80 extent=512 zoom 1..14 minPoints=2
  {3000, 777u, 80.0, 512, 1, 14, 2,
   {39, 148, 510, 1382, 2342, 2779, 2947, 2984, 2996, 2999, 3000, 3000, 3000, 3000},
   {38, 143, 447, 832, 539, 212, 52, 16, 4, 1, 0, 0, 0, 0},
   {993833477u, 2141167518u, 3161340709u, 3918890464u, 1036665440u, 3212688082u, 492023470u, 4180803411u, 921193384u, 4107195081u, 3305376653u, 3305376653u, 3305376653u, 3305376653u},
   {2013879702u, 2123372854u, 3188312041u, 1403982669u, 2167766900u, 1877615968u, 3665749095u, 2929400263u, 1421908612u, 723098213u, 2166136261u, 2166136261u, 2166136261u, 2166136261u}},
  // n=8000 seed=424242 radius=25 extent=512 zoom 0..12 minPoints=2
  {8000, 424242u, 25.0, 512, 0, 12, 2,
   {94, 372, 1341, 3613, 6142, 7474, 7864, 7969, 7991, 7998, 7999, 8000, 8000},
   {93, 360, 1200, 2210, 1526, 511, 134, 30, 9, 2, 1, 0, 0},
   {2473319454u, 999143822u, 3072884681u, 2567654997u, 3013614691u, 3374615311u, 3762316709u, 909188336u, 3632899351u, 26060799u, 1832098647u, 2459957253u, 2459957253u},
   {193477675u, 364685338u, 1078684228u, 1842364820u, 2604891972u, 3412529013u, 202904108u, 3785568585u, 843412277u, 1752323339u, 831472737u, 2166136261u, 2166136261u}},
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

  std::vector<std::vector<int32_t>> idsAtZoom(config.maxZoom + 1);
  for (int32_t z = config.minZoom; z <= config.maxZoom; z++) {
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
      if (expansion > config.maxZoom) continue;

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
  testExpansionZoomOfClusterSurvivingToLowerZooms();
  testExpansionZoomOfIdenticalPoints();
  testExpansionZoomOfPointId();
  testExpansionZoomsMatchWhereClustersSplit();
  testBoundaryClusterIds();
  testBoundaryLeafLimits();
  testBoundaryLeafOffsets();
  testBoundaryOptions();
  testInvalidOptionsNameTheOption();
  std::printf("ClusterEngineCore tests passed.\n");
  return 0;
}
