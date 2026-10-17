import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const MODEL_ID = "Xenova/bge-small-en-v1.5";
export const EMBED_DIMS = 384;
export const DEFAULT_UI_PORT = 7433;

/** Root of the installed package (works from src/ via tsx and from dist/ after tsup). */
export const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function homeDir(): string {
  return process.env.PANTRYBASE_HOME ?? path.join(os.homedir(), ".pantrybase");
}

export function modelsDir(): string {
  return path.join(homeDir(), "models");
}

export function resolveProjectRoot(given?: string): string {
  return path.resolve(given ?? process.env.PANTRYBASE_PROJECT_ROOT ?? process.cwd());
}

export interface DataPaths {
  root: string;
  data: string;
  recipes: string;
  inbox: string;
  images: string;
  db: string;
  ingredientsYaml: string;
  vocabularyYaml: string;
  /** Project-local provider profiles that add to or override the built-in ones. */
  providers: string;
}

export function dataPaths(projectRoot: string): DataPaths {
  const data = process.env.PANTRYBASE_DATA
    ? path.resolve(projectRoot, process.env.PANTRYBASE_DATA)
    : path.join(projectRoot, "pantrybase");
  return {
    root: projectRoot,
    data,
    recipes: path.join(data, "recipes"),
    inbox: path.join(data, "inbox"),
    images: path.join(data, "images"),
    db: path.join(data, "pantrybase.db"),
    ingredientsYaml: path.join(data, "ingredients.yaml"),
    vocabularyYaml: path.join(data, "vocabulary.yaml"),
    providers: path.join(data, "providers"),
  };
}

export function ensureDataDirs(p: DataPaths): void {
  for (const dir of [p.data, p.recipes, p.inbox, p.images]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/** All diagnostics go to stderr: stdout belongs to the MCP transport. */
export function log(...args: unknown[]): void {
  console.error("[pantrybase]", ...args);
}
