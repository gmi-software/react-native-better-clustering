#pragma once

#include "GeoUtils.hpp"
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <limits>
#include <stdexcept>
#include <string>

namespace margelo::nitro::nitromapcluster {

// Checked conversions for the numbers JS passes across the Nitro boundary.
// They arrive as doubles that can be NaN, infinite, fractional or out of
// range, and `static_cast<int32_t>` is undefined behaviour for every value
// outside int32. Each helper throws `std::invalid_argument` naming the
// argument instead, and Nitro rethrows it as a JS error.

// Highest zoom the engine builds levels for. supercluster encodes the origin
// zoom of a cluster id in 5 bits, which caps it at the same value.
constexpr int32_t kMaxSupportedZoom = 30;

inline std::string formatNumber(double value) {
  char buffer[32];
  std::snprintf(buffer, sizeof(buffer), "%.15g", value);
  return buffer;
}

[[noreturn]] inline void throwInvalidArgument(const char* name, const std::string& requirement, double value) {
  throw std::invalid_argument(std::string("ClusterEngine: ") + name + " must be " + requirement + ", got " + formatNumber(value) + ".");
}

inline std::string describeIntegerRange(int32_t min, int32_t max) {
  constexpr int32_t lowest = std::numeric_limits<int32_t>::min();
  constexpr int32_t highest = std::numeric_limits<int32_t>::max();
  if (min == lowest && max == highest) {
    return "a 32-bit integer";
  }
  if (max == highest) {
    return "an integer >= " + std::to_string(min);
  }
  return "an integer from " + std::to_string(min) + " to " + std::to_string(max);
}

/** `value` as an int32 in `[min, max]`; throws unless it is a whole number in that range. */
inline int32_t toInt32(double value, const char* name, int32_t min = std::numeric_limits<int32_t>::min(),
                       int32_t max = std::numeric_limits<int32_t>::max()) {
  // Written so NaN fails every comparison and lands in the throw.
  const bool inRange = value >= static_cast<double>(min) && value <= static_cast<double>(max);
  if (!inRange || std::trunc(value) != value) {
    throwInvalidArgument(name, describeIntegerRange(min, max), value);
  }
  return static_cast<int32_t>(value);
}

inline int32_t toClusterId(double clusterId) {
  return toInt32(clusterId, "clusterId");
}

/**
 * `getLeaves` page size, where 0 means unlimited. Anything that cannot cap a
 * page means unlimited too: 0, negatives, NaN, `Infinity` (supercluster's
 * idiomatic "all leaves") and counts beyond int32.
 */
inline int32_t toLeafLimit(double limit) {
  if (!(limit > 0.0) || limit >= static_cast<double>(std::numeric_limits<int32_t>::max())) {
    return 0;
  }
  if (std::trunc(limit) != limit) {
    throwInvalidArgument("limit", "a whole number (0 or Infinity for no limit)", limit);
  }
  return static_cast<int32_t>(limit);
}

/** `getLeaves` leaves to skip. Negatives skip none and counts beyond int32 skip all. */
inline int32_t toLeafOffset(double offset) {
  if (offset <= 0.0) {
    return 0;
  }
  if (offset >= static_cast<double>(std::numeric_limits<int32_t>::max())) {
    return std::numeric_limits<int32_t>::max();
  }
  // NaN fails both comparisons above and this one too.
  if (std::trunc(offset) != offset) {
    throwInvalidArgument("offset", "a whole number", offset);
  }
  return static_cast<int32_t>(offset);
}

/** The numeric fields of the JS `ClusterEngineOptions`, exactly as JS passed them. */
struct RawClusterEngineOptions {
  double radius;
  double minPoints;
  double minZoom;
  double maxZoom;
  double extent;
  double nodeSize;
};

/**
 * Throws unless `config` can build a bounded, non-empty index. Values that are
 * unusual but well defined, such as `radius` 0 or `minPoints` below 2, pass.
 */
inline void validateClusterEngineConfig(const ClusterEngineConfig& config) {
  if (!(std::isfinite(config.radius) && config.radius >= 0.0)) {
    throwInvalidArgument("radius", "a finite number >= 0", config.radius);
  }
  if (config.minZoom < 0 || config.minZoom > kMaxSupportedZoom) {
    throwInvalidArgument("minZoom", describeIntegerRange(0, kMaxSupportedZoom), config.minZoom);
  }
  if (config.maxZoom < 0 || config.maxZoom > kMaxSupportedZoom) {
    throwInvalidArgument("maxZoom", describeIntegerRange(0, kMaxSupportedZoom), config.maxZoom);
  }
  if (config.minZoom > config.maxZoom) {
    throw std::invalid_argument("ClusterEngine: minZoom (" + std::to_string(config.minZoom) + ") must not be greater than maxZoom (" +
                                std::to_string(config.maxZoom) + ").");
  }
  if (config.extent < 1) {
    throwInvalidArgument("extent", describeIntegerRange(1, std::numeric_limits<int32_t>::max()), config.extent);
  }
}

/**
 * Converts options from JS. Reducers are left for the caller to fill, and
 * `ClusterEngineCore::setOptions` checks the rules that span fields.
 */
inline ClusterEngineConfig toClusterEngineConfig(const RawClusterEngineOptions& options) {
  ClusterEngineConfig config;
  config.radius = options.radius;
  config.minPoints = toInt32(options.minPoints, "minPoints");
  config.minZoom = toInt32(options.minZoom, "minZoom", 0, kMaxSupportedZoom);
  config.maxZoom = toInt32(options.maxZoom, "maxZoom", 0, kMaxSupportedZoom);
  config.extent = toInt32(options.extent, "extent", 1);
  config.nodeSize = toInt32(options.nodeSize, "nodeSize");
  return config;
}

} // namespace margelo::nitro::nitromapcluster
