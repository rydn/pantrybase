import type { RecipeInput } from "../../src/recipes/schema.js";

/**
 * Condensed transcriptions of real UCOOK cards, shaped as Claude sends them when following
 * providers/ucook/guide.md. They include the awkward bits on purpose: brands, composite
 * lines, equipment under "From Your Kitchen", both allergen wordings, glare, a missing back.
 */

/** Complete card (newer design). */
export const cosyPotatoes: RecipeInput = {
  title: "Cosy Potatoes & Crispy Cannellini Beans",
  subtitle: "with spinach & piquanté peppers",
  description:
    "Say hello to the warming, vibrant flavours of North Africa! These epic baby potatoes are infused with harissa and crisped to perfection.",
  blurb:
    "Harissa-crisped baby potatoes and roasted cannellini beans on lemony spinach with a date salsa and minty cashew dressing. A warming, zesty plant-based traybake.",
  servings: 2,
  time: { active: 25, total: 45 },
  source: { kind: "card" },
  provider: {
    id: "ucook",
    plan: "Veggie",
    chef: "Kate Gomba",
    eat_within_days: 4,
    wine: { producer: "Neil Ellis Wines", name: "West Coast Sauvignon Blanc", vintage: 2023 },
  },
  tags: {
    protein: ["legumes"],
    cuisine: ["North African"],
    dish: ["traybake"],
    starch: ["potato"],
    flavor: ["spicy", "zesty"],
    texture: ["crispy", "creamy"],
    season: ["warming"],
    meal: ["dinner"],
  },
  allergens: ["Allium", "Sulphites", "Tree Nuts"],
  nutrition: {
    basis: "per_100g",
    energy_kj: 330,
    energy_kcal: 79,
    protein_g: 2.6,
    carbs_g: 14,
    sugars_g: 4.3,
    fibre_g: 2.7,
    fat_g: 1.6,
    saturated_g: 0.2,
    sodium_mg: 202,
  },
  ingredients: [
    {
      raw: "500g Baby Potatoes",
      canonical: "baby potatoes",
      qty: 500,
      unit: "g",
      prep: "rinse & halve",
      source: "box",
    },
    {
      raw: "240g Cannellini Beans",
      canonical: "cannellini beans",
      qty: 240,
      unit: "g",
      prep: "drain & rinse",
      source: "box",
    },
    {
      raw: "40ml Pesto Princess Harissa Paste",
      canonical: "pesto princess harissa paste",
      qty: 40,
      unit: "ml",
      source: "box",
    },
    {
      raw: "100g Cucumber",
      canonical: "cucumber",
      qty: 100,
      unit: "g",
      prep: "rinse & finely dice",
      source: "box",
    },
    {
      raw: "40g Piquanté Peppers",
      canonical: "piquante peppers",
      qty: 40,
      unit: "g",
      prep: "drain",
      source: "box",
    },
    {
      raw: "50g Pitted Dates",
      canonical: "pitted dates",
      qty: 50,
      unit: "g",
      prep: "roughly chop",
      source: "box",
    },
    {
      raw: "80ml Cashew Nut Cream Cheese",
      canonical: "cashew cream cheese",
      qty: 80,
      unit: "ml",
      source: "box",
    },
    {
      raw: "150g Spinach",
      canonical: "spinach",
      qty: 150,
      unit: "g",
      prep: "rinse & roughly shred",
      source: "box",
    },
    {
      raw: "Oil (cooking, olive or coconut)",
      canonical: "vegetable oil",
      alternatives: ["olive oil", "coconut oil"],
      source: "kitchen",
    },
    { raw: "Salt", canonical: "salt", source: "kitchen" },
    {
      raw: "Milk or Milk Alternative (optional)",
      canonical: "milk",
      optional: true,
      alternatives: ["plant milk"],
      source: "kitchen",
    },
    { raw: "Paper Towel", canonical: "paper towel", source: "kitchen" },
  ],
  steps: [
    {
      title: "Off you go!",
      text: "Preheat the oven to 200°C. Spread the halved baby potatoes on a roasting tray, coat in oil and season. Roast until crispy, 25-30 minutes.",
      techniques: ["roasting"],
      uses: ["baby potatoes", "vegetable oil"],
      equipment: ["oven", "roasting tray"],
      temp_c: 200,
      minutes: [25, 30],
    },
    {
      title: "Harissa & cannellini",
      text: "Coat the potatoes in the harissa oil, scatter over the beans and return to the oven until crispy, 10-15 minutes.",
      techniques: ["roast"],
      uses: ["harissa paste", "cannellini beans"],
      minutes: [10, 15],
    },
    {
      title: "Sauté away",
      text: "Sauté the shredded spinach in a pan until wilted, 4-5 minutes. Add lemon and season.",
      techniques: ["sauteed"],
      uses: ["spinach", "lemon"],
      equipment: ["pan"],
      minutes: [4, 5],
    },
  ],
  extraction: {
    confidence: 0.95,
    images: [
      { file: "IMG_20261017_181738810.jpg", side: "front" },
      { file: "IMG_20261017_181742596.jpg", side: "back" },
    ],
  },
};

