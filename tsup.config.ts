import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/server.ts", "src/cli.ts"],
  format: ["esm"],
  target: "node22",
  platform: "node",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  splitting: true,
  // Native / heavy modules stay external so their own loaders and prebuilds work.
  external: ["better-sqlite3", "sqlite-vec", "sharp", "@huggingface/transformers"],
});
