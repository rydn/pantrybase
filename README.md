# pantrybase

A local-first recipe knowledge base for [Claude Code](https://claude.com/claude-code). Photograph your meal-box recipe cards, let Claude read them into structured recipes, then search by ingredient, tag, allergen or mood, see what you can cook with what's in your pantry, explore the collection as a graph, and invent new recipes grounded in the ones you already have.

- **Capture from photos** — drop card photos (front and back, iPhone HEIC included) into an inbox; Claude pairs them, extracts the full recipe (ingredients with prep notes, steps, timings, nutrition, allergens, chef, wine pairing…), tags it against a controlled vocabulary and saves it. Retakes and duplicates are caught.
- **Find anything** — hybrid keyword + semantic search (SQLite FTS5 + local vector embeddings), with facets for cuisine, diet, dish, protein, flavour, texture, technique, equipment and allergens to leave out.
- **What can I cook?** — keep a pantry inventory; recipes are ranked by how much of them you have, ignoring staples, with near misses called out.
- **New recipes** — Claude draws on related recipes and shared ingredient patterns to write new ones, saved with links to their sources.
- **Your data stays yours** — recipes are plain markdown files in your project; the database is a rebuildable index. No API keys, no cloud: the only download is a 34 MB embedding model.

## Requirements

- Node.js 22.12 or newer
- Claude Code (`claude` on your PATH)
- HEIC photos: macOS converts them natively; elsewhere the optional `heic-convert` dependency is used

## Install

```sh
npx pantrybase install
```

This installs a stable copy into `~/.pantrybase/plugin` with its native dependencies, checks that SQLite, the vector extension and the image library load, downloads the embedding model, and registers the plugin with Claude Code at user scope. Start a new Claude Code session (or run `/reload-plugins`) afterwards. Re-run the command to update.

```sh
npx pantrybase doctor      # check everything is wired up
npx pantrybase uninstall   # remove the plugin (your recipes are never touched)
```

## Quick start

1. **Add photos.** Drop card photos into `pantrybase/inbox/` in your project, upload them in the web UI, or ask Claude: *"import the recipe photos in ~/Pictures/ucook"*.
2. **Ingest.** Run `/pantrybase:ingest`. Claude works through the queue card by card; it can stop and resume at any time.
3. **Cook.** Ask *"what can I make with what's in my pantry?"*, *"something cosy and vegetarian under 30 minutes"*, or *"invent a new curry from my favourites"* — or run `/pantrybase:cook`.
4. **Browse.** Ask Claude to open the web UI, or run `npx pantrybase ui --open`.

## Where your data lives

Everything lives in a `pantrybase/` folder in the project Claude Code is working in:

```
pantrybase/
  recipes/<slug>.md     the recipes — the source of truth
  images/<slug>/        each recipe's card photos (front.jpg, back.jpg)
  inbox/                photos waiting to be read (skipped/ and failed/ keep a reason file)
  ingredients.yaml      ingredient catalog: canonical names, aliases, staples
  vocabulary.yaml       tag vocabulary: allowed values, synonyms, cuisine hierarchy
  providers/            optional meal-box provider profiles of your own
  pantrybase.db         search index (safe to delete; rebuilt from the files)
```

Recipe files are markdown with YAML frontmatter, so they diff cleanly, survive anything, and can be edited by hand — edits are picked up on the next tool call. Commit the folder (minus `pantrybase.db`) to keep your collection in git.

```yaml
---
pb: 2
title: Cosy Potatoes & Crispy Cannellini Beans
subtitle: with spinach & piquanté peppers
blurb: Harissa-crisped baby potatoes and roasted cannellini beans on lemony spinach…
servings: 2
time: {active: 25, total: 45}
provider: {id: ucook, plan: Veggie, chef: Kate Gomba, wine: {producer: Neil Ellis Wines, …}}
tags:
  cuisine: [north-african]
  dish: [traybake]
allergens: [allium, sulphites, tree-nuts]
nutrition: {basis: per_100g, energy_kcal: 79, protein_g: 2.6, …}
ingredients:
  - {raw: 500g Baby Potatoes, canonical: potato, qty: 500, unit: g, prep: rinse & halve, source: box}
steps:
  - {title: Off you go!, text: Preheat the oven to 200°C…, techniques: [roast], temp_c: 200, minutes: [25, 30]}
---
```

## Claude Code tools

| Tool | What it does |
|---|---|
| `pb_search` | Hybrid keyword + semantic search with tag, allergen, time and review filters |
| `pb_get_recipe` | One recipe, compact or full |
| `pb_pantry_match` | Recipes ranked by pantry coverage, with what's missing |
| `pb_plan_suggest` | Meal planning: recipes that share the shopping of a seed recipe or the current plan; `auto: n` fills a plan |
| `pb_plan` | The saved meal plan (shared with the web UI): get, set, add, remove, servings |
| `pb_plan_shopping_list` | One grocery list for the plan, by aisle with merged quantities; asks you to confirm the pantry items it relies on |
| `pb_synthesis_context` | Source recipes and shared patterns for inventing a new recipe |
| `pb_list_tags` | Tags and facets in use, plus the vocabulary |
| `pb_pantry_list` / `_add` / `_remove` | Manage the pantry |
| `pb_providers` | Meal-box provider profiles and their extraction guides |
| `pb_ingest_source` | Copy photos from files or folders into the inbox |
| `pb_inbox_next` / `_image` / `_resolve` / `_list` | Work through the photo queue |
| `pb_save_recipe` | Save or update a recipe (and archive its photos) |
| `pb_open_ui` | Start the web UI and get its URL |
| `pb_merge_ingredients` | Merge two ingredient names everywhere |
| `pb_stats` / `pb_rebuild` | Counts and paths; re-sync the index from the files |

Skills: `/pantrybase:ingest` (capture cards) and `/pantrybase:cook` (find, match, invent).

## Web UI

`npx pantrybase ui` (or the `pb_open_ui` tool) serves a UI on `http://127.0.0.1:7433`:

- **Recipes** — search with facets; recipe pages with photos, pantry ticks, steps, nutrition, allergens and lineage
- **Pantry** — your inventory and *what can I cook*
- **Plan** — pick a recipe, see which others share its shopping (what's already on the list, what's in the pantry, what each adds), auto-fill a week, confirm the pantry items the plan counts on, and get one grocery list by aisle
- **Graph** — recipes, ingredients and tags as a navigable network
- **Inbox** — drag-and-drop photo upload and the extraction queue
- **Tags** — the whole vocabulary at a glance

It only listens on localhost and rejects cross-site requests.

## Meal-box providers

Provider support is modular. [UCOOK](https://ucook.co.za) (South Africa) ships built in, with a `generic` profile for anything else. A provider is a folder with two files:

- `profile.yaml` — how to recognise its cards, which side is which, plan labels → tags (`Veggie` → `diet: vegetarian`), allergen wording, brand names to strip from ingredient names, kitchen items that are really equipment, nutrition basis, regional ingredient names
- `guide.md` — instructions Claude follows when reading that provider's cards

Put your own in `pantrybase/providers/<id>/` (or contribute it to `providers/` here). See [`providers/ucook/`](providers/ucook) for a complete example.

## Vocabulary and catalog

Tags are normalised against `pantrybase/vocabulary.yaml`: closed categories (diet, dish, meal, method, time, season, allergen) only accept listed values, open ones (cuisine, flavour, protein…) grow as you go, synonyms map card wording onto one value, and cuisines form a hierarchy so filtering on *asian* finds *thai*. Ingredient names resolve through `pantrybase/ingredients.yaml` (aliases, plurals, regional names; staples never count against pantry coverage). Edit either file and the next tool call re-indexes your recipes.

## How search works

Each recipe is indexed as four chunks — title and tags, description and blurb, ingredients, method — in two SQLite FTS5 indexes (stemmed words and trigrams, for typos) and a `sqlite-vec` vector table embedded locally with `bge-small-en-v1.5`. Results are fused with weighted reciprocal-rank fusion, then filtered by tags, allergens and time. The graph is derived from the same tables.

## CLI

```
pantrybase install | uninstall | doctor
pantrybase ui [--port N] [--open]
pantrybase rebuild [--full] [--reembed]
pantrybase search <query…>
pantrybase embed | stats | version
```

## Development

```sh
npm install
npm run build        # server (tsup) + web UI (vite)
npm run check        # biome + typecheck + vitest
npm run dev          # watch the server, Vite dev server on :5173
node dist/cli.js install   # install the plugin from your checkout
```

The code is TypeScript (ESM, Node 22+): `src/storage` (the `StorageAdapter` interface and its SQLite implementation), `src/recipes` (schema, provider rules and vocabulary, save pipeline), `src/ingest` (photo queue), `src/search`, `src/pantry`, `src/synthesis`, `src/graph`, `src/mcp/tools` (one file per tool), `src/web` (HTTP server) and `web/` (Preact app).

### Releases

Every merge to `main` publishes a new version to npm automatically (`.github/workflows/release.yml`): the workflow runs the full checks, picks the version from the commits since the last tag (breaking change → major, minor while 0.x · `feat:` → minor · anything else → patch), commits `chore(release): vX.Y.Z` with `package.json` and `.claude-plugin/plugin.json` in sync, tags it, publishes with npm provenance and creates a GitHub release. Pull requests run the CI matrix (Linux and macOS, Node 22 and 24) in `.github/workflows/ci.yml`.

One-time setup for publishing — either link the repository as a [trusted publisher](https://docs.npmjs.com/trusted-publishers) for the `pantrybase` package (workflow file `release.yml`), or add an npm automation token as the repository secret `NPM_TOKEN`.

## License

MIT
