# UCOOK card extraction guide

UCOOK (South Africa) cards are landscape, two-sided. Read every photo of a card before saving. A card photo that is taller than it is wide, or whose text runs sideways or upside down, needs `pb_inbox_rotate` (clockwise degrees) before you read it. Save with `provider: {id: "ucook", …}` and `source: {kind: "card"}`.

## Front (photo left, text panel right)

| Card text | Field |
|---|---|
| Large title | `title` |
| "with …" line under the title | `subtitle` (keep the "with") |
| Paragraph | `description` — transcribe as printed |
| Hands-on Time | `time.active` (minutes) |
| Overall Time | `time.total` (minutes) |
| Serves: 2 People | `servings` |
| Chef: … | `provider.chef` (may be a person or a winery) |
| Plan line, e.g. "Veggie", "Quick & Easy" | `provider.plan` exactly as printed |
| "Producer \| Wine Name Vintage" | `provider.wine: {producer, name, vintage}` — `name` without the producer prefix where it repeats |

## Back (no title — match it to its front by order and ingredients)

**Ingredients & Prep** → one `ingredients[]` entry per line, `source: "box"`:
- `raw`: quantity + name as printed ("200g Large Pasta Shells").
- `qty`/`unit`: "200g" → 200/g, "20ml" → 20/ml, "1" → 1 with no unit, "½" → 0.5.
- `prep`: the orange italic line ("rinse & roughly shred").
- `canonical`: generic singular name without the brand ("NOMU Cajun Rub" → `cajun rub`, `brand: "NOMU"`).
- Composite lines like "Creamy Pesto (60ml Pesto Princess Basil Pesto & 40ml Sour Cream)": canonical is the composite (`creamy pesto`), with `components[]` for each part.

**From Your Kitchen** → `ingredients[]` with `source: "kitchen"`:
- "Oil (cooking, olive or coconut)" → canonical `vegetable oil`, `alternatives: [olive oil, coconut oil]`.
- "Salt & Pepper" → two entries, `salt` and `black pepper`.
- "Sugar/Sweetener/Honey" → `sugar`, `alternatives: [sweetener, honey]`.
- "(optional)" → `optional: true`. "Milk or Milk Alternative" → `milk`, `alternatives: [plant milk]`.
- Equipment here (Blender, Paper Towel) goes in `equipment`, not ingredients.

**Numbered steps** → `steps[]`, in order:
- `title`: the orange heading as printed, in sentence case ("Wal street"). Headings are often puns, so never treat them as techniques.
- `text`: the full step text.
- `techniques`: infer from the text using the method vocabulary (roast, pan-fry, saute, boil, simmer, toast, blend, pickle, bake, grill…).
- `uses`: canonical names of the ingredients this step uses.
- `equipment`: what the step uses (oven, pan, pot, roasting-tray, blender, ovenproof-dish, kettle, microwave).
- `temp_c`: oven temperature if given. "grill setting or the highest temperature" → equipment `grill`, no temp.
- `minutes`: the cooking time, `[min, max]` for a range ("25-30 minutes" → [25, 30]).

**Chef's Tip** box → `tips[]` (it often gives an air-fryer method; add `air-fryer` to `equipment` only if the tip is the main method).

**Nutritional Information — Per 100g** → `nutrition` with `basis: "per_100g"`: energy_kj, energy_kcal, protein_g, carbs_g, sugars_g ("of which sugars"), fibre_g, fat_g, saturated_g ("of which saturated"), sodium_mg.

**Allergens** → `allergens[]` as printed ("Cow's Milk" and "Dairy" both become `dairy`; the server maps them).

**Eat Within N Days / Cook within N Days** → `provider.eat_within_days`.

## Tags and blurb
- Plan labels map automatically ("Veggie" → diet vegetarian), so add only what you can infer beyond them.
- Infer `tags`: protein (main protein, e.g. legumes, tofu, cheese), cuisine (most specific: "thai" not "asian"), dish, starch, flavor, texture, method, meal, season.
- `diet`: add `vegan` only if no animal products; `vegan-adaptable` if only optional items are animal products.
- `blurb`: 1–2 sentences in your own words describing what the dish is, how it tastes and when you'd want it. It is used for semantic search, so include mood and occasion ("warming", "weeknight").

## Quality
- Glare, smudges, cropping: set unreadable fields to null and list them in `extraction.uncertain` ("nutrition.protein_g", "allergens"). Never guess numbers.
- A front with no back photo: save what the front gives, mark `extraction.needs_review: true` and `uncertain: [ingredients, steps, nutrition, allergens]`.
- Two photos of the same side (retakes): use the clearer one and list both in `extraction.images`.
- Set `extraction.confidence` (0–1) honestly.
