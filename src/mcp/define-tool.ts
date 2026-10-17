import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { z } from "zod";
import type { AppContext } from "../core/context.js";

export type ToolResult = CallToolResult;

export interface ToolDef<S extends z.ZodRawShape = z.ZodRawShape> {
  name: string;
  description: string;
  schema: S;
  handler: (args: z.infer<z.ZodObject<S>>, ctx: AppContext) => Promise<ToolResult> | ToolResult;
}

export function defineTool<S extends z.ZodRawShape>(def: ToolDef<S>): ToolDef<S> {
  return def;
}

/** Compact JSON (or plain text) result — Claude's context is the scarce resource. */
export function text(value: unknown): ToolResult {
  const body = typeof value === "string" ? value : JSON.stringify(value);
  return { content: [{ type: "text", text: body }] };
}

export function errorResult(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}
