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
import { reconcile } from "../files/reconcile.js";
import { loadCatalog } from "../ingredients/normalize.js";
import { SqliteAdapter } from "../storage/sqlite/adapter.js";
import type { StorageAdapter } from "../storage/types.js";

export interface AppContext {
  root: string;
  paths: DataPaths;
  store: StorageAdapter;
  embedder: Embedder | null;
  embedQueue: EmbedQueue;
  log: typeof log;
  close(): void;
}

export interface ContextOptions {
  /** Set false in tests to avoid loading the model. */
  embeddings?: boolean;
  /** Reconcile markdown files into the DB on open (default true). */
  reconcile?: boolean;
}

const contexts = new Map<string, AppContext>();

export function seedCatalogPath(): string {
  return path.join(packageRoot, "seed", "ingredients.yaml");
}

/** Open (or reuse) the context for a project root: data dirs, DB, catalog, reconcile. */
export function openContext(projectRoot?: string, opts: ContextOptions = {}): AppContext {
  const root = resolveProjectRoot(projectRoot);
  const cached = contexts.get(root);
  if (cached) return cached;

  const paths = dataPaths(root);
  ensureDataDirs(paths);
  const store: StorageAdapter = new SqliteAdapter(paths.db);

  if (!fs.existsSync(paths.ingredientsYaml) && fs.existsSync(seedCatalogPath())) {
    fs.copyFileSync(seedCatalogPath(), paths.ingredientsYaml);
  }
  loadCatalog(store, paths.ingredientsYaml);

  const useEmbeddings = opts.embeddings ?? process.env.PANTRYBASE_NO_EMBED !== "1";
  const embedder = useEmbeddings ? new Embedder() : null;
  const embedQueue = new EmbedQueue(store, embedder);

  const ctx: AppContext = {
    root,
    paths,
    store,
    embedder,
    embedQueue,
    log,
    close() {
      store.close();
      contexts.delete(root);
    },
  };
  contexts.set(root, ctx);

  if (opts.reconcile ?? true) {
    const r = reconcile(ctx, { full: false });
    if (r.added || r.updated || r.removed) log("reconcile", r);
  }
  embedQueue.kick(1000);
  return ctx;
}

export function closeAllContexts(): void {
  for (const ctx of [...contexts.values()]) ctx.close();
}
