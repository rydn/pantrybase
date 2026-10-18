import { useEffect, useState } from "preact/hooks";
import { useLocation } from "preact-iso";
import { api, fileUrl } from "../api";
import { Chip, Empty, minutes, pretty, useAsync, useDebounced } from "../components";
import type { PlanItem, RecipeSummary, ShoppingList, Suggestion } from "../types";

const TIMES = [0, 20, 30, 45, 60];

/** Paste-ready text version of the list. */
function listText(list: ShoppingList): string {
  const out = [`Shopping list — ${list.recipes.map((r) => r.title).join(", ")}`];
  let aisle: string | undefined;
  for (const l of list.buy) {
    if (l.aisle !== aisle) {
      aisle = l.aisle;
      out.push("", aisle.toUpperCase());
    }
    out.push(`☐ ${pretty(l.canonical)}${l.amount ? ` — ${l.amount}` : ""}`);
  }
  if (list.pantry_check.length) {
    out.push("", "FROM THE PANTRY");
    for (const c of list.pantry_check)
      out.push(
        `• ${pretty(c.canonical)}${c.amount ? ` — ${c.amount}` : ""}${c.confirmed ? "" : " (check)"}`,
      );
  }
  if (list.staples.length) out.push("", `Staples: ${list.staples.map(pretty).join(", ")}`);
  return out.join("\n");
}

function byAisle(list: ShoppingList): Array<[string, ShoppingList["buy"]]> {
  const groups = new Map<string, ShoppingList["buy"]>();
  for (const l of list.buy) groups.set(l.aisle, [...(groups.get(l.aisle) ?? []), l]);
  return [...groups.entries()];
}

