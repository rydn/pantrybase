import { z } from "zod";
import { defineTool, errorResult, text } from "../define-tool.js";

export default defineTool({
  name: "pb_get_recipe",
  description:
    "Fetch one recipe by slug. format 'compact' (default) omits steps and file metadata; 'full' returns everything.",
  schema: {
    slug: z.string(),
    format: z.enum(["compact", "full"]).optional(),
  },
  handler: ({ slug, format }, ctx) => {
    const r = ctx.store.getRecipe(slug);
    if (!r) return errorResult(`no recipe with slug "${slug}"`);
    if (format === "full") return text(r);
    const {
      steps: _s,
      file_path: _f,
      file_mtime: _m,
      file_size: _z,
      content_hash: _h,
      ...compact
    } = r;
    return text({ ...compact, step_count: r.steps.length });
  },
});
