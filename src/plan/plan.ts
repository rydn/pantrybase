import type { AppContext } from "../core/context.js";
import { availableIngredients, lineAvailable, removeFromPantry } from "../pantry/pantry.js";
import { expandFilters } from "../search/hybrid.js";
import type { RecipeSummary, RequirementRow, SearchFilters } from "../types.js";

/**
 * Meal planning around shared ingredients.
 *
 * The objective is the grocery run: a plan is good when the distinct things you have to buy are
 * few and each of them has more than one job. Every required ingredient line of a recipe ends up
 * in one of three buckets — already in the pantry, already on the list for another planned recipe
 * (shared), or new — and new items are weighted by how likely they are to go to waste when bought
 * for a single dish (fresh herbs and proteins cost more than a tin of beans).
 *
 *   reuse(recipe | plan)  = weight(pantry ∪ shared) / weight(required)         — per suggestion
 *   reuse(plan)           = 1 − weight(to buy) / Σ weight(required of each)    — whole plan
 *
 * Suggestions rank by reuse with a small penalty for repeating a dish already planned; auto-fill is
 * a beam search over that plan objective (greedy with a few alternatives kept), which is plenty at
 * weekly-plan sizes.
 */

export const PLAN_META_KEY = "meal_plan";

export interface PlanItem {
  slug: string;
  /** Portions wanted; quantities scale from the recipe's own servings. */
  servings?: number | null;
}

export interface StoredPlan {
  items: PlanItem[];
  /** Pantry items the user has confirmed are really there (canonical names). */
  confirmed: string[];
  updated_at: string;
}

export function getPlan(ctx: AppContext): StoredPlan {
  const raw = ctx.store.getMeta(PLAN_META_KEY);
  if (!raw) return { items: [], confirmed: [], updated_at: "" };
  try {
    const p = JSON.parse(raw) as Partial<StoredPlan>;
    return {
      items: (p.items ?? []).filter((i) => ctx.store.getRecipe(i.slug)),
      confirmed: p.confirmed ?? [],
      updated_at: p.updated_at ?? "",
    };
  } catch {
    return { items: [], confirmed: [], updated_at: "" };
  }
}

export function savePlan(ctx: AppContext, plan: Omit<StoredPlan, "updated_at">): StoredPlan {
  const seen = new Set<string>();
  const items: PlanItem[] = [];
  for (const i of plan.items) {
    if (seen.has(i.slug) || !ctx.store.getRecipe(i.slug)) continue;
    seen.add(i.slug);
    items.push(i.servings ? { slug: i.slug, servings: i.servings } : { slug: i.slug });
  }
  const stored: StoredPlan = {
    items,
    confirmed: [...new Set(plan.confirmed)],
    updated_at: new Date().toISOString(),
  };
  ctx.store.setMeta(PLAN_META_KEY, JSON.stringify(stored));
  return stored;
}

// --- weights and aisles -------------------------------------------------------------------------

/** How much it hurts to buy an ingredient for a single recipe: fresh things are the waste risk. */
const CATEGORY_WEIGHT: Record<string, number> = {
  herb: 1.5,
  protein: 1.3,
  seafood: 1.3,
  vegetable: 1.2,
  fruit: 1.2,
  dairy: 1.2,
};
const DEFAULT_WEIGHT = 0.7;

export function wasteWeight(category: string | null): number {
  return (category && CATEGORY_WEIGHT[category]) || DEFAULT_WEIGHT;
}

export const AISLE_ORDER = [
  "fruit & veg",
  "meat, fish & eggs",
  "dairy & chilled",
  "bakery & grains",
  "pantry",
  "spices",
  "other",
] as const;
export type Aisle = (typeof AISLE_ORDER)[number];

const AISLES: Record<string, Aisle> = {
  vegetable: "fruit & veg",
  fruit: "fruit & veg",
  herb: "fruit & veg",
  protein: "meat, fish & eggs",
  seafood: "meat, fish & eggs",
  dairy: "dairy & chilled",
  grain: "bakery & grains",
  legume: "pantry",
  baking: "pantry",
  nut: "pantry",
  stock: "pantry",
  oil: "pantry",
  condiment: "pantry",
  spice: "spices",
  seasoning: "spices",
};

export function aisleOf(category: string | null): Aisle {
  return (category && AISLES[category]) || "other";
}

// --- quantities ---------------------------------------------------------------------------------

