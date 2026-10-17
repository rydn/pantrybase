---
name: ingest/recipe-metadata-v2-scope
kind: decision
tags: [ingest, schema, ucook]
related: [file:src/recipes/schema.ts, file:src/files/recipe-md.ts, file:src/storage/sqlite/schema.ts, file:seed/ingredients.yaml]
created: 2026-10-17T16:22:15.016Z
updated: 2026-10-17T16:22:15.016Z
---

Recipe record v2 (agreed 2026-10-17, before Phase 2) captures four metadata groups on top of the Phase 1 schema:

1. **Card facts** — nutrition per serving (kcal, protein, carbs, fat…), allergens, spice level 0–3, subtitle, provider + card code, per-ingredient "in your box" vs "from your pantry", quantities for multiple serving sizes.
2. **Controlled vocabulary** — seeded `pantrybase/vocabulary.yaml` (allowed tags + synonyms; closed for diet/allergen/meal/dish, open for flavor/cuisine); save tool normalises and reports unknown tags; adds `dish` and `allergen` categories.
3. **Graph enrichment** — equipment, per-step technique and the ingredients each step uses, ingredient groups ("for the sauce"); derived edges: similar recipes (vector kNN), ingredient pairing strength (co-occurrence), cuisine hierarchy.
4. **Search blurb + quality flags** — Claude-written descriptive blurb embedded as its own chunk; extraction confidence, uncertain fields, `needs_review`.

Cards are from **UCOOK (South Africa)** — tune the extraction guide to their layout (metric units, SA ingredient names e.g. "baby marrow" = courgette, "brinjal" = aubergine, "spring onion", "biltong", "boerewors", "chakalaka").

Why: the user wants ingestion to produce enough metadata for strong graph and semantic search before building the inbox/batch phase. Validate the schema with a dry-run extraction on the user's real card photos before changing code.

How to apply: extend `recipeInputSchema`, markdown frontmatter, SQLite schema and chunking together; keep markdown as source of truth.
