import { z } from "zod";
import {
  DIFFICULTIES,
  IMAGE_SIDES,
  INGREDIENT_SOURCES,
  NUTRITION_BASES,
  type Recipe,
  type RecipeStep,
  SOURCE_KINDS,
  TAG_CATEGORIES,
} from "../types.js";

const num = z.number().nullable().optional();
const str = z.string().nullable().optional();

export const componentSchema = z.object({
  raw: z.string().min(1),
  canonical: z.string().min(1),
  qty: num,
  unit: str,
});

export const ingredientSchema = z.object({
  raw: z.string().min(1).describe('As printed, e.g. "200g Large Pasta Shells"'),
  canonical: z
    .string()
    .min(1)
    .describe('Generic singular name without brand, e.g. "pasta shells", "cajun rub"'),
  qty: num,
  unit: str,
  prep: str.describe('Prep note, e.g. "rinse & roughly shred"'),
  optional: z.boolean().optional(),
  staple: z.boolean().optional().describe("Pantry staple — ignored for pantry coverage"),
  source: z
    .enum(INGREDIENT_SOURCES)
    .optional()
    .describe('"box" = supplied, "kitchen" = from your own kitchen'),
  brand: str,
  group: str.describe('Sub-recipe, e.g. "sauce", "salsa"'),
  alternatives: z.array(z.string()).optional(),
  components: z.array(componentSchema).optional().describe("Parts of a composite line"),
});

export const stepSchema = z.object({
  title: str.describe("Heading as printed"),
  text: z.string().min(1),
  techniques: z.array(z.string()).optional().describe("Inferred, from the method vocabulary"),
  uses: z.array(z.string()).optional().describe("Canonical names of ingredients used"),
  equipment: z.array(z.string()).optional(),
  temp_c: num,
  minutes: z.array(z.number()).max(2).optional().describe("[min] or [min, max]"),
});

export const tagsSchema = z.partialRecord(z.enum(TAG_CATEGORIES), z.array(z.string().min(1)));

export const nutritionSchema = z.object({
  basis: z.enum(NUTRITION_BASES),
  energy_kj: num,
  energy_kcal: num,
  protein_g: num,
  carbs_g: num,
  sugars_g: num,
  fibre_g: num,
  fat_g: num,
  saturated_g: num,
  sodium_mg: num,
});

export const providerSchema = z.object({
  id: z.string().min(1).describe('Provider profile id, e.g. "ucook" (see pb_providers)'),
  name: str,
  plan: str.describe('Plan line as printed, e.g. "Veggie"'),
  chef: str,
  card_code: str,
  eat_within_days: num,
  wine: z.object({ producer: str, name: str, vintage: num }).nullable().optional(),
});

export const extractionSchema = z.object({
  confidence: z.number().min(0).max(1).nullable().optional(),
  uncertain: z.array(z.string()).optional().describe('e.g. ["nutrition.protein_g"]'),
  needs_review: z.boolean().optional(),
  images: z.array(z.object({ file: z.string(), side: z.enum(IMAGE_SIDES) })).optional(),
  notes: str,
});

export const recipeInputSchema = z.object({
  title: z.string().min(1),
  slug: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .optional()
    .describe("Only to update an existing recipe; omit to create"),
  subtitle: z.string().optional(),
  description: z.string().optional().describe("Card description, transcribed"),
  blurb: z.string().optional().describe("Your own 1–2 sentence description for semantic search"),
  servings: z.number().int().positive().nullable().optional(),
  time: z
    .object({ prep: num, cook: num, active: num, total: num })
    .optional()
    .describe("Minutes; active = hands-on"),
  difficulty: z.enum(DIFFICULTIES).nullable().optional(),
  source: z
    .object({
      kind: z.enum(SOURCE_KINDS),
      ref: str,
      ingested: z.string().optional(),
    })
    .optional(),
  provider: providerSchema.optional(),
  derived_from: z.array(z.string()).optional().describe("Slugs this recipe was synthesized from"),
  images: z.array(z.string()).optional().describe("Paths relative to the data dir"),
  tags: tagsSchema.optional(),
  allergens: z.array(z.string()).optional(),
  equipment: z.array(z.string()).optional(),
  nutrition: nutritionSchema.optional(),
  ingredients: z.array(ingredientSchema).min(1),
  steps: z.array(z.union([z.string().min(1), stepSchema])).min(1),
  tips: z.array(z.string()).optional(),
  notes: z.string().optional(),
  extraction: extractionSchema.optional(),
});

