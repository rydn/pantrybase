import { z } from "zod";
import { ALL_CATEGORIES } from "../../types.js";
import { defineTool, text } from "../define-tool.js";

export default defineTool({
  name: "pb_list_tags",
  description:
    "Tags and facets in use, with recipe counts, grouped by category. With vocabulary:true also returns the allowed " +
    "vocabulary (closed categories list every value). Call once before a batch of saves and reuse existing values.",
  schema: {
    category: z.enum(ALL_CATEGORIES).optional(),
    vocabulary: z.boolean().optional(),
  },
  handler: ({ category, vocabulary }, ctx) => {
    const used: Record<string, Record<string, number>> = {};
    for (const t of ctx.store.listTags(category)) {
      const bucket = used[t.category] ?? {};
      bucket[t.name] = t.count;
      used[t.category] = bucket;
    }
    if (!vocabulary) return text(used);
    const vocab = ctx.vocab.summary();
    return text({
      used,
      vocabulary: category ? { [category]: vocab[category] } : vocab,
    });
  },
});
