---
name: onboarding/structure
kind: onboarding
tags: [onboarding, planned]
related: [file:src/server.ts, file:src/tools/index.ts, file:src/storage/types.ts, file:src/storage/sqlite/adapter.ts, file:src/recipes, file:src/ingest, file:src/search, file:web, file:.claude-plugin/plugin.json, file:package.json]
created: 2026-10-17T15:49:06.943Z
updated: 2026-10-17T16:39:50.687Z
---

# pantrybase — structure (planned layout, nothing built yet as of 2026-10-17)

Two kinds of locations: the **package** (this repo) and the **per-project data dir** it manages.

## Package layout (intended)
- `src/server.ts` — MCP entry: `new McpServer`, loops over `src/tools/index.ts`, `StdioServerTransport`.
- `src/tools/<name>.ts` — one file per tool, each `defineTool({name, description, schema, handler})`; `src/tools/types.ts` has `defineTool`, `text()`, `errorResult()`.
- `src/storage/types.ts` — `StorageAdapter` interface; `src/storage/sqlite/{adapter,schema}.ts` — the SQLite implementation (migrations, FTS5 porter+trigram tables, `vec0` table, prepared-statement cache).
- `src/recipes/` — markdown frontmatter parse/serialize, slug rules, reconcile (mtime+size → content hash → reparse), ingredient normalisation, pantry matching.
- `src/ingest/` — inbox queue (folder watcher + UI upload), image hashing/dedupe, HEIC→JPEG + downscale via sharp, claim/done/skip/fail state.
- `src/search/` — pipeline (porter FTS, trigram FTS, vector KNN) + weighted RRF fusion (`weight/(60+rank+1)`, weights 1 / 0.7 / 1).
- `src/embeddings/` — lazy Transformers.js pipeline, debounced single-flight `embedPending`.
- `src/ui/server.ts` — `node:http` on 127.0.0.1 with Host/Origin allow-list, static `dist/ui` + `/api/*`.
- `src/install/` — `npx pantrybase install`: materialise to `~/.pantrybase/plugin`, download model, `claude plugin marketplace add` + `claude plugin install pantrybase@pantrybase --scope user`.
- `src/cli.ts` — `pantrybase install|serve|ui|rebuild|doctor`.
- `web/` — Preact app built by Vite (`@preact/preset-vite`) into `dist/ui`; graph page uses Sigma.js + graphology.
- `.claude-plugin/plugin.json` (mcpServers inline, command `${CLAUDE_PLUGIN_ROOT}/bin/pb-server`), `.claude-plugin/marketplace.json`, `skills/<name>/SKILL.md` (notably an ingest skill telling Claude how to loop the batch), `bin/` shell shims that resolve node and exec `dist/*.js`.

## Per-project data dir `./pantrybase/` (created in the cwd where it is used)
- `recipes/<slug>.md` — source of truth (frontmatter + body sections).
- `inbox/` — drop photos here; UI uploads land here too.
- `images/<slug>/` — archived originals after a recipe is saved.
- `pantrybase.db` — SQLite index, fully rebuildable from the markdown.
- Global: `~/.pantrybase/models/` (embedding model cache), `~/.pantrybase/plugin/` (installed copy).

## Added in v2 (2026-10-17)
- `src/vocabulary/vocabulary.ts` + `seed/vocabulary.yaml` (copied to `pantrybase/vocabulary.yaml`): tag categories with closed/open mode, synonyms, cuisine hierarchy (`expand`, `ancestors`).
- `providers/<id>/{profile.yaml,guide.md}` (built-in `ucook`, `generic`; project overrides in `pantrybase/providers/`), loaded by `src/providers/registry.ts`; served to Claude by `pb_providers`.
- `src/recipes/enrich.ts` (provider rules → vocabulary) and `src/recipes/pipeline.ts` (`prepareRecipe`: enrich → resolve ingredients → rewrite step `uses`), shared by save and reconcile.
- Storage v2: full record in `recipes.doc` JSON; `step_ingredients` graph edges; derived facets (allergen, equipment, technique, chef, provider, plan) in `tags`/`recipe_tags` with `origin='derived'`; schema-version mismatch drops and rebuilds from markdown.
- Test fixtures from real UCOOK cards: `test/fixtures/ucook.ts`.

Hotspots/entry points: `em_architecture` knows them.
