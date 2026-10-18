---
name: plan/meal-planning-reuse-objective
kind: decision
tags: [meal-planning, shopping-list, pantry]
related: [file:src/plan/plan.ts, file:src/mcp/tools/pb_plan_suggest.ts, file:src/mcp/tools/pb_plan.ts, file:src/mcp/tools/pb_plan_shopping_list.ts, file:web/src/pages/plan.tsx, file:skills/cook/SKILL.md]
created: 2026-10-18T20:22:45.973Z
updated: 2026-10-18T20:22:45.973Z
---

Meal planning (built 2026-10-18) optimises the grocery run, not recipe similarity. Core in `src/plan/plan.ts`; MCP tools `pb_plan_suggest`, `pb_plan`, `pb_plan_shopping_list`; web page `/plan` (+ "Plan meals around this" on recipe pages); API `/api/plan`, `/api/plan/suggest`, `/api/plan/shopping`.

**Objective.** Each required (non-staple, non-optional) line of a recipe is classed as pantry / shared (already bought for another planned recipe, via `lineAvailable` so printed alternatives and composite parts count) / new. New items carry a waste weight by catalog category (herb 1.5, protein & seafood 1.3, vegetable/fruit/dairy 1.2, everything else 0.7). Per suggestion `reuse = weight(pantry+shared)/weight(required)`; per plan `reuse = 1 − weight(to buy)/Σ weight(required)`. Ranking = reuse − 0.15 per planned recipe sharing a `dish` tag (variety penalty, `variety:false` disables). Auto-fill is a beam search (width 4, fan-out 12) over the plan objective. Rejected: IDF/rarity weighting (sharing a common onion is still a saving), raw Jaccard (ignores pantry and waste), ILP (overkill at ≤14 meals), pure "fewest new items" (favours tiny recipes).

**Pantry confirmation.** The plan never trusts the pantry blindly: `shoppingList` returns `pantry_check` (items the plan takes from the pantry, with amount needed vs recorded qty) and `needs_confirmation`; `confirmed` names persist on the plan, `out_of` removes the item from the pantry and moves it onto the list. The skill tells Claude to ask one confirmation question before presenting the final list.

**Persistence.** One saved plan in the `meta` table (key `meal_plan`: `{items:[{slug, servings?}], confirmed, updated_at}`), shared by Claude and the UI, like the pantry it lives only in the DB (not a markdown source file). Quantities merge per canonical ingredient and unit (kg→g, l→ml, tbsp/tsp/tin aliases), scaled by wanted servings / recipe servings; aisles come from catalog category.

**Why:** the user asked for planning that "optimises for reuse of ingredients" and grocery shopping, with pantry items confirmed rather than assumed. **How to apply:** new scoring tweaks go in `wasteWeight`/`VARIETY_PENALTY`; keep `RequirementRow` (now with qty, unit, category) as the single source for both matching and planning; keep tool output compact.