export function PlanPage() {
  const loc = useLocation();
  const plan = useAsync(() => api.plan(), []);
  const [variety, setVariety] = useState(true);
  // Whether suggestions count pantry items as covered; a big pantry can drown out sharing.
  const [usePantry, setUsePantryState] = useState(() => {
    try {
      return localStorage.getItem("plan.usePantry") !== "0";
    } catch {
      return true;
    }
  });
  const setUsePantry = (v: boolean) => {
    setUsePantryState(v);
    try {
      localStorage.setItem("plan.usePantry", v ? "1" : "0");
    } catch {
      // private mode or blocked storage: the toggle still works for this visit
    }
  };
  const [max, setMax] = useState(0);
  const [fill, setFill] = useState(3);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const items: PlanItem[] =
    plan.data?.items.map((i) => ({ slug: i.slug, servings: i.servings })) ?? [];
  const slugs = items.map((i) => i.slug);
  const key = slugs.join(",");
  const confirmedKey = plan.data?.confirmed.join(",") ?? "";

  // /plan?seed=slug (from a recipe page): add it, then drop the query.
  useEffect(() => {
    const seed = loc.query.seed;
    if (!seed || !plan.data) return;
    (async () => {
      if (!slugs.includes(seed)) await api.planSet([...items, { slug: seed }]);
      loc.route("/plan", true);
      plan.reload();
    })();
  }, [loc.query.seed, plan.data]);

  const suggestions = useAsync(
    () =>
      plan.data
        ? api.planSuggest({
            plan: slugs,
            variety,
            use_pantry: usePantry,
            max_total_min: max || undefined,
          })
        : Promise.resolve(undefined),
    [key, variety, usePantry, max, Boolean(plan.data)],
  );
  const shopping = useAsync(
    () => (slugs.length ? api.shopping() : Promise.resolve(null)),
    [key, confirmedKey],
  );
  const picks = useAsync(
    () => (dq.trim().length >= 2 ? api.search(dq.trim(), {}, 8) : Promise.resolve(null)),
    [dq],
  );
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };
  const save = (next: PlanItem[]) =>
    run(async () => {
      await api.planSet(next);
      plan.reload();
    });
  const add = (slug: string) => {
    setQ("");
    return save([...items, { slug }]);
  };
  const remove = (slug: string) => save(items.filter((i) => i.slug !== slug));
  const setServings = (slug: string, n: number) =>
    save(items.map((i) => (i.slug === slug ? { ...i, servings: n > 0 ? n : null } : i)));
  const autofill = () =>
    run(async () => {
      const r = await api.planAutofill({
        plan: slugs,
        count: fill,
        variety,
        use_pantry: usePantry,
        max_total_min: max || undefined,
      });
      const extra = r.slugs.filter((s) => !slugs.includes(s)).map((slug) => ({ slug }));
      await api.planSet([...items, ...extra]);
      plan.reload();
    });
  const confirm = (name: string) =>
    run(async () => {
      await api.shopping({ confirmed: [name] });
      plan.reload();
    });
  const outOf = (name: string) =>
    run(async () => {
      await api.shopping({ out_of: [name] });
      plan.reload();
      suggestions.reload();
      shopping.reload();
    });
  const copy = async () => {
    if (!shopping.data) return;
    await navigator.clipboard.writeText(listText(shopping.data));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const summary = plan.data?.summary;
  const list = shopping.data;

  const pickRow = (r: RecipeSummary | Suggestion, extra?: preact.ComponentChildren) => (
    <div class="list-row" key={r.slug} style={{ gridTemplateColumns: "1fr auto" }}>
      <div>
        <a href={`/recipe/${r.slug}`}>
          <b>{r.title}</b>
        </a>
        {r.total_min != null && <span class="muted small"> · {minutes(r.total_min)}</span>}
        {extra}
      </div>
      <button type="button" class="small" disabled={busy} onClick={() => add(r.slug)}>
        + Add
      </button>
    </div>
  );

  return (
    <div class="stack">
      <div class="plan-grid">
        <section class="panel stack">
          <div class="row" style={{ justifyContent: "space-between" }}>
            <h2>Your meals</h2>
            {items.length > 0 && (
              <button type="button" class="ghost small" disabled={busy} onClick={() => save([])}>
                Clear plan
              </button>
            )}
          </div>
          {error && <p class="error small">{error}</p>}
          {plan.data?.items.map((i) => {
            const r = i.recipe;
            const img = r?.images[0];
            const serves = i.servings ?? r?.servings ?? 2;
            return (
              <div class="plan-item" key={i.slug}>
                <div
                  class={`thumb-sm${img ? "" : " none"}`}
                  style={img ? { backgroundImage: `url("${fileUrl(img, 160)}")` } : undefined}
                />
                <div class="grow">
                  <a href={`/recipe/${i.slug}`}>
                    <b>{r?.title ?? i.slug}</b>
                  </a>
                  <div class="muted small">
                    {r?.total_min != null ? `${minutes(r.total_min)} · ` : ""}
                    serves {serves}
                    {r?.servings && serves !== r.servings ? ` (recipe makes ${r.servings})` : ""}
                  </div>
                </div>
                <div class="stepper" title="Portions wanted">
                  <button
                    type="button"
                    class="step"
                    disabled={busy || serves <= 1}
                    onClick={() => setServings(i.slug, serves - 1)}
                  >
                    −
                  </button>
                  <span>{serves}</span>
                  <button
                    type="button"
                    class="step"
                    disabled={busy}
                    onClick={() => setServings(i.slug, serves + 1)}
                  >
                    +
                  </button>
                </div>
                <button
                  type="button"
                  class="ghost"
                  title="Remove from plan"
                  disabled={busy}
                  onClick={() => remove(i.slug)}
                >
                  ✕
                </button>
              </div>
            );
          })}
          {summary && items.length > 0 && (
            <div class="facts">
              <div class="fact">
                <b>Meals</b>
                {items.length}
              </div>
              <div class="fact">
                <b>To buy</b>
                {summary.to_buy}
              </div>
              <div class="fact">
                <b>From pantry</b>
                {summary.from_pantry}
              </div>
              <div class="fact">
                <b>Shared</b>
                {summary.shared}
              </div>
              <div class="fact">
                <b>Reuse</b>
                {Math.round(summary.reuse * 100)}%
              </div>
            </div>
          )}
          {items.length > 0 && (
            <div class="row">
              <button type="button" class="primary" disabled={busy} onClick={autofill}>
                Auto-fill
              </button>
              <select
                value={fill}
                onChange={(e) => setFill(Number((e.target as HTMLSelectElement).value))}
              >
                {[1, 2, 3, 4, 5, 6].map((n) => (
                  <option key={n} value={n}>
                    +{n} meal{n > 1 ? "s" : ""}
                  </option>
                ))}
              </select>
              <span class="muted small">picks the set that shares the most</span>
            </div>
          )}
          <div class="stack" style={{ marginTop: items.length ? "0.5rem" : 0 }}>
            {items.length === 0 && (
              <p class="muted">
                Pick a recipe to plan around. Suggestions then favour recipes that share its
                ingredients, and you get one shopping list for the lot.
              </p>
            )}
            <input
              type="search"
              placeholder={
                items.length ? "Add a specific recipe…" : "Search for a recipe to start with…"
              }
              value={q}
              onInput={(e) => setQ((e.target as HTMLInputElement).value)}
            />
            {picks.data?.results.map((r) => pickRow(r))}
            {picks.data && picks.data.results.length === 0 && (
              <p class="muted small">No recipes match.</p>
            )}
            {items.length === 0 && !dq && (
              <p class="muted small">
                Or pick one of the suggestions — with an empty plan they're ranked by what your
                pantry already covers.
              </p>
            )}
          </div>
        </section>

        <section class="panel">
          <div class="row" style={{ justifyContent: "space-between" }}>
            <h2>{items.length ? "Shares your shopping" : "Suggestions"}</h2>
            <div class="row small">
              <select
                value={max}
                onChange={(e) => setMax(Number((e.target as HTMLSelectElement).value))}
              >
                {TIMES.map((t) => (
                  <option key={t} value={t}>
                    {t ? `≤ ${t} min` : "Any time"}
                  </option>
                ))}
              </select>
              <label
                class="row small"
                style={{ gap: "0.3rem" }}
                title="Off: ignore the pantry and rank purely by what each recipe shares with the plan"
              >
                <input
                  type="checkbox"
                  checked={usePantry}
                  onChange={(e) => setUsePantry((e.target as HTMLInputElement).checked)}
                />
                count my pantry
              </label>
              <label class="row small" style={{ gap: "0.3rem" }}>
                <input
                  type="checkbox"
                  checked={variety}
                  onChange={(e) => setVariety((e.target as HTMLInputElement).checked)}
                />
                vary the dishes
              </label>
            </div>
          </div>
          <p class="muted small">
            {usePantry ? (
              <>
                Ranked by what each recipe shares with your plan —{" "}
                <Chip tone="ok">on your list</Chip> — then what's{" "}
                <Chip tone="on">in your pantry</Chip>; fresh items weigh more than dry goods.
              </>
            ) : (
              <>
                Ranked only by what each recipe shares with your plan —{" "}
                <Chip tone="ok">on your list</Chip>. The pantry is ignored here but still counts on
                the shopping list.
              </>
            )}
          </p>
          {suggestions.error && <p class="error small">{suggestions.error}</p>}
          {suggestions.data && suggestions.data.suggestions.length === 0 ? (
            <Empty>Nothing left to suggest — every recipe is planned or filtered out.</Empty>
          ) : (
            suggestions.data?.suggestions.map((s) => (
              <div class="list-row" key={s.slug} style={{ gridTemplateColumns: "1fr 150px" }}>
                <div>
                  <a href={`/recipe/${s.slug}`}>
                    <b>{s.title}</b>
                  </a>
                  {s.total_min != null && (
                    <span class="muted small"> · {minutes(s.total_min)}</span>
                  )}
                  {s.repeats && (
                    <Chip tone="warn" title="repeats a dish already planned">
                      {" "}
                      another {pretty(s.repeats)}
                    </Chip>
                  )}
                  <div class="row small" style={{ marginTop: "0.25rem" }}>
                    {s.shares.map((x) => (
                      <Chip tone="ok" key={x} title="already on your list">
                        {pretty(x)}
                      </Chip>
                    ))}
                    {s.from_pantry.map((x) => (
                      <Chip tone="on" key={x} title="in your pantry">
                        {pretty(x)}
                      </Chip>
                    ))}
                    {s.new.length ? (
                      <span class="muted">
                        +{s.new.length} new: {s.new.map(pretty).join(", ")}
                      </span>
                    ) : (
                      <span class="muted">adds nothing to the list</span>
                    )}
                  </div>
                </div>
                <div>
                  <div class="bar">
                    <span style={{ width: `${Math.round(s.reuse * 100)}%` }} />
                  </div>
                  <div class="row" style={{ justifyContent: "space-between", marginTop: "0.3rem" }}>
                    <span class="muted small">{Math.round(s.reuse * 100)}% covered</span>
                    <button type="button" class="small" disabled={busy} onClick={() => add(s.slug)}>
                      + Add
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </section>
      </div>

      {list && items.length > 0 && (
        <section class="panel shop">
          <div class="row" style={{ justifyContent: "space-between" }}>
            <h2>Shopping list</h2>
            <div class="row">
              <button type="button" onClick={copy}>
                {copied ? "Copied" : "Copy list"}
              </button>
              <button type="button" onClick={() => window.print()}>
                Print
              </button>
            </div>
          </div>
          {list.needs_confirmation.length > 0 && (
            <div class="notice">
              Before you shop, check the {list.needs_confirmation.length} pantry item
              {list.needs_confirmation.length > 1 ? "s" : ""} the plan counts on — anything you're
              out of moves onto the list.
            </div>
          )}
          <div class="shop-grid">
            <div>
              <h3>From your pantry</h3>
              {list.pantry_check.length === 0 ? (
                <p class="muted small">Nothing — the plan buys everything.</p>
              ) : (
                list.pantry_check.map((c) => (
                  <div class="check-row" key={c.canonical}>
                    <div>
                      <b>{pretty(c.canonical)}</b>
                      {c.amount && <span class="muted"> · need {c.amount}</span>}
                      {c.in_pantry && <span class="muted"> · have {c.in_pantry}</span>}
                      <div class="muted small">{c.for.join(", ")}</div>
                    </div>
                    {c.confirmed ? (
                      <Chip
                        tone="ok"
                        onClick={() => outOf(c.canonical)}
                        title="Actually out? Click"
                      >
                        ✓ have it
                      </Chip>
                    ) : (
                      <div class="row" style={{ flexWrap: "nowrap" }}>
                        <button
                          type="button"
                          class="small"
                          disabled={busy}
                          onClick={() => confirm(c.canonical)}
                        >
                          Have it
                        </button>
                        <button
                          type="button"
                          class="small ghost"
                          disabled={busy}
                          onClick={() => outOf(c.canonical)}
                        >
                          Out
                        </button>
                      </div>
                    )}
                  </div>
                ))
              )}
              {list.staples.length > 0 && (
                <p class="muted small" style={{ marginTop: "1rem" }}>
                  Staples used: {list.staples.map(pretty).join(", ")}
                </p>
              )}
              {list.optional.length > 0 && (
                <p class="muted small">
                  Optional: {list.optional.map((o) => pretty(o.canonical)).join(", ")}
                </p>
              )}
            </div>
            <div>
              <h3>
                To buy · {list.buy.length} item{list.buy.length === 1 ? "" : "s"}
                {list.summary.shared > 0 ? ` · ${list.summary.shared} shared` : ""}
              </h3>
              {list.buy.length === 0 && (
                <p class="muted small">Nothing to buy — it's all in your pantry.</p>
              )}
              {byAisle(list).map(([aisle, lines]) => (
                <div key={aisle}>
                  <div class="aisle">{aisle}</div>
                  {lines.map((l) => (
                    <label
                      class={`shop-line${ticked[l.canonical] ? " done" : ""}`}
                      key={l.canonical}
                    >
                      <input
                        type="checkbox"
                        checked={Boolean(ticked[l.canonical])}
                        onChange={() =>
                          setTicked((t) => ({ ...t, [l.canonical]: !t[l.canonical] }))
                        }
                      />
                      <span class="grow">
                        <b>{pretty(l.canonical)}</b>
                        {l.amount && <span> — {l.amount}</span>}
                        <div class="muted small">{l.for.join(", ")}</div>
                      </span>
                      {l.for.length > 1 && (
                        <Chip tone="ok" title="used by more than one recipe">
                          ×{l.for.length}
                        </Chip>
                      )}
                    </label>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
