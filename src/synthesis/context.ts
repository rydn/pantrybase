import type { AppContext } from "../core/context.js";
import { availableIngredients, matchRecipes, scoreRecipes } from "../pantry/pantry.js";
import { searchRecipes } from "../search/hybrid.js";
import type { RecipeRecord, SearchFilters } from "../types.js";

export interface SynthesisOptions {
  /** What to cook, e.g. "a quick spicy noodle dinner". Drives recipe selection by search. */
  query?: string;
  /** Use these recipes instead of (or as well as) searching. */
  slugs?: string[];
  /** Prefer recipes the pantry covers, and report pantry coverage. */
  use_pantry?: boolean;
  /** Extra ingredients available right now. */
  ingredients?: string[];
  filters?: SearchFilters;
  /** How many source recipes (default 5). */
  n?: number;
}

const STEP_CHARS = 220;

function qtyText(i: RecipeRecord["ingredients"][number]): string {
  const amount = [i.qty, i.unit].filter((x) => x !== undefined && x !== null && x !== "").join(" ");
  return `${amount ? `${amount} ` : ""}${i.canonical}${i.prep ? ` (${i.prep})` : ""}${i.optional ? " [optional]" : ""}${i.staple ? " [staple]" : ""}`;
}

function compactRecipe(r: RecipeRecord) {
  return {
    slug: r.slug,
    title: r.title,
    subtitle: r.subtitle,
    blurb: r.blurb,
    serves: r.servings ?? undefined,
    minutes: r.time.total ?? undefined,
    tags: {
      cuisine: r.tags.cuisine,
      dish: r.tags.dish,
      flavor: r.tags.flavor,
      texture: r.tags.texture,
      protein: r.tags.protein,
      diet: r.tags.diet,
    },
    ingredients: r.ingredients.map(qtyText),
    steps: r.steps.map((s) => {
      const text = s.text.length > STEP_CHARS ? `${s.text.slice(0, STEP_CHARS - 1)}…` : s.text;
      const tech = s.techniques?.length ? ` [${s.techniques.join(", ")}]` : "";
      return `${text}${tech}`;
    }),
    tips: r.tips.length ? r.tips : undefined,
  };
}

function top(counts: Map<string, number>, n: number, min = 1): Array<[string, number]> {
  return [...counts.entries()]
    .filter(([, c]) => c >= min)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n);
}

function bump(map: Map<string, number>, key: string | undefined): void {
  if (key) map.set(key, (map.get(key) ?? 0) + 1);
}

/**
 * Everything Claude needs to write a new recipe grounded in the collection: a handful of
 * relevant source recipes (compact), what they share, and what the pantry covers.
 */
export async function synthesisContext(ctx: AppContext, opts: SynthesisOptions) {
  const n = Math.min(Math.max(opts.n ?? 5, 1), 12);
  const picked: string[] = [];
  const how: string[] = [];
  for (const s of opts.slugs ?? [])
    if (ctx.store.getRecipe(s) && !picked.includes(s)) picked.push(s);
  if (opts.slugs?.length) how.push("given slugs");

  if (picked.length < n && opts.query) {
    const res = await searchRecipes(ctx, {
      query: opts.query,
      filters: opts.filters,
      limit: n * 3,
    });
    let candidates = res.results.map((r) => r.slug);
    if (opts.use_pantry || opts.ingredients?.length) {
      // Among relevant recipes, prefer the ones the pantry covers best.
      const { ids } = availableIngredients(ctx, opts);
      const scores = new Map(
        scoreRecipes(
          ctx,
          ids,
          res.results.map((r) => r.id),
        ).map((m) => [m.slug, m.coverage]),
      );
      candidates = candidates
        .map((slug, rank) => ({ slug, score: 1 / (rank + 1) + (scores.get(slug) ?? 0) }))
        .sort((a, b) => b.score - a.score)
        .map((c) => c.slug);
      how.push("search re-ranked by pantry coverage");
    } else {
      how.push(`search${res.vector_used ? " (hybrid)" : " (keyword)"}`);
    }
    for (const s of candidates) if (picked.length < n && !picked.includes(s)) picked.push(s);
  } else if (picked.length < n && (opts.use_pantry || opts.ingredients?.length)) {
    for (const m of matchRecipes(ctx, { ...opts, limit: n * 2 }).results) {
      if (picked.length < n && !picked.includes(m.slug)) picked.push(m.slug);
    }
    how.push("pantry match");
  } else if (picked.length < n && !opts.slugs?.length) {
    // Nothing specific asked for: take recipes matching the filters.
    for (const r of (await searchRecipes(ctx, { filters: opts.filters, limit: n })).results) {
      if (picked.length < n && !picked.includes(r.slug)) picked.push(r.slug);
    }
    how.push("filters");
  }

  const recipes = picked.map((s) => ctx.store.getRecipe(s)).filter((r): r is RecipeRecord => !!r);

  const ingredientCounts = new Map<string, number>();
  const techniqueCounts = new Map<string, number>();
  const cuisineCounts = new Map<string, number>();
  const flavorCounts = new Map<string, number>();
  const pairs = new Map<string, number>();
  for (const r of recipes) {
    const core = [
      ...new Set(r.ingredients.filter((i) => !i.staple).map((i) => i.canonical)),
    ].sort();
    for (const c of core) bump(ingredientCounts, c);
    for (let i = 0; i < core.length; i++) {
      for (let j = i + 1; j < core.length; j++) bump(pairs, `${core[i]} + ${core[j]}`);
    }
    for (const t of new Set(r.steps.flatMap((s) => s.techniques ?? []))) bump(techniqueCounts, t);
    for (const c of r.tags.cuisine ?? []) bump(cuisineCounts, c);
    for (const f of r.tags.flavor ?? []) bump(flavorCounts, f);
  }

  let pantry: { have: string[]; missing_common: string[]; unknown: string[] } | undefined;
  if (opts.use_pantry || opts.ingredients?.length) {
    const { ids, unknown } = availableIngredients(ctx, opts);
    const haveNames = new Set(
      [...ingredientCounts.keys()].filter((name) => {
        const row = ctx.store.getIngredient(name);
        return row ? ids.has(row.id) : false;
      }),
    );
    pantry = {
      have: [...haveNames].sort(),
      missing_common: top(ingredientCounts, 30)
        .map(([name]) => name)
        .filter((name) => !haveNames.has(name))
        .slice(0, 12),
      unknown,
    };
  }

  return {
    selected_by: how.join(", ") || "none",
    recipes: recipes.map(compactRecipe),
    patterns: {
      common_ingredients: top(ingredientCounts, 15, recipes.length > 2 ? 2 : 1).map(
        ([k, v]) => `${k} ×${v}`,
      ),
      common_pairings: top(pairs, 10, 2).map(([k, v]) => `${k} ×${v}`),
      techniques: top(techniqueCounts, 10).map(([k, v]) => `${k} ×${v}`),
      cuisines: top(cuisineCounts, 6).map(([k]) => k),
      flavors: top(flavorCounts, 8).map(([k]) => k),
    },
    pantry,
    to_save:
      "Write a new recipe drawing on these (don't copy one). Save it with pb_save_recipe: source {kind: 'synthesized'}, " +
      `derived_from: [${recipes.map((r) => `'${r.slug}'`).join(", ")}] (only the ones you actually drew on), no provider, ` +
      "structured ingredients (source 'kitchen' for what the pantry has) and steps with techniques/uses, tags, and a blurb.",
  };
}
