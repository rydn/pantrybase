import path from "node:path";
import { z } from "zod";
import { imageForModel, MODEL_MAX_PX } from "../../ingest/images.js";
import { defineTool, errorResult, type ToolResult } from "../define-tool.js";

export default defineTool({
  name: "pb_inbox_image",
  description:
    "Show one queued (or archived) photo as an image, resized for reading (long edge ≤ 1600px by default; ask for up " +
    "to 2400 if small print is unreadable). HEIC is converted automatically. If the text runs sideways or upside down, fix it with pb_inbox_rotate and look again.",
  schema: {
    id: z.number().int(),
    max_px: z.number().int().min(400).max(2400).optional(),
  },
  handler: async ({ id, max_px }, ctx): Promise<ToolResult> => {
    const [item] = ctx.store.ingestByIds([id]);
    if (!item) return errorResult(`no photo #${id}`);
    const img = await imageForModel(path.join(ctx.paths.data, item.path), max_px ?? MODEL_MAX_PX);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            id: item.id,
            name: item.original_name,
            status: item.status,
            captured_at: item.captured_at,
            shown: `${img.width}x${img.height}`,
          }),
        },
        { type: "image", data: img.data.toString("base64"), mimeType: img.mimeType },
      ],
    };
  },
});
