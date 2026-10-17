import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AppContext } from "../core/context.js";
import { relativeToData } from "../files/store.js";
import type {
  ExtractionImage,
  ImageSide,
  IngestCounts,
  IngestItem,
  IngestStatus,
} from "../types.js";
import { hamming, inspectImage, isImageFile, RETAKE_DISTANCE } from "./images.js";

/**
 * The photo queue lives on disk; a file's folder is its status:
 *   inbox/            pending      inbox/skipped/   skipped
 *   inbox/failed/     failed       images/<slug>/   done (attached to that recipe)
 *   inbox/duplicates/ byte-identical copies of photos already known (not indexed)
 * `ingest_items` is an index over that, rebuilt by `scanInbox`.
 */
const SKIPPED = "skipped";
const FAILED = "failed";
const DUPLICATES = "duplicates";
const REASON_SUFFIX = ".reason.txt";

export interface ScanResult {
  added: number;
  updated: number;
  removed: number;
  duplicates: string[];
  errors: Array<{ file: string; error: string }>;
}

function walk(dir: string, skipDirs: Set<string> = new Set()): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!skipDirs.has(abs)) out.push(...walk(abs, skipDirs));
    } else if (isImageFile(entry.name)) {
      out.push(abs);
    }
  }
  return out;
}

function locate(ctx: AppContext, abs: string): { status: IngestStatus; slug: string | null } {
  const inImages = path.relative(ctx.paths.images, abs);
  if (!inImages.startsWith("..") && !path.isAbsolute(inImages)) {
    return { status: "done", slug: inImages.split(path.sep)[0] ?? null };
  }
  const inInbox = path.relative(ctx.paths.inbox, abs).split(path.sep);
  if (inInbox[0] === SKIPPED) return { status: "skipped", slug: null };
  if (inInbox[0] === FAILED) return { status: "failed", slug: null };
  return { status: "pending", slug: null };
}

function readReason(abs: string): string | null {
  try {
    return fs.readFileSync(abs + REASON_SUFFIX, "utf8").trim() || null;
  } catch {
    return null;
  }
}

/** `name` inside `dir`, with -2, -3… before the extension if taken. */
function freeName(dir: string, name: string, taken: Set<string> = new Set()): string {
  const ext = path.extname(name);
  const stem = path.basename(name, ext);
  let candidate = name;
  for (
    let n = 2;
    fs.existsSync(path.join(dir, candidate)) || taken.has(path.join(dir, candidate));
    n++
  ) {
    candidate = `${stem}-${n}${ext}`;
  }
  return candidate;
}

function moveFile(from: string, to: string): void {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  try {
    fs.renameSync(from, to);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EXDEV") throw e;
    fs.copyFileSync(from, to);
    fs.rmSync(from);
  }
}

const scanning = new WeakMap<AppContext, Promise<ScanResult>>();

