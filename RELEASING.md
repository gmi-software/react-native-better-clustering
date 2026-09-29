# Releasing

Releases are published to npm from CI with
[provenance](https://docs.npmjs.com/generating-provenance-statements) by the
[Release workflow](.github/workflows/release.yml). Nothing is published from a
developer machine, and no long-lived npm token exists anywhere.

Publishing is triggered by pushing a version tag. CI never writes to git: the
version bump goes through a normal reviewed pull request, and pushing the
matching tag afterwards triggers the publish.

## Cutting a release

**1. Smoke-test the example app** on both platforms from an up-to-date `main`
(see the [checklist](#manual-smoke-test) below).

**2. Open a release pull request.** Bump the version:

```bash
cd package
npm version 1.1.0 --no-git-tag-version
```

Open a pull request titled `chore(release): 1.1.0` with that change, then review
and merge it as usual.

**3. Rehearse.** Run the **Release** workflow manually from the Actions tab on
`main`. A manual run is always a dry run: it validates the version and runs the
full gate — including the native Release build — without publishing.

**4. Push the tag.**

```bash
git checkout main && git pull
git tag -a v1.1.0 -m 'v1.1.0'
git push origin v1.1.0
```

The workflow then:

1. builds the native code in the Release configuration (iOS; Android `arm64-v8a`
   and `armeabi-v7a`),
2. verifies the tag matches `package/package.json` and that the version is not
   already on npm,
3. runs codegen, lint, format check, typecheck, build, tests, and the package
   content and exports checks,
4. publishes to npm with provenance, and
5. creates the GitHub Release with notes generated from the conventional commits
   since the last tag.

The iOS podspec reads its version from `package.json`, so there is no second
version to keep in sync.

## Versioning

The bump is a judgement call, made when you open the release pull request. The
usual rules apply — `fix:` is a patch, `feat:` a minor, an incompatible API
change a major — but two cases are easy to get wrong:

- A commit that is not conventional is invisible to the generated release notes.
  Edit the GitHub Release body by hand after the workflow creates it.
- A change in runtime behavior that keeps the same types — such as a callback
  that starts firing at a different time, or different clusters for the same
  options — breaks consumers even though their code still compiles. Either take
  the major, or ship it as a minor and add a prominent **Behavior changes**
  section to the GitHub Release body.

## Pre-releases

A version with a prerelease identifier works without extra configuration.
Tagging `v1.2.0-rc.1` publishes under the `rc` dist-tag rather than `latest`, so
`npm install react-native-better-clustering` is unaffected, and the GitHub
Release is marked as a pre-release. release-it derives both from the version
itself.

Consumers opt in explicitly:

```bash
npm install react-native-better-clustering@rc
```

## Release notes

The release notes are the GitHub Release body, generated from the conventional
commits since the previous tag by `@release-it/conventional-changelog`.
`CHANGELOG.md` covers 1.0.0 only and is no longer updated.

Commit subjects cannot carry the parts of a release that matter most — behavior
changes, migration snippets, the reason a fix exists. When a release needs them,
edit the GitHub Release body by hand once the workflow has created it.

## Manual smoke test

Before opening the release pull request, from `main`:

- [ ] `cd example && bunx expo prebuild --clean`
- [ ] `bunx expo run:ios` — markers cluster; pressing a cluster zooms in;
      pan and zoom are smooth
- [ ] `bunx expo run:android` — the same, with a Google Maps key configured
- [ ] a `cluster={false}` marker stays unclustered; a custom `renderCluster`
      bubble shows
- [ ] no `react-native-better-clustering:` errors in the Metro logs

## One-time setup: npm trusted publishing

Publishing uses OIDC, so it only works once npm knows which workflow may publish
this package. On npmjs.com, open the `react-native-better-clustering` package
settings and add a **GitHub Actions** trusted publisher pointing at:

- repository: `gmi-software/react-native-better-clustering`
- workflow: `release.yml`

Until this is configured the publish step fails with an authentication error.

## Notes on the configuration

A few settings exist for non-obvious reasons:

- `npm.skipChecks: true` in `package/.release-it.json` — release-it otherwise
  runs `npm whoami` at startup, which fails under trusted publishing because the
  token is only minted at publish time.
- The workflow does **not** set `registry-url` on `actions/setup-node` — doing so
  writes an `_authToken` entry into `.npmrc`, which makes npm assume classic
  token auth and skip the OIDC flow. The registry is pinned by `publishConfig`.
- `release-it` runs with `--no-increment --no-git`: the version is already
  committed and the tag already pushed, so CI only publishes and creates the
  release.
- `github.tagName` is set explicitly. With `--no-git` the GitHub plugin would
  otherwise guess the tag format from the latest existing tag, and attach the
  release to a new, unprefixed `1.0.1` tag when none exists yet.
- The workflow copies `README.md` into `package/` before publishing: npm reads
  the registry README before any pack script runs, so the `prepack` copy alone
  never reaches npm.

## Inspecting a release locally

A local publish would produce a package without provenance, so it is not
supported. To see what a release would do:

```bash
cd package
bunx release-it --no-increment --no-git --dry-run
```
