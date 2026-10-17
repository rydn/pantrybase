import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type AppContext, openContext } from "../../src/core/context.js";
import { hamming, imageForModel, inspectImage, RETAKE_DISTANCE } from "../../src/ingest/images.js";
import { importPaths, nextBatch, resolveItems, scanInbox } from "../../src/ingest/inbox.js";
import { saveRecipe } from "../../src/recipes/service.js";
import { bakedRavioli, cosyPotatoes } from "../fixtures/ucook.js";

/** A JPEG with a distinct blocky pattern per seed; `tweak` brightens it slightly (a "retake"). */
async function makePhoto(file: string, seed: number, tweak = 0): Promise<void> {
  const w = 640;
  const h = 440;
  const px = Buffer.alloc(w * h * 3);
  let s = seed * 2654435761;
  const blocks: number[] = [];
  for (let i = 0; i < 64; i++) {
    s = (s * 1103515245 + 12345) >>> 0;
    blocks.push(s % 256);
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = blocks[Math.floor((y / h) * 8) * 8 + Math.floor((x / w) * 8)] ?? 0;
      const o = (y * w + x) * 3;
      px[o] = Math.min(255, v + tweak);
      px[o + 1] = Math.min(255, (v * 7) % 256);
      px[o + 2] = Math.min(255, 255 - v);
    }
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await sharp(px, { raw: { width: w, height: h, channels: 3 } })
    .jpeg({ quality: 90 })
    .toFile(file);
}

