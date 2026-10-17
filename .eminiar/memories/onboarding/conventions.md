---
name: onboarding/conventions
kind: onboarding
tags: [onboarding, planned]
related: []
created: 2026-10-17T15:49:33.660Z
updated: 2026-10-17T15:50:09.720Z
---

# pantrybase — conventions (agreed at kickoff 2026-10-17; refine as code lands)

Code style
- TypeScript, strict, ESM (`"type": "module"`), Node ≥22 target. Biome is the only linter/formatter (no ESLint/Prettier). Vitest for tests, colocated as `*.test.ts` next to the module or under `src/**/__tests__/`.
- MCP tools: snake_case `pb_<verb>` names (`pb_search`, `pb_save_recipe`, `pb_pantry_match`…), one file per tool, zod v4 field objects as the schema, handlers return `text()`/`errorResult()` helpers; every tool accepts optional `project_root`. Keep tool output compact — Claude's context is the scarce resource, especially during batch ingestion (one image per call, small save payloads).
- Storage access only through the `StorageAdapter` interface; SQL lives in `src/storage/sqlite/` only. Prepared statements cached; writes in transactions.
- Markdown recipe files are the source of truth: any write path must write the `.md` first, then update the DB; the DB must always be rebuildable with `pantrybase rebuild`. Frontmatter key order is fixed and arrays are written inline `[a, b]` (eminiar style) so diffs stay clean.
- Slugs: lowercase kebab-case from the title, de-duplicated with a numeric suffix; slug = filename = recipe id.
- Ingredients are normalised to canonical names with aliases; pantry staples (salt, pepper, oil, water…) never count against coverage.
- Web UI: Preact function components + hooks/signals, routing with preact-iso, no CSS framework decided (keep it light); graph via Sigma.js + graphology; all data via `/api/*` JSON.
- Server binds 127.0.0.1 only, with Host/Origin allow-list checks (copy eminiar's approach).

Process
- Not a git repo yet — initialise before the first commit; commit `.eminiar/memories/` and `.eminiar/docs.json`. Commit messages: conventional-ish (`feat:`, `fix:`, `chore:`), small focused commits per milestone.
- Decisions get an `em_remember` decision memory with the why; onboarding memories are refreshed when structure/commands change.
- Newcomer traps: Biome does not bundle (Vite does); `sqlite-vec` has an `exports` map (don't `require('sqlite-vec/package.json')`); the embedding model is lazy — first search warms it; HEIC photos must be converted before being returned as MCP image content.
