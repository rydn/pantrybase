import { z } from "zod";
import { mergeIngredients } from "../../ingredients/merge.js";
import { defineTool, text } from "../define-tool.js";

export default defineTool({
  name: "pb_merge_ingredients",
  description:
    "Merge an ingredient into another when they are the same thing (e.g. 'pitted dates' into 'dates'). Rewrites every " +
    "recipe file that uses it, moves aliases and the pantry entry, and records the alias in ingredients.yaml so future " +
    "saves resolve to the target. Check pb_save_recipe's new_ingredients after a batch for candidates.",
  schema: {
    from: z.string().min(1),
    into: z.string().min(1),
  },
  handler: ({ from, into }, ctx) => text(mergeIngredients(ctx, from, into)),
});
