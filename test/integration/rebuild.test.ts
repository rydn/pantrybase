import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type AppContext, openContext } from "../../src/core/context.js";
import { saveRecipe } from "../../src/recipes/service.js";
import { searchRecipes } from "../../src/search/hybrid.js";
import { bakedRavioli, cosyPotatoes, thaiCurryFrontOnly } from "../fixtures/ucook.js";

/** The markdown files are the source of truth: every way the index can drift must heal. */
describe("reconcile and rebuild", () => {
  let root: string;
  let ctx: AppContext;
  const open = () => openContext(root, { embeddings: false });

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "pantrybase-rebuild-"));
    ctx = open();
    saveRecipe(ctx, cosyPotatoes);
    saveRecipe(ctx, bakedRavioli);
    saveRecipe(ctx, thaiCurryFrontOnly);
  });
  afterEach(() => {
    ctx.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  const snapshot = (c: AppContext) => ({
    stats: { ...c.store.stats(), chunks_pending: undefined, vectors: undefined },
    docs: ["cosy-potatoes-and-crispy-cannellini-beans", "bubbling-baked-ravioli"].map((s) => {
      const {
        id: _i,
        created_at: _c,
        updated_at: _u,
        file_mtime: _m,
        ...doc
      } = c.store.getRecipe(s) ?? {};
      return doc;
    }),
    techniques: c.store.listTags("technique"),
  });

  it("rebuilds an identical index after the database is deleted", () => {
    const before = snapshot(ctx);
    ctx.close();
    for (const f of fs.readdirSync(ctx.paths.data)) {
      if (f.startsWith("pantrybase.db")) fs.rmSync(path.join(ctx.paths.data, f));
    }
    ctx = open();
    expect(snapshot(ctx)).toEqual(before);
  });

  it("drops and rebuilds an index written by an older schema version", () => {
    const before = snapshot(ctx);
    ctx.close();
    const db = new Database(ctx.paths.db);
    db.prepare("UPDATE meta SET value = '1' WHERE key = 'schema_version'").run();
    db.close();
    ctx = open();
    expect(ctx.store.wasReset).toBe(true);
    expect(snapshot(ctx)).toEqual(before);
  });

  it("picks up hand edits, new files and deletions on the next sync", async () => {
    const file = path.join(ctx.paths.recipes, "bubbling-baked-ravioli.md");
    const md = fs.readFileSync(file, "utf8");
    fs.writeFileSync(file, md.replace("cuisine: [italian]", "cuisine: [italian, french]"));
    fs.copyFileSync(file, path.join(ctx.paths.recipes, "ravioli-copy.md"));
    fs.rmSync(path.join(ctx.paths.recipes, "strandvelds-vegan-thai-green-curry.md"));

    const r = ctx.sync({ now: true });
    expect(r).toMatchObject({ updated: 1, added: 1, removed: 1, errors: [] });
    const french = await searchRecipes(ctx, { filters: { tags: { cuisine: ["french"] } } });
    expect(french.results.map((x) => x.slug).sort()).toEqual([
      "bubbling-baked-ravioli",
      "ravioli-copy",
    ]);
    expect(ctx.store.stats().needs_review).toBe(0);
  });

  it("throttles automatic syncs but always honours now:true", () => {
    expect(ctx.sync()).toBeNull(); // just opened
    expect(ctx.sync({ now: true })).not.toBeNull();
  });

  it("re-parses every recipe when the vocabulary changes", async () => {
    // Teach the vocabulary that a "comfort" season tag is its own thing, not a winter synonym.
    const vocab = fs.readFileSync(ctx.paths.vocabularyYaml, "utf8");
    fs.writeFileSync(
      ctx.paths.vocabularyYaml,
      vocab.replace(
        "winter: {synonyms: [cold-weather, warming, cosy, comfort]}",
        "winter: {synonyms: [cold-weather]}\n    warming: {}",
      ),
    );
    // Make sure the mtime moves even on coarse filesystems.
    const t = new Date(Date.now() + 5000);
    fs.utimesSync(ctx.paths.vocabularyYaml, t, t);

    const r = ctx.sync({ now: true });
    expect(r?.updated).toBe(3);
    expect(ctx.store.getRecipe("cosy-potatoes-and-crispy-cannellini-beans")?.tags.season).toEqual([
      "winter",
    ]);
    // The markdown already holds the normalised value "winter", so it stays; new saves now keep "warming".
    const res = saveRecipe(
      ctx,
      { ...bakedRavioli, title: "Warming Ravioli", tags: { season: ["warming"] } },
      { allow_duplicate: true },
    );
    if (!res.saved) throw new Error("not saved");
    expect(ctx.store.getRecipe(res.slug)?.tags.season).toEqual(["warming"]);
  });

  it("applies catalog edits to existing recipes", () => {
    fs.appendFileSync(
      ctx.paths.ingredientsYaml,
      "\npitted dates: {staple: true, category: fruit, aliases: [medjool dates]}\n",
    );
    const t = new Date(Date.now() + 5000);
    fs.utimesSync(ctx.paths.ingredientsYaml, t, t);
    ctx.sync({ now: true });
    const dates = ctx.store
      .getRecipe("cosy-potatoes-and-crispy-cannellini-beans")
      ?.ingredients.find((i) => i.canonical === "pitted dates");
    expect(dates?.staple).toBe(true);
  });

  it("reports a broken file without losing the others", () => {
    fs.writeFileSync(path.join(ctx.paths.recipes, "broken.md"), "---\ntitle: [unclosed\n---\n");
    const r = ctx.sync({ now: true });
    expect(r?.errors.map((e) => e.file)).toEqual(["recipes/broken.md"]);
    expect(ctx.store.stats().recipes).toBe(3);
  });
});
