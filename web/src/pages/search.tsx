import { useEffect, useState } from "preact/hooks";
import { useLocation } from "preact-iso";
import { api, type Filters } from "../api";
import { Chip, Empty, pretty, RecipeCard, useAsync, useDebounced } from "../components";

/** Facet order in the sidebar; allergens are exclusions, the rest are inclusions. */
const FACET_ORDER = [
  "diet",
  "cuisine",
  "dish",
  "protein",
  "starch",
  "flavor",
  "texture",
  "method",
  "meal",
  "time",
  "season",
  "technique",
  "equipment",
  "chef",
  "plan",
  "provider",
];
const TIMES = [0, 20, 30, 45, 60];

/** Filter state lives in the URL so searches are bookmarkable. */
function readState(query: Record<string, string>) {
  let tags: Record<string, string[]> = {};
  try {
    tags = query.tags ? (JSON.parse(query.tags) as Record<string, string[]>) : {};
  } catch {
    tags = {};
  }
  return {
    q: query.q ?? "",
    tags,
    exclude: query.exclude ? query.exclude.split(",") : [],
    max: query.max ? Number(query.max) : 0,
    review: query.review === "1",
  };
}

export function SearchPage() {
  const loc = useLocation();
  const initial = readState(loc.query);
  const [q, setQ] = useState(initial.q);
  const [tags, setTags] = useState(initial.tags);
  const [exclude, setExclude] = useState<string[]>(initial.exclude);
  const [max, setMax] = useState(initial.max);
  const [review, setReview] = useState(initial.review);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const dq = useDebounced(q);

  useEffect(() => {
    const p = new URLSearchParams();
    if (dq) p.set("q", dq);
    if (Object.keys(tags).length) p.set("tags", JSON.stringify(tags));
    if (exclude.length) p.set("exclude", exclude.join(","));
    if (max) p.set("max", String(max));
    if (review) p.set("review", "1");
    const url = `/${p.toString() ? `?${p}` : ""}`;
    if (url !== `${loc.path}${loc.url.includes("?") ? loc.url.slice(loc.url.indexOf("?")) : ""}`)
      loc.route(url, true);
  }, [dq, tags, exclude, max, review]);

  const filters: Filters = {
    tags,
    exclude_allergens: exclude,
    max_total_min: max || undefined,
    needs_review: review || undefined,
  };
  const results = useAsync(() => api.search(dq, filters), [dq, JSON.stringify(filters)]);
  const facets = useAsync(() => api.facets(), []);

  const toggle = (cat: string, name: string) =>
    setTags((t) => {
      const cur = new Set(t[cat] ?? []);
      if (cur.has(name)) cur.delete(name);
      else cur.add(name);
      const next = { ...t, [cat]: [...cur] };
      if (!next[cat]?.length) delete next[cat];
      return next;
    });
  const toggleExclude = (a: string) =>
    setExclude((e) => (e.includes(a) ? e.filter((x) => x !== a) : [...e, a]));
  const active = Object.entries(tags).flatMap(([c, vs]) => vs.map((v) => [c, v] as const));

  const used = facets.data?.used ?? {};
  return (
    <div class="layout">
      <aside class="panel">
        <div class="facet">
          <h3>Total time</h3>
          <select
            value={max}
            onChange={(e) => setMax(Number((e.target as HTMLSelectElement).value))}
          >
            {TIMES.map((t) => (
              <option key={t} value={t}>
                {t ? `≤ ${t} min` : "Any"}
              </option>
            ))}
          </select>
        </div>
        {used.allergen?.length ? (
          <div class="facet">
            <h3>Leave out allergens</h3>
            <div class="chips">
              {used.allergen.map((a) => (
                <Chip
                  key={a.name}
                  tone={exclude.includes(a.name) ? "bad" : undefined}
                  onClick={() => toggleExclude(a.name)}
                >
                  {exclude.includes(a.name) ? "✕ " : ""}
                  {pretty(a.name)}
                </Chip>
              ))}
            </div>
          </div>
        ) : null}
        {FACET_ORDER.filter((c) => used[c]?.length).map((cat) => {
          const values = used[cat] ?? [];
          const shown = open[cat] ? values : values.slice(0, 8);
          return (
            <div class="facet" key={cat}>
              <h3>{cat}</h3>
              <div class="chips">
                {shown.map((v) => (
                  <Chip
                    key={v.name}
                    tone={tags[cat]?.includes(v.name) ? "on" : undefined}
                    onClick={() => toggle(cat, v.name)}
                  >
                    {pretty(v.name)} <span class="muted">{v.count}</span>
                  </Chip>
                ))}
              </div>
              {values.length > 8 && (
                <button
                  type="button"
                  class="ghost more"
                  onClick={() => setOpen((o) => ({ ...o, [cat]: !o[cat] }))}
                >
                  {open[cat] ? "fewer" : `+${values.length - 8} more`}
                </button>
              )}
            </div>
          );
        })}
        <label class="row small">
          <input
            type="checkbox"
            checked={review}
            onChange={(e) => setReview((e.target as HTMLInputElement).checked)}
          />
          Only recipes needing review
        </label>
      </aside>

      <section class="stack">
        <input
          type="search"
          placeholder="Search recipes — a dish, an ingredient, a mood (“cosy weeknight curry”)…"
          value={q}
          onInput={(e) => setQ((e.target as HTMLInputElement).value)}
        />
        {(active.length > 0 || exclude.length > 0 || max > 0) && (
          <div class="row">
            {active.map(([c, v]) => (
              <Chip key={`${c}:${v}`} tone="on" onClick={() => toggle(c, v)}>
                {c}: {pretty(v)} <span class="x">✕</span>
              </Chip>
            ))}
            {exclude.map((a) => (
              <Chip key={a} tone="bad" onClick={() => toggleExclude(a)}>
                no {pretty(a)} <span class="x">✕</span>
              </Chip>
            ))}
            <button
              type="button"
              class="ghost small"
              onClick={() => {
                setTags({});
                setExclude([]);
                setMax(0);
                setReview(false);
              }}
            >
              Clear all
            </button>
          </div>
        )}
        {results.error && <p class="error">{results.error}</p>}
        <div class="muted small">
          {results.data ? `${results.data.results.length} recipes` : "Loading…"}
          {results.data && dq
            ? results.data.vector_used
              ? " · semantic + keyword"
              : " · keyword (semantic index warming up)"
            : ""}
        </div>
        {results.data && results.data.results.length === 0 ? (
          <Empty>
            No recipes match.{" "}
            {dq || active.length
              ? "Try fewer filters."
              : "Add some — drop card photos on the Inbox page, then ask Claude to /pantrybase:ingest them."}
          </Empty>
        ) : (
          <div class="grid">
            {results.data?.results.map((r) => (
              <RecipeCard key={r.slug} r={r} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
