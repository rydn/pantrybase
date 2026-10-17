import type { ToolDef } from "../define-tool.js";
import pb_get_recipe from "./pb_get_recipe.js";
import pb_inbox_image from "./pb_inbox_image.js";
import pb_inbox_list from "./pb_inbox_list.js";
import pb_inbox_next from "./pb_inbox_next.js";
import pb_inbox_resolve from "./pb_inbox_resolve.js";
import pb_ingest_source from "./pb_ingest_source.js";
import pb_list_tags from "./pb_list_tags.js";
import pb_merge_ingredients from "./pb_merge_ingredients.js";
import { pb_pantry_add, pb_pantry_list, pb_pantry_remove } from "./pb_pantry.js";
import pb_pantry_match from "./pb_pantry_match.js";
import pb_providers from "./pb_providers.js";
import pb_rebuild from "./pb_rebuild.js";
import pb_save_recipe from "./pb_save_recipe.js";
import pb_search from "./pb_search.js";
import pb_stats from "./pb_stats.js";
import pb_synthesis_context from "./pb_synthesis_context.js";

export const tools: ToolDef[] = [
  // find and cook
  pb_search,
  pb_get_recipe,
  pb_pantry_match,
  pb_synthesis_context,
  pb_list_tags,
  // pantry
  pb_pantry_list,
  pb_pantry_add,
  pb_pantry_remove,
  // capture
  pb_providers,
  pb_ingest_source,
  pb_inbox_next,
  pb_inbox_image,
  pb_inbox_resolve,
  pb_inbox_list,
  pb_save_recipe,
  // maintenance
  pb_merge_ingredients,
  pb_stats,
  pb_rebuild,
] as unknown as ToolDef[];
