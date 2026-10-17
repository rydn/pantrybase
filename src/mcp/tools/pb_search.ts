import { z } from "zod";
import { tagsSchema } from "../../recipes/schema.js";
import { searchRecipes } from "../../search/hybrid.js";
import { SOURCE_KINDS } from "../../types.js";
import { defineTool, text } from "../define-tool.js";

export default defineTool({
  name: "pb_search",
  description:
    "Search recipes. Hybrid keyword + semantic ranking (RRF) over title, ingredients and method, with filters. " +
    "Omit `query` to just filter/browse. Returns compact summaries; use pb_get_recipe for details.",
  schema: {
    query: z.string().optional().describe("Free text: dish, ingredient, technique, mood…"),
    limit: z.number().int().min(1).max(100).optional().describe("default 10"),
    tags: tagsSchema
      .optional()
      .describe("e.g. {cuisine:['thai'], diet:['vegetarian']} — OR within a category, AND across"),
    max_total_min: z.number().optional(),
    exclude_ingredients: z.array(z.string()).optional(),
    source_kind: z.enum(SOURCE_KINDS).optional(),
    mode: z.enum(["hybrid", "lexical", "semantic"]).optional(),
  },
  handler: async (
    { query, limit, tags, max_total_min, exclude_ingredients, source_kind, mode },
    ctx,
  ) => {
    const res = await searchRecipes(ctx, {
      query,
      limit,
      mode,
      filters: { tags, max_total_min, exclude_ingredients, source_kind },
    });
    return text({
      count: res.results.length,
      vector_used: res.vector_used,
      results: res.results.map((r) => ({
        slug: r.slug,
        title: r.title,
        summary: r.summary,
        total_min: r.total_min,
        tags: r.tags,
        score: r.score,
        matched: r.matched,
      })),
    });
  },
});
