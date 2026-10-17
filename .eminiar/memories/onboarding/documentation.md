---
name: onboarding/documentation
kind: onboarding
tags: [onboarding, docs]
related: []
created: 2026-10-17T15:50:08.006Z
updated: 2026-10-17T15:50:08.006Z
---

# pantrybase — documentation sources

Rule: `em_docs {action: "lookup", query}` **before** WebFetch/WebSearch for anything the project depends on. Manifest: `.eminiar/docs.json` (committed). Refresh with `em_docs {action: "sync"}`.

Registered sources (2026-10-17):
- `mcp-typescript-sdk` — @modelcontextprotocol/sdk: `McpServer`, `registerTool`, `StdioServerTransport`, content blocks incl. `{type:"image", data, mimeType}` (modelcontextprotocol.io + typescript-sdk README). Core of `src/server.ts` and every `pb_*` tool.
- `claude-code-plugins` — code.claude.com plugin docs: `.claude-plugin/plugin.json` & `marketplace.json`, `mcpServers` with `${CLAUDE_PLUGIN_ROOT}`, skills, `claude plugin validate|marketplace add|install`. Governs the `pantrybase install` flow.
- `sqlite-vec` — vec0 virtual tables, `MATCH … k=` KNN, `vec_version()`, loading into better-sqlite3 (alexgarcia.xyz API reference).
- `better-sqlite3` — Database/prepare/transaction/pragma API (WiseLibs docs/api.md).
- `transformers-js` — @huggingface/transformers: `pipeline("feature-extraction")`, `dtype`, `env.cacheDir`, pooling/normalize options for bge-small embeddings.
- `sigma-js` and `graphology` — the web UI graph explorer: Sigma WebGL renderer, graphology graph model + `graphology-layout-forceatlas2`.

Local docs/specs: none yet (empty repo). When a README, ADRs or an API description for `/api/*` exist, register them with `em_docs {action: "add", pick: "local"}`.

Third-party services/APIs: none — pantrybase is fully local (no Anthropic API key; Claude acts through the MCP). The only external network use is the one-time Hugging Face model download (`Xenova/bge-small-en-v1.5`, ~34 MB) at install.

Not registered on purpose (add on demand with `em_docs add provider:npm:<pkg>`): preact, vite/@preact/preset-vite, biome, tsup, vitest, zod, sharp, yaml. A living reference implementation of nearly every pattern is eminiar's bundled build at `~/.eminiar/plugin/node_modules/eminiar/` (`dist/` keeps `// src/...` markers).
