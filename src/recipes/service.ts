import type { AppContext } from "../core/context.js";
import { slugify, uniqueSlug } from "../files/slug.js";
import { recipeFileExists, writeRecipeFile } from "../files/store.js";
import { resolveIngredients } from "../ingredients/normalize.js";
import type { DuplicateCandidate } from "../types.js";
import { normalizeName, normalizeRecipe, type RecipeInput } from "./schema.js";

export interface SaveOptions {
  allow_duplicate?: boolean;
}

export type SaveResult =
  | {
      saved: true;
      slug: string;
      file: string;
      updated: boolean;
      new_ingredients: string[];
      aliased: Array<{ from: string; to: string }>;
    }
  | { saved: false; duplicate_of: DuplicateCandidate[] };

/** Write the markdown first (source of truth), then index it. */
export function saveRecipe(
  ctx: AppContext,
  input: RecipeInput,
  opts: SaveOptions = {},
): SaveResult {
  const existing = input.slug ? ctx.store.getRecipe(input.slug) : undefined;

  if (!existing && !opts.allow_duplicate) {
    const dups = ctx.store.findDuplicates(
      input.title,
      input.ingredients.map((i) => normalizeName(i.canonical)),
    );
    if (dups.length > 0) return { saved: false, duplicate_of: dups };
  }

  const slug = existing
    ? existing.slug
    : uniqueSlug(
        input.slug ?? slugify(input.title),
        (s) => ctx.store.getRecipe(s) !== undefined || recipeFileExists(ctx.paths, s),
      );

  const today = new Date().toISOString().slice(0, 10);
  const source = input.source ?? existing?.source ?? { kind: "manual" as const };
  const recipe = normalizeRecipe(
    {
      ...input,
      source: { ...source, ingested: source.ingested ?? existing?.source.ingested ?? today },
    },
    slug,
  );
  const resolved = resolveIngredients(ctx.store, recipe.ingredients);
  recipe.ingredients = resolved.ingredients;

  const file = writeRecipeFile(ctx.paths, recipe);
  ctx.store.upsertRecipe(recipe, file, resolved.ids);
  ctx.embedQueue.kick();

  return {
    saved: true,
    slug,
    file: file.file_path,
    updated: existing !== undefined,
    new_ingredients: resolved.created,
    aliased: resolved.aliased.map(({ from, to }) => ({ from, to })),
  };
}
