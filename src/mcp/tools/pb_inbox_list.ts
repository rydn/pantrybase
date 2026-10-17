import { z } from "zod";
import { viewItem } from "../../ingest/inbox.js";
import { INGEST_STATUSES } from "../../types.js";
import { defineTool, text } from "../define-tool.js";

export default defineTool({
  name: "pb_inbox_list",
  description:
    "Photo queue counts plus a page of photos (optionally by status: pending, done, skipped, failed), in capture order.",
  schema: {
    status: z.enum(INGEST_STATUSES).optional(),
    limit: z.number().int().min(1).max(200).optional().describe("default 20"),
    offset: z.number().int().min(0).optional(),
  },
  handler: ({ status, limit, offset }, ctx) => {
    const items = ctx.store.listIngest({ status, limit: limit ?? 20, offset });
    return text({ counts: ctx.store.ingestCounts(), items: items.map((i) => viewItem(i)) });
  },
});
