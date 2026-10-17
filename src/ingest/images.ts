import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import sharp, { type Sharp } from "sharp";

const execFileP = promisify(execFile);

export const IMAGE_EXTS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".heic",
  ".heif",
  ".tif",
  ".tiff",
]);
const HEIF_EXTS = new Set([".heic", ".heif"]);

/** Images sent to the model: long edge and byte budget (the MCP response stays well under 1 MB). */
export const MODEL_MAX_PX = 1600;
const MODEL_MAX_BYTES = 750_000;

/** dHash distance at or below which two photos are probably the same side of the same card. */
export const RETAKE_DISTANCE = 6;

export function isImageFile(name: string): boolean {
  return IMAGE_EXTS.has(path.extname(name).toLowerCase()) && !path.basename(name).startsWith(".");
}

export function mimeFor(file: string): string {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (HEIF_EXTS.has(ext)) return "image/heic";
  if (ext === ".tif" || ext === ".tiff") return "image/tiff";
  return "image/jpeg";
}

/**
 * HEIC/HEIF (iPhone) → JPEG buffer. The prebuilt sharp cannot decode HEVC, so use macOS `sips`
 * when available, else the optional pure-JS `heic-convert`.
 */
async function heifToJpeg(file: string): Promise<Buffer> {
  if (process.platform === "darwin") {
    const out = path.join(os.tmpdir(), `pantrybase-${process.pid}-${Date.now()}.jpg`);
    try {
      await execFileP("sips", ["-s", "format", "jpeg", file, "--out", out]);
      return fs.readFileSync(out);
    } finally {
      fs.rmSync(out, { force: true });
    }
  }
  try {
    const { default: convert } = await import("heic-convert");
    const jpeg = await convert({ buffer: fs.readFileSync(file), format: "JPEG", quality: 0.9 });
    return Buffer.from(jpeg);
  } catch (e) {
    throw new Error(
      `cannot decode HEIC ${path.basename(file)} (install heic-convert or convert to JPEG): ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
  }
}

/** A sharp pipeline for any supported file, EXIF-rotated. */
export async function openImage(file: string): Promise<Sharp> {
  const input = HEIF_EXTS.has(path.extname(file).toLowerCase()) ? await heifToJpeg(file) : file;
  return sharp(input, { failOn: "none" }).rotate();
}

/** JPEG sized for the model: long edge ≤ maxPx, quality stepped down until under the byte budget. */
export async function imageForModel(
  file: string,
  maxPx = MODEL_MAX_PX,
): Promise<{ data: Buffer; mimeType: "image/jpeg"; width: number; height: number }> {
  const base = await (await openImage(file))
    .resize(maxPx, maxPx, { fit: "inside", withoutEnlargement: true })
    .toBuffer({ resolveWithObject: true });
  let data = base.data;
  for (const quality of [82, 72, 62, 52, 42]) {
    data = await sharp(base.data).jpeg({ quality, mozjpeg: true }).toBuffer();
    if (data.length <= MODEL_MAX_BYTES) break;
  }
  return { data, mimeType: "image/jpeg", width: base.info.width, height: base.info.height };
}

/** 64-bit difference hash (hex): near-identical photos differ in only a few bits. */
export async function dhash(img: Sharp): Promise<string> {
  const px = await img.clone().greyscale().resize(9, 8, { fit: "fill" }).raw().toBuffer();
  let bits = 0n;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      bits = (bits << 1n) | ((px[y * 9 + x] ?? 0) > (px[y * 9 + x + 1] ?? 0) ? 1n : 0n);
    }
  }
  return bits.toString(16).padStart(16, "0");
}

export function hamming(a: string, b: string): number {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let n = 0;
  while (x) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
}

/** Phone file names carry the capture time: IMG_20261017_181646269, PXL_20261017_181646123, 20261017_181646. */
export function captureTimeFromName(name: string): string | null {
  const m = /(20\d{2})(\d{2})(\d{2})[_-](\d{2})(\d{2})(\d{2})(\d{0,3})/.exec(name);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, ms] = m;
  const iso = `${y}-${mo}-${d}T${h}:${mi}:${s}.${(ms ?? "").padEnd(3, "0")}`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

/** First "YYYY:MM:DD HH:MM:SS" in the EXIF block (DateTimeOriginal on phone photos). */
export function captureTimeFromExif(exif: Buffer | undefined): string | null {
  if (!exif) return null;
  const m = /(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(exif.toString("latin1"));
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.000`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

export interface ImageInfo {
  sha256: string;
  phash: string;
  width: number;
  height: number;
  mime: string;
  bytes: number;
  mtime: number;
  captured_at: string;
}

export async function inspectImage(file: string): Promise<ImageInfo> {
  const buf = fs.readFileSync(file);
  const st = fs.statSync(file);
  const img = await openImage(file);
  const meta = await img.metadata();
  const rotated = (meta.orientation ?? 1) >= 5;
  const captured =
    captureTimeFromName(path.basename(file)) ??
    captureTimeFromExif(meta.exif) ??
    new Date(st.mtimeMs).toISOString().slice(0, 23);
  return {
    sha256: createHash("sha256").update(buf).digest("hex"),
    phash: await dhash(img),
    width: (rotated ? meta.height : meta.width) ?? 0,
    height: (rotated ? meta.width : meta.height) ?? 0,
    mime: mimeFor(file),
    bytes: st.size,
    mtime: Math.round(st.mtimeMs),
    captured_at: captured,
  };
}
