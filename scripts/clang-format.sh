#!/bin/bash

set -e

# Run from the repository root, whatever the caller's working directory is, so
# the config path below always resolves.
cd "$(dirname "$0")/.."

CPP_DIRS=(
  # shared C++ clustering core
  "package/cpp"
  # Android JNI adapter
  "package/android/src/main/cpp"
  # C++ micro-benchmark
  "package/bench"
)

# package/nitrogen is generated and git-ignored; it is never formatted here.

if which clang-format >/dev/null; then
  DIRS=$(printf "%s " "${CPP_DIRS[@]}")
  find $DIRS -type f \( -name "*.h" -o -name "*.hpp" -o -name "*.cpp" -o -name "*.mm" \) -print0 | while read -r -d '' file; do
    clang-format -style=file:./config/.clang-format -i "$file"
  done
  echo "C++ Format done!"
else
  echo "error: clang-format not installed, install with 'brew install clang-format' (or see https://clang.llvm.org/docs/ClangFormat.html)"
  exit 1
fi
