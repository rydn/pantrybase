import { z } from "zod";
import { defineTool, errorResult, text } from "../define-tool.js";

export default defineTool({
  name: "pb_providers",
  description:
    "Meal-box provider profiles. Without `id`: list them (id, name, how to recognise a card). With `id`: the extraction " +
    "guide for that provider's cards plus the tag vocabulary — read it once before extracting a batch of cards.",
  schema: {
    id: z.string().optional().describe('e.g. "ucook"; "generic" for anything else'),
  },
  handler: ({ id }, ctx) => {
    if (!id) {
      return text(
        ctx.providers.list().map((p) => ({
          id: p.id,
          name: p.name,
          country: p.country,
          recognise: p.recognise,
        })),
      );
    }
    const p = ctx.providers.get(id);
    if (!p)
      return errorResult(
        `no provider "${id}"; known: ${ctx.providers
          .list()
          .map((x) => x.id)
          .join(", ")}`,
      );
    const summary = ctx.vocab.summary(25);
    return text(
      [
        p.guide.trim(),
        "",
        "## Server-side rules (applied automatically on save)",
        `- Plan labels → tags: ${JSON.stringify(p.plan_labels)}`,
        `- Brands stripped from canonical names: ${p.brands.join(", ") || "none"}`,
        `- Kitchen items treated as equipment: ${Object.keys(p.equipment_terms).join(", ") || "none"}`,
        `- Nutrition basis default: ${p.nutrition_basis}; default servings: ${p.default_servings ?? "none"}`,
        "",
        "## Tag vocabulary (closed = only these values; open = top values, new ones allowed)",
        ...Object.entries(summary).map(
          ([cat, v]) => `- ${cat} (${v.mode}): ${v.values.join(", ")}`,
        ),
      ].join("\n"),
    );
  },
});
