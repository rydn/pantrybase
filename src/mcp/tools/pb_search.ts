import { z } from "zod";
import { searchRecipes } from "../../search/hybrid.js";
import { ALL_CATEGORIES, SOURCE_KINDS } from "../../types.js";
import { defineTool, text } from "../define-tool.js";

export default defineTool({
  name: "pb_search",
  description:
    "Search recipes: hybrid keyword + semantic ranking (RRF) over title, blurb, ingredients and method, with filters. " +
    "Omit `query` to just filter/browse. Tag filters accept any category — assigned tags (cuisine, diet, dish, protein, flavor…) " +
    "and derived facets (allergen, equipment, technique, chef, provider, plan); parents expand (cuisine:asian matches thai). " +
    "Returns compact summaries; use pb_get_recipe for details.",
  schema: {
    query: z
      .string()
      .optional()
      .describe("Free text: dish, ingredient, technique, mood, occasion…"),
    limit: z.number().int().min(1).max(100).optional().describe("default 10"),
    tags: z
      .partialRecord(z.enum(ALL_CATEGORIES), z.array(z.string()))
      .optional()
      .describe("e.g. {cuisine:['thai'], diet:['vegetarian']} — OR within a category, AND across"),
    exclude_allergens: z.array(z.string()).optional().describe('e.g. ["dairy", "tree-nuts"]'),
    exclude_ingredients: z.array(z.string()).optional(),
    max_total_min: z.number().optional(),
    max_active_min: z.number().optional().describe("Hands-on minutes"),
    provider: z.string().optional(),
    source_kind: z.enum(SOURCE_KINDS).optional(),
    needs_review: z.boolean().optional().describe("true = only recipes flagged for review"),
    mode: z.enum(["hybrid", "lexical", "semantic"]).optional(),
  },
  handler: async ({ query, limit, mode, ...filters }, ctx) => {
    const res = await searchRecipes(ctx, { query, limit, mode, filters });
    return text({
      count: res.results.length,
      vector_used: res.vector_used,
      results: res.results.map((r) => ({
        slug: r.slug,
        title: r.title,
        subtitle: r.subtitle,
        blurb: r.blurb,
        active_min: r.active_min,
        total_min: r.total_min,
        tags: r.tags,
        allergens: r.allergens.length ? r.allergens : undefined,
        needs_review: r.needs_review || undefined,
        score: r.score,
        matched: r.matched,
      })),
    });
  },
});
