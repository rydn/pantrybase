import type { AppContext } from "../core/context.js";
import type { Recipe } from "../types.js";

export type NodeKind = "recipe" | "ingredient" | "tag";

export interface GraphNode {
  id: string;
  kind: NodeKind;
  label: string;
  /** Tag category, or ingredient category, or the recipe's first cuisine. */
  group: string | null;
  /** Recipes connected to this node (for recipes: number of links). */
  degree: number;
  slug?: string;
  image?: string;
  needs_review?: boolean;
}

export type EdgeKind = "uses" | "tagged" | "derived_from" | "similar" | "parent";

export interface GraphEdge {
  source: string;
  target: string;
  kind: EdgeKind;
  weight?: number;
}

export interface GraphOptions {
  /** Tag/facet categories to include as nodes (default: cuisine, dish, protein, diet, allergen, technique). */
  categories?: string[];
  ingredients?: boolean;
  /** Drop ingredient/tag nodes linked to fewer recipes than this (default 2). */
  min_degree?: number;
  /** Restrict to recipes with one of these cuisines (hierarchy-aware). */
  cuisine?: string;
  /** Add "similar" edges from embeddings (top-k per recipe). */
  similar?: number;
  include_staples?: boolean;
}

export const DEFAULT_CATEGORIES = ["cuisine", "dish", "protein", "diet", "allergen", "technique"];

/** The knowledge graph derived from the relational tables (no separate graph store). */
export function buildGraph(
  ctx: AppContext,
  opts: GraphOptions = {},
): { nodes: GraphNode[]; edges: GraphEdge[]; stats: Record<string, number> } {
  const categories = new Set(opts.categories ?? DEFAULT_CATEGORIES);
  const minDegree = opts.min_degree ?? 2;
  const { recipes, uses, tags } = ctx.store.graphRows();

  let allowed: Set<number> | null = null;
  if (opts.cuisine) {
    const wanted = new Set(ctx.vocab.expand("cuisine", opts.cuisine));
    allowed = new Set(
      tags.filter((t) => t.category === "cuisine" && wanted.has(t.name)).map((t) => t.recipe_id),
    );
  }
  const keep = recipes.filter((r) => !allowed || allowed.has(r.id));
  const keepIds = new Set(keep.map((r) => r.id));
  const bySlug = new Map(keep.map((r) => [r.slug, r]));
  const slugById = new Map(keep.map((r) => [r.id, r.slug]));

  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const docs = new Map<number, Recipe>();
  for (const r of keep) {
    const doc = JSON.parse(r.doc) as Recipe;
    docs.set(r.id, doc);
    nodes.set(`r:${r.slug}`, {
      id: `r:${r.slug}`,
      kind: "recipe",
      label: r.title,
      group: doc.tags.cuisine?.[0] ?? null,
      degree: 0,
      slug: r.slug,
      ...(doc.images[0] ? { image: doc.images[0] } : {}),
      ...(doc.extraction?.needs_review ? { needs_review: true } : {}),
    });
  }

  const linkCount = new Map<string, number>();
  const pending: GraphEdge[] = [];
  if (opts.ingredients !== false) {
    for (const u of uses) {
      if (!keepIds.has(u.recipe_id) || (u.staple && !opts.include_staples)) continue;
      const id = `i:${u.canonical}`;
      if (!nodes.has(id)) {
        nodes.set(id, { id, kind: "ingredient", label: u.canonical, group: u.category, degree: 0 });
      }
      pending.push({ source: `r:${slugById.get(u.recipe_id)}`, target: id, kind: "uses" });
      linkCount.set(id, (linkCount.get(id) ?? 0) + 1);
    }
  }
  for (const t of tags) {
    if (!keepIds.has(t.recipe_id) || !categories.has(t.category)) continue;
    const id = `t:${t.category}:${t.name}`;
    if (!nodes.has(id))
      nodes.set(id, { id, kind: "tag", label: t.name, group: t.category, degree: 0 });
    pending.push({ source: `r:${slugById.get(t.recipe_id)}`, target: id, kind: "tagged" });
    linkCount.set(id, (linkCount.get(id) ?? 0) + 1);
  }

  // Prune rare ingredient/tag nodes so the picture shows structure, not noise.
  for (const [id, n] of nodes) {
    if (n.kind === "recipe") continue;
    n.degree = linkCount.get(id) ?? 0;
    if (n.degree < minDegree) nodes.delete(id);
  }
  for (const e of pending) if (nodes.has(e.source) && nodes.has(e.target)) edges.push(e);

  // Cuisine hierarchy: connect present cuisines to their present parents.
  if (categories.has("cuisine")) {
    for (const n of [...nodes.values()]) {
      if (n.kind !== "tag" || n.group !== "cuisine") continue;
      const parent = ctx.vocab.ancestors("cuisine", n.label)[0];
      if (!parent) continue;
      const pid = `t:cuisine:${parent}`;
      if (!nodes.has(pid))
        nodes.set(pid, { id: pid, kind: "tag", label: parent, group: "cuisine", degree: 0 });
      edges.push({ source: n.id, target: pid, kind: "parent" });
    }
  }

  for (const [id, doc] of docs) {
    const slug = slugById.get(id);
    for (const src of doc.derived_from) {
      if (bySlug.has(src))
        edges.push({ source: `r:${slug}`, target: `r:${src}`, kind: "derived_from" });
    }
  }

  if (opts.similar && opts.similar > 0) {
    const seen = new Set<string>();
    for (const r of keep) {
      for (const s of ctx.store.similarRecipes(r.id, opts.similar)) {
        const other = slugById.get(s.recipe_id);
        if (!other) continue;
        const key = [r.slug, other].sort().join("|");
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push({
          source: `r:${r.slug}`,
          target: `r:${other}`,
          kind: "similar",
          weight: Number((1 - s.distance / 2).toFixed(3)),
        });
      }
    }
  }

  for (const e of edges) {
    const s = nodes.get(e.source);
    if (s?.kind === "recipe") s.degree++;
  }
  const stats: Record<string, number> = {
    recipes: 0,
    ingredients: 0,
    tags: 0,
    edges: edges.length,
  };
  for (const n of nodes.values()) {
    const key = n.kind === "recipe" ? "recipes" : n.kind === "ingredient" ? "ingredients" : "tags";
    stats[key] = (stats[key] ?? 0) + 1;
  }
  return { nodes: [...nodes.values()], edges, stats };
}
