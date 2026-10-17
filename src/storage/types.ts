import type {
  AnyCategory,
  CatalogEntry,
  DuplicateCandidate,
  FileStat,
  IngestCounts,
  IngestItem,
  IngestStatus,
  IngredientRow,
  PantryItem,
  Recipe,
  RecipeRecord,
  RecipeSummary,
  RequirementRow,
  SearchFilters,
  SearchHit,
  Stats,
  TagCount,
} from "../types.js";

export interface ChunkPending {
  id: number;
  text: string;
}

export interface RecipeFileEntry extends FileStat {
  slug: string;
}

/**
 * Everything the rest of pantrybase needs from a database. SQL lives only in
 * implementations of this interface so another store can replace SQLite.
 */
export interface StorageAdapter {
  readonly dims: number;
  /** True when the store discarded an incompatible older index; rebuild from the files. */
  readonly wasReset: boolean;
  close(): void;
  transaction<T>(fn: () => T): T;

  getMeta(key: string): string | undefined;
  setMeta(key: string, value: string): void;

  // recipes
  upsertRecipe(recipe: Recipe, file: FileStat, ingredientIds: Map<string, number>): number;
  getRecipe(slug: string): RecipeRecord | undefined;
  listRecipes(opts: { filters?: SearchFilters; limit?: number; offset?: number }): RecipeSummary[];
  summariesByIds(ids: number[]): RecipeSummary[];
  deleteRecipe(slug: string): void;
  recipeFileIndex(): Map<string, RecipeFileEntry>;
  touchFile(file_path: string, mtime: number, size: number): void;
  /** Recipe ids passing the filters, or null when there are no filters. */
  filterRecipeIds(filters?: SearchFilters): Set<number> | null;
  findDuplicates(title: string, canonicals: string[], excludeSlug?: string): DuplicateCandidate[];

  // ingredients
  getIngredient(nameOrAlias: string): IngredientRow | undefined;
  createIngredient(entry: CatalogEntry): IngredientRow;
  addAlias(ingredientId: number, alias: string): void;
  upsertCatalogEntry(entry: CatalogEntry): IngredientRow;
  fuzzyIngredients(name: string, limit: number): Array<{ row: IngredientRow; alias: string }>;
  listIngredients(opts: {
    query?: string;
    limit?: number;
  }): Array<IngredientRow & { recipe_count: number }>;

  // tags (assigned) and facets (derived)
  listTags(category?: AnyCategory): TagCount[];

  // search
  searchLexical(query: string, limit: number): SearchHit[];
  searchTrigram(query: string, limit: number): SearchHit[];
  searchVector(embedding: Float32Array, limit: number): SearchHit[];

  // embeddings
  pendingChunks(limit: number): ChunkPending[];
  storeEmbeddings(rows: Array<{ id: number; embedding: Float32Array }>): void;
  resetVectors(): void;

  stats(): Stats;

  // pantry
  pantryList(): PantryItem[];
  pantryUpsert(
    ingredientId: number,
    fields: { qty?: number | null; unit?: string | null; note?: string | null },
  ): void;
  pantryRemove(ingredientIds: number[]): number;
  pantryClear(): number;
  /** Every recipe ingredient line (optionally limited to some recipes), for matching. */
  recipeRequirements(recipeIds?: number[]): RequirementRow[];
  /** Slugs of recipes that use an ingredient (in a line or a step). */
  recipesUsingIngredient(ingredientId: number): string[];
  /** Move aliases (and pantry entry) from one ingredient to another and delete the first. */
  mergeIngredientRows(fromId: number, intoId: number): void;

  // graph
  graphRows(): {
    recipes: Array<{ id: number; slug: string; title: string; doc: string }>;
    uses: Array<{
      recipe_id: number;
      ingredient_id: number;
      canonical: string;
      staple: boolean;
      category: string | null;
    }>;
    tags: Array<{ recipe_id: number; category: string; name: string }>;
  };
  /** Nearest recipes by the embedding of their title chunk (empty when nothing is embedded). */
  similarRecipes(recipeId: number, k: number): Array<{ recipe_id: number; distance: number }>;

  // photo queue
  ingestByPath(path: string): IngestItem | undefined;
  ingestBySha(sha256: string): IngestItem | undefined;
  ingestByIds(ids: number[]): IngestItem[];
  insertIngest(item: Omit<IngestItem, "id" | "created_at" | "updated_at">): IngestItem;
  updateIngest(id: number, fields: Partial<Omit<IngestItem, "id" | "created_at">>): void;
  deleteIngest(id: number): void;
  listIngest(opts: { status?: IngestStatus; limit?: number; offset?: number }): IngestItem[];
  allIngest(): IngestItem[];
  ingestCounts(): IngestCounts;
}
