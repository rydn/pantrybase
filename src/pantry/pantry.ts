import type { AppContext } from "../core/context.js";
import { findCanonical } from "../ingredients/normalize.js";
import { normalizeName } from "../recipes/schema.js";
import { expandFilters } from "../search/hybrid.js";
import type { IngredientRow, PantryItem, RequirementRow, SearchFilters } from "../types.js";

const FUZZY_THRESHOLD = 0.85;

function dice(a: string, b: string): number {
  const grams = (s: string) => {
    const g = new Map<string, number>();
    const t = ` ${s} `;
    for (let i = 0; i < t.length - 1; i++) {
      const k = t.slice(i, i + 2);
      g.set(k, (g.get(k) ?? 0) + 1);
    }
    return g;
  };
  const ga = grams(a);
  const gb = grams(b);
  let overlap = 0;
  for (const [k, n] of ga) overlap += Math.min(n, gb.get(k) ?? 0);
  const total =
    [...ga.values()].reduce((x, y) => x + y, 0) + [...gb.values()].reduce((x, y) => x + y, 0);
  return total === 0 ? 0 : (2 * overlap) / total;
}

export type MatchHow = "exact" | "alias" | "fuzzy" | "new";

/** Map a free-text item ("eggs", "baby marrow") onto the catalog; optionally create it. */
export function resolveItem(
  ctx: AppContext,
  raw: string,
  create: boolean,
): { row: IngredientRow; how: MatchHow } | undefined {
  const name = normalizeName(raw);
  if (!name) return undefined;
  const canonical = findCanonical(ctx.store, name);
  if (canonical) {
    const row = ctx.store.getIngredient(canonical);
    if (row) return { row, how: canonical === name ? "exact" : "alias" };
  }
  const best = ctx.store.fuzzyIngredients(name, 3)[0];
  if (best && dice(name, best.alias) >= FUZZY_THRESHOLD) {
    ctx.store.addAlias(best.row.id, name);
    return { row: best.row, how: "fuzzy" };
  }
  if (!create) return undefined;
  return { row: ctx.store.createIngredient({ canonical: name }), how: "new" };
}

export interface PantryInput {
  name: string;
  qty?: number | null;
  unit?: string | null;
  note?: string | null;
}

export function addToPantry(
  ctx: AppContext,
  items: PantryInput[],
): Array<{ name: string; canonical: string; matched: MatchHow }> {
  return ctx.store.transaction(() =>
    items.flatMap((item) => {
      const hit = resolveItem(ctx, item.name, true);
      if (!hit) return [];
      ctx.store.pantryUpsert(hit.row.id, item);
      return [{ name: item.name, canonical: hit.row.canonical, matched: hit.how }];
    }),
  );
}

export function removeFromPantry(
  ctx: AppContext,
  names: string[],
): { removed: string[]; not_in_pantry: string[] } {
  const inPantry = new Map(ctx.store.pantryList().map((p) => [p.ingredient_id, p.canonical]));
  const removed: string[] = [];
  const missing: string[] = [];
  const ids: number[] = [];
  for (const n of names) {
    const hit = resolveItem(ctx, n, false);
    if (hit && inPantry.has(hit.row.id)) {
      ids.push(hit.row.id);
      removed.push(hit.row.canonical);
    } else {
      missing.push(n);
    }
  }
  ctx.store.pantryRemove(ids);
  return { removed, not_in_pantry: missing };
}

export function listPantry(ctx: AppContext): PantryItem[] {
  return ctx.store.pantryList();
}

export interface MatchOptions {
  /** Ad-hoc ingredients ("what I have right now"), added to the persisted pantry unless use_pantry is false. */
  ingredients?: string[];
  use_pantry?: boolean;
  min_coverage?: number;
  max_missing?: number;
  limit?: number;
  filters?: SearchFilters;
  /** Restrict to these recipes (used by synthesis and search re-ranking). */
  recipe_ids?: number[];
}

export interface RecipeMatch {
  slug: string;
  title: string;
  /** Share of required (non-staple, non-optional) ingredients available, 0–1. */
  coverage: number;
  have: number;
  need: number;
  missing: Array<{ canonical: string; raw: string }>;
  from_pantry: string[];
  near_miss: boolean;
}

