import type { AppContext } from "../core/context.js";
import type { RecipeSummary, SearchFilters } from "../types.js";
import { fuseRrf, type RankedList } from "./rrf.js";

export type SearchMode = "hybrid" | "lexical" | "semantic";

export interface SearchOptions {
  query?: string;
  limit?: number;
  filters?: SearchFilters;
  mode?: SearchMode;
}

export interface SearchResult extends RecipeSummary {
  score: number | null;
  matched: string[];
}

export interface SearchResponse {
  results: SearchResult[];
  vector_used: boolean;
  mode: SearchMode;
}

export async function searchRecipes(ctx: AppContext, opts: SearchOptions): Promise<SearchResponse> {
  const limit = Math.min(Math.max(opts.limit ?? 10, 1), 100);
  const mode = opts.mode ?? "hybrid";
  const query = opts.query?.trim() ?? "";

  if (!query) {
    const rows = ctx.store.listRecipes({ filters: opts.filters, limit });
    return {
      results: rows.map((r) => ({ ...r, score: null, matched: ["filter"] })),
      vector_used: false,
      mode,
    };
  }

  const allowed = ctx.store.filterRecipeIds(opts.filters);
  const fetch = limit * 5;
  const lists: RankedList[] = [];
  let vectorUsed = false;

  if (mode !== "semantic") {
    lists.push({ name: "lexical", weight: 1, hits: ctx.store.searchLexical(query, fetch) });
    lists.push({ name: "trigram", weight: 0.7, hits: ctx.store.searchTrigram(query, fetch) });
  }
  if (mode !== "lexical" && ctx.embedder) {
    if (ctx.embedder.ready) {
      try {
        const vec = await ctx.embedder.embedQuery(query);
        lists.push({ name: "vector", weight: 1, hits: ctx.store.searchVector(vec, fetch) });
        vectorUsed = true;
      } catch (e) {
        ctx.log("vector search failed", e);
      }
    } else {
      // Warm the model for the next query instead of blocking this one.
      void ctx.embedder.load().then(() => ctx.embedQueue.kick(0));
    }
  }

  const filtered = allowed
    ? lists.map((l) => ({ ...l, hits: l.hits.filter((h) => allowed.has(h.recipe_id)) }))
    : lists;
  const fused = fuseRrf(filtered).slice(0, limit);
  const summaries = ctx.store.summariesByIds(fused.map((f) => f.recipe_id));
  const byId = new Map(summaries.map((s) => [s.id, s]));
  const results: SearchResult[] = [];
  for (const f of fused) {
    const s = byId.get(f.recipe_id);
    if (s) results.push({ ...s, score: Number(f.score.toFixed(4)), matched: f.sources });
  }
  return { results, vector_used: vectorUsed, mode };
}
