import fs from "node:fs";
import { log, MODEL_ID, modelsDir } from "../config.js";

const QUERY_PREFIX = "Represent this sentence for searching relevant passages: ";
const BATCH = 16;
const MAX_CHARS = 2000;

type Pipe = (
  texts: string[],
  opts: { pooling: "cls" | "mean"; normalize: boolean },
) => Promise<{ tolist(): number[][] }>;

/** Lazy bge-small embedder on CPU (q8). The model is downloaded on first use or by `install`. */
export class Embedder {
  private pipe: Promise<Pipe> | null = null;
  private loaded = false;

  constructor(readonly modelId: string = MODEL_ID) {}

  get ready(): boolean {
    return this.loaded;
  }

  load(): Promise<Pipe> {
    if (!this.pipe) {
      this.pipe = (async () => {
        const tf = await import("@huggingface/transformers");
        fs.mkdirSync(modelsDir(), { recursive: true });
        tf.env.cacheDir = modelsDir();
        const started = Date.now();
        const p = (await tf.pipeline("feature-extraction", this.modelId, {
          dtype: "q8",
          device: "cpu",
        })) as unknown as Pipe;
        log(`embedding model ${this.modelId} ready in ${Date.now() - started}ms`);
        this.loaded = true;
        return p;
      })();
      this.pipe.catch((e) => {
        log("embedding model failed to load:", e);
        this.pipe = null;
      });
    }
    return this.pipe;
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    const pipe = await this.load();
    const out: Float32Array[] = [];
    for (let i = 0; i < texts.length; i += BATCH) {
      const batch = texts.slice(i, i + BATCH).map((t) => t.slice(0, MAX_CHARS));
      const tensor = await pipe(batch, { pooling: "cls", normalize: true });
      for (const v of tensor.tolist()) out.push(Float32Array.from(v));
    }
    return out;
  }

  async embedQuery(query: string): Promise<Float32Array> {
    const [v] = await this.embed([QUERY_PREFIX + query]);
    if (!v) throw new Error("empty embedding");
    return v;
  }
}
