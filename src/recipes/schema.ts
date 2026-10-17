import { z } from "zod";
import { DIFFICULTIES, type Recipe, SOURCE_KINDS, TAG_CATEGORIES } from "../types.js";

export const ingredientSchema = z.object({
  raw: z.string().min(1).describe('As written on the card, e.g. "2 chicken thighs"'),
  canonical: z
    .string()
    .min(1)
    .describe('Normalised ingredient name, singular, e.g. "chicken thigh"'),
  qty: z.number().nullable().optional(),
  unit: z.string().nullable().optional(),
  prep: z.string().nullable().optional().describe('e.g. "diced", "zested"'),
  optional: z.boolean().optional(),
  staple: z
    .boolean()
    .optional()
    .describe("Pantry staple (salt, oil, water…) — ignored for pantry coverage"),
});

export const tagsSchema = z.partialRecord(z.enum(TAG_CATEGORIES), z.array(z.string().min(1)));

export const recipeInputSchema = z.object({
  title: z.string().min(1),
  slug: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .optional()
    .describe("Only to update an existing recipe; omit to create"),
  summary: z.string().optional().describe("One or two sentences"),
  servings: z.number().int().positive().nullable().optional(),
  time: z
    .object({
      prep: z.number().nullable().optional(),
      cook: z.number().nullable().optional(),
      total: z.number().nullable().optional(),
    })
    .optional()
    .describe("Minutes"),
  difficulty: z.enum(DIFFICULTIES).nullable().optional(),
  source: z
    .object({
      kind: z.enum(SOURCE_KINDS),
      ref: z.string().nullable().optional().describe("Card id, URL, provider…"),
      ingested: z.string().optional(),
    })
    .optional(),
  derived_from: z.array(z.string()).optional().describe("Slugs this recipe was synthesized from"),
  images: z.array(z.string()).optional().describe("Paths relative to the data dir"),
  tags: tagsSchema.optional(),
  ingredients: z.array(ingredientSchema).min(1),
  steps: z.array(z.string().min(1)).min(1),
  notes: z.string().optional(),
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

/** Turn validated input into a complete Recipe with defaults, lower-cased tags and names. */
export function normalizeRecipe(input: RecipeInput, slug: string): Recipe {
  const time = { ...(input.time ?? {}) };
  if (
    (time.total === undefined || time.total === null) &&
    (time.prep != null || time.cook != null)
  ) {
    time.total = (time.prep ?? 0) + (time.cook ?? 0);
  }
  const tags: Recipe["tags"] = {};
  for (const [cat, names] of Object.entries(input.tags ?? {})) {
    const clean = [...new Set((names ?? []).map(normalizeName).filter(Boolean))];
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
    ingredients: input.ingredients.map((i) => {
      const ing: Recipe["ingredients"][number] = {
        raw: i.raw.trim(),
        canonical: normalizeName(i.canonical),
      };
      if (i.qty != null) ing.qty = i.qty;
      if (i.unit) ing.unit = i.unit.trim();
      if (i.prep) ing.prep = i.prep.trim();
      if (i.optional) ing.optional = true;
      if (i.staple) ing.staple = true;
      return ing;
    }),
    steps: input.steps.map((s) => s.trim()).filter(Boolean),
  };
  if (input.summary?.trim()) recipe.summary = input.summary.trim();
  if (input.servings != null) recipe.servings = input.servings;
  if (input.difficulty) recipe.difficulty = input.difficulty;
  if (input.notes?.trim()) recipe.notes = input.notes.trim();
  return recipe;
}