/** unit as written → [canonical unit, multiplier]. Unknown units pass through unchanged. */
const UNITS: Record<string, [string, number]> = {
  g: ["g", 1],
  gram: ["g", 1],
  grams: ["g", 1],
  kg: ["g", 1000],
  ml: ["ml", 1],
  l: ["ml", 1000],
  litre: ["ml", 1000],
  liter: ["ml", 1000],
  tbsp: ["tbsp", 1],
  tbs: ["tbsp", 1],
  tablespoon: ["tbsp", 1],
  tablespoons: ["tbsp", 1],
  tsp: ["tsp", 1],
  teaspoon: ["tsp", 1],
  teaspoons: ["tsp", 1],
  piece: ["", 1],
  pieces: ["", 1],
  pc: ["", 1],
  pcs: ["", 1],
  x: ["", 1],
  whole: ["", 1],
  tin: ["tin", 1],
  tins: ["tin", 1],
  can: ["tin", 1],
  cans: ["tin", 1],
  cup: ["cup", 1],
  cups: ["cup", 1],
  bunch: ["bunch", 1],
  bunches: ["bunch", 1],
  clove: ["clove", 1],
  cloves: ["clove", 1],
  sachet: ["sachet", 1],
  sachets: ["sachet", 1],
  pack: ["pack", 1],
  packs: ["pack", 1],
  packet: ["pack", 1],
  slice: ["slice", 1],
  slices: ["slice", 1],
  sprig: ["sprig", 1],
  sprigs: ["sprig", 1],
};

interface Amount {
  qty: number;
  unit: string;
}

function toAmount(qty: number | null, unit: string | null, scale: number): Amount | undefined {
  if (qty === null || qty === undefined || !Number.isFinite(qty)) return undefined;
  const key = (unit ?? "").trim().toLowerCase();
  const [u, mult] = UNITS[key] ?? [key, 1];
  return { qty: qty * mult * scale, unit: u };
}

