import { packageVersion } from "../../config.js";
import { startUiServer } from "../../web/server.js";
import { defineTool, text } from "../define-tool.js";

export default defineTool({
  name: "pb_open_ui",
  description:
    "Start (or find) the local pantrybase web UI for this project and return its URL — search with facets, recipe " +
    "pages, the pantry and 'what can I cook', photo upload and the inbox queue, and the knowledge graph explorer. " +
    "Give the user the URL; it is served on 127.0.0.1 only.",
  schema: {},
  handler: async (_args, ctx) => {
    const ui = await startUiServer(ctx, { version: packageVersion() });
    return text({ url: ui.url, data_dir: ctx.paths.data });
  },
});
