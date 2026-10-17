import { log } from "../config.js";
import type { StorageAdapter } from "../storage/types.js";
import type { Embedder } from "./model.js";

const PASS = 64;

/** Debounced, single-flight embedding of chunks with embed_pending = 1. */
export class EmbedQueue {
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private stopped = false;

  constructor(
    private readonly store: StorageAdapter,
    private readonly embedder: Embedder | null,
  ) {}

  /** Cancel any scheduled pass; called before the store closes. */
  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  kick(delayMs = 300): void {
    if (!this.embedder || this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.run();
    }, delayMs);
    this.timer.unref();
  }

  /** Embed everything pending; resolves when the queue is drained. */
  run(): Promise<void> {
    if (!this.embedder || this.stopped) return Promise.resolve();
    if (this.running) return this.running;
    const embedder = this.embedder;
    this.running = (async () => {
      try {
        while (!this.stopped) {
          const pending = this.store.pendingChunks(PASS);
          if (pending.length === 0) break;
          const vectors = await embedder.embed(pending.map((p) => p.text));
          if (this.stopped) break; // the store may have closed while the model was busy
          this.store.storeEmbeddings(
            pending.map((p, i) => {
              const embedding = vectors[i];
              if (!embedding) throw new Error("embedding count mismatch");
              return { id: p.id, embedding };
            }),
          );
        }
      } catch (e) {
        log("embedding pass failed:", e);
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }
}
