import path from "node:path";
import { describe, expect, it } from "vitest";
import { packageRoot } from "../../src/config.js";
import { normalizeTagValue, Vocabulary } from "../../src/vocabulary/vocabulary.js";

const vocab = Vocabulary.fromFile(path.join(packageRoot, "seed", "vocabulary.yaml"));

describe("vocabulary", () => {
  it("normalises values to kebab-case", () => {
    expect(normalizeTagValue("Cow's Milk")).toBe("cows-milk");
    expect(normalizeTagValue("North  African")).toBe("north-african");
    expect(normalizeTagValue("Sauté")).toBe("saute");
  });

  it("maps synonyms onto vocabulary values", () => {
    const r = vocab.normalize("diet", ["Veggie", "plant-based"]);
    expect(r.values).toEqual(["vegetarian", "vegan"]);
    expect(r.mapped).toEqual([
      { from: "Veggie", to: "vegetarian" },
      { from: "plant-based", to: "vegan" },
    ]);
    expect(vocab.normalize("allergen", ["Cow's Milk", "Dairy", "Tree Nuts"]).values).toEqual([
      "dairy",
      "tree-nuts",
    ]);
  });

  it("reports values outside the vocabulary", () => {
    expect(vocab.normalize("dish", ["sushi-burrito"]).unknown).toEqual(["sushi-burrito"]);
    expect(vocab.mode("dish")).toBe("closed");
    expect(vocab.mode("flavor")).toBe("open");
  });

  it("expands hierarchies downwards and walks ancestors upwards", () => {
    const asian = vocab.expand("cuisine", "asian");
    expect(asian).toEqual(expect.arrayContaining(["asian", "southeast-asian", "thai", "korean"]));
    expect(asian).not.toContain("italian");
    expect(vocab.ancestors("cuisine", "thai")).toEqual(["southeast-asian", "asian"]);
  });

  it("accepts extra synonyms from provider profiles", () => {
    const v = Vocabulary.fromFile(path.join(packageRoot, "seed", "vocabulary.yaml"));
    v.addSynonyms("allergen", { "Lupine Flour": "lupin" });
    expect(v.resolve("allergen", "lupine flour")).toEqual({ value: "lupin", known: true });
  });
});