function fmtNumber(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

/** "650 g + 1 tin" — sums per unit, promotes g→kg and ml→l when large. */
export function formatAmount(parts: Amount[], unmeasured = 0): string | null {
  const sums = new Map<string, number>();
  for (const p of parts) sums.set(p.unit, (sums.get(p.unit) ?? 0) + p.qty);
  const out: string[] = [];
  for (const [unit, qty] of sums) {
    if (unit === "g" && qty >= 1000) out.push(`${fmtNumber(qty / 1000)} kg`);
    else if (unit === "ml" && qty >= 1000) out.push(`${fmtNumber(qty / 1000)} l`);
    else out.push(unit ? `${fmtNumber(qty)} ${unit}` : fmtNumber(qty));
  }
  if (unmeasured > 0 && out.length) out.push(`+${unmeasured} unmeasured`);
  return out.length ? out.join(" + ") : null;
}

// --- requirement profiles -----------------------------------------------------------------------

interface Profile {
  id: number;
  slug: string;
  title: string;
  required: RequirementRow[];
  optional: RequirementRow[];
  staples: RequirementRow[];
  /** Σ wasteWeight over required lines. */
  weight: number;
}

function loadProfiles(ctx: AppContext, ids?: number[]): Map<number, Profile> {
  const map = new Map<number, Profile>();
  for (const r of ctx.store.recipeRequirements(ids)) {
    let p = map.get(r.recipe_id);
    if (!p) {
      p = {
        id: r.recipe_id,
        slug: r.slug,
        title: r.title,
        required: [],
        optional: [],
        staples: [],
        weight: 0,
      };
      map.set(r.recipe_id, p);
    }
    if (r.staple) p.staples.push(r);
    else if (r.optional) p.optional.push(r);
    else {
      p.required.push(r);
      p.weight += wasteWeight(r.category);
    }
  }
  return map;
}

export function resolveSlugs(
  ctx: AppContext,
  slugs: string[],
): { ids: number[]; unknown: string[] } {
  const ids: number[] = [];
  const unknown: string[] = [];
  for (const s of slugs) {
    const rec = ctx.store.getRecipe(s);
    if (rec) ids.push(rec.id);
    else unknown.push(s);
  }
  return { ids, unknown };
}

// --- planner ------------------------------------------------------------------------------------

export interface Suggestion {
  slug: string;
  title: string;
  total_min: number | null;
  /** Waste-weighted share of this recipe's required ingredients you already have or are already buying, 0–1. */
  reuse: number;
  /** Ranking score: like reuse, but once the plan has recipes pantry items count half and repeated dishes are penalised. */
  /** Required ingredients already on the list for another planned recipe. */
  shares: string[];
  from_pantry: string[];
  /** What this recipe would add to the shopping list. */
  new: string[];
  new_cost: number;
  /** Set when the recipe repeats a dish already in the plan, e.g. "curry". */
  repeats?: string;
  score: number;
}

export interface PlanSummary {
  recipes: Array<{ slug: string; title: string; servings?: number | null }>;
  /** Distinct items to buy. */
  to_buy: number;
  /** Distinct required ingredients covered by the pantry. */
  from_pantry: number;
  /** Bought items used by two or more planned recipes. */
  shared: number;
  /** 1 − weight(to buy) / total weighted demand; 0 for a plan with nothing shared and no pantry help. */
  reuse: number;
}

export interface SuggestOptions {
  /** Slugs already planned; defaults to the saved plan. */
  plan?: string[];
  /** A recipe to plan around, added to the plan context (not saved). */
  seed?: string;
  limit?: number;
  /** Penalise repeating a dish already in the plan (default true). */
  variety?: boolean;
  use_pantry?: boolean;
  filters?: SearchFilters;
}

const VARIETY_PENALTY = 0.15;
/**
 * Once the plan has a recipe, pantry coverage counts half as much as sharing with the plan when
 * ranking: a big pantry would otherwise surface the same pantry-friendly recipes whatever the seed.
 */
const PANTRY_FACTOR_WITH_PLAN = 0.5;
const BEAM_WIDTH = 4;
const BEAM_FANOUT = 12;

interface State {
  profiles: Profile[];
  /** ingredient id → first line that put it on the list */
  buy: Map<number, RequirementRow>;
  buyIds: Set<number>;
  pantryIds: Set<number>;
  demand: number;
  dishes: Map<string, number>;
  /** Suggestions taken to reach this state (auto-fill path). */
  path: Suggestion[];
}

class Planner {
  readonly avail: Set<number>;
  readonly profiles: Map<number, Profile>;
  readonly bySlug = new Map<string, Profile>();
  readonly summaries = new Map<number, RecipeSummary>();
  private readonly cache = new Map<string, number | null>();

  constructor(
    readonly ctx: AppContext,
    usePantry: boolean,
  ) {
    this.avail = usePantry ? availableIngredients(ctx, {}).ids : new Set();
    this.profiles = loadProfiles(ctx);
    for (const p of this.profiles.values()) this.bySlug.set(p.slug, p);
    for (const s of ctx.store.listRecipes({ limit: 10_000 })) this.summaries.set(s.id, s);
  }

  dishesOf(id: number): string[] {
    return this.summaries.get(id)?.tags.dish ?? [];
  }

  state(ids: number[]): State {
    const s: State = {
      profiles: [],
      buy: new Map(),
      buyIds: new Set(),
      pantryIds: new Set(),
      demand: 0,
      dishes: new Map(),
      path: [],
    };
    for (const id of ids) {
      const p = this.profiles.get(id);
      if (p) this.add(s, p);
    }
    return s;
  }

  private add(s: State, p: Profile): void {
    s.profiles.push(p);
    s.demand += p.weight;
    for (const l of p.required) {
      if (lineAvailable(this.ctx, l, this.avail, this.cache)) s.pantryIds.add(l.ingredient_id);
      else if (!s.buy.has(l.ingredient_id)) {
        s.buy.set(l.ingredient_id, l);
        s.buyIds.add(l.ingredient_id);
      }
    }
    for (const d of this.dishesOf(p.id)) s.dishes.set(d, (s.dishes.get(d) ?? 0) + 1);
  }

  extend(s: State, p: Profile, sug: Suggestion): State {
    const next: State = {
      profiles: [...s.profiles],
      buy: new Map(s.buy),
      buyIds: new Set(s.buyIds),
      pantryIds: new Set(s.pantryIds),
      demand: s.demand,
      dishes: new Map(s.dishes),
      path: [...s.path, sug],
    };
    this.add(next, p);
    return next;
  }

  evaluate(s: State, p: Profile, variety: boolean): Suggestion {
    const shares: RequirementRow[] = [];
    const pantry: RequirementRow[] = [];
    const fresh: RequirementRow[] = [];
    for (const l of p.required) {
      if (lineAvailable(this.ctx, l, this.avail, this.cache)) pantry.push(l);
      else if (lineAvailable(this.ctx, l, s.buyIds, this.cache)) shares.push(l);
      else fresh.push(l);
    }
    const w = (rows: RequirementRow[]) => rows.reduce((n, r) => n + wasteWeight(r.category), 0);
    const reuse = p.weight === 0 ? 0 : (w(shares) + w(pantry)) / p.weight;
    const pantryFactor = s.profiles.length ? PANTRY_FACTOR_WITH_PLAN : 1;
    const ranked = p.weight === 0 ? 0 : (w(shares) + pantryFactor * w(pantry)) / p.weight;
    const repeated = this.dishesOf(p.id).filter((d) => s.dishes.has(d));
    const penalty = variety ? repeated.length * VARIETY_PENALTY : 0;
    const names = (rows: RequirementRow[]) => [...new Set(rows.map((r) => r.canonical))];
    return {
      slug: p.slug,
      title: p.title,
      total_min: this.summaries.get(p.id)?.total_min ?? null,
      reuse: Math.round(reuse * 100) / 100,
      shares: names(shares),
      from_pantry: names(pantry),
      new: names(fresh),
      new_cost: Math.round(w(fresh) * 10) / 10,
      repeats: repeated.length ? repeated.join(", ") : undefined,
      score: ranked - penalty,
    };
  }

  rank(s: State, allowed: Set<number> | null, variety: boolean): Suggestion[] {
    const planned = new Set(s.profiles.map((p) => p.id));
    const plannedTitles = new Set(s.profiles.map((p) => p.title.toLowerCase()));
    const out: Suggestion[] = [];
    for (const p of this.profiles.values()) {
      if (planned.has(p.id) || p.required.length === 0) continue;
      if (plannedTitles.has(p.title.toLowerCase())) continue; // a second copy of the same card
      if (allowed && !allowed.has(p.id)) continue;
      out.push(this.evaluate(s, p, variety));
    }
    out.sort(
      (a, b) =>
        b.score - a.score ||
        a.new.length - b.new.length ||
        b.shares.length - a.shares.length ||
        a.title.localeCompare(b.title),
    );
    // Collections ingested from photos can hold the same card twice; show it once.
    const seen = new Set<string>();
    return out.filter((x) => {
      const t = x.title.toLowerCase();
      if (seen.has(t)) return false;
      seen.add(t);
      return true;
    });
  }

  objective(s: State, variety: boolean): number {
    let repeats = 0;
    for (const n of s.dishes.values()) if (n > 1) repeats += n - 1;
    return this.reuse(s) - (variety ? repeats * VARIETY_PENALTY : 0);
  }

  reuse(s: State): number {
    if (s.demand === 0) return 0;
    let bought = 0;
    for (const l of s.buy.values()) bought += wasteWeight(l.category);
    return Math.max(0, 1 - bought / s.demand);
  }

  summary(s: State, servings?: Map<string, number | null | undefined>): PlanSummary {
    const users = new Map<number, number>();
    for (const p of s.profiles) {
      const seen = new Set<number>();
      for (const l of p.required) {
        if (s.buyIds.has(l.ingredient_id) && !seen.has(l.ingredient_id)) {
          seen.add(l.ingredient_id);
          users.set(l.ingredient_id, (users.get(l.ingredient_id) ?? 0) + 1);
        }
      }
    }
    return {
      recipes: s.profiles.map((p) => ({
        slug: p.slug,
        title: p.title,
        servings: servings?.get(p.slug) ?? undefined,
      })),
      to_buy: s.buy.size,
      from_pantry: s.pantryIds.size,
      shared: [...users.values()].filter((n) => n >= 2).length,
      reuse: Math.round(this.reuse(s) * 100) / 100,
    };
  }
}

function planContext(
  ctx: AppContext,
  opts: Pick<SuggestOptions, "plan" | "seed">,
): { ids: number[]; slugs: string[]; unknown: string[] } {
  const slugs = [...(opts.plan ?? getPlan(ctx).items.map((i) => i.slug))];
  if (opts.seed && !slugs.includes(opts.seed)) slugs.push(opts.seed);
  const { ids, unknown } = resolveSlugs(ctx, slugs);
  return { ids, slugs: slugs.filter((s) => !unknown.includes(s)), unknown };
}

/** Recipes that would add least to the shopping list for the current plan (or a seed recipe). */
export function suggestRecipes(
  ctx: AppContext,
  opts: SuggestOptions = {},
): { plan: PlanSummary; suggestions: Suggestion[]; unknown_slugs: string[] } {
  const planner = new Planner(ctx, opts.use_pantry !== false);
  const { ids, unknown } = planContext(ctx, opts);
  const state = planner.state(ids);
  const allowed = ctx.store.filterRecipeIds(expandFilters(ctx, opts.filters));
  const limit = Math.min(Math.max(opts.limit ?? 10, 1), 50);
  return {
    plan: planner.summary(state),
    suggestions: planner.rank(state, allowed, opts.variety !== false).slice(0, limit),
    unknown_slugs: unknown,
  };
}

export interface AutofillOptions extends SuggestOptions {
  /** How many recipes to add. */
  count: number;
  beam?: number;
}

/** Fill a plan with `count` more recipes, maximising reuse across the whole plan (beam search). */
export function autofillPlan(
  ctx: AppContext,
  opts: AutofillOptions,
): { plan: PlanSummary; slugs: string[]; added: Suggestion[]; unknown_slugs: string[] } {
  const planner = new Planner(ctx, opts.use_pantry !== false);
  const { ids, slugs, unknown } = planContext(ctx, opts);
  const allowed = ctx.store.filterRecipeIds(expandFilters(ctx, opts.filters));
  const variety = opts.variety !== false;
  const width = Math.min(Math.max(opts.beam ?? BEAM_WIDTH, 1), 10);
  const count = Math.min(Math.max(opts.count, 0), 14);

  let beam: State[] = [planner.state(ids)];
  for (let step = 0; step < count; step++) {
    const next = new Map<string, State>();
    for (const s of beam) {
      for (const sug of planner.rank(s, allowed, variety).slice(0, BEAM_FANOUT)) {
        const p = planner.bySlug.get(sug.slug);
        if (!p) continue;
        const ns = planner.extend(s, p, sug);
        const key = ns.profiles
          .map((x) => x.id)
          .sort((a, b) => a - b)
          .join(",");
        if (!next.has(key)) next.set(key, ns);
      }
    }
    if (next.size === 0) break;
    beam = [...next.values()]
      .sort(
        (a, b) =>
          planner.objective(b, variety) - planner.objective(a, variety) || a.buy.size - b.buy.size,
      )
      .slice(0, width);
  }
  const best = beam[0] ?? planner.state(ids);
  return {
    plan: planner.summary(best),
    slugs: [...slugs, ...best.path.map((s) => s.slug)],
    added: best.path,
    unknown_slugs: unknown,
  };
}

// --- shopping list ------------------------------------------------------------------------------

export interface ShoppingLine {
  canonical: string;
  amount: string | null;
  aisle: Aisle;
  /** Titles of the planned recipes that use it. */
  for: string[];
}

export interface PantryCheck {
  canonical: string;
  amount: string | null;
  for: string[];
  /** What the pantry says you have, e.g. "6" or "500 g", when a quantity was recorded. */
  in_pantry: string | null;
  confirmed: boolean;
}

export interface ShoppingOptions {
  /** Recipes to shop for; defaults to the saved plan. */
  items?: PlanItem[];
  /** Pantry items the user confirmed are there (added to the plan's confirmed set). */
  confirmed?: string[];
  /** Pantry items the user is actually out of: removed from the pantry and moved onto the list. */
  out_of?: string[];
}

export interface ShoppingList {
  recipes: Array<{ slug: string; title: string; servings: number | null; scale: number }>;
  buy: ShoppingLine[];
  /** Required ingredients the plan takes from the pantry — confirm these before shopping. */
  pantry_check: PantryCheck[];
  /** Pantry items still awaiting confirmation. */
  needs_confirmation: string[];
  optional: ShoppingLine[];
  /** Kitchen staples the plan uses (salt, oil…): not on the list, just make sure you have them. */
  staples: string[];
  summary: PlanSummary;
  removed_from_pantry: string[];
  unknown_slugs: string[];
}

interface Bucket {
  canonical: string;
  category: string | null;
  amounts: Amount[];
  unmeasured: number;
  for: Set<string>;
}

export function shoppingList(ctx: AppContext, opts: ShoppingOptions = {}): ShoppingList {
  const stored = getPlan(ctx);
  const items = opts.items ?? stored.items;
  const removed = opts.out_of?.length ? removeFromPantry(ctx, opts.out_of).removed : [];
  let confirmed = new Set(stored.confirmed);
  for (const c of opts.confirmed ?? []) confirmed.add(c);
  for (const r of removed) confirmed.delete(r);
  if (opts.confirmed?.length || removed.length) {
    confirmed = new Set(
      savePlan(ctx, { items: opts.items ? stored.items : items, confirmed: [...confirmed] })
        .confirmed,
    );
  }

  const planner = new Planner(ctx, true);
  const { ids, unknown } = resolveSlugs(
    ctx,
    items.map((i) => i.slug),
  );
  const state = planner.state(ids);
  const wanted = new Map(items.map((i) => [i.slug, i.servings]));
  const pantryQty = new Map(
    ctx.store
      .pantryList()
      .map((p) => [
        p.ingredient_id,
        p.qty !== null ? `${fmtNumber(p.qty)}${p.unit ? ` ${p.unit}` : ""}` : null,
      ]),
  );

  const buy = new Map<number, Bucket>();
  const pantry = new Map<number, Bucket>();
  const optional = new Map<number, Bucket>();
  const staples = new Set<string>();
  const recipes: ShoppingList["recipes"] = [];
  const cache = new Map<string, number | null>();

  const put = (map: Map<number, Bucket>, l: RequirementRow, scale: number, title: string) => {
    let b = map.get(l.ingredient_id);
    if (!b) {
      b = {
        canonical: l.canonical,
        category: l.category,
        amounts: [],
        unmeasured: 0,
        for: new Set(),
      };
      map.set(l.ingredient_id, b);
    }
    const a = toAmount(l.qty, l.unit, scale);
    if (a) b.amounts.push(a);
    else b.unmeasured++;
    b.for.add(title);
  };

  for (const p of state.profiles) {
    const base = planner.summaries.get(p.id)?.servings ?? null;
    const want = wanted.get(p.slug) ?? null;
    const scale = base && want ? want / base : 1;
    recipes.push({ slug: p.slug, title: p.title, servings: want ?? base, scale });
    for (const l of p.required) {
      if (lineAvailable(ctx, l, planner.avail, cache)) put(pantry, l, scale, p.title);
      else put(buy, l, scale, p.title);
    }
    for (const l of p.optional) put(optional, l, scale, p.title);
    for (const l of p.staples) staples.add(l.canonical);
  }

  const line = (b: Bucket): ShoppingLine => ({
    canonical: b.canonical,
    amount: formatAmount(b.amounts, b.unmeasured),
    aisle: aisleOf(b.category),
    for: [...b.for],
  });
  const byAisle = (a: ShoppingLine, b: ShoppingLine) =>
    AISLE_ORDER.indexOf(a.aisle) - AISLE_ORDER.indexOf(b.aisle) ||
    a.canonical.localeCompare(b.canonical);

  const check: PantryCheck[] = [...pantry.entries()]
    .map(([id, b]) => ({
      canonical: b.canonical,
      amount: formatAmount(b.amounts, b.unmeasured),
      for: [...b.for],
      in_pantry: pantryQty.get(id) ?? null,
      confirmed: confirmed.has(b.canonical),
    }))
    .sort((a, b) => a.canonical.localeCompare(b.canonical));

  return {
    recipes,
    buy: [...buy.values()].map(line).sort(byAisle),
    pantry_check: check,
    needs_confirmation: check.filter((c) => !c.confirmed).map((c) => c.canonical),
    optional: [...optional.values()].map(line).sort(byAisle),
    staples: [...staples].sort(),
    summary: planner.summary(state, wanted),
    removed_from_pantry: removed,
    unknown_slugs: unknown,
  };
}

/** Plain-text list for clipboard or chat, grouped by aisle. */
export function renderShoppingList(list: ShoppingList): string {
  const out: string[] = [];
  out.push(`Shopping list for ${list.recipes.map((r) => r.title).join(", ")}`);
  let aisle: string | undefined;
  for (const l of list.buy) {
    if (l.aisle !== aisle) {
      aisle = l.aisle;
      out.push("", `${aisle[0]?.toUpperCase()}${aisle.slice(1)}`);
    }
    out.push(`- ${l.canonical}${l.amount ? ` — ${l.amount}` : ""}`);
  }
  if (list.pantry_check.length) {
    out.push("", "From your pantry (check you have enough)");
    for (const c of list.pantry_check)
      out.push(`- ${c.canonical}${c.amount ? ` — ${c.amount}` : ""}${c.confirmed ? "" : " (?)"}`);
  }
  if (list.staples.length) out.push("", `Staples used: ${list.staples.join(", ")}`);
  return out.join("\n");
}
