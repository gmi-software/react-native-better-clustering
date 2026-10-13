# Core benchmark

A reproducible benchmark of the C++ clustering core (`package/cpp/ClusterEngineCore.hpp`), and the CI gate that keeps it from regressing. Nothing here is published to npm or compiled into an app.

It measures the engine alone, on a desktop CPU. It says nothing about Hermes, the JS layer or rendering on a phone, so it can neither back nor refute a claim about app performance.

| File | Role |
| --- | --- |
| `datasets.hpp` | The seeded datasets |
| `bench.cpp` | The harness: measures one (dataset, size) case per process and prints JSON |
| `run.mjs` | Compiles the harness, runs every case and writes one report (`bun run bench`) |
| `compare.mjs` | Compares two reports and applies the gate (`bun run bench:compare`) |
| `baseline.json` | The committed reference report |

## Running it

From `package/`:

```bash
bun run bench                                      # every dataset and size → bench/results/latest.json
bun run bench --quick                              # fewer timing samples
bun run bench --datasets city,grid --sizes 10000   # a subset
bun run bench --mode count                         # instruction counts (Linux with valgrind)
bun run bench:compare base.json head.json          # the gate, as CI runs it
```

`run.mjs` takes `--mode time|count|all`, `--datasets`, `--sizes`, `--cpp <dir>` (the engine headers to measure), `--src <dir>` (the harness to compile), `--out <file>` (`-` for stdout), `--label` and `--jobs`. It compiles with `$CXX` (default `c++`) and `-std=c++20 -O2 -DNDEBUG`. It exits 3 when the harness cannot be used with the engine (it does not compile against it, or it predates `run.mjs`), 2 on a usage error and 1 on any other failure.

Instruction counts need valgrind, which does not run on macOS on Apple silicon. On a Mac, run them in a Linux container (an arm64 container counts different instructions from the x86-64 CI runner, so compare only runs from the same machine):

```bash
docker run --rm -v "$PWD":/repo -w /repo/package ubuntu:24.04 \
  bash -c 'apt-get update && apt-get install -y g++ valgrind nodejs && node bench/run.mjs --mode count'
```

## What it measures

### Datasets

Six seeded datasets, each at 100, 1k, 5k, 10k, 50k and 100k points. They are generated, not stored: the generator, the seed and the hash of the output pin the same points, without megabytes of fixtures in the repository. Every coordinate is `A + B / C` with integer `B` and `C`: a correctly rounded division and addition, so it is bit-identical on any IEEE-754 platform, and a JavaScript port of `datasets.hpp` can reproduce the same points and `datasetHash`.

| Dataset | Points | Viewports centred on |
| --- | --- | --- |
| `uniform` | The world between 60°S and 60°N | 0°, 0° |
| `city` | One metropolitan area, denser towards the centre | Its centre |
| `blobs` | 24 seeded clusters with spreads from 0.05° to 2° | The first cluster |
| `identical` | Every point at one coordinate: a cluster that never splits | That coordinate |
| `grid` | A square lattice with about 100 m spacing | Its centre |
| `antimeridian` | The South Pacific from 170°E to 170°W | 180°, so the viewport wraps |

### Engine configuration

The compat `MapView` with default props on a 390 × 844 pt phone: `radius` 23.4 (window width × 0.06), `minZoom` 1, `maxZoom` 20, `extent` 512, `nodeSize` 64, `minPoints` 2. A query at cluster zoom `z` uses the bounds that `MapView` sends for that phone: 390 × 844 pixels of 256-pt tiles at zoom `z`, with longitudes left unwrapped as `regionToBBox` leaves them. Every report records this as `config`.

### Operations

