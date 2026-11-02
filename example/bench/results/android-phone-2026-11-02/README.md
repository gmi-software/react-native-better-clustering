# Android phone, 2 November 2026

The device benchmark on a real mid-range phone, the measurement #115 asked for. It compares react-native-map-clustering 4.0.0, this library at `main@db677a7`, and this library at `main@a3ff7a6`, before #126, #128, #129 and #131: the JS and engine work for live updates over many markers.

- Device: Realme 8 Pro (`RMX3081`), Snapdragon 720G (`SM7125`), Android 13, arm64-v8a, over USB. Google Maps used a real API key, which is not in the repository.
- Builds: the example app in Release (Hermes), `-PreactNativeArchitectures=arm64-v8a`, with the benchmark from `main@db677a7`. The second build has `package/src` and `package/cpp` from `a3ff7a6`, the app id `com.nitromapcluster.example.base` and `EXPO_PUBLIC_BENCH_RNBC_VERSION=a3ff7a6`. Its JS bundle and `libNitroMapCluster.so` differ from the first build's, so both the JS and the engine are the old ones.
- Runs: 3 rounds. Each round ran every size for react-native-map-clustering, `main` and `a3ff7a6`, one run per `run.mjs` call, with 45 s between runs. All 27 runs passed. The phone stayed plugged in with the screen on; its battery stayed between 28.7 and 29.8 °C, so it did not throttle. The host's load average (3.7–19) does not affect a phone the way it does an emulator.
- `android-main.json` (react-native-map-clustering and `main`) and `android-a3ff7a6.json` are the raw data, one report per build, merged from one run per call.

Medians of the 3 runs (`node bench/summarize.mjs bench/results/android-phone-2026-11-02/*.json`):

| Markers | Library | Version | Runs | First markers (ms) | Longest JS freeze, mount (ms) | Memory after mount (+MB) | JS blocked, 10 re-renders (ms) | Remounts, 10 re-renders | Fewest on map, re-renders | JS blocked, zoom (ms) | Markers rendered at zoom 8 | Pressed cluster (points) | Press to camera settled (ms) | Longest JS freeze, press (ms) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 10,000 | react-native-better-clustering | a3ff7a6 | 3 | 760.1 | 570.2 | 89 | 862 | 0 | 61 | 1,157.5 | 109 | 359 | 381.7 | 781.1 |
| 10,000 | react-native-better-clustering | main | 3 | 781.2 | 536.1 | 103.7 | 246.4 | 0 | 61 | 1,126.7 | 109 | 359 | 975.8 | 758.9 |
| 10,000 | react-native-map-clustering | 4.0.0 | 3 | 1,106.9 | 947.4 | 121.8 | 9,084.7 | 0 | 61 | 1,893.1 | 173 | 359 | 415.1 | 1,557.3 |
| 50,000 | react-native-better-clustering | a3ff7a6 | 3 | 1,166.3 | 683.1 | 152.7 | 4,510.5 | 0 | 64 | 2,284.7 | 107 | 1,825 | 389.1 | 1,529.9 |
| 50,000 | react-native-better-clustering | main | 3 | 1,070.8 | 582.6 | 134.8 | 1,220 | 0 | 64 | 2,239.9 | 107 | 1,825 | 967.9 | 894.2 |
| 50,000 | react-native-map-clustering | 4.0.0 | 3 | 5,457.6 | 5,215.3 | 152.7 | 52,584.8 | 0 | 63 | 4,675.9 | 183 | 1,825 | 461.3 | 1,769.7 |
| 100,000 | react-native-better-clustering | a3ff7a6 | 3 | 2,145.5 | 830.4 | 199.7 | 13,578.3 | 0 | 63 | 2,543.1 | 110 | 3,266 | 418.8 | 1,641.4 |
| 100,000 | react-native-better-clustering | main | 3 | 1,491 | 731.3 | 187.8 | 2,452.8 | 0 | 63 | 2,481.7 | 110 | 3,266 | 1,048 | 923.9 |
| 100,000 | react-native-map-clustering | 4.0.0 | 3 | 10,985.4 | 10,526.3 | 210.7 | 108,530.7 | 0 | 63 | 6,865.6 | 187 | 3,266 | 558.5 | 1,630.6 |

The live phase:

