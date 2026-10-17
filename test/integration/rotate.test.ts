import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type AppContext, openContext } from "../../src/core/context.js";
import { rotateFile } from "../../src/ingest/images.js";
import { importPaths, nextBatch, rotateItem } from "../../src/ingest/inbox.js";
import { saveRecipe } from "../../src/recipes/service.js";
import { cosyPotatoes } from "../fixtures/ucook.js";

const RED = { r: 220, g: 30, b: 30 };
const BLUE = { r: 30, g: 30, b: 220 };

/** Left half red, right half blue (plus a seed-dependent stripe so photos differ). */
async function makeCard(file: string, w: number, h: number, seed = 0): Promise<void> {
  const px = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = x < w / 2 ? RED : BLUE;
      const stripe = Math.floor(y / 20) % (seed + 2) === 0 ? 40 : 0;
      const o = (y * w + x) * 3;
      px[o] = c.r;
      px[o + 1] = Math.min(255, c.g + stripe);
      px[o + 2] = c.b;
    }
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await sharp(px, { raw: { width: w, height: h, channels: 3 } })
    .jpeg({ quality: 95 })
    .toFile(file);
}

/** Average colour of a small patch at relative position (fx, fy). */
async function patch(file: string, fx: number, fy: number): Promise<{ r: number; b: number }> {
  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
  const x = Math.floor(info.width * fx);
  const y = Math.floor(info.height * fy);
  const o = (y * info.width + x) * info.channels;
  return { r: data[o] ?? 0, b: data[o + 2] ?? 0 };
}
const isRed = (c: { r: number; b: number }) => c.r > 150 && c.b < 100;
const isBlue = (c: { r: number; b: number }) => c.b > 150 && c.r < 100;

describe("rotation", () => {
  let root: string;
  let src: string;
  let ctx: AppContext;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "pantrybase-rotate-"));
    src = fs.mkdtempSync(path.join(os.tmpdir(), "pantrybase-rotate-src-"));
    ctx = openContext(root, { embeddings: false });
  });
  afterEach(() => {
    ctx.close();
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(src, { recursive: true, force: true });
  });

  it("rotates clockwise: the left edge ends up on top", async () => {
    const f = path.join(src, "card.jpg");
    await makeCard(f, 600, 400);
    expect(await rotateFile(f, 90)).toBe(f);
    const meta = await sharp(f).metadata();
    expect([meta.width, meta.height]).toEqual([400, 600]);
    expect(isRed(await patch(f, 0.5, 0.2))).toBe(true);
    expect(isBlue(await patch(f, 0.5, 0.8))).toBe(true);

    await rotateFile(f, 180);
    expect(isBlue(await patch(f, 0.5, 0.2))).toBe(true);
    await rotateFile(f, 270);
    // 90 + 180 + 270 = 540 ≡ 180: red is now on the right.
    expect(isRed(await patch(f, 0.8, 0.5))).toBe(true);
  });

  it("applies the camera's EXIF orientation first and leaves none behind", async () => {
    const f = path.join(src, "exif.jpg");
    await makeCard(f, 600, 400);
    // Orientation 6 = "display rotated 90° clockwise": viewers show it portrait, red on top.
    const tagged = await sharp(f).withMetadata({ orientation: 6 }).jpeg().toBuffer();
    fs.writeFileSync(f, tagged);
    await rotateFile(f, 90);
    const meta = await sharp(f).metadata();
    expect([meta.width, meta.height]).toEqual([600, 400]); // portrait as displayed, +90 → landscape
    expect(meta.orientation === undefined || meta.orientation === 1).toBe(true);
    expect(isRed(await patch(f, 0.8, 0.5))).toBe(true); // red moved from top to right
  });

  it("flags the odd one out and clears the hint once it is upright", async () => {
    for (const [i, name] of [
      "IMG_20261017_181700000.jpg",
      "IMG_20261017_181701000.jpg",
      "IMG_20261017_181702000.jpg",
    ].entries()) {
      await makeCard(path.join(src, name), 600, 400, i);
    }
    await makeCard(path.join(src, "IMG_20261017_181703000.jpg"), 400, 600, 7);
    await importPaths(ctx, [src]);
    const items = nextBatch(ctx, 10).items;
    const sideways = items.find((i) => i.size === "400x600");
    if (!sideways) throw new Error("no portrait photo");
    expect(sideways.rotation_hint).toMatch(/portrait while most photos are landscape/);
    expect(items.filter((i) => i.rotation_hint)).toHaveLength(1);

    const before = ctx.store.ingestByIds([sideways.id])[0];
    const after = await rotateItem(ctx, sideways.id, 270);
    expect(after.size).toBe("600x400");
    expect(after.rotation_hint).toBeUndefined();
    expect(after.version).not.toBe(sideways.version);
    const row = ctx.store.ingestByIds([sideways.id])[0];
    expect(row?.path).toBe(before?.path);
    expect(row?.sha256).not.toBe(before?.sha256);
    expect(row?.phash).not.toBe(before?.phash);
  });

  it("rotates archived photos in place without breaking the recipe", async () => {
    await makeCard(path.join(src, "IMG_20261017_181700000.jpg"), 600, 400);
    await importPaths(ctx, [src]);
    const [item] = nextBatch(ctx, 1).items;
    if (!item) throw new Error("no item");
    const res = saveRecipe(ctx, cosyPotatoes, { ingest: [{ id: item.id, side: "front" }] });
    if (!res.saved || !("images" in res)) throw new Error("not saved");
    const rotated = await rotateItem(ctx, item.id, 180);
    expect(rotated.status).toBe("done");
    expect(ctx.store.ingestByIds([item.id])[0]?.path).toBe(res.images[0]);
    expect(fs.existsSync(path.join(ctx.paths.data, res.images[0] ?? ""))).toBe(true);
    expect(isBlue(await patch(path.join(ctx.paths.data, res.images[0] ?? ""), 0.2, 0.5))).toBe(
      true,
    );
  });

  it("refuses unknown photos", async () => {
    await expect(rotateItem(ctx, 999, 90)).rejects.toThrow("no photo #999");
  });

  it.runIf(process.platform === "darwin")(
    "turns a sideways HEIC into an upright JPEG",
    async () => {
      const jpg = path.join(src, "IMG_20261017_190000000.jpg");
      await makeCard(jpg, 600, 400);
      const heic = path.join(src, "IMG_20261017_190000000.heic");
      execFileSync("sips", ["-s", "format", "heic", jpg, "--out", heic], { stdio: "ignore" });
      fs.rmSync(jpg);
      await importPaths(ctx, [src]);
      const [item] = nextBatch(ctx, 1).items;
      if (!item) throw new Error("no item");
      await rotateItem(ctx, item.id, 90);
      const row = ctx.store.ingestByIds([item.id])[0];
      expect(row?.path).toBe("inbox/IMG_20261017_190000000.jpg");
      expect(row?.mime).toBe("image/jpeg");
      expect(fs.existsSync(path.join(ctx.paths.inbox, "IMG_20261017_190000000.heic"))).toBe(false);
      expect(isRed(await patch(path.join(ctx.paths.data, row?.path ?? ""), 0.5, 0.2))).toBe(true);
    },
  );
});
