import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { log } from "./config.js";
import { closeAllContexts } from "./core/context.js";
import { registerTools } from "./mcp/register.js";
import { tools } from "./mcp/tools/index.js";

const pkg = createRequire(import.meta.url)("../package.json") as { version: string };

async function main(): Promise<void> {
  if (process.argv.includes("--probe")) {
    process.stdout.write(
      `${JSON.stringify({ ok: true, name: "pantrybase", version: pkg.version, node: process.version, tools: tools.map((t) => t.name) })}\n`,
    );
    return;
  }

  const server = new McpServer({ name: "pantrybase", version: pkg.version });
  registerTools(server, tools);

  const shutdown = () => {
    closeAllContexts();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  process.stdin.on("end", shutdown);

  await server.connect(new StdioServerTransport());
  log(`pantrybase ${pkg.version} serving ${tools.length} tools over stdio`);
}

main().catch((e) => {
  log("fatal:", e);
  process.exit(1);
});
