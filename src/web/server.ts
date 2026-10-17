import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { DEFAULT_UI_PORT, log, packageRoot } from "../config.js";
import type { AppContext } from "../core/context.js";
import { buildGraph } from "../graph/build.js";
import { openImage } from "../ingest/images.js";
import { addUpload, maybeScanInbox, resolveItems, viewItem } from "../ingest/inbox.js";
import {
  addToPantry,
  availableIngredients,
  listPantry,
  matchRecipes,
  removeFromPantry,
} from "../pantry/pantry.js";
import { type SearchMode, searchRecipes } from "../search/hybrid.js";
import { INGEST_STATUSES, type IngestStatus, type SearchFilters } from "../types.js";

const MAX_JSON = 1_000_000;
const MAX_UPLOAD = 60_000_000;

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

type Handler = (
  req: http.IncomingMessage,
  url: URL,
  params: string[],
) => Promise<unknown> | unknown;
interface Route {
  method: string;
  pattern: RegExp;
  handler: Handler;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

function readBody(req: http.IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new HttpError(413, "request body too large"));
        req.destroy();
      } else {
        chunks.push(c);
      }
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function readJson<T>(req: http.IncomingMessage): Promise<T> {
  const body = await readBody(req, MAX_JSON);
  try {
    return JSON.parse(body.toString("utf8") || "{}") as T;
  } catch {
    throw new HttpError(400, "invalid JSON body");
  }
}

const num = (v: string | null) => (v === null || v === "" ? undefined : Number(v));
const csv = (v: string | null) =>
  v
    ? v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;

/** Filters shared by search, match and graph: ?tags={json}&exclude_allergens=a,b&max_total_min=30… */
function filtersFrom(url: URL): SearchFilters {
  const p = url.searchParams;
  let tags: SearchFilters["tags"];
  if (p.get("tags")) {
    try {
      tags = JSON.parse(p.get("tags") ?? "{}") as SearchFilters["tags"];
    } catch {
      throw new HttpError(400, 'tags must be JSON, e.g. {"cuisine":["thai"]}');
    }
  }
  const nr = p.get("needs_review");
  return {
    tags,
    exclude_allergens: csv(p.get("exclude_allergens")),
    exclude_ingredients: csv(p.get("exclude_ingredients")),
    max_total_min: num(p.get("max_total_min")),
    max_active_min: num(p.get("max_active_min")),
    provider: p.get("provider") ?? undefined,
    needs_review: nr === null ? undefined : nr === "true" || nr === "1",
  };
}

/** Resolve a data-dir relative path to a photo, refusing anything outside images/ and inbox/. */
function safeImagePath(ctx: AppContext, rel: string): string {
  const abs = path.resolve(ctx.paths.data, rel);
  const ok = [ctx.paths.images, ctx.paths.inbox].some((dir) => abs.startsWith(dir + path.sep));
  if (!ok || !fs.existsSync(abs) || !fs.statSync(abs).isFile())
    throw new HttpError(404, "not found");
  return abs;
}

const thumbCache = new Map<string, Buffer>();
async function thumbnail(abs: string, width: number): Promise<Buffer> {
  const key = `${abs}|${fs.statSync(abs).mtimeMs}|${width}`;
  const hit = thumbCache.get(key);
  if (hit) return hit;
  const buf = await (await openImage(abs))
    .resize(width, width, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 78, mozjpeg: true })
    .toBuffer();
  if (thumbCache.size > 400) thumbCache.delete(thumbCache.keys().next().value as string);
  thumbCache.set(key, buf);
  return buf;
}

