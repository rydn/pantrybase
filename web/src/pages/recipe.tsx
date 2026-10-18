import { useState } from "preact/hooks";
import { useLocation, useRoute } from "preact-iso";
import { api, fileUrl } from "../api";
import { Chip, Empty, minutes, pretty, RecipeCard, useAsync } from "../components";
import type { Ingredient } from "../types";

const NUTRITION: Array<[string, string, string]> = [
  ["energy_kj", "Energy", "kJ"],
  ["energy_kcal", "Energy", "kcal"],
  ["protein_g", "Protein", "g"],
  ["carbs_g", "Carbs", "g"],
  ["sugars_g", "of which sugars", "g"],
  ["fibre_g", "Fibre", "g"],
  ["fat_g", "Fat", "g"],
  ["saturated_g", "of which saturated", "g"],
  ["sodium_mg", "Sodium", "mg"],
];

function amount(i: Ingredient): string {
  return [i.qty, i.unit].filter((x) => x !== undefined && x !== null && x !== "").join(" ");
}

export function RecipePage() {
  const { params } = useRoute();
  const { route } = useLocation();
  const slug = params.slug ?? "";
  const detail = useAsync(() => api.recipe(slug), [slug]);
  const [img, setImg] = useState(0);
  const [busy, setBusy] = useState(false);

  const planAround = async () => {
    setBusy(true);
    try {
      const plan = await api.plan();
      if (!plan.items.some((i) => i.slug === slug)) {
        await api.planSet([
          ...plan.items.map((i) => ({ slug: i.slug, servings: i.servings })),
          { slug },
        ]);
      }
      route("/plan");
    } finally {
      setBusy(false);
    }
  };

  if (detail.error) return <Empty>{detail.error}</Empty>;
  const d = detail.data;
  if (!d) return <Empty>Loading…</Empty>;
  const r = d.recipe;
  const have = new Set(d.pantry_have);
  const box = r.ingredients.filter((i) => i.source !== "kitchen");
  const kitchen = r.ingredients.filter((i) => i.source === "kitchen");
  const missing = box.filter((i) => !i.staple && !i.optional && !have.has(i.canonical));

  const addToPantry = async (names: string[]) => {
    setBusy(true);
    try {
      await api.pantryAdd(names);
      detail.reload();
    } finally {
      setBusy(false);
    }
  };

  const line = (i: Ingredient) => {
    const owned = have.has(i.canonical);
    return (
      <li key={`${i.raw}-${i.canonical}`}>
        <span class="tick" title={owned ? "in your pantry" : i.staple ? "staple" : "not in pantry"}>
          {owned ? "✓" : i.staple ? "·" : "○"}
        </span>
        <span>
          <span title={amount(i) ? `${amount(i)} ${i.canonical}` : i.canonical}>{i.raw}</span>
          {i.prep && <span class="prep"> — {i.prep}</span>}
          {i.optional && !/optional/i.test(i.raw) && <span class="muted small"> (optional)</span>}
          {i.alternatives?.length ? (
            <span class="muted small"> · or {i.alternatives.join(", ")}</span>
          ) : null}
          {i.components?.length ? (
            <div class="muted small">{i.components.map((c) => c.raw).join(" + ")}</div>
          ) : null}
        </span>
      </li>
    );
  };

  const n = r.nutrition;
  const wine = r.provider?.wine;
  return (
    <article>
      <div class="hero">
        <div class="gallery">
          {r.images.length ? (
            <>
              <img
                class="main"
                src={fileUrl(r.images[img] ?? r.images[0] ?? "", 1400)}
                alt={r.title}
              />
              {r.images.length > 1 && (
                <div class="thumbs">
                  {r.images.map((p, i) => (
                    <button
                      key={p}
                      type="button"
                      class="ghost"
                      style={{ padding: 0 }}
                      onClick={() => setImg(i)}
                      aria-label={`Photo ${i + 1}`}
                    >
                      <img src={fileUrl(p, 200)} class={i === img ? "sel" : ""} alt="" />
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div class="panel empty">No photo</div>
          )}
        </div>
        <div class="stack">
          <div>
            <h1>{r.title}</h1>
            {r.subtitle && <div class="muted">{r.subtitle}</div>}
          </div>
          <div class="row">
            {(
              ["cuisine", "dish", "diet", "protein", "flavor", "texture", "season"] as const
            ).flatMap((c) =>
              (r.tags[c] ?? []).map((v) => (
                <a
                  key={`${c}${v}`}
                  href={`/?tags=${encodeURIComponent(JSON.stringify({ [c]: [v] }))}`}
                >
                  <Chip tone={c === "diet" ? "ok" : undefined}>{pretty(v)}</Chip>
                </a>
              )),
            )}
          </div>
          {r.extraction?.needs_review && (
            <div class="notice">
              Flagged for review
              {r.extraction.uncertain?.length
                ? `: couldn't read ${r.extraction.uncertain.join(", ")}`
                : ""}
              .{r.extraction.notes ? ` ${r.extraction.notes}` : ""}
            </div>
          )}
          {r.blurb && <p>{r.blurb}</p>}
          <div class="facts">
            {r.time.active != null && (
              <div class="fact">
                <b>Hands-on</b>
                {minutes(r.time.active)}
              </div>
            )}
            {r.time.total != null && (
              <div class="fact">
                <b>Total</b>
                {minutes(r.time.total)}
              </div>
            )}
            {r.servings != null && (
              <div class="fact">
                <b>Serves</b>
                {r.servings}
              </div>
            )}
            {r.provider?.chef && (
              <div class="fact">
                <b>Chef</b>
                {r.provider.chef}
              </div>
            )}
            {r.provider && (
              <div class="fact">
                <b>From</b>
                {r.provider.name ?? r.provider.id}
                {r.provider.plan ? ` · ${r.provider.plan}` : ""}
              </div>
            )}
            {r.provider?.eat_within_days != null && (
              <div class="fact">
                <b>Eat within</b>
                {r.provider.eat_within_days} days
              </div>
            )}
            {wine && (wine.name || wine.producer) && (
              <div class="fact">
                <b>Wine</b>
                {[wine.producer, wine.name, wine.vintage].filter(Boolean).join(" · ")}
              </div>
            )}
            {r.source.kind === "synthesized" && (
              <div class="fact">
                <b>Source</b>Synthesized
              </div>
            )}
          </div>
          {r.description && <p class="muted small">{r.description}</p>}
          <div class="row">
            <button type="button" class="primary" disabled={busy} onClick={planAround}>
              Plan meals around this
            </button>
            <span class="muted small">
              finds recipes that share its ingredients and builds one shopping list
            </span>
          </div>
        </div>
      </div>

      <div class="cols">
        <section class="panel">
          <div class="row" style={{ justifyContent: "space-between" }}>
            <h2>Ingredients</h2>
            {missing.length > 0 && (
              <button
                type="button"
                class="small"
                disabled={busy}
                onClick={() => addToPantry(missing.map((m) => m.canonical))}
              >
                I have these
              </button>
            )}
          </div>
          <ul class="ings">{box.map(line)}</ul>
          {kitchen.length > 0 && (
            <>
              <h3 style={{ marginTop: "1rem" }}>From your kitchen</h3>
              <ul class="ings">{kitchen.map(line)}</ul>
            </>
          )}
          <p class="muted small">✓ in your pantry · ○ missing · · staple</p>
        </section>

        <section class="panel">
          <h2>Method</h2>
          <ol class="steps">
            {r.steps.map((s, i) => (
              <li key={i}>
                {s.title && <div class="stitle">{s.title}</div>}
                <div>{s.text}</div>
                <div class="row" style={{ marginTop: "0.3rem" }}>
                  {s.techniques?.map((t) => (
                    <Chip key={t}>{pretty(t)}</Chip>
                  ))}
                  {s.temp_c != null && <Chip>🌡 {s.temp_c}°C</Chip>}
                  {s.minutes?.length ? <Chip>⏱ {s.minutes.join("–")} min</Chip> : null}
                </div>
              </li>
            ))}
          </ol>
          {r.tips.length > 0 && (
            <>
              <h3>Tips</h3>
              {r.tips.map((t) => (
                <p key={t} class="small">
                  {t}
                </p>
              ))}
            </>
          )}
          {r.notes && (
            <>
              <h3>Notes</h3>
              <p class="small">{r.notes}</p>
            </>
          )}
        </section>

        <aside class="stack">
          {n && (
            <section class="panel">
              <h2>Nutrition</h2>
              <div class="muted small">{n.basis === "per_100g" ? "per 100 g" : "per serving"}</div>
              <table class="nut">
                <tbody>
                  {NUTRITION.filter(([k]) => n[k] != null).map(([k, label, unit]) => (
                    <tr key={k}>
                      <td>{label}</td>
                      <td>
                        {n[k]} {unit}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
          {(r.allergens.length > 0 || r.equipment.length > 0) && (
            <section class="panel stack">
              {r.allergens.length > 0 && (
                <div>
                  <h3>Allergens</h3>
                  <div class="row">
                    {r.allergens.map((a) => (
                      <Chip key={a} tone="bad">
                        {pretty(a)}
                      </Chip>
                    ))}
                  </div>
                </div>
              )}
              {r.equipment.length > 0 && (
                <div>
                  <h3>Equipment</h3>
                  <div class="row">
                    {r.equipment.map((e) => (
                      <Chip key={e}>{pretty(e)}</Chip>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}
          {d.sources.length > 0 && (
            <section class="panel">
              <h3>Inspired by</h3>
              {d.sources.map((s) => (
                <div key={s.slug}>
                  <a href={`/recipe/${s.slug}`}>{s.title}</a>
                </div>
              ))}
            </section>
          )}
          {d.derived.length > 0 && (
            <section class="panel">
              <h3>Recipes built on this</h3>
              {d.derived.map((s) => (
                <div key={s.slug}>
                  <a href={`/recipe/${s.slug}`}>{s.title}</a>
                </div>
              ))}
            </section>
          )}
        </aside>
      </div>

      {d.similar.length > 0 && (
        <section style={{ marginTop: "2rem" }}>
          <h2>Similar recipes</h2>
          <div class="grid">
            {d.similar.map((s) => (
              <RecipeCard key={s.slug} r={s} />
            ))}
          </div>
        </section>
      )}
    </article>
  );
}
