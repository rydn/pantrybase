import { z } from "zod";
import { recipeInputSchema } from "../../recipes/schema.js";
import { saveRecipe } from "../../recipes/service.js";
import { IMAGE_SIDES } from "../../types.js";
import { defineTool, text } from "../define-tool.js";

export default defineTool({
  name: "pb_save_recipe",
  description:
    "Save a recipe (new or, with `slug`, an update). Writes pantrybase/recipes/<slug>.md as the source of truth and indexes it. " +
    "For meal-box cards read pb_providers {id} first and follow its guide; set provider.id so its rules apply. " +
    "Pass `ingest` with every inbox photo of the card ({id, side}) — they are archived to images/<slug>/ and marked done; " +
    "re-sending already-attached photos is a safe no-op. " +
    "Ingredients need `raw` (as printed) and `canonical` (generic singular name, no brand) plus source box|kitchen. " +
    "Steps are objects {title, text, techniques, uses, equipment, temp_c, minutes} (plain strings are accepted). " +
    "Tags by category (protein, diet, starch, flavor, texture, cuisine, dish, meal, method, time, season, other) are " +
    "normalised against the vocabulary. Write a `blurb` in your own words for semantic search and record unreadable " +
    "fields in extraction.uncertain. Returns {saved, slug, …} or {saved:false, duplicate_of:[…]} — if it is a different " +
    "recipe pass allow_duplicate:true; if it is the same card, attach the photos to that slug or skip them.",
  schema: {
    ...recipeInputSchema.shape,
    ingest: z
      .array(z.object({ id: z.number().int(), side: z.enum(IMAGE_SIDES) }))
      .optional()
      .describe(
        "Inbox photos of this card, e.g. [{id: 12, side: 'front'}, {id: 13, side: 'back'}]",
      ),
    allow_duplicate: z.boolean().optional(),
  },
  handler: ({ allow_duplicate, ingest, ...input }, ctx) => {
    return text(saveRecipe(ctx, input, { allow_duplicate, ingest }));
  },
});
