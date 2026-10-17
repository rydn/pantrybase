import { z } from "zod";
import { recipeInputSchema } from "../../recipes/schema.js";
import { saveRecipe } from "../../recipes/service.js";
import { defineTool, text } from "../define-tool.js";

export default defineTool({
  name: "pb_save_recipe",
  description:
    "Save a recipe (new or, with `slug`, an update). Writes pantrybase/recipes/<slug>.md as the source of truth and indexes it. " +
    "Ingredients need `raw` (as written) and `canonical` (normalised singular name); mark staples. " +
    "Tags are grouped by category: protein, diet, starch, flavor, cuisine, meal, method, time, season, other. " +
    "Returns {saved, slug, new_ingredients} or {saved:false, duplicate_of:[…]} — pass allow_duplicate:true if it really is a different recipe.",
  schema: {
    ...recipeInputSchema.shape,
    allow_duplicate: z.boolean().optional(),
  },
  handler: ({ allow_duplicate, ...input }, ctx) => {
    const result = saveRecipe(ctx, input, { allow_duplicate });
    return text(result);
  },
});
