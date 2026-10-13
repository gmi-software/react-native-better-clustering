#pragma once

// Seeded point sets for the core benchmark (see README.md in this directory).
//
// The points are generated rather than stored: a 100k-point file per dataset
// would add megabytes to the repository, while the generator, its seed and the
// hash of its output pin the same data. Every coordinate is `A + B / C` with
// integer B and C, so it is correctly rounded and comes out bit-identical from
// any IEEE-754 implementation, a JavaScript port included (compile with
// `-ffp-contract=off` so no step fuses into an FMA). The random source is the
// xorshift32 the supercluster parity fixture uses.

#include <cstdint>
#include <cstring>
#include <string>
#include <vector>

namespace bench {

struct Dataset {
  std::string name;
  std::vector<double> lats;
  std::vector<double> lngs;
  // Where the phone viewports are centred: the densest part of the dataset.
  double focusLat = 0.0;
  double focusLng = 0.0;
};

// xorshift32. Bit-exact in C++ (uint32_t) and JavaScript (with `>>> 0`).
class XorShift32 {
public:
  explicit XorShift32(uint32_t seed) : _state(seed == 0 ? 1u : seed) {}

  uint32_t next() {
    _state ^= _state << 13;
    _state ^= _state >> 17;
    _state ^= _state << 5;
    return _state;
  }

  // Uniform-ish integer in [0, steps]. The modulo bias is irrelevant here.
  int64_t upTo(uint32_t steps) {
    return static_cast<int64_t>(next() % (steps + 1u));
  }

