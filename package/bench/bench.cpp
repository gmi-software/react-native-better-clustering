// Core benchmark harness for ClusterEngineCore. Not part of the npm package or
// any app build. Each process measures one (dataset, size) case and prints it
// as one JSON object; `bun run bench` (run.mjs) builds it, runs every case and
// collects the results. See README.md in this directory.
//
// From package/bench:
//   c++ -std=c++20 -O2 -DNDEBUG -I../cpp bench.cpp -o cluster_bench
//   ./cluster_bench --dataset city --size 10000
//
// `--once` runs every operation a single time, between callgrind client
// requests when <valgrind/callgrind.h> is available, so
// `valgrind --tool=callgrind` reports each operation's instruction count.
#include "ClusterEngineCore.hpp"
#include "datasets.hpp"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <functional>
#include <memory>
#include <new>
#include <string>
#include <sys/resource.h>
#include <vector>

#if defined(__has_include)
#if __has_include(<valgrind/callgrind.h>)
#include <valgrind/callgrind.h>
#define BENCH_HAS_CALLGRIND 1
#endif
#endif
#ifndef BENCH_HAS_CALLGRIND
#define BENCH_HAS_CALLGRIND 0
#define CALLGRIND_ZERO_STATS
#define CALLGRIND_DUMP_STATS_AT(name) ((void)(name))
#define RUNNING_ON_VALGRIND 0
#endif

using namespace margelo::nitro::nitromapcluster;
using SteadyClock = std::chrono::steady_clock;

// ---------------------------------------------------------------------------
// Allocation counting: every replaceable global operator new/delete, so the
// count covers std::vector, std::unordered_map nodes and aligned allocations
// alike. Counting is switched on only around the measured operation.

namespace {

bool gCountAllocations = false;
uint64_t gAllocationCount = 0;
uint64_t gAllocationBytes = 0;

void* countedAlloc(std::size_t size) {
  if (gCountAllocations) {
    gAllocationCount++;
    gAllocationBytes += size;
  }
  void* ptr = std::malloc(size == 0 ? 1 : size);
  if (ptr == nullptr)
    throw std::bad_alloc();
  return ptr;
}

void* countedAlignedAlloc(std::size_t size, std::align_val_t alignment) {
  if (gCountAllocations) {
    gAllocationCount++;
    gAllocationBytes += size;
  }
  const std::size_t align = std::max(static_cast<std::size_t>(alignment), sizeof(void*));
  void* ptr = nullptr;
  if (posix_memalign(&ptr, align, size == 0 ? 1 : size) != 0)
    throw std::bad_alloc();
  return ptr;
}

} // namespace

void* operator new(std::size_t size) {
  return countedAlloc(size);
}
void* operator new[](std::size_t size) {
  return countedAlloc(size);
}
void* operator new(std::size_t size, const std::nothrow_t&) noexcept {
  try {
    return countedAlloc(size);
  } catch (...) {
    return nullptr;
  }
}
void* operator new[](std::size_t size, const std::nothrow_t&) noexcept {
  try {
    return countedAlloc(size);
  } catch (...) {
    return nullptr;
  }
}
void* operator new(std::size_t size, std::align_val_t alignment) {
  return countedAlignedAlloc(size, alignment);
}
void* operator new[](std::size_t size, std::align_val_t alignment) {
  return countedAlignedAlloc(size, alignment);
}
void* operator new(std::size_t size, std::align_val_t alignment, const std::nothrow_t&) noexcept {
  try {
    return countedAlignedAlloc(size, alignment);
  } catch (...) {
    return nullptr;
  }
}
void* operator new[](std::size_t size, std::align_val_t alignment, const std::nothrow_t&) noexcept {
  try {
    return countedAlignedAlloc(size, alignment);
  } catch (...) {
    return nullptr;
  }
}
void operator delete(void* ptr) noexcept {
  std::free(ptr);
}
void operator delete[](void* ptr) noexcept {
  std::free(ptr);
}
void operator delete(void* ptr, std::size_t) noexcept {
  std::free(ptr);
}
void operator delete[](void* ptr, std::size_t) noexcept {
  std::free(ptr);
}
void operator delete(void* ptr, const std::nothrow_t&) noexcept {
  std::free(ptr);
}
void operator delete[](void* ptr, const std::nothrow_t&) noexcept {
  std::free(ptr);
}
void operator delete(void* ptr, std::align_val_t) noexcept {
  std::free(ptr);
}
void operator delete[](void* ptr, std::align_val_t) noexcept {
  std::free(ptr);
}
void operator delete(void* ptr, std::size_t, std::align_val_t) noexcept {
  std::free(ptr);
}
void operator delete[](void* ptr, std::size_t, std::align_val_t) noexcept {
  std::free(ptr);
}
void operator delete(void* ptr, std::align_val_t, const std::nothrow_t&) noexcept {
  std::free(ptr);
}
void operator delete[](void* ptr, std::align_val_t, const std::nothrow_t&) noexcept {
  std::free(ptr);
}

