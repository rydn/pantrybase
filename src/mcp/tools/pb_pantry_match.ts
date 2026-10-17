import { z } from "zod";
import { matchRecipes } from "../../pantry/pantry.js";
import { ALL_CATEGORIES } from "../../types.js";
import { defineTool, text } from "../define-tool.js";

export default defineTool({
  name: "pb_pantry_match",
  description:
    "What can I cook? Ranks recipes by how much of their required ingredients the pantry covers (staples like salt, " +
    "oil and 'from your kitchen' items, and optional items, never count against a recipe; printed alternatives and " +
    "the parts of composite ingredients do count). Add `ingredients` for things you have right now; use_pantry:false " +
    "to match only those. Returns coverage, what's missing, and near misses (1–2 items short).",
  schema: {
    ingredients: z.array(z.string()).optional(),
    use_pantry: z.boolean().optional().describe("default true"),
    min_coverage: z.number().min(0).max(1).optional().describe("default 0.5"),
    max_missing: z.number().int().min(0).optional(),
    limit: z.number().int().min(1).max(50).optional().describe("default 10"),
    tags: z.partialRecord(z.enum(ALL_CATEGORIES), z.array(z.string())).optional(),
    exclude_allergens: z.array(z.string()).optional(),
    max_total_min: z.number().optional(),
  },
  handler: ({ ingredients, use_pantry, min_coverage, max_missing, limit, ...filters }, ctx) => {
    const r = matchRecipes(ctx, {
      ingredients,
      use_pantry,
      min_coverage: min_coverage ?? 0.5,
      max_missing,
      limit,
      filters,
    });
    return text({
      available_ingredients: r.available,
      unknown_ingredients: r.unknown_ingredients.length ? r.unknown_ingredients : undefined,
      results: r.results.map((m) => ({
        slug: m.slug,
        title: m.title,
        coverage: m.coverage,
        have: `${m.have}/${m.need}`,
        missing: m.missing.map((x) => x.canonical),
        near_miss: m.near_miss || undefined,
      })),
    });
  },
});
