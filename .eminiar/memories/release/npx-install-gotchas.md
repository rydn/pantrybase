---
name: release/npx-install-gotchas
kind: note
tags: [release, npm, install]
related: [file:.github/workflows/release.yml, file:src/install/install.ts, file:bin/pantrybase]
created: 2026-10-18T20:43:29.511Z
updated: 2026-10-18T20:43:29.511Z
---

Two gotchas when installing a freshly published pantrybase with npx (seen 2026-10-18, v0.3.0):

1. `npx pantrybase@X install` run **inside the pantrybase repo** fails with `sh: pantrybase: command not found`. The repo's own package.json is named `pantrybase`, so npm exec treats the local project as the requested package and finds no bin link. Run it from any other directory (e.g. `cd ~`), or use the dev path `node dist/cli.js install`.
2. Right after a publish, npm's local packument cache can still say the previous version is latest for several minutes (`npm view` and `npx` report "No matching version found"), even though the registry already serves it. Use `npx --yes --prefer-online pantrybase@X install` or wait.

The published tarball itself was correct (bin executable, shebang, `bin` field), so check these two before suspecting the package.
