import { z } from "zod";
import { autofillPlan, suggestRecipes } from "../../plan/plan.js";
import { ALL_CATEGORIES } from "../../types.js";
import { defineTool, text } from "../define-tool.js";

export default defineTool({
  name: "pb_plan_suggest",
  description:
    "Meal planning around shared ingredients. Given a seed recipe and/or the current plan, ranks recipes by how " +
    "much of their shopping is already covered — `shares` (already on the list for another planned recipe), " +
    "`from_pantry`, and `new` (what they would add). `reuse` is the covered share (0–1), weighted so fresh " +
    "items count more than dry goods. Repeating a planned dish is penalised unless variety:false. " +
    "With `auto: n` it instead fills the plan with n more recipes that minimise the whole list (beam search) " +
    "and returns the resulting slugs — save them with pb_plan. Nothing is saved by this tool.",
  schema: {
    seed: z.string().optional().describe("recipe slug to plan around"),
    plan: z
      .array(z.string())
      .optional()
      .describe("slugs already planned; defaults to the saved plan"),
    auto: z.number().int().min(1).max(14).optional().describe("fill the plan with this many more"),
    limit: z.number().int().min(1).max(50).optional().describe("default 8"),
    variety: z.boolean().optional().describe("default true"),
    use_pantry: z.boolean().optional().describe("default true"),
    tags: z.partialRecord(z.enum(ALL_CATEGORIES), z.array(z.string())).optional(),
    exclude_allergens: z.array(z.string()).optional(),
    exclude_ingredients: z.array(z.string()).optional(),
    max_total_min: z.number().optional(),
  },
  handler: ({ seed, plan, auto, limit, variety, use_pantry, ...filters }, ctx) => {
    if (auto) {
      const r = autofillPlan(ctx, { seed, plan, count: auto, variety, use_pantry, filters });
      return text({
        plan_slugs: r.slugs,
        added: r.added.map((s) => ({
          slug: s.slug,
          title: s.title,
          reuse: s.reuse,
          shares: s.shares,
          from_pantry: s.from_pantry,
          new: s.new,
          repeats: s.repeats,
        })),
        summary: r.plan,
        unknown_slugs: r.unknown_slugs.length ? r.unknown_slugs : undefined,
        next: "Show the user the plan; when they agree, pb_plan {action:'set', slugs: plan_slugs}.",
      });
    }
    const r = suggestRecipes(ctx, { seed, plan, limit: limit ?? 8, variety, use_pantry, filters });
    return text({
      plan: r.plan,
      suggestions: r.suggestions.map((s) => ({
        slug: s.slug,
        title: s.title,
        total_min: s.total_min ?? undefined,
        reuse: s.reuse,
        shares: s.shares,
        from_pantry: s.from_pantry,
        new: s.new,
        repeats: s.repeats,
      })),
      unknown_slugs: r.unknown_slugs.length ? r.unknown_slugs : undefined,
    });
  },
});
