import fs from "node:fs";
import { parse as parseYaml } from "yaml";
import { normalizeName } from "../recipes/schema.js";
import type { StorageAdapter } from "../storage/types.js";
import type { CatalogEntry, RecipeIngredient } from "../types.js";

const FUZZY_THRESHOLD = 0.85;

export interface Resolution {
  /** canonical (as it now appears on the recipe) → ingredient id */
  ids: Map<string, number>;
  /** Ingredients that did not exist and were created. */
  created: string[];
  /** Names that were mapped onto an existing ingredient. */
  aliased: Array<{ from: string; to: string; via: "alias" | "fuzzy" }>;
  /** The ingredients with canonical names rewritten to the resolved ones. */
  ingredients: RecipeIngredient[];
}

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

/** Singular forms of the last word: "naan breads" → ["naan bread"], "tomatoes" → ["tomato"]. */
export function singularForms(name: string): string[] {
  const m = /^(.*?)(\S+)$/.exec(name);
  if (!m) return [];
  const [, head = "", last = ""] = m;
  const out: string[] = [];
  if (last.endsWith("ies") && last.length > 4) out.push(`${last.slice(0, -3)}y`);
  if (last.endsWith("oes") || last.endsWith("ches") || last.endsWith("shes"))
    out.push(last.slice(0, -2));
  if (last.endsWith("s") && !last.endsWith("ss") && last.length > 3) out.push(last.slice(0, -1));
  return out.map((w) => `${head}${w}`);
}

function lookup(store: StorageAdapter, name: string) {
  const exact = store.getIngredient(name);
  if (exact) return exact;
  for (const s of singularForms(name)) {
    const row = store.getIngredient(s);
    if (row) return row;
  }
  return undefined;
}

/**
 * Map every ingredient to a catalog row: exact canonical → alias → singular → fuzzy (≥0.85
 * Dice on trigram candidates) → create. Rewrites `canonical` on the returned ingredients.
 */
export function resolveIngredients(
  store: StorageAdapter,
  ingredients: RecipeIngredient[],
): Resolution {
  const res: Resolution = { ids: new Map(), created: [], aliased: [], ingredients: [] };
  for (const ing of ingredients) {
    const name = normalizeName(ing.canonical);
    let row = lookup(store, name);
    if (row) {
      if (row.canonical !== name) res.aliased.push({ from: name, to: row.canonical, via: "alias" });
    } else {
      const best = store.fuzzyIngredients(name, 3)[0];
      if (best && dice(name, best.alias) >= FUZZY_THRESHOLD) {
        row = best.row;
        store.addAlias(row.id, name);
        res.aliased.push({ from: name, to: row.canonical, via: "fuzzy" });
      } else {
        row = store.createIngredient({ canonical: name, staple: ing.staple ?? false });
        res.created.push(name);
      }
    }
    res.ids.set(row.canonical, row.id);
    const out: RecipeIngredient = { ...ing, canonical: row.canonical };
    // Staple if the catalog says so, or this recipe expects it from your kitchen.
    if (row.is_staple || ing.staple) out.staple = true;
    else delete out.staple;
    res.ingredients.push(out);
  }
  return res;
}

interface CatalogYaml {
  [canonical: string]: { aliases?: string[]; staple?: boolean; category?: string } | null;
}

export function readCatalogYaml(file: string): CatalogEntry[] {
  if (!fs.existsSync(file)) return [];
  const data = parseYaml(fs.readFileSync(file, "utf8")) as CatalogYaml | null;
  if (!data || typeof data !== "object") return [];
  return Object.entries(data).map(([canonical, v]) => ({
    canonical: normalizeName(canonical),
    aliases: (v?.aliases ?? []).map(normalizeName),
    staple: v?.staple ?? false,
    category: v?.category ?? null,
  }));
}

/** Resolve a free-text name to a catalog canonical without creating anything. */
export function findCanonical(store: StorageAdapter, name: string): string | undefined {
  return lookup(store, normalizeName(name))?.canonical;
}

/** Load the ingredient catalog (seed or project copy) into the store. */
export function loadCatalog(store: StorageAdapter, file: string): number {
  const entries = readCatalogYaml(file);
  store.transaction(() => {
    for (const e of entries) store.upsertCatalogEntry(e);
  });
  return entries.length;
}
