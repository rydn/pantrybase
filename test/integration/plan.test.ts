import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addToPantry, listPantry } from "../../src/pantry/pantry.js";
import {
  autofillPlan,
  formatAmount,
  getPlan,
  renderShoppingList,
  savePlan,
  shoppingList,
  suggestRecipes,
} from "../../src/plan/plan.js";
import type { RecipeInput } from "../../src/recipes/schema.js";
import { saveRecipe } from "../../src/recipes/service.js";
import { bakedRavioli, cosyPotatoes } from "../fixtures/ucook.js";
import { harissaChicken, mushroomRisotto, tempContext } from "../helpers.js";

/** Shares potatoes with the cosy potatoes and peppers + chickpeas with the harissa chicken. */
const vegTraybake: RecipeInput = {
  title: "Smoky Veg Traybake",
  servings: 2,
  time: { total: 40 },
  source: { kind: "card" },
  tags: { diet: ["vegan"], dish: ["traybake"], cuisine: ["spanish"] },
  ingredients: [
    { raw: "400g baby potatoes", canonical: "baby potatoes", qty: 400, unit: "g" },
    { raw: "1 red pepper", canonical: "red pepper", qty: 1 },
    { raw: "1 tin chickpeas", canonical: "chickpeas", qty: 1, unit: "tin" },
    { raw: "smoked paprika", canonical: "smoked paprika" },
    { raw: "olive oil", canonical: "olive oil" },
  ],
  steps: ["Roast everything."],
};

const CHICKEN = "harissa-chicken-traybake";
const COSY = "cosy-potatoes-and-crispy-cannellini-beans";
const RAVIOLI = "bubbling-baked-ravioli";
const RISOTTO = "creamy-mushroom-risotto";
const VEG = "smoky-veg-traybake";

