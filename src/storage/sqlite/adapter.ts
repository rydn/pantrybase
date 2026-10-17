import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { EMBED_DIMS } from "../../config.js";
import type {
  CatalogEntry,
  DuplicateCandidate,
  FileStat,
  IngredientRow,
  Recipe,
  RecipeIngredient,
  RecipeRecord,
  RecipeSummary,
  RecipeTags,
  SearchFilters,
  SearchHit,
  SourceKind,
  Stats,
  TagCategory,
  TagCount,
} from "../../types.js";
import { TAG_CATEGORIES } from "../../types.js";
import type { ChunkPending, RecipeFileEntry, StorageAdapter } from "../types.js";
import { SCHEMA_VERSION, schemaSql } from "./schema.js";

interface RecipeRow {
  id: number;
  slug: string;
  title: string;
  summary: string | null;
  servings: number | null;
  prep_min: number | null;
  cook_min: number | null;
  total_min: number | null;
  difficulty: string | null;
  source_kind: SourceKind;
  source_ref: string | null;
  source_ingested: string | null;
  derived_from: string;
  images: string;
  tags: string;
  notes: string | null;
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

/** Text chunks that get indexed for a recipe: title+summary, ingredients, steps. */
export function recipeChunks(recipe: Recipe): Array<{ kind: string; text: string }> {
  const tagNames = Object.values(recipe.tags).flat().join(", ");
  const title = [recipe.title, recipe.summary ?? "", tagNames ? `Tags: ${tagNames}` : ""]
    .filter(Boolean)
    .join(". ");
  const ingredients = `Ingredients: ${recipe.ingredients.map((i) => i.raw).join("; ")}`;
  const steps = recipe.steps.join(" ");
  return [
    { kind: "title", text: title },
    { kind: "ingredients", text: ingredients },
    { kind: "steps", text: steps },
  ].filter((c) => c.text.trim().length > 0);
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

export class SqliteAdapter implements StorageAdapter {
  private readonly db: Database.Database;
  private readonly cache = new Map<string, Database.Statement>();
  readonly dims: number;

  constructor(file: string, dims: number = EMBED_DIMS) {
    this.dims = dims;
    this.db = new Database(file);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    sqliteVec.load(this.db);
    this.db.exec(schemaSql(dims));
    this.setMeta("schema_version", String(SCHEMA_VERSION));
    this.setMeta("dims", String(dims));
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
        summary: recipe.summary ?? null,
        servings: recipe.servings ?? null,
        prep_min: recipe.time.prep ?? null,
        cook_min: recipe.time.cook ?? null,
        total_min: recipe.time.total ?? null,
        difficulty: recipe.difficulty ?? null,
        source_kind: recipe.source.kind,
        source_ref: recipe.source.ref ?? null,
        source_ingested: recipe.source.ingested ?? null,
        derived_from: JSON.stringify(recipe.derived_from),
        images: JSON.stringify(recipe.images),
        tags: JSON.stringify(recipe.tags),
        notes: recipe.notes ?? null,
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
        for (const t of ["recipe_ingredients", "steps", "recipe_tags", "chunks"]) {
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
        "INSERT INTO recipe_ingredients(recipe_id, position, ingredient_id, raw, qty, unit, prep, optional) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      );
      recipe.ingredients.forEach((ing, i) => {
        const ingId = ingredientIds.get(ing.canonical);
        if (ingId === undefined) {
          throw new Error(`no ingredient id resolved for "${ing.canonical}"`);
        }
        insIng.run(
          id,
          i,
          ingId,
          ing.raw,
          ing.qty ?? null,
          ing.unit ?? null,
          ing.prep ?? null,
          ing.optional ? 1 : 0,
        );
      });

      const insStep = this.s("INSERT INTO steps(recipe_id, position, text) VALUES (?, ?, ?)");
      recipe.steps.forEach((t, i) => {
        insStep.run(id, i, t);
      });

      const insTag = this.s("INSERT OR IGNORE INTO tags(category, name) VALUES (?, ?)");
      const getTag = this.s("SELECT id FROM tags WHERE category = ? AND name = ?");
      const insRT = this.s("INSERT OR IGNORE INTO recipe_tags(recipe_id, tag_id) VALUES (?, ?)");
      for (const [category, names] of Object.entries(recipe.tags)) {
        for (const name of names ?? []) {
          insTag.run(category, name);
          const t = getTag.get(category, name) as { id: number };
          insRT.run(id, t.id);
        }
      }

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
    const ingredients = this.s(
      `SELECT ri.raw, ri.qty, ri.unit, ri.prep, ri.optional, i.canonical, i.is_staple
       FROM recipe_ingredients ri JOIN ingredients i ON i.id = ri.ingredient_id
       WHERE ri.recipe_id = ? ORDER BY ri.position`,
    ).all(row.id) as Array<{
      raw: string;
      qty: number | null;
      unit: string | null;
      prep: string | null;
      optional: number;
      canonical: string;
      is_staple: number;
    }>;
    const steps = this.s("SELECT text FROM steps WHERE recipe_id = ? ORDER BY position").all(
      row.id,
    ) as Array<{ text: string }>;
    const ings: RecipeIngredient[] = ingredients.map((r) => {
      const ing: RecipeIngredient = { raw: r.raw, canonical: r.canonical };
      if (r.qty !== null) ing.qty = r.qty;
      if (r.unit !== null) ing.unit = r.unit;
      if (r.prep !== null) ing.prep = r.prep;
      if (r.optional === 1) ing.optional = true;
      if (r.is_staple === 1) ing.staple = true;
      return ing;
    });
    const rec: RecipeRecord = {
      id: row.id,
      slug: row.slug,
      title: row.title,
      time: { prep: row.prep_min, cook: row.cook_min, total: row.total_min },
      source: { kind: row.source_kind },
      derived_from: JSON.parse(row.derived_from) as string[],
      images: JSON.parse(row.images) as string[],
      tags: JSON.parse(row.tags) as RecipeTags,
      ingredients: ings,
      steps: steps.map((s) => s.text),
      file_path: row.file_path,
      file_mtime: row.file_mtime,
      file_size: row.file_size,
      content_hash: row.content_hash,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
    if (row.summary !== null) rec.summary = row.summary;
    if (row.servings !== null) rec.servings = row.servings;
    if (row.difficulty !== null) rec.difficulty = row.difficulty as RecipeRecord["difficulty"];
    if (row.source_ref !== null) rec.source.ref = row.source_ref;
    if (row.source_ingested !== null) rec.source.ingested = row.source_ingested;
    if (row.notes !== null) rec.notes = row.notes;
    return rec;
  }

  getRecipe(slug: string): RecipeRecord | undefined {
    const row = this.s("SELECT * FROM recipes WHERE slug = ?").get(slug) as RecipeRow | undefined;
    return row ? this.rowToRecord(row) : undefined;
  }

  private rowToSummary(row: RecipeRow): RecipeSummary {
    const s: RecipeSummary = {
      id: row.id,
      slug: row.slug,
      title: row.title,
      total_min: row.total_min,
      servings: row.servings,
      source_kind: row.source_kind,
      tags: JSON.parse(row.tags) as RecipeTags,
      images: JSON.parse(row.images) as string[],
    };
    if (row.summary !== null) s.summary = row.summary;
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
    if (filters.source_kind) {
      where.push("source_kind = ?");
      params.push(filters.source_kind);
    }
    for (const [category, names] of Object.entries(filters.tags ?? {})) {
      if (!names || names.length === 0) continue;
      where.push(
        `id IN (SELECT rt.recipe_id FROM recipe_tags rt JOIN tags t ON t.id = rt.tag_id
                WHERE t.category = ? AND t.name IN (${names.map(() => "?").join(",")}))`,
      );
      params.push(category, ...names.map((n) => n.toLowerCase().trim()));
    }
    if (filters.exclude_ingredients && filters.exclude_ingredients.length > 0) {
      where.push(
        `id NOT IN (SELECT ri.recipe_id FROM recipe_ingredients ri
                    JOIN ingredient_aliases a ON a.ingredient_id = ri.ingredient_id
                    WHERE a.alias IN (${filters.exclude_ingredients.map(() => "?").join(",")}))`,
      );
      params.push(...filters.exclude_ingredients.map((n) => n.toLowerCase().trim()));
    }
    return { where: where.length ? `WHERE ${where.join(" AND ")}` : "", params };
  }

  listRecipes(opts: { filters?: SearchFilters; limit?: number; offset?: number }): RecipeSummary[] {
    const { where, params } = this.filterSql(opts.filters);
    const rows = this.s(
      `SELECT * FROM recipes ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
    ).all(...params, opts.limit ?? 50, opts.offset ?? 0) as RecipeRow[];
    return rows.map((r) => this.rowToSummary(r));
  }

  summariesByIds(ids: number[]): RecipeSummary[] {
    if (ids.length === 0) return [];
    const rows = this.s(`SELECT * FROM recipes WHERE id IN (${ids.map(() => "?").join(",")})`).all(
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
         WHERE i.is_staple = 0 AND i.canonical IN (${names.map(() => "?").join(",")})
         GROUP BY ri.recipe_id`,
      ).all(...names) as Array<{ recipe_id: number; overlap: number; total: number }>;
      const mine = new Set(names);
      const staples = new Set(
        (
          this.s("SELECT canonical FROM ingredients WHERE is_staple = 1").all() as Array<{
            canonical: string;
          }>
        ).map((r) => r.canonical),
      );
      const mineNonStaple = [...mine].filter((n) => !staples.has(n)).length;
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

  listTags(category?: TagCategory): TagCount[] {
    const rows = this.s(
      `SELECT t.category, t.name, COUNT(rt.recipe_id) AS count
       FROM tags t LEFT JOIN recipe_tags rt ON rt.tag_id = t.id
       ${category ? "WHERE t.category = ?" : ""}
       GROUP BY t.id ORDER BY t.category, count DESC, t.name`,
    ).all(...(category ? [category] : [])) as TagCount[];
    return rows.filter((r) => (TAG_CATEGORIES as readonly string[]).includes(r.category));
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
    };
  }
}
