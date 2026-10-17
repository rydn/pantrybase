import { z } from "zod";
import { resolveItems } from "../../ingest/inbox.js";
import { defineTool, text } from "../define-tool.js";

export default defineTool({
  name: "pb_inbox_resolve",
  description:
    "Set aside photos you won't save: 'skipped' (retake, not a recipe, duplicate of a saved card) or 'failed' " +
    "(unreadable — say why); 'pending' puts them back in the queue. Files move to inbox/skipped/ or inbox/failed/ " +
    "with the reason beside them, so the state survives rebuilds. Photos attached to a recipe can't be resolved.",
  schema: {
    ids: z.array(z.number().int()).min(1),
    status: z.enum(["skipped", "failed", "pending"]),
    reason: z.string().optional().describe('e.g. "retake of #12", "back of card too blurry"'),
  },
  handler: ({ ids, status, reason }, ctx) => {
    const r = resolveItems(ctx, ids, status, reason);
    return text({ ...r, queue: ctx.store.ingestCounts() });
  },
});