  // Sum of `draws` values from upTo(steps). The draws are sequenced here: the
  // operands of `upTo() + upTo()` are evaluated in an unspecified order.
  int64_t sumOf(int draws, uint32_t steps) {
    int64_t sum = 0;
    for (int i = 0; i < draws; i++) {
      sum += upTo(steps);
    }
    return sum;
  }

private:
  uint32_t _state;
};

inline constexpr const char* kDatasetNames[] = {"uniform", "city", "blobs", "identical", "grid", "antimeridian"};
inline constexpr uint32_t kDatasetSeed = 20260929u;

inline double wrapLongitude(double lng) {
  if (lng > 180.0)
    return lng - 360.0;
  if (lng < -180.0)
    return lng + 360.0;
  return lng;
}

// The whole world between 60°S and 60°N: sparse, every zoom level populated.
inline void generateUniform(Dataset& d, int32_t n, XorShift32& rng) {
  d.focusLat = 0.0;
  d.focusLng = 0.0;
  for (int32_t i = 0; i < n; i++) {
    d.lats.push_back(-60.0 + static_cast<double>(rng.upTo(1200000)) / 10000.0);
    d.lngs.push_back(-180.0 + static_cast<double>(rng.upTo(3600000)) / 10000.0);
  }
}

// One metropolitan area (±0.3° lat, ±0.45° lng), denser towards the centre:
// each offset is the sum of three uniform draws.
inline void generateCity(Dataset& d, int32_t n, XorShift32& rng) {
  d.focusLat = 52.2297;
  d.focusLng = 21.0122;
  for (int32_t i = 0; i < n; i++) {
    const int64_t dLat = rng.sumOf(3, 20000) - 30000;
    const int64_t dLng = rng.sumOf(3, 30000) - 45000;
    d.lats.push_back(d.focusLat + static_cast<double>(dLat) / 100000.0);
    d.lngs.push_back(d.focusLng + static_cast<double>(dLng) / 100000.0);
  }
}

// 24 clusters of points at seeded centres, each with its own spread
// (0.05° to 2°). The viewports follow blob 0.
inline void generateBlobs(Dataset& d, int32_t n, XorShift32& rng) {
  constexpr int32_t kBlobs = 24;
  double centerLats[kBlobs];
  double centerLngs[kBlobs];
  int64_t spreads[kBlobs];
  for (int32_t k = 0; k < kBlobs; k++) {
    centerLats[k] = -50.0 + static_cast<double>(rng.upTo(1000000)) / 10000.0;
    centerLngs[k] = -180.0 + static_cast<double>(rng.upTo(3600000)) / 10000.0;
    spreads[k] = 1 + rng.upTo(39);
  }
  d.focusLat = centerLats[0];
  d.focusLng = centerLngs[0];
  for (int32_t i = 0; i < n; i++) {
    const int32_t k = static_cast<int32_t>(rng.next() % kBlobs);
    // Offsets in [-2000, 2000] × spread / 40000: up to ±spread × 0.05°.
    const int64_t dLat = (rng.sumOf(2, 2000) - 2000) * spreads[k];
    const int64_t dLng = (rng.sumOf(2, 2000) - 2000) * spreads[k];
    d.lats.push_back(centerLats[k] + static_cast<double>(dLat) / 40000.0);
    d.lngs.push_back(wrapLongitude(centerLngs[k] + static_cast<double>(dLng) / 40000.0));
  }
}

// Every point at the same coordinate: one cluster that never splits.
inline void generateIdentical(Dataset& d, int32_t n) {
  d.focusLat = 52.2297;
  d.focusLng = 21.0122;
  d.lats.assign(static_cast<size_t>(n), d.focusLat);
  d.lngs.assign(static_cast<size_t>(n), d.focusLng);
}

// A square lattice with 0.001° (about 100 m) spacing.
inline void generateGrid(Dataset& d, int32_t n) {
  int32_t cols = 1;
  while (static_cast<int64_t>(cols) * cols < n) {
    cols++;
  }
  const int32_t rows = (n + cols - 1) / cols;
  d.focusLat = 50.0 + static_cast<double>(rows / 2) / 1000.0;
  d.focusLng = 19.0 + static_cast<double>(cols / 2) / 1000.0;
  for (int32_t i = 0; i < n; i++) {
    d.lats.push_back(50.0 + static_cast<double>(i / cols) / 1000.0);
    d.lngs.push_back(19.0 + static_cast<double>(i % cols) / 1000.0);
  }
}

// The South Pacific between 170°E and 170°W, so the data and the viewports
// centred on 180° straddle the antimeridian.
inline void generateAntimeridian(Dataset& d, int32_t n, XorShift32& rng) {
  d.focusLat = -17.5;
  d.focusLng = 180.0;
  for (int32_t i = 0; i < n; i++) {
    d.lats.push_back(-25.0 + static_cast<double>(rng.upTo(150000)) / 10000.0);
    d.lngs.push_back(wrapLongitude(170.0 + static_cast<double>(rng.upTo(200000)) / 10000.0));
  }
}

inline bool isDatasetName(const std::string& name) {
  for (const char* known : kDatasetNames) {
    if (name == known)
      return true;
  }
  return false;
}

// Returns an empty dataset for an unknown name; check isDatasetName() first.
inline Dataset generateDataset(const std::string& name, int32_t n) {
  Dataset d;
  d.name = name;
  d.lats.reserve(static_cast<size_t>(n));
  d.lngs.reserve(static_cast<size_t>(n));
  XorShift32 rng(kDatasetSeed);
  if (name == "uniform")
    generateUniform(d, n, rng);
  if (name == "city")
    generateCity(d, n, rng);
  if (name == "blobs")
    generateBlobs(d, n, rng);
  if (name == "identical")
    generateIdentical(d, n);
  if (name == "grid")
    generateGrid(d, n);
  if (name == "antimeridian")
    generateAntimeridian(d, n, rng);
  return d;
}

// 32-bit FNV-1a over the little-endian bytes of every (lat, lng) pair, in
// point order. Recorded in the results so two runs can prove they measured the
// same points.
inline uint32_t datasetHash(const Dataset& d) {
  uint32_t hash = 2166136261u;
  auto fold = [&hash](double value) {
    uint64_t bits = 0;
    std::memcpy(&bits, &value, sizeof(bits));
    for (int byte = 0; byte < 8; byte++) {
      hash ^= static_cast<uint32_t>((bits >> (8 * byte)) & 0xffu);
      hash *= 16777619u;
    }
  };
  for (size_t i = 0; i < d.lats.size(); i++) {
    fold(d.lats[i]);
    fold(d.lngs[i]);
  }
  return hash;
}

} // namespace bench
