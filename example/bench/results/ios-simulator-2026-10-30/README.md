# iOS Simulator, 30 October 2026: hooks

The first run of the hook benchmark (see `example/bench/README.md`): three libraries' hooks, the same points and options, no map. It compares this library's `useClusterer` with react-native-clusterer 5.0.2's `useClusterer` and with use-supercluster 1.2.0 on supercluster 8.0.1.

- Device: iOS Simulator, iPhone 17 Pro (`Clustering hooks bench (iPhone 17 Pro)`), iOS 26.5, on an Apple M5 Pro Mac (Xcode 27.1). The hooks get a 402 × 874 pt map, the window.
- Build: the example app in Release (Hermes), `ARCHS=arm64`, with this library at `main@2ed82f0` and the benchmark on top. All three libraries are in the one build.
- Runs: 3 rounds, interleaving the libraries and sizes. All 27 runs passed. Other projects shared the Mac: its load average stayed between 10 and 31 (median 14). An earlier session, at a median of 64, stalled the simulator for seconds at a time and was discarded.
- `ios-hooks.json` is the raw data.

Medians of the 3 runs (`node bench/summarize.mjs bench/results/ios-simulator-2026-10-30/ios-hooks.json`):

| Points | Library | Version | Runs | Index build, JS blocked (ms) | Index build, until queryable (ms) | Mount to first clusters (ms) | Longest JS freeze, mount (ms) | Index builds, mount |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 10,000 | react-native-better-clustering | main | 3 | 1.2 | 9.5 | 15.1 | 17.8 | 1 |
| 10,000 | react-native-clusterer | 5.0.2 | 3 | 19.3 | 19.3 | 40.1 | 82.7 | 4 |
| 10,000 | use-supercluster | 1.2.0 | 3 | 229 | 229 | 229 | 229 | 1 |
| 50,000 | react-native-better-clustering | main | 3 | 5 | 49.5 | 63.9 | 17.3 | 1 |
| 50,000 | react-native-clusterer | 5.0.2 | 3 | 104 | 104 | 221 | 430.4 | 4 |
| 50,000 | use-supercluster | 1.2.0 | 3 | 1,125.5 | 1,125.5 | 1,143.4 | 1,143.5 | 1 |
| 100,000 | react-native-better-clustering | main | 3 | 10.7 | 125.1 | 164.6 | 17.2 | 1 |
| 100,000 | react-native-clusterer | 5.0.2 | 3 | 234.1 | 234.1 | 501.6 | 961.1 | 4 |
| 100,000 | use-supercluster | 1.2.0 | 3 | 2,339.8 | 2,339.8 | 2,329.9 | 2,329.9 | 1 |

After the mount:

| Points | Library | Version | Runs | Per re-render (ms) | Index builds, 10 re-renders | JS blocked, 10 re-renders (ms) | Per pan, until new clusters (ms) | Index builds, 10 pans | JS blocked, 10 pans (ms) | Per data change, until new index (ms) | Index builds, 5 data changes | JS blocked, 5 data changes (ms) | Longest JS freeze, data changes (ms) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 10,000 | react-native-better-clustering | main | 3 | 0.7 | 0 | 0 | 0.7 | 0 | 0 | 13.9 | 5 | 0 | 20.2 |
| 10,000 | react-native-clusterer | 5.0.2 | 3 | 21.1 | 10 | 0 | 43 | 20 | 5.1 | 63 | 20 | 197.3 | 96.4 |
| 10,000 | use-supercluster | 1.2.0 | 3 | 0.7 | 0 | 0 | 222.9 | 10 | 1,749.8 | 226.2 | 5 | 889.4 | 239.2 |
| 50,000 | react-native-better-clustering | main | 3 | 0.6 | 0 | 0 | 0.8 | 0 | 0 | 59.2 | 5 | 7.5 | 57.5 |
| 50,000 | react-native-clusterer | 5.0.2 | 3 | 110.7 | 10 | 595.4 | 215.8 | 20 | 1,634 | 321.4 | 20 | 1,889.1 | 437.6 |
| 50,000 | use-supercluster | 1.2.0 | 3 | 0.7 | 0 | 0 | 1,205.2 | 10 | 11,550.7 | 1,201.9 | 5 | 5,765.3 | 1,250.6 |
| 100,000 | react-native-better-clustering | main | 3 | 0.7 | 0 | 0 | 0.7 | 0 | 0 | 152.1 | 5 | 10 | 60 |
| 100,000 | react-native-clusterer | 5.0.2 | 3 | 238 | 10 | 1,904.1 | 454.5 | 20 | 4,019.9 | 673.7 | 20 | 5,879.3 | 2,647.4 |
| 100,000 | use-supercluster | 1.2.0 | 3 | 0.7 | 0 | 0 | 2,379.8 | 10 | 23,243.5 | 2,337.8 | 5 | 11,451.6 | 2,421.3 |

## Reading it

- **Building.** react-native-clusterer reads every point through JSI and builds its index in the same synchronous call: 234 ms of JS at 100,000 points. supercluster builds in JavaScript: 2.3 s. This library spends 10.7 ms of JS checking and packing the points; the build itself runs on a background thread, and the index answers queries after 125 ms.
- **Re-renders.** react-native-clusterer 5.0.2's `useClusterer` builds a full index on every render (see [Migrating from react-native-clusterer](../../../../docs/docs/migration-clusterer.md)): 10 re-renders with the same props built 10 indexes, 238 ms each at 100,000. use-supercluster and this library build none; use-supercluster's deep comparison returns at once for the same array.
- **Pans.** react-native-clusterer builds two indexes per pan, one per render; use-supercluster builds one, because it never matches its options with supercluster's (see [Migrating from use-supercluster](../../../../docs/docs/migration-supercluster.md)). That is 0.45 s and 2.4 s per pan at 100,000 points. This library only queries: 0.7 ms, most of which is the wait for React to commit.
- **Data changes.** react-native-clusterer builds four indexes per new array, one in its effect and one in each of the three renders the change causes; use-supercluster builds one, after deep-comparing the new array with the old. Both run on the JS thread. This library compares the points, packs them and builds in the background: at 100,000, the new index is in after 152 ms and the longest JS freeze is 60 ms.
- **Where this library is behind.** No metric here favours the other libraries, but two behaviours do. Its first render has no clusters: they come with the build, 15 ms after the mount at 10,000 points and 165 ms at 100,000, while react-native-clusterer has them on the first render (after building for that render). And while a new index builds, the hook keeps returning the clusters of the previous points, for up to 152 ms at 100,000 here.
- **Feature counts.** With the same options, this library and react-native-clusterer returned the same number of features at the mount and at every pan, at every size. use-supercluster gets another zoom from `Math.log2(360 / longitudeDelta)`, so it returns more, smaller clusters (72 features over Poland, where the other two return 6). The query is a small part of its cost: what it pays for is the build.
- **No map.** Nothing is rendered: markers would cost the same in every library, and react-native-clusterer's new feature objects on every query would re-render them more often. A simulator runs on the Mac's CPU, faster than a phone: compare the libraries, not the absolute times with a device.
