import { spawnSync } from "node:child_process";

export interface RunResult {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Run a command synchronously, capturing output (never inheriting stdout). */
export function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {},
): RunResult {
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    encoding: "utf8",
    timeout: opts.timeoutMs ?? 10 * 60_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    ok: r.status === 0 && !r.error,
    code: r.status,
    stdout: r.stdout ?? "",
    stderr: r.error ? String(r.error) : (r.stderr ?? ""),
  };
}

export function tail(s: string, n = 400): string {
  const t = s.trim();
  return t.length > n ? `…${t.slice(-n)}` : t;
}
