#pragma once

#include <NitroModules/ArrayBuffer.hpp>
#include <NitroModules/CachedProp.hpp>
#include <memory>

namespace margelo::nitro::nitromapcluster {

/**
 * JS-originated ArrayBuffers are only safe to read on the JS thread.
 * Fabric passes props to native on the main thread, so copy non-owning
 * buffers while still on the JS thread during prop parsing.
 */
inline CachedProp<std::shared_ptr<ArrayBuffer>> owningArrayBufferProp(
    CachedProp<std::shared_ptr<ArrayBuffer>> prop) {
  if (prop.isDirty && prop.value != nullptr && !prop.value->isOwner()) {
    CachedProp<std::shared_ptr<ArrayBuffer>> owned;
    owned.value = ArrayBuffer::copy(prop.value);
    owned.isDirty = true;
    return owned;
  }
  return prop;
}

} // namespace margelo::nitro::nitromapcluster
