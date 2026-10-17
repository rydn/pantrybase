import { Document, isMap, isSeq, parse as parseYaml } from "yaml";
import { normalizeRecipe, recipeInputSchema } from "../recipes/schema.js";
import type { Recipe } from "../types.js";

export const FORMAT_VERSION = 1;

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

function stripEmpty<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v) && v.length === 0 && k !== "derived_from" && k !== "images") continue;
    out[k] = v;
  }
  return out as Partial<T>;
}

/** Frontmatter holds the whole structured record; the body is for humans (and is what gets searched). */
export function serializeRecipe(recipe: Recipe): string {
  const fm: Record<string, unknown> = stripEmpty({
    pb: FORMAT_VERSION,
    title: recipe.title,
    slug: recipe.slug,
    summary: recipe.summary,
    servings: recipe.servings,
    time: stripEmpty({ ...recipe.time }),
    difficulty: recipe.difficulty,
    source: stripEmpty({ ...recipe.source }),
    derived_from: recipe.derived_from,
    images: recipe.images,
    tags: recipe.tags,
    ingredients: recipe.ingredients.map((i) => stripEmpty({ ...i })),
  });

  const doc = new Document(fm);
  const root = doc.contents;
  if (isMap(root)) {
    for (const key of ["time", "source"]) {
      const n = root.get(key, true);
      if (isMap(n)) n.flow = true;
    }
    for (const key of ["derived_from", "images"]) {
      const n = root.get(key, true);
      if (isSeq(n)) n.flow = true;
    }
    const tags = root.get("tags", true);
    if (isMap(tags)) for (const pair of tags.items) if (isSeq(pair.value)) pair.value.flow = true;
    const ings = root.get("ingredients", true);
    if (isSeq(ings)) for (const item of ings.items) if (isMap(item)) item.flow = true;
  }
  const yaml = doc.toString({ lineWidth: 0, flowCollectionPadding: false }).trimEnd();

  const lines: string[] = ["---", yaml, "---", "", `# ${recipe.title}`, ""];
  if (recipe.summary) lines.push(recipe.summary, "");
  lines.push("## Ingredients", "");
  for (const i of recipe.ingredients) lines.push(`- ${i.raw}${i.optional ? " (optional)" : ""}`);
  lines.push("", "## Method", "");
  recipe.steps.forEach((s, n) => {
    lines.push(`${n + 1}. ${s}`);
  });
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

/** Parse a recipe file. The filename stem wins over any slug in the frontmatter. */
export function parseRecipe(markdown: string, slugFromFile: string): Recipe {
  const m = FM_RE.exec(markdown);
  if (!m?.[1]) throw new Error("missing frontmatter");
  const fm = parseYaml(m[1]) as Record<string, unknown>;
  if (typeof fm !== "object" || fm === null) throw new Error("frontmatter is not a map");
  const secs = sections(m[2] ?? "");
  const { pb: _pb, ...rest } = fm;
  const steps = parseSteps(secs.get("method") ?? secs.get("steps") ?? "");
  const notes = secs.get("notes");
  const input = recipeInputSchema.parse({
    ...rest,
    slug: slugFromFile,
    steps: steps.length ? steps : ["(no method recorded)"],
    ...(notes ? { notes } : {}),
  });
  return normalizeRecipe(input, slugFromFile);
}
