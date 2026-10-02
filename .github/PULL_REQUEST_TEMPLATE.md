## Summary

<!--
2–5 bullets: what the change does and why. Link the issue it closes: "Closes #123".
The PR title must follow Conventional Commits (`fix: …`, `feat: …`) — PRs are
squash-merged, so the title becomes the commit on `main` and the release-notes entry.
-->

## Test plan

<!--
Say what you actually ran — "builds" is not verification.
For native changes, name the platform, map provider and device you tested on.
-->

- [ ] `bun run lint` and `bun run format:check`
- [ ] `cd package && bun run typecheck && bun run test`
- [ ] `cd package && bun run build && bun run verify:pack && bun run verify:exports`
- [ ] C++ changes: `cd package/cpp && c++ -std=c++20 -I. ClusterEngineCore.test.cpp -o cluster_test && ./cluster_test`
- [ ] Native changes: example app on iOS / Android (`cd example && bunx expo prebuild --clean && bunx expo run:ios`)

## Scope

- **Platforms:** <!-- iOS / Android / both / JS only -->
- **Providers:** <!-- apple / google / both / not provider specific -->

## Risk

<!-- Compatibility, migration or platform risk. Behaviour changed without a type change? Say so explicitly — it breaks consumers whose code still compiles. -->

## Checklist

- [ ] Nitro specs changed? `cd package && bun run specs` was re-run (`package/nitrogen/` is generated and git-ignored — never committed)
- [ ] Public API or user-facing behaviour changed? `README.md` and `docs/docs/` are updated
- [ ] New behaviour is covered by a test
- [ ] Commits and the PR title follow [Conventional Commits](https://www.conventionalcommits.org/)

## Notes

<!-- Assumptions, edge cases, follow-ups. -->
