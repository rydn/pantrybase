/** Tag categories Claude assigns, governed by the vocabulary file. */
export const TAG_CATEGORIES = [
  "protein",
  "diet",
  "starch",
  "flavor",
  "texture",
  "cuisine",
  "dish",
  "meal",
  "method",
  "time",
  "season",
  "other",
] as const;
export type TagCategory = (typeof TAG_CATEGORIES)[number];

/** Facets derived from structured fields at index time (graph nodes + filters). */
export const FACET_CATEGORIES = [
  "allergen",
  "equipment",
  "technique",
  "chef",
  "provider",
  "plan",
] as const;
export type FacetCategory = (typeof FACET_CATEGORIES)[number];

export const ALL_CATEGORIES = [...TAG_CATEGORIES, ...FACET_CATEGORIES] as const;
export type AnyCategory = TagCategory | FacetCategory;

export const SOURCE_KINDS = ["card", "url", "synthesized", "manual"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export const DIFFICULTIES = ["easy", "medium", "hard"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

/** Where an ingredient comes from: supplied in the box, or from your own kitchen. */
export const INGREDIENT_SOURCES = ["box", "kitchen"] as const;
export type IngredientSource = (typeof INGREDIENT_SOURCES)[number];

export const NUTRITION_BASES = ["per_100g", "per_serving"] as const;
export type NutritionBasis = (typeof NUTRITION_BASES)[number];

export const IMAGE_SIDES = ["front", "back", "other"] as const;
export type ImageSide = (typeof IMAGE_SIDES)[number];

export interface IngredientComponent {
  raw: string;
  canonical: string;
  qty?: number | null;
  unit?: string | null;
}

export interface RecipeIngredient {
  /** Text as written on the card, e.g. "2 chicken thighs". */
  raw: string;
  /** Normalised ingredient name used for matching, e.g. "chicken thigh". */
  canonical: string;
  qty?: number | null;
  unit?: string | null;
  prep?: string | null;
  optional?: boolean;
  /** Pantry staple (salt, oil…): never counts against pantry coverage. */
  staple?: boolean;
  source?: IngredientSource;
  brand?: string | null;
  /** Sub-recipe grouping, e.g. "sauce", "salsa". */
  group?: string | null;
  /** Acceptable swaps printed on the card, e.g. ["plant milk"]. */
  alternatives?: string[];
  /** Parts of a composite line, e.g. creamy pesto = pesto + sour cream. */
  components?: IngredientComponent[];
}

export interface RecipeStep {
  /** Heading as printed (often playful, e.g. "WAL STREET"). */
  title?: string | null;
  text: string;
  /** Inferred cooking techniques, from the method vocabulary. */
  techniques?: string[];
  /** Canonical names of ingredients this step uses. */
  uses?: string[];
  equipment?: string[];
  temp_c?: number | null;
  /** [min] or [min, max] minutes. */
  minutes?: number[];
}

export interface RecipeTime {
  prep?: number | null;
  cook?: number | null;
  /** Hands-on time. */
  active?: number | null;
  total?: number | null;
}

export interface RecipeSource {
  kind: SourceKind;
  ref?: string | null;
  /** ISO date the recipe was captured. */
  ingested?: string;
}

export interface Wine {
  producer?: string | null;
  name?: string | null;
  vintage?: number | null;
}

export interface ProviderInfo {
  /** Provider profile id, e.g. "ucook". */
  id: string;
  name?: string | null;
  /** Provider meal-plan line, e.g. "Veggie", "Quick & Easy". */
  plan?: string | null;
  chef?: string | null;
  card_code?: string | null;
  eat_within_days?: number | null;
  wine?: Wine | null;
}

export interface Nutrition {
  basis: NutritionBasis;
  energy_kj?: number | null;
  energy_kcal?: number | null;
  protein_g?: number | null;
  carbs_g?: number | null;
  sugars_g?: number | null;
  fibre_g?: number | null;
  fat_g?: number | null;
  saturated_g?: number | null;
  sodium_mg?: number | null;
}

export interface ExtractionImage {
  /** Path relative to the data dir (or original file name before archiving). */
  file: string;
  side: ImageSide;
}

export interface Extraction {
  /** 0–1, Claude's overall confidence in the transcription. */
  confidence?: number | null;
  /** Fields that could not be read reliably, e.g. ["nutrition.protein_g"]. */
  uncertain?: string[];
  needs_review?: boolean;
  images?: ExtractionImage[];
  notes?: string | null;
}

export type RecipeTags = Partial<Record<TagCategory, string[]>>;

/** The full recipe record — exactly what the markdown file holds. */
export interface Recipe {
  slug: string;
  title: string;
  subtitle?: string;
  /** Description as printed on the card. */
  description?: string;
  /** Claude-written descriptive blurb used for semantic search. */
  blurb?: string;
  servings?: number | null;
  time: RecipeTime;
  difficulty?: Difficulty | null;
  source: RecipeSource;
  provider?: ProviderInfo;
  derived_from: string[];
  images: string[];
  tags: RecipeTags;
  allergens: string[];
  equipment: string[];
  nutrition?: Nutrition;
  ingredients: RecipeIngredient[];
  steps: RecipeStep[];
  tips: string[];
  notes?: string;
  extraction?: Extraction;
}

export interface FileStat {
  /** Path relative to the data dir, e.g. recipes/harissa-chicken.md */
  file_path: string;
  file_mtime: number;
  file_size: number;
  content_hash: string;
}

export interface RecipeRecord extends Recipe, FileStat {
  id: number;
  created_at: string;
  updated_at: string;
}

export interface RecipeSummary {
  id: number;
  slug: string;
  title: string;
  subtitle?: string;
  blurb?: string;
  total_min: number | null;
  active_min: number | null;
  servings: number | null;
  source_kind: SourceKind;
  provider_id: string | null;
  needs_review: boolean;
  tags: RecipeTags;
  allergens: string[];
  images: string[];
}

export interface SearchFilters {
  /** Any category, tag or facet; values OR within a category, AND across. */
  tags?: Partial<Record<AnyCategory, string[]>>;
  max_total_min?: number;
  max_active_min?: number;
  exclude_ingredients?: string[];
  exclude_allergens?: string[];
  source_kind?: SourceKind;
  provider?: string;
  needs_review?: boolean;
}

export interface SearchHit {
  recipe_id: number;
  slug: string;
  chunk_kind: string;
}

export interface IngredientRow {
  id: number;
  canonical: string;
  is_staple: boolean;
  category: string | null;
}

export interface CatalogEntry {
  canonical: string;
  aliases?: string[];
  staple?: boolean;
  category?: string | null;
}

export interface TagCount {
  category: AnyCategory;
  name: string;
  count: number;
}

export interface DuplicateCandidate {
  slug: string;
  title: string;
  reason: "title" | "ingredients";
  score: number;
}

export interface PantryItem {
  ingredient_id: number;
  canonical: string;
  qty: number | null;
  unit: string | null;
  note: string | null;
  added_at: string;
}

/** One ingredient line of a recipe, as needed for pantry matching. */
export interface RequirementRow {
  recipe_id: number;
  slug: string;
  title: string;
  ingredient_id: number;
  canonical: string;
  raw: string;
  qty: number | null;
  unit: string | null;
  /** Catalog category of the ingredient (vegetable, herb, dairy…), used for aisles and waste weighting. */
  category: string | null;
  staple: boolean;
  optional: boolean;
  /** JSON {alternatives?, components?} */
  extra: string | null;
}

export const INGEST_STATUSES = ["pending", "done", "skipped", "failed"] as const;
export type IngestStatus = (typeof INGEST_STATUSES)[number];

export interface IngestItem {
  id: number;
  sha256: string;
  phash: string;
  /** Path relative to the data dir; its folder encodes the status. */
  path: string;
  original_name: string;
  mime: string;
  width: number | null;
  height: number | null;
  bytes: number;
  mtime: number;
  captured_at: string;
  status: IngestStatus;
  recipe_slug: string | null;
  side: ImageSide | null;
  reason: string | null;
  created_at: string;
  updated_at: string;
}

export type IngestCounts = Record<IngestStatus, number>;

export interface Stats {
  recipes: number;
  ingredients: number;
  tags: number;
  chunks: number;
  chunks_pending: number;
  vectors: number;
  needs_review: number;
}
