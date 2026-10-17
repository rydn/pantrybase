---
name: providers/modular-provider-profiles
kind: decision
tags: [provider, architecture]
related: []
created: 2026-10-17T16:25:34.310Z
updated: 2026-10-17T16:25:34.310Z
---

Meal-box support is modular: each provider is a profile (UCOOK first, others later) rather than UCOOK-specific code in the core.

A profile supplies: id/name/country, how to recognise it (logo/text cues), how to tell front from back and pair sides, an extraction guide for Claude (layout → fields), normalisation rules (plan labels → tags, allergen synonyms e.g. "Cow's Milk"/"Dairy" → dairy, brand prefixes to strip from canonical names, pantry-section name, non-food "kitchen" items → equipment), nutrition basis (per_100g vs per_serving), default servings, and extra ingredient aliases. A `generic` profile is the fallback for unknown cards. Core schema stays provider-neutral; provider-specific facts live under `provider: {id, plan, chef, wine, …}`.

Why: user asked (2026-10-17) "make mealbox support modular, start with ucook but in the future have support for others".

How to apply: no `if (provider === "ucook")` in core code; add a provider by adding a profile folder.
