import { z } from "zod";
import { nextBatch } from "../../ingest/inbox.js";
import { defineTool, text } from "../define-tool.js";

export default defineTool({
  name: "pb_inbox_next",
  description:
    "The next pending inbox photos in capture order, plus queue progress. Cards are usually shot front then back " +
    "(a back has no title), so look at the photos in order with pb_inbox_image, group the ones that belong to one card, " +
    "and save it with pb_save_recipe {ingest:[{id, side}]}. `retake_of` flags a near-identical photo: attach it as an " +
    "extra image or skip it with pb_inbox_resolve.",
  schema: {
    window: z
      .number()
      .int()
      .min(1)
      .max(12)
      .optional()
      .describe("How many photos to return (default 4)"),
  },
  handler: ({ window }, ctx) => {
    const { progress, items } = nextBatch(ctx, window ?? 4);
    if (items.length === 0) return text({ progress, items: [], done: true });
    return text({ progress, items });
  },
});
