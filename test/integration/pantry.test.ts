import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { openContext } from "../../src/core/context.js";
import { mergeIngredients } from "../../src/ingredients/merge.js";
import {
  addToPantry,
  listPantry,
  matchRecipes,
  removeFromPantry,
} from "../../src/pantry/pantry.js";
import type { RecipeInput } from "../../src/recipes/schema.js";
import { saveRecipe } from "../../src/recipes/service.js";
import { synthesisContext } from "../../src/synthesis/context.js";
import { bakedRavioli, cosyPotatoes } from "../fixtures/ucook.js";
import { harissaChicken, mushroomRisotto, tempContext } from "../helpers.js";

const flatbread: RecipeInput = {
  title: "Caprese Flatbread",
  source: { kind: "card" },
  provider: { id: "ucook", plan: "Veggie" },
  tags: { cuisine: ["italian"], dish: ["flatbread"] },
  ingredients: [
    {
      raw: "100ml Creamy Pesto (60ml Pesto Princess Basil Pesto & 40ml Sour Cream)",
      canonical: "creamy pesto",
      components: [
        { raw: "60ml Pesto Princess Basil Pesto", canonical: "pesto", qty: 60, unit: "ml" },
        { raw: "40ml Sour Cream", canonical: "sour cream", qty: 40, unit: "ml" },
      ],
      source: "box",
    },
    { raw: "100g Feta", canonical: "feta", alternatives: ["halloumi"], source: "box" },
    { raw: "2 Naan Breads", canonical: "naan breads", qty: 2, source: "box" },
  ],
  steps: ["Spread the pesto over the naan, top with cheese and bake."],
};

