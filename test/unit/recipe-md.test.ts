import { describe, expect, it } from "vitest";
import { parseRecipe, parseSteps, serializeRecipe } from "../../src/files/recipe-md.js";
import { slugify, uniqueSlug } from "../../src/files/slug.js";
import { normalizeRecipe } from "../../src/recipes/schema.js";
import { cosyPotatoes } from "../fixtures/ucook.js";
import { harissaChicken } from "../helpers.js";

describe("slug", () => {
  it("kebab-cases and folds diacritics", () => {
    expect(slugify("Crème Brûlée & Friends!")).toBe("creme-brulee-and-friends");
    expect(slugify("   ")).toBe("recipe");
    expect(slugify("Strandveld's Vegan Thai Green Curry")).toBe(
      "strandvelds-vegan-thai-green-curry",
    );
  });
  it("suffixes collisions", () => {
    const taken = new Set(["x", "x-2"]);
    expect(uniqueSlug("x", (s) => taken.has(s))).toBe("x-3");
  });
});

describe("recipe markdown", () => {
  it("round-trips a simple recipe", () => {
    const recipe = normalizeRecipe(harissaChicken, "harissa-chicken-traybake");
    const md = serializeRecipe(recipe);
    expect(md.startsWith("---\npb: 2\ntitle: Harissa Chicken Traybake\n")).toBe(true);
    expect(md).toContain("## Method");
    expect(md).toContain(
      "  - {raw: 4 chicken thighs, canonical: chicken thigh, qty: 4, unit: piece}",
    );
    expect(parseRecipe(md, "harissa-chicken-traybake")).toEqual(recipe);
  });

  it("round-trips a full v2 card record", () => {
    const recipe = normalizeRecipe(cosyPotatoes, "cosy-potatoes");
    const md = serializeRecipe(recipe);
    expect(md).toContain("subtitle: with spinach & piquanté peppers");
    expect(md).toContain("nutrition: {basis: per_100g, energy_kj: 330");
    expect(md).toContain("wine: {producer: Neil Ellis Wines");
    expect(md).toContain("### From your kitchen");
    expect(md).toContain("1. **Off you go!** Preheat the oven");
    expect(parseRecipe(md, "cosy-potatoes")).toEqual(recipe);
  });

  it("reads v1 files: summary as blurb, steps from the Method section", () => {
    const v1 = [
      "---",
      "pb: 1",
      "title: Old Soup",
      "summary: A soup from before v2.",
      "time: {prep: 5, cook: 20}",
      "source: {kind: manual}",
      "ingredients:",
      "  - {raw: 1 leek, canonical: leek}",
      "---",
      "",
      "## Method",
      "",
      "1. Chop the leek.",
      "2. Simmer.",
      "",
      "## Notes",
      "",
      "Freezes well.",
    ].join("\n");
    const r = parseRecipe(v1, "old-soup");
    expect(r.blurb).toBe("A soup from before v2.");
    expect(r.steps).toEqual([{ text: "Chop the leek." }, { text: "Simmer." }]);
    expect(r.time.total).toBe(25);
    expect(r.notes).toBe("Freezes well.");
  });

  it("parses numbered and bulleted steps with continuation lines", () => {
    expect(parseSteps("1. Chop.\n2. Fry\n   until golden.\n- Serve.")).toEqual([
      "Chop.",
      "Fry until golden.",
      "Serve.",
    ]);
  });
});
