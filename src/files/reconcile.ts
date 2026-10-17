import fs from "node:fs";
import path from "node:path";
import type { AppContext } from "../core/context.js";
import { prepareRecipe } from "../recipes/pipeline.js";
import { parseRecipe } from "./recipe-md.js";
import { hashContent, relativeToData } from "./store.js";

export interface ReconcileResult {
  added: number;
  updated: number;
  removed: number;
  unchanged: number;
  errors: Array<{ file: string; error: string }>;
}

/**
 * Bring the DB in line with recipes/*.md: skip by (mtime,size), then by content hash,
 * re-parse what changed, drop rows whose file is gone. `full` re-parses every file (e.g. after
 * a vocabulary or catalog edit); `reembed` also discards vectors so everything is re-embedded.
 */
export function reconcile(
  ctx: AppContext,
  opts: { full?: boolean; reembed?: boolean } = {},
): ReconcileResult {
  const res: ReconcileResult = { added: 0, updated: 0, removed: 0, unchanged: 0, errors: [] };
  const index = ctx.store.recipeFileIndex();
  const seen = new Set<string>();
  const files = fs.existsSync(ctx.paths.recipes)
    ? fs.readdirSync(ctx.paths.recipes).filter((f) => f.endsWith(".md") && !f.startsWith("."))
    : [];

  for (const name of files.sort()) {
    const abs = path.join(ctx.paths.recipes, name);
    const rel = relativeToData(ctx.paths, abs);
    seen.add(rel);
    const st = fs.statSync(abs);
    const prev = index.get(rel);
    if (
      !opts.full &&
      prev &&
      Math.round(prev.file_mtime) === Math.round(st.mtimeMs) &&
      prev.file_size === st.size
    ) {
      res.unchanged++;
      continue;
    }
    const content = fs.readFileSync(abs, "utf8");
    const hash = hashContent(content);
    if (!opts.full && prev && prev.content_hash === hash) {
      ctx.store.touchFile(rel, st.mtimeMs, st.size);
      res.unchanged++;
      continue;
    }
    try {
      const slug = name.slice(0, -3);
      const prepared = prepareRecipe(ctx, parseRecipe(content, slug));
      ctx.store.upsertRecipe(
        prepared.recipe,
        { file_path: rel, file_mtime: st.mtimeMs, file_size: st.size, content_hash: hash },
        prepared.ingredientIds,
      );
      if (prev) res.updated++;
      else res.added++;
    } catch (e) {
      res.errors.push({ file: rel, error: e instanceof Error ? e.message : String(e) });
    }
  }

  for (const [rel, entry] of index) {
    if (!seen.has(rel)) {
      ctx.store.deleteRecipe(entry.slug);
      res.removed++;
    }
  }
  if (opts.reembed) ctx.store.resetVectors();
  ctx.embedQueue.kick();
  return res;
}
