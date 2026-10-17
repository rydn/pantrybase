import fs from "node:fs";
import path from "node:path";
import { homeDir, MODEL_ID, modelsDir, packageRoot } from "../config.js";
import {
  claudeVersion,
  PLUGIN_ID,
  registeredMarketplace,
  registeredPlugin,
  registerPlugin,
  type StepResult,
  unregisterPlugin,
} from "./claude.js";
import { run, tail } from "./run.js";

export interface InstallRecord {
  version: string;
  node: string;
  stableRoot: string;
  from: string;
  installedAt: string;
  registered: boolean;
}

function readJson<T>(file: string): T | undefined {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return undefined;
  }
}

export function installRecord(): InstallRecord | undefined {
  return readJson<InstallRecord>(path.join(homeDir(), "install.json"));
}

/**
 * Copy the package into ~/.pantrybase/plugin/node_modules/pantrybase with its production
 * dependencies (native modules included), so Claude Code always launches a stable, complete copy
 * no matter where `npx` or a dev checkout lives.
 */
export function materialize(from: string): {
  stableRoot: string;
  version: string;
  steps: StepResult[];
} {
  const home = homeDir();
  const tmp = path.join(home, "tmp");
  const pluginDir = path.join(home, "plugin");
  fs.mkdirSync(tmp, { recursive: true });
  fs.mkdirSync(pluginDir, { recursive: true });
  const steps: StepResult[] = [];

  // A dev checkout builds on pack; an installed package already ships dist/ and has no dev tools.
  const isDev =
    fs.existsSync(path.join(from, "src")) &&
    fs.existsSync(path.join(from, "node_modules", ".bin", "tsup"));
  for (const old of fs.readdirSync(tmp)) if (old.endsWith(".tgz")) fs.rmSync(path.join(tmp, old));
  const pack = run(
    "npm",
    ["pack", from, "--pack-destination", tmp, "--json", ...(isDev ? [] : ["--ignore-scripts"])],
    {
      cwd: from,
    },
  );
  if (!pack.ok) throw new Error(`npm pack failed: ${tail(pack.stderr || pack.stdout)}`);
  const packed = (
    JSON.parse(pack.stdout.slice(pack.stdout.indexOf("["))) as Array<{
      filename: string;
      version: string;
    }>
  )[0];
  if (!packed) throw new Error("npm pack produced no tarball");
  steps.push({
    step: "pack",
    ok: true,
    detail: `${packed.filename}${isDev ? " (built from source)" : ""}`,
  });

  fs.writeFileSync(
    path.join(pluginDir, "package.json"),
    `${JSON.stringify({ private: true, dependencies: { pantrybase: `file:../tmp/${packed.filename}` } }, null, 2)}\n`,
  );
  // The tarball name only changes with the version, so npm would keep a stale copy of the same
  // version; drop the old package and lockfile so the fresh tarball is always installed.
  fs.rmSync(path.join(pluginDir, "node_modules", "pantrybase"), { recursive: true, force: true });
  fs.rmSync(path.join(pluginDir, "package-lock.json"), { force: true });
  const inst = run("npm", ["install", "--omit=dev", "--no-audit", "--no-fund"], { cwd: pluginDir });
  if (!inst.ok) throw new Error(`npm install failed: ${tail(inst.stderr || inst.stdout)}`);
  const stableRoot = path.join(pluginDir, "node_modules", "pantrybase");
  // Guard against a stale copy: the installed server bundle must be the one just packed.
  const fresh = path.join(from, "dist", "server.js");
  const installed = path.join(stableRoot, "dist", "server.js");
  if (isDev && fs.existsSync(fresh) && fs.readFileSync(fresh, "utf8") !== fs.readFileSync(installed, "utf8")) {
    throw new Error(`installed copy at ${stableRoot} does not match the freshly built package`);
  }
  steps.push({ step: "install dependencies", ok: true, detail: stableRoot });
  return { stableRoot, version: packed.version, steps };
}

/** Load the native stack and run the MCP probe from the stable copy, with the pinned node. */
export function smokeTest(stableRoot: string, node = process.execPath): StepResult[] {
  const native = run(
    node,
    [
      "-e",
      `const r=require('node:module').createRequire(${JSON.stringify(path.join(stableRoot, "package.json"))});` +
        "const D=r('better-sqlite3');const v=r('sqlite-vec');const db=new D(':memory:');v.load(db);" +
        "db.exec(\"create virtual table t using fts5(x, tokenize='trigram')\");" +
        "const s=r('sharp');console.log(JSON.stringify({sqlite:db.prepare('select sqlite_version() v').get().v,vec:db.prepare('select vec_version() v').get().v,vips:s.versions.vips}))",
    ],
    { timeoutMs: 60_000 },
  );
  const probe = run(node, [path.join(stableRoot, "dist", "server.js"), "--probe"], {
    timeoutMs: 60_000,
  });
  let tools = 0;
  try {
    tools = (JSON.parse(probe.stdout) as { tools: string[] }).tools.length;
  } catch {
    // reported below
  }
  return [
    {
      step: "native modules",
      ok: native.ok,
      detail: native.ok ? native.stdout.trim() : tail(native.stderr),
    },
    {
      step: "MCP server probe",
      ok: probe.ok && tools > 0,
      detail: probe.ok ? `${tools} tools` : tail(probe.stderr),
    },
  ];
}

