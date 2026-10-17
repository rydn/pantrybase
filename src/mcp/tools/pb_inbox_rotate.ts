import { z } from "zod";
import { rotateItem } from "../../ingest/inbox.js";
import { defineTool, text } from "../define-tool.js";

export default defineTool({
  name: "pb_inbox_rotate",
  description:
    "Turn a photo upright when its text runs sideways or upside down (camera orientation flags are already " +
    "applied, so this is for photos whose pixels are rotated). Degrees are clockwise: text reading bottom-to-top " +
    "needs 90, upside down needs 180, top-to-bottom needs 270. The file is fixed on disk (HEIC becomes JPEG), so " +
    "the archive, thumbnails and retake detection all see the upright photo. Call before pb_inbox_image when " +
    "pb_inbox_next gives a rotation_hint, or after a photo shows up sideways; view it again to confirm.",
  schema: {
    id: z.number().int(),
    degrees: z.union([z.literal(90), z.literal(180), z.literal(270)]),
  },
  handler: async ({ id, degrees }, ctx) =>
    text({ rotated: degrees, item: await rotateItem(ctx, id, degrees) }),
});
