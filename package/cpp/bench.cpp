#include "ClusterEngineCore.hpp"
#include <chrono>
#include <cstdio>
#include <vector>

using namespace margelo::nitro::nitromapcluster;
using SteadyClock = std::chrono::steady_clock;

static double ms(SteadyClock::time_point a, SteadyClock::time_point b) {
  return std::chrono::duration<double, std::milli>(b - a).count();
}

static void bench(int32_t count, int warmup, int runs, int queriesPerRun) {
  ClusterEngineCore engine;
  ClusterEngineConfig config;
  config.radius = 50.0;
  config.minPoints = 2;
  config.minZoom = 0;
  config.maxZoom = 16;
  config.extent = 512;
  config.nodeSize = 64;
  engine.setOptions(config);

  std::vector<int32_t> ids(count);
  std::vector<double> lats(count);
  std::vector<double> lngs(count);
  for (int32_t i = 0; i < count; i++) {
    ids[i] = i;
    lats[i] = 52.0 + (i / 100) * 0.01;
    lngs[i] = 21.0 + (i % 100) * 0.01;
  }

  ViewportBounds bounds{53.0, 51.5, 22.0, 20.5, 10.0};

  for (int w = 0; w < warmup; w++) {
    ClusterEngineCore warm;
    warm.setOptions(config);
    warm.setPoints(ids.data(), lats.data(), lngs.data(), static_cast<size_t>(count));
    warm.build();
    for (int q = 0; q < queriesPerRun; q++) {
      (void)warm.getClusters(bounds);
    }
  }

  double buildTotal = 0.0;
  double queryTotal = 0.0;

  for (int r = 0; r < runs; r++) {
    ClusterEngineCore run;
    run.setOptions(config);

    const auto t0 = SteadyClock::now();
    run.setPoints(ids.data(), lats.data(), lngs.data(), static_cast<size_t>(count));
    run.build();
    const auto t1 = SteadyClock::now();

    for (int q = 0; q < queriesPerRun; q++) {
      (void)run.getClusters(bounds);
    }
    const auto t2 = SteadyClock::now();

    buildTotal += ms(t0, t1);
    queryTotal += ms(t1, t2) / queriesPerRun;
  }

  std::printf(
    "cpp,n=%d,build_ms=%.3f,query_ms=%.4f,runs=%d,queries=%d\n",
    count,
    buildTotal / runs,
    queryTotal / runs,
    runs,
    queriesPerRun
  );
}

int main() {
  const int warmup = 2;
  const int runs = 10;
  const int queries = 100;

  for (int n : {1000, 5000, 10000, 20000, 30000, 50000}) {
    bench(n, warmup, runs, queries);
  }
  return 0;
}
