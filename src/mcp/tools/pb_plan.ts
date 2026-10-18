import { z } from "zod";
import { getPlan, type PlanItem, savePlan, suggestRecipes } from "../../plan/plan.js";
import { defineTool, errorResult, text } from "../define-tool.js";

export default defineTool({
  name: "pb_plan",
  description:
    "The saved meal plan (shared with the web UI). get: the planned recipes and how much they share. " +
    "set: replace the plan with `slugs`. add / remove: adjust it. clear: empty it. `servings` sets the " +
    "portions wanted per recipe (quantities on the shopping list scale from the recipe's own servings).",
  schema: {
    action: z.enum(["get", "set", "add", "remove", "clear"]),
    slugs: z.array(z.string()).optional(),
    servings: z
      .record(z.string(), z.number().positive())
      .optional()
      .describe("slug → portions wanted, e.g. {'harissa-chicken-traybake': 4}"),
  },
  handler: ({ action, slugs, servings }, ctx) => {
    const current = getPlan(ctx);
    let items: PlanItem[] = current.items;
    if (action === "clear") items = [];
    else if (action === "set") items = (slugs ?? []).map((slug) => ({ slug }));
    else if (action === "add") {
      if (!slugs?.length) return errorResult("slugs required");
      const have = new Set(items.map((i) => i.slug));
      items = [...items, ...slugs.filter((s) => !have.has(s)).map((slug) => ({ slug }))];
    } else if (action === "remove") {
      if (!slugs?.length) return errorResult("slugs required");
      const drop = new Set(slugs);
      items = items.filter((i) => !drop.has(i.slug));
    }
    if (servings) {
      items = items.map((i) => (servings[i.slug] ? { ...i, servings: servings[i.slug] } : i));
    }
    const unknown = (slugs ?? []).filter((s) => !ctx.store.getRecipe(s));
    const saved =
      action === "get" ? current : savePlan(ctx, { items, confirmed: current.confirmed });
    const { plan } = suggestRecipes(ctx, { plan: saved.items.map((i) => i.slug), limit: 1 });
    return text({
      recipes: saved.items.map((i) => ({
        slug: i.slug,
        title: plan.recipes.find((r) => r.slug === i.slug)?.title,
        servings: i.servings ?? undefined,
      })),
      to_buy: plan.to_buy,
      from_pantry: plan.from_pantry,
      shared: plan.shared,
      reuse: plan.reuse,
      confirmed_pantry: saved.confirmed.length ? saved.confirmed : undefined,
      unknown_slugs: unknown.length ? unknown : undefined,
    });
  },
});
