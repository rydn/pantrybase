import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { packageRoot } from "../config.js";

export interface ProviderProfile {
  id: string;
  name: string;
  country: string | null;
  website?: string;
  recognise: string[];
  sides: { front: string[]; back: string[] };
  pairing: "front-then-back" | "content";
  /** How an upright card is shaped, if the provider prints them consistently. */
  orientation: "landscape" | "portrait" | null;
  nutrition_basis: "per_100g" | "per_serving";
  default_servings: number | null;
  kitchen_section: string | null;
  plan_labels: Record<string, Record<string, string[]>>;
  allergen_synonyms: Record<string, string>;
  brands: string[];
  equipment_terms: Record<string, string>;
  ingredient_aliases: Record<string, string[]>;
  /** Extraction guide (markdown) for Claude. */
  guide: string;
  /** Directory the profile was loaded from. */
  dir: string;
}

export const GENERIC_PROVIDER = "generic";

export function builtinProvidersDir(): string {
  return path.join(packageRoot, "providers");
}

function loadProfile(dir: string): ProviderProfile | null {
  const file = path.join(dir, "profile.yaml");
  if (!fs.existsSync(file)) return null;
  const raw = (parseYaml(fs.readFileSync(file, "utf8")) ?? {}) as Partial<ProviderProfile>;
  const guideFile = path.join(dir, "guide.md");
  const id = (raw.id ?? path.basename(dir)).toLowerCase();
  return {
    id,
    name: raw.name ?? id,
    country: raw.country ?? null,
    website: raw.website,
    recognise: raw.recognise ?? [],
    sides: { front: raw.sides?.front ?? [], back: raw.sides?.back ?? [] },
    pairing: raw.pairing ?? "content",
    orientation: raw.orientation ?? null,
    nutrition_basis: raw.nutrition_basis ?? "per_serving",
    default_servings: raw.default_servings ?? null,
    kitchen_section: raw.kitchen_section ?? null,
    plan_labels: raw.plan_labels ?? {},
    allergen_synonyms: raw.allergen_synonyms ?? {},
    brands: raw.brands ?? [],
    equipment_terms: raw.equipment_terms ?? {},
    ingredient_aliases: raw.ingredient_aliases ?? {},
    guide: fs.existsSync(guideFile) ? fs.readFileSync(guideFile, "utf8") : "",
    dir,
  };
}

/** Built-in profiles, overridden or extended by `<data>/providers/<id>/`. */
export class ProviderRegistry {
  private readonly profiles = new Map<string, ProviderProfile>();

  constructor(dirs: string[]) {
    for (const base of dirs) {
      if (!fs.existsSync(base)) continue;
      for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const p = loadProfile(path.join(base, entry.name));
        if (p) this.profiles.set(p.id, p);
      }
    }
  }

  get(id: string | undefined | null): ProviderProfile | undefined {
    return id ? this.profiles.get(id.toLowerCase()) : undefined;
  }

  /** The profile for `id`, or the generic one. */
  resolve(id: string | undefined | null): ProviderProfile {
    const p = this.get(id) ?? this.profiles.get(GENERIC_PROVIDER);
    if (!p) throw new Error("no generic provider profile found");
    return p;
  }

  list(): ProviderProfile[] {
    return [...this.profiles.values()].sort((a, b) => a.id.localeCompare(b.id));
  }
}
