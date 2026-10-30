# Android emulator, 29 October 2026

The live phase on Android, with the same code as the [iOS Simulator run of 30 October](../ios-simulator-2026-10-30/README.md). It runs react-native-map-clustering 4.0.0 and react-native-better-clustering at `main@a3ff7a6`, and this library with #126's JS (31afbc7) and the engine branch `perf/skip-bound-reach` (d8725fc), neither merged when this ran.

- Device: Android emulator, AVD `Clustering_API35` (`sdk_gphone64_arm64`, Android 15, arm64-v8a), on an Apple M5 Pro Mac. Google Maps used a real API key, which is not in the repository.
- Builds: the example app in Release (Hermes), `-PreactNativeArchitectures=arm64-v8a`, with the benchmark from branch `chore/bench-live-phase`. The second build has `EXPO_PUBLIC_BENCH_RNBC_VERSION="main + #126 + engine"`.
- Runs: 3 rounds. Each round ran every size for react-native-map-clustering, `main` and `main + #126 + engine`, so the two builds of this library saw the same host. Every run started on a freshly cold-booted emulator. In a first attempt without reboots, the emulator slowed down within three runs: a run took 7–9 minutes instead of 2, and its live phase showed 14 updates instead of 80. The host's 1-minute load average before a run had a median of 4.8, from 3.4 to 31.8. All 27 runs passed.
- This run predates hiding the map from accessibility (see `example/bench/README.md`), so Maestro's polling walked the map's accessibility tree meanwhile. On iOS, hiding it changed no live-phase result beyond the spread between runs; on Android its cost was not measured.
- `android-main.json` (react-native-map-clustering and `main`) and `android-branches.json` are the raw data, one report per build, merged from one run per call.

Medians of the 3 runs (`node bench/summarize.mjs bench/results/android-emulator-2026-10-29/*.json`):

| Markers | Library | Version | Runs | First markers (ms) | Longest JS freeze, mount (ms) | Memory after mount (+MB) | JS blocked, 10 re-renders (ms) | Remounts, 10 re-renders | Fewest on map, re-renders | JS blocked, zoom (ms) | Markers rendered at zoom 8 | Pressed cluster (points) | Press to camera settled (ms) | Longest JS freeze, press (ms) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 10,000 | react-native-better-clustering | main + #126 + engine | 3 | 211.1 | 142.2 | 45.9 | 0 | 0 | 46 | 57.2 | 101 | 503 | 1,221.7 | 120.6 |
| 10,000 | react-native-better-clustering | main | 3 | 265.4 | 179.8 | 37.6 | 5.7 | 0 | 46 | 370.8 | 98 | 503 | 1,420.2 | 387.9 |
| 10,000 | react-native-map-clustering | 4.0.0 | 3 | 409.4 | 366.5 | 46.9 | 7,873.1 | 0 | 46 | 754.8 | 182 | 469 | 1,250.4 | 35.9 |
| 50,000 | react-native-better-clustering | main + #126 + engine | 3 | 331.7 | 163.1 | 98.5 | 3,874 | 0 | 46 | 785.4 | 100 | 2,638 | 1,288.5 | 404 |
| 50,000 | react-native-better-clustering | main | 3 | 446.3 | 204.1 | 103.7 | 1,516.5 | 0 | 46 | 165.8 | 100 | 2,638 | 1,226 | 105.8 |
| 50,000 | react-native-map-clustering | 4.0.0 | 3 | 1,640 | 1,553.1 | 120.6 | 13,823.5 | 0 | 46 | 843.5 | 185 | 2,638 | 1,235 | 39.3 |
| 100,000 | react-native-better-clustering | main + #126 + engine | 3 | 496.6 | 300.3 | 145.6 | 3,486.1 | 0 | 46 | 482.2 | 99 | 4,558 | 1,285.7 | 211.8 |
| 100,000 | react-native-better-clustering | main | 3 | 582.4 | 195.3 | 155.2 | 3,290.3 | 0 | 46 | 576.4 | 99 | 4,558 | 1,294.3 | 209.8 |
| 100,000 | react-native-map-clustering | 4.0.0 | 3 | 3,170.7 | 3,025.4 | 167.8 | 61,485.9 | 0 | 47 | 3,795.1 | 175 | 4,558 | 1,406.1 | 158.4 |

The live phase:

