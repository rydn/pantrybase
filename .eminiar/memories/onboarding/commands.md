---
name: onboarding/commands
kind: onboarding
tags: [onboarding, planned]
related: []
created: 2026-10-17T15:49:18.629Z
updated: 2026-10-17T16:09:54.139Z
---

# pantrybase — commands

**Verified 2026-10-17 (Phase 1):** `npm install`, `npx biome check .`, `npx tsc --noEmit -p tsconfig.json`, `npx vitest run` (11 tests), `npx tsup` → `node dist/server.js --probe`. A full stdio round-trip test lives outside the repo for now (spawn `dist/server.js` with the SDK `Client`, call `pb_save_recipe` then `pb_search`). Model cache `~/.pantrybase/models` is 34 MB; first download took a few minutes, later loads ~80 ms. `PANTRYBASE_NO_EMBED=1` disables the model. `install`, `ui`, `doctor` CLI commands and the web build are NOT implemented yet (Phase 5/6); the CLI today has `rebuild [--full]`, `embed`, `search <q>`, `stats`.

Environment verified 2026-10-17: Node 25.2.1, npm 11.6.2, pnpm 10.27.0, Claude Code 2.1.292 at `/opt/homebrew/bin/claude`, Apple Silicon. `better-sqlite3` 13.0.3 ships a darwin-arm64 prebuild that loads on Node 25 with `sqlite-vec` 0.1.9 (FTS5 trigram confirmed), and `sharp` 0.35.5 has darwin-arm64 prebuilds — no native compile expected.

Intended scripts (package.json):
- `npm install` — deps (no postinstall compile expected).
- `npm run build` — tsup for `src/` → `dist/`, then Vite build of `web/` → `dist/ui`.
- `npm run dev` — server in watch mode (tsx) + Vite dev server proxying `/api` to the Node server.
- `npm test` — Vitest (`vitest run`); `npm run test:watch`.
- `npm run lint` / `npm run format` / `npm run check` — Biome (`biome check .`, `biome format --write .`).
- `npm run typecheck` — `tsc --noEmit`.
- `npm run validate` — `claude plugin validate .` (plugin manifest sanity).

Install / run:
- Development: `npm link` in the repo, then `pantrybase install` (same as `npx pantrybase install` for consumers). Install copies the package to `~/.pantrybase/plugin`, pre-downloads `Xenova/bge-small-en-v1.5`, runs `claude plugin marketplace add <root>` and `claude plugin install pantrybase@pantrybase --scope user`, and records `~/.pantrybase/install.json`.
- `pantrybase ui` — start the local web UI (127.0.0.1, prints the port); `pantrybase rebuild` — rebuild the DB from `./pantrybase/recipes/*.md`; `pantrybase doctor` — check node, sqlite-vec, model, plugin registration.
- MCP server is launched by Claude Code via `bin/pb-server`; probe with `bin/pb-server --probe`.

Env vars: `PANTRYBASE_HOME` (default `~/.pantrybase`), `PANTRYBASE_DATA` (default `./pantrybase` in cwd), `PANTRYBASE_PLUGIN_ROOT` (set by plugin.json from `${CLAUDE_PLUGIN_ROOT}`). No API keys — extraction is done by Claude through the MCP.

Release: not published yet; design for npm (`bin` entries, `files` allow-list), decide on publishing later.

Prefer `em_batch_execute` for builds/tests here — the owner pre-approved it in `.claude/settings.local.json`.
