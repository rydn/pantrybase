import { api } from "../api";
import { Chip, Empty, pretty, useAsync } from "../components";

const ORDER = [
  "cuisine",
  "dish",
  "diet",
  "protein",
  "starch",
  "flavor",
  "texture",
  "method",
  "meal",
  "time",
  "season",
  "allergen",
  "technique",
  "equipment",
  "chef",
  "plan",
  "provider",
  "other",
];

export function TagsPage() {
  const facets = useAsync(() => api.facets(), []);
  const used = facets.data?.used ?? {};
  const cats = ORDER.filter((c) => used[c]?.length);
  if (facets.data && !cats.length)
    return <Empty>No tags yet — they appear as recipes are saved.</Empty>;
  return (
    <div class="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))" }}>
      {cats.map((c) => (
        <section class="panel" key={c}>
          <h3>
            {c} <span class="muted">· {used[c]?.length}</span>
          </h3>
          <div class="row">
            {used[c]?.map((t) => (
              <a
                key={t.name}
                href={
                  c === "allergen"
                    ? `/?exclude=${encodeURIComponent(t.name)}`
                    : `/?tags=${encodeURIComponent(JSON.stringify({ [c]: [t.name] }))}`
                }
              >
                <Chip>
                  {pretty(t.name)} <span class="muted">{t.count}</span>
                </Chip>
              </a>
            ))}
          </div>
          {facets.data?.vocabulary[c]?.mode === "closed" && (
            <div class="muted small" style={{ marginTop: "0.5rem" }}>
              Controlled vocabulary
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
