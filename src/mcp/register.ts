import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { log } from "../config.js";
import { openContext } from "../core/context.js";
import { errorResult, type ToolDef } from "./define-tool.js";

const projectRootField = {
  project_root: z
    .string()
    .optional()
    .describe("Project directory whose ./pantrybase data to use (default: the server's cwd)"),
};

export function registerTools(server: McpServer, tools: ToolDef[]): void {
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: { ...tool.schema, ...projectRootField },
      },
      async (args) => {
        const { project_root, ...rest } = args as Record<string, unknown> & {
          project_root?: string;
        };
        try {
          const ctx = openContext(project_root);
          ctx.sync();
          return await tool.handler(rest as never, ctx);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          log(`${tool.name} failed:`, msg);
          return errorResult(`${tool.name}: ${msg}`);
        }
      },
    );
  }
}
