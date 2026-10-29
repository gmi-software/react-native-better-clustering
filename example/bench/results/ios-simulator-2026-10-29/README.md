# iOS Simulator, 29 October 2026

The first run of the device benchmark's **live** phase (see `example/bench/README.md`): 20 vehicles move over the markers 10 times a second, at street level in Kraków. It compares react-native-map-clustering 4.0.0 with react-native-better-clustering at `main@a3ff7a6`, and with a second build of this library that carries two unmerged changes for live updates.

- Device: iOS Simulator, iPhone 17 Pro (`IP 17 Pro 26.5 (1)`), iOS 26.5, on an Apple M5 Pro Mac (Xcode 27.1).
- Builds: the example app in Release (Hermes), `ARCHS=arm64`, with the benchmark from branch `chore/bench-live-phase`.
  - `main`: react-native-map-clustering and this library at `main@a3ff7a6`, in one build.
  - `main + #126 + engine`: the same app with this library's `package/src` from `perf/live-update-js` (31afbc7, #126) and its `package/cpp` from `perf/skip-bound-reach` (d8725fc). Neither was merged when this ran. Built with `EXPO_PUBLIC_BENCH_RNBC_VERSION="main + #126 + engine"`, and run for this library only.
- Runs: 3 rounds per build, interleaved within each build. The second build ran first, then the first. All 27 runs passed. Another project's builds shared the Mac; its load average stayed between 3 and 7.
- `ios-main.json` and `ios-branches.json` are the raw data.

Medians of the 3 runs (`node bench/summarize.mjs bench/results/ios-simulator-2026-10-29/*.json`):

| Markers | Library | Version | Runs | First markers (ms) | Longest JS freeze, mount (ms) | Memory after mount (+MB) | JS blocked, 10 re-renders (ms) | Remounts, 10 re-renders | Fewest on map, re-renders | JS blocked, zoom (ms) | Markers rendered at zoom 8 | Pressed cluster (points) | Press to camera settled (ms) | Longest JS freeze, press (ms) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 10,000 | react-native-better-clustering | main + #126 + engine | 3 | 218.7 | 27.9 | 112 | 0 | 0 | 47 | 0 | 102 | 475 | 1,739.9 | 26.6 |
| 10,000 | react-native-better-clustering | main | 3 | 222.2 | 35.6 | 112.3 | 0 | 0 | 47 | 0 | 102 | 475 | 1,362.4 | 40.5 |
| 10,000 | react-native-map-clustering | 4.0.0 | 3 | 382.6 | 383.6 | 128.8 | 2,865.6 | 0 | 47 | 15.2 | 613 | 475 | 1,082.8 | 41.6 |
| 50,000 | react-native-better-clustering | main + #126 + engine | 3 | 250.2 | 94.5 | 168.9 | 833.2 | 0 | 50 | 0 | 99 | 2,160 | 1,444.3 | 31.4 |
| 50,000 | react-native-better-clustering | main | 3 | 264.2 | 103.6 | 180.4 | 1,035.5 | 0 | 50 | 51.6 | 99 | 2,160 | 1,087.4 | 38 |
| 50,000 | react-native-map-clustering | 4.0.0 | 3 | 1,884 | 1,884.9 | 191.2 | 17,754.2 | 0 | 50 | 38.9 | 705 | 2,160 | 1,083.6 | 36.3 |
| 100,000 | react-native-better-clustering | main + #126 + engine | 3 | 361.5 | 181.5 | 246.4 | 2,856.7 | 0 | 50 | 0 | 97 | 4,450 | 1,429.8 | 30.7 |
| 100,000 | react-native-better-clustering | main | 3 | 466.9 | 196.7 | 252.7 | 2,844 | 0 | 50 | 74.6 | 97 | 4,450 | 1,470.4 | 44.8 |
| 100,000 | react-native-map-clustering | 4.0.0 | 3 | 3,741.2 | 3,742.2 | 268.1 | 36,168.9 | 0 | 51 | 100.9 | 724 | 4,450 | 1,131.5 | 54.3 |

