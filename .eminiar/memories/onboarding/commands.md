---
name: onboarding/commands
kind: onboarding
tags: [onboarding, planned]
related: []
created: 2026-10-17T15:49:18.629Z
updated: 2026-10-17T17:18:30.336Z
---

# pantrybase — commands

**Verified 2026-10-17 (Phase 1):** `npm install`, `npx biome check .`, `npx tsc --noEmit -p tsconfig.json`, `npx vitest run` (11 tests), `npx tsup` → `node dist/server.js --probe`. A full stdio round-trip test lives outside the repo for now (spawn `dist/server.js` with the SDK `Client`, call `pb_save_recipe` then `pb_search`). Model cache `~/.pantrybase/models` is 34 MB; first download took a few minutes, later loads ~80 ms. `PANTRYBASE_NO_EMBED=1` disables the model. **Phase 5 (2026-10-17):** `pantrybase install [--no-model] [--no-register]` packs the package (building from source in a dev checkout), installs it with production deps into `~/.pantrybase/plugin/node_modules/pantrybase`, pins `~/.pantrybase/node-path` + `root-path`, smoke-tests native modules + MCP probe, pre-downloads the model, then `claude plugin marketplace add <stable root>` + `claude plugin install pantrybase@pantrybase --scope user` (re-run = update). `pantrybase doctor`, `pantrybase uninstall [--purge]`. Test installs safely with `PANTRYBASE_HOME=$(mktemp -d) node dist/cli.js install --no-register`. Validate manifests: `claude plugin validate --strict .` and `… .claude-plugin/plugin.json`. Check the live server: `claude mcp list` → `plugin:pantrybase:pantrybase ✔ Connected`. After code changes, re-run `pantrybase install` (or `node dist/cli.js install`) so the plugin picks them up. `prepack` builds the server only until the web UI exists (Phase 6). **Phase 6 web UI:** `pantrybase ui [--port N] [--open]` (default 127.0.0.1:7433, next free port if taken) or the `pb_open_ui` MCP tool; `npm run build` = tsup + vite (web → `dist/web`, graph page lazy-loaded); `npm run dev` = tsup watch + Vite on :5173 proxying `/api` (set `PB_DEV=1` on the API server). Seed a demo project for UI checks with real scans: `npx tsx <script>.mts /tmp/pb-demo` (import scans, save fixtures with `ingest`). The installer always reinstalls the packed tarball and fails if the installed `dist/server.js` differs from the fresh build.

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
