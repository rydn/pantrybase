import type { ToolDef } from "../define-tool.js";
import pb_get_recipe from "./pb_get_recipe.js";
import pb_list_tags from "./pb_list_tags.js";
import pb_providers from "./pb_providers.js";
import pb_rebuild from "./pb_rebuild.js";
import pb_save_recipe from "./pb_save_recipe.js";
import pb_search from "./pb_search.js";
import pb_stats from "./pb_stats.js";

export const tools: ToolDef[] = [
  pb_save_recipe,
  pb_get_recipe,
  pb_search,
  pb_list_tags,
  pb_providers,
  pb_stats,
  pb_rebuild,
] as unknown as ToolDef[];
