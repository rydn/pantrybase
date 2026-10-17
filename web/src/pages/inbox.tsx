import { useState } from "preact/hooks";
import { api, fileUrl } from "../api";
import { Chip, Empty, useAsync } from "../components";
import type { InboxItem } from "../types";

const STATUSES = ["pending", "done", "skipped", "failed"] as const;

export function InboxPage() {
  const [status, setStatus] = useState<(typeof STATUSES)[number]>("pending");
  const inbox = useAsync(() => api.inbox(status), [status]);
  const [over, setOver] = useState(false);
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
    errors: string[];
  } | null>(null);
  const [reasons, setReasons] = useState<Record<number, string>>({});

  const upload = async (files: FileList | File[]) => {
    const list = [...files].filter((f) => /\.(jpe?g|png|webp|heic|heif|tiff?)$/i.test(f.name));
    if (!list.length) return;
    const errors: string[] = [];
    setProgress({ done: 0, total: list.length, errors });
    for (const [i, f] of list.entries()) {
      try {
        await api.upload(f);
      } catch (e) {
        errors.push(`${f.name}: ${String(e)}`);
      }
      setProgress({ done: i + 1, total: list.length, errors });
    }
    setStatus("pending");
    inbox.reload();
  };
  const resolve = async (item: InboxItem, to: "pending" | "skipped" | "failed") => {
    await api.resolve([item.id], to, reasons[item.id]);
    inbox.reload();
  };

  const counts = inbox.data?.counts;
  return (
    <div class="stack">
      <label
        class={`drop${over ? " over" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          if (e.dataTransfer?.files) upload(e.dataTransfer.files);
        }}
      >
        <input
          type="file"
          multiple
          accept="image/*,.heic,.heif"
          style={{ display: "none" }}
          onChange={(e) => {
            const files = (e.target as HTMLInputElement).files;
            if (files) upload(files);
          }}
        />
        <div style={{ fontSize: "1.1rem", fontWeight: 600 }}>
          Drop recipe card photos here, or click to choose
        </div>
        <div class="small">
          JPEG, PNG, WebP or iPhone HEIC — fronts and backs. Exact duplicates are ignored
          automatically.
        </div>
        {progress && (
          <div class="small" style={{ marginTop: "0.5rem" }}>
            Uploaded {progress.done}/{progress.total}
            {progress.errors.map((e) => (
              <div key={e} class="error">
                {e}
              </div>
            ))}
          </div>
        )}
      </label>

      {counts && counts.pending > 0 && (
        <div class="notice">
          {counts.pending} photo{counts.pending === 1 ? "" : "s"} waiting. In Claude Code, run{" "}
          <b>/pantrybase:ingest</b> and Claude will read each card, pair fronts with backs, and save
          the recipes.
        </div>
      )}

      <div class="tabs">
        {STATUSES.map((s) => (
          <button
            type="button"
            key={s}
            class={s === status ? "on" : ""}
            onClick={() => setStatus(s)}
          >
            {s} {counts ? <span class="muted">{counts[s]}</span> : null}
          </button>
        ))}
      </div>

      {inbox.data && inbox.data.items.length === 0 ? (
        <Empty>Nothing {status}.</Empty>
      ) : (
        <div class="thumbgrid">
          {inbox.data?.items.map((item) => (
            <div class="thumb" key={item.id}>
              <a href={fileUrl(item.path, 1600)} target="_blank" rel="noreferrer">
                <img src={fileUrl(item.path, 360)} alt={item.name} loading="lazy" />
              </a>
              <div class="tb">
                <div class="row" style={{ justifyContent: "space-between" }}>
                  <span title={item.name}>#{item.id}</span>
                  <span class="muted">{item.captured_at.slice(5, 16).replace("T", " ")}</span>
                </div>
                {item.retake_of && (
                  <Chip
                    tone="warn"
                    title={`Looks like photo #${item.retake_of.id} (distance ${item.retake_of.distance})`}
                  >
                    retake of #{item.retake_of.id}
                  </Chip>
                )}
                {item.recipe_slug && (
                  <a href={`/recipe/${item.recipe_slug}`}>→ {item.recipe_slug}</a>
                )}
                {item.reason && <span class="muted">{item.reason}</span>}
                {item.status !== "done" && (
                  <>
                    {item.status === "pending" && (
                      <input
                        type="text"
                        placeholder="reason (optional)"
                        value={reasons[item.id] ?? ""}
                        onInput={(e) =>
                          setReasons((r) => ({
                            ...r,
                            [item.id]: (e.target as HTMLInputElement).value,
                          }))
                        }
                      />
                    )}
                    <div class="row">
                      {item.status === "pending" ? (
                        <>
                          <button
                            type="button"
                            class="small"
                            onClick={() => resolve(item, "skipped")}
                          >
                            Skip
                          </button>
                          <button
                            type="button"
                            class="small"
                            onClick={() => resolve(item, "failed")}
                          >
                            Unreadable
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          class="small"
                          onClick={() => resolve(item, "pending")}
                        >
                          Back to queue
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
