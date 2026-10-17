import { createRequire } from "node:module";
import { log } from "./config.js";
import { openContext } from "./core/context.js";
import { reconcile } from "./files/reconcile.js";
import { searchRecipes } from "./search/hybrid.js";

const pkg = createRequire(import.meta.url)("../package.json") as { version: string };

const USAGE = `pantrybase ${pkg.version}

  pantrybase rebuild [--full]     re-index ./pantrybase/recipes/*.md
  pantrybase embed                embed pending chunks now (downloads the model if needed)
  pantrybase search <query…>      quick search from the terminal
  pantrybase stats                counts and paths
`;

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case "rebuild": {
      const ctx = openContext(undefined, { reconcile: false });
      const r = reconcile(ctx, { full: rest.includes("--full") });
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
    case "stats": {
      const ctx = openContext();
      console.log(JSON.stringify({ ...ctx.store.stats(), data_dir: ctx.paths.data }, null, 2));
      ctx.close();
      return 0;
    }
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
    log("fatal:", e);
    process.exit(1);
  },
);
