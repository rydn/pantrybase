import type { ProviderProfile } from "../providers/registry.js";
import type { Recipe, RecipeIngredient, TagCategory } from "../types.js";
import { TAG_CATEGORIES } from "../types.js";
import { normalizeTagValue, type Vocabulary } from "../vocabulary/vocabulary.js";
import { normalizeName } from "./schema.js";

export interface EnrichReport {
  /** Card wording mapped onto vocabulary values, e.g. "Veggie" → diet:vegetarian. */
  mapped: string[];
  /** New values accepted into open categories. */
  new_tags: string[];
  /** Values outside a closed category (moved to `other`, or kept and flagged for allergens). */
  rejected: string[];
  /** Provider rules that changed the record. */
  provider: string[];
}

function addTag(recipe: Recipe, category: TagCategory, value: string): void {
  const list = recipe.tags[category] ?? [];
  if (!list.includes(value)) list.push(value);
  recipe.tags[category] = list;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function applyProvider(recipe: Recipe, profile: ProviderProfile, report: EnrichReport): void {
  if (!recipe.provider) return;
  if (!recipe.provider.name) recipe.provider.name = profile.name;
  if (recipe.servings == null && profile.default_servings != null) {
    recipe.servings = profile.default_servings;
    report.provider.push(`servings defaulted to ${profile.default_servings}`);
  }

  // Plan label → tags.
  const plan = recipe.provider.plan;
  if (plan) {
    const key = Object.keys(profile.plan_labels).find(
      (k) => normalizeTagValue(k) === normalizeTagValue(plan),
    );
    for (const [cat, values] of Object.entries(key ? (profile.plan_labels[key] ?? {}) : {})) {
      if (!(TAG_CATEGORIES as readonly string[]).includes(cat)) continue;
      for (const v of values) {
        if (!recipe.tags[cat as TagCategory]?.includes(v)) {
          addTag(recipe, cat as TagCategory, v);
          report.provider.push(`plan "${plan}" → ${cat}:${v}`);
        }
      }
    }
  }

  // Equipment listed as ingredients ("Paper Towel" under From Your Kitchen).
  const equipmentTerms = new Map(
    Object.entries(profile.equipment_terms).map(([k, v]) => [normalizeName(k), v]),
  );
  const kept: RecipeIngredient[] = [];
  for (const ing of recipe.ingredients) {
    const eq = equipmentTerms.get(ing.canonical) ?? equipmentTerms.get(normalizeName(ing.raw));
    if (eq) {
      if (!recipe.equipment.includes(eq)) recipe.equipment.push(eq);
      report.provider.push(`"${ing.raw}" moved to equipment`);
    } else {
      kept.push(ing);
    }
  }
  recipe.ingredients = kept;

  // Brand names out of canonical names.
  for (const ing of recipe.ingredients) {
    for (const brand of profile.brands) {
      const re = new RegExp(`(^|\\s)${escapeRe(normalizeName(brand))}(\\s|$)`);
      if (re.test(ing.canonical)) {
        const stripped = ing.canonical.replace(re, " ").replace(/\s+/g, " ").trim();
        if (stripped) {
          report.provider.push(`brand "${brand}" stripped from "${ing.canonical}"`);
          ing.canonical = stripped;
          if (!ing.brand) ing.brand = brand;
        }
      } else if (!ing.brand && re.test(normalizeName(ing.raw))) {
        ing.brand = brand;
      }
    }
  }

  if (recipe.nutrition && !recipe.nutrition.basis) recipe.nutrition.basis = profile.nutrition_basis;
}

function vocabList(
  vocab: Vocabulary,
  category: string,
  values: string[],
  report: EnrichReport,
  closedFallback: "other" | "keep",
): { kept: string[]; toOther: string[] } {
  const r = vocab.normalize(category, values);
  for (const m of r.mapped) report.mapped.push(`${category}: "${m.from}" → ${m.to}`);
  const closed = vocab.has(category) && vocab.mode(category) === "closed";
  if (!closed) {
    for (const u of r.unknown) report.new_tags.push(`${category}:${u}`);
    return { kept: r.values, toOther: [] };
  }
  for (const u of r.unknown) {
    report.rejected.push(
      `${category}:${u}${closedFallback === "other" ? " (moved to other)" : " (kept)"}`,
    );
  }
  if (closedFallback === "keep") return { kept: r.values, toOther: [] };
  return {
    kept: r.values.filter((v) => !r.unknown.includes(v)),
    toOther: r.unknown,
  };
}

/**
 * Apply the provider profile (plan labels, brands, equipment, defaults), then the vocabulary
 * (synonyms, closed categories) to tags, allergens, equipment and step techniques.
 */
export function enrichRecipe(
  recipe: Recipe,
  vocab: Vocabulary,
  profile: ProviderProfile | undefined,
): EnrichReport {
  const report: EnrichReport = { mapped: [], new_tags: [], rejected: [], provider: [] };
  if (profile) applyProvider(recipe, profile, report);

  const tags: Recipe["tags"] = {};
  const toOther: string[] = [];
  for (const cat of TAG_CATEGORIES) {
    const values = recipe.tags[cat];
    if (!values?.length || cat === "other") continue;
    const r = vocabList(vocab, cat, values, report, "other");
    if (r.kept.length) tags[cat] = r.kept;
    toOther.push(...r.toOther);
  }
  const other = vocabList(
    vocab,
    "other",
    [...(recipe.tags.other ?? []), ...toOther],
    report,
    "keep",
  );
  if (other.kept.length) tags.other = other.kept;
  recipe.tags = tags;

  recipe.allergens = vocabList(vocab, "allergen", recipe.allergens, report, "keep").kept;

  const stepEquipment = recipe.steps.flatMap((s) => s.equipment ?? []);
  recipe.equipment = vocabList(vocab, "equipment", recipe.equipment, report, "keep").kept;
  for (const step of recipe.steps) {
    if (step.equipment?.length) {
      step.equipment = vocab.normalize("equipment", step.equipment).values;
    }
    if (step.techniques?.length) {
      step.techniques = vocabList(vocab, "method", step.techniques, report, "keep").kept;
    }
  }
  // Equipment named only inside steps still belongs to the recipe.
  for (const e of vocab.normalize("equipment", stepEquipment).values) {
    if (!recipe.equipment.includes(e)) recipe.equipment.push(e);
  }

  // Kitchen-sourced ingredients are, by definition, things you are expected to have.
  for (const ing of recipe.ingredients) {
    if (ing.source === "kitchen") ing.staple = true;
  }

  report.mapped = [...new Set(report.mapped)];
  report.new_tags = [...new Set(report.new_tags)];
  report.rejected = [...new Set(report.rejected)];
  return report;
}
