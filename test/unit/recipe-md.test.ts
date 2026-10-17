import { describe, expect, it } from "vitest";
import { parseRecipe, parseSteps, serializeRecipe } from "../../src/files/recipe-md.js";
import { slugify, uniqueSlug } from "../../src/files/slug.js";
import { normalizeRecipe } from "../../src/recipes/schema.js";
import { harissaChicken } from "../helpers.js";

describe("slug", () => {
  it("kebab-cases and folds diacritics", () => {
    expect(slugify("Crème Brûlée & Friends!")).toBe("creme-brulee-and-friends");
    expect(slugify("   ")).toBe("recipe");
  });
  it("suffixes collisions", () => {
    const taken = new Set(["x", "x-2"]);
    expect(uniqueSlug("x", (s) => taken.has(s))).toBe("x-3");
  });
});

describe("recipe markdown", () => {
  it("round-trips through serialize/parse", () => {
    const recipe = normalizeRecipe(harissaChicken, "harissa-chicken-traybake");
    const md = serializeRecipe(recipe);
    expect(md.startsWith("---\npb: 1\ntitle: Harissa Chicken Traybake\n")).toBe(true);
    expect(md).toContain("## Method");
    expect(md).toContain(
      "  - {raw: 4 chicken thighs, canonical: chicken thigh, qty: 4, unit: piece}",
    );
    expect(md).toContain("  cuisine: [north african]");
    const back = parseRecipe(md, "harissa-chicken-traybake");
    expect(back).toEqual(recipe);
  });

  it("computes total time and lower-cases tags", () => {
    const recipe = normalizeRecipe(
      { ...harissaChicken, tags: { cuisine: ["North African", "north african"] } },
      "x",
    );
    expect(recipe.time.total).toBe(45);
    expect(recipe.tags.cuisine).toEqual(["north african"]);
  });

  it("parses numbered and bulleted steps with continuation lines", () => {
    expect(parseSteps("1. Chop.\n2. Fry\n   until golden.\n- Serve.")).toEqual([
      "Chop.",
      "Fry until golden.",
      "Serve.",
    ]);
  });
});
