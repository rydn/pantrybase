import { z } from "zod";
import { addToPantry, listPantry, removeFromPantry } from "../../pantry/pantry.js";
import { defineTool, text } from "../define-tool.js";

export const pb_pantry_list = defineTool({
  name: "pb_pantry_list",
  description:
    "What's in the pantry: canonical ingredient names with optional quantity, unit and note.",
  schema: {},
  handler: (_args, ctx) => {
    const items = listPantry(ctx);
    return text({
      count: items.length,
      items: items.map((p) => ({
        name: p.canonical,
        qty: p.qty ?? undefined,
        unit: p.unit ?? undefined,
        note: p.note ?? undefined,
      })),
    });
  },
});

export const pb_pantry_add = defineTool({
  name: "pb_pantry_add",
  description:
    "Add items to the pantry (or update their quantity). Names are matched to the ingredient catalog " +
    "(aliases, plurals and regional names: 'eggs', 'baby marrow', 'spring onions'); unknown names become new ingredients.",
  schema: {
    items: z
      .array(
        z.object({
          name: z.string().min(1),
          qty: z.number().nullable().optional(),
          unit: z.string().nullable().optional(),
          note: z.string().nullable().optional(),
        }),
      )
      .min(1),
  },
  handler: ({ items }, ctx) =>
    text({ added: addToPantry(ctx, items), total: listPantry(ctx).length }),
});

export const pb_pantry_remove = defineTool({
  name: "pb_pantry_remove",
  description: "Remove items from the pantry by name, or everything with all:true.",
  schema: {
    names: z.array(z.string()).optional(),
    all: z.boolean().optional(),
  },
  handler: ({ names, all }, ctx) => {
    if (all) return text({ cleared: ctx.store.pantryClear() });
    return text({ ...removeFromPantry(ctx, names ?? []), total: listPantry(ctx).length });
  },
});
