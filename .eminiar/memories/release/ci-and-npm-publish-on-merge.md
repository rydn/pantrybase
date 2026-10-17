---
name: release/ci-and-npm-publish-on-merge
kind: decision
tags: [ci, release, npm]
related: []
created: 2026-10-17T16:59:45.334Z
updated: 2026-10-17T17:24:37.230Z
---

Phase 8 (built 2026-10-17): GitHub Actions for CI and npm publishing. **Every merge to `main` publishes a new version to npm.**

- `.github/workflows/ci.yml`: PRs + non-main pushes; matrix ubuntu/macos × node 22/24; lint, typecheck, test, build, `npm pack --dry-run`, `dist/server.js --probe`.
- `.github/workflows/release.yml`: push to main → `npm run check` → `npx tsx src/release/version.ts` (writes release/version/bump to $GITHUB_OUTPUT) → first release tags the package.json version (0.1.0), later ones run `npm version X -m "chore(release): v%s"` (the `version` npm script syncs `.claude-plugin/plugin.json`) → `git pull --rebase`, push commit + tag → `npm publish --provenance --access public` → `gh release create`. Skips when the head commit starts with `chore(release):`; GITHUB_TOKEN pushes don't retrigger workflows; concurrency group `release`.
- Bump rules (src/release/version.ts, tested): breaking → major (minor while 0.x), `feat` → minor, anything else → patch; bump from the last `v*` tag, not package.json.
- Rehearsed locally against a bare remote: v0.1.0 tag, then a `fix:` → `chore(release): v0.1.1` with package.json/lock/plugin.json in sync; a run with only the release commit new does nothing.
- Release commits are authored by github-actions[bot] (automation, not Claude).

Still needed before the first publish works: npm trusted publishing for `pantrybase` linked to rydn/pantrybase + release.yml, or repo secret NPM_TOKEN. The name `pantrybase` was unclaimed on 2026-10-17. Branch protection on main must allow the bot to push the release commit.

Why: the user asked "add github actions for ci and publishing to npm. Ensure that on any merge to main we publish a new version to npm".
