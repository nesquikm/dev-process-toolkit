// Shared two-root fixture for cross-repository (`spans_repos:`) behaviour —
// M_8f07e0. Created by STE-583 as its first consumer; graded by STE-587.
//
// Leading underscore: a helper module, never collected as a suite.
//
// Why REAL directories: `defaultRepoProbe().locate` answers from `existsSync`
// and `isDirectory`, so a sibling root only "locates" if it is really on disk.
// Why realpathSync at every comparison: macOS `mkdtempSync` hands back a
// `/var/…` path that resolves to `/private/var/…`, so a raw `===` between a
// probe-located root and a fixture root is a coin toss across platforms.
//
// Callers own teardown: build the fixture, run the body inside `try`, and call
// `cleanup()` in `finally` so a throwing test body still removes both roots.
//
// Why REAL git repositories (AC-STE-609.10): the sibling release gate reads a
// sibling from git — its worktrees, local branches and remote-tracking refs —
// and only a git repository that is toolkit-managed and bound to the same
// tracker project as this one can ever be `idle`. So each root is `git init`ed
// with one commit holding a toolkit-managed CLAUDE.md bound to
// FIXTURE_TRACKER_PROJECT. Plans and FRs written afterwards sit in the working
// tree, uncommitted: the worktree leg reads them, exactly as before. Every git
// call runs with GIT_ENV, so a developer's global git config cannot move a
// verdict.

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface SpanFixture {
  /**
   * Root A — the invoking repository. Both roots are git repositories on
   * `main` with one commit holding a toolkit-managed CLAUDE.md bound to
   * FIXTURE_TRACKER_PROJECT (AC-STE-609.10).
   */
  a: string;
  /** Root B — the sibling repository. */
  b: string;
  /**
   * Write `specs/plan/<milestone>.md` in root A: a tracker-mode plan (no `id:`
   * key) with `status: active`, `archived_at: null`, `shipped_in: null`, a
   * 2-space nested `spans_repos:` map built from `spans` in insertion order,
   * and any `extra` frontmatter keys. An EMPTY `spans` record omits the
   * `spans_repos:` key entirely — the undeclared state — rather than writing a
   * bare key, which is a malformed spelling.
   */
  planA(spans: Record<string, string>, extra?: Record<string, string>): void;
  /** The same plan, written in root B. */
  planB(spans: Record<string, string>, extra?: Record<string, string>): void;
  /** Write `specs/frs/<id>.md` under `root`, `status: active`, bound to `milestone`. */
  activeFr(root: string, id: string, milestone: string): void;
  /** Write `specs/frs/archive/<id>.md` under `root`, `status: archived`, bound to `milestone`. */
  archivedFr(root: string, id: string, milestone: string): void;
  /** Remove both roots (recursive, force). Safe to call more than once. */
  cleanup(): void;
}

function planBody(
  milestone: string,
  spans: Record<string, string>,
  extra: Record<string, string>,
): string {
  const lines = [
    "---",
    `milestone: ${milestone}`,
    "status: active",
    "archived_at: null",
    "shipped_in: null",
  ];
  const entries = Object.entries(spans);
  if (entries.length > 0) {
    lines.push("spans_repos:");
    for (const [name, path] of entries) lines.push(`  ${name}: ${path}`);
  }
  for (const [key, value] of Object.entries(extra)) lines.push(`${key}: ${value}`);
  lines.push("---", "", `# ${milestone}`, "");
  return lines.join("\n");
}

function frBody(
  id: string,
  milestone: string,
  status: "active" | "archived",
): string {
  return [
    "---",
    `title: ${id}`,
    `milestone: ${milestone}`,
    `status: ${status}`,
    `archived_at: ${status === "archived" ? "2026-09-10T00:00:00Z" : "null"}`,
    "---",
    "",
    `# ${id}`,
    "",
  ].join("\n");
}

/** The tracker project both fixture roots' CLAUDE.md bind to. */
export const FIXTURE_TRACKER_PROJECT = "Span Fixture Project";
/** The tracker team both fixture roots' CLAUDE.md bind to. */
export const FIXTURE_TRACKER_TEAM = "STE";

/**
 * A hermetic environment for every git call a fixture makes: no global or
 * system config, a fixed identity and fixed dates, no pager, no prompt.
 */
export const GIT_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Span Fixture",
  GIT_AUTHOR_EMAIL: "span-fixture@example.invalid",
  GIT_COMMITTER_NAME: "Span Fixture",
  GIT_COMMITTER_EMAIL: "span-fixture@example.invalid",
  GIT_AUTHOR_DATE: "2026-09-10T00:00:00Z",
  GIT_COMMITTER_DATE: "2026-09-10T00:00:00Z",
  GIT_TERMINAL_PROMPT: "0",
  GIT_PAGER: "cat",
};

