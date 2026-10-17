import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveProjectRoot } from "../../src/config.js";

describe("project root resolution", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("prefers an explicit root, then the plugin env, then CLAUDE_PROJECT_DIR, then cwd", () => {
    process.env.PANTRYBASE_PROJECT_ROOT = "/tmp/from-plugin";
    process.env.CLAUDE_PROJECT_DIR = "/tmp/from-claude";
    expect(resolveProjectRoot("/tmp/explicit")).toBe("/tmp/explicit");
    expect(resolveProjectRoot()).toBe("/tmp/from-plugin");
    delete process.env.PANTRYBASE_PROJECT_ROOT;
    expect(resolveProjectRoot()).toBe("/tmp/from-claude");
    delete process.env.CLAUDE_PROJECT_DIR;
    expect(resolveProjectRoot()).toBe(path.resolve(process.cwd()));
  });

  it("ignores an unsubstituted CLAUDE_PROJECT_DIR placeholder", () => {
    // What Claude Code passes through if it did not substitute the placeholder.
    process.env.PANTRYBASE_PROJECT_ROOT = "$" + "{CLAUDE_PROJECT_DIR}";
    delete process.env.CLAUDE_PROJECT_DIR;
    expect(resolveProjectRoot()).toBe(path.resolve(process.cwd()));
  });
});
