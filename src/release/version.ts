/**
 * Decide the next npm version on a merge to main (run by .github/workflows/release.yml).
 * Every merge publishes: breaking changes bump major (minor while 0.x), `feat` bumps minor,
 * anything else bumps patch. Release commits themselves are ignored.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type Bump = "major" | "minor" | "patch";

export const RELEASE_PREFIX = "chore(release):";

export interface Commit {
  subject: string;
  body: string;
}

export function bumpFor(commits: Commit[], current: string): Bump | null {
  const relevant = commits.filter((c) => !c.subject.startsWith(RELEASE_PREFIX));
  if (relevant.length === 0) return null;
  const breaking = relevant.some(
    (c) => /^\w+(\([^)]*\))?!:/.test(c.subject) || /BREAKING[ -]CHANGE/.test(c.body),
  );
  const feat = relevant.some((c) => /^feat(\([^)]*\))?!?:/.test(c.subject));
  const preOne = current.startsWith("0.");
  if (breaking) return preOne ? "minor" : "major";
  if (feat) return "minor";
  return "patch";
}

export function applyBump(version: string, bump: Bump): string {
  const [major = 0, minor = 0, patch = 0] = version.split("-")[0]?.split(".").map(Number) ?? [];
  if (bump === "major") return `${major + 1}.0.0`;
  if (bump === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

export interface Decision {
  release: boolean;
  version: string;
  bump: Bump | "initial" | "none";
  previous_tag: string | null;
  commits: number;
}

/**
 * With no `v*` tag yet, the current package.json version is the first release. Otherwise the
 * commits since the last tag decide the bump.
 */
export function decide(current: string, lastTag: string | null, commits: Commit[]): Decision {
  if (!lastTag) {
    return {
      release: true,
      version: current,
      bump: "initial",
      previous_tag: null,
      commits: commits.length,
    };
  }
  const bump = bumpFor(commits, current);
  if (!bump)
    return { release: false, version: current, bump: "none", previous_tag: lastTag, commits: 0 };
  // Tags are the record of what was published, so bump from the tag, not from package.json.
  return {
    release: true,
    version: applyBump(lastTag.replace(/^v/, ""), bump),
    bump,
    previous_tag: lastTag,
    commits: commits.length,
  };
}

function git(args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function main(): void {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const { version } = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as {
    version: string;
  };
  let lastTag: string | null = null;
  try {
    lastTag = git(["describe", "--tags", "--match", "v[0-9]*", "--abbrev=0"]);
  } catch {
    lastTag = null;
  }
  const SEP = "\u001e";
  const log = git(["log", lastTag ? `${lastTag}..HEAD` : "HEAD", `--format=%s%n%b${SEP}`]);
  const commits = log
    .split(SEP)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [subject = "", ...rest] = entry.split("\n");
      return { subject, body: rest.join("\n") };
    });
  const d = decide(version, lastTag, commits);
  // key=value lines for $GITHUB_OUTPUT, plus a readable summary on stderr.
  process.stdout.write(`release=${d.release}\nversion=${d.version}\nbump=${d.bump}\n`);
  process.stderr.write(`${JSON.stringify(d)}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
