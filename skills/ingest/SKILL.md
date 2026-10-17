---
name: ingest
description: Capture recipe card photos into the pantrybase knowledge base — import a folder of photos, read each card (front and back), extract the full structured recipe with tags, nutrition and allergens, and save it. Use when the user wants to add, scan, import or process recipe cards or photos, or asks to continue or check progress on ingestion.
---

# Ingest recipe cards

You turn photos in `pantrybase/inbox/` into recipes. The queue is on disk, so ingestion can stop at any point and resume later, even in a new session — just start again from step 2.

## 1. Get the photos in (if they aren't already)

- If the user names a folder or files: `pb_ingest_source {paths: [...]}`. Originals are copied, never moved; photos already known are skipped.
- Photos dropped straight into `pantrybase/inbox/`, or uploaded in the web UI, are picked up automatically.

## 2. Prepare once per session

1. `pb_inbox_next {window: 4}` — look at `progress` to see how much is left. If `done: true`, report and stop.
2. Look at the first photo with `pb_inbox_image {id}` and identify the provider from the logo/footer. Then `pb_providers {id: "<provider>"}` (or `"generic"`) and follow that guide for every card. Read it once, not per card.
3. `pb_list_tags {vocabulary: true}` once, so you reuse existing tag values instead of inventing near-duplicates.

## 3. Loop, one card at a time

1. `pb_inbox_next {window: 4}` gives the next photos in capture order.
2. If a photo has a `rotation_hint`, or shows up sideways or upside down, turn it upright first with `pb_inbox_rotate {id, degrees}` (clockwise: text reading bottom-to-top → 90, upside down → 180, top-to-bottom → 270) and view it again. Never transcribe a sideways photo.
3. View them in order with `pb_inbox_image`. Group the photos that belong to one card: usually a front (title, photo) followed by its back (ingredients, steps, nutrition — no title). Match a back to its front by order and by ingredients that echo the front's subtitle and description.
   - `retake_of` means a near-identical photo of the same side: use the clearer one as the main image and attach the other with the same side, or skip it.
   - If small print is unreadable, request `pb_inbox_image {id, max_px: 2400}` before giving up on a field.
4. Extract everything the guide asks for and call `pb_save_recipe` with `provider`, `source: {kind: "card"}`, the full structured record, your own `blurb`, and `ingest: [{id, side}]` listing **every** photo of the card.
5. Handle the response:
   - `saved: true` — note the slug and move on. Glance at `vocabulary.rejected` and `unmatched_uses`; fix only clear mistakes (re-save with `slug`).
   - `duplicate_of` — compare with that recipe (`pb_get_recipe`). Same card → attach the photos to it (`pb_save_recipe` with its `slug`, the same data and `ingest`) or `pb_inbox_resolve {status: "skipped", reason: "duplicate of <slug>"}`. Genuinely different → re-save with `allow_duplicate: true`.
   - `already_ingested` — the photos were saved before; continue.
   - `error` — read it; usually a photo id is wrong or already attached elsewhere.
6. Photos that aren't recipe cards → `skipped` with a reason. Photos you cannot read at all → `failed` with what's wrong ("back too blurry to read steps") so the user can re-shoot them.
7. A front whose back is missing: save what the front gives with `extraction.needs_review: true` and list the missing parts in `extraction.uncertain`. Don't hold up the batch waiting for it.

## Rules

- Never guess numbers (quantities, nutrition, times). Unreadable → null + `extraction.uncertain`.
- Don't echo extracted recipes into the conversation; the record is in the file. Report progress briefly every ~10 cards: done / remaining / flagged for review.
- Keep going until `pb_inbox_next` reports `done: true` or the user stops you. At the end, summarise: cards saved, photos skipped or failed (with reasons), recipes needing review (`pb_search {needs_review: true}`).
