import Graph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { useLocation } from "preact-iso";
import Sigma, { DEFAULT_STYLES } from "sigma";
import { api, fileUrl } from "../api";
import { Chip, pretty, useAsync } from "../components";
import type { GraphNode } from "../types";

const CATEGORY_OPTIONS = [
  "cuisine",
  "dish",
  "protein",
  "diet",
  "starch",
  "flavor",
  "allergen",
  "technique",
  "equipment",
  "chef",
];
const PALETTE: Record<string, string> = {
  recipe: "#c2410c",
  ingredient: "#3f7d4a",
  cuisine: "#2563eb",
  dish: "#7c3aed",
  protein: "#b45309",
  diet: "#0d9488",
  starch: "#a16207",
  flavor: "#db2777",
  allergen: "#b42318",
  technique: "#4b5563",
  equipment: "#64748b",
  chef: "#0369a1",
};
const FADED = "rgba(150,140,130,0.18)";

function colorOf(n: GraphNode): string {
  if (n.kind === "recipe") return PALETTE.recipe ?? "#c2410c";
  if (n.kind === "ingredient") return PALETTE.ingredient ?? "#3f7d4a";
  return PALETTE[n.group ?? ""] ?? "#6b7280";
}

export function GraphPage() {
  const loc = useLocation();
  const [categories, setCategories] = useState<string[]>(["cuisine", "dish", "protein", "diet"]);
  const [ingredients, setIngredients] = useState(true);
  const [minDegree, setMinDegree] = useState(2);
  const [similar, setSimilar] = useState(false);
  const [find, setFind] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const graphRef = useRef<Graph | null>(null);
  const sigmaRef = useRef<Sigma | null>(null);

  const data = useAsync(
    () =>
      api.graph({
        categories,
        ingredients,
        min_degree: minDegree,
        similar: similar ? 3 : undefined,
      }),
    [categories.join(","), ingredients, minDegree, similar],
  );
  const byId = useMemo(() => new Map((data.data?.nodes ?? []).map((n) => [n.id, n])), [data.data]);

  // (Re)build the graphology graph and the sigma renderer when the data changes.
  useEffect(() => {
    const d = data.data;
    if (!d || !container.current) return;
    const g = new Graph({ multi: false, type: "undirected" });
    for (const n of d.nodes) {
      const size = n.kind === "recipe" ? 6 : 3 + Math.sqrt(n.degree) * 2;
      g.addNode(n.id, {
        label: n.kind === "tag" ? pretty(n.label) : n.label,
        size,
        color: colorOf(n),
        baseColor: colorOf(n),
        x: Math.random() * 100,
        y: Math.random() * 100,
      });
    }
    for (const e of d.edges) {
      if (!g.hasNode(e.source) || !g.hasNode(e.target) || g.hasEdge(e.source, e.target)) continue;
      const color =
        e.kind === "similar"
          ? "rgba(194,65,12,0.45)"
          : e.kind === "derived_from"
            ? "rgba(124,58,237,0.6)"
            : "rgba(150,140,130,0.25)";
      g.addEdge(e.source, e.target, {
        size: e.kind === "similar" || e.kind === "derived_from" ? 1.5 : 0.6,
        color,
        baseColor: color,
      });
    }
    if (g.order > 1) {
      forceAtlas2.assign(g, {
        iterations: g.order > 800 ? 150 : 300,
        settings: { ...forceAtlas2.inferSettings(g), barnesHutOptimize: g.order > 400 },
      });
    }
    sigmaRef.current?.kill();
    graphRef.current = g;
    // Labels follow the page theme (sigma draws them black on a white hover backdrop by default).
    const css = getComputedStyle(document.documentElement);
    const text = css.getPropertyValue("--text").trim() || "#2b2420";
    const surface = css.getPropertyValue("--surface").trim() || "#ffffff";
    const renderer = new Sigma(g, container.current, {
      settings: { labelRenderedSizeThreshold: 7, autoRescaleContent: "nodes" },
      styles: {
        ...DEFAULT_STYLES,
        nodes: { ...DEFAULT_STYLES.nodes, labelColor: text, backdropColor: surface },
      },
    } as never);
    sigmaRef.current = renderer;

    const focus = (node: string | null) => {
      const neighbours = node ? new Set([node, ...g.neighbors(node)]) : null;
      g.forEachNode((n, a) =>
        g.setNodeAttribute(n, "color", !neighbours || neighbours.has(n) ? a.baseColor : FADED),
      );
      g.forEachEdge((edge, a, s, t) =>
        g.setEdgeAttribute(
          edge,
          "color",
          !node || s === node || t === node ? a.baseColor : "rgba(150,140,130,0.06)",
        ),
      );
    };
    renderer.on("enterNode", ({ node }: { node: string }) => focus(node));
    renderer.on("leaveNode", () => focus(null));
    renderer.on("clickNode", ({ node }: { node: string }) => setSelected(node));
    renderer.on("clickStage", () => setSelected(null));
    return () => {
      renderer.kill();
      sigmaRef.current = null;
    };
  }, [data.data]);

  const zoomTo = (id: string) => {
    const r = sigmaRef.current;
    const pos = r?.getNodeDisplayData(id);
    if (r && pos) r.getCamera().animate({ x: pos.x, y: pos.y, ratio: 0.35 }, { duration: 500 });
    setSelected(id);
  };

  const sel = selected ? byId.get(selected) : undefined;
  const neighbours =
    selected && graphRef.current?.hasNode(selected)
      ? graphRef.current
          .neighbors(selected)
          .map((id) => byId.get(id))
          .filter((n): n is GraphNode => !!n)
      : [];
  const matches =
    find.trim().length >= 2
      ? (data.data?.nodes ?? [])
          .filter((n) => n.label.toLowerCase().includes(find.trim().toLowerCase()))
          .slice(0, 8)
      : [];

  return (
    <div class="graph-wrap">
      <aside class="panel stack side">
        <div>
          <h3>Find</h3>
          <input
            type="search"
            placeholder="Recipe, ingredient, tag…"
            value={find}
            onInput={(e) => setFind((e.target as HTMLInputElement).value)}
          />
          {matches.map((m) => (
            <div key={m.id}>
              <button type="button" class="ghost small" onClick={() => zoomTo(m.id)}>
                <span class="dot" style={{ background: colorOf(m) }} />
                {m.label}
              </button>
            </div>
          ))}
        </div>
        <div>
          <h3>Show</h3>
          <label class="row small">
            <input
              type="checkbox"
              checked={ingredients}
              onChange={(e) => setIngredients((e.target as HTMLInputElement).checked)}
            />
            Ingredients
          </label>
          <label class="row small">
            <input
              type="checkbox"
              checked={similar}
              onChange={(e) => setSimilar((e.target as HTMLInputElement).checked)}
            />
            Similar-recipe links
          </label>
          <div class="row" style={{ marginTop: "0.5rem" }}>
            {CATEGORY_OPTIONS.map((c) => (
              <Chip
                key={c}
                tone={categories.includes(c) ? "on" : undefined}
                onClick={() =>
                  setCategories((cs) => (cs.includes(c) ? cs.filter((x) => x !== c) : [...cs, c]))
                }
              >
                <span class="dot" style={{ background: PALETTE[c] }} />
                {c}
              </Chip>
            ))}
          </div>
        </div>
        <div>
          <h3>Hide nodes linked to fewer than {minDegree} recipes</h3>
          <input
            type="range"
            min={1}
            max={10}
            value={minDegree}
            onInput={(e) => setMinDegree(Number((e.target as HTMLInputElement).value))}
          />
        </div>
        {data.data && (
          <div class="muted small">
            {data.data.stats.recipes} recipes · {data.data.stats.ingredients} ingredients ·{" "}
            {data.data.stats.tags} tags · {data.data.stats.edges} links
          </div>
        )}
        <div class="legend">
          <span>
            <span class="dot" style={{ background: PALETTE.recipe }} />
            recipe
          </span>
          <span>
            <span class="dot" style={{ background: PALETTE.ingredient }} />
            ingredient
          </span>
        </div>
      </aside>

      <div class="graph-canvas">
        <div class="sigma" ref={container} />
        {data.loading && !data.data && <div class="empty">Laying out the graph…</div>}
        {data.data && data.data.nodes.length === 0 && <div class="empty">No recipes yet.</div>}
      </div>

      <aside class="panel side">
        {sel ? (
          <div class="stack">
            <div class="muted small">{sel.kind === "tag" ? sel.group : sel.kind}</div>
            <h2>{sel.kind === "tag" ? pretty(sel.label) : sel.label}</h2>
            {sel.kind === "recipe" && sel.image && (
              <img
                src={fileUrl(sel.image, 400)}
                alt=""
                style={{ width: "100%", borderRadius: "10px" }}
              />
            )}
            {sel.kind === "recipe" ? (
              <button
                type="button"
                class="primary"
                onClick={() => loc.route(`/recipe/${sel.slug}`)}
              >
                Open recipe
              </button>
            ) : (
              <a
                href={`/?${sel.kind === "tag" ? `tags=${encodeURIComponent(JSON.stringify({ [sel.group ?? "other"]: [sel.label] }))}` : `q=${encodeURIComponent(sel.label)}`}`}
              >
                Search recipes with this →
              </a>
            )}
            <div>
              <h3>Connected ({neighbours.length})</h3>
              {neighbours
                .sort((a, b) =>
                  a.kind === b.kind ? a.label.localeCompare(b.label) : a.kind === "recipe" ? -1 : 1,
                )
                .map((n) => (
                  <div key={n.id}>
                    <button type="button" class="ghost small" onClick={() => zoomTo(n.id)}>
                      <span class="dot" style={{ background: colorOf(n) }} />
                      {n.kind === "tag" ? pretty(n.label) : n.label}
                    </button>
                  </div>
                ))}
            </div>
          </div>
        ) : (
          <div class="muted small">
            Hover a node to highlight its neighbourhood; click it for details. Ingredients shared by
            many recipes and tags like cuisine and dish pull related recipes together.
          </div>
        )}
      </aside>
    </div>
  );
}