describe("pantry and matching", () => {
  let t: ReturnType<typeof tempContext>;
  beforeEach(() => {
    t = tempContext();
    for (const r of [cosyPotatoes, bakedRavioli, harissaChicken, mushroomRisotto, flatbread])
      saveRecipe(t.ctx, r);
  });
  afterEach(() => t.dispose());

  it("resolves pantry names through aliases, plurals and regional names", () => {
    const added = addToPantry(t.ctx, [
      { name: "Eggs", qty: 6 },
      { name: "baby marrow" },
      { name: "Spring Onions" },
      { name: "dragonfruit" },
    ]);
    expect(added).toEqual([
      { name: "Eggs", canonical: "egg", matched: "alias" },
      { name: "baby marrow", canonical: "courgette", matched: "alias" },
      { name: "Spring Onions", canonical: "spring onion", matched: "alias" },
      { name: "dragonfruit", canonical: "dragonfruit", matched: "new" },
    ]);
    addToPantry(t.ctx, [{ name: "egg", qty: 12 }]);
    expect(listPantry(t.ctx).find((p) => p.canonical === "egg")?.qty).toBe(12);
    expect(removeFromPantry(t.ctx, ["eggs", "caviar"])).toEqual({
      removed: ["egg"],
      not_in_pantry: ["caviar"],
    });
    expect(listPantry(t.ctx)).toHaveLength(3);
  });

  it("ranks recipes by coverage, ignoring staples and optional items", () => {
    addToPantry(
      t.ctx,
      [
        "baby potatoes",
        "cannellini beans",
        "harissa paste",
        "spinach",
        "cucumber",
        "piquante peppers",
      ].map((name) => ({ name })),
    );
    const { results } = matchRecipes(t.ctx, { limit: 10 });
    const cosy = results[0];
    expect(cosy?.slug).toBe("cosy-potatoes-and-crispy-cannellini-beans");
    // 8 required box items; oil and salt are kitchen staples, milk is optional.
    expect(cosy).toMatchObject({ have: 6, need: 8, coverage: 0.75, near_miss: true });
    expect(cosy?.missing.map((m) => m.canonical).sort()).toEqual([
      "cashew cream cheese",
      "pitted dates",
    ]);
    const ravioli = results.find((r) => r.slug === "bubbling-baked-ravioli");
    expect(ravioli).toMatchObject({ have: 1, need: 6 });
  });

  it("counts printed alternatives and composite parts", () => {
    addToPantry(
      t.ctx,
      ["pesto", "sour cream", "halloumi", "naan"].map((name) => ({ name })),
    );
    const flat = matchRecipes(t.ctx).results.find((r) => r.slug === "caprese-flatbread");
    expect(flat).toMatchObject({ coverage: 1, missing: [] });
  });

  it("supports ad-hoc ingredients, pantry opt-out and filters", () => {
    addToPantry(t.ctx, [{ name: "risotto rice" }, { name: "chestnut mushrooms" }]);
    const adhoc = matchRecipes(t.ctx, {
      ingredients: ["onion", "parmesan", "unobtainium"],
      min_coverage: 1,
    });
    expect(adhoc.results.map((r) => r.slug)).toEqual(["creamy-mushroom-risotto"]);
    expect(adhoc.unknown_ingredients).toEqual(["unobtainium"]);
    const without = matchRecipes(t.ctx, {
      ingredients: ["onion", "parmesan"],
      use_pantry: false,
      min_coverage: 1,
    });
    expect(without.results).toEqual([]);
    const veg = matchRecipes(t.ctx, { filters: { tags: { protein: ["chicken"] } } });
    expect(veg.results.map((r) => r.slug)).toEqual(["harissa-chicken-traybake"]);
  });

  it("builds a synthesis context with shared patterns and pantry fit", async () => {
    addToPantry(t.ctx, [{ name: "harissa" }, { name: "chickpeas" }, { name: "potato" }]);
    const c = await synthesisContext(t.ctx, { query: "harissa traybake", use_pantry: true, n: 3 });
    expect(c.recipes.map((r) => r.slug)).toEqual(
      expect.arrayContaining([
        "harissa-chicken-traybake",
        "cosy-potatoes-and-crispy-cannellini-beans",
      ]),
    );
    expect(c.selected_by).toContain("pantry");
    expect(c.patterns.common_ingredients.join(" ")).toContain("harissa ×2");
    expect(c.patterns.techniques.join(" ")).toContain("roast");
    expect(c.pantry?.have).toEqual(expect.arrayContaining(["harissa", "potato"]));
    expect(c.to_save).toContain("derived_from");
    const first = c.recipes[0];
    expect(first?.ingredients.some((i) => i.includes("[staple]"))).toBe(true);

    const explicit = await synthesisContext(t.ctx, { slugs: ["caprese-flatbread", "nope"] });
    expect(explicit.recipes.map((r) => r.slug)).toEqual(["caprese-flatbread"]);
  });

  it("saves synthesized recipes linked to their sources", () => {
    const res = saveRecipe(t.ctx, {
      title: "Harissa Bean & Potato Bake",
      source: { kind: "synthesized" },
      derived_from: [
        "cosy-potatoes-and-crispy-cannellini-beans",
        "harissa-chicken-traybake",
        "made-up",
      ],
      ingredients: [{ raw: "500g potatoes", canonical: "potato", qty: 500, unit: "g" }],
      steps: ["Roast everything with harissa."],
    });
    if (!res.saved || !("unknown_derived_from" in res)) throw new Error(JSON.stringify(res));
    expect(res.unknown_derived_from).toEqual(["made-up"]);
    expect(t.ctx.store.getRecipe(res.slug)?.derived_from).toHaveLength(3);
  });

  it("merges ingredients durably across files, pantry and catalog", () => {
    addToPantry(t.ctx, [{ name: "pitted dates" }]);
    const r = mergeIngredients(t.ctx, "pitted dates", "dates");
    expect(r).toMatchObject({ from: "pitted dates", into: "dates", pantry_moved: true });
    expect(r.recipes_updated).toEqual(["cosy-potatoes-and-crispy-cannellini-beans"]);

    const md = fs.readFileSync(
      path.join(t.ctx.paths.recipes, "cosy-potatoes-and-crispy-cannellini-beans.md"),
      "utf8",
    );
    expect(md).toContain("canonical: dates");
    expect(md).not.toContain("canonical: pitted dates");
    expect(listPantry(t.ctx).map((p) => p.canonical)).toEqual(["dates"]);
    const yaml = parseYaml(fs.readFileSync(t.ctx.paths.ingredientsYaml, "utf8")) as Record<
      string,
      { aliases?: string[] }
    >;
    expect(yaml.dates?.aliases).toContain("pitted dates");
    // The seed file's comments survive the edit.
    expect(fs.readFileSync(t.ctx.paths.ingredientsYaml, "utf8")).toContain(
      "# Ingredient catalog seed.",
    );

    // New saves resolve the old name to the merged one, even after a full rebuild from files.
    const again = saveRecipe(t.ctx, {
      title: "Date Salsa",
      ingredients: [{ raw: "pitted dates", canonical: "pitted dates" }],
      steps: ["Chop."],
    });
    if (!again.saved || !("slug" in again)) throw new Error("not saved");
    expect(t.ctx.store.getRecipe(again.slug)?.ingredients[0]?.canonical).toBe("dates");
    t.ctx.close();
    for (const f of fs.readdirSync(t.ctx.paths.data)) {
      if (f.startsWith("pantrybase.db")) fs.rmSync(path.join(t.ctx.paths.data, f));
    }
    const fresh = openContext(t.root, { embeddings: false });
    expect(
      fresh.store
        .getRecipe("cosy-potatoes-and-crispy-cannellini-beans")
        ?.ingredients.some((i) => i.canonical === "dates"),
    ).toBe(true);
    fresh.close();
    t.ctx = openContext(t.root, { embeddings: false });
  });
});
