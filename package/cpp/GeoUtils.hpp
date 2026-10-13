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

/**
 * Cluster radius threshold at `zoom`, in the projected units of lngToX/latToY.
 *
 * supercluster projects into `[0, 1]` and uses `radius / (extent * 2^zoom)`.
 * We project into `[0, extent]`, so the equivalent threshold is that value
 * scaled by `extent`: the `extent` factors cancel and `radius / 2^zoom`
 * remains. `extent` still shapes clustering through the projection itself,
 * exactly as it does in supercluster -- it is not a second radius control.
 */
inline double clusterRadiusAtZoom(double radius, double zoom) {
  return radius / std::pow(2.0, zoom);
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
  // Smallest point id among the node's leaves (its own id for a point). A
  // cluster keeps it while it only gains or loses other leaves, so it
  // identifies the cluster across zoom levels and rebuilds.
  int32_t minLeafId = -1;
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

// The box a node's leaves span, in the coordinates the points were loaded with.
struct LeafBounds {
  double north;
  double south;
  double east;
  double west;
};

/** Longitude wrapped into [-180, 180), with supercluster's arithmetic. */
inline double wrapLongitude(double lng) {
  return std::fmod(std::fmod(lng + 180.0, 360.0) + 360.0, 360.0) - 180.0;
}

struct LongitudeRange {
  double west;
  double east;
};

/**
 * A viewport as supercluster normalizes a query bbox: latitudes clamped to
 * [-90, 90] and longitudes wrapped into [-180, 180]. A viewport that crosses
 * the antimeridian becomes two ranges, [west, 180] and [-180, east]; one that
 * spans 360 degrees or more becomes the whole world. Any non-finite bound,
 * infinities included, gives no range, so the query returns nothing (where
 * supercluster would read an infinite span as the whole world).
 */
struct NormalizedViewport {
  double south = 0.0;
  double north = 0.0;
  LongitudeRange ranges[2] = {};
  int rangeCount = 0;
};

inline NormalizedViewport normalizeViewport(const ViewportBounds& viewport) {
  NormalizedViewport normalized;
  if (!std::isfinite(viewport.south) || !std::isfinite(viewport.north) ||
      !std::isfinite(viewport.west) || !std::isfinite(viewport.east)) {
    return normalized;
  }
  normalized.south = clamp(viewport.south, -90.0, 90.0);
  normalized.north = clamp(viewport.north, -90.0, 90.0);

  if (viewport.east - viewport.west >= 360.0) {
    normalized.ranges[0] = {-180.0, 180.0};
    normalized.rangeCount = 1;
    return normalized;
  }

  // An east edge of exactly 180 stays 180 rather than wrapping to -180.
  const double west = wrapLongitude(viewport.west);
  const double east = viewport.east == 180.0 ? 180.0 : wrapLongitude(viewport.east);
  if (west <= east) {
    normalized.ranges[0] = {west, east};
    normalized.rangeCount = 1;
  } else {
    normalized.ranges[0] = {west, 180.0};
    normalized.ranges[1] = {-180.0, east};
    normalized.rangeCount = 2;
  }
  return normalized;
}

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