| Operation | What it runs |
| --- | --- |
| `build` | `setPointsFromBuffer` (the packed buffer the Nitro module receives) and `build`, on a fresh engine |
| `clusters_z4`, `_z8`, `_z12`, `_z16` | `getClusters` for the phone viewport at that cluster zoom |
| `leaves_top` | `getLeaves` of the top cluster, unlimited: the cluster with the most points at `minZoom` (ties go to the smallest leaf id) |
| `expansion_top` | `getClusterExpansionZoom` of the top cluster |
| `zoom_sweep` | `getClusters` at every zoom from `minZoom` to `maxZoom`, like a zoom-in animation |

Each operation records its `result` (points indexed, nodes returned, or the zoom), so a change in behaviour shows up next to a change in cost.

### Metrics

| Metric | How | Deterministic |
| --- | --- | --- |
| `time` | Wall time per call: `medianNs`, `p95Ns`, `madNs` (median absolute deviation), `minNs`. Fast calls are batched so a sample lasts at least 50 µs. | No |
| `instructions` | Instructions executed, from callgrind, between a counter reset and a dump around one call | Yes, for one compiler and standard library |
| `allocationCount`, `allocationBytes` | Every global `operator new` during one call | Yes, likewise |
| `memorySize` | `ClusterEngineCore::memorySize()` after `build`, per case | Yes, likewise |
| `peakRssBytes` | The process's peak resident set after one engine is built, per case | Roughly |

## The CI gate

`.github/workflows/bench.yml` runs on pull requests that touch `package/cpp/`, `package/bench/` or the workflow. On one `ubuntu-24.04` runner it compiles the head's harness against the base engine (the commit the pull request's test merge was made onto) and against the head engine, runs both with `--mode all`, and compares them with `compare.mjs`.

When the head's harness cannot be used with the base engine (`run.mjs` exits 3), the base is measured with its own harness instead. If that cannot be used either, the report says there is no base to compare with and the check passes with a warning. Any other failure, a crash for example, fails the job. `compare.mjs` compares nothing, and says so, when the two reports have different `config`s: different harnesses can measure differently even on the same points.

For every operation of every case with **at least 10,000 points**:

| Metric | Fails above | Warns above | Ignored below |
| --- | --- | --- | --- |
| `instructions` | +5% | +2% | 10,000 instructions |
| `allocationCount` | +10% | +2% | 16 allocations |
| `allocationBytes` | +10% | +2% | 64 KiB |
| `memorySize` (per case) | +10% | +2% | 64 KiB |

The absolute floors keep a handful of instructions on a query that returns nothing from failing a pull request. Some viewport queries do return nothing, because the data is too sparse for a phone's view at that zoom (`uniform` at zooms 12 and 16, `antimeridian` at 16, `blobs` at 16 up to 50k points), so those stay below the floors and are never gated. Smaller cases are listed but never fail. Wall time and peak RSS are reported and never gated, since shared runners make them noisy.

The results are written to the job summary and posted as one comment on the pull request, updated on every push. Long lists are cut to fit GitHub's comment size limit. The comment comes from a separate job, `comment`, which checks out nothing and runs no code from the pull request: the job that does, `core`, only has a read-only token. Pull requests from forks get a read-only token in both, so for them only the job summary has the results. The `bench-core` artifact holds `base.json`, `head.json` and `summary.md`.

The workflow is not a required status check: a required check that a `paths:` filter skips stays pending and blocks the pull request (the same reason as for `native.yml`).

## The baseline

`baseline.json` is the reference report the gate's numbers can be read against over time. The gate itself always compares base with head on the same runner, so the baseline never decides whether a pull request passes.

Its `environment` says where it was measured. A report with `runner: local` comes from a developer machine and has no instruction counts; replace it with one from CI.

To refresh it:

1. Take `head.json` from the `bench-core` artifact of a `Bench` run on `main` (or run the workflow by hand on `main`).
2. Copy it over `package/bench/baseline.json`, in a pull request of its own.
3. Label the pull request `bench-baseline`. Without the label, `.github/workflows/bench-baseline.yml` fails any pull request that changes the file.

Refresh it after an intended change in cost, such as an engine optimization, or when the runner image changes.