describe("photo inbox", () => {
  let root: string;
  let src: string;
  let ctx: AppContext;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "pantrybase-inbox-"));
    src = fs.mkdtempSync(path.join(os.tmpdir(), "pantrybase-photos-"));
    ctx = openContext(root, { embeddings: false });
    // Two cards shot front then back, plus a retake of the second front.
    await makePhoto(path.join(src, "IMG_20261017_181738810.jpg"), 1);
    await makePhoto(path.join(src, "IMG_20261017_181742596.jpg"), 2);
    await makePhoto(path.join(src, "IMG_20261017_181856947.jpg"), 3);
    await makePhoto(path.join(src, "IMG_20261017_181858000.jpg"), 3, 6);
    await makePhoto(path.join(src, "nested", "IMG_20261017_181902345.jpg"), 4);
    fs.writeFileSync(path.join(src, "notes.txt"), "not a photo");
  });
  afterEach(() => {
    ctx.close();
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(src, { recursive: true, force: true });
  });

  it("imports folders recursively without touching originals, and skips known photos", async () => {
    const r = await importPaths(ctx, [src]);
    expect(r).toMatchObject({ copied: 5, already_known: 0, unsupported: 1 });
    expect(fs.readdirSync(src)).toContain("IMG_20261017_181738810.jpg");
    expect(ctx.store.ingestCounts()).toEqual({ pending: 5, done: 0, skipped: 0, failed: 0 });

    const again = await importPaths(ctx, [src]);
    expect(again).toMatchObject({ copied: 0, already_known: 5 });
  });

  it("orders by capture time and flags retakes", async () => {
    await importPaths(ctx, [src]);
    const { items, progress } = nextBatch(ctx, 10);
    expect(progress.pending).toBe(5);
    expect(items.map((i) => i.name)).toEqual([
      "IMG_20261017_181738810.jpg",
      "IMG_20261017_181742596.jpg",
      "IMG_20261017_181856947.jpg",
      "IMG_20261017_181858000.jpg",
      "IMG_20261017_181902345.jpg",
    ]);
    expect(items[0]?.captured_at).toBe("2026-10-17T18:17:38.810");
    expect(items[3]?.retake_of?.id).toBe(items[2]?.id);
    expect(items[0]?.retake_of).toBeUndefined();
    expect(nextBatch(ctx, 2).items).toHaveLength(2);
  });

  it("parks byte-identical copies dropped straight into the inbox", async () => {
    await importPaths(ctx, [src]);
    fs.copyFileSync(
      path.join(src, "IMG_20261017_181738810.jpg"),
      path.join(ctx.paths.inbox, "copy.jpg"),
    );
    const scan = await scanInbox(ctx);
    expect(scan.duplicates).toHaveLength(1);
    expect(fs.existsSync(path.join(ctx.paths.inbox, "duplicates", "copy.jpg"))).toBe(true);
    expect(ctx.store.ingestCounts().pending).toBe(5);
  });

  it("archives a card's photos on save and is idempotent", async () => {
    await importPaths(ctx, [src]);
    const [front, back] = nextBatch(ctx, 2).items;
    if (!front || !back) throw new Error("no items");
    const ingest = [
      { id: front.id, side: "front" as const },
      { id: back.id, side: "back" as const },
    ];
    const res = saveRecipe(ctx, cosyPotatoes, { ingest });
    if (!res.saved) throw new Error(JSON.stringify(res));
    const slug = res.slug;
    expect(res.images).toEqual([`images/${slug}/front.jpg`, `images/${slug}/back.jpg`]);
    expect(fs.existsSync(path.join(ctx.paths.images, slug, "front.jpg"))).toBe(true);
    expect(fs.existsSync(path.join(ctx.paths.inbox, front.name))).toBe(false);

    const rec = ctx.store.getRecipe(slug);
    expect(rec?.extraction?.images).toEqual([
      { file: `images/${slug}/front.jpg`, side: "front" },
      { file: `images/${slug}/back.jpg`, side: "back" },
    ]);
    const md = fs.readFileSync(path.join(ctx.paths.recipes, `${slug}.md`), "utf8");
    expect(md).toContain(`images: [images/${slug}/front.jpg, images/${slug}/back.jpg]`);
    expect(ctx.store.ingestCounts()).toMatchObject({ pending: 3, done: 2 });

    // Retrying the same save does nothing.
    expect(saveRecipe(ctx, cosyPotatoes, { ingest })).toEqual({
      saved: false,
      already_ingested: true,
      slug,
    });
    // A photo can't be attached to two recipes.
    const other = saveRecipe(ctx, bakedRavioli, { ingest: [{ id: front.id, side: "front" }] });
    expect(other).toMatchObject({
      saved: false,
      error: expect.stringContaining("already attached"),
    });
  });

  it("attaches a retake to an existing recipe as an extra image", async () => {
    await importPaths(ctx, [src]);
    const items = nextBatch(ctx, 10).items;
    const [a, b, c, retake] = [items[2], items[4], items[0], items[3]];
    if (!a || !b || !c || !retake) throw new Error("no items");
    const first = saveRecipe(ctx, bakedRavioli, {
      ingest: [
        { id: a.id, side: "front" },
        { id: b.id, side: "back" },
      ],
    });
    if (!first.saved) throw new Error("not saved");
    const again = saveRecipe(
      ctx,
      { ...bakedRavioli, slug: first.slug },
      { ingest: [{ id: retake.id, side: "front" }] },
    );
    if (!again.saved) throw new Error(JSON.stringify(again));
    expect(again.images).toEqual([
      `images/${first.slug}/front-2.jpg`,
      `images/${first.slug}/front.jpg`,
      `images/${first.slug}/back.jpg`,
    ]);
  });

  it("moves skipped and failed photos aside with their reason, and back again", async () => {
    await importPaths(ctx, [src]);
    const [x, y] = nextBatch(ctx, 2).items;
    if (!x || !y) throw new Error("no items");
    resolveItems(ctx, [x.id], "skipped", "retake");
    resolveItems(ctx, [y.id], "failed", "too blurry");
    expect(
      fs.readFileSync(path.join(ctx.paths.inbox, "failed", `${y.name}.reason.txt`), "utf8").trim(),
    ).toBe("too blurry");
    expect(ctx.store.ingestCounts()).toMatchObject({ pending: 3, skipped: 1, failed: 1 });
    expect(nextBatch(ctx, 1).items[0]?.id).not.toBe(x.id);

    resolveItems(ctx, [y.id], "pending");
    expect(fs.existsSync(path.join(ctx.paths.inbox, y.name))).toBe(true);
    expect(fs.existsSync(path.join(ctx.paths.inbox, "failed", `${y.name}.reason.txt`))).toBe(false);
  });

  it("rebuilds the queue from the file system after the database is lost", async () => {
    await importPaths(ctx, [src]);
    const [f, b, s] = nextBatch(ctx, 3).items;
    if (!f || !b || !s) throw new Error("no items");
    const res = saveRecipe(ctx, cosyPotatoes, {
      ingest: [
        { id: f.id, side: "front" },
        { id: b.id, side: "back" },
      ],
    });
    resolveItems(ctx, [s.id], "skipped", "not a recipe");
    ctx.close();
    for (const file of fs.readdirSync(path.join(root, "pantrybase"))) {
      if (file.startsWith("pantrybase.db")) fs.rmSync(path.join(root, "pantrybase", file));
    }
    ctx = openContext(root, { embeddings: false });
    await scanInbox(ctx);
    expect(ctx.store.ingestCounts()).toEqual({ pending: 2, done: 2, skipped: 1, failed: 0 });
    const done = ctx.store.listIngest({ status: "done" });
    expect(done.every((d) => res.saved && "slug" in res && d.recipe_slug === res.slug)).toBe(true);
    expect(ctx.store.listIngest({ status: "skipped" })[0]?.reason).toBe("not a recipe");
    // Re-importing the originals finds them all known, even the archived ones.
    expect((await importPaths(ctx, [src])).already_known).toBe(5);
  });

  it("produces model-sized JPEGs within budget", async () => {
    const big = path.join(src, "big.png");
    await sharp({ create: { width: 4000, height: 3000, channels: 3, background: "#c84" } })
      .png()
      .toFile(big);
    const img = await imageForModel(big);
    expect(Math.max(img.width, img.height)).toBe(1600);
    expect(img.data.length).toBeLessThan(750_000);
    expect(img.data.subarray(0, 3).toString("hex")).toBe("ffd8ff");
  });

  it.runIf(process.platform === "darwin")("decodes iPhone HEIC via sips", async () => {
    const heic = path.join(src, "IMG_20261017_190000000.heic");
    execFileSync(
      "sips",
      ["-s", "format", "heic", path.join(src, "IMG_20261017_181738810.jpg"), "--out", heic],
      {
        stdio: "ignore",
      },
    );
    const info = await inspectImage(heic);
    expect(info.mime).toBe("image/heic");
    expect(info.width).toBe(640);
    const jpg = await inspectImage(path.join(src, "IMG_20261017_181738810.jpg"));
    expect(hamming(info.phash, jpg.phash)).toBeLessThanOrEqual(RETAKE_DISTANCE);
    expect((await imageForModel(heic)).mimeType).toBe("image/jpeg");
  });
});

const realScans = path.resolve(__dirname, "../../seed/test_scans");

describe.runIf(fs.existsSync(realScans))("real UCOOK scans (local only)", () => {
  it("queues all 24 photos in capture order and spots the Caprese retake", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pantrybase-real-"));
    const ctx = openContext(root, { embeddings: false });
    try {
      const r = await importPaths(ctx, [realScans]);
      expect(r.copied).toBe(24);
      const { items } = nextBatch(ctx, 24);
      expect(items[0]?.name).toBe("IMG_20261017_181646269.jpg");
      const retakes = items.filter((i) => i.retake_of);
      expect(retakes.map((i) => i.name).sort()).toEqual([
        "IMG_20261017_181723748.jpg",
        "IMG_20261017_181725324.jpg",
      ]);
    } finally {
      ctx.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);
});
