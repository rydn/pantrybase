import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { saveRecipe } from "../../src/recipes/service.js";
import { harissaChicken, mushroomRisotto, tempContext } from "../helpers.js";

/** Deterministic unit vector pointing mostly along `axis`. */
function vec(dims: number, axis: number): Float32Array {
  const v = new Float32Array(dims).fill(0.001);
  v[axis] = 1;
  const norm = Math.hypot(...v);
  return v.map((x) => x / norm);
}

describe("vector storage", () => {
  let t: ReturnType<typeof tempContext>;
  beforeEach(() => {
    t = tempContext();
  });
  afterEach(() => t.dispose());

  it("stores embeddings for pending chunks and finds nearest recipes", () => {
    saveRecipe(t.ctx, harissaChicken);
    saveRecipe(t.ctx, mushroomRisotto);
    const pending = t.ctx.store.pendingChunks(100);
    expect(pending.length).toBe(6);

    const chicken = t.ctx.store.getRecipe("harissa-chicken-traybake");
    const rows = pending.map((p, i) => ({
      id: p.id,
      embedding: vec(t.ctx.store.dims, p.text.includes("chicken") ? 0 : 1 + i),
    }));
    t.ctx.store.storeEmbeddings(rows);

    const stats = t.ctx.store.stats();
    expect(stats.vectors).toBe(6);
    expect(stats.chunks_pending).toBe(0);

    const hits = t.ctx.store.searchVector(vec(t.ctx.store.dims, 0), 5);
    expect(hits[0]?.recipe_id).toBe(chicken?.id);
  });

  it("keeps vectors of unchanged chunks when a recipe is re-saved", () => {
    const first = saveRecipe(t.ctx, harissaChicken);
    if (!first.saved) throw new Error("not saved");
    t.ctx.store.storeEmbeddings(
      t.ctx.store
        .pendingChunks(100)
        .map((p) => ({ id: p.id, embedding: vec(t.ctx.store.dims, 0) })),
    );
    // Change only the method: title and ingredient chunks keep their vectors.
    saveRecipe(t.ctx, { ...harissaChicken, slug: first.slug, steps: ["Just roast it."] });
    const stats = t.ctx.store.stats();
    expect(stats.vectors).toBe(2);
    expect(stats.chunks_pending).toBe(1);
  });
});
