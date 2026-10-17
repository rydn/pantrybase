import { z } from "zod";
import { recipeInputSchema } from "../../recipes/schema.js";
import { saveRecipe } from "../../recipes/service.js";
import { defineTool, text } from "../define-tool.js";

export default defineTool({
  name: "pb_save_recipe",
  description:
    "Save a recipe (new or, with `slug`, an update). Writes pantrybase/recipes/<slug>.md as the source of truth and indexes it. " +
    "For meal-box cards read pb_providers {id} first and follow its guide; set provider.id so its rules apply. " +
    "Ingredients need `raw` (as printed) and `canonical` (generic singular name, no brand) plus source box|kitchen. " +
    "Steps are objects {title, text, techniques, uses, equipment, temp_c, minutes} (plain strings are accepted). " +
    "Tags by category (protein, diet, starch, flavor, texture, cuisine, dish, meal, method, time, season, other) are " +
    "normalised against the vocabulary. Write a `blurb` in your own words for semantic search and record unreadable " +
    "fields in extraction.uncertain. Returns {saved, slug, new_ingredients, vocabulary:{mapped,new_tags,rejected}, …} " +
    "or {saved:false, duplicate_of:[…]} — pass allow_duplicate:true if it really is a different recipe.",
  schema: {
    ...recipeInputSchema.shape,
    allow_duplicate: z.boolean().optional(),
  },
  handler: ({ allow_duplicate, ...input }, ctx) => {
    const result = saveRecipe(ctx, input, { allow_duplicate });
    return text(result);
  },
});