The live phase:

| Markers | Library | Version | Runs | Age of the map, mean (ms) | Updates shown (of 100) | Lag, median (ms) | Lag, max (ms) | Last update shown after (ms) | Index builds | JS blocked, live (ms) | Longest JS freeze, live (ms) | Dropped JS frames, live | Memory after live (+MB) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 10,000 | react-native-better-clustering | main + #126 + engine | 3 | 105.6 | 83 | 26.8 | 33.2 | 26.8 | 100 | 0 | 17.8 | 0 | 396.7 |
| 10,000 | react-native-better-clustering | main | 3 | 117.8 | 83 | 40.3 | 47.8 | 41.4 | 100 | 0 | 35.1 | 1 | 392.7 |
| 10,000 | react-native-map-clustering | 4.0.0 | 3 | 224 | 31 | 60.8 | 357.5 | 157.2 | 31 | 8,833.9 | 360.1 | 591 | 519.5 |
| 50,000 | react-native-better-clustering | main + #126 + engine | 3 | 176.5 | 74 | 67.1 | 91 | 65.7 | 100 | 0 | 34.1 | 4 | 673.7 |
| 50,000 | react-native-better-clustering | main | 3 | 347.6 | 57 | 202.4 | 281.4 | 248.1 | 76 | 55.6 | 99.8 | 88 | 718.7 |
| 50,000 | react-native-map-clustering | 4.0.0 | 3 | 1,002.9 | 7 | 124.8 | 1,970.7 | 1,102 | 7 | 12,427.8 | 1,971.1 | 760 | 937.4 |
| 100,000 | react-native-better-clustering | main + #126 + engine | 3 | 302.3 | 64 | 188.8 | 283.9 | 224.5 | 88 | 77.2 | 92.9 | 88 | 1,191.5 |
| 100,000 | react-native-better-clustering | main | 3 | 591.3 | 29 | 382.8 | 512.8 | 512.8 | 37 | 826.6 | 153.9 | 281 | 1,201.9 |
| 100,000 | react-native-map-clustering | 4.0.0 | 3 | 1,935.7 | 4 | 1,138.8 | 3,636.1 | 1,138.8 | 4 | 14,426.6 | 3,682 | 874 | 1,177.3 |

## Reading it

- **Live updates, react-native-map-clustering.** It rebuilds its index with `supercluster.load()` on the JS thread whenever its children change. At 50,000 markers that blocks JS for 12.4 s of the phase, so its timer gets to send 7 of the 100 updates. The map is then on average 1.0 s old, and 1.9 s at 100,000.
- **Live updates, `main`.** This library builds its index natively and keeps JS free. At 50,000 it shows 57 updates, and the map averages 348 ms old. At 100,000 it shows 29 updates and the map averages 591 ms old: the builds can't keep up with the feed, so updates queue behind them.
- **Live updates, `main + #126 + engine`.** Every update gets its own build: 100 at 10,000 and 50,000, and 88 at 100,000. The map is on average 177 ms old at 50,000 and 302 ms at 100,000, half of `main`. The median lag is 67 ms (202 on `main`) at 50,000 and 189 ms (383) at 100,000.
- **Updates shown.** Even when every update is built, not every one is shown: when two builds land within one render, the map shows the newer one.
- **Static markers keep their elements in the live phase.** A first version of this phase recreated all of them on every update. Both builds of this library then spent 8–10 s of the phase re-reading 50,000–100,000 new elements on the JS thread, as in the re-render phase. #126's caches key on element identity, so they couldn't help. Recreating every element is what the re-render phase measures.
- **Memory after live** is measured from before the mount, so it includes the map's street-level tiles from the zoom, press and live phases. Most of that growth is already there before the live phase starts.
- **Press to camera settled** varies between 1.1 and 1.9 s from run to run, in both builds of this library. The 14 October results explain why. Three runs can't tell the builds apart on it.
- A simulator runs on the Mac's CPU, faster than a phone's: compare the libraries and builds, not the absolute times with a device.
