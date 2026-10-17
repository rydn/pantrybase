import fs from "node:fs";
import { parse as parseYaml } from "yaml";

export type VocabMode = "closed" | "open";

interface VocabValue {
  parent?: string;
  synonyms: string[];
}

interface VocabCategory {
  mode: VocabMode;
  values: Map<string, VocabValue>;
  /** normalised synonym or value → value */
  lookup: Map<string, string>;
}

export interface NormalizeReport {
  values: string[];
  /** Card wording mapped onto a vocabulary value. */
  mapped: Array<{ from: string; to: string }>;
  /** Values not in the vocabulary (accepted for open categories). */
  unknown: string[];
}

/** kebab-case, no accents or punctuation: "Cow's Milk" → "cows-milk". */
export function normalizeTagValue(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

interface RawCategory {
  mode?: VocabMode;
  values?: Record<string, { parent?: string; synonyms?: string[] } | null>;
}

export class Vocabulary {
  private readonly categories = new Map<string, VocabCategory>();

  static fromFile(file: string): Vocabulary {
    const v = new Vocabulary();
    if (fs.existsSync(file)) {
      v.load(parseYaml(fs.readFileSync(file, "utf8")) as Record<string, RawCategory> | null);
    }
    return v;
  }

  load(data: Record<string, RawCategory> | null): void {
    for (const [name, raw] of Object.entries(data ?? {})) {
      const cat = this.ensure(name, raw?.mode ?? "open");
      if (raw?.mode) cat.mode = raw.mode;
      for (const [value, def] of Object.entries(raw?.values ?? {})) {
        this.addValue(name, value, def?.synonyms ?? [], def?.parent);
      }
    }
  }

  private ensure(category: string, mode: VocabMode): VocabCategory {
    let cat = this.categories.get(category);
    if (!cat) {
      cat = { mode, values: new Map(), lookup: new Map() };
      this.categories.set(category, cat);
    }
    return cat;
  }

  addValue(category: string, value: string, synonyms: string[] = [], parent?: string): void {
    const cat = this.ensure(category, "open");
    const v = normalizeTagValue(value);
    const existing = cat.values.get(v);
    const entry: VocabValue = existing ?? { synonyms: [] };
    if (parent) entry.parent = normalizeTagValue(parent);
    cat.values.set(v, entry);
    cat.lookup.set(v, v);
    for (const s of synonyms) {
      const n = normalizeTagValue(s);
      if (!n) continue;
      entry.synonyms.push(n);
      if (!cat.values.has(n) || n === v) cat.lookup.set(n, v);
    }
  }

  /** Extra synonyms, e.g. from a provider profile. Unknown targets are created. */
  addSynonyms(category: string, map: Record<string, string>): void {
    for (const [from, to] of Object.entries(map)) this.addValue(category, to, [from]);
  }

  has(category: string): boolean {
    return this.categories.has(category);
  }

  mode(category: string): VocabMode {
    return this.categories.get(category)?.mode ?? "open";
  }

  resolve(category: string, raw: string): { value: string; known: boolean } {
    const n = normalizeTagValue(raw);
    const hit = this.categories.get(category)?.lookup.get(n);
    return hit ? { value: hit, known: true } : { value: n, known: false };
  }

  normalize(category: string, raws: string[]): NormalizeReport {
    const out: NormalizeReport = { values: [], mapped: [], unknown: [] };
    for (const raw of raws) {
      const { value, known } = this.resolve(category, raw);
      if (!value) continue;
      if (known && value !== normalizeTagValue(raw)) out.mapped.push({ from: raw, to: value });
      if (!known) out.unknown.push(value);
      if (!out.values.includes(value)) out.values.push(value);
    }
    return out;
  }

  /** The value plus everything below it in the hierarchy (thai ⊂ southeast-asian ⊂ asian). */
  expand(category: string, raw: string): string[] {
    const root = this.resolve(category, raw).value;
    const cat = this.categories.get(category);
    if (!cat) return [root];
    const out = new Set([root]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const [value, def] of cat.values) {
        if (def.parent && out.has(def.parent) && !out.has(value)) {
          out.add(value);
          grew = true;
        }
      }
    }
    return [...out];
  }

  /** Ancestors of a value, nearest first. */
  ancestors(category: string, value: string): string[] {
    const cat = this.categories.get(category);
    const out: string[] = [];
    let cur = cat?.values.get(value)?.parent;
    while (cur && !out.includes(cur)) {
      out.push(cur);
      cur = cat?.values.get(cur)?.parent;
    }
    return out;
  }

  /** Compact summary for Claude: closed categories list every value, open ones the top values. */
  summary(maxOpen = 40): Record<string, { mode: VocabMode; values: string[] }> {
    const out: Record<string, { mode: VocabMode; values: string[] }> = {};
    for (const [name, cat] of this.categories) {
      const values = [...cat.values.keys()];
      out[name] = {
        mode: cat.mode,
        values: cat.mode === "closed" ? values : values.slice(0, maxOpen),
      };
    }
    return out;
  }
}
