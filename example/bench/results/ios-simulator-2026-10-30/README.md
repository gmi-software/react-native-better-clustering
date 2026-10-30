# iOS Simulator, 30 October 2026

The device benchmark's **live** phase (see `example/bench/README.md`): 20 vehicles move over the markers 10 times a second, at street level in Kraków. It compares react-native-map-clustering 4.0.0 with react-native-better-clustering at `main@a3ff7a6`, and with a second build of this library that carries two changes for live updates: #126 and the engine changes of #128.

- Device: iOS Simulator, iPhone 17 Pro (`IP 17 Pro 26.5 (1)`), iOS 26.5, on an Apple M5 Pro Mac (Xcode 27.1).
- Builds: the example app in Release (Hermes), `ARCHS=arm64`, with the benchmark from branch `chore/bench-live-phase`, which hides the map from accessibility.
  - `main`: react-native-map-clustering and this library at `main@a3ff7a6`, in one build.
  - `main + #126 + engine`: the same app with this library's `package/src` at `main@f5c4d32`, where #126 landed, and its `package/cpp` from #128 (`perf/skip-bound-reach`, cc222e8), which was not merged when this ran. Built with `EXPO_PUBLIC_BENCH_RNBC_VERSION="main + #126 + engine"`, and run for this library only.
- Runs: 3 rounds per build, interleaved within each build. The second build ran first, then the first. All 27 runs passed. Another project's Android emulator ran on the Mac; its load average was between 6 and 10.
- It replaces a run of 29 October with the same builds, made while the map was still visible to accessibility. Its live-phase medians fall within the spread of these runs; its press-to-camera-settled times do not (see below).
- `ios-main.json` and `ios-branches.json` are the raw data.

Medians of the 3 runs (`node bench/summarize.mjs bench/results/ios-simulator-2026-10-30/*.json`):

| Markers | Library | Version | Runs | First markers (ms) | Longest JS freeze, mount (ms) | Memory after mount (+MB) | JS blocked, 10 re-renders (ms) | Remounts, 10 re-renders | Fewest on map, re-renders | JS blocked, zoom (ms) | Markers rendered at zoom 8 | Pressed cluster (points) | Press to camera settled (ms) | Longest JS freeze, press (ms) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 10,000 | react-native-better-clustering | main + #126 + engine | 3 | 217.6 | 29.4 | 110.6 | 0 | 0 | 47 | 0 | 102 | 475 | 1,059.3 | 28.8 |
| 10,000 | react-native-better-clustering | main | 3 | 219.4 | 31.2 | 110.4 | 0 | 0 | 47 | 0 | 102 | 475 | 1,053.1 | 28.8 |
| 10,000 | react-native-map-clustering | 4.0.0 | 3 | 370.8 | 365.4 | 124.8 | 2,970.5 | 0 | 47 | 7.6 | 613 | 475 | 1,079.3 | 37.6 |
| 50,000 | react-native-better-clustering | main + #126 + engine | 3 | 307.4 | 92 | 168.2 | 965.7 | 0 | 50 | 10.7 | 99 | 2,160 | 1,087.5 | 26.1 |
| 50,000 | react-native-better-clustering | main | 3 | 289.3 | 98.2 | 171.9 | 872.8 | 0 | 50 | 0 | 99 | 2,160 | 1,079.8 | 32.8 |
| 50,000 | react-native-map-clustering | 4.0.0 | 3 | 1,801.5 | 1,802.4 | 188.6 | 17,842.5 | 0 | 50 | 31.8 | 705 | 2,160 | 1,078.3 | 39.2 |
| 100,000 | react-native-better-clustering | main + #126 + engine | 3 | 432.3 | 210.4 | 237.4 | 2,906.4 | 0 | 50 | 0 | 97 | 4,450 | 1,136 | 25.2 |
| 100,000 | react-native-better-clustering | main | 3 | 503.5 | 191.6 | 252 | 3,017.4 | 0 | 50 | 0 | 97 | 4,450 | 1,130.9 | 28.7 |
| 100,000 | react-native-map-clustering | 4.0.0 | 3 | 3,634 | 3,634.9 | 262.5 | 36,212.5 | 0 | 51 | 64.9 | 724 | 4,450 | 1,095.7 | 48.9 |

The live phase:

