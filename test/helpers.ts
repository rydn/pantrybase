import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { type AppContext, openContext } from "../src/core/context.js";
import type { RecipeInput } from "../src/recipes/schema.js";

/** Fresh temp project with embeddings disabled; call `dispose()` when done. */
export function tempContext(): { ctx: AppContext; dispose(): void; root: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pantrybase-test-"));
  const ctx = openContext(root, { embeddings: false });
  return {
    ctx,
    root,
    dispose() {
      ctx.close();
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

export const harissaChicken: RecipeInput = {
  title: "Harissa Chicken Traybake",
  blurb: "One-pan roast chicken thighs with chickpeas and peppers.",
  servings: 2,
  time: { prep: 10, cook: 35 },
  difficulty: "easy",
  source: { kind: "card", ref: "card #412" },
  tags: {
    protein: ["chicken"],
    cuisine: ["north african"],
    starch: ["chickpea"],
    flavor: ["spicy", "smoky"],
    meal: ["dinner"],
    method: ["roast"],
  },
  ingredients: [
    { raw: "4 chicken thighs", canonical: "chicken thigh", qty: 4, unit: "piece" },
    { raw: "1 tbsp harissa paste", canonical: "harissa paste", qty: 1, unit: "tbsp" },
    { raw: "1 tin chickpeas", canonical: "chickpeas", qty: 1, unit: "tin" },
    { raw: "1 red pepper, sliced", canonical: "red pepper", qty: 1, prep: "sliced" },
    { raw: "olive oil", canonical: "olive oil" },
    { raw: "salt", canonical: "salt" },
  ],
  steps: [
    "Preheat the oven to 220C.",
    "Toss the chicken, chickpeas and pepper with harissa and oil.",
    "Roast for 35 minutes until the chicken is golden.",
  ],
  notes: "Serve with yoghurt.",
};

export const mushroomRisotto: RecipeInput = {
  title: "Creamy Mushroom Risotto",
  blurb: "Slow-stirred risotto with chestnut mushrooms and parmesan.",
  servings: 2,
  time: { prep: 10, cook: 30 },
  source: { kind: "card" },
  tags: {
    diet: ["vegetarian"],
    cuisine: ["italian"],
    starch: ["rice"],
    flavor: ["umami"],
    meal: ["dinner"],
  },
  ingredients: [
    { raw: "200g risotto rice", canonical: "risotto rice", qty: 200, unit: "g" },
    { raw: "250g chestnut mushrooms", canonical: "chestnut mushrooms", qty: 250, unit: "g" },
    { raw: "1 onion, diced", canonical: "onion", qty: 1, prep: "diced" },
    { raw: "40g parmesan", canonical: "parmesan", qty: 40, unit: "g" },
    { raw: "vegetable stock", canonical: "vegetable stock" },
    { raw: "butter", canonical: "butter" },
  ],
  steps: [
    "Soften the onion in butter.",
    "Add rice, then stock a ladle at a time.",
    "Stir in mushrooms and parmesan.",
  ],
};
