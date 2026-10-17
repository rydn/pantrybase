import type { AppContext } from "../core/context.js";
import { findCanonical, type Resolution, resolveIngredients } from "../ingredients/normalize.js";
import type { Recipe } from "../types.js";
import { type EnrichReport, enrichRecipe } from "./enrich.js";
import { normalizeName } from "./schema.js";

export interface Prepared {
  recipe: Recipe;
  ingredientIds: Map<string, number>;
  resolution: Resolution;
  report: EnrichReport;
  /** Step `uses` names that matched no ingredient (kept as text, no graph edge). */
  unmatched_uses: string[];
}

/**
 * Everything between a parsed recipe and the index: provider rules, vocabulary, ingredient
 * resolution, and rewriting step `uses` onto the resolved canonical names. Idempotent, so it
 * runs both on save and when reconciling files.
 */
export function prepareRecipe(ctx: AppContext, recipe: Recipe): Prepared {
  const profile = recipe.provider ? ctx.providers.resolve(recipe.provider.id) : undefined;
  const originals = new Map(recipe.ingredients.map((i) => [i, i.canonical]));
  const report = enrichRecipe(recipe, ctx.vocab, profile);

  const resolution = resolveIngredients(ctx.store, recipe.ingredients);
  const rename = new Map<string, string>();
  recipe.ingredients.forEach((ing, idx) => {
    const final = resolution.ingredients[idx]?.canonical;
    if (!final) return;
    rename.set(ing.canonical, final);
    const original = originals.get(ing);
    if (original) rename.set(original, final);
  });
  recipe.ingredients = resolution.ingredients;

  const ingredientIds = new Map(resolution.ids);
  const unmatched: string[] = [];
  for (const step of recipe.steps) {
    if (!step.uses?.length) continue;
    const uses: string[] = [];
    for (const raw of step.uses) {
      const name = normalizeName(raw);
      let final = rename.get(name);
      if (!final) {
        const known = findCanonical(ctx.store, name);
        if (known) {
          final = known;
          const row = ctx.store.getIngredient(known);
          if (row) ingredientIds.set(row.canonical, row.id);
        }
      }
      if (!final) {
        unmatched.push(name);
        final = name;
      }
      if (!uses.includes(final)) uses.push(final);
    }
    step.uses = uses;
  }

  return {
    recipe,
    ingredientIds,
    resolution,
    report,
    unmatched_uses: [...new Set(unmatched)],
  };
}
