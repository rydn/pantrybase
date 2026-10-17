import { spawn } from "node:child_process";
import { dataPaths, log, packageVersion, resolveProjectRoot } from "./config.js";
import { openContext } from "./core/context.js";
import { Embedder } from "./embeddings/model.js";
import { reconcile } from "./files/reconcile.js";
import type { StepResult } from "./install/claude.js";
import { doctor, install, uninstall } from "./install/install.js";
import { searchRecipes } from "./search/hybrid.js";
import { startUiServer } from "./web/server.js";

const pkg = { version: packageVersion() };

const USAGE = `pantrybase ${pkg.version}

Setup
  pantrybase install [--no-model] [--no-register]
                                  install the Claude Code plugin (stable copy in ~/.pantrybase,
                                  native modules checked, embedding model downloaded, plugin
                                  registered at user scope)
  pantrybase uninstall [--purge]  remove the plugin (--purge also deletes the model cache;
                                  recipes in ./pantrybase are never touched)
  pantrybase doctor               check node, native modules, model, plugin registration

Recipes (in ./pantrybase of the current directory)
  pantrybase rebuild [--full] [--reembed]
                                  re-index recipes/*.md (--full re-parses every file,
                                  --reembed recomputes embeddings)
  pantrybase embed                embed pending chunks now
  pantrybase search <query…>      quick search from the terminal
  pantrybase ui [--port N] [--open]
                                  serve the web UI on 127.0.0.1 (default port 7433)
  pantrybase stats                counts and paths
  pantrybase version
`;

function printSteps(steps: StepResult[]): boolean {
  for (const s of steps) console.log(`${s.ok ? "✔" : "✘"} ${s.step.padEnd(22)} ${s.detail}`);
  return steps.every((s) => s.ok);
}

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case "install": {
      console.log(`Installing pantrybase ${pkg.version}…`);
      const r = install({
        model: !rest.includes("--no-model"),
        register: !rest.includes("--no-register"),
      });
      printSteps(r.steps);
      console.log(
        r.ok
          ? "\nDone. Start a new Claude Code session (or run /reload-plugins) and try /pantrybase:ingest or /pantrybase:cook."
          : "\nSome steps failed — see above, then run `pantrybase doctor`.",
      );
      return r.ok ? 0 : 1;
    }
    case "uninstall": {
      const ok = printSteps(uninstall({ purge: rest.includes("--purge") }));
      return ok ? 0 : 1;
    }
    case "doctor": {
      const root = resolveProjectRoot();
      return printSteps(doctor(root, dataPaths(root).data)) ? 0 : 1;
    }
    case "warm-model": {
      await new Embedder().load();
      return 0;
    }
    case "rebuild": {
      const ctx = openContext(undefined, { reconcile: false });
      const r = reconcile(ctx, {
        full: rest.includes("--full"),
        reembed: rest.includes("--reembed"),
      });
      console.log(JSON.stringify(r, null, 2));
      await ctx.embedQueue.run();
      ctx.close();
      return r.errors.length ? 1 : 0;
    }
    case "embed": {
      const ctx = openContext();
      await ctx.embedQueue.run();
      console.log(JSON.stringify(ctx.store.stats(), null, 2));
      ctx.close();
      return 0;
    }
    case "search": {
      const ctx = openContext();
      if (ctx.embedder) await ctx.embedder.load();
      await ctx.embedQueue.run();
      const res = await searchRecipes(ctx, { query: rest.join(" "), limit: 10 });
      for (const r of res.results) {
        console.log(
          `${(r.score ?? 0).toFixed(4)}  ${r.slug}  — ${r.title}  [${r.matched.join(",")}]`,
        );
      }
      console.log(
        `(${res.results.length} results, vector ${res.vector_used ? "used" : "not used"})`,
      );
      ctx.close();
      return 0;
    }
    case "ui": {
      const portArg = rest.indexOf("--port");
      const ctx = openContext();
      const ui = await startUiServer(ctx, {
        port: portArg >= 0 ? Number(rest[portArg + 1]) : undefined,
        version: pkg.version,
      });
      console.log(`pantrybase UI: ${ui.url}  (data: ${ctx.paths.data}) — Ctrl-C to stop`);
      if (rest.includes("--open")) {
        const opener =
          process.platform === "darwin"
            ? "open"
            : process.platform === "win32"
              ? "start"
              : "xdg-open";
        spawn(opener, [ui.url], { stdio: "ignore", detached: true }).unref();
      }
      await new Promise(() => {});
      return 0;
    }
    case "stats": {
      const ctx = openContext();
      console.log(JSON.stringify({ ...ctx.store.stats(), data_dir: ctx.paths.data }, null, 2));
      ctx.close();
      return 0;
    }
    case "version":
    case "--version":
    case "-v":
      console.log(pkg.version);
      return 0;
    case undefined:
    case "-h":
    case "--help":
    case "help":
      console.log(USAGE);
      return 0;
    default:
      log(`unknown command: ${cmd}`);
      console.log(USAGE);
      return 1;
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (e) => {
    log("fatal:", e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
