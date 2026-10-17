import { run, tail } from "./run.js";

export const PLUGIN_ID = "pantrybase@pantrybase";
const MARKETPLACE = "pantrybase";

interface MarketplaceEntry {
  name: string;
  path?: string;
  installLocation?: string;
}
interface PluginEntry {
  id: string;
  version?: string;
  enabled?: boolean;
  readFromFolder?: string;
}

function json<T>(args: string[]): T | undefined {
  const r = run("claude", args, { timeoutMs: 60_000 });
  if (!r.ok) return undefined;
  try {
    return JSON.parse(r.stdout) as T;
  } catch {
    return undefined;
  }
}

export function claudeVersion(): string | null {
  const r = run("claude", ["--version"], { timeoutMs: 20_000 });
  return r.ok ? r.stdout.trim() : null;
}

export function registeredPlugin(): PluginEntry | undefined {
  return json<PluginEntry[]>(["plugin", "list", "--json"])?.find((p) => p.id === PLUGIN_ID);
}

export function registeredMarketplace(): MarketplaceEntry | undefined {
  return json<MarketplaceEntry[]>(["plugin", "marketplace", "list", "--json"])?.find(
    (m) => m.name === MARKETPLACE,
  );
}

export interface StepResult {
  step: string;
  ok: boolean;
  detail: string;
}

/**
 * Register the stable copy as a directory marketplace and install the plugin at user scope.
 * Re-running points the marketplace at the new copy and refreshes the install.
 */
export function registerPlugin(stableRoot: string): StepResult[] {
  const steps: StepResult[] = [];
  if (!claudeVersion()) {
    return [
      {
        step: "claude CLI",
        ok: false,
        detail: "`claude` not found on PATH; install Claude Code, then re-run `pantrybase install`",
      },
    ];
  }

  const market = registeredMarketplace();
  if (market && (market.path ?? market.installLocation) !== stableRoot) {
    // Pointed somewhere else (e.g. an old dev checkout): re-add it at the stable copy.
    run("claude", ["plugin", "marketplace", "remove", MARKETPLACE], { timeoutMs: 60_000 });
  }
  const again = market && (market.path ?? market.installLocation) === stableRoot;
  const m = again
    ? run("claude", ["plugin", "marketplace", "update", MARKETPLACE], { timeoutMs: 120_000 })
    : run("claude", ["plugin", "marketplace", "add", stableRoot], { timeoutMs: 120_000 });
  steps.push({
    step: again ? "marketplace update" : "marketplace add",
    ok: m.ok,
    detail: m.ok ? stableRoot : tail(m.stderr || m.stdout),
  });
  if (!m.ok) return steps;

  const installed = registeredPlugin();
  const p = installed
    ? run("claude", ["plugin", "update", PLUGIN_ID, "--scope", "user"], { timeoutMs: 120_000 })
    : run("claude", ["plugin", "install", PLUGIN_ID, "--scope", "user"], { timeoutMs: 120_000 });
  steps.push({
    step: installed ? "plugin update" : "plugin install",
    ok: p.ok,
    detail: p.ok ? `${PLUGIN_ID} (user scope)` : tail(p.stderr || p.stdout),
  });
  return steps;
}

export function unregisterPlugin(): StepResult[] {
  const steps: StepResult[] = [];
  if (registeredPlugin()) {
    const u = run("claude", ["plugin", "uninstall", PLUGIN_ID, "--scope", "user"], {
      timeoutMs: 120_000,
    });
    steps.push({
      step: "plugin uninstall",
      ok: u.ok,
      detail: u.ok ? PLUGIN_ID : tail(u.stderr || u.stdout),
    });
  }
  if (registeredMarketplace()) {
    const r = run("claude", ["plugin", "marketplace", "remove", MARKETPLACE], {
      timeoutMs: 60_000,
    });
    steps.push({
      step: "marketplace remove",
      ok: r.ok,
      detail: r.ok ? MARKETPLACE : tail(r.stderr || r.stdout),
    });
  }
  return steps;
}