namespace {

// ---------------------------------------------------------------------------
// What the benchmark clusters with and queries for: the compat `MapView` with
// default props on a 390 × 844 pt phone (radius = window width × 0.06).

constexpr double kViewportWidth = 390.0;
constexpr double kViewportHeight = 844.0;
// The compat MapView measures cluster zoom against 256-pt tiles.
constexpr double kViewportTileSize = 256.0;
constexpr int32_t kQueryZooms[] = {4, 8, 12, 16};

ClusterEngineConfig benchConfig() {
  ClusterEngineConfig config;
  config.radius = kViewportWidth * 0.06;
  config.minPoints = 2;
  config.minZoom = 1;
  config.maxZoom = 20;
  config.extent = 512;
  config.nodeSize = 64;
  return config;
}

// The bounds the compat MapView sends at cluster zoom `zoom` for a phone-sized
// map centred on (lat, lng). Its bbox is the region ± one full delta, which at
// the cluster zoom spans as many 256-pt tile pixels as the map has points.
// Like regionToBBox, the longitudes are not wrapped: around the antimeridian
// the east edge goes past 180 and the engine normalizes it.
ViewportBounds phoneViewport(double lat, double lng, int32_t zoom) {
  const double worldSize = kViewportTileSize * std::pow(2.0, zoom);
  const double sinLat = std::sin(lat * M_PI / 180.0);
  const double centerX = (lng + 180.0) / 360.0 * worldSize;
  const double centerY = (0.5 - std::log((1.0 + sinLat) / (1.0 - sinLat)) / (4.0 * M_PI)) * worldSize;

  auto pixelToLat = [worldSize](double y) {
    const double n = M_PI - 2.0 * M_PI * y / worldSize;
    return 180.0 / M_PI * std::atan(0.5 * (std::exp(n) - std::exp(-n)));
  };

  ViewportBounds bounds;
  bounds.zoom = static_cast<double>(zoom);
  bounds.north = pixelToLat(std::max(0.0, centerY - kViewportHeight / 2.0));
  bounds.south = pixelToLat(std::min(worldSize, centerY + kViewportHeight / 2.0));
  bounds.west = (centerX - kViewportWidth / 2.0) / worldSize * 360.0 - 180.0;
  bounds.east = (centerX + kViewportWidth / 2.0) / worldSize * 360.0 - 180.0;
  return bounds;
}

// The v1 buffer packPoints() writes: int32 count, then per point an int32 id
// and float64 lat/lng. This is the path the Nitro module takes.
std::vector<uint8_t> packPointsV1(const bench::Dataset& dataset) {
  const int32_t count = static_cast<int32_t>(dataset.lats.size());
  std::vector<uint8_t> buffer(4 + static_cast<size_t>(count) * 20);
  uint8_t* ptr = buffer.data();
  std::memcpy(ptr, &count, 4);
  ptr += 4;
  for (int32_t i = 0; i < count; i++) {
    std::memcpy(ptr, &i, 4);
    std::memcpy(ptr + 4, &dataset.lats[static_cast<size_t>(i)], 8);
    std::memcpy(ptr + 12, &dataset.lngs[static_cast<size_t>(i)], 8);
    ptr += 20;
  }
  return buffer;
}

// ---------------------------------------------------------------------------
// Measurement.

struct Options {
  std::string dataset;
  int32_t size = 0;
  bool once = false;
  int minSamples = 10;
  int maxSamples = 1000;
  double minTimeMs = 300.0;
  double maxTimeMs = 5000.0;
};

struct OpResult {
  std::string name;
  // What the operation returned: the indexed point count for `build`, the
  // number of nodes for queries, the zoom for `expansion_top`.
  int64_t result = 0;
  uint64_t allocationCount = 0;
  uint64_t allocationBytes = 0;
  int64_t iterations = 0;
  std::vector<double> samplesNs;
};

double elapsedNs(SteadyClock::time_point from, SteadyClock::time_point to) {
  return std::chrono::duration<double, std::nano>(to - from).count();
}

// Keeps query results observable so the optimizer cannot drop them.
volatile int64_t gSink = 0;

// Runs `run` once with allocations counted (and, under callgrind, between a
// zero and a dump of the counters), then, unless `--once`, times batches of
// `run` calls. `afterBatch` runs untimed after each batch; `build` uses it to
// destroy the engines it created.
OpResult measure(
    const char* name, const Options& options, const std::function<int64_t()>& run, const std::function<void()>& afterBatch = [] {},
    bool singleIteration = false) {
  OpResult op;
  op.name = name;

  gAllocationCount = 0;
  gAllocationBytes = 0;
  gCountAllocations = true;
  CALLGRIND_ZERO_STATS;
  op.result = run();
  CALLGRIND_DUMP_STATS_AT(name);
  gCountAllocations = false;
  op.allocationCount = gAllocationCount;
  op.allocationBytes = gAllocationBytes;
  afterBatch();

  if (options.once)
    return op;

  // Batch fast operations so one sample spans at least 50 µs, far above the
  // clock's resolution and call overhead.
  int64_t iterations = 1;
  if (!singleIteration) {
    while (iterations < (int64_t{1} << 20)) {
      const auto t0 = SteadyClock::now();
      for (int64_t i = 0; i < iterations; i++)
        gSink = gSink + run();
      const auto t1 = SteadyClock::now();
      afterBatch();
      if (elapsedNs(t0, t1) >= 50'000.0)
        break;
      iterations *= 2;
    }
  }
  op.iterations = iterations;

  const auto start = SteadyClock::now();
  while (true) {
    const auto t0 = SteadyClock::now();
    for (int64_t i = 0; i < iterations; i++)
      gSink = gSink + run();
    const auto t1 = SteadyClock::now();
    afterBatch();
    op.samplesNs.push_back(elapsedNs(t0, t1) / static_cast<double>(iterations));

    const int samples = static_cast<int>(op.samplesNs.size());
    const double totalMs = elapsedNs(start, SteadyClock::now()) / 1e6;
    if (samples >= options.maxSamples)
      break;
    if (samples >= options.minSamples && totalMs >= options.minTimeMs)
      break;
    if (samples >= 3 && totalMs >= options.maxTimeMs)
      break;
  }
  return op;
}

double median(std::vector<double> values) {
  if (values.empty())
    return 0.0;
  std::sort(values.begin(), values.end());
  const size_t mid = values.size() / 2;
  return values.size() % 2 == 1 ? values[mid] : (values[mid - 1] + values[mid]) / 2.0;
}

double percentile(std::vector<double> values, double p) {
  if (values.empty())
    return 0.0;
  std::sort(values.begin(), values.end());
  const size_t rank = static_cast<size_t>(std::ceil(p * static_cast<double>(values.size())));
  return values[std::min(values.size(), std::max<size_t>(rank, 1)) - 1];
}

// Median absolute deviation from the median.
double mad(const std::vector<double>& values) {
  const double center = median(values);
  std::vector<double> deviations;
  deviations.reserve(values.size());
  for (double v : values)
    deviations.push_back(std::fabs(v - center));
  return median(deviations);
}

uint64_t peakRssBytes() {
  struct rusage usage{};
  getrusage(RUSAGE_SELF, &usage);
#if defined(__APPLE__)
  return static_cast<uint64_t>(usage.ru_maxrss);
#else
  return static_cast<uint64_t>(usage.ru_maxrss) * 1024u;
#endif
}

// The cluster with the most points at minZoom across the whole world; ties go
// to the smallest leaf id so the choice does not depend on result order.
ClusterNode topNode(const ClusterEngineCore& engine, const ClusterEngineConfig& config) {
  const auto nodes = engine.getClusters({85.05, -85.05, 180.0, -180.0, static_cast<double>(config.minZoom)});
  ClusterNode best{};
  bool found = false;
  for (const auto& node : nodes) {
    if (!found || node.count > best.count || (node.count == best.count && node.minLeafId < best.minLeafId)) {
      best = node;
      found = true;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// JSON output.

std::string jsonString(const std::string& value) {
  std::string out = "\"";
  for (char c : value) {
    if (c == '"' || c == '\\') {
      out += '\\';
      out += c;
    } else if (static_cast<unsigned char>(c) < 0x20) {
      char escaped[8];
      std::snprintf(escaped, sizeof(escaped), "\\u%04x", c);
      out += escaped;
    } else {
      out += c;
    }
  }
  return out + "\"";
}

void printJson(const Options& options, const bench::Dataset& dataset, const ClusterEngineConfig& config, size_t memorySize,
               uint64_t rssBytes, const std::vector<OpResult>& ops) {
  char hash[16];
  std::snprintf(hash, sizeof(hash), "%08x", bench::datasetHash(dataset));

  std::printf("{\n");
  std::printf("  \"dataset\": %s,\n", jsonString(options.dataset).c_str());
  std::printf("  \"size\": %d,\n", options.size);
  std::printf("  \"datasetHash\": \"%s\",\n", hash);
  std::printf("  \"focus\": {\"lat\": %.10g, \"lng\": %.10g},\n", dataset.focusLat, dataset.focusLng);
  std::string queryZooms;
  for (int32_t zoom : kQueryZooms) {
    queryZooms += (queryZooms.empty() ? "" : ", ") + std::to_string(zoom);
  }
  // Everything that shapes the measurement besides the dataset, so compare.mjs
  // can refuse to compare reports measured differently.
  std::printf("  \"config\": {\"radius\": %.10g, \"minPoints\": %d, \"minZoom\": %d, \"maxZoom\": %d, \"extent\": %d, "
              "\"nodeSize\": %d, \"viewport\": {\"width\": %.10g, \"height\": %.10g, \"tileSize\": %.10g}, \"queryZooms\": [%s]},\n",
              config.radius, config.minPoints, config.minZoom, config.maxZoom, config.extent, config.nodeSize, kViewportWidth,
              kViewportHeight, kViewportTileSize, queryZooms.c_str());
  std::printf("  \"compiler\": %s,\n", jsonString(__VERSION__).c_str());
  std::printf("  \"once\": %s,\n", options.once ? "true" : "false");
  std::printf("  \"callgrind\": %s,\n", BENCH_HAS_CALLGRIND && RUNNING_ON_VALGRIND ? "true" : "false");
  std::printf("  \"memorySize\": %zu,\n", memorySize);
  if (options.once) {
    std::printf("  \"peakRssBytes\": null,\n");
  } else {
    std::printf("  \"peakRssBytes\": %llu,\n", static_cast<unsigned long long>(rssBytes));
  }
  std::printf("  \"ops\": [\n");
  for (size_t i = 0; i < ops.size(); i++) {
    const OpResult& op = ops[i];
    std::printf("    {\"name\": %s, \"result\": %lld, \"allocationCount\": %llu, \"allocationBytes\": %llu", jsonString(op.name).c_str(),
                static_cast<long long>(op.result), static_cast<unsigned long long>(op.allocationCount),
                static_cast<unsigned long long>(op.allocationBytes));
    if (!op.samplesNs.empty()) {
      double minNs = op.samplesNs.front();
      for (double v : op.samplesNs)
        minNs = std::min(minNs, v);
      std::printf(", \"time\": {\"samples\": %zu, \"iterations\": %lld, \"medianNs\": %.1f, \"p95Ns\": %.1f, \"madNs\": %.1f, "
                  "\"minNs\": %.1f}",
                  op.samplesNs.size(), static_cast<long long>(op.iterations), median(op.samplesNs), percentile(op.samplesNs, 0.95),
                  mad(op.samplesNs), minNs);
    }
    std::printf("}%s\n", i + 1 < ops.size() ? "," : "");
  }
  std::printf("  ]\n}\n");
}

// ---------------------------------------------------------------------------

[[noreturn]] void usage(const char* message) {
  std::fprintf(stderr,
               "error: %s\n"
               "usage: cluster_bench --dataset <name> --size <n> [--once]\n"
               "                     [--min-samples N] [--max-samples N] [--min-time-ms N] [--max-time-ms N]\n"
               "       cluster_bench --list\n",
               message);
  std::exit(2);
}

Options parseOptions(int argc, char** argv) {
  Options options;
  for (int i = 1; i < argc; i++) {
    const std::string arg = argv[i];
    auto value = [&]() -> std::string {
      if (i + 1 >= argc)
        usage(("missing value for " + arg).c_str());
      return argv[++i];
    };
    if (arg == "--list") {
      std::printf("[");
      bool first = true;
      for (const char* name : bench::kDatasetNames) {
        std::printf("%s\"%s\"", first ? "" : ", ", name);
        first = false;
      }
      std::printf("]\n");
      std::exit(0);
    } else if (arg == "--dataset") {
      options.dataset = value();
    } else if (arg == "--size") {
      options.size = std::atoi(value().c_str());
    } else if (arg == "--once") {
      options.once = true;
    } else if (arg == "--min-samples") {
      options.minSamples = std::max(1, std::atoi(value().c_str()));
    } else if (arg == "--max-samples") {
      options.maxSamples = std::max(1, std::atoi(value().c_str()));
    } else if (arg == "--min-time-ms") {
      options.minTimeMs = std::atof(value().c_str());
    } else if (arg == "--max-time-ms") {
      options.maxTimeMs = std::atof(value().c_str());
    } else {
      usage(("unknown argument " + arg).c_str());
    }
  }
  if (!bench::isDatasetName(options.dataset))
    usage("--dataset must be one of the names --list prints");
  if (options.size <= 0)
    usage("--size must be a positive integer");
  return options;
}

} // namespace

int main(int argc, char** argv) {
  const Options options = parseOptions(argc, argv);
  const ClusterEngineConfig config = benchConfig();
  const bench::Dataset dataset = bench::generateDataset(options.dataset, options.size);
  const std::vector<uint8_t> buffer = packPointsV1(dataset);

  std::vector<OpResult> ops;

  // setPoints + build, on a fresh engine each time, as the Nitro module does.
  std::vector<std::unique_ptr<ClusterEngineCore>> built;
  ops.push_back(measure(
      "build", options,
      [&]() -> int64_t {
        auto engine = std::make_unique<ClusterEngineCore>();
        engine->setOptions(config);
        if (!engine->setPointsFromBuffer(buffer.data(), buffer.size())) {
          std::fprintf(stderr, "error: setPointsFromBuffer rejected the buffer\n");
          std::exit(1);
        }
        engine->build();
        const int64_t count = static_cast<int64_t>(engine->pointCount());
        built.push_back(std::move(engine));
        return count;
      },
      [&]() {
        // `--once` keeps its single engine for the queries: under valgrind a
        // second build would double the run time.
        if (!options.once)
          built.clear();
      },
      /*singleIteration=*/true));

  // The engine every query runs against. Built after the timed builds, so only
  // one engine is alive when peak RSS is read.
  if (built.empty()) {
    auto queryEngine = std::make_unique<ClusterEngineCore>();
    queryEngine->setOptions(config);
    queryEngine->setPointsFromBuffer(buffer.data(), buffer.size());
    queryEngine->build();
    built.push_back(std::move(queryEngine));
  }
  const ClusterEngineCore& engine = *built.back();
  const size_t memorySize = engine.memorySize();
  const uint64_t rssBytes = peakRssBytes();

  for (int32_t zoom : kQueryZooms) {
    const ViewportBounds viewport = phoneViewport(dataset.focusLat, dataset.focusLng, zoom);
    const std::string name = "clusters_z" + std::to_string(zoom);
    ops.push_back(measure(name.c_str(), options, [&]() -> int64_t { return static_cast<int64_t>(engine.getClusters(viewport).size()); }));
  }

  const ClusterNode top = topNode(engine, config);
  ops.push_back(measure("leaves_top", options, [&]() -> int64_t { return static_cast<int64_t>(engine.getLeaves(top.id, 0, 0).size()); }));
  ops.push_back(measure("bounds_top", options, [&]() -> int64_t { return engine.getClusterBounds(top.id).has_value() ? 1 : 0; }));
  ops.push_back(measure("expansion_top", options, [&]() -> int64_t { return engine.getClusterExpansionZoom(top.id); }));

  std::vector<ViewportBounds> sweep;
  for (int32_t zoom = config.minZoom; zoom <= config.maxZoom; zoom++) {
    sweep.push_back(phoneViewport(dataset.focusLat, dataset.focusLng, zoom));
  }
  ops.push_back(measure("zoom_sweep", options, [&]() -> int64_t {
    int64_t total = 0;
    for (const auto& viewport : sweep)
      total += static_cast<int64_t>(engine.getClusters(viewport).size());
    return total;
  }));

  printJson(options, dataset, config, memorySize, rssBytes, ops);
  return 0;
}
