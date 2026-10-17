import { z } from "zod";
import { reconcile } from "../../files/reconcile.js";
import { defineTool, text } from "../define-tool.js";

export default defineTool({
  name: "pb_rebuild",
  description:
    "Re-sync the index from pantrybase/recipes/*.md (markdown is the source of truth), reloading ingredients.yaml, " +
    "vocabulary.yaml and provider profiles. Default is incremental (mtime/hash); full:true re-parses every file " +
    "(use after editing the vocabulary or catalog); reembed:true also recomputes all embeddings.",
  schema: {
    full: z.boolean().optional(),
    reembed: z.boolean().optional(),
  },
  handler: ({ full, reembed }, ctx) => {
    const reloaded = ctx.refresh(true);
    const result = reconcile(ctx, { full: full ?? false, reembed: reembed ?? false });
    return text({ reloaded, ...result });
  },
});
