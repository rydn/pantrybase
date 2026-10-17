import { z } from "zod";
import { synthesisContext } from "../../synthesis/context.js";
import { ALL_CATEGORIES } from "../../types.js";
import { defineTool, text } from "../define-tool.js";

export default defineTool({
  name: "pb_synthesis_context",
  description:
    "Material for inventing a new recipe from the collection: a few relevant source recipes in compact form, the " +
    "ingredients, pairings, techniques, cuisines and flavours they share, and (with use_pantry) what the pantry covers " +
    "and what is commonly missing. Pick sources by `query`, explicit `slugs`, pantry fit, or tag filters. Then write " +
    "the recipe and save it with pb_save_recipe (source.kind 'synthesized', derived_from the slugs you drew on).",
  schema: {
    query: z.string().optional().describe('What to make, e.g. "quick spicy noodle dinner"'),
    slugs: z.array(z.string()).optional(),
    use_pantry: z.boolean().optional(),
    ingredients: z.array(z.string()).optional().describe("Extra things available right now"),
    tags: z.partialRecord(z.enum(ALL_CATEGORIES), z.array(z.string())).optional(),
    exclude_allergens: z.array(z.string()).optional(),
    max_total_min: z.number().optional(),
    n: z.number().int().min(1).max(12).optional().describe("Number of source recipes (default 5)"),
  },
  handler: async ({ query, slugs, use_pantry, ingredients, n, ...filters }, ctx) =>
    text(await synthesisContext(ctx, { query, slugs, use_pantry, ingredients, n, filters })),
});
