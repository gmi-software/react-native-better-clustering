#!/usr/bin/env bash
# Builds cpp/HybridClusterEngine.test.cpp against Nitro's C++ runtime and React
# Native's JSI from node_modules, then runs it under sanitizers.
#
# Usage (from package/): bun run test:native [sanitizers]
#   sanitizers defaults to "address,undefined"; pass "thread" for TSan.
set -euo pipefail

cd "$(dirname "$0")/.."

SANITIZERS=${1:-address,undefined}
CXX=${CXX:-c++}

resolve_package() {
  node -p "require('path').dirname(require.resolve('$1/package.json'))"
}
NITRO=$(resolve_package react-native-nitro-modules)
JSI=$(resolve_package react-native)/ReactCommon/jsi
SPECS=nitrogen/generated/shared/c++

if [ ! -f "$SPECS/HybridClusterEngineSpec.cpp" ]; then
  echo "Missing $SPECS: run 'bun run specs' first." >&2
  exit 1
fi

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

# Apps include Nitro as <NitroModules/...> from one flat header directory.
mkdir -p "$WORK/include/NitroModules"
find "$NITRO/cpp" -name '*.hpp' -exec ln -s {} "$WORK/include/NitroModules/" \;

SOURCES=(cpp/HybridClusterEngine.test.cpp cpp/HybridClusterEngine.cpp "$SPECS/HybridClusterEngineSpec.cpp" "$JSI/jsi/jsi.cpp")
while IFS= read -r source; do
  SOURCES+=("$source")
done < <(find "$NITRO/cpp" -name '*.cpp' ! -name InstallNitro.cpp)

# Nitro's NitroTypeInfo.cpp uses std::unordered_map without including it, which
# only libc++ forgives; -include lets it build against libstdc++ on Linux too.
"$CXX" -std=c++20 -g -O1 -pthread \
  -include unordered_map \
  -fsanitize="$SANITIZERS" -fno-sanitize-recover=all -fno-omit-frame-pointer \
  -Icpp -I"$SPECS" -I"$WORK/include" -I"$WORK/include/NitroModules" -I"$JSI" \
  "${SOURCES[@]}" -o "$WORK/hybrid_test"

"$WORK/hybrid_test"