interface Extra {
  alternatives?: string[];
  components?: Array<{ canonical: string }>;
}

export function availableIngredients(
  ctx: AppContext,
  opts: Pick<MatchOptions, "ingredients" | "use_pantry">,
): { ids: Set<number>; unknown: string[] } {
  const ids = new Set<number>();
  if (opts.use_pantry !== false) for (const p of ctx.store.pantryList()) ids.add(p.ingredient_id);
  const unknown: string[] = [];
  for (const raw of opts.ingredients ?? []) {
    const hit = resolveItem(ctx, raw, false);
    if (hit) ids.add(hit.row.id);
    else unknown.push(raw);
  }
  return { ids, unknown };
}

/** Is a recipe line covered by what's available (itself, a printed alternative, or all its components)? */
export function lineAvailable(
  ctx: AppContext,
  line: RequirementRow,
  avail: Set<number>,
  cache: Map<string, number | null>,
): boolean {
  if (avail.has(line.ingredient_id)) return true;
  if (!line.extra) return false;
  const extra = JSON.parse(line.extra) as Extra;
  const idOf = (name: string) => {
    if (!cache.has(name))
      cache.set(name, ctx.store.getIngredient(findCanonical(ctx.store, name) ?? name)?.id ?? null);
    return cache.get(name) ?? null;
  };
  if (
    extra.alternatives?.some((a) => {
      const id = idOf(a);
      return id !== null && avail.has(id);
    })
  ) {
    return true;
  }
  const comps = extra.components ?? [];
  return (
    comps.length > 0 &&
    comps.every((c) => {
      const id = idOf(c.canonical);
      return id !== null && avail.has(id);
    })
  );
}

export function scoreRecipes(
  ctx: AppContext,
  avail: Set<number>,
  recipeIds?: number[],
): RecipeMatch[] {
  const rows = ctx.store.recipeRequirements(recipeIds);
  const cache = new Map<string, number | null>();
  const byRecipe = new Map<number, RequirementRow[]>();
  for (const r of rows) {
    const list = byRecipe.get(r.recipe_id) ?? [];
    list.push(r);
    byRecipe.set(r.recipe_id, list);
  }
  const out: RecipeMatch[] = [];
  for (const lines of byRecipe.values()) {
    const first = lines[0];
    if (!first) continue;
    const required = lines.filter((l) => !l.staple && !l.optional);
    const missing: RecipeMatch["missing"] = [];
    const fromPantry: string[] = [];
    for (const l of required) {
      if (lineAvailable(ctx, l, avail, cache)) fromPantry.push(l.canonical);
      else missing.push({ canonical: l.canonical, raw: l.raw });
    }
    const need = required.length;
    const have = need - missing.length;
    out.push({
      slug: first.slug,
      title: first.title,
      coverage: need === 0 ? 1 : Math.round((have / need) * 100) / 100,
      have,
      need,
      missing,
      from_pantry: fromPantry,
      near_miss: missing.length > 0 && missing.length <= 2,
    });
  }
  return out.sort(
    (a, b) =>
      b.coverage - a.coverage ||
      a.missing.length - b.missing.length ||
      a.title.localeCompare(b.title),
  );
}

/** "What can I cook?" — recipes ranked by how much of them the pantry (plus ad-hoc items) covers. */
export function matchRecipes(
  ctx: AppContext,
  opts: MatchOptions = {},
): { results: RecipeMatch[]; available: number; unknown_ingredients: string[] } {
  const { ids, unknown } = availableIngredients(ctx, opts);
  const allowed = ctx.store.filterRecipeIds(expandFilters(ctx, opts.filters));
  let scope = opts.recipe_ids;
  if (allowed) scope = scope ? scope.filter((id) => allowed.has(id)) : [...allowed];
  const minCoverage = opts.min_coverage ?? 0;
  const results = scoreRecipes(ctx, ids, scope)
    .filter((m) => m.coverage >= minCoverage)
    .filter((m) => opts.max_missing === undefined || m.missing.length <= opts.max_missing)
    .slice(0, Math.min(Math.max(opts.limit ?? 10, 1), 100));
  return { results, available: ids.size, unknown_ingredients: unknown };
}