/** Older card design: "Dairy", "Cook within", Chef's Tip, grill instead of a temperature. */
export const bakedRavioli: RecipeInput = {
  title: "Bubbling Baked Ravioli",
  subtitle: "with fresh oregano & Italian-style hard cheese",
  description:
    "A beautiful baked ravioli with a creamy tomato sauce, crunchy topping, fresh oregano and Italian-style cheese.",
  blurb:
    "Butternut and ricotta ravioli baked in a creamy tomato sauce under a cheesy crumb, with a spinach salad. Comforting Italian weeknight bake.",
  servings: 2,
  time: { active: 20, total: 40 },
  source: { kind: "card" },
  provider: { id: "ucook", plan: "Veggie", chef: "Thea Richter", eat_within_days: 3 },
  tags: {
    protein: ["cheese"],
    cuisine: ["italian"],
    dish: ["ravioli"],
    starch: ["pasta"],
    flavor: ["cheesy"],
    texture: ["crunchy"],
  },
  allergens: ["Egg", "Gluten", "Dairy", "Allium", "Wheat"],
  ingredients: [
    {
      raw: "300g Butternut & Ricotta Ravioli",
      canonical: "butternut ricotta ravioli",
      qty: 300,
      unit: "g",
      source: "box",
    },
    {
      raw: "60g Italian-style Hard Cheese",
      canonical: "parmesan",
      qty: 60,
      unit: "g",
      prep: "½ grated & ½ peeled into ribbons",
      source: "box",
    },
    {
      raw: "100ml Panko Breadcrumbs",
      canonical: "panko breadcrumbs",
      qty: 100,
      unit: "ml",
      source: "box",
    },
    {
      raw: "10ml NOMU Provençal Rub",
      canonical: "nomu provencal rub",
      qty: 10,
      unit: "ml",
      source: "box",
    },
    {
      raw: "200ml Tomato Passata",
      canonical: "tomato passata",
      qty: 200,
      unit: "ml",
      source: "box",
    },
    { raw: "80g Spinach", canonical: "spinach", qty: 80, unit: "g", prep: "rinsed", source: "box" },
    { raw: "Butter", canonical: "butter", source: "kitchen" },
  ],
  steps: [
    {
      title: "Bubbling away",
      text: "Preheat the oven to the grill setting. Cook the ravioli for 2-3 minutes until they float.",
      techniques: ["boil"],
      uses: ["butternut ricotta ravioli"],
      equipment: ["grill", "pot"],
      minutes: [2, 3],
    },
    {
      title: "Crunchy crumb",
      text: "Melt 60g of butter and mix in the grated cheese and breadcrumbs.",
      techniques: ["microwave"],
      uses: ["butter", "parmesan", "panko breadcrumbs"],
    },
    {
      title: "Grill & greens",
      text: "Mix the ravioli into the sauce in an ovenproof dish, top with the crumb and grill for 3-4 minutes.",
      techniques: ["grill"],
      uses: ["butternut ricotta ravioli", "panko breadcrumbs"],
      equipment: ["small ovenproof dish"],
      minutes: [3, 4],
    },
  ],
  tips: ["For the best results, boil the ravioli in batches to avoid crowding the pot."],
};

/** Front photographed without its back. */
export const thaiCurryFrontOnly: RecipeInput = {
  title: "Strandveld's Vegan Thai Green Curry",
  subtitle: "with butternut, pak choi & edamame beans",
  description:
    "Warming notes of Thai green curry paste & fresh ginger sing throughout this dish; from the creamy coconut base dotted with plump edamame beans, pak choi & fragrant pepper strips, to the golden oven-roasted butternut cubes.",
  blurb:
    "Creamy vegan Thai green curry with roasted butternut, pak choi and edamame, finished with cashews and lime. Fragrant and warming.",
  servings: 2,
  time: { active: 35, total: 45 },
  source: { kind: "card" },
  provider: {
    id: "ucook",
    plan: "Veggie",
    chef: "Strandveld Winery",
    wine: { producer: "Strandveld", name: "Adamastor White Blend" },
  },
  tags: {
    diet: ["vegan"],
    cuisine: ["thai"],
    dish: ["curry"],
    starch: ["rice"],
    flavor: ["fragrant"],
  },
  ingredients: [
    { raw: "Thai green curry paste", canonical: "green curry paste" },
    { raw: "Butternut", canonical: "butternut" },
    { raw: "Pak choi", canonical: "pak choi" },
    { raw: "Edamame beans", canonical: "edamame beans" },
  ],
  steps: ["Method not captured — only the front of the card was photographed."],
  extraction: {
    confidence: 0.6,
    needs_review: true,
    uncertain: ["ingredients", "steps", "nutrition", "allergens"],
    images: [{ file: "IMG_20261017_181646269.jpg", side: "front" }],
    notes: "Ingredients inferred from the front description; back of card missing.",
  },
};
