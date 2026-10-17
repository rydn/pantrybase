import fs from "node:fs";
import { isMap, isSeq, parseDocument, YAMLMap, YAMLSeq } from "yaml";
import type { AppContext } from "../core/context.js";
import { reconcile } from "../files/reconcile.js";
import { writeRecipeFile } from "../files/store.js";
import { resolveItem } from "../pantry/pantry.js";
import { normalizeName } from "../recipes/schema.js";
import type { Recipe, RecipeRecord } from "../types.js";

/** Strip the index-only fields from a stored record to get the recipe as the file holds it. */
function toRecipe(r: RecipeRecord): Recipe {
  const {
    id: _id,
    created_at: _c,
    updated_at: _u,
    file_path: _f,
    file_mtime: _m,
    file_size: _s,
    content_hash: _h,
    ...recipe
  } = r;
  return recipe;
}

function renameIn(recipe: Recipe, from: string, into: string): boolean {
  let changed = false;
  const swap = (name: string) => {
    if (name === from) {
      changed = true;
      return into;
    }
    return name;
  };
  for (const ing of recipe.ingredients) {
    ing.canonical = swap(ing.canonical);
    if (ing.alternatives) ing.alternatives = ing.alternatives.map(swap);
    for (const c of ing.components ?? []) c.canonical = swap(c.canonical);
  }
  for (const step of recipe.steps) if (step.uses) step.uses = [...new Set(step.uses.map(swap))];
  return changed;
}

/** Record `from` as an alias of `into` in the project's ingredients.yaml (keeping comments). */
function persistAlias(file: string, from: string, into: string): void {
  const doc = parseDocument(fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "{}\n");
  const root = doc.contents as unknown;
  if (!isMap(root)) return;
  const map = root as YAMLMap<unknown, unknown>;
  const scalar = (n: unknown) => String((n as { value?: unknown })?.value ?? n);

  const carried: string[] = [];
  const old = map.get(from, true) as unknown;
  if (isMap(old)) {
    const aliases = (old as YAMLMap<unknown, unknown>).get("aliases", true) as unknown;
    if (isSeq(aliases))
      for (const a of (aliases as YAMLSeq<unknown>).items) carried.push(scalar(a));
  }
  if (map.has(from)) map.delete(from);

  let target = map.get(into, true) as unknown;
  if (!isMap(target)) {
    const fresh = new YAMLMap<unknown, unknown>();
    fresh.flow = true;
    map.set(into, fresh);
    target = fresh;
  }
  const entry = target as YAMLMap<unknown, unknown>;
  let aliases = entry.get("aliases", true) as unknown;
  if (!isSeq(aliases)) {
    const fresh = new YAMLSeq<unknown>();
    fresh.flow = true;
    entry.set("aliases", fresh);
    aliases = fresh;
  }
  const seq = aliases as YAMLSeq<unknown>;
  const existing = new Set(seq.items.map(scalar));
  for (const a of [from, ...carried]) if (!existing.has(a)) seq.add(a);
  fs.writeFileSync(file, doc.toString({ lineWidth: 0, flowCollectionPadding: false }));
}

export interface MergeResult {
  from: string;
  into: string;
  recipes_updated: string[];
  pantry_moved: boolean;
}

/**
 * Merge one ingredient into another (e.g. "spring onion" into "spring onions" or a brand-ish
 * name into its generic one): rewrite every recipe file that uses it, move aliases and the
 * pantry entry, and remember the alias in ingredients.yaml so future saves resolve to `into`.
 */
export function mergeIngredients(ctx: AppContext, fromName: string, intoName: string): MergeResult {
  const from = ctx.store.getIngredient(normalizeName(fromName));
  if (!from) throw new Error(`unknown ingredient "${fromName}"`);
  const into = resolveItem(ctx, intoName, true)?.row;
  if (!into) throw new Error(`cannot resolve "${intoName}"`);
  if (from.id === into.id) throw new Error(`"${fromName}" is already "${into.canonical}"`);

  const pantryMoved = ctx.store.pantryList().some((p) => p.ingredient_id === from.id);
  const updated: string[] = [];
  for (const slug of ctx.store.recipesUsingIngredient(from.id)) {
    const rec = ctx.store.getRecipe(slug);
    if (!rec) continue;
    const recipe = toRecipe(rec);
    if (renameIn(recipe, from.canonical, into.canonical)) {
      writeRecipeFile(ctx.paths, recipe);
      updated.push(slug);
    }
  }
  ctx.store.mergeIngredientRows(from.id, into.id);
  ctx.store.addAlias(into.id, from.canonical);
  persistAlias(ctx.paths.ingredientsYaml, from.canonical, into.canonical);
  // Re-index the rewritten files; the catalog change is already applied.
  ctx.refresh();
  reconcile(ctx);
  return {
    from: from.canonical,
    into: into.canonical,
    recipes_updated: updated,
    pantry_moved: pantryMoved,
  };
}
