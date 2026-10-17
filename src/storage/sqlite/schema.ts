import { ALL_CATEGORIES } from "../../types.js";

/**
 * Bump on any incompatible change. The DB is only an index over the markdown files, so a
 * version mismatch drops everything and the caller rebuilds from `recipes/*.md`.
 */
export const SCHEMA_VERSION = 3;

/** Tables dropped on a version change (virtual tables and triggers go with them). */
export const ALL_TABLES = [
  "chunk_vec",
  "chunks_fts",
  "chunks_tri",
  "chunks",
  "step_ingredients",
  "steps",
  "recipe_tags",
  "tags",
  "recipe_ingredients",
  "pantry_items",
  "alias_tri",
  "ingredient_aliases",
  "ingredients",
  "ingest_items",
  "recipes",
];

const categoryList = ALL_CATEGORIES.map((c) => `'${c}'`).join(",");

/** Idempotent DDL: every statement is IF NOT EXISTS so it can run on every open. */
export function schemaSql(dims: number): string {
  return `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- One row per recipe file. 'doc' holds the full record (minus ingredients/steps, which have
-- their own tables); the other columns exist for filtering and sorting.
CREATE TABLE IF NOT EXISTS recipes (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  subtitle TEXT,
  servings INTEGER,
  active_min INTEGER,
  total_min INTEGER,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('card','url','synthesized','manual')),
  provider_id TEXT,
  needs_review INTEGER NOT NULL DEFAULT 0,
  energy_kcal REAL,
  nutrition_basis TEXT,
  doc TEXT NOT NULL,
  file_path TEXT NOT NULL UNIQUE,
  file_mtime INTEGER NOT NULL,
  file_size INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS recipes_total_min ON recipes(total_min);
CREATE INDEX IF NOT EXISTS recipes_provider ON recipes(provider_id);

CREATE TABLE IF NOT EXISTS ingredients (
  id INTEGER PRIMARY KEY,
  canonical TEXT NOT NULL UNIQUE,
  is_staple INTEGER NOT NULL DEFAULT 0,
  category TEXT
);

CREATE TABLE IF NOT EXISTS ingredient_aliases (
  id INTEGER PRIMARY KEY,
  alias TEXT NOT NULL UNIQUE,
  ingredient_id INTEGER NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ingredient_aliases_ingredient ON ingredient_aliases(ingredient_id);

CREATE VIRTUAL TABLE IF NOT EXISTS alias_tri USING fts5(
  alias, content='ingredient_aliases', content_rowid='id', tokenize='trigram'
);
CREATE TRIGGER IF NOT EXISTS alias_ai AFTER INSERT ON ingredient_aliases BEGIN
  INSERT INTO alias_tri(rowid, alias) VALUES (new.id, new.alias);
END;
CREATE TRIGGER IF NOT EXISTS alias_ad AFTER DELETE ON ingredient_aliases BEGIN
  INSERT INTO alias_tri(alias_tri, rowid, alias) VALUES ('delete', old.id, old.alias);
END;
CREATE TRIGGER IF NOT EXISTS alias_au AFTER UPDATE ON ingredient_aliases BEGIN
  INSERT INTO alias_tri(alias_tri, rowid, alias) VALUES ('delete', old.id, old.alias);
  INSERT INTO alias_tri(rowid, alias) VALUES (new.id, new.alias);
END;

CREATE TABLE IF NOT EXISTS recipe_ingredients (
  recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
  raw TEXT NOT NULL,
  qty REAL,
  unit TEXT,
  prep TEXT,
  optional INTEGER NOT NULL DEFAULT 0,
  staple INTEGER NOT NULL DEFAULT 0,
  source TEXT,
  brand TEXT,
  grp TEXT,
  extra TEXT,
  PRIMARY KEY (recipe_id, position)
);
CREATE INDEX IF NOT EXISTS recipe_ingredients_ingredient ON recipe_ingredients(ingredient_id);

CREATE TABLE IF NOT EXISTS steps (
  recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  title TEXT,
  text TEXT NOT NULL,
  techniques TEXT NOT NULL DEFAULT '[]',
  equipment TEXT NOT NULL DEFAULT '[]',
  uses TEXT NOT NULL DEFAULT '[]',
  temp_c REAL,
  minutes TEXT,
  PRIMARY KEY (recipe_id, position)
);

-- Graph edges: which catalog ingredient each step uses.
CREATE TABLE IF NOT EXISTS step_ingredients (
  recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
  PRIMARY KEY (recipe_id, position, ingredient_id)
);
CREATE INDEX IF NOT EXISTS step_ingredients_ingredient ON step_ingredients(ingredient_id);

-- Tags Claude assigns and facets derived from structured fields share one table, so every
-- category is both a filter and a graph node type.
CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY,
  category TEXT NOT NULL CHECK (category IN (${categoryList})),
  name TEXT NOT NULL,
  UNIQUE (category, name)
);

CREATE TABLE IF NOT EXISTS recipe_tags (
  recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  origin TEXT NOT NULL DEFAULT 'tag' CHECK (origin IN ('tag','derived')),
  PRIMARY KEY (recipe_id, tag_id)
);
CREATE INDEX IF NOT EXISTS recipe_tags_tag ON recipe_tags(tag_id);

CREATE TABLE IF NOT EXISTS pantry_items (
  ingredient_id INTEGER PRIMARY KEY REFERENCES ingredients(id) ON DELETE CASCADE,
  qty REAL,
  unit TEXT,
  note TEXT,
  added_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chunks (
  id INTEGER PRIMARY KEY,
  recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  hash TEXT NOT NULL,
  embed_pending INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS chunks_recipe ON chunks(recipe_id);
CREATE INDEX IF NOT EXISTS chunks_pending ON chunks(embed_pending);

CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  text, content='chunks', content_rowid='id', tokenize='porter unicode61 remove_diacritics 2'
);
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_tri USING fts5(
  text, content='chunks', content_rowid='id', tokenize='trigram'
);
CREATE VIRTUAL TABLE IF NOT EXISTS chunk_vec USING vec0(
  chunk_id INTEGER PRIMARY KEY,
  embedding float[${dims}]
);

CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
  INSERT INTO chunks_fts(rowid, text) VALUES (new.id, new.text);
  INSERT INTO chunks_tri(rowid, text) VALUES (new.id, new.text);
END;
CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES ('delete', old.id, old.text);
  INSERT INTO chunks_tri(chunks_tri, rowid, text) VALUES ('delete', old.id, old.text);
  DELETE FROM chunk_vec WHERE chunk_id = old.id;
END;

-- Photo queue. An index over the file system: a file's folder is its status (inbox/ pending,
-- inbox/skipped|failed/, images/<slug>/ done), so this table can always be rebuilt by a scan.
CREATE TABLE IF NOT EXISTS ingest_items (
  id INTEGER PRIMARY KEY,
  sha256 TEXT NOT NULL UNIQUE,
  phash TEXT NOT NULL,
  path TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  mime TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  bytes INTEGER NOT NULL,
  mtime INTEGER NOT NULL,
  captured_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','done','skipped','failed')),
  recipe_slug TEXT,
  side TEXT,
  reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ingest_items_status ON ingest_items(status, captured_at);
`;
}
