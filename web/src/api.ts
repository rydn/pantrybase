import type {
  Facets,
  GraphEdge,
  GraphNode,
  InboxItem,
  Match,
  PantryItem,
  PlanItem,
  PlanSummary,
  PlanView,
  RecipeDetail,
  RecipeSummary,
  ShoppingList,
  Stats,
  Suggestion,
} from "./types";

async function request<T>(
  method: string,
  url: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<T> {
  const init: RequestInit = { method, headers: { ...headers } };
  if (method !== "GET") (init.headers as Record<string, string>)["X-Pantrybase"] = "1";
  if (body instanceof Blob) {
    init.body = body;
  } else if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)["Content-Type"] = "application/json";
  }
  const res = await fetch(url, init);
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `${res.status} ${res.statusText}`);
  return data;
}

const qs = (params: Record<string, string | number | boolean | undefined | null>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params))
    if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
};

export interface Filters {
  tags?: Record<string, string[]>;
  exclude_allergens?: string[];
  max_total_min?: number;
  needs_review?: boolean;
}

const filterParams = (f: Filters) => ({
  tags: f.tags && Object.keys(f.tags).length ? JSON.stringify(f.tags) : undefined,
  exclude_allergens: f.exclude_allergens?.length ? f.exclude_allergens.join(",") : undefined,
  max_total_min: f.max_total_min,
  needs_review: f.needs_review ? "true" : undefined,
});

/** URL for a photo in the data dir; `w` asks the server for a resized JPEG. */
export const fileUrl = (rel: string, w?: number, version?: number) => {
  const q = new URLSearchParams();
  if (w) q.set("w", String(w));
  if (version) q.set("v", String(version)); // changes after a rotation, so browsers refetch
  const s = q.toString();
  return `/api/files/${rel.split("/").map(encodeURIComponent).join("/")}${s ? `?${s}` : ""}`;
};

export const api = {
  stats: () => request<Stats>("GET", "/api/stats"),
  facets: () => request<Facets>("GET", "/api/facets"),
  search: (q: string, f: Filters, limit = 48) =>
    request<{ results: RecipeSummary[]; vector_used: boolean }>(
      "GET",
      `/api/search${qs({ q, limit, ...filterParams(f) })}`,
    ),
  recipe: (slug: string) =>
    request<RecipeDetail>("GET", `/api/recipes/${encodeURIComponent(slug)}`),
  pantry: () => request<PantryItem[]>("GET", "/api/pantry"),
  pantryAdd: (names: string[]) =>
    request<{ pantry: PantryItem[] }>("POST", "/api/pantry", {
      items: names.map((name) => ({ name })),
    }),
  pantryRemove: (names: string[]) =>
    request<{ pantry: PantryItem[] }>("DELETE", "/api/pantry", { names }),
  pantryClear: () => request<{ pantry: PantryItem[] }>("DELETE", "/api/pantry", { all: true }),
  match: (f: Filters & { min_coverage?: number; ingredients?: string[] }) =>
    request<{ results: Match[]; available: number }>(
      "GET",
      `/api/pantry/match${qs({ ...filterParams(f), min_coverage: f.min_coverage, ingredients: f.ingredients?.join(",") })}`,
    ),
  plan: () => request<PlanView>("GET", "/api/plan"),
  planSet: (items: PlanItem[]) => request<PlanView>("PUT", "/api/plan", { items }),
  planSuggest: (
    o: {
      plan: string[];
      seed?: string;
      variety: boolean;
      use_pantry: boolean;
      limit?: number;
    } & Filters,
  ) =>
    request<{ plan: PlanSummary; suggestions: Suggestion[] }>(
      "GET",
      `/api/plan/suggest${qs({ ...filterParams(o), plan: o.plan.join(","), seed: o.seed, variety: o.variety ? undefined : "0", use_pantry: o.use_pantry ? undefined : "0", limit: o.limit ?? 12 })}`,
    ),
  planAutofill: (
    o: { plan: string[]; count: number; variety: boolean; use_pantry: boolean } & Filters,
  ) =>
    request<{ plan: PlanSummary; slugs: string[]; added: Suggestion[] }>(
      "GET",
      `/api/plan/suggest${qs({ ...filterParams(o), plan: o.plan.join(","), auto: o.count, variety: o.variety ? undefined : "0", use_pantry: o.use_pantry ? undefined : "0" })}`,
    ),
  shopping: (body: { items?: PlanItem[]; confirmed?: string[]; out_of?: string[] } = {}) =>
    request<ShoppingList>("POST", "/api/plan/shopping", body),
  ingredients: (q: string) =>
    request<Array<{ canonical: string; recipe_count: number }>>(
      "GET",
      `/api/ingredients${qs({ q, limit: 12 })}`,
    ),
  graph: (o: {
    categories: string[];
    ingredients: boolean;
    min_degree: number;
    cuisine?: string;
    similar?: number;
  }) =>
    request<{ nodes: GraphNode[]; edges: GraphEdge[]; stats: Record<string, number> }>(
      "GET",
      `/api/graph${qs({ categories: o.categories.join(","), ingredients: o.ingredients ? "1" : "0", min_degree: o.min_degree, cuisine: o.cuisine, similar: o.similar })}`,
    ),
  inbox: (status?: string) =>
    request<{ counts: Stats["inbox"]; items: InboxItem[] }>(
      "GET",
      `/api/inbox${qs({ status, limit: 300 })}`,
    ),
  upload: (file: File) =>
    request<{ counts: Stats["inbox"] }>("POST", "/api/inbox/upload", file, {
      "X-Filename": encodeURIComponent(file.name),
    }),
  resolve: (ids: number[], status: "pending" | "skipped" | "failed", reason?: string) =>
    request("POST", "/api/inbox/resolve", { ids, status, reason }),
  rotate: (id: number, degrees: 90 | 180 | 270) =>
    request("POST", "/api/inbox/rotate", { id, degrees }),
};
