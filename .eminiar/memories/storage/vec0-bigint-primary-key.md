---
name: storage/vec0-bigint-primary-key
kind: constraint
tags: [sqlite-vec, gotcha]
related: [file:src/storage/sqlite/adapter.ts, file:test/integration/vectors.test.ts]
created: 2026-10-17T16:09:54.120Z
updated: 2026-10-17T16:09:54.120Z
---

sqlite-vec `vec0` tables reject non-integer primary keys ("Only integers are allows for primary key values"), and better-sqlite3 binds plain JS numbers as REAL. Always bind `chunk_id` as a BigInt when INSERTing into `chunk_vec` (`BigInt(id)` / `BigInt(info.lastInsertRowid)`). DELETE/SELECT with a number works fine.

Why: Phase 1 shipped with `Number(...)`; unit tests passed because they ran with embeddings disabled, but every real `storeEmbeddings` call failed silently in the background queue (vectors stayed 0 while search reported vector_used:true). Found only by the stdio end-to-end run. `test/integration/vectors.test.ts` now covers it with synthetic vectors.

How to apply: any new code writing to a vec0 table uses BigInt keys; keep a synthetic-vector test for any new vector table.
