---
name: release/ci-and-npm-publish-on-merge
kind: decision
tags: [ci, release, npm]
related: []
created: 2026-10-17T16:59:45.334Z
updated: 2026-10-17T16:59:45.334Z
---

Phase 8 (after phases 5–7): GitHub Actions for CI and npm publishing. CI runs lint, typecheck, tests and build on pull requests and pushes. **Every merge to `main` publishes a new version to npm** — the workflow bumps the version automatically (no manual version edits), keeps `.claude-plugin/plugin.json` in sync with package.json, tags the release and publishes with provenance.

Why: the user asked (2026-10-17) "add github actions for ci and publishing to npm. Ensure that on any merge to main we publish a new version to npm".

How to apply: design the version bump so it can't loop (the bot's version commit must not trigger another publish), needs an NPM_TOKEN or trusted publishing on the npm side, and native deps (better-sqlite3, sqlite-vec, sharp) must install on the CI runner (ubuntu prebuilds exist).
