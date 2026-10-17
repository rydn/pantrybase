/** Shapes returned by the pantrybase /api (kept separate from the server code on purpose). */

export type Tags = Record<string, string[] | undefined>;

export interface RecipeSummary {
  id: number;
  slug: string;
  title: string;
  subtitle?: string;
  blurb?: string;
  total_min: number | null;
  active_min: number | null;
  servings: number | null;
  source_kind: string;
  provider_id: string | null;
  needs_review: boolean;
  tags: Tags;
  allergens: string[];
  images: string[];
  score?: number | null;
  matched?: string[];
}

export interface Ingredient {
  raw: string;
  canonical: string;
  qty?: number | null;
  unit?: string | null;
  prep?: string | null;
  optional?: boolean;
  staple?: boolean;
  source?: "box" | "kitchen";
  brand?: string | null;
  alternatives?: string[];
  components?: Array<{ raw: string; canonical: string }>;
}

export interface Step {
  title?: string | null;
  text: string;
  techniques?: string[];
  uses?: string[];
  equipment?: string[];
  temp_c?: number | null;
  minutes?: number[];
}

export interface Recipe {
  slug: string;
  title: string;
  subtitle?: string;
  description?: string;
  blurb?: string;
  servings?: number | null;
  time: {
    prep?: number | null;
    cook?: number | null;
    active?: number | null;
    total?: number | null;
  };
  source: { kind: string; ref?: string | null; ingested?: string };
  provider?: {
    id: string;
    name?: string | null;
    plan?: string | null;
    chef?: string | null;
    eat_within_days?: number | null;
    wine?: { producer?: string | null; name?: string | null; vintage?: number | null } | null;
  };
  derived_from: string[];
  images: string[];
  tags: Tags;
  allergens: string[];
  equipment: string[];
  nutrition?: Record<string, number | string | null | undefined> & { basis: string };
  ingredients: Ingredient[];
  steps: Step[];
  tips: string[];
  notes?: string;
  extraction?: {
    confidence?: number | null;
    uncertain?: string[];
    needs_review?: boolean;
    notes?: string | null;
  };
}

export interface RecipeDetail {
  recipe: Recipe;
  pantry_have: string[];
  similar: RecipeSummary[];
  derived: RecipeSummary[];
  sources: RecipeSummary[];
}

export interface Stats {
  recipes: number;
  ingredients: number;
  tags: number;
  vectors: number;
  chunks_pending: number;
  needs_review: number;
  inbox: Record<"pending" | "done" | "skipped" | "failed", number>;
  pantry: number;
  data_dir: string;
  embeddings: string;
  version: string;
}

export interface Facets {
  used: Record<string, Array<{ name: string; count: number }>>;
  vocabulary: Record<string, { mode: string; values: string[] }>;
}

export interface PantryItem {
  ingredient_id: number;
  canonical: string;
  qty: number | null;
  unit: string | null;
  note: string | null;
}

export interface Match {
  slug: string;
  title: string;
  coverage: number;
  have: number;
  need: number;
  missing: Array<{ canonical: string; raw: string }>;
  near_miss: boolean;
}

export interface InboxItem {
  id: number;
  name: string;
  captured_at: string;
  size: string;
  status: "pending" | "done" | "skipped" | "failed";
  recipe_slug?: string;
  reason?: string;
  retake_of?: { id: number; status: string; recipe_slug?: string; distance: number };
  path: string;
}

export interface GraphNode {
  id: string;
  kind: "recipe" | "ingredient" | "tag";
  label: string;
  group: string | null;
  degree: number;
  slug?: string;
  image?: string;
  needs_review?: boolean;
}

export interface GraphEdge {
  source: string;
  target: string;
  kind: "uses" | "tagged" | "derived_from" | "similar" | "parent";
  weight?: number;
}
