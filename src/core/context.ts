import fs from "node:fs";
import path from "node:path";
import {
  type DataPaths,
  dataPaths,
  ensureDataDirs,
  log,
  packageRoot,
  resolveProjectRoot,
} from "../config.js";
import { Embedder } from "../embeddings/model.js";
import { EmbedQueue } from "../embeddings/queue.js";
import { type ReconcileResult, reconcile } from "../files/reconcile.js";
import { loadCatalog } from "../ingredients/normalize.js";
import { builtinProvidersDir, ProviderRegistry } from "../providers/registry.js";
import { SqliteAdapter } from "../storage/sqlite/adapter.js";
import type { StorageAdapter } from "../storage/types.js";
import { Vocabulary } from "../vocabulary/vocabulary.js";

export interface AppContext {
  root: string;
  paths: DataPaths;
  store: StorageAdapter;
  vocab: Vocabulary;
  providers: ProviderRegistry;
  embedder: Embedder | null;
  embedQueue: EmbedQueue;
  log: typeof log;
  /** Reload ingredients.yaml / vocabulary.yaml / provider profiles if they changed (or `force`). */
  refresh(force?: boolean): { catalog: boolean; vocabulary: boolean };
  /**
   * Bring the index up to date with the files before serving a request: reload changed config
   * (and re-parse every recipe if it changed), then pick up hand-edited, added or deleted
   * recipe files. Throttled unless `now` is set.
   */
  sync(opts?: { now?: boolean }): ReconcileResult | null;
  close(): void;
}

/** Minimum gap between automatic file scans. */
const SYNC_INTERVAL_MS = 2000;

export interface ContextOptions {
  /** Set false in tests to avoid loading the model. */
  embeddings?: boolean;
  /** Reconcile markdown files into the DB on open (default true). */
  reconcile?: boolean;
}

const contexts = new Map<string, AppContext>();

export function seedPath(name: "ingredients.yaml" | "vocabulary.yaml"): string {
  return path.join(packageRoot, "seed", name);
}

/** Copy a seed file into the project the first time, so the user can edit their own copy. */
function ensureSeeded(target: string, seed: string): void {
  if (!fs.existsSync(target) && fs.existsSync(seed)) fs.copyFileSync(seed, target);
}

function mtime(file: string): number {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

function buildVocabulary(paths: DataPaths, providers: ProviderRegistry): Vocabulary {
  const vocab = Vocabulary.fromFile(paths.vocabularyYaml);
  for (const p of providers.list()) vocab.addSynonyms("allergen", p.allergen_synonyms);
  return vocab;
}

function loadProviderAliases(store: StorageAdapter, providers: ProviderRegistry): void {
  store.transaction(() => {
    for (const p of providers.list()) {
      for (const [canonical, aliases] of Object.entries(p.ingredient_aliases)) {
        store.upsertCatalogEntry({ canonical, aliases });
      }
    }
  });
}

/** Open (or reuse) the context for a project root: data dirs, DB, catalog, vocabulary, reconcile. */
export function openContext(projectRoot?: string, opts: ContextOptions = {}): AppContext {
  const root = resolveProjectRoot(projectRoot);
  const cached = contexts.get(root);
  if (cached) return cached;

  const paths = dataPaths(root);
  ensureDataDirs(paths);
  const store: StorageAdapter = new SqliteAdapter(paths.db);
  if (store.wasReset) log("index schema changed; rebuilding from markdown");

  ensureSeeded(paths.ingredientsYaml, seedPath("ingredients.yaml"));
  ensureSeeded(paths.vocabularyYaml, seedPath("vocabulary.yaml"));

  const useEmbeddings = opts.embeddings ?? process.env.PANTRYBASE_NO_EMBED !== "1";
  const embedder = useEmbeddings ? new Embedder() : null;
  const embedQueue = new EmbedQueue(store, embedder);

  let seen = { catalog: -1, vocabulary: -1 };
  let lastSync = Date.now();
  const ctx: AppContext = {
    root,
    paths,
    store,
    providers: new ProviderRegistry([builtinProvidersDir(), paths.providers]),
    vocab: new Vocabulary(),
    embedder,
    embedQueue,
    log,
    refresh(force = false) {
      const now = {
        catalog: mtime(paths.ingredientsYaml),
        vocabulary: mtime(paths.vocabularyYaml),
      };
      const changed = {
        catalog: force || now.catalog !== seen.catalog,
        vocabulary: force || now.vocabulary !== seen.vocabulary,
      };
      if (force) ctx.providers = new ProviderRegistry([builtinProvidersDir(), paths.providers]);
      if (changed.catalog) {
        loadCatalog(store, paths.ingredientsYaml);
        loadProviderAliases(store, ctx.providers);
      }
      if (changed.vocabulary || force) ctx.vocab = buildVocabulary(paths, ctx.providers);
      seen = now;
      return changed;
    },
    sync({ now = false } = {}) {
      const t = Date.now();
      if (!now && t - lastSync < SYNC_INTERVAL_MS) return null;
      lastSync = t;
      const changed = ctx.refresh();
      const full = changed.catalog || changed.vocabulary;
      const r = reconcile(ctx, { full });
      if (full || r.added || r.updated || r.removed || r.errors.length) {
        log("sync", { config_changed: full, ...r, unchanged: undefined });
      }
      return r;
    },
    close() {
      embedQueue.stop();
      store.close();
      contexts.delete(root);
    },
  };
  ctx.refresh(true);
  contexts.set(root, ctx);

  if (opts.reconcile ?? true) {
    const r = reconcile(ctx, { full: false });
    if (r.added || r.updated || r.removed || r.errors.length) log("reconcile", r);
  }
  embedQueue.kick(1000);
  return ctx;
}

export function closeAllContexts(): void {
  for (const ctx of [...contexts.values()]) ctx.close();
}
