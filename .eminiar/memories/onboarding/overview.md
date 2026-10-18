---
name: onboarding/overview
kind: onboarding
tags: [onboarding]
related: []
created: 2026-10-17T15:49:06.935Z
updated: 2026-10-18T20:40:42.297Z
---

# pantrybase — overview

**Status (2026-10-17): phases 1–7 done** (core store + search, v2 metadata + providers + vocabulary, file sync, photo ingestion, pantry + synthesis, Claude Code plugin + installer, web UI, README/polish). Phase 8 (CI + npm publish on every merge to main, see `release/ci-and-npm-publish-on-merge`) shipped 2026-10-17; `pantrybase` is on npm (0.2.0 on 2026-10-17, 0.3.0 on 2026-10-18 with meal planning — see `plan/meal-planning-reuse-objective`). Pushing to main publishes, so push only when a release is wanted. The plugin is installed on the owner's machine via `node dist/cli.js install`.

pantrybase is a local-first recipe knowledge base for meal-box recipe cards photographed by the owner (UCOOK, South Africa, first). It is one npm package that is:

- A **Claude Code plugin**: 19 `pb_*` MCP tools over stdio plus skills `/pantrybase:ingest` (photo queue → structured recipes) and `/pantrybase:cook` (search, pantry match, synthesis). Claude reads each card image via `pb_inbox_image` and saves with `pb_save_recipe {ingest:[…]}` — no API keys.
- A **local web UI** (`pantrybase ui` / `pb_open_ui`, 127.0.0.1:7433): faceted search, recipe pages, pantry + what-can-I-cook, inbox upload, tag browser, Sigma graph explorer.

Runtime: Node ≥22.12 ESM TypeScript; SQLite (better-sqlite3 + sqlite-vec + FTS5 porter/trigram) behind `StorageAdapter`; local embeddings (Transformers.js `Xenova/bge-small-en-v1.5`, 384d, q8); weighted RRF fusion. **Recipes are markdown with YAML frontmatter under `<project>/pantrybase/recipes/` and are the source of truth**; the DB, the photo queue and the graph are rebuildable from files. Provider support is modular (`providers/<id>/profile.yaml + guide.md`). Modelled on the owner's eminiar tool.
