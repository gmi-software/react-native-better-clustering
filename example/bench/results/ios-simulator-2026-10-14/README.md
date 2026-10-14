# iOS Simulator, 14 October 2026

The first run of the device benchmark (`example/bench/`): react-native-map-clustering 4.0.0 (supercluster 8.0.1), react-native-better-clustering 1.0.0 from npm, and react-native-better-clustering at `main@386d286`, the 1.1.0 release candidate.

- Device: iOS Simulator, iPhone 17 Pro, iOS 26.5, on an Apple M5 Pro Mac (Xcode 27.0).
- Builds: the example app in Release (Hermes), `ARCHS=arm64`. react-native-map-clustering and `main` ran in one build; 1.0.0 in a second build linked against the npm tarball, as `example/bench/README.md` describes.
- Runs: 5 rounds, interleaved: each round ran every size of both libraries in the first build, then every size of 1.0.0. All 45 runs passed. The `ios-main-r*.json` and `ios-v100-r*.json` reports are the raw data.

Medians of the 5 runs (`node bench/summarize.mjs bench/results/ios-simulator-2026-10-14/*.json`):

| Markers | Library | Version | Runs | First markers (ms) | Longest JS freeze, mount (ms) | Memory after mount (+MB) | JS blocked, 10 re-renders (ms) | Remounts, 10 re-renders | Fewest on map, re-renders | JS blocked, zoom (ms) | Markers rendered at zoom 8 | Pressed cluster (points) | Press to camera settled (ms) | Longest JS freeze, press (ms) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 10,000 | react-native-better-clustering | 1.1.0 (main) | 5 | 193.2 | 27.4 | 104.3 | 0 | 0 | 47 | 0 | 184 | 475 | 1,605.1 | 26.7 |
| 10,000 | react-native-better-clustering | 1.0.0 | 5 | 175.5 | 27.1 | 116.8 | 0 | 470 | 0 | 0 | 184 | 475 | 1,594.1 | 27.6 |
| 10,000 | react-native-map-clustering | 4.0.0 | 5 | 358.9 | 360 | 115.5 | 2,876.5 | 0 | 47 | 0 | 613 | 475 | 1,075.4 | 33.3 |
| 50,000 | react-native-better-clustering | 1.1.0 (main) | 5 | 231.5 | 92.4 | 159.6 | 463.6 | 0 | 50 | 0 | 180 | 2,160 | 1,554.5 | 29.3 |
| 50,000 | react-native-better-clustering | 1.0.0 | 5 | 353.9 | 81.2 | 212.5 | 250.2 | 500 | 0 | 0 | 180 | 2,160 | 1,554.3 | 27.7 |
| 50,000 | react-native-map-clustering | 4.0.0 | 5 | 1,833.7 | 1,834.8 | 172.5 | 17,793.7 | 0 | 50 | 14.8 | 705 | 2,160 | 1,067.3 | 40.2 |
| 100,000 | react-native-better-clustering | 1.1.0 (main) | 5 | 434 | 169.6 | 220.3 | 1,718.7 | 0 | 50 | 0 | 175 | 4,450 | 1,581.9 | 31.9 |
| 100,000 | react-native-better-clustering | 1.0.0 | 5 | 713.5 | 146.9 | 315.8 | 975.9 | 50 | 0 | 0 | 175 | 4,450 | 1,577.6 | 27.2 |
| 100,000 | react-native-map-clustering | 4.0.0 | 5 | 3,556.9 | 3,557.8 | 265.3 | 35,899.4 | 0 | 51 | 30.1 | 724 | 4,450 | 1,133.4 | 40.5 |

## Reading it

- **Mount.** react-native-map-clustering builds its index with `supercluster.load()` in an effect on the JS thread: the thread is frozen until the first markers appear (3.6 s at 100,000 markers). Both versions of this library build on a background thread; what is left on the JS thread is reading the markers from `children` (the 147–170 ms freeze at 100,000).
- **Parent re-renders.** With the same markers as new inline children, react-native-map-clustering rebuilds its index on every render (about 3.6 s of frozen JS each at 100,000). 1.0.0 rebuilds the native index on every render and the map goes blank until it lands (`Fewest on map` 0, #12). `main` keeps the index and every marker: no remount, no rebuild; the JS cost left is comparing the markers (about 170 ms per render at 100,000).
- **Memory** is the app's `phys_footprint` growth from before the mount, map tiles included.
- **Zoom.** react-native-map-clustering queries a viewport four times the screen's area, so it mounts about four times as many markers and bubbles, most off screen.
- **Press.** Every version fits the camera to the same cluster. The camera settles about 0.45 s later in both versions of this library than in react-native-map-clustering; the JS thread is not the cause (no JS frame later than 49 ms in any run). Not investigated yet.
- A simulator runs on the Mac's CPU, faster than a phone's: compare the libraries, not the absolute times with a device.