function routes(ctx: AppContext, version: string): Route[] {
  const r = (method: string, pattern: RegExp, handler: Handler): Route => ({
    method,
    pattern,
    handler,
  });
  return [
    r("GET", /^\/api\/stats$/, () => ({
      ...ctx.store.stats(),
      inbox: ctx.store.ingestCounts(),
      pantry: listPantry(ctx).length,
      providers: ctx.providers.list().map((p) => ({ id: p.id, name: p.name })),
      data_dir: ctx.paths.data,
      embeddings: ctx.embedder ? (ctx.embedder.ready ? "ready" : "loading") : "disabled",
      version,
    })),

    r("GET", /^\/api\/facets$/, () => {
      const used: Record<string, Array<{ name: string; count: number }>> = {};
      for (const t of ctx.store.listTags()) {
        const list = used[t.category] ?? [];
        list.push({ name: t.name, count: t.count });
        used[t.category] = list;
      }
      return { used, vocabulary: ctx.vocab.summary(200) };
    }),

    r("GET", /^\/api\/search$/, async (_req, url) => {
      const p = url.searchParams;
      return searchRecipes(ctx, {
        query: p.get("q") ?? undefined,
        limit: num(p.get("limit")) ?? 48,
        mode: (p.get("mode") as SearchMode | null) ?? undefined,
        filters: filtersFrom(url),
      });
    }),

    r("GET", /^\/api\/recipes\/([a-z0-9-]+)$/, (_req, _url, [slug]) => {
      const rec = ctx.store.getRecipe(slug ?? "");
      if (!rec) throw new HttpError(404, `no recipe "${slug}"`);
      const { ids } = availableIngredients(ctx, {});
      const have = new Set(
        rec.ingredients
          .filter((i) => {
            const row = ctx.store.getIngredient(i.canonical);
            return row ? ids.has(row.id) : false;
          })
          .map((i) => i.canonical),
      );
      const similar = ctx.store.summariesByIds(
        ctx.store.similarRecipes(rec.id, 6).map((s) => s.recipe_id),
      );
      const all = ctx.store.listRecipes({ limit: 10_000 });
      const derived = all.filter((s) => {
        const d = ctx.store.getRecipe(s.slug)?.derived_from ?? [];
        return d.includes(rec.slug);
      });
      const sources = ctx.store.summariesByIds(
        rec.derived_from
          .map((d) => ctx.store.getRecipe(d)?.id)
          .filter((x): x is number => x !== undefined),
      );
      return { recipe: rec, pantry_have: [...have], similar, derived, sources };
    }),

    r("GET", /^\/api\/files\/(.+)$/, () => {
      throw new HttpError(500, "handled by the file route");
    }),

    r("GET", /^\/api\/pantry$/, () => listPantry(ctx)),
    r("POST", /^\/api\/pantry$/, async (req) => {
      const body = await readJson<{
        items?: Array<{ name: string; qty?: number; unit?: string; note?: string }>;
      }>(req);
      if (!body.items?.length) throw new HttpError(400, "items required");
      return { added: addToPantry(ctx, body.items), pantry: listPantry(ctx) };
    }),
    r("DELETE", /^\/api\/pantry$/, async (req) => {
      const body = await readJson<{ names?: string[]; all?: boolean }>(req);
      if (body.all) ctx.store.pantryClear();
      else removeFromPantry(ctx, body.names ?? []);
      return { pantry: listPantry(ctx) };
    }),
    r("GET", /^\/api\/pantry\/match$/, (_req, url) => {
      const p = url.searchParams;
      return matchRecipes(ctx, {
        ingredients: csv(p.get("ingredients")),
        min_coverage: num(p.get("min_coverage")) ?? 0.3,
        max_missing: num(p.get("max_missing")),
        limit: num(p.get("limit")) ?? 30,
        filters: filtersFrom(url),
      });
    }),
    r("GET", /^\/api\/ingredients$/, (_req, url) =>
      ctx.store.listIngredients({
        query: url.searchParams.get("q") ?? undefined,
        limit: num(url.searchParams.get("limit")) ?? 20,
      }),
    ),

    r("GET", /^\/api\/graph$/, (_req, url) => {
      const p = url.searchParams;
      return buildGraph(ctx, {
        categories: csv(p.get("categories")),
        ingredients: p.get("ingredients") !== "0",
        min_degree: num(p.get("min_degree")),
        cuisine: p.get("cuisine") ?? undefined,
        similar: num(p.get("similar")),
        include_staples: p.get("staples") === "1",
      });
    }),

    r("GET", /^\/api\/inbox$/, (_req, url) => {
      const p = url.searchParams;
      const status = p.get("status");
      if (status && !(INGEST_STATUSES as readonly string[]).includes(status))
        throw new HttpError(400, "bad status");
      const all = ctx.store.allIngest();
      const items = ctx.store.listIngest({
        status: (status as IngestStatus | null) ?? undefined,
        limit: num(p.get("limit")) ?? 200,
        offset: num(p.get("offset")),
      });
      return {
        counts: ctx.store.ingestCounts(),
        items: items.map((i) => ({ ...viewItem(i, all), path: i.path })),
      };
    }),
    r("POST", /^\/api\/inbox\/upload$/, async (req) => {
      const name = decodeURIComponent(String(req.headers["x-filename"] ?? ""));
      if (!name) throw new HttpError(400, "X-Filename header required");
      const data = await readBody(req, MAX_UPLOAD);
      if (data.length === 0) throw new HttpError(400, "empty upload");
      const item = await addUpload(ctx, name, data);
      return { item: item ? viewItem(item) : null, counts: ctx.store.ingestCounts() };
    }),
    r("POST", /^\/api\/inbox\/resolve$/, async (req) => {
      const body = await readJson<{ ids?: number[]; status?: string; reason?: string }>(req);
      if (!body.ids?.length || !["pending", "skipped", "failed"].includes(body.status ?? "")) {
        throw new HttpError(400, "ids and status (pending|skipped|failed) required");
      }
      return resolveItems(
        ctx,
        body.ids,
        body.status as "pending" | "skipped" | "failed",
        body.reason,
      );
    }),
  ];
}

