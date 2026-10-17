import type { AppContext } from "../core/context.js";
import { slugify, uniqueSlug } from "../files/slug.js";
import { recipeFileExists, writeRecipeFile } from "../files/store.js";
import { finalizeAttach, mergeImages, planAttach } from "../ingest/inbox.js";
import type { DuplicateCandidate, ImageSide } from "../types.js";
import type { EnrichReport } from "./enrich.js";
import { prepareRecipe } from "./pipeline.js";
import { normalizeName, normalizeRecipe, type RecipeInput } from "./schema.js";

export interface SaveOptions {
  allow_duplicate?: boolean;
  /** Inbox photos of this card; archived to images/<slug>/ and marked done. */
  ingest?: Array<{ id: number; side: ImageSide }>;
}

export type SaveResult =
  | {
      saved: true;
      slug: string;
      file: string;
      updated: boolean;
      new_ingredients: string[];
      aliased: Array<{ from: string; to: string }>;
      vocabulary: Omit<EnrichReport, "provider">;
      provider_rules: string[];
      unmatched_uses: string[];
      needs_review: boolean;
      images: string[];
    }
  | { saved: false; already_ingested: true; slug: string }
  | { saved: false; duplicate_of: DuplicateCandidate[] }
  | { saved: false; error: string };

/**
 * Validate, enrich and resolve, then write the markdown (source of truth), index it, and only
 * then move the card's photos into images/<slug>/ — so a failure never leaves photos orphaned.
 */
export function saveRecipe(
  ctx: AppContext,
  input: RecipeInput,
  opts: SaveOptions = {},
): SaveResult {
  const ingest = opts.ingest ?? [];
  // Re-sending a card whose photos are all attached already is a no-op (safe to retry).
  if (ingest.length) {
    const items = ctx.store.ingestByIds(ingest.map((i) => i.id));
    const slugs = new Set(items.map((i) => i.recipe_slug));
    const first = items[0];
    const owner = first?.recipe_slug ? ctx.store.getRecipe(first.recipe_slug) : undefined;
    const sameRecipe =
      owner !== undefined &&
      (input.slug === owner.slug || normalizeName(input.title) === normalizeName(owner.title));
    if (
      items.length === ingest.length &&
      items.every((i) => i.status === "done") &&
      slugs.size === 1 &&
      owner &&
      sameRecipe &&
      // An update that changes the recipe is a real save, not a retry.
      !input.slug
    ) {
      return { saved: false, already_ingested: true, slug: owner.slug };
    }
  }

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

  const plan = planAttach(ctx, slug, ingest);
  if (plan.errors.length) return { saved: false, error: plan.errors.join("; ") };

  const today = new Date().toISOString().slice(0, 10);
  const source = input.source ?? existing?.source ?? { kind: "manual" as const };
  const recipe = normalizeRecipe(
    {
      ...input,
      source: { ...source, ingested: source.ingested ?? existing?.source.ingested ?? today },
    },
    slug,
  );

  if (plan.targets.length || existing) {
    const merged = mergeImages(
      {
        images: [...(existing?.images ?? []), ...recipe.images],
        extraction: existing?.extraction,
      },
      plan.targets,
      recipe.extraction?.images,
    );
    recipe.images = merged.images;
    if (merged.extraction.length) {
      recipe.extraction = { ...(recipe.extraction ?? {}), images: merged.extraction };
    }
  }

  const prepared = prepareRecipe(ctx, recipe);
  const file = writeRecipeFile(ctx.paths, prepared.recipe);
  ctx.store.upsertRecipe(prepared.recipe, file, prepared.ingredientIds);
  finalizeAttach(ctx, slug, plan.targets);
  ctx.embedQueue.kick();

  const { provider, ...vocabulary } = prepared.report;
  return {
    saved: true,
    slug,
    file: file.file_path,
    updated: existing !== undefined,
    new_ingredients: prepared.resolution.created,
    aliased: prepared.resolution.aliased.map(({ from, to }) => ({ from, to })),
    vocabulary,
    provider_rules: provider,
    unmatched_uses: prepared.unmatched_uses,
    needs_review: prepared.recipe.extraction?.needs_review ?? false,
    images: prepared.recipe.images,
  };
}
