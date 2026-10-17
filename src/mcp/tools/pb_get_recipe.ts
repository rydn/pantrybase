import { z } from "zod";
import { defineTool, errorResult, text } from "../define-tool.js";

export default defineTool({
  name: "pb_get_recipe",
  description:
    "Fetch one recipe by slug. 'compact' (default) gives everything needed to cook or compare it — " +
    "ingredients (raw + canonical), step text, tags, allergens, nutrition — without file metadata or per-step graph detail; " +
    "'full' returns the complete stored record.",
  schema: {
    slug: z.string(),
    format: z.enum(["compact", "full"]).optional(),
  },
  handler: ({ slug, format }, ctx) => {
    const r = ctx.store.getRecipe(slug);
    if (!r) return errorResult(`no recipe with slug "${slug}"`);
    if (format === "full") return text(r);
    const {
      file_path: _f,
      file_mtime: _m,
      file_size: _z,
      content_hash: _h,
      id: _id,
      created_at: _c,
      updated_at: _u,
      extraction,
      ingredients,
      steps,
      ...rest
    } = r;
    return text({
      ...rest,
      ingredients: ingredients.map((i) => ({
        raw: i.raw,
        canonical: i.canonical,
        prep: i.prep,
        optional: i.optional,
        source: i.source,
        staple: i.staple,
      })),
      steps: steps.map((s) => (s.title ? `${s.title}: ${s.text}` : s.text)),
      needs_review: extraction?.needs_review || undefined,
      uncertain: extraction?.uncertain?.length ? extraction.uncertain : undefined,
    });
  },
});