| Markers | Library | Version | Runs | Age of the map, mean (ms) | Updates shown (of 100) | Lag, median (ms) | Lag, max (ms) | Last update shown after (ms) | Index builds | JS blocked, live (ms) | Longest JS freeze, live (ms) | Dropped JS frames, live | Memory after live (+MB) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 10,000 | react-native-better-clustering | main + #126 + engine | 3 | 107.4 | 83 | 28.4 | 47.3 | 28.3 | 100 | 0 | 22 | 0 | 396.1 |
| 10,000 | react-native-better-clustering | main | 3 | 119.2 | 83 | 41 | 49.6 | 39.8 | 100 | 0 | 17.2 | 0 | 395.2 |
| 10,000 | react-native-map-clustering | 4.0.0 | 3 | 226.8 | 30 | 59.1 | 356.3 | 275.7 | 30 | 9,019.9 | 380.6 | 604 | 521.4 |
| 50,000 | react-native-better-clustering | main + #126 + engine | 3 | 181.5 | 74 | 70.6 | 99.7 | 72.6 | 100 | 0 | 36.5 | 7 | 729.9 |
| 50,000 | react-native-better-clustering | main | 3 | 313.2 | 63 | 193.1 | 280.9 | 217.5 | 82 | 21.6 | 69.4 | 75 | 729.6 |
| 50,000 | react-native-map-clustering | 4.0.0 | 3 | 1,024.5 | 7 | 133.7 | 1,951.5 | 1,284.4 | 7 | 12,613.8 | 1,952 | 770 | 988.9 |
| 100,000 | react-native-better-clustering | main + #126 + engine | 3 | 317.1 | 62 | 198.8 | 293.6 | 262.7 | 84 | 74.1 | 69.6 | 95 | 1,107.3 |
| 100,000 | react-native-better-clustering | main | 3 | 689.5 | 24 | 403.9 | 695.7 | 538.2 | 31 | 1,297.4 | 279.2 | 317 | 1,234.8 |
| 100,000 | react-native-map-clustering | 4.0.0 | 3 | 2,057.2 | 4 | 1,751.7 | 3,738.1 | 1,751.7 | 4 | 15,299.2 | 3,977.5 | 926 | 1,234.9 |

## Reading it

- **Live updates, react-native-map-clustering.** It rebuilds its index with `supercluster.load()` on the JS thread whenever its children change. At 50,000 markers that blocks JS for 12.6 s of the phase, so its timer gets to send 7 of the 100 updates. The map is then on average 1.0 s old, and 2.1 s at 100,000.
- **Live updates, `main`.** This library builds its index natively, and JS stays all but free at 10,000 and 50,000 markers. At 50,000 it builds 82 of the 100 updates, and the map averages 313 ms old. At 100,000 it builds 31, the map averages 690 ms old and JS is blocked for 1.3 s: the builds can't keep up with the feed, so updates queue behind them.
- **Live updates, `main + #126 + engine`.** Every update gets its own build at 10,000 and 50,000, and 84 do at 100,000. The map is on average 182 ms old at 50,000 (313 on `main`) and 317 ms at 100,000 (690). The median lag is 71 ms (193 on `main`) at 50,000 and 199 ms (404) at 100,000.
- **Updates shown.** The benchmark sees an update only on a vehicle's own marker, not in a cluster bubble. Clusters here are computed for zoom 10 while the camera is at 12, and in 17 of the 100 updates at 10,000 markers every vehicle sits in a bubble, and in 26 at 50,000 and 100,000 (supercluster 8.0.1 on the same points). So no library can show more than 83 and 74. While every vehicle is in a bubble, the age of the map keeps counting from the last update a vehicle showed.
- **Static markers keep their elements in the live phase.** A first version of this phase recreated all of them on every update. Both builds of this library then spent 8–10 s of the phase re-reading 50,000–100,000 new elements on the JS thread, as in the re-render phase. #126's caches key on element identity, so they couldn't help. Recreating every element is what the re-render phase measures.
- **Memory after live** is measured from before the mount, so it includes the map's street-level tiles from the zoom, press and live phases. Most of that growth is already there before the live phase starts.
- **Press to camera settled** took 1.04–1.17 s in every run of every library. In the 29 October run, with the map visible to accessibility, this library's runs took 1.08–1.88 s and react-native-map-clustering's 1.06–1.14 s.
- A simulator runs on the Mac's CPU, faster than a phone's: compare the libraries and builds, not the absolute times with a device.
