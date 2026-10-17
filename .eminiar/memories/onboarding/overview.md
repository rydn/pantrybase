---
name: onboarding/overview
kind: onboarding
tags: [onboarding, planned]
related: []
created: 2026-10-17T15:49:06.935Z
updated: 2026-10-17T15:49:06.935Z
---

# pantrybase — overview

**Status (2026-10-17): greenfield, no code yet.** These onboarding notes describe the agreed design; refresh them once the first milestone lands.

pantrybase is a personal recipe knowledge base for a few hundred meal-box recipe cards the owner has as **photos/scans**. It is two things in one npm package:

- A **Claude Code MCP plugin** (`pb_*` tools over stdio). Claude reads each card image via the MCP, extracts structured data (title, ingredients with qty/unit, steps, times, servings) and auto-generates tags (protein, vegetarian/vegan, starch, flavor profile, cuisine, cook time…), then saves it. Later Claude searches the base (hybrid keyword + semantic), filters by tags, matches against the pantry inventory, and pulls a compact "synthesis context" to write new recipes from existing ones.
- A **local web UI** (Preact, served by the same Node process on 127.0.0.1) for browsing/searching with facets, managing the pantry ("what can I cook"), uploading photos into the ingest queue, and exploring the recipe/ingredient/tag graph (Sigma.js + graphology).

Runtime pieces: Node ≥22 ESM TypeScript server; SQLite (better-sqlite3 + sqlite-vec + FTS5) behind a `StorageAdapter` interface so another DB can replace it; in-process embeddings with Transformers.js (`Xenova/bge-small-en-v1.5`, 384d, q8). Recipes are **markdown files with YAML frontmatter under `./pantrybase/recipes/` and are the source of truth** — the DB is a rebuildable index. Modelled closely on the owner's earlier tool eminiar (installed at `~/.eminiar/plugin/node_modules/eminiar`): same install flow, tool-definition pattern, hybrid-search fusion and markdown reconcile approach.

Who it is for: the owner (single user, local-first, no API keys — extraction is Claude-in-the-loop), with the package shaped so others can `npx pantrybase install`.
