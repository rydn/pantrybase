import { z } from "zod";
import { TAG_CATEGORIES } from "../../types.js";
import { defineTool, text } from "../define-tool.js";

export default defineTool({
  name: "pb_list_tags",
  description:
    "List the tag vocabulary with recipe counts, grouped by category. Call once before a batch of saves and reuse existing names instead of inventing near-duplicates.",
  schema: {
    category: z.enum(TAG_CATEGORIES).optional(),
  },
  handler: ({ category }, ctx) => {
    const grouped: Record<string, Record<string, number>> = {};
    for (const t of ctx.store.listTags(category)) {
      const bucket = grouped[t.category] ?? {};
      bucket[t.name] = t.count;
      grouped[t.category] = bucket;
    }
    return text(grouped);
  },
});