/** Index every photo in inbox/ and images/: new files hashed once, moved files followed, gone files dropped. */
export function scanInbox(ctx: AppContext): Promise<ScanResult> {
  const running = scanning.get(ctx);
  if (running) return running;
  const job = (async () => {
    const res: ScanResult = { added: 0, updated: 0, removed: 0, duplicates: [], errors: [] };
    const dupDir = path.join(ctx.paths.inbox, DUPLICATES);
    const files = [...walk(ctx.paths.inbox, new Set([dupDir])), ...walk(ctx.paths.images)];
    const seen = new Set<string>();

    for (const abs of files) {
      const rel = relativeToData(ctx.paths, abs);
      const where = locate(ctx, abs);
      const st = fs.statSync(abs);
      const row = ctx.store.ingestByPath(rel);
      if (row && row.mtime === Math.round(st.mtimeMs) && row.bytes === st.size) {
        seen.add(rel);
        const reason =
          where.status === "skipped" || where.status === "failed" ? readReason(abs) : null;
        if (
          row.status !== where.status ||
          row.recipe_slug !== where.slug ||
          row.reason !== reason
        ) {
          ctx.store.updateIngest(row.id, { status: where.status, recipe_slug: where.slug, reason });
          res.updated++;
        }
        continue;
      }
      try {
        const info = await inspectImage(abs);
        const same = ctx.store.ingestBySha(info.sha256);
        if (same && same.path !== rel) {
          if (fs.existsSync(path.join(ctx.paths.data, same.path))) {
            // A byte-identical copy of a photo we already have: park it, don't index it twice.
            const target = path.join(dupDir, freeName(dupDir, path.basename(abs)));
            moveFile(abs, target);
            res.duplicates.push(`${rel} = #${same.id} ${same.path}`);
            continue;
          }
          // The known photo was moved or renamed: follow it.
          ctx.store.updateIngest(same.id, {
            path: rel,
            status: where.status,
            recipe_slug: where.slug,
            mtime: info.mtime,
            bytes: info.bytes,
          });
          seen.add(rel);
          res.updated++;
          continue;
        }
        if (row) ctx.store.deleteIngest(row.id); // contents changed in place
        ctx.store.insertIngest({
          ...info,
          path: rel,
          original_name: path.basename(abs),
          status: where.status,
          recipe_slug: where.slug,
          side: null,
          reason: where.status === "skipped" || where.status === "failed" ? readReason(abs) : null,
        });
        seen.add(rel);
        res.added++;
      } catch (e) {
        res.errors.push({ file: rel, error: e instanceof Error ? e.message : String(e) });
      }
    }

    for (const row of ctx.store.allIngest()) {
      if (!seen.has(row.path) && !fs.existsSync(path.join(ctx.paths.data, row.path))) {
        ctx.store.deleteIngest(row.id);
        res.removed++;
      }
    }
    return res;
  })().finally(() => {
    scanning.delete(ctx);
  });
  scanning.set(ctx, job);
  return job;
}

const lastScan = new WeakMap<AppContext, number>();

/** Scan at most every `intervalMs` (cheap stat pass; new photos are hashed once). */
export async function maybeScanInbox(
  ctx: AppContext,
  intervalMs = 3000,
): Promise<ScanResult | null> {
  const t = Date.now();
  if (t - (lastScan.get(ctx) ?? 0) < intervalMs) return null;
  lastScan.set(ctx, t);
  return scanInbox(ctx);
}

export interface ImportResult {
  copied: number;
  already_known: number;
  unsupported: number;
  missing: string[];
  scan: ScanResult;
}

function expandHome(p: string): string {
  return p === "~" || p.startsWith("~/") ? path.join(os.homedir(), p.slice(1)) : p;
}

/** Copy photos from files or folders into the inbox (originals are never touched). */
export async function importPaths(
  ctx: AppContext,
  inputs: string[],
  opts: { recursive?: boolean } = {},
): Promise<ImportResult> {
  const res: Omit<ImportResult, "scan"> = {
    copied: 0,
    already_known: 0,
    unsupported: 0,
    missing: [],
  };
  const files: string[] = [];
  for (const input of inputs) {
    const abs = path.resolve(ctx.root, expandHome(input));
    if (!fs.existsSync(abs)) {
      res.missing.push(input);
      continue;
    }
    if (fs.statSync(abs).isDirectory()) {
      const list =
        opts.recursive === false
          ? fs
              .readdirSync(abs)
              .map((f) => path.join(abs, f))
              .filter((f) => fs.statSync(f).isFile())
          : walkAll(abs);
      for (const f of list) {
        if (isImageFile(f)) files.push(f);
        else res.unsupported++;
      }
    } else if (isImageFile(abs)) {
      files.push(abs);
    } else {
      res.unsupported++;
    }
  }

  const known = new Set(ctx.store.allIngest().map((r) => r.sha256));
  const { createHash } = await import("node:crypto");
  const taken = new Set<string>();
  for (const f of files.sort()) {
    const sha = createHash("sha256").update(fs.readFileSync(f)).digest("hex");
    if (known.has(sha)) {
      res.already_known++;
      continue;
    }
    known.add(sha);
    const target = path.join(ctx.paths.inbox, freeName(ctx.paths.inbox, path.basename(f), taken));
    taken.add(target);
    fs.copyFileSync(f, target);
    // Keep the original timestamp so capture-time ordering survives the copy.
    const st = fs.statSync(f);
    fs.utimesSync(target, st.atime, st.mtime);
    res.copied++;
  }
  return { ...res, scan: await scanInbox(ctx) };
}

