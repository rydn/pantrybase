import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { reconcile } from "../../src/files/reconcile.js";
import { saveRecipe } from "../../src/recipes/service.js";
import { searchRecipes } from "../../src/search/hybrid.js";
import { harissaChicken, mushroomRisotto, tempContext } from "../helpers.js";

describe("save + search", () => {
  let t: ReturnType<typeof tempContext>;
  beforeEach(() => {
    t = tempContext();
  });
  afterEach(() => t.dispose());

  it("sets up the data folder so recipes and photos can be committed but the index can't", () => {
    const ignore = fs.readFileSync(path.join(t.ctx.paths.data, ".gitignore"), "utf8");
    expect(ignore).toContain("pantrybase.db\n");
    expect(ignore).toContain("pantrybase.db-*");
    const rules = ignore.split("\n").filter((l) => l.trim() && !l.startsWith("#"));
    expect(rules.some((r) => /recipes|images|\.yaml/.test(r))).toBe(false);
  });

  it("writes markdown, indexes, resolves ingredients against the seed", async () => {
    const res = saveRecipe(t.ctx, harissaChicken);
    expect(res.saved).toBe(true);
    if (!res.saved) return;
    expect(res.slug).toBe("harissa-chicken-traybake");
    expect(fs.existsSync(path.join(t.ctx.paths.recipes, "harissa-chicken-traybake.md"))).toBe(true);
    // "harissa paste" is a seed alias of "harissa"; "red pepper" → "bell pepper".
    expect(res.aliased).toEqual(
      expect.arrayContaining([
        { from: "harissa paste", to: "harissa" },
        { from: "red pepper", to: "bell pepper" },
      ]),
    );
    expect(res.new_ingredients).toEqual([]);

    const rec = t.ctx.store.getRecipe("harissa-chicken-traybake");
    expect(rec?.ingredients.find((i) => i.canonical === "salt")?.staple).toBe(true);
    expect(rec?.ingredients.find((i) => i.canonical === "chicken thigh")?.staple).toBeUndefined();
    expect(rec?.time.total).toBe(45);

    const stats = t.ctx.store.stats();
    expect(stats.recipes).toBe(1);
    expect(stats.chunks).toBe(4);
    expect(stats.chunks_pending).toBe(4);
  });

  it("finds recipes lexically and honours filters", async () => {
    saveRecipe(t.ctx, harissaChicken);
    saveRecipe(t.ctx, mushroomRisotto);

    const spicy = await searchRecipes(t.ctx, { query: "spicy chicken", limit: 5 });
    expect(spicy.results[0]?.slug).toBe("harissa-chicken-traybake");
    expect(spicy.vector_used).toBe(false);

    const veg = await searchRecipes(t.ctx, { filters: { tags: { diet: ["vegetarian"] } } });
    expect(veg.results.map((r) => r.slug)).toEqual(["creamy-mushroom-risotto"]);

    const noMushroom = await searchRecipes(t.ctx, {
      query: "dinner",
      filters: { exclude_ingredients: ["mushrooms"] },
    });
    expect(noMushroom.results.map((r) => r.slug)).not.toContain("creamy-mushroom-risotto");

    // Stopwords must not drag unrelated recipes in through the OR fallback.
    const filler = await searchRecipes(t.ctx, { query: "something with mushrooms", limit: 5 });
    expect(filler.results.map((r) => r.slug)).toEqual(["creamy-mushroom-risotto"]);

    const typo = await searchRecipes(t.ctx, { query: "rissotto", limit: 5 });
    expect(typo.results[0]?.slug).toBe("creamy-mushroom-risotto");
  });

  it("detects duplicates and allows overriding", () => {
    saveRecipe(t.ctx, harissaChicken);
    const dup = saveRecipe(t.ctx, { ...harissaChicken, title: "Harissa Chicken Tray Bake" });
    expect(dup.saved).toBe(false);
    const forced = saveRecipe(
      t.ctx,
      { ...harissaChicken, title: "Harissa Chicken Tray Bake" },
      { allow_duplicate: true },
    );
    expect(forced.saved && forced.slug).toBe("harissa-chicken-tray-bake");
  });

  it("rebuilds the index from markdown and tracks edits", () => {
    saveRecipe(t.ctx, harissaChicken);
    const file = path.join(t.ctx.paths.recipes, "harissa-chicken-traybake.md");
    const edited = fs
      .readFileSync(file, "utf8")
      .replace("title: Harissa Chicken Traybake", "title: Harissa Chicken Bake");
    fs.writeFileSync(file, edited);
    const r = reconcile(t.ctx);
    expect(r.updated).toBe(1);
    expect(t.ctx.store.getRecipe("harissa-chicken-traybake")?.title).toBe("Harissa Chicken Bake");

    fs.rmSync(file);
    const r2 = reconcile(t.ctx);
    expect(r2.removed).toBe(1);
    expect(t.ctx.store.stats().recipes).toBe(0);
  });
});
