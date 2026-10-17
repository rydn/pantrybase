import { defineTool, text } from "../define-tool.js";

export default defineTool({
  name: "pb_stats",
  description:
    "Counts of recipes, ingredients, tags, indexed chunks and vectors, plus data paths and model state.",
  schema: {},
  handler: (_args, ctx) => {
    return text({
      ...ctx.store.stats(),
      data_dir: ctx.paths.data,
      embeddings: ctx.embedder ? (ctx.embedder.ready ? "ready" : "not loaded") : "disabled",
    });
  },
});
