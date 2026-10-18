---
name: cook
description: Answer "what can I cook?" from the pantrybase recipe collection and the user's pantry, find recipes by ingredient, tag, cuisine, allergen or mood, plan several meals around shared ingredients with one grocery list, keep the pantry up to date, and invent new recipes grounded in the collection. Use when the user asks for meal ideas, what to make with what they have, recipes matching criteria, a meal plan or shopping list, a new recipe in the style of their collection, or to update their pantry.
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

## Plan meals around shared ingredients
Goal: a few dinners that share their shopping, then one grocery list. Keep the pantry honest along the way.
1. **Start.** The user names a recipe ("plan around the harissa chicken") → `pb_plan_suggest {seed}`; "plan me 4 dinners" with no favourite → `pb_pantry_match` or `pb_search` to find a starting point they like, then seed with it. Pass constraints as filters (`tags`, `exclude_allergens`, `max_total_min`).
2. **Suggest.** Each suggestion shows `shares` (already on the list for a planned recipe), `from_pantry`, `new` (what it adds) and `reuse` (share already covered). Lead with the top 3–4, say in a phrase *why* each fits ("shares the peppers and coriander, adds only feta"), and flag `repeats` (same dish again). For a full week at once, `pb_plan_suggest {seed, auto: n}` picks the set that minimises the whole list — show it and let the user swap items.
3. **Save.** When the user picks, `pb_plan {action: "add" | "set", slugs}`; `servings` scales quantities. The plan is shared with the web UI (`/plan`), so they can carry on there.
4. **Confirm the pantry before the list.** `pb_plan_shopping_list` returns `pantry_check`: the pantry items the plan counts on, with the amount needed and what the pantry says it has. Ask the user to confirm those are really there — one short question listing them — then call again with `confirmed` for the ones they have and `out_of` for the ones they don't (`out_of` leaves the pantry and moves onto the list). Skip the question only when `needs_confirmation` is already empty.
5. **Hand over the list.** Present `buy` grouped by `aisle` with amounts and which recipes use each item, mention the staples to check, and offer `format: "text"` for a paste-ready version. Don't add staples to the list.

## Invent a new recipe
1. `pb_synthesis_context` with a `query` for what the user wants, `use_pantry: true` if it should use what they have, and any filters. Read the source recipes, shared ingredients, pairings and techniques.
2. Write a genuinely new recipe: combine techniques and flavour patterns from the sources, prefer pantry ingredients, keep quantities realistic for the servings, and respect any diet or allergen constraints.
3. Show it to the user. If they want to keep it, save it with `pb_save_recipe`: `source: {kind: "synthesized"}`, `derived_from` = only the slugs you actually drew on, no `provider`, structured ingredients (`source: "kitchen"` for pantry items) and steps (`techniques`, `uses`), tags, and a `blurb`. It then shows up in search and the graph, linked to its sources.

## Tidy the catalog
- After saving, `new_ingredients` lists names the catalog didn't know. If one is really an existing ingredient under another name, `pb_merge_ingredients {from, into}` fixes every recipe and remembers the alias.
