---
name: providers/ucook-card-layout
kind: fact
tags: [ucook, provider, ingest]
related: [file:seed/test_scans]
created: 2026-10-17T16:25:34.294Z
updated: 2026-10-17T16:25:34.294Z
---

UCOOK (South Africa) recipe card layout, from 24 test photos in `seed/test_scans/` (gitignored; 12 recipes, all vegetarian, landscape ~3600×2500 JPEG):

**Front** (photo left, text right): UCOOK logo, title, subtitle "with …", marketing blurb, Hands-on Time, Overall Time, Serves (always 2 so far), Chef (a person or a winery), a plan label ("Veggie", "Quick & Easy" — UCOOK's meal-plan line, not strictly a diet), wine pairing "Producer | Wine name Vintage".
**Back** (NO title): "Ingredients & Prep" (qty, name, orange prep note e.g. "rinse & halve"; composites like "Creamy Pesto 100ml (60ml Pesto Princess Basil Pesto & 40ml Sour Cream)"; brand names NOMU / Pesto Princess / Outcast / Old Stone Mill), "From Your Kitchen" (pantry staples + equipment like Blender, Paper Towel; items marked "(optional)"; "Oil (cooking, olive or coconut)", "Sugar/Sweetener/Honey"), numbered steps each with an orange heading that is often a pun ("WAL STREET", "SO MUSH YUM") so technique must be inferred from the text, optional "Chef's Tip" box (air-fryer alternatives), Nutritional Information **per 100g** (kJ, kcal, protein, carbs, sugars, fibre, fat, saturated, sodium mg), Allergens, "Eat/Cook within N Days".
**Two card generations**: newer says "Cow's Milk", older says "Dairy" and "Cook within", uses past-tense prep ("peeled & grated") and icons beside plan/wine.
**Photo problems seen**: glare hides nutrition values; one back cropped at the right edge (values + "Tree nuts" cut); one front shot twice (different bytes → sha256 dedupe insufficient); one front with no back photographed; files are front-then-back by timestamp but backs can't be matched by title.

How to apply: this drives the `ucook` provider profile (guide + normalisation rules) and the v2 schema (nutrition basis, allergens vocab, pantry vs box source, equipment, step headings vs inferred techniques, per-field uncertainty).
