# Device benchmark

The example app's **Benchmark** scenario runs react-native-better-clustering and react-native-map-clustering 4.0.0 through the same script on a device, and `run.mjs` repeats it over Maestro and samples the app's memory from the host. It is the device layer of #20: unlike the core benchmark (`package/bench/`), it measures the whole pipeline in a Release build on Hermes, rendering included. It never gates CI.

| File | Role |
| --- | --- |
| `../src/bench/BenchmarkScreen.tsx` | The scenario: the script, its measurements and the JSON it shows |
| `../src/bench/BenchMarkers.tsx` | The marker and cluster bubble both libraries render, which count their mounts |
| `../src/bench/frameMonitor.ts` | JS frame gaps, from `requestAnimationFrame` |
| `../src/bench/libraries.ts` | The two libraries, behind the props their `MapView`s share |
| `flow.yaml`, `mark.js`, `result.js` | One run in Maestro |
| `run.mjs` | Runs every library, size and repetition, and writes one report |
| `summarize.mjs` | Medians per library, version and size, as Markdown and JSON |

## What one run does

Both libraries get the same props: `initialRegion` over Poland, `mapRef`, `onRegionChangeComplete`, a `renderCluster` that draws the same bubble (`BenchCluster`), a `superClusterRef` that counts index builds, and the markers as inline `BenchMarker` children, the way apps write them. Every other prop is the library's default. The markers are the seeded points of the `large-*` scenarios.

1. **ready**: the points exist, the map is not mounted. The host samples memory.
2. **mount**: the map mounts with every marker, until no marker or bubble mounts or unmounts and no JS frame is late for 1 s. The host samples memory.
3. **re-render**: the screen re-renders the map with the same markers 10 times, every 500 ms, like a clock or a selection in a parent would. The host samples memory.
4. **zoom**: the camera jumps (`animateToRegion` with no animation) to Kraków at zoom 8, 10, 12, 14 and 10, then back to Poland, settling after each step.
5. **press**: the largest bubble on screen is pressed, through its `onPress`, until the camera settles. The host samples memory.
6. **live**: the camera jumps to Kraków at zoom 12. 20 vehicles (`BenchVehicle`, more inline children) drive loops through the markers, 10 updates a second for 10 s. Update n is due n − 1 intervals after the start; a timer that fires late sends the newest update due and skips the ones before it, as a feed whose newest position wins would. Every update re-renders the map, with new elements for the vehicles and the same elements for the other markers, as an app that only moves its vehicles would; recreating those too costs what a re-render does, which the re-render phase measures. The phase ends once the map shows the last update and settles. The host samples memory.

## Metrics

| Metric | How |
| --- | --- |
| First markers | From the render that hands the library its markers to the first `BenchMarker` or `BenchCluster` mount |
| Longest JS freeze | The longest gap between two `requestAnimationFrame` callbacks: how long no touch handler, timer or state update could run |
| JS blocked | Over the gaps longer than 50 ms, the sum of the part above 50 ms (Total Blocking Time) |
| Dropped frames | For each gap, its frame intervals minus one |
| Remounts | `BenchMarker` and `BenchCluster` mounts in a phase |
| Fewest on map | The fewest markers and bubbles mounted at once in a phase: 0 means the map went blank |
| Memory | iOS: the app's `phys_footprint` (`footprint`); Android: total PSS (`dumpsys meminfo`). Reported as the growth from **ready** |
| Age of the map | Over the live phase, the mean time since the update the map shows was due (before the map shows any, since the first was due). The one number that weighs both how often and how late the map catches up |
| Updates shown | Of the live phase's 100 updates, how many a vehicle rendered. An update that a newer one overtook before the map showed it is not shown |
| Lag | From when a live update was due to when a vehicle first rendered it. For a point, both libraries render the marker element they hold for it, so that is when the map showed the update. A timer that fired late counts in it. Only shown updates count, so a library that shows few has few lags: read it with the age of the map |
| Last update shown after | The lag of the 100th update: how long the map takes to catch up once the feed stops |
| Index builds | Index objects the library assigned to `superClusterRef` during the live phase: each is a build |
| JS heap | Hermes' `js_heapSize` (`HermesInternal.getInstrumentedStats()`) |

## Running it

Build the example in Release and install it (see CONTRIBUTING.md for the machine setup Maestro needs), then from `example/`:

```bash
node bench/run.mjs --platform ios --device <simulator udid> --runs 5 --out bench/results/ios.json
node bench/run.mjs --platform android --device emulator-5554 --runs 5 --out bench/results/android.json
node bench/summarize.mjs bench/results/ios.json
```

`run.mjs` also takes `--libs rnmc,rnbc`, `--counts 10000,50000,100000` and `--app-id`. Runs interleave the libraries and sizes, so drift over the session spreads over every case.

Android needs a real Maps SDK key: with the placeholder in `app.json`, Google Maps draws no markers and ignores camera moves, so the zoom and press phases time out.

An Android emulator slows down within a few runs in a row, every phase with it. Cold-boot it before each run (`--counts` and `--libs` with one value each, `--runs 1`), as the [29 October results](results/android-emulator-2026-10-29/README.md) did, and give each run its own `--out`: `summarize.mjs` takes them all.

### Against a published version

One build links one version of this library's native code, so measuring another version takes another build. To measure 1.0.0 from npm, temporarily:

1. In `example/package.json`, depend on `https://registry.npmjs.org/react-native-better-clustering/-/react-native-better-clustering-1.0.0.tgz` instead of `workspace:*`.
2. In `example/metro.config.js`, remove the `extraNodeModules` entry, so Metro resolves the library from `example/node_modules`.
3. In `example/app.json`, give the app another bundle identifier and package (e.g. `com.nitromapcluster.example.v100`), so both builds stay installed.
4. `bun install`, `npx expo prebuild --clean`, and build in Release with `EXPO_PUBLIC_BENCH_RNBC_VERSION=1.0.0` set, so results carry the version.
5. Run with `--libs rnbc --app-id com.nitromapcluster.example.v100`.

Revert the three files afterwards.

## Reading the results

These are numbers for one device and one dataset, not for an app. A simulator runs on the Mac's CPU, which is faster than a phone's, so absolute times are lower than on a phone; compare libraries measured in the same session. In `MapView`, 1.0.0's radius and tile-size errors cancel out (#9), so all three versions cluster the markers into the same bubbles; react-native-map-clustering queries a viewport four times the screen's area, so it renders more of them off screen.
