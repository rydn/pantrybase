import { useState } from "preact/hooks";
import { api } from "../api";
import { Chip, Empty, pretty, useAsync, useDebounced } from "../components";

export function PantryPage() {
  const pantry = useAsync(() => api.pantry(), []);
  const [text, setText] = useState("");
  const [min, setMin] = useState(0.5);
  const [error, setError] = useState<string | null>(null);
  const dtext = useDebounced(text, 150);
  const suggestions = useAsync(
    () => (dtext.trim().length >= 2 ? api.ingredients(dtext.trim()) : Promise.resolve([])),
    [dtext],
  );
  const match = useAsync(() => api.match({ min_coverage: min }), [min, pantry.data?.length]);

  const add = async (raw: string) => {
    const names = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!names.length) return;
    setError(null);
    try {
      await api.pantryAdd(names);
      setText("");
      pantry.reload();
    } catch (e) {
      setError(String(e));
    }
  };
  const remove = async (name: string) => {
    await api.pantryRemove([name]);
    pantry.reload();
  };

  return (
    <div class="layout" style={{ gridTemplateColumns: "minmax(280px, 380px) 1fr" }}>
      <section class="panel stack">
        <h2>Your pantry</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            add(text);
          }}
          class="row"
          style={{ flexWrap: "nowrap" }}
        >
          <input
            type="text"
            list="ingredient-suggestions"
            placeholder="Add items, e.g. eggs, baby marrow, rice"
            value={text}
            onInput={(e) => setText((e.target as HTMLInputElement).value)}
          />
          <datalist id="ingredient-suggestions">
            {suggestions.data?.map((s) => (
              <option key={s.canonical} value={s.canonical} />
            ))}
          </datalist>
          <button type="submit" class="primary">
            Add
          </button>
        </form>
        {error && <p class="error small">{error}</p>}
        {pantry.data?.length ? (
          <div class="row">
            {pantry.data.map((p) => (
              <Chip key={p.canonical} onClick={() => remove(p.canonical)} title="Remove">
                {p.canonical}
                {p.qty != null ? ` ×${p.qty}${p.unit ? ` ${p.unit}` : ""}` : ""}{" "}
                <span class="x">✕</span>
              </Chip>
            ))}
          </div>
        ) : (
          <p class="muted small">
            Nothing yet. Salt, oil, water and other kitchen staples never count against a recipe, so
            skip those.
          </p>
        )}
        {pantry.data && pantry.data.length > 0 && (
          <button
            type="button"
            class="ghost small"
            onClick={async () => {
              await api.pantryClear();
              pantry.reload();
            }}
          >
            Clear pantry
          </button>
        )}
      </section>

      <section class="panel">
        <div class="row" style={{ justifyContent: "space-between" }}>
          <h2>What can I cook?</h2>
          <label class="row small">
            at least {Math.round(min * 100)}% covered
            <input
              type="range"
              min={0}
              max={1}
              step={0.1}
              value={min}
              onInput={(e) => setMin(Number((e.target as HTMLInputElement).value))}
            />
          </label>
        </div>
        {match.data && match.data.results.length === 0 ? (
          <Empty>
            No recipes reach that coverage yet — add more to your pantry or lower the bar.
          </Empty>
        ) : (
          match.data?.results.map((m) => (
            <div class="list-row" key={m.slug}>
              <div>
                <a href={`/recipe/${m.slug}`}>
                  <b>{m.title}</b>
                </a>
                {m.near_miss && (
                  <Chip tone="warn" title="1–2 items short">
                    near miss
                  </Chip>
                )}
                <div class="row small" style={{ marginTop: "0.25rem" }}>
                  {m.missing.length ? (
                    <>
                      <span class="muted">missing</span>
                      {m.missing.map((x) => (
                        <Chip
                          key={x.canonical}
                          onClick={() => add(x.canonical)}
                          title="Add to pantry"
                        >
                          + {pretty(x.canonical)}
                        </Chip>
                      ))}
                    </>
                  ) : (
                    <span class="muted">you have everything</span>
                  )}
                </div>
              </div>
              <div>
                <div class="bar">
                  <span style={{ width: `${Math.round(m.coverage * 100)}%` }} />
                </div>
                <div class="muted small" style={{ textAlign: "right" }}>
                  {m.have}/{m.need} · {Math.round(m.coverage * 100)}%
                </div>
              </div>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
