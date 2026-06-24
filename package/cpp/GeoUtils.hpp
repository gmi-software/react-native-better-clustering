#pragma once

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <limits>
#include <vector>

namespace margelo::nitro::nitromapcluster {

// Declarative numeric aggregation kinds. supercluster lets you pass arbitrary
// JS map/reduce functions; running those per point would force a JS hop and
// kill the native performance, so we support the common reducers natively.
enum class AggregationReducer : uint8_t {
  Sum = 0,
  Min = 1,
  Max = 2,
};

inline double reducerSeed(AggregationReducer kind) {
  switch (kind) {
    case AggregationReducer::Sum:
      return 0.0;
    case AggregationReducer::Min:
      return std::numeric_limits<double>::infinity();
    case AggregationReducer::Max:
      return -std::numeric_limits<double>::infinity();
  }
  return 0.0;
}

inline double reducerApply(AggregationReducer kind, double acc, double value) {
  switch (kind) {
    case AggregationReducer::Sum:
      return acc + value;
    case AggregationReducer::Min:
      return std::min(acc, value);
    case AggregationReducer::Max:
      return std::max(acc, value);
  }
  return acc;
}

constexpr double EARTH_RADIUS = 6378137.0;
constexpr double MAX_LATITUDE = 85.05112878;
constexpr double CLAMP_MAX_LATITUDE = 85.05;
constexpr double CLAMP_MAX_LONGITUDE = 180.0;

inline double clamp(double value, double minVal, double maxVal) {
  return std::max(minVal, std::min(value, maxVal));
}

inline bool isValidGeoCoordinate(double lat, double lng) {
  return std::isfinite(lat) && std::isfinite(lng);
}

inline double clampLatitude(double lat) {
  return clamp(lat, -CLAMP_MAX_LATITUDE, CLAMP_MAX_LATITUDE);
}

inline double clampLongitude(double lng) {
  return clamp(lng, -CLAMP_MAX_LONGITUDE, CLAMP_MAX_LONGITUDE);
}

inline double lngToX(double lng, int extent) {
  if (!std::isfinite(lng)) {
    return std::numeric_limits<double>::quiet_NaN();
  }
  const double clampedLng = clampLongitude(lng);
  return (clampedLng + 180.0) / 360.0 * static_cast<double>(extent);
}

inline double latToY(double lat, int extent) {
  if (!std::isfinite(lat)) {
    return std::numeric_limits<double>::quiet_NaN();
  }
  const double clampedLat = clampLatitude(lat);
  const double sinLat = std::sin(clampedLat * M_PI / 180.0);
  const double y = 0.5 - 0.25 * std::log((1.0 + sinLat) / (1.0 - sinLat)) / M_PI;
  return y * static_cast<double>(extent);
}

inline double xToLng(double x, int extent) {
  return x / static_cast<double>(extent) * 360.0 - 180.0;
}

inline double yToLat(double y, int extent) {
  const double n = M_PI - 2.0 * M_PI * y / static_cast<double>(extent);
  return 180.0 / M_PI * std::atan(0.5 * (std::exp(n) - std::exp(-n)));
}

inline double zoomScale(double zoom, int extent) {
  return std::pow(2.0, zoom) * static_cast<double>(extent) / 256.0;
}

struct PointData {
  int32_t id;
  double latitude;
  double longitude;
  double x;
  double y;
  // Raw numeric values for declarative aggregation, one per configured
  // reducer. Empty when no aggregation is configured.
  std::vector<double> values;
};

struct ClusterNode {
  int32_t id;
  double x;
  double y;
  int32_t count;
  int32_t parentId;
  int32_t pointIndex; // -1 for cluster, >= 0 for leaf point index
  bool isCluster;
  int32_t zoom;
  // Aggregated values, one per configured reducer. For a leaf this mirrors the
  // point's raw values; for a cluster it is the reduced result over its leaves.
  std::vector<double> values;
};

struct ViewportBounds {
  double north;
  double south;
  double east;
  double west;
  double zoom;
};

struct ClusterEngineConfig {
  double radius = 40.0;
  int32_t minPoints = 2;
  int32_t minZoom = 1;
  int32_t maxZoom = 20;
  int32_t extent = 512;
  int32_t nodeSize = 64;
  bool clusteringEnabled = true;
  // One reducer per aggregated property, aligned with the per-point `values`
  // packed in the points buffer. Empty disables aggregation.
  std::vector<AggregationReducer> reducers;
};

} // namespace margelo::nitro::nitromapcluster