/** Run git in `cwd` under GIT_ENV; throws with git's stderr on a non-zero exit. */
export function git(cwd: string, ...args: string[]): string {
  const proc = spawnSync("git", args, { cwd, env: GIT_ENV, encoding: "utf-8" });
  if (proc.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed in ${cwd} (exit ${proc.status}): ${proc.stderr ?? ""}`,
    );
  }
  return proc.stdout ?? "";
}

/** Stage everything under `root` and commit it (empty commits allowed). */
export function commitAll(root: string, message: string): void {
  git(root, "add", "-A");
  git(root, "commit", "-q", "--allow-empty", "-m", message);
}

/** Options for {@link makeSpanFixture}. */
export interface SpanFixtureOptions {
  /**
   * `true` (the default): each root is a git repository with one commit
   * holding a toolkit-managed CLAUDE.md. `false`: the pre-AC-STE-609.10 shape —
   * plain directories holding only the spec skeleton — for suites that build
   * their own CLAUDE.md or git state, or grade a root that is NOT a repository.
   */
  repositories?: boolean;
}

function makeRoot(label: string, repositories: boolean): string {
  const root = mkdtempSync(join(tmpdir(), `dpt-span-${label}-`));
  try {
    mkdirSync(join(root, "specs", "plan"), { recursive: true });
    mkdirSync(join(root, "specs", "frs", "archive"), { recursive: true });
    if (!repositories) return root;
    git(root, "init", "-q", "-b", "main");
    claudeMd(root, {
      mode: "linear",
      team: FIXTURE_TRACKER_TEAM,
      project: FIXTURE_TRACKER_PROJECT,
    });
    git(root, "add", "CLAUDE.md");
    git(root, "commit", "-q", "-m", "fixture: toolkit-managed root");
  } catch (e) {
    rmSync(root, { recursive: true, force: true });
    throw e;
  }
  return root;
}

export function makeSpanFixture(
  milestone: string,
  options: SpanFixtureOptions = {},
): SpanFixture {
  const repositories = options.repositories ?? true;
  const a = makeRoot("a", repositories);
  let b: string;
  try {
    b = makeRoot("b", repositories);
  } catch (e) {
    rmSync(a, { recursive: true, force: true });
    throw e;
  }

  const writePlan = (
    root: string,
    spans: Record<string, string>,
    extra: Record<string, string> = {},
  ): void => {
    writeFileSync(
      join(root, "specs", "plan", `${milestone}.md`),
      planBody(milestone, spans, extra),
    );
  };

  return {
    a,
    b,
    planA(spans, extra) {
      writePlan(a, spans, extra);
    },
    planB(spans, extra) {
      writePlan(b, spans, extra);
    },
    activeFr(root, id, m) {
      writeFileSync(join(root, "specs", "frs", `${id}.md`), frBody(id, m, "active"));
    },
    archivedFr(root, id, m) {
      writeFileSync(
        join(root, "specs", "frs", "archive", `${id}.md`),
        frBody(id, m, "archived"),
      );
    },
    cleanup() {
      try {
        rmSync(a, { recursive: true, force: true });
      } finally {
        rmSync(b, { recursive: true, force: true });
      }
    },
  };
}

// ------------------------------------------------------------ STE-602 helpers

export interface ClaudeMdFixtureOpts {
  /** The active tracker mode; also selects the `### Jira` / `### Linear` sub-section. */
  mode: "jira" | "linear";
  project?: string;
  team?: string;
  defaultLabels?: string[];
  repoTag?: string;
  minDptVersion?: string;
  /** Free text appended verbatim to the end of the tracker sub-section. */
  paragraph?: string;
}

/**
 * Write `<root>/CLAUDE.md` with a `## Task Tracking` section whose active
 * tracker sub-section carries the given keys. Absent options omit their line.
 */
export function claudeMd(root: string, opts: ClaudeMdFixtureOpts): void {
  const lines = [
    "# Fixture Project",
    "",
    "## Task Tracking",
    "",
    `mode: ${opts.mode}`,
    `mcp_server: ${opts.mode === "jira" ? "atlassian" : "linear"}`,
    "",
    opts.mode === "jira" ? "### Jira" : "### Linear",
    "",
  ];
  if (opts.team !== undefined) lines.push(`team: ${opts.team}`);
  if (opts.project !== undefined) lines.push(`project: ${opts.project}`);
  if (opts.defaultLabels !== undefined) {
    lines.push(`default_labels: [${opts.defaultLabels.join(", ")}]`);
  }
  if (opts.repoTag !== undefined) lines.push(`repo_tag: ${opts.repoTag}`);
  if (opts.minDptVersion !== undefined) lines.push(`min_dpt_version: ${opts.minDptVersion}`);
  if (opts.paragraph !== undefined) lines.push("", opts.paragraph);
  lines.push("", "## Verification", "", "run_cmd: none", "");
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "CLAUDE.md"), lines.join("\n"));
}

/** Write `<dir>/.claude-plugin/plugin.json` declaring `version`. */
export function pluginManifest(dir: string, version: string): void {
  mkdirSync(join(dir, ".claude-plugin"), { recursive: true });
  writeFileSync(
    join(dir, ".claude-plugin", "plugin.json"),
    JSON.stringify({ name: "dev-process-toolkit", version }, null, 2) + "\n",
  );
}
