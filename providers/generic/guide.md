# Generic recipe extraction guide

Use this for cards, printouts, cookbook pages or screenshots from a provider without a profile. Save with `provider: {id: "generic", name: "<provider name if printed>"}`, or leave `provider` out for personal recipes.

- `title` and `subtitle` as printed; `description` is any intro paragraph, transcribed.
- `servings`; `time.active` (hands-on), `time.total`, or `time.prep`/`time.cook` as printed, in minutes.
- `ingredients[]`: `raw` as printed, `canonical` as a generic singular name without brands (put the brand in `brand`), `qty`/`unit`/`prep`. Mark things you're told to have at home as `source: "kitchen"` and the rest `source: "box"` (or leave it out). Note optional items and alternatives.
- `steps[]`: `text` per step, plus a `title` if the step has a heading; infer `techniques`, `uses` (canonical ingredient names), `equipment`, `temp_c` and `minutes` ([min, max]).
- `nutrition` only if printed; say whether it is `per_serving` or `per_100g`.
- `allergens` as printed. Tips or variations go in `tips[]`.
- Tags: protein, diet, cuisine (most specific), dish, starch, flavor, texture, method, meal, season.
- `blurb`: 1–2 sentences in your own words about what the dish is, how it tastes and when you'd want it.
- Put anything unreadable in `extraction.uncertain`, set `extraction.needs_review` when a key part is missing, and never guess numbers.
