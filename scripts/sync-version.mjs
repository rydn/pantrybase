#!/usr/bin/env node
// Keep .claude-plugin/plugin.json's version equal to package.json's (run by `npm version`).
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const { version } = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const file = path.join(root, ".claude-plugin", "plugin.json");
const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
if (manifest.version !== version) {
  manifest.version = version;
  fs.writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`plugin.json version → ${version}`);
}
