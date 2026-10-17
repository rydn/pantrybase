import { z } from "zod";
import { reconcile } from "../../files/reconcile.js";
import { loadCatalog } from "../../ingredients/normalize.js";
import { defineTool, text } from "../define-tool.js";

export default defineTool({
  name: "pb_rebuild",
  description:
    "Re-sync the index from pantrybase/recipes/*.md and ingredients.yaml (markdown is the source of truth). " +
    "Default is incremental (mtime/hash); full:true re-parses every file and re-embeds.",
  schema: {
    full: z.boolean().optional(),
  },
  handler: ({ full }, ctx) => {
    const catalog = loadCatalog(ctx.store, ctx.paths.ingredientsYaml);
    const result = reconcile(ctx, { full: full ?? false });
    return text({ catalog_entries: catalog, ...result });
  },
});
