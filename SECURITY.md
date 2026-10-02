# Security Policy

## Supported versions

Fixes land on the latest minor release. Older minors do not receive backports —
upgrading is the supported path.

| Version | Supported                      |
| ------- | ------------------------------ |
| 1.0.x   | ✅ latest patch (1.0.1 or later) |
| < 1.0   | ❌                             |

## Reporting a vulnerability

**Do not open a public issue.**

Report it privately through
[GitHub Security Advisories](https://github.com/gmi-software/react-native-better-clustering/security/advisories/new).
If that is not possible, email <security@gmi.software>.

Please include:

- the version of `react-native-better-clustering`, React Native,
  `react-native-maps` and `react-native-nitro-modules`
- the affected platform (iOS / Android) and map provider, if relevant
- what an attacker can do with it, and a reproduction if you have one

We aim to acknowledge a report within five working days. If a fix is warranted
we will agree a disclosure timeline with you, credit you in the advisory unless
you prefer otherwise, and publish the advisory alongside the release that fixes
it.

## Scope

This library clusters points and renders markers through
[`react-native-maps`](https://github.com/react-native-maps/react-native-maps).
It never sees or handles map provider API keys — those are configured for
`react-native-maps` and read by the provider SDKs. Reports about extracting a
Google Maps key from an app binary belong with your Google Cloud key
restrictions, not here.

In scope are, for example: memory-safety bugs in the C++ engine
(`package/cpp`) reachable from JavaScript input, crashes caused by malformed
input to the public API, and anything in a published artifact that does not
match this repository.

## Supply chain

From 1.0.1 on, releases are built and published only by the
[Release workflow](.github/workflows/release.yml), never from a developer
machine:

- npm publishing uses OIDC trusted publishing, so no long-lived npm token exists
  in the repository or on any laptop
- every published version carries
  [npm provenance](https://docs.npmjs.com/generating-provenance-statements),
  which you can verify with `npm audit signatures`
- the published file list is checked in CI: no binaries, benchmarks, tests or
  native sources defining `main()` can reach the tarball
- every GitHub Action is pinned by commit SHA, not by tag
- workflows check out with `persist-credentials: false`, and CI never writes to
  git

1.0.0 predates this workflow and was published without provenance; use 1.0.1
or later.

If you believe a published artifact does not match this repository, treat it as
a vulnerability and report it through the channel above.
