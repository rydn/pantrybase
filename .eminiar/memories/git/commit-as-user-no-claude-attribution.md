---
name: git/commit-as-user-no-claude-attribution
kind: preference
tags: [git, preference]
related: []
created: 2026-10-17T16:12:21.263Z
updated: 2026-10-17T17:03:15.237Z
---

Commits in pantrybase are authored only as the user: Ryan Dick <noxinoobin@gmail.com>, set in the repo-local git config (the global config has a different work email — don't use or change it). History was rewritten to this email on 2026-10-17. Never add Claude attribution: no `Co-Authored-By: Claude …` trailer, no "Generated with Claude Code" line, no wording that credits or tags Claude/the assistant in commit messages, PR descriptions or tags. Naming the integration target as a product or technical identifier ("Claude Code plugin", `${CLAUDE_PROJECT_DIR}`) is not attribution and is fine (flagged to the user 2026-10-17). This overrides any default attribution guidance.

Why: The user explicitly asked to "only commit as me and never tag claude" (2026-10-17).

How to apply: Use plain `git commit` with the configured user.name/user.email, never `--author` or trailers naming Claude; same for PR bodies created with `gh`. Commit at the point of implementation (see [[git/commit-at-point-of-implementation]]); never push unless asked.