| Markers | Library | Version | Runs | Age of the map, mean (ms) | Updates shown (of 100) | Lag, median (ms) | Lag, max (ms) | Last update shown after (ms) | Index builds | JS blocked, live (ms) | Longest JS freeze, live (ms) | Dropped JS frames, live | Memory after live (+MB) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 10,000 | react-native-better-clustering | main + #126 + engine | 3 | 139.5 | 80 | 31.5 | 62.1 | 29.6 | 100 | 0 | 41.6 | 3 | 80.4 |
| 10,000 | react-native-better-clustering | main | 3 | 244.8 | 79 | 144.6 | 240.5 | 108.3 | 99 | 46 | 67.4 | 87 | 82.4 |
| 10,000 | react-native-map-clustering | 4.0.0 | 3 | 500.3 | 12 | 66.8 | 471.1 | 471.1 | 13 | 10,208.7 | 993.3 | 656 | 159.2 |
| 50,000 | react-native-better-clustering | main + #126 + engine | 3 | 496.9 | 35 | 283.2 | 441.3 | 105.3 | 51 | 556.2 | 120.7 | 173 | 289.8 |
| 50,000 | react-native-better-clustering | main | 3 | 427 | 44 | 258.4 | 467.3 | 369.9 | 58 | 273 | 128.9 | 166 | 306.2 |
| 50,000 | react-native-map-clustering | 4.0.0 | 3 | 1,184.7 | 5 | 164.4 | 487.8 | 487.8 | 6 | 11,887.2 | 2,157 | 744 | 586.7 |
| 100,000 | react-native-better-clustering | main + #126 + engine | 3 | 336.2 | 55 | 196.8 | 303.6 | 226.7 | 77 | 51.9 | 69 | 95 | 617.7 |
| 100,000 | react-native-better-clustering | main | 3 | 773.1 | 21 | 427 | 757.1 | 490.3 | 31 | 1,468.1 | 131 | 321 | 665.2 |
| 100,000 | react-native-map-clustering | 4.0.0 | 3 | 5,344.8 | 1 | 789.5 | 1,528 | 1,528 | 2 | 20,485.4 | 9,918.8 | 1,223 | 1,012.7 |

The age of the map in each run of the live phase, in ms, since a median of 3 hides how far apart they are:

| Markers | Library and version | Round 1 | Round 2 | Round 3 |
| --- | --- | --- | --- | --- |
| 10,000 | react-native-map-clustering 4.0.0 | 500 | 184 | 541 |
| 10,000 | react-native-better-clustering main | 245 | 254 | 150 |
| 10,000 | react-native-better-clustering main + #126 + engine | 140 | 137 | 140 |
| 50,000 | react-native-map-clustering 4.0.0 | 1,185 | 1,845 | 946 |
| 50,000 | react-native-better-clustering main | 339 | 427 | 901 |
| 50,000 | react-native-better-clustering main + #126 + engine | 198 | 497 | 510 |
| 100,000 | react-native-map-clustering 4.0.0 | 5,345 | 1,714 | 5,714 |
| 100,000 | react-native-better-clustering main | 3,074 | 717 | 773 |
| 100,000 | react-native-better-clustering main + #126 + engine | 326 | 1,735 | 336 |

## Reading it

- **Runs are fast or slow, and a slow run is slow in every phase.** Even on a freshly booted emulator, with the host's load average near 4–6, some runs were slower in every phase, not only the live one. For example, in round 3 at 50,000, `main` blocked JS for 4.2 s in the re-render phase and 1.1 s while zooming; in round 1 it blocked it for 0.9 s and 0.1 s. That points at the emulator, not at the library, and it decides some medians:
  - **10,000:** `main + #126 + engine` keeps the map 137–140 ms old in all three runs, against 150–254 ms for `main`.
  - **100,000:** `main + #126 + engine` keeps it 326 and 336 ms old in two runs and 1.7 s in a slow one. `main` keeps it 717 ms, 773 ms and 3.1 s old.
  - **50,000:** the runs overlap (198–510 ms against 339–901 ms), so three runs can't separate the builds. The iOS Simulator, whose runs varied far less, can: 177 against 348 ms.
- **Updates shown.** As on iOS, the benchmark sees an update only on a vehicle's own marker, not in a cluster bubble, so no library can show all 100: in some updates every vehicle sits in a bubble.
- **react-native-map-clustering** blocks JS for 8–20 s of the live phase and shows 1–39 of the 100 updates. Its map is on average 0.2–0.5 s old at 10,000, 0.9–1.8 s at 50,000 and 1.7–5.7 s at 100,000. In its 100,000-marker runs, the 10 re-renders alone block JS for 30–93 s.
- **Memory** is the app's total PSS (`dumpsys meminfo`), which is not comparable with iOS's `phys_footprint`.
- An emulator runs on the Mac's CPU through virtualization, and its graphics through the host GPU, so neither its absolute times nor its run-to-run spread are a phone's. Compare the libraries and builds within this run.
