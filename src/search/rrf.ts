import type { SearchHit } from "../types.js";

export interface RankedList {
  name: string;
  weight: number;
  hits: SearchHit[];
}

export interface Fused {
  recipe_id: number;
  slug: string;
  score: number;
  sources: string[];
}

const K = 60;

/** Weighted reciprocal-rank fusion: score = Σ weight / (K + rank + 1). */
export function fuseRrf(lists: RankedList[]): Fused[] {
  const acc = new Map<number, Fused>();
  for (const list of lists) {
    list.hits.forEach((hit, rank) => {
      const cur = acc.get(hit.recipe_id) ?? {
        recipe_id: hit.recipe_id,
        slug: hit.slug,
        score: 0,
        sources: [],
      };
      cur.score += list.weight / (K + rank + 1);
      if (!cur.sources.includes(list.name)) cur.sources.push(list.name);
      acc.set(hit.recipe_id, cur);
    });
  }
  return [...acc.values()].sort((a, b) => b.score - a.score);
}
