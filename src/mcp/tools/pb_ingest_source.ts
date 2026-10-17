import { z } from "zod";
import { importPaths } from "../../ingest/inbox.js";
import { defineTool, text } from "../define-tool.js";

export default defineTool({
  name: "pb_ingest_source",
  description:
    "Copy recipe photos (JPEG, PNG, WebP, HEIC, TIFF) from files or folders into pantrybase/inbox/ for extraction. " +
    "Originals are never moved or changed; photos already known (same bytes) are skipped. Folders are searched " +
    "recursively by default. Returns counts and the queue state; then work through it with pb_inbox_next.",
  schema: {
    paths: z
      .array(z.string())
      .min(1)
      .describe("Files or folders; relative to the project, absolute, or ~/…"),
    recursive: z.boolean().optional(),
  },
  handler: async ({ paths, recursive }, ctx) => {
    const r = await importPaths(ctx, paths, { recursive });
    return text({
      copied: r.copied,
      already_known: r.already_known,
      unsupported_files: r.unsupported,
      missing: r.missing.length ? r.missing : undefined,
      duplicates_parked: r.scan.duplicates.length || undefined,
      unreadable: r.scan.errors.length ? r.scan.errors : undefined,
      queue: ctx.store.ingestCounts(),
    });
  },
});
