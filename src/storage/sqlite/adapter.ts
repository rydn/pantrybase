import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { EMBED_DIMS } from "../../config.js";
import type {
  AnyCategory,
  CatalogEntry,
  DuplicateCandidate,
  FacetCategory,
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
  SourceKind,
  Stats,
  TagCount,
} from "../../types.js";
import type { ChunkPending, RecipeFileEntry, StorageAdapter } from "../types.js";
import { ALL_TABLES, SCHEMA_VERSION, schemaSql } from "./schema.js";

interface RecipeRow {
  id: number;
  slug: string;
  title: string;
  subtitle: string | null;
  servings: number | null;
  active_min: number | null;
  total_min: number | null;
  source_kind: SourceKind;
  provider_id: string | null;
  needs_review: number;
  doc: string;
  file_path: string;
  file_mtime: number;
  file_size: number;
  content_hash: string;
  created_at: string;
  updated_at: string;
}

interface IngredientDbRow {
  id: number;
  canonical: string;
  is_staple: number;
  category: string | null;
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

const toRow = (r: IngredientDbRow): IngredientRow => ({
  id: r.id,
  canonical: r.canonical,
  is_staple: r.is_staple === 1,
  category: r.category,
});

/**
 * Text chunks indexed per recipe. Each is embedded separately so a query can match the
 * dish identity, the description, the ingredient list or the method.
 */
export function recipeChunks(recipe: Recipe): Array<{ kind: string; text: string }> {
  const tagNames = [...new Set(Object.values(recipe.tags).flat())].join(", ");
  const title = [
    recipe.title,
    recipe.subtitle ?? "",
    tagNames ? `Tags: ${tagNames}` : "",
    recipe.provider?.plan ? `Plan: ${recipe.provider.plan}` : "",
  ]
    .filter(Boolean)
    .join(". ");
  const blurb = [recipe.blurb ?? "", recipe.description ?? ""].filter(Boolean).join(" ");
  const ingredients = `Ingredients: ${recipe.ingredients
    .map((i) =>
      i.components?.length ? `${i.raw} (${i.components.map((c) => c.raw).join(", ")})` : i.raw,
    )
    .join("; ")}`;
  const steps = [
    ...recipe.steps.map((s) => (s.title ? `${s.title}: ${s.text}` : s.text)),
    ...recipe.tips.map((t) => `Tip: ${t}`),
  ].join(" ");
  return [
    { kind: "title", text: title },
    { kind: "blurb", text: blurb },
    { kind: "ingredients", text: ingredients },
    { kind: "steps", text: steps },
  ].filter((c) => c.text.trim().length > 0);
}

/** Facets derived from structured fields: graph node types and filterable categories. */
export function recipeFacets(recipe: Recipe): Array<[FacetCategory, string]> {
  const out: Array<[FacetCategory, string]> = [];
  const add = (cat: FacetCategory, v: string | null | undefined) => {
    const t = v?.trim();
    if (t && !out.some(([c, n]) => c === cat && n === t)) out.push([cat, t]);
  };
  for (const a of recipe.allergens) add("allergen", a);
  for (const e of recipe.equipment) add("equipment", e);
  for (const s of recipe.steps) for (const t of s.techniques ?? []) add("technique", t);
  add("chef", recipe.provider?.chef);
  add("provider", recipe.provider?.id);
  add("plan", recipe.provider?.plan);
  return out;
}

// Filler words that would otherwise make the OR fallback match every recipe.
const STOPWORDS = new Set(
  (
    "a an and any are as at be but by can for from have i in into is it me my of on or our " +
    "recipe recipes some something that the this to use using want what with without you"
  ).split(" "),
);

function queryWords(query: string): string[] {
  return (query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((t) => !STOPWORDS.has(t));
}

function ftsTerms(query: string): string[] {
  return queryWords(query).map((t) => `"${t}"`);
}

function vecBlob(v: Float32Array): Buffer {
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
}

function dice(a: string, b: string): number {
  const grams = (s: string) => {
    const g = new Map<string, number>();
    const t = ` ${s.toLowerCase()} `;
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

const placeholders = (n: number) => Array.from({ length: n }, () => "?").join(",");

export class SqliteAdapter implements StorageAdapter {
  private readonly db: Database.Database;
  private readonly cache = new Map<string, Database.Statement>();
  readonly dims: number;
  /** True when an older schema was found and dropped; the caller should rebuild from files. */
  readonly wasReset: boolean;

  constructor(file: string, dims: number = EMBED_DIMS) {
    this.dims = dims;
    this.db = new Database(file);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    sqliteVec.load(this.db);
    this.wasReset = this.resetIfStale();
    this.db.exec(schemaSql(dims));
    this.setMeta("schema_version", String(SCHEMA_VERSION));
    this.setMeta("dims", String(dims));
  }

  private resetIfStale(): boolean {
    const hasMeta = this.db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'meta'")
      .get();
    if (!hasMeta) return false;
    const row = this.db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as
      | { value: string }
      | undefined;
    const dims = this.db.prepare("SELECT value FROM meta WHERE key = 'dims'").get() as
      | { value: string }
      | undefined;
    if (row?.value === String(SCHEMA_VERSION) && (!dims || dims.value === String(this.dims))) {
      return false;
    }
    this.db.pragma("foreign_keys = OFF");
    this.db.transaction(() => {
      for (const t of ALL_TABLES) this.db.exec(`DROP TABLE IF EXISTS ${t}`);
      this.db.exec("DELETE FROM meta");
    })();
    this.db.pragma("foreign_keys = ON");
    return true;
  }

  private s(sql: string): Database.Statement {
    let st = this.cache.get(sql);
    if (!st) {
      st = this.db.prepare(sql);
      this.cache.set(sql, st);
    }
    return st;
  }

  close(): void {
    this.db.close();
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  getMeta(key: string): string | undefined {
    const row = this.s("SELECT value FROM meta WHERE key = ?").get(key) as
      | { value: string }
      | undefined;
    return row?.value;
  }

  setMeta(key: string, value: string): void {
    this.s(
      "INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    ).run(key, value);
  }

  // ---------------------------------------------------------------- recipes

  upsertRecipe(recipe: Recipe, file: FileStat, ingredientIds: Map<string, number>): number {
    return this.transaction(() => {
      const now = new Date().toISOString();
      const existing = this.s("SELECT id FROM recipes WHERE slug = ?").get(recipe.slug) as
        | { id: number }
        | undefined;
      const cols = {
        title: recipe.title,
        subtitle: recipe.subtitle ?? null,
        servings: recipe.servings ?? null,
        active_min: recipe.time.active ?? null,
        total_min: recipe.time.total ?? null,
        source_kind: recipe.source.kind,
        provider_id: recipe.provider?.id ?? null,
        needs_review: recipe.extraction?.needs_review ? 1 : 0,
        energy_kcal: recipe.nutrition?.energy_kcal ?? null,
        nutrition_basis: recipe.nutrition?.basis ?? null,
        doc: JSON.stringify(recipe),
        file_path: file.file_path,
        file_mtime: Math.round(file.file_mtime),
        file_size: file.file_size,
        content_hash: file.content_hash,
        updated_at: now,
      };
      let id: number;
      // Keep embeddings of unchanged chunks so a rebuild does not re-embed everything.
      const keep = new Map<string, Buffer>();
      if (existing) {
        id = existing.id;
        for (const r of this.s(
          "SELECT c.hash, v.embedding FROM chunks c JOIN chunk_vec v ON v.chunk_id = c.id WHERE c.recipe_id = ?",
        ).all(id) as Array<{ hash: string; embedding: Buffer }>) {
          keep.set(r.hash, r.embedding);
        }
        const sets = Object.keys(cols)
          .map((k) => `${k} = @${k}`)
          .join(", ");
        this.s(`UPDATE recipes SET ${sets} WHERE id = @id`).run({ ...cols, id });
        for (const t of [
          "recipe_ingredients",
          "step_ingredients",
          "steps",
          "recipe_tags",
          "chunks",
        ]) {
          this.s(`DELETE FROM ${t} WHERE recipe_id = ?`).run(id);
        }
      } else {
        const keys = Object.keys(cols);
        const info = this.s(
          `INSERT INTO recipes(slug, created_at, ${keys.join(", ")}) VALUES (@slug, @created_at, ${keys
            .map((k) => `@${k}`)
            .join(", ")})`,
        ).run({ ...cols, slug: recipe.slug, created_at: now });
        id = Number(info.lastInsertRowid);
      }

      const insIng = this.s(
        `INSERT INTO recipe_ingredients(recipe_id, position, ingredient_id, raw, qty, unit, prep,
           optional, staple, source, brand, grp, extra) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      recipe.ingredients.forEach((ing, i) => {
        const ingId = ingredientIds.get(ing.canonical);
        if (ingId === undefined) {
          throw new Error(`no ingredient id resolved for "${ing.canonical}"`);
        }
        const extra =
          ing.alternatives?.length || ing.components?.length
            ? JSON.stringify({ alternatives: ing.alternatives, components: ing.components })
            : null;
        insIng.run(
          id,
          i,
          ingId,
          ing.raw,
          ing.qty ?? null,
          ing.unit ?? null,
          ing.prep ?? null,
          ing.optional ? 1 : 0,
          ing.staple ? 1 : 0,
          ing.source ?? null,
          ing.brand ?? null,
          ing.group ?? null,
          extra,
        );
      });

      const insStep = this.s(
        `INSERT INTO steps(recipe_id, position, title, text, techniques, equipment, uses, temp_c, minutes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const insUse = this.s(
        "INSERT OR IGNORE INTO step_ingredients(recipe_id, position, ingredient_id) VALUES (?, ?, ?)",
      );
      recipe.steps.forEach((step, i) => {
        insStep.run(
          id,
          i,
          step.title ?? null,
          step.text,
          JSON.stringify(step.techniques ?? []),
          JSON.stringify(step.equipment ?? []),
          JSON.stringify(step.uses ?? []),
          step.temp_c ?? null,
          step.minutes ? JSON.stringify(step.minutes) : null,
        );
        for (const use of step.uses ?? []) {
          const ingId = ingredientIds.get(use);
          if (ingId !== undefined) insUse.run(id, i, ingId);
        }
      });

      const insTag = this.s("INSERT OR IGNORE INTO tags(category, name) VALUES (?, ?)");
      const getTag = this.s("SELECT id FROM tags WHERE category = ? AND name = ?");
      const insRT = this.s(
        "INSERT OR IGNORE INTO recipe_tags(recipe_id, tag_id, origin) VALUES (?, ?, ?)",
      );
      const link = (category: string, name: string, origin: "tag" | "derived") => {
        insTag.run(category, name);
        const t = getTag.get(category, name) as { id: number };
        insRT.run(id, t.id, origin);
      };
      for (const [category, names] of Object.entries(recipe.tags)) {
        for (const name of names ?? []) link(category, name, "tag");
      }
      for (const [category, name] of recipeFacets(recipe)) link(category, name, "derived");

      const insChunk = this.s(
        "INSERT INTO chunks(recipe_id, kind, text, hash, embed_pending) VALUES (?, ?, ?, ?, ?)",
      );
      const insVec = this.s("INSERT INTO chunk_vec(chunk_id, embedding) VALUES (?, ?)");
      for (const c of recipeChunks(recipe)) {
        const h = sha(c.text);
        const kept = keep.get(h);
        const info = insChunk.run(id, c.kind, c.text, h, kept ? 0 : 1);
        // vec0 rejects REAL primary keys; better-sqlite3 binds JS numbers as REAL, so pass a BigInt.
        if (kept) insVec.run(BigInt(info.lastInsertRowid), kept);
      }
      return id;
    });
  }

  private rowToRecord(row: RecipeRow): RecipeRecord {
    const doc = JSON.parse(row.doc) as Recipe;
    return {
      ...doc,
      id: row.id,
      file_path: row.file_path,
      file_mtime: row.file_mtime,
      file_size: row.file_size,
      content_hash: row.content_hash,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  getRecipe(slug: string): RecipeRecord | undefined {
    const row = this.s("SELECT * FROM recipes WHERE slug = ?").get(slug) as RecipeRow | undefined;
    return row ? this.rowToRecord(row) : undefined;
  }

  private rowToSummary(row: RecipeRow): RecipeSummary {
    const doc = JSON.parse(row.doc) as Recipe;
    const s: RecipeSummary = {
      id: row.id,
      slug: row.slug,
      title: row.title,
      total_min: row.total_min,
      active_min: row.active_min,
      servings: row.servings,
      source_kind: row.source_kind,
      provider_id: row.provider_id,
      needs_review: row.needs_review === 1,
      tags: doc.tags,
      allergens: doc.allergens ?? [],
      images: doc.images,
    };
    if (doc.subtitle) s.subtitle = doc.subtitle;
    if (doc.blurb) s.blurb = doc.blurb;
    return s;
  }

  private filterSql(filters?: SearchFilters): { where: string; params: unknown[] } {
    const where: string[] = [];
    const params: unknown[] = [];
    if (!filters) return { where: "", params };
    if (filters.max_total_min !== undefined) {
      where.push("total_min IS NOT NULL AND total_min <= ?");
      params.push(filters.max_total_min);
    }
    if (filters.max_active_min !== undefined) {
      where.push(
        "COALESCE(active_min, total_min) IS NOT NULL AND COALESCE(active_min, total_min) <= ?",
      );
      params.push(filters.max_active_min);
    }
    if (filters.source_kind) {
      where.push("source_kind = ?");
      params.push(filters.source_kind);
    }
    if (filters.provider) {
      where.push("provider_id = ?");
      params.push(filters.provider.toLowerCase());
    }
    if (filters.needs_review !== undefined) {
      where.push("needs_review = ?");
      params.push(filters.needs_review ? 1 : 0);
    }
    for (const [category, names] of Object.entries(filters.tags ?? {})) {
      if (!names || names.length === 0) continue;
      where.push(
        `id IN (SELECT rt.recipe_id FROM recipe_tags rt JOIN tags t ON t.id = rt.tag_id
                WHERE t.category = ? AND lower(t.name) IN (${placeholders(names.length)}))`,
      );
      params.push(category, ...names.map((n) => n.toLowerCase().trim()));
    }
    if (filters.exclude_allergens?.length) {
      where.push(
        `id NOT IN (SELECT rt.recipe_id FROM recipe_tags rt JOIN tags t ON t.id = rt.tag_id
                    WHERE t.category = 'allergen' AND t.name IN (${placeholders(filters.exclude_allergens.length)}))`,
      );
      params.push(...filters.exclude_allergens);
    }
    if (filters.exclude_ingredients?.length) {
      where.push(
        `id NOT IN (SELECT ri.recipe_id FROM recipe_ingredients ri
                    JOIN ingredient_aliases a ON a.ingredient_id = ri.ingredient_id
                    WHERE a.alias IN (${placeholders(filters.exclude_ingredients.length)}))`,
      );
      params.push(...filters.exclude_ingredients.map((n) => n.toLowerCase().trim()));
    }
    return { where: where.length ? `WHERE ${where.join(" AND ")}` : "", params };
  }

  listRecipes(opts: { filters?: SearchFilters; limit?: number; offset?: number }): RecipeSummary[] {
    const { where, params } = this.filterSql(opts.filters);
    const rows = this.s(
      `SELECT * FROM recipes ${where} ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?`,
    ).all(...params, opts.limit ?? 50, opts.offset ?? 0) as RecipeRow[];
    return rows.map((r) => this.rowToSummary(r));
  }

  summariesByIds(ids: number[]): RecipeSummary[] {
    if (ids.length === 0) return [];
    const rows = this.s(`SELECT * FROM recipes WHERE id IN (${placeholders(ids.length)})`).all(
      ...ids,
    ) as RecipeRow[];
    const byId = new Map(rows.map((r) => [r.id, this.rowToSummary(r)]));
    return ids.map((id) => byId.get(id)).filter((x): x is RecipeSummary => x !== undefined);
  }

  deleteRecipe(slug: string): void {
    this.s("DELETE FROM recipes WHERE slug = ?").run(slug);
  }

  recipeFileIndex(): Map<string, RecipeFileEntry> {
    const rows = this.s(
      "SELECT slug, file_path, file_mtime, file_size, content_hash FROM recipes",
    ).all() as RecipeFileEntry[];
    return new Map(rows.map((r) => [r.file_path, r]));
  }

  touchFile(file_path: string, mtime: number, size: number): void {
    this.s("UPDATE recipes SET file_mtime = ?, file_size = ? WHERE file_path = ?").run(
      Math.round(mtime),
      size,
      file_path,
    );
  }

  filterRecipeIds(filters?: SearchFilters): Set<number> | null {
    const { where, params } = this.filterSql(filters);
    if (!where) return null;
    const rows = this.s(`SELECT id FROM recipes ${where}`).all(...params) as Array<{ id: number }>;
    return new Set(rows.map((r) => r.id));
  }

  findDuplicates(title: string, canonicals: string[], excludeSlug?: string): DuplicateCandidate[] {
    const out: DuplicateCandidate[] = [];
    const titles = this.s("SELECT id, slug, title FROM recipes").all() as Array<{
      id: number;
      slug: string;
      title: string;
    }>;
    for (const t of titles) {
      if (t.slug === excludeSlug) continue;
      const score = dice(title, t.title);
      if (score >= 0.9) out.push({ slug: t.slug, title: t.title, reason: "title", score });
    }
    const names = [...new Set(canonicals.map((c) => c.toLowerCase().trim()))];
    if (names.length >= 3) {
      const overlaps = this.s(
        `SELECT ri.recipe_id, COUNT(DISTINCT ri.ingredient_id) AS overlap,
                (SELECT COUNT(DISTINCT r2.ingredient_id) FROM recipe_ingredients r2
                   JOIN ingredients i2 ON i2.id = r2.ingredient_id
                   WHERE r2.recipe_id = ri.recipe_id AND i2.is_staple = 0) AS total
         FROM recipe_ingredients ri JOIN ingredients i ON i.id = ri.ingredient_id
         WHERE i.is_staple = 0 AND i.canonical IN (${placeholders(names.length)})
         GROUP BY ri.recipe_id`,
      ).all(...names) as Array<{ recipe_id: number; overlap: number; total: number }>;
      const staples = new Set(
        (
          this.s("SELECT canonical FROM ingredients WHERE is_staple = 1").all() as Array<{
            canonical: string;
          }>
        ).map((r) => r.canonical),
      );
      const mineNonStaple = names.filter((n) => !staples.has(n)).length;
      for (const o of overlaps) {
        const union = mineNonStaple + o.total - o.overlap;
        const jaccard = union === 0 ? 0 : o.overlap / union;
        if (jaccard >= 0.8) {
          const t = titles.find((x) => x.id === o.recipe_id);
          if (t && t.slug !== excludeSlug && !out.some((d) => d.slug === t.slug)) {
            out.push({ slug: t.slug, title: t.title, reason: "ingredients", score: jaccard });
          }
        }
      }
    }
    return out.sort((a, b) => b.score - a.score);
  }

  // ------------------------------------------------------------ ingredients

  getIngredient(nameOrAlias: string): IngredientRow | undefined {
    const n = nameOrAlias.toLowerCase().trim();
    const row = this.s(
      `SELECT i.* FROM ingredients i WHERE i.canonical = ?
       UNION ALL
       SELECT i.* FROM ingredient_aliases a JOIN ingredients i ON i.id = a.ingredient_id WHERE a.alias = ?
       LIMIT 1`,
    ).get(n, n) as IngredientDbRow | undefined;
    return row ? toRow(row) : undefined;
  }

  createIngredient(entry: CatalogEntry): IngredientRow {
    return this.transaction(() => {
      const canonical = entry.canonical.toLowerCase().trim();
      const info = this.s(
        "INSERT INTO ingredients(canonical, is_staple, category) VALUES (?, ?, ?)",
      ).run(canonical, entry.staple ? 1 : 0, entry.category ?? null);
      const id = Number(info.lastInsertRowid);
      this.addAlias(id, canonical);
      for (const a of entry.aliases ?? []) this.addAlias(id, a);
      return { id, canonical, is_staple: !!entry.staple, category: entry.category ?? null };
    });
  }

  addAlias(ingredientId: number, alias: string): void {
    this.s("INSERT OR IGNORE INTO ingredient_aliases(alias, ingredient_id) VALUES (?, ?)").run(
      alias.toLowerCase().trim(),
      ingredientId,
    );
  }

  upsertCatalogEntry(entry: CatalogEntry): IngredientRow {
    return this.transaction(() => {
      const existing = this.getIngredient(entry.canonical);
      if (!existing) return this.createIngredient(entry);
      if (entry.staple !== undefined || entry.category !== undefined) {
        this.s("UPDATE ingredients SET is_staple = ?, category = ? WHERE id = ?").run(
          entry.staple === undefined ? (existing.is_staple ? 1 : 0) : entry.staple ? 1 : 0,
          entry.category === undefined ? existing.category : entry.category,
          existing.id,
        );
      }
      for (const a of entry.aliases ?? []) this.addAlias(existing.id, a);
      return this.getIngredient(entry.canonical) ?? existing;
    });
  }

  fuzzyIngredients(name: string, limit: number): Array<{ row: IngredientRow; alias: string }> {
    const n = name.toLowerCase().trim();
    if (n.length < 3) return [];
    let rows: Array<IngredientDbRow & { alias: string }> = [];
    try {
      rows = this.s(
        `SELECT i.*, a.alias FROM alias_tri t
         JOIN ingredient_aliases a ON a.id = t.rowid
         JOIN ingredients i ON i.id = a.ingredient_id
         WHERE alias_tri MATCH ? ORDER BY t.rank LIMIT ?`,
      ).all(`"${n.replace(/"/g, '""')}"`, limit * 3) as typeof rows;
    } catch {
      rows = [];
    }
    return rows
      .map((r) => ({ row: toRow(r), alias: r.alias, score: dice(n, r.alias) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ row, alias }) => ({ row, alias }));
  }

  listIngredients(opts: {
    query?: string;
    limit?: number;
  }): Array<IngredientRow & { recipe_count: number }> {
    const q = opts.query?.toLowerCase().trim();
    const rows = this.s(
      `SELECT i.*, (SELECT COUNT(DISTINCT recipe_id) FROM recipe_ingredients ri WHERE ri.ingredient_id = i.id) AS recipe_count
       FROM ingredients i
       ${q ? "WHERE i.id IN (SELECT ingredient_id FROM ingredient_aliases WHERE alias LIKE ?)" : ""}
       ORDER BY recipe_count DESC, i.canonical LIMIT ?`,
    ).all(...(q ? [`%${q}%`] : []), opts.limit ?? 100) as Array<
      IngredientDbRow & { recipe_count: number }
    >;
    return rows.map((r) => ({ ...toRow(r), recipe_count: r.recipe_count }));
  }

  // ------------------------------------------------------------------- tags

  listTags(category?: AnyCategory): TagCount[] {
    return this.s(
      `SELECT t.category, t.name, COUNT(rt.recipe_id) AS count
       FROM tags t JOIN recipe_tags rt ON rt.tag_id = t.id
       ${category ? "WHERE t.category = ?" : ""}
       GROUP BY t.id ORDER BY t.category, count DESC, t.name`,
    ).all(...(category ? [category] : [])) as TagCount[];
  }

  // ----------------------------------------------------------------- search

  private chunkHits(sql: string, ...params: unknown[]): SearchHit[] {
    const rows = this.s(sql).all(...params) as Array<{
      recipe_id: number;
      slug: string;
      kind: string;
    }>;
    const seen = new Set<number>();
    const out: SearchHit[] = [];
    for (const r of rows) {
      if (seen.has(r.recipe_id)) continue;
      seen.add(r.recipe_id);
      out.push({ recipe_id: r.recipe_id, slug: r.slug, chunk_kind: r.kind });
    }
    return out;
  }

  private ftsHits(table: string, match: string, limit: number): SearchHit[] {
    try {
      return this.chunkHits(
        `SELECT c.recipe_id, r.slug, c.kind
         FROM (SELECT rowid, rank FROM ${table} WHERE ${table} MATCH ? ORDER BY rank LIMIT ?) f
         JOIN chunks c ON c.id = f.rowid JOIN recipes r ON r.id = c.recipe_id
         ORDER BY f.rank`,
        match,
        limit * 3,
      );
    } catch {
      return [];
    }
  }

  searchLexical(query: string, limit: number): SearchHit[] {
    const terms = ftsTerms(query);
    if (terms.length === 0) return [];
    const strict = this.ftsHits("chunks_fts", terms.join(" "), limit);
    if (strict.length > 0 || terms.length === 1) return strict;
    return this.ftsHits("chunks_fts", terms.join(" OR "), limit);
  }

  /**
   * Typo-tolerant pass: a quoted term in a trigram index only matches as an exact substring,
   * so split each term into its trigrams and OR them; bm25 then rewards the most overlap.
   */
  searchTrigram(query: string, limit: number): SearchHit[] {
    const grams = new Set<string>();
    for (const term of queryWords(query).filter((t) => t.length >= 4)) {
      for (let i = 0; i + 3 <= term.length; i++) grams.add(`"${term.slice(i, i + 3)}"`);
    }
    if (grams.size === 0) return [];
    return this.ftsHits("chunks_tri", [...grams].join(" OR "), limit);
  }

  searchVector(embedding: Float32Array, limit: number): SearchHit[] {
    return this.chunkHits(
      `SELECT c.recipe_id, r.slug, c.kind
       FROM (SELECT chunk_id, distance FROM chunk_vec WHERE embedding MATCH ? AND k = ? ORDER BY distance) v
       JOIN chunks c ON c.id = v.chunk_id JOIN recipes r ON r.id = c.recipe_id
       ORDER BY v.distance`,
      vecBlob(embedding),
      limit * 3,
    );
  }

  // ------------------------------------------------------------- embeddings

  pendingChunks(limit: number): ChunkPending[] {
    return this.s("SELECT id, text FROM chunks WHERE embed_pending = 1 ORDER BY id LIMIT ?").all(
      limit,
    ) as ChunkPending[];
  }

  storeEmbeddings(rows: Array<{ id: number; embedding: Float32Array }>): void {
    this.transaction(() => {
      const del = this.s("DELETE FROM chunk_vec WHERE chunk_id = ?");
      const ins = this.s("INSERT INTO chunk_vec(chunk_id, embedding) VALUES (?, ?)");
      const done = this.s("UPDATE chunks SET embed_pending = 0 WHERE id = ?");
      for (const r of rows) {
        del.run(r.id);
        ins.run(BigInt(r.id), vecBlob(r.embedding));
        done.run(r.id);
      }
    });
  }

  resetVectors(): void {
    this.transaction(() => {
      this.db.exec("DELETE FROM chunk_vec");
      this.db.exec("UPDATE chunks SET embed_pending = 1");
    });
  }

  stats(): Stats {
    const one = (sql: string) => (this.s(sql).get() as { n: number }).n;
    return {
      recipes: one("SELECT COUNT(*) n FROM recipes"),
      ingredients: one("SELECT COUNT(*) n FROM ingredients"),
      tags: one("SELECT COUNT(*) n FROM tags"),
      chunks: one("SELECT COUNT(*) n FROM chunks"),
      chunks_pending: one("SELECT COUNT(*) n FROM chunks WHERE embed_pending = 1"),
      vectors: one("SELECT COUNT(*) n FROM chunk_vec"),
      needs_review: one("SELECT COUNT(*) n FROM recipes WHERE needs_review = 1"),
    };
  }

  // ----------------------------------------------------------------- pantry

  pantryList(): PantryItem[] {
    return this.s(
      `SELECT p.ingredient_id, i.canonical, p.qty, p.unit, p.note, p.added_at
       FROM pantry_items p JOIN ingredients i ON i.id = p.ingredient_id ORDER BY i.canonical`,
    ).all() as PantryItem[];
  }

  pantryUpsert(
    ingredientId: number,
    fields: { qty?: number | null; unit?: string | null; note?: string | null },
  ): void {
    this.s(
      `INSERT INTO pantry_items(ingredient_id, qty, unit, note, added_at) VALUES (@id, @qty, @unit, @note, @now)
       ON CONFLICT(ingredient_id) DO UPDATE SET
         qty = COALESCE(excluded.qty, qty), unit = COALESCE(excluded.unit, unit), note = COALESCE(excluded.note, note)`,
    ).run({
      id: ingredientId,
      qty: fields.qty ?? null,
      unit: fields.unit ?? null,
      note: fields.note ?? null,
      now: new Date().toISOString(),
    });
  }

  pantryRemove(ingredientIds: number[]): number {
    if (ingredientIds.length === 0) return 0;
    return this.s(
      `DELETE FROM pantry_items WHERE ingredient_id IN (${placeholders(ingredientIds.length)})`,
    ).run(...ingredientIds).changes;
  }

  pantryClear(): number {
    return this.s("DELETE FROM pantry_items").run().changes;
  }

  recipeRequirements(recipeIds?: number[]): RequirementRow[] {
    const where = recipeIds ? `WHERE ri.recipe_id IN (${placeholders(recipeIds.length)})` : "";
    if (recipeIds && recipeIds.length === 0) return [];
    const rows = this.s(
      `SELECT ri.recipe_id, r.slug, r.title, ri.ingredient_id, i.canonical, ri.raw,
              (ri.staple OR i.is_staple) AS staple, ri.optional, ri.extra
       FROM recipe_ingredients ri
       JOIN ingredients i ON i.id = ri.ingredient_id
       JOIN recipes r ON r.id = ri.recipe_id
       ${where} ORDER BY ri.recipe_id, ri.position`,
    ).all(...(recipeIds ?? [])) as Array<
      Omit<RequirementRow, "staple" | "optional"> & { staple: number; optional: number }
    >;
    return rows.map((r) => ({ ...r, staple: r.staple === 1, optional: r.optional === 1 }));
  }

  recipesUsingIngredient(ingredientId: number): string[] {
    return (
      this.s(
        `SELECT DISTINCT r.slug FROM recipes r WHERE r.id IN (
           SELECT recipe_id FROM recipe_ingredients WHERE ingredient_id = ?
           UNION SELECT recipe_id FROM step_ingredients WHERE ingredient_id = ?)
         ORDER BY r.slug`,
      ).all(ingredientId, ingredientId) as Array<{ slug: string }>
    ).map((r) => r.slug);
  }

  mergeIngredientRows(fromId: number, intoId: number): void {
    this.transaction(() => {
      this.s(
        "UPDATE OR IGNORE ingredient_aliases SET ingredient_id = ? WHERE ingredient_id = ?",
      ).run(intoId, fromId);
      const pantry = this.s("SELECT * FROM pantry_items WHERE ingredient_id = ?").get(fromId);
      if (pantry) {
        this.s(
          "INSERT OR IGNORE INTO pantry_items(ingredient_id, qty, unit, note, added_at) SELECT ?, qty, unit, note, added_at FROM pantry_items WHERE ingredient_id = ?",
        ).run(intoId, fromId);
      }
      this.s(
        "UPDATE OR IGNORE recipe_ingredients SET ingredient_id = ? WHERE ingredient_id = ?",
      ).run(intoId, fromId);
      this.s("UPDATE OR IGNORE step_ingredients SET ingredient_id = ? WHERE ingredient_id = ?").run(
        intoId,
        fromId,
      );
      this.s("DELETE FROM step_ingredients WHERE ingredient_id = ?").run(fromId);
      this.s("DELETE FROM pantry_items WHERE ingredient_id = ?").run(fromId);
      this.s("DELETE FROM ingredients WHERE id = ?").run(fromId);
    });
  }

  // ------------------------------------------------------------------ graph

  graphRows() {
    const recipes = this.s("SELECT id, slug, title, doc FROM recipes ORDER BY id").all() as Array<{
      id: number;
      slug: string;
      title: string;
      doc: string;
    }>;
    const uses = (
      this.s(
        `SELECT DISTINCT ri.recipe_id, ri.ingredient_id, i.canonical,
                MAX(ri.staple OR i.is_staple) AS staple, i.category
         FROM recipe_ingredients ri JOIN ingredients i ON i.id = ri.ingredient_id
         GROUP BY ri.recipe_id, ri.ingredient_id`,
      ).all() as Array<{
        recipe_id: number;
        ingredient_id: number;
        canonical: string;
        staple: number;
        category: string | null;
      }>
    ).map((u) => ({ ...u, staple: u.staple === 1 }));
    const tags = this.s(
      `SELECT rt.recipe_id, t.category, t.name FROM recipe_tags rt JOIN tags t ON t.id = rt.tag_id`,
    ).all() as Array<{ recipe_id: number; category: string; name: string }>;
    return { recipes, uses, tags };
  }

  similarRecipes(recipeId: number, k: number): Array<{ recipe_id: number; distance: number }> {
    const own = this.s(
      `SELECT v.embedding FROM chunks c JOIN chunk_vec v ON v.chunk_id = c.id
       WHERE c.recipe_id = ? AND c.kind IN ('blurb', 'title') ORDER BY c.kind = 'blurb' DESC LIMIT 1`,
    ).get(recipeId) as { embedding: Buffer } | undefined;
    if (!own) return [];
    const rows = this.s(
      `SELECT c.recipe_id, MIN(v.distance) AS distance
       FROM (SELECT chunk_id, distance FROM chunk_vec WHERE embedding MATCH ? AND k = ? ORDER BY distance) v
       JOIN chunks c ON c.id = v.chunk_id
       WHERE c.recipe_id != ? AND c.kind IN ('blurb', 'title')
       GROUP BY c.recipe_id ORDER BY distance LIMIT ?`,
    ).all(own.embedding, k * 6, recipeId, k) as Array<{ recipe_id: number; distance: number }>;
    return rows;
  }

  // ------------------------------------------------------------ photo queue

  ingestByPath(path: string): IngestItem | undefined {
    return this.s("SELECT * FROM ingest_items WHERE path = ?").get(path) as IngestItem | undefined;
  }

  ingestBySha(sha256: string): IngestItem | undefined {
    return this.s("SELECT * FROM ingest_items WHERE sha256 = ?").get(sha256) as
      | IngestItem
      | undefined;
  }

  ingestByIds(ids: number[]): IngestItem[] {
    if (ids.length === 0) return [];
    const rows = this.s(`SELECT * FROM ingest_items WHERE id IN (${placeholders(ids.length)})`).all(
      ...ids,
    ) as IngestItem[];
    const byId = new Map(rows.map((r) => [r.id, r]));
    return ids.map((id) => byId.get(id)).filter((r): r is IngestItem => r !== undefined);
  }

  insertIngest(item: Omit<IngestItem, "id" | "created_at" | "updated_at">): IngestItem {
    const now = new Date().toISOString();
    const row = { ...item, created_at: now, updated_at: now };
    const keys = Object.keys(row);
    const info = this.s(
      `INSERT INTO ingest_items(${keys.join(", ")}) VALUES (${keys.map((k) => `@${k}`).join(", ")})`,
    ).run(row);
    return { ...row, id: Number(info.lastInsertRowid) };
  }

  updateIngest(id: number, fields: Partial<Omit<IngestItem, "id" | "created_at">>): void {
    const row = { ...fields, updated_at: new Date().toISOString() };
    const sets = Object.keys(row)
      .map((k) => `${k} = @${k}`)
      .join(", ");
    this.s(`UPDATE ingest_items SET ${sets} WHERE id = @id`).run({ ...row, id });
  }

  deleteIngest(id: number): void {
    this.s("DELETE FROM ingest_items WHERE id = ?").run(id);
  }

  listIngest(opts: { status?: IngestStatus; limit?: number; offset?: number }): IngestItem[] {
    return this.s(
      `SELECT * FROM ingest_items ${opts.status ? "WHERE status = ?" : ""}
       ORDER BY captured_at, original_name, id LIMIT ? OFFSET ?`,
    ).all(
      ...(opts.status ? [opts.status] : []),
      opts.limit ?? 50,
      opts.offset ?? 0,
    ) as IngestItem[];
  }

  allIngest(): IngestItem[] {
    return this.s(
      "SELECT * FROM ingest_items ORDER BY captured_at, original_name, id",
    ).all() as IngestItem[];
  }

  ingestCounts(): IngestCounts {
    const counts: IngestCounts = { pending: 0, done: 0, skipped: 0, failed: 0 };
    for (const r of this.s(
      "SELECT status, COUNT(*) n FROM ingest_items GROUP BY status",
    ).all() as Array<{
      status: IngestStatus;
      n: number;
    }>) {
      counts[r.status] = r.n;
    }
    return counts;
  }
}
