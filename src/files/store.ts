import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { DataPaths } from "../config.js";
import type { FileStat, Recipe } from "../types.js";
import { serializeRecipe } from "./recipe-md.js";

export function recipeFilePath(paths: DataPaths, slug: string): string {
  return path.join(paths.recipes, `${slug}.md`);
}

export function relativeToData(paths: DataPaths, abs: string): string {
  return path.relative(paths.data, abs).split(path.sep).join("/");
}

export function hashContent(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

/** Write the markdown atomically (tmp + rename) and return the stat the DB records. */
export function writeRecipeFile(paths: DataPaths, recipe: Recipe): FileStat {
  const abs = recipeFilePath(paths, recipe.slug);
  const content = serializeRecipe(recipe);
  const tmp = `${abs}.tmp-${process.pid}`;
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, abs);
  const st = fs.statSync(abs);
  return {
    file_path: relativeToData(paths, abs),
    file_mtime: st.mtimeMs,
    file_size: st.size,
    content_hash: hashContent(content),
  };
}

export function recipeFileExists(paths: DataPaths, slug: string): boolean {
  return fs.existsSync(recipeFilePath(paths, slug));
}
