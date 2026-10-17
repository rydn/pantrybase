export const SCHEMA_VERSION = 1;

/** Idempotent DDL: every statement is IF NOT EXISTS so it can run on every open. */
export function schemaSql(dims: number): string {
  return `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS recipes (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  summary TEXT,
  servings INTEGER,
  prep_min INTEGER,
  cook_min INTEGER,
  total_min INTEGER,
  difficulty TEXT,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('card','url','synthesized','manual')),
  source_ref TEXT,
  source_ingested TEXT,
  derived_from TEXT NOT NULL DEFAULT '[]',
  images TEXT NOT NULL DEFAULT '[]',
  tags TEXT NOT NULL DEFAULT '{}',
  notes TEXT,
  file_path TEXT NOT NULL UNIQUE,
  file_mtime INTEGER NOT NULL,
  file_size INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS recipes_total_min ON recipes(total_min);

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
  PRIMARY KEY (recipe_id, position)
);
CREATE INDEX IF NOT EXISTS recipe_ingredients_ingredient ON recipe_ingredients(ingredient_id);

CREATE TABLE IF NOT EXISTS steps (
  recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  text TEXT NOT NULL,
  PRIMARY KEY (recipe_id, position)
);

CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY,
  category TEXT NOT NULL CHECK (category IN
    ('protein','diet','starch','flavor','cuisine','meal','method','time','season','other')),
  name TEXT NOT NULL,
  UNIQUE (category, name)
);

CREATE TABLE IF NOT EXISTS recipe_tags (
  recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
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

CREATE TABLE IF NOT EXISTS ingest_items (
  id INTEGER PRIMARY KEY,
  sha256 TEXT NOT NULL UNIQUE,
  path TEXT NOT NULL,
  mime TEXT,
  group_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending','claimed','done','skipped','failed')),
  claimed_at TEXT,
  recipe_slug TEXT,
  error TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ingest_items_status ON ingest_items(status);
`;
}