function walkAll(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkAll(abs));
    else out.push(abs);
  }
  return out;
}

/** Save an uploaded photo (web UI) into the inbox. */
export async function addUpload(
  ctx: AppContext,
  name: string,
  data: Buffer,
): Promise<IngestItem | undefined> {
  const safe = path.basename(name).replace(/[^\w.\- ]+/g, "_") || "upload.jpg";
  if (!isImageFile(safe)) throw new Error(`unsupported image type: ${safe}`);
  const target = path.join(ctx.paths.inbox, freeName(ctx.paths.inbox, safe));
  fs.writeFileSync(target, data);
  await scanInbox(ctx);
  return ctx.store.ingestByPath(relativeToData(ctx.paths, target));
}

export interface QueueItemView {
  id: number;
  name: string;
  captured_at: string;
  size: string;
  status: IngestStatus;
  recipe_slug?: string;
  reason?: string;
  /** Probably the same side of the same card as this other photo. */
  retake_of?: { id: number; status: IngestStatus; recipe_slug?: string; distance: number };
}

function retakeHint(item: IngestItem, all: IngestItem[]): QueueItemView["retake_of"] {
  let best: QueueItemView["retake_of"];
  for (const other of all) {
    if (other.id === item.id) continue;
    const d = hamming(item.phash, other.phash);
    if (d <= RETAKE_DISTANCE && (!best || d < best.distance)) {
      best = { id: other.id, status: other.status, distance: d };
      if (other.recipe_slug) best.recipe_slug = other.recipe_slug;
    }
  }
  return best;
}

export function viewItem(item: IngestItem, all?: IngestItem[]): QueueItemView {
  const v: QueueItemView = {
    id: item.id,
    name: item.original_name,
    captured_at: item.captured_at,
    size: `${item.width}x${item.height}`,
    status: item.status,
  };
  if (item.recipe_slug) v.recipe_slug = item.recipe_slug;
  if (item.reason) v.reason = item.reason;
  if (all) {
    const r = retakeHint(item, all);
    if (r) v.retake_of = r;
  }
  return v;
}

/** The next pending photos in capture order, with retake hints and overall progress. */
export function nextBatch(
  ctx: AppContext,
  window = 4,
): { progress: IngestCounts; items: QueueItemView[] } {
  const all = ctx.store.allIngest();
  const items = all.filter((i) => i.status === "pending").slice(0, Math.max(1, window));
  return { progress: ctx.store.ingestCounts(), items: items.map((i) => viewItem(i, all)) };
}

/** Move photos to skipped/ or failed/ (with a reason file), or back to the inbox. */
export function resolveItems(
  ctx: AppContext,
  ids: number[],
  status: Exclude<IngestStatus, "done">,
  reason?: string,
): { moved: number; refused: Array<{ id: number; why: string }> } {
  const out = { moved: 0, refused: [] as Array<{ id: number; why: string }> };
  const items = ctx.store.ingestByIds(ids);
  for (const id of ids) {
    if (!items.some((i) => i.id === id)) out.refused.push({ id, why: "unknown id" });
  }
  for (const item of items) {
    if (item.status === "done") {
      out.refused.push({ id: item.id, why: `already attached to ${item.recipe_slug}` });
      continue;
    }
    const from = path.join(ctx.paths.data, item.path);
    const dir =
      status === "pending"
        ? ctx.paths.inbox
        : path.join(ctx.paths.inbox, status === "skipped" ? SKIPPED : FAILED);
    const name =
      path.dirname(from) === dir ? path.basename(from) : freeName(dir, path.basename(from));
    const to = path.join(dir, name);
    fs.rmSync(from + REASON_SUFFIX, { force: true });
    if (from !== to) moveFile(from, to);
    const why = status === "pending" ? null : reason?.trim() || null;
    if (why) fs.writeFileSync(to + REASON_SUFFIX, `${why}\n`);
    const st = fs.statSync(to);
    ctx.store.updateIngest(item.id, {
      path: relativeToData(ctx.paths, to),
      status,
      reason: why,
      recipe_slug: null,
      side: null,
      mtime: Math.round(st.mtimeMs),
    });
    out.moved++;
  }
  return out;
}

