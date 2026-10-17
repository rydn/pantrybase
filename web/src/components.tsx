import type { ComponentChildren } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { fileUrl } from "./api";
import type { RecipeSummary } from "./types";

/** Run an async loader whenever `deps` change; keeps the last good value while reloading. */
export function useAsync<T>(load: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({
    loading: true,
  });
  const seq = useRef(0);
  const reload = useCallback(() => {
    const id = ++seq.current;
    setState((s) => ({ ...s, loading: true }));
    load().then(
      (data) => id === seq.current && setState({ data, loading: false }),
      (e: unknown) =>
        id === seq.current &&
        setState((s) => ({
          ...s,
          error: String(e instanceof Error ? e.message : e),
          loading: false,
        })),
    );
  }, deps);
  useEffect(() => reload(), [reload]);
  return { ...state, reload };
}

export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function minutes(m: number | null | undefined): string {
  if (m == null) return "";
  return m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}` : `${m} min`;
}

export function pretty(v: string): string {
  return v.replace(/-/g, " ");
}

export function Chip(props: {
  children: ComponentChildren;
  tone?: "on" | "ok" | "warn" | "bad";
  onClick?: () => void;
  title?: string;
}) {
  const cls = `chip${props.tone ? ` ${props.tone}` : ""}`;
  return props.onClick ? (
    <button type="button" class={cls} onClick={props.onClick} title={props.title}>
      {props.children}
    </button>
  ) : (
    <span class={cls} title={props.title}>
      {props.children}
    </span>
  );
}

export function RecipeCard({ r }: { r: RecipeSummary }) {
  const img = r.images[0];
  return (
    <a class="card" href={`/recipe/${r.slug}`}>
      {img ? (
        <div class="img" style={{ backgroundImage: `url("${fileUrl(img, 480)}")` }} />
      ) : (
        <div class="img none" aria-hidden="true">
          {r.source_kind === "synthesized" ? "✦" : "🍽"}
        </div>
      )}
      <div class="body">
        <div class="title">{r.title}</div>
        {r.subtitle && <div class="sub">{r.subtitle}</div>}
        <div class="meta">
          {r.total_min != null && <Chip>⏱ {minutes(r.total_min)}</Chip>}
          {r.tags.cuisine?.slice(0, 1).map((c) => (
            <Chip key={c}>{pretty(c)}</Chip>
          ))}
          {r.tags.diet?.slice(0, 2).map((d) => (
            <Chip key={d} tone="ok">
              {pretty(d)}
            </Chip>
          ))}
          {r.needs_review && <Chip tone="warn">needs review</Chip>}
        </div>
      </div>
    </a>
  );
}

export function Empty({ children }: { children: ComponentChildren }) {
  return <div class="empty">{children}</div>;
}