export type RecipeInput = z.infer<typeof recipeInputSchema>;

export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const trimmed = (s: string | null | undefined): string | undefined => {
  const t = s?.trim();
  return t ? t : undefined;
};

/** Drop null/undefined/empty values so the stored record stays compact. */
function compact<T extends object>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out as T;
}

function normalizeStep(step: string | z.infer<typeof stepSchema>): RecipeStep {
  if (typeof step === "string") return { text: step.trim() };
  return compact({
    title: trimmed(step.title),
    text: step.text.trim(),
    techniques: step.techniques?.map((t) => t.trim()).filter(Boolean),
    uses: step.uses?.map(normalizeName).filter(Boolean),
    equipment: step.equipment?.map((e) => e.trim()).filter(Boolean),
    temp_c: step.temp_c ?? undefined,
    minutes: step.minutes?.length ? step.minutes : undefined,
  });
}

/**
 * Turn validated input into a complete Recipe: defaults, trimmed text, computed total time,
 * normalised ingredient names. Vocabulary and provider rules are applied later (enrich).
 */
export function normalizeRecipe(input: RecipeInput, slug: string): Recipe {
  const time = compact({ ...(input.time ?? {}) });
  if (time.total == null && (time.prep != null || time.cook != null)) {
    time.total = (time.prep ?? 0) + (time.cook ?? 0);
  }
  const tags: Recipe["tags"] = {};
  for (const [cat, names] of Object.entries(input.tags ?? {})) {
    const clean = [...new Set((names ?? []).map((n) => n.trim()).filter(Boolean))];
    if (clean.length) tags[cat as keyof Recipe["tags"]] = clean;
  }
  const recipe: Recipe = {
    slug,
    title: input.title.trim(),
    time,
    source: input.source ?? { kind: "manual" },
    derived_from: input.derived_from ?? [],
    images: input.images ?? [],
    tags,
    allergens: (input.allergens ?? []).map((a) => a.trim()).filter(Boolean),
    equipment: (input.equipment ?? []).map((e) => e.trim()).filter(Boolean),
    ingredients: input.ingredients.map((i) =>
      compact({
        raw: i.raw.trim(),
        canonical: normalizeName(i.canonical),
        qty: i.qty ?? undefined,
        unit: trimmed(i.unit),
        prep: trimmed(i.prep),
        optional: i.optional || undefined,
        staple: i.staple || undefined,
        source: i.source,
        brand: trimmed(i.brand),
        group: trimmed(i.group),
        alternatives: i.alternatives?.map(normalizeName).filter(Boolean),
        components: i.components?.map((c) =>
          compact({
            raw: c.raw.trim(),
            canonical: normalizeName(c.canonical),
            qty: c.qty ?? undefined,
            unit: trimmed(c.unit),
          }),
        ),
      }),
    ),
    steps: input.steps.map(normalizeStep).filter((s) => s.text),
    tips: (input.tips ?? []).map((t) => t.trim()).filter(Boolean),
  };
  const opt = {
    subtitle: trimmed(input.subtitle),
    description: trimmed(input.description),
    blurb: trimmed(input.blurb),
    notes: trimmed(input.notes),
  };
  for (const [k, v] of Object.entries(opt))
    if (v) (recipe as unknown as Record<string, unknown>)[k] = v;
  if (input.servings != null) recipe.servings = input.servings;
  if (input.difficulty) recipe.difficulty = input.difficulty;
  if (input.provider) {
    const p = input.provider;
    recipe.provider = compact({
      id: p.id.trim().toLowerCase(),
      name: trimmed(p.name),
      plan: trimmed(p.plan),
      chef: trimmed(p.chef),
      card_code: trimmed(p.card_code),
      eat_within_days: p.eat_within_days ?? undefined,
      wine: p.wine ? compact({ ...p.wine }) : undefined,
    });
    if (recipe.provider.wine && Object.keys(recipe.provider.wine).length === 0) {
      delete recipe.provider.wine;
    }
  }
  if (input.nutrition) recipe.nutrition = compact({ ...input.nutrition });
  if (input.extraction) {
    const e = compact({ ...input.extraction });
    if (Object.keys(e).length) recipe.extraction = e;
  }
  return recipe;
}
