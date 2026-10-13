#pragma once

#include "ClusterEngineCore.hpp"
#include <cstddef>
#include <cstdint>
#include <memory>
#include <mutex>

namespace margelo::nitro::nitromapcluster {

// Thread-safe front for ClusterEngineCore, which is single-threaded. JS calls
// arrive on the JS thread while buildAsync() builds on Nitro's thread pool.
//
// No core is mutated once another thread can see it: setOptions/setPoints
// publish a new core under the mutex, and a build works on a private copy and
// publishes the result. A snapshot is therefore immutable and safe to query
// without the lock, even after later calls replace it.
class ThreadSafeClusterEngine {
public:
  using Snapshot = std::shared_ptr<const ClusterEngineCore>;

  /** Throws `std::invalid_argument` for an invalid config, leaving the engine unchanged. */
  void setOptions(const ClusterEngineConfig& options) {
    std::lock_guard lock(_mutex);
    auto next = std::make_shared<ClusterEngineCore>(_current->withoutIndex());
    next->setOptions(options);
    _current = std::move(next);
  }

  /** Returns false when the buffer layout is invalid (the points are cleared). */
  bool setPointsFromBuffer(const uint8_t* data, size_t byteLength) {
    std::lock_guard lock(_mutex);
    auto next = std::make_shared<ClusterEngineCore>();
    next->setOptions(_current->options());
    const bool loaded = next->setPointsFromBuffer(data, byteLength);
    _current = std::move(next);
    return loaded;
  }

  /** The current options, points and, once built, index. */
  Snapshot snapshot() const {
    std::lock_guard lock(_mutex);
    return _current;
  }

  /**
   * Builds an index from `input` and publishes it, unless a call to
   * setOptions, setPoints or another build replaced `input` in the meantime:
   * the result is then stale and is dropped. Safe to call on any thread.
   */
  void build(const Snapshot& input) {
    auto built = std::make_shared<ClusterEngineCore>(input->withoutIndex());
    built->build();
    std::lock_guard lock(_mutex);
    // `input` keeps its core alive, so no newer core can reuse its address.
    if (_current == input) {
      _current = std::move(built);
    }
  }

  void build() {
    build(snapshot());
  }

private:
  mutable std::mutex _mutex;
  Snapshot _current = std::make_shared<const ClusterEngineCore>();
};

} // namespace margelo::nitro::nitromapcluster