describe("meal planning", () => {
  let t: ReturnType<typeof tempContext>;
  beforeEach(() => {
    t = tempContext();
    for (const r of [cosyPotatoes, bakedRavioli, harissaChicken, mushroomRisotto, vegTraybake])
      saveRecipe(t.ctx, r);
  });
  afterEach(() => t.dispose());

  it("suggests recipes that share the seed's shopping, explaining the overlap", () => {
    const r = suggestRecipes(t.ctx, { seed: CHICKEN });
    expect(r.plan).toMatchObject({ to_buy: 4, from_pantry: 0, shared: 0, reuse: 0 });
    const [first, second] = r.suggestions;
    expect(first?.slug).toBe(VEG);
    // "red pepper" resolves to the catalog's "bell pepper".
    expect(first?.shares.sort()).toEqual(["bell pepper", "chickpeas"]);
    expect(first?.new).toEqual(["potato"]); // "baby potatoes" → catalog "potato"
    expect(first?.reuse).toBeGreaterThan(0.5);
    expect(second?.slug).toBe(COSY);
    // The card's "Pesto Princess Harissa Paste" is catalogued as "harissa"; piquanté peppers as bell pepper.
    expect(second?.shares.sort()).toEqual(["bell pepper", "harissa"]);
    // Nothing in common: ranked last, with everything new.
    const ravioli = r.suggestions.find((s) => s.slug === RAVIOLI);
    expect(ravioli).toMatchObject({ reuse: 0, shares: [] });
    expect(ravioli?.new.length).toBe(6);
    expect(r.suggestions.map((s) => s.slug)).not.toContain(CHICKEN);
  });

  it("counts pantry items as covered, weighs fresh items more, and flags repeated dishes", () => {
    addToPantry(t.ctx, [{ name: "parmesan" }]);
    const r = suggestRecipes(t.ctx, { plan: [RAVIOLI] });
    const risotto = r.suggestions.find((s) => s.slug === RISOTTO);
    expect(risotto).toMatchObject({ shares: [], from_pantry: ["parmesan"] });
    expect(r.plan.from_pantry).toBe(1);

    // Spinach (fresh) shared with the ravioli outweighs a dry good would.
    const cosy = r.suggestions.find((s) => s.slug === COSY);
    expect(cosy?.shares).toEqual(["spinach"]);

    const withTraybake = suggestRecipes(t.ctx, { plan: [COSY, CHICKEN] });
    const veg = withTraybake.suggestions.find((s) => s.slug === VEG);
    expect(veg).toMatchObject({ repeats: "traybake", reuse: 1, new: [] });
    expect(veg?.score).toBeCloseTo(0.85, 2);
    const relaxed = suggestRecipes(t.ctx, { plan: [COSY, CHICKEN], variety: false });
    expect(relaxed.suggestions.find((s) => s.slug === VEG)?.score).toBe(1);

    const quick = suggestRecipes(t.ctx, { seed: CHICKEN, filters: { max_total_min: 30 } });
    expect(quick.suggestions).toEqual([]);
    expect(suggestRecipes(t.ctx, { plan: ["nope"] }).unknown_slugs).toEqual(["nope"]);
  });

  it("lets sharing with the plan outrank a well-stocked pantry, and can ignore the pantry", () => {
    // The whole risotto is in the pantry; the veg traybake shares two of three items with the chicken.
    addToPantry(
      t.ctx,
      ["risotto rice", "chestnut mushrooms", "onion", "parmesan"].map((name) => ({ name })),
    );
    const empty = suggestRecipes(t.ctx, {});
    expect(empty.suggestions[0]?.slug).toBe(RISOTTO); // nothing to share with yet: pantry leads

    const r = suggestRecipes(t.ctx, { plan: [CHICKEN] });
    const [first, second] = r.suggestions;
    expect(first?.slug).toBe(VEG);
    expect(second).toMatchObject({ slug: RISOTTO, reuse: 1 }); // still reported as fully covered
    expect(second?.score).toBeLessThan(first?.score ?? 0);

    const off = suggestRecipes(t.ctx, { plan: [CHICKEN], use_pantry: false });
    expect(off.suggestions.find((s) => s.slug === RISOTTO)).toMatchObject({
      reuse: 0,
      from_pantry: [],
    });
    expect(off.plan.from_pantry).toBe(0);
  });

  it("hides a second copy of a card that is already planned or suggested", () => {
    saveRecipe(t.ctx, vegTraybake, { allow_duplicate: true });
    const dupes = t.ctx.store
      .listRecipes({ limit: 100 })
      .filter((r) => r.title === "Smoky Veg Traybake");
    expect(dupes).toHaveLength(2);
    const r = suggestRecipes(t.ctx, { seed: CHICKEN, limit: 50 });
    expect(r.suggestions.filter((s) => s.title === "Smoky Veg Traybake")).toHaveLength(1);
    const planned = suggestRecipes(t.ctx, { plan: [VEG], limit: 50 });
    expect(planned.suggestions.some((s) => s.title === "Smoky Veg Traybake")).toBe(false);
  });

  it("auto-fills a plan that minimises the whole list", () => {
    const r = autofillPlan(t.ctx, { seed: CHICKEN, count: 2 });
    expect(r.slugs).toHaveLength(3);
    expect(r.slugs[0]).toBe(CHICKEN);
    expect(r.added.map((s) => s.slug)).toEqual([VEG, COSY]);
    expect(r.plan.reuse).toBeGreaterThan(0.3);
    expect(r.plan.shared).toBeGreaterThanOrEqual(3);
    // Asking for more than exists just stops early.
    expect(autofillPlan(t.ctx, { seed: CHICKEN, count: 10 }).slugs).toHaveLength(5);
  });

  it("persists the plan, dropping unknown and duplicate recipes", () => {
    expect(getPlan(t.ctx).items).toEqual([]);
    const saved = savePlan(t.ctx, {
      items: [{ slug: CHICKEN, servings: 4 }, { slug: "nope" }, { slug: CHICKEN }, { slug: VEG }],
      confirmed: ["chickpeas", "chickpeas"],
    });
    expect(saved.items).toEqual([{ slug: CHICKEN, servings: 4 }, { slug: VEG }]);
    expect(saved.confirmed).toEqual(["chickpeas"]);
    expect(getPlan(t.ctx).items).toEqual(saved.items);
    // The default plan context for suggestions is the saved plan.
    expect(suggestRecipes(t.ctx).plan.recipes.map((r) => r.slug)).toEqual([CHICKEN, VEG]);
  });

  it("builds one grocery list with merged, scaled quantities and a pantry check", () => {
    addToPantry(t.ctx, [{ name: "chickpeas", qty: 2, unit: "tin" }]);
    savePlan(t.ctx, { items: [{ slug: CHICKEN }, { slug: VEG, servings: 4 }], confirmed: [] });

    let list = shoppingList(t.ctx);
    expect(list.recipes).toEqual([
      { slug: CHICKEN, title: "Harissa Chicken Traybake", servings: 2, scale: 1 },
      { slug: VEG, title: "Smoky Veg Traybake", servings: 4, scale: 2 },
    ]);
    const pepper = list.buy.find((l) => l.canonical === "bell pepper");
    expect(pepper).toEqual({
      canonical: "bell pepper",
      amount: "3",
      aisle: "fruit & veg",
      for: ["Harissa Chicken Traybake", "Smoky Veg Traybake"],
    });
    expect(list.buy.map((l) => l.aisle)).toEqual([
      "fruit & veg",
      "fruit & veg",
      "meat, fish & eggs",
      "pantry",
    ]);
    expect(list.buy.find((l) => l.canonical === "potato")?.amount).toBe("800 g");
    expect(list.pantry_check).toEqual([
      {
        canonical: "chickpeas",
        amount: "3 tin",
        for: ["Harissa Chicken Traybake", "Smoky Veg Traybake"],
        in_pantry: "2 tin",
        confirmed: false,
      },
    ]);
    expect(list.needs_confirmation).toEqual(["chickpeas"]);
    expect(list.staples).toEqual(["olive oil", "salt", "smoked paprika"]);
    expect(list.summary).toMatchObject({ to_buy: 4, from_pantry: 1, shared: 1 });

    // Confirming is remembered on the plan.
    list = shoppingList(t.ctx, { confirmed: ["chickpeas"] });
    expect(list.needs_confirmation).toEqual([]);
    expect(list.pantry_check[0]?.confirmed).toBe(true);
    expect(getPlan(t.ctx).confirmed).toEqual(["chickpeas"]);

    // Being out of something moves it onto the list and out of the pantry.
    list = shoppingList(t.ctx, { out_of: ["chickpeas"] });
    expect(list.removed_from_pantry).toEqual(["chickpeas"]);
    expect(list.pantry_check).toEqual([]);
    expect(list.buy.find((l) => l.canonical === "chickpeas")?.amount).toBe("3 tin");
    expect(listPantry(t.ctx)).toEqual([]);
    expect(getPlan(t.ctx).confirmed).toEqual([]);

    const txt = renderShoppingList(list);
    expect(txt).toContain("Fruit & veg");
    expect(txt).toContain("- bell pepper — 3");
    expect(txt).toContain("Staples used: olive oil, salt, smoked paprika");

    // Explicit slugs don't touch the saved plan.
    const adhoc = shoppingList(t.ctx, { items: [{ slug: RISOTTO }] });
    expect(adhoc.recipes.map((r) => r.slug)).toEqual([RISOTTO]);
    expect(getPlan(t.ctx).items.map((i) => i.slug)).toEqual([CHICKEN, VEG]);
  });

  it("formats merged amounts", () => {
    expect(formatAmount([])).toBeNull();
    expect(
      formatAmount([
        { qty: 600, unit: "g" },
        { qty: 500, unit: "g" },
      ]),
    ).toBe("1.1 kg");
    expect(
      formatAmount(
        [
          { qty: 200, unit: "g" },
          { qty: 1, unit: "tin" },
        ],
        1,
      ),
    ).toBe("200 g + 1 tin + +1 unmeasured");
    expect(formatAmount([{ qty: 2.5, unit: "" }])).toBe("2.5");
  });
});