export interface UiServer {
  url: string;
  port: number;
  close(): Promise<void>;
}

const running = new WeakMap<AppContext, UiServer>();

/**
 * Serve the web UI and its JSON API on 127.0.0.1. Requests must carry a local Host header;
 * writes also need an `X-Pantrybase` header, which a cross-site page cannot send without a
 * preflight the server never approves.
 */
export async function startUiServer(
  ctx: AppContext,
  opts: { port?: number; version?: string; dev?: boolean } = {},
): Promise<UiServer> {
  const existing = running.get(ctx);
  if (existing) return existing;
  // Load the embedding model now so the first search is already semantic.
  ctx.embedder?.load().then(
    () => ctx.embedQueue.kick(0),
    () => {},
  );
  const webDir = path.join(packageRoot, "dist", "web");
  const table = routes(ctx, opts.version ?? "dev");
  const dev = opts.dev ?? process.env.PB_DEV === "1";
  let port = opts.port ?? Number(process.env.PB_PORT ?? DEFAULT_UI_PORT);

  const server = http.createServer(async (req, res) => {
    const send = (status: number, body: unknown, type = "application/json") => {
      const payload =
        type === "application/json" ? JSON.stringify(body) : (body as Buffer | string);
      res.writeHead(status, {
        "Content-Type": type,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(payload);
    };
    try {
      const host = String(req.headers.host ?? "");
      const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`];
      if (!allowedHosts.includes(host) && !(dev && /^(localhost|127\.0\.0\.1):\d+$/.test(host))) {
        throw new HttpError(403, "forbidden host");
      }
      const origin = req.headers.origin;
      if (
        origin &&
        !allowedHosts.some((h) => origin === `http://${h}`) &&
        !(dev && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin))
      ) {
        throw new HttpError(403, "forbidden origin");
      }
      const url = new URL(req.url ?? "/", `http://${host}`);
      const method = req.method ?? "GET";

      if (url.pathname.startsWith("/api/")) {
        if (method !== "GET" && req.headers["x-pantrybase"] !== "1")
          throw new HttpError(403, "missing X-Pantrybase header");
        ctx.sync();
        await maybeScanInbox(ctx);
        const file = /^\/api\/files\/(.+)$/.exec(url.pathname);
        if (file && method === "GET") {
          const abs = safeImagePath(ctx, decodeURIComponent(file[1] ?? ""));
          const w = num(url.searchParams.get("w"));
          if (w)
            return send(200, await thumbnail(abs, Math.min(Math.max(w, 64), 2400)), "image/jpeg");
          const ext = path.extname(abs).toLowerCase();
          if (ext === ".heic" || ext === ".heif")
            return send(200, await thumbnail(abs, 2400), "image/jpeg");
          return send(200, fs.readFileSync(abs), MIME[ext] ?? "application/octet-stream");
        }
        for (const route of table) {
          if (route.method !== method) continue;
          const m = route.pattern.exec(url.pathname);
          if (m) return send(200, await route.handler(req, url, m.slice(1)));
        }
        throw new HttpError(404, `no route ${method} ${url.pathname}`);
      }

      if (method !== "GET") throw new HttpError(405, "method not allowed");
      // Static UI with single-page-app fallback.
      if (!fs.existsSync(webDir)) {
        return send(
          503,
          "The web UI is not built. Run `npm run build:web` in the pantrybase repo.",
          "text/plain; charset=utf-8",
        );
      }
      const rel = path.normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, "");
      let file = path.join(webDir, rel);
      if (!file.startsWith(webDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        file = path.join(webDir, "index.html");
      }
      const type = MIME[path.extname(file)] ?? "application/octet-stream";
      res.writeHead(200, {
        "Content-Type": type,
        "Cache-Control": file.includes(`${path.sep}assets${path.sep}`)
          ? "public, max-age=31536000, immutable"
          : "no-cache",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(fs.readFileSync(file));
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) log("ui error:", e);
      send(status, { error: e instanceof Error ? e.message : String(e) });
    }
  });

  // Find a free port starting at the requested one.
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () => {
          server.off("error", reject);
          resolve();
        });
      });
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EADDRINUSE" || attempt === 9) throw e;
      port++;
    }
  }
  const ui: UiServer = {
    url: `http://127.0.0.1:${port}`,
    port,
    close: () =>
      new Promise((resolve) => {
        running.delete(ctx);
        server.close(() => resolve());
      }),
  };
  running.set(ctx, ui);
  return ui;
}
