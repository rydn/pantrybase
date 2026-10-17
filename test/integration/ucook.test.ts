import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { saveRecipe } from "../../src/recipes/service.js";
import { searchRecipes } from "../../src/search/hybrid.js";
import { bakedRavioli, cosyPotatoes, thaiCurryFrontOnly } from "../fixtures/ucook.js";
import { tempContext } from "../helpers.js";

describe("UCOOK cards through the v2 pipeline", () => {
  let t: ReturnType<typeof tempContext>;
  beforeEach(() => {
    t = tempContext();
  });
  afterEach(() => t.dispose());

  it("applies provider rules and the vocabulary on save", () => {
    const res = saveRecipe(t.ctx, cosyPotatoes);
    if (!res.saved) throw new Error("not saved");
    const r = t.ctx.store.getRecipe(res.slug);
    if (!r) throw new Error("missing");

    // Plan label "Veggie" → diet vegetarian; card wording mapped onto vocabulary values.
    expect(r.tags.diet).toEqual(["vegetarian"]);
    expect(r.tags.cuisine).toEqual(["north-african"]);
    expect(r.tags.season).toEqual(["winter"]);
    expect(r.allergens).toEqual(["allium", "sulphites", "tree-nuts"]);
    expect(res.provider_rules).toEqual(
      expect.arrayContaining([
        'plan "Veggie" → diet:vegetarian',
        '"Paper Towel" moved to equipment',
      ]),
    );

    // Paper towel is equipment, not an ingredient; brands come out of canonical names.
    expect(r.ingredients.map((i) => i.canonical)).not.toContain("paper towel");
    expect(r.equipment).toEqual(
      expect.arrayContaining(["paper-towel", "oven", "roasting-tray", "pan"]),
    );
    const harissa = r.ingredients.find((i) => i.raw.includes("Harissa"));
    expect(harissa).toMatchObject({ canonical: "harissa", brand: "Pesto Princess" });

    // Regional and plural names resolve onto the catalog.
    const canon = r.ingredients.map((i) => i.canonical);
    expect(canon).toEqual(expect.arrayContaining(["potato", "bell pepper", "spinach"]));

    // From Your Kitchen items count as staples for this recipe.
    expect(r.ingredients.find((i) => i.canonical === "milk")).toMatchObject({
      staple: true,
      optional: true,
      source: "kitchen",
    });

    // Step uses follow the resolved names; techniques are vocabulary values.
    expect(r.steps[0]?.uses).toEqual(["potato", "vegetable oil"]);
    expect(r.steps[1]?.uses).toEqual(["harissa", "cannellini beans"]);
    expect(r.steps[0]?.techniques).toEqual(["roast"]);
    expect(r.steps[2]?.techniques).toEqual(["saute"]);
    expect(res.unmatched_uses).toEqual([]); // "lemon" resolves via the catalog

    // Derived facets are queryable graph nodes.
    const techniques = t.ctx.store.listTags("technique").map((x) => x.name);
    expect(techniques).toEqual(expect.arrayContaining(["roast", "saute"]));
    expect(t.ctx.store.listTags("chef")).toEqual([
      { category: "chef", name: "Kate Gomba", count: 1 },
    ]);
    expect(t.ctx.store.listTags("plan")[0]?.name).toBe("Veggie");
  });

  it("normalises both allergen wordings and closed-category strays", () => {
    const res = saveRecipe(t.ctx, bakedRavioli);
    if (!res.saved) throw new Error("not saved");
    const r = t.ctx.store.getRecipe(res.slug);
    expect(r?.allergens).toEqual(["egg", "gluten", "dairy", "allium", "wheat"]);
    // "ravioli" is a dish synonym; "grill" stays a technique; the small ovenproof dish normalises.
    expect(r?.tags.dish).toEqual(["stuffed-pasta"]);
    expect(r?.equipment).toEqual(expect.arrayContaining(["grill", "pot", "ovenproof-dish"]));
    expect(r?.ingredients.find((i) => i.raw.includes("NOMU"))).toMatchObject({
      canonical: "provencal rub",
      brand: "NOMU",
    });
    expect(r?.tips).toHaveLength(1);
  });

  it("flags incomplete cards for review", () => {
    const res = saveRecipe(t.ctx, thaiCurryFrontOnly);
    expect(res.saved && res.needs_review).toBe(true);
    expect(t.ctx.store.stats().needs_review).toBe(1);
  });

  it("filters by allergen, cuisine hierarchy, facets and review state", async () => {
    saveRecipe(t.ctx, cosyPotatoes);
    saveRecipe(t.ctx, bakedRavioli);
    saveRecipe(t.ctx, thaiCurryFrontOnly);
    const slugs = async (filters: Parameters<typeof searchRecipes>[1]["filters"]) =>
      (await searchRecipes(t.ctx, { filters, limit: 10 })).results.map((r) => r.slug).sort();

    // "Cow's Milk" as a filter value maps to dairy, which the ravioli lists as "Dairy".
    expect(await slugs({ exclude_allergens: ["Cow's Milk"] })).not.toContain(
      "bubbling-baked-ravioli",
    );
    expect(await slugs({ tags: { cuisine: ["asian"] } })).toEqual([
      "strandvelds-vegan-thai-green-curry",
    ]);
    expect(await slugs({ tags: { cuisine: ["african"] } })).toEqual([
      "cosy-potatoes-and-crispy-cannellini-beans",
    ]);
    expect(await slugs({ tags: { technique: ["grilling"] } })).toEqual(["bubbling-baked-ravioli"]);
    expect(await slugs({ tags: { chef: ["thea richter"] } })).toEqual(["bubbling-baked-ravioli"]);
    expect(await slugs({ needs_review: true })).toEqual(["strandvelds-vegan-thai-green-curry"]);
    expect(await slugs({ max_active_min: 25 })).toEqual([
      "bubbling-baked-ravioli",
      "cosy-potatoes-and-crispy-cannellini-beans",
    ]);
  });

  it("finds cards by blurb and description text", async () => {
    saveRecipe(t.ctx, cosyPotatoes);
    saveRecipe(t.ctx, bakedRavioli);
    const res = await searchRecipes(t.ctx, { query: "warming plant-based traybake", limit: 3 });
    expect(res.results[0]?.slug).toBe("cosy-potatoes-and-crispy-cannellini-beans");
  });
});
