---
name: cook
description: Answer "what can I cook?" from the pantrybase recipe collection and the user's pantry, find recipes by ingredient, tag, cuisine, allergen or mood, keep the pantry up to date, and invent new recipes grounded in the collection. Use when the user asks for meal ideas, what to make with what they have, recipes matching criteria, a new recipe in the style of their collection, or to update their pantry.
---

# Cook from the collection

## Keep the pantry current
- "I bought…", "I have…", "we're out of…" → `pb_pantry_add {items}` / `pb_pantry_remove {names}`. Names are matched to the catalog (plurals, aliases, regional names), so use the user's words.
- Don't add staples one by one unless asked; salt, pepper, oil, water and other "from your kitchen" items never count against a recipe anyway.

## What can I cook?
1. `pb_pantry_match` — add `ingredients` for things the user mentions having right now; pass their constraints as filters (`tags: {diet: [vegetarian]}`, `exclude_allergens: [tree-nuts]`, `max_total_min: 30`).
2. Lead with full matches, then near misses (`missing` has 1–2 items) — say exactly what's missing, and suggest a swap from the pantry when an obvious one exists.
3. `pb_get_recipe` only for the recipe the user picks, then give it in a cook-friendly form.

## Find recipes
- Free text, mood or occasion ("something cosy and quick", "fresh summer lunch") → `pb_search {query}`; it's hybrid keyword + semantic.
- Criteria → `pb_search` with `tags` (assigned: cuisine, diet, dish, protein, starch, flavor, texture, method, meal, time, season; derived: allergen, equipment, technique, chef, provider, plan). Parents expand: `cuisine: [asian]` includes thai and korean.
- `pb_list_tags` shows which values exist.

## Invent a new recipe
1. `pb_synthesis_context` with a `query` for what the user wants, `use_pantry: true` if it should use what they have, and any filters. Read the source recipes, shared ingredients, pairings and techniques.
2. Write a genuinely new recipe: combine techniques and flavour patterns from the sources, prefer pantry ingredients, keep quantities realistic for the servings, and respect any diet or allergen constraints.
3. Show it to the user. If they want to keep it, save it with `pb_save_recipe`: `source: {kind: "synthesized"}`, `derived_from` = only the slugs you actually drew on, no `provider`, structured ingredients (`source: "kitchen"` for pantry items) and steps (`techniques`, `uses`), tags, and a `blurb`. It then shows up in search and the graph, linked to its sources.

## Tidy the catalog
- After saving, `new_ingredients` lists names the catalog didn't know. If one is really an existing ingredient under another name, `pb_merge_ingredients {from, into}` fixes every recipe and remembers the alias.
