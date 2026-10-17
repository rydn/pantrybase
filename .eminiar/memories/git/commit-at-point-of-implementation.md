---
name: git/commit-at-point-of-implementation
kind: preference
tags: [git, preference]
related: []
created: 2026-10-17T16:41:43.108Z
updated: 2026-10-17T16:41:43.108Z
---

Commit as soon as a unit of work is implemented and verified (lint + typecheck + tests pass, and the e2e check where relevant) — don't wait to be asked and don't batch several features into one commit. One focused commit per completed feature, phase or fix.

Why: the user asked (2026-10-17) to "always commit at the point of implementation".

How to apply: after each verified chunk of work, commit immediately with a descriptive conventional message, authored as the user with no Claude attribution (see [[git/commit-as-user-no-claude-attribution]]). Never commit failing or unverified work; never push unless asked.
