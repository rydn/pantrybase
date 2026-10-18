import { z } from "zod";
import { renderShoppingList, shoppingList } from "../../plan/plan.js";
import { defineTool, text } from "../define-tool.js";

export default defineTool({
  name: "pb_plan_shopping_list",
  description:
    "Grocery list for the saved plan (or `slugs`): distinct items to buy with merged quantities, grouped by " +
    "aisle, each with the recipes that use it. `pantry_check` lists the pantry items the plan relies on — " +
    "ask the user to confirm those are really there before the list is final; pass the ones they confirm as " +
    "`confirmed` and the ones they're out of as `out_of` (those leave the pantry and move onto the list). " +
    "`needs_confirmation` is empty once everything is settled. Staples (salt, oil…) are listed separately.",
  schema: {
    slugs: z.array(z.string()).optional().describe("defaults to the saved plan"),
    servings: z
      .record(z.string(), z.number().positive())
      .optional()
      .describe("slug → portions wanted; scales quantities"),
    confirmed: z.array(z.string()).optional().describe("pantry items the user confirmed"),
    out_of: z.array(z.string()).optional().describe("pantry items the user is out of"),
    format: z.enum(["json", "text"]).optional().describe("default json; text is paste-ready"),
  },
  handler: ({ slugs, servings, confirmed, out_of, format }, ctx) => {
    const items = slugs?.map((slug) => ({ slug, servings: servings?.[slug] ?? null }));
    const list = shoppingList(ctx, { items, confirmed, out_of });
    if (format === "text") return text(renderShoppingList(list));
    return text({
      recipes: list.recipes.map((r) => ({
        title: r.title,
        servings: r.servings ?? undefined,
        scaled: r.scale !== 1 ? `×${Math.round(r.scale * 100) / 100}` : undefined,
      })),
      buy: list.buy.map((l) => ({
        item: l.canonical,
        amount: l.amount ?? undefined,
        aisle: l.aisle,
        for: l.for,
      })),
      pantry_check: list.pantry_check.map((c) => ({
        item: c.canonical,
        amount: c.amount ?? undefined,
        in_pantry: c.in_pantry ?? undefined,
        for: c.for,
        confirmed: c.confirmed,
      })),
      needs_confirmation: list.needs_confirmation.length ? list.needs_confirmation : undefined,
      optional: list.optional.length ? list.optional.map((l) => l.canonical) : undefined,
      staples: list.staples,
      summary: {
        to_buy: list.summary.to_buy,
        from_pantry: list.summary.from_pantry,
        shared: list.summary.shared,
        reuse: list.summary.reuse,
      },
      removed_from_pantry: list.removed_from_pantry.length ? list.removed_from_pantry : undefined,
      unknown_slugs: list.unknown_slugs.length ? list.unknown_slugs : undefined,
    });
  },
});