| Markers | Library | Version | Runs | Age of the map, mean (ms) | Updates shown (of 100) | Lag, median (ms) | Lag, max (ms) | Last update shown after (ms) | Index builds | JS blocked, live (ms) | Longest JS freeze, live (ms) | Dropped JS frames, live | Memory after live (+MB) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 10,000 | react-native-better-clustering | a3ff7a6 | 3 | 163.9 | 96 | 104.6 | 243.8 | 106 | 100 | 59.5 | 79.2 | 46 | 164.7 |
| 10,000 | react-native-better-clustering | main | 3 | 130.9 | 96 | 76.2 | 152.5 | 90.4 | 100 | 0 | 48.4 | 35 | 159.2 |
| 10,000 | react-native-map-clustering | 4.0.0 | 3 | 572.5 | 10 | 85.5 | 126.5 | 87.6 | 11 | 9,975.7 | 960.8 | 642 | 261.7 |
| 50,000 | react-native-better-clustering | a3ff7a6 | 3 | 1,027.4 | 18 | 764.6 | 999.1 | 999.1 | 20 | 3,467.8 | 135 | 451 | 427 |
| 50,000 | react-native-better-clustering | main | 3 | 444.2 | 42 | 305.9 | 378.4 | 283.2 | 49 | 243.2 | 86.9 | 154 | 225.9 |
| 50,000 | react-native-map-clustering | 4.0.0 | 3 | 2,835 | 2 | 1,037.6 | 1,037.6 | 1,037.6 | 3 | 15,830.3 | 5,233.9 | 972 | 618.2 |
| 100,000 | react-native-better-clustering | a3ff7a6 | 3 | 2,913.3 | 6 | 2,232.7 | 2,315.9 | 2,315.5 | 8 | 8,197.7 | 347.3 | 598 | 691.1 |
| 100,000 | react-native-better-clustering | main | 3 | 879.3 | 20 | 586.7 | 788.1 | 788.1 | 23 | 972.7 | 116.6 | 211 | 351.9 |
| 100,000 | react-native-map-clustering | 4.0.0 | 3 | 5,666.8 | 1 | 1,433.7 | 1,433.7 | 1,433.7 | 2 | 21,720.4 | 10,670.8 | 1,337 | 1,054.3 |

The age of the map in each run of the live phase, in ms:

| Markers | Library and version | Round 1 | Round 2 | Round 3 |
| --- | --- | --- | --- | --- |
| 10,000 | react-native-map-clustering 4.0.0 | 573 | 570 | 575 |
| 10,000 | react-native-better-clustering a3ff7a6 | 162 | 171 | 164 |
| 10,000 | react-native-better-clustering main | 131 | 133 | 128 |
| 50,000 | react-native-map-clustering 4.0.0 | 2,859 | 2,835 | 2,834 |
| 50,000 | react-native-better-clustering a3ff7a6 | 1,015 | 1,027 | 1,119 |
| 50,000 | react-native-better-clustering main | 436 | 458 | 444 |
| 100,000 | react-native-map-clustering 4.0.0 | 5,634 | 5,667 | 5,676 |
| 100,000 | react-native-better-clustering a3ff7a6 | 2,776 | 2,941 | 2,913 |
| 100,000 | react-native-better-clustering main | 879 | 844 | 891 |

## Reading it

- **Runs on the phone agree.** Unlike the [emulator's](../android-emulator-2026-10-29/README.md), whose runs were fast or slow as a whole, the age of the map varies by at most 10% between rounds. Three runs separate the builds at every size.
- **Live updates.** Compared with `a3ff7a6`, `main` keeps the map 2.3× younger at 50,000 markers (444 against 1,027 ms) and 3.3× at 100,000 (879 against 2,913 ms). It blocks JS for 243 ms of the 10 s phase at 50,000 (against 3.5 s) and 973 ms at 100,000 (against 8.2 s), and builds the index 49 and 23 times (against 20 and 8). With JS mostly free, a build cycle takes about 200 ms at 50,000 and 430 ms at 100,000: the native build, not JS, now limits how many updates reach the map.
- **Re-renders.** 10 re-renders with every marker created again block JS for 1.2 s at 50,000 and 2.5 s at 100,000 on `main`, against 4.5 s and 13.6 s on `a3ff7a6` (#126, #129).
- **react-native-map-clustering** blocks JS for 10–22 s of the live phase and shows 1–10 of the 100 updates. 10 re-renders block it for 53 s at 50,000 markers and 109 s at 100,000.
- **Press to camera settled is bimodal, and it is not a regression.** Per run, every build of this library takes either about 400 ms or 900–2,100 ms from the press to `onRegionChangeComplete`: `a3ff7a6` was slow in 2 of 9 runs, `main` in 7 of 9. The metric times when JS receives the event, not when the camera stops. A timeline logged in two more runs of each build (10,000 markers, temporary logging, not committed) shows both modes in both builds:
  - Fast: the camera reports moves until about 270 ms, `onRegionChangeComplete` arrives at about 380 ms, and then JS is blocked for 1.3 s while the bubbles of the new region mount.
  - Slow: a cluster update that `clusterUpdateIntervalMs` lets through during the animation, at about 360 ms, blocks JS for about 530 ms. `onRegionChangeComplete` waits behind it until about 990 ms, and the final update then blocks JS for another 0.7–0.75 s.

  JS is free again after 1.65–1.8 s either way. Over the press window in the 27 runs, the slow runs of a size blocked JS for about as long in total as its fast ones (at 10,000: 1.1–1.3 s against 1.3–1.4 s), and in most of them its longest freeze was shorter, since the work comes in two parts. Which mode a run lands in depends on whether the last update during the animation starts before the camera stops. react-native-map-clustering recomputes its clusters only once the camera stops, so it took 411–573 ms in every run. On the 29 October emulator, the medians were 1.2–1.4 s for every library and build.
- **Memory** is the app's total PSS (`dumpsys meminfo`), comparable between these builds but not with iOS's `phys_footprint`.