export function modelCached(): boolean {
  return fs.existsSync(path.join(modelsDir(), ...MODEL_ID.split("/")));
}

/** Download the embedding model now, so the first search doesn't wait minutes. */
export function warmModel(stableRoot: string, node = process.execPath): StepResult {
  if (modelCached()) return { step: "embedding model", ok: true, detail: `${MODEL_ID} (cached)` };
  const r = run(node, [path.join(stableRoot, "dist", "cli.js"), "warm-model"], {
    timeoutMs: 20 * 60_000,
  });
  return {
    step: "embedding model",
    ok: r.ok,
    detail: r.ok ? `${MODEL_ID} downloaded` : tail(r.stderr || r.stdout),
  };
}

export interface InstallOptions {
  from?: string;
  model?: boolean;
  register?: boolean;
}

export function install(opts: InstallOptions = {}): { ok: boolean; steps: StepResult[] } {
  const from = path.resolve(opts.from ?? packageRoot);
  const home = homeDir();
  const node = process.execPath;
  const { stableRoot, version, steps } = materialize(from);

  // Pin node and the stable copy for the bin/ shims (nvm/volta PATH changes never matter).
  fs.writeFileSync(path.join(home, "node-path"), node);
  fs.writeFileSync(path.join(home, "root-path"), stableRoot);
  steps.push({ step: "pin node", ok: true, detail: `${node} (${process.version})` });

  steps.push(...smokeTest(stableRoot, node));
  if (opts.model !== false) steps.push(warmModel(stableRoot, node));

  let registered = false;
  if (opts.register !== false) {
    const reg = registerPlugin(stableRoot);
    steps.push(...reg);
    registered = reg.length > 0 && reg.every((s) => s.ok);
  }

  const record: InstallRecord = {
    version,
    node,
    stableRoot,
    from,
    installedAt: new Date().toISOString(),
    registered,
  };
  fs.writeFileSync(path.join(home, "install.json"), `${JSON.stringify(record, null, 2)}\n`);
  return { ok: steps.every((s) => s.ok), steps };
}

export function uninstall(opts: { purge?: boolean } = {}): StepResult[] {
  const home = homeDir();
  const steps = unregisterPlugin();
  for (const f of ["plugin", "tmp", "node-path", "root-path", "install.json", "compile-cache"]) {
    fs.rmSync(path.join(home, f), { recursive: true, force: true });
  }
  steps.push({ step: "remove stable copy", ok: true, detail: path.join(home, "plugin") });
  if (opts.purge) {
    fs.rmSync(modelsDir(), { recursive: true, force: true });
    steps.push({ step: "remove model cache", ok: true, detail: modelsDir() });
  }
  return steps;
}

/** Everything that has to be true for the plugin to work, with what to do when it isn't. */
export function doctor(projectRoot: string, dataDir: string): StepResult[] {
  const rec = installRecord();
  const out: StepResult[] = [];
  const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
  out.push({
    step: "node",
    ok: major > 22 || (major === 22 && minor >= 12),
    detail: `${process.version} at ${process.execPath}${rec && rec.node !== process.execPath ? ` (pinned: ${rec.node})` : ""}`,
  });
  out.push({
    step: "installed copy",
    ok: !!rec && fs.existsSync(path.join(rec.stableRoot, "dist", "server.js")),
    detail: rec
      ? `${rec.version} at ${rec.stableRoot}`
      : "not installed — run `npx pantrybase install`",
  });
  if (rec)
    out.push(...smokeTest(rec.stableRoot, fs.existsSync(rec.node) ? rec.node : process.execPath));
  out.push({
    step: "embedding model",
    ok: modelCached(),
    detail: modelCached()
      ? `${MODEL_ID} in ${modelsDir()}`
      : "not downloaded yet (first search will fetch ~34 MB)",
  });
  const cv = claudeVersion();
  out.push({ step: "claude CLI", ok: !!cv, detail: cv ?? "not found on PATH" });
  if (cv) {
    const p = registeredPlugin();
    const m = registeredMarketplace();
    out.push({
      step: "plugin registered",
      ok: !!p?.enabled,
      detail: p
        ? `${PLUGIN_ID} ${p.version ?? ""} ${p.enabled ? "enabled" : "DISABLED"}, read from ${p.readFromFolder ?? m?.path ?? "?"}`
        : "not installed — run `npx pantrybase install`",
    });
  }
  const recipes = fs.existsSync(path.join(dataDir, "recipes"))
    ? fs.readdirSync(path.join(dataDir, "recipes")).filter((f) => f.endsWith(".md")).length
    : 0;
  out.push({
    step: "project data",
    ok: true,
    detail: fs.existsSync(dataDir)
      ? `${dataDir} (${recipes} recipes)`
      : `none yet in ${projectRoot}; created on first use`,
  });
  return out;
}
