export const TAG_CATEGORIES = [
  "protein",
  "diet",
  "starch",
  "flavor",
  "cuisine",
  "meal",
  "method",
  "time",
  "season",
  "other",
] as const;
export type TagCategory = (typeof TAG_CATEGORIES)[number];

export const SOURCE_KINDS = ["card", "url", "synthesized", "manual"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export const DIFFICULTIES = ["easy", "medium", "hard"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

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
}

export interface RecipeTime {
  prep?: number | null;
  cook?: number | null;
  total?: number | null;
}

export interface RecipeSource {
  kind: SourceKind;
  ref?: string | null;
  /** ISO date the recipe was captured. */
  ingested?: string;
}

export type RecipeTags = Partial<Record<TagCategory, string[]>>;

/** The full recipe record — exactly what the markdown file holds. */
export interface Recipe {
  slug: string;
  title: string;
  summary?: string;
  servings?: number | null;
  time: RecipeTime;
  difficulty?: Difficulty | null;
  source: RecipeSource;
  derived_from: string[];
  images: string[];
  tags: RecipeTags;
  ingredients: RecipeIngredient[];
  steps: string[];
  notes?: string;
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
  summary?: string;
  total_min: number | null;
  servings: number | null;
  source_kind: SourceKind;
  tags: RecipeTags;
  images: string[];
}

export interface SearchFilters {
  tags?: RecipeTags;
  max_total_min?: number;
  exclude_ingredients?: string[];
  source_kind?: SourceKind;
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
  category: TagCategory;
  name: string;
  count: number;
}

export interface DuplicateCandidate {
  slug: string;
  title: string;
  reason: "title" | "ingredients";
  score: number;
}

export interface Stats {
  recipes: number;
  ingredients: number;
  tags: number;
  chunks: number;
  chunks_pending: number;
  vectors: number;
}
