import { Document, isMap, isSeq, parse as parseYaml } from "yaml";
import { normalizeRecipe, recipeInputSchema } from "../recipes/schema.js";
import type { Recipe } from "../types.js";

export const FORMAT_VERSION = 2;

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/** Frontmatter key order — fixed so files diff cleanly. */
const KEY_ORDER = [
  "pb",
  "title",
  "slug",
  "subtitle",
  "description",
  "blurb",
  "servings",
  "time",
  "difficulty",
  "source",
  "provider",
  "derived_from",
  "images",
  "tags",
  "allergens",
  "equipment",
  "nutrition",
  "ingredients",
  "steps",
  "tips",
  "extraction",
] as const;

function stripEmpty<T extends object>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v) && v.length === 0 && k !== "derived_from" && k !== "images") continue;
    out[k] = v;
  }
  return out as Partial<T>;
}

/**
 * Frontmatter holds the whole structured record and is the source of truth; the body is a
 * rendered human view (plus free-form notes, which round-trip from the `## Notes` section).
 */
export function serializeRecipe(recipe: Recipe): string {
  const { notes: _notes, slug, ...rest } = recipe;
  const record: Record<string, unknown> = { pb: FORMAT_VERSION, ...rest, slug };
  const fm: Record<string, unknown> = {};
  for (const key of KEY_ORDER) {
    const v = record[key];
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v) && v.length === 0 && key !== "derived_from" && key !== "images") continue;
    if (typeof v === "object" && !Array.isArray(v)) {
      const inner = stripEmpty(v as Record<string, unknown>);
      if (Object.keys(inner).length === 0) continue;
      fm[key] = inner;
    } else {
      fm[key] = v;
    }
  }

  const doc = new Document(fm);
  const root = doc.contents;
  if (isMap(root)) {
    // Small maps and lists on one line; ingredients and steps one flow map per line.
    for (const key of ["time", "source", "nutrition"]) {
      const n = root.get(key, true);
      if (isMap(n)) n.flow = true;
    }
    for (const key of ["derived_from", "images", "allergens", "equipment"]) {
      const n = root.get(key, true);
      if (isSeq(n)) n.flow = true;
    }
    const provider = root.get("provider", true);
    if (isMap(provider)) {
      const wine = provider.get("wine", true);
      if (isMap(wine)) wine.flow = true;
    }
    const tags = root.get("tags", true);
    if (isMap(tags)) for (const pair of tags.items) if (isSeq(pair.value)) pair.value.flow = true;
    for (const key of ["ingredients", "steps"]) {
      const list = root.get(key, true);
      if (isSeq(list)) for (const item of list.items) if (isMap(item)) item.flow = true;
    }
    const extraction = root.get("extraction", true);
    if (isMap(extraction)) {
      for (const pair of extraction.items) if (isSeq(pair.value)) pair.value.flow = true;
      const images = extraction.get("images", true);
      if (isSeq(images)) for (const item of images.items) if (isMap(item)) item.flow = true;
    }
  }
  const yaml = doc.toString({ lineWidth: 0, flowCollectionPadding: false }).trimEnd();

  const lines: string[] = ["---", yaml, "---", "", `# ${recipe.title}`, ""];
  if (recipe.subtitle) lines.push(`*${recipe.subtitle}*`, "");
  if (recipe.description) lines.push(recipe.description, "");
  const box = recipe.ingredients.filter((i) => i.source !== "kitchen");
  const kitchen = recipe.ingredients.filter((i) => i.source === "kitchen");
  const line = (i: Recipe["ingredients"][number]) =>
    `- ${i.raw}${i.prep ? ` — ${i.prep}` : ""}${i.optional ? " (optional)" : ""}`;
  lines.push("## Ingredients", "");
  for (const i of box) lines.push(line(i));
  if (kitchen.length) {
    lines.push("", "### From your kitchen", "");
    for (const i of kitchen) lines.push(line(i));
  }
  lines.push("", "## Method", "");
  recipe.steps.forEach((s, n) => {
    lines.push(`${n + 1}. ${s.title ? `**${s.title}** ` : ""}${s.text}`);
  });
  if (recipe.tips.length) {
    lines.push("", "## Tips", "");
    for (const t of recipe.tips) lines.push(`- ${t}`);
  }
  if (recipe.notes) lines.push("", "## Notes", "", recipe.notes);
  lines.push("");
  return lines.join("\n");
}

function sections(body: string): Map<string, string> {
  const out = new Map<string, string>();
  let current: string | null = null;
  let buf: string[] = [];
  const flush = () => {
    if (current !== null) out.set(current, buf.join("\n").trim());
    buf = [];
  };
  for (const line of body.split(/\r?\n/)) {
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (m?.[1]) {
      flush();
      current = m[1].toLowerCase();
    } else {
      buf.push(line);
    }
  }
  flush();
  return out;
}

export function parseSteps(method: string): string[] {
  const steps: string[] = [];
  for (const raw of method.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^(?:\d+[.)]|[-*])\s+(.*)$/.exec(line);
    if (m?.[1]) steps.push(m[1]);
    else if (steps.length) steps[steps.length - 1] = `${steps[steps.length - 1]} ${line}`;
    else steps.push(line);
  }
  return steps;
}

/**
 * Parse a recipe file. The filename stem wins over any slug in the frontmatter. Steps come
 * from the frontmatter; hand-written files may instead give a numbered `## Method` list.
 */
export function parseRecipe(markdown: string, slugFromFile: string): Recipe {
  const m = FM_RE.exec(markdown);
  if (!m?.[1]) throw new Error("missing frontmatter");
  const fm = parseYaml(m[1]) as Record<string, unknown>;
  if (typeof fm !== "object" || fm === null) throw new Error("frontmatter is not a map");
  const secs = sections(m[2] ?? "");
  const { pb: _pb, summary, ...rest } = fm;
  const fmSteps = Array.isArray(rest.steps) && rest.steps.length > 0 ? rest.steps : undefined;
  const bodySteps = parseSteps(secs.get("method") ?? secs.get("steps") ?? "");
  const notes = secs.get("notes");
  const input = recipeInputSchema.parse({
    ...rest,
    // v1 files called the blurb "summary".
    ...(summary && !rest.blurb ? { blurb: summary } : {}),
    slug: slugFromFile,
    steps: fmSteps ?? (bodySteps.length ? bodySteps : ["(no method recorded)"]),
    ...(notes ? { notes } : {}),
  });
  return normalizeRecipe(input, slugFromFile);
}