export interface AttachTarget {
  item: IngestItem;
  side: ImageSide;
  /** Destination relative to the data dir. */
  rel: string;
}

/**
 * Decide where each photo of a card will live (images/<slug>/front.jpg, back.jpg, front-2.jpg…)
 * without touching the files; `finalizeAttach` moves them once the recipe is written.
 */
export function planAttach(
  ctx: AppContext,
  slug: string,
  ingest: Array<{ id: number; side: ImageSide }>,
): { targets: AttachTarget[]; errors: string[] } {
  const errors: string[] = [];
  const items = ctx.store.ingestByIds(ingest.map((i) => i.id));
  const dir = path.join(ctx.paths.images, slug);
  const taken = new Set<string>();
  const targets: AttachTarget[] = [];
  for (const { id, side } of ingest) {
    const item = items.find((i) => i.id === id);
    if (!item) {
      errors.push(`unknown photo #${id}`);
      continue;
    }
    if (item.status === "done") {
      if (item.recipe_slug !== slug)
        errors.push(`photo #${id} is already attached to ${item.recipe_slug}`);
      else targets.push({ item, side: item.side ?? side, rel: item.path });
      continue;
    }
    if (!fs.existsSync(path.join(ctx.paths.data, item.path))) {
      errors.push(`photo #${id} is missing on disk (${item.path})`);
      continue;
    }
    const ext = path.extname(item.path).toLowerCase() || ".jpg";
    const name = freeName(dir, `${side}${ext}`, taken);
    taken.add(path.join(dir, name));
    targets.push({ item, side, rel: relativeToData(ctx.paths, path.join(dir, name)) });
  }
  return { targets, errors };
}

export function finalizeAttach(ctx: AppContext, slug: string, targets: AttachTarget[]): void {
  for (const t of targets) {
    if (t.item.status === "done" && t.item.path === t.rel) continue;
    const from = path.join(ctx.paths.data, t.item.path);
    const to = path.join(ctx.paths.data, t.rel);
    fs.rmSync(from + REASON_SUFFIX, { force: true });
    moveFile(from, to);
    const st = fs.statSync(to);
    ctx.store.updateIngest(t.item.id, {
      path: t.rel,
      status: "done",
      recipe_slug: slug,
      side: t.side,
      reason: null,
      mtime: Math.round(st.mtimeMs),
    });
  }
}

/** Merge newly attached photos into a recipe's image lists (front first, then back, then other). */
export function mergeImages(
  existing: { images: string[]; extraction?: { images?: ExtractionImage[] } },
  targets: AttachTarget[],
  claimed: ExtractionImage[] = [],
): { images: string[]; extraction: ExtractionImage[] } {
  const order: Record<ImageSide, number> = { front: 0, back: 1, other: 2 };
  const byFile = new Map<string, ExtractionImage>();
  for (const e of existing.extraction?.images ?? []) byFile.set(e.file, e);
  for (const t of targets) byFile.set(t.rel, { file: t.rel, side: t.side });
  // Keep Claude's own entries only if they point at real archived files.
  for (const c of claimed)
    if (c.file.startsWith("images/") && !byFile.has(c.file)) byFile.set(c.file, c);
  const extraction = [...byFile.values()].sort(
    (a, b) => order[a.side] - order[b.side] || a.file.localeCompare(b.file),
  );
  const images = [...new Set([...extraction.map((e) => e.file), ...existing.images])];
  return { images, extraction };
}
