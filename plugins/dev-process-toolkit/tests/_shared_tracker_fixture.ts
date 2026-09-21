// STE-616 (M_2306b6) — two real repositories bound to one tracker double.
//
// Leading underscore: a helper module, never collected as a suite.
//
// Built ON `makeSpanFixture` (tests/_span_fixture.ts), never beside it. Each
// root becomes a git repository whose history is:
//
//   1. the span fixture's own first commit;
//   2. `base` — a CLAUDE.md naming this fixture's tracker mode and container,
//      with NO shared-container declaration (branch `pre-declaration` points
//      here, so a worktree of it is, by contract, an undeclared repository);
//   3. `declare` — the declaration written by the M_947c79 declaration front
//      door (`adapters/_shared/src/setup/tracker_binding_write.ts --shared`),
//      spawned as a subprocess from `pluginRoot`. This file writes no
//      declaration key itself (AC-STE-616.1 scans it for the key literals).
//   4. `plans` — one committed milestone plan per root, bound to a container
//      seeded into the shared double (coexist: one container each; span: one
//      container both repositories carry).
//
// `makeSpanFixture` leaves teardown to its caller, so every scenario runs
// inside `withSharedTrackerFixture`, which calls `cleanup()` in `finally` —
// roots, worktrees and the scratch directory are all removed.

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeMd, commitAll, git, GIT_ENV, makeSpanFixture } from "./_span_fixture";
import { JiraDouble, type JiraShape, LinearDouble, type TrackerDouble } from "./_tracker_doubles";

export type Tracker = "jira" | "linear";
export type FixtureShape = "coexist" | "span";

/** The plugin tree this working copy ships (the default `pluginRoot`). */
export const REAL_PLUGIN_ROOT = realpathSync(join(import.meta.dir, ".."));

export const JIRA_PROJECT = "SHR";
export const LINEAR_TEAM = "STE";
export const LINEAR_PROJECT = "DPTShared";
export const TAG_A = "shr-app-a";
export const TAG_B = "shr-app-b";

/** A's writes go out under the first server spelling, B's under the second (AC-STE-616 § 4). */
export const SERVERS: Record<Tracker, { a: string; b: string }> = {
  jira: { a: "atlassian", b: "claude_ai_Atlassian" },
  linear: { a: "linear", b: "claude_ai_Linear" },
};

export interface MilestoneRef {
  /** The plan token (`M_SHR_1`, `M_a00011`). */
  token: string;
  /** The tracker container: a Jira Epic key or a Linear milestone id. */
  key: string;
  /** The container's title and the plan heading's title. */
  title: string;
}

export interface FixtureRepo {
  name: "a" | "b";
  root: string;
  tag: string;
  server: string;
  /** The writer's stdout (a unified diff) — the exact lines it added. */
  declarationDiff: string;
  milestone: MilestoneRef;
}

export interface SharedTrackerFixture {
  tracker: Tracker;
  shape: FixtureShape;
  pluginRoot: string;
  a: FixtureRepo;
  b: FixtureRepo;
  /** A realpath'd scratch directory for pages, listings and transcripts. */
  scratch: string;
  double: TrackerDouble;
  jira: JiraDouble | null;
  linear: LinearDouble | null;
  project: string;
  team: string | undefined;
  /** Add a `git worktree` of a root; `at: "pre-declaration"` checks out the branch whose CLAUDE.md predates the declaration. */
  addWorktree(repo: "a" | "b", opts?: { at?: "pre-declaration" | "HEAD"; branch?: string }): string;
  /** Register an extra path for removal in `cleanup()`. */
  track(path: string): void;
  cleanup(): void;
}

export interface SharedTrackerFixtureOptions {
  tracker: Tracker;
  shape: FixtureShape;
  pluginRoot?: string;
  /** Which measured Jira answer shape the Jira double speaks (default plain). */
  jiraShape?: JiraShape;
}

/** Hermetic env for a front-door spawn from `pluginRoot`. */
export function doorEnv(pluginRoot: string, session: string, extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(GIT_ENV)) if (v !== undefined) env[k] = v;
  delete env.CLAUDE_PROJECT_DIR;
  env.CLAUDE_PLUGIN_ROOT = pluginRoot;
  env.CLAUDE_CODE_SESSION_ID = session;
  return { ...env, ...extra };
}

/** `M_<Epic key>` — the plan token a Jira Epic derives. */
export function tokenOfEpic(key: string): string {
  return `M_${key.replace(/[^A-Za-z0-9_]/g, "_")}`;
}

/** `M_<first 6 hex>` — the plan token a Linear milestone id derives. */
export function tokenOfLinearMilestone(id: string): string {
  return `M_${id.slice(0, 6)}`;
}

/** Write `specs/plan/<token>.md` with the canonical heading the attach front door reads. */
export function writePlanFile(root: string, m: MilestoneRef, extraFrontmatter: string[] = []): string {
  mkdirSync(join(root, "specs", "plan"), { recursive: true });
  const p = join(root, "specs", "plan", `${m.token}.md`);
  writeFileSync(
    p,
    [
      "---",
      `milestone: ${m.token}`,
      "status: active",
      "archived_at: null",
      "shipped_in: null",
      ...extraFrontmatter,
      "---",
      "",
      `## ${m.token} — ${m.title} {#${m.token}}`,
      "",
      "Body.",
      "",
    ].join("\n"),
  );
  return p;
}

/** Seed one milestone container into the double and return its reference. */
export function seedContainer(fx: { tracker: Tracker; jira: JiraDouble | null; linear: LinearDouble | null; project: string }, title: string): MilestoneRef {
  if (fx.tracker === "jira") {
    const epic = fx.jira!.seed({ project: fx.project, summary: title, issuetype: "Epic", status: { name: "In Progress", category: "indeterminate" } });
    return { token: tokenOfEpic(epic.key), key: epic.key, title };
  }
  const ms = fx.linear!.seedMilestone(fx.project, title);
  return { token: tokenOfLinearMilestone(ms.id), key: ms.id, title };
}

function runWriter(pluginRoot: string, root: string, tracker: Tracker, tag: string): string {
  const args = [root, tracker, "--project", tracker === "jira" ? JIRA_PROJECT : LINEAR_PROJECT];
  if (tracker === "linear") args.push("--team", LINEAR_TEAM);
  args.push("--shared", tag);
  const p = spawnSync("bun", ["run", join(pluginRoot, "adapters", "_shared", "src", "setup", "tracker_binding_write.ts"), ...args], {
    env: doorEnv(pluginRoot, "fixture-declare"),
    encoding: "utf-8",
  });
  if (p.status !== 0) {
    throw new Error(`the declaration front door refused in ${root} (exit ${p.status}):\n${p.stdout}\n${p.stderr}`);
  }
  return p.stdout ?? "";
}

export function makeSharedTrackerFixture(opts: SharedTrackerFixtureOptions): SharedTrackerFixture {
  const pluginRoot = opts.pluginRoot ?? REAL_PLUGIN_ROOT;
  const span = makeSpanFixture("M_fixture", { repositories: true });
  const extra: string[] = [];
  const cleanup = () => {
    for (const root of [span.a, span.b]) {
      try {
        const out = spawnSync("git", ["worktree", "list", "--porcelain"], { cwd: root, env: GIT_ENV, encoding: "utf-8" });
        for (const line of (out.stdout ?? "").split("\n")) {
          if (line.startsWith("worktree ")) {
            const wt = line.slice("worktree ".length);
            if (wt !== realpathSync(root)) rmSync(wt, { recursive: true, force: true });
          }
        }
      } catch {
        /* the root may already be gone */
      }
    }
    for (const p of extra) rmSync(p, { recursive: true, force: true });
    span.cleanup();
  };
  try {
    const a = realpathSync(span.a);
    const b = realpathSync(span.b);
    const scratch = realpathSync(mkdtempSync(join(tmpdir(), "dpt-ste616-scratch-")));
    extra.push(scratch);
    const tracker = opts.tracker;
    const project = tracker === "jira" ? JIRA_PROJECT : LINEAR_PROJECT;
    const team = tracker === "linear" ? LINEAR_TEAM : undefined;
    const jira = tracker === "jira" ? new JiraDouble({}, opts.jiraShape ?? "plain") : null;
    const linear = tracker === "linear" ? new LinearDouble() : null;
    const double: TrackerDouble = (jira ?? linear)!;

    const diffs: Record<string, string> = {};
    for (const [root, tag] of [
      [a, TAG_A],
      [b, TAG_B],
    ] as const) {
      claudeMd(root, { mode: tracker, project, ...(team ? { team } : {}) });
      commitAll(root, "fixture: base CLAUDE.md, no shared declaration");
      git(root, "branch", "pre-declaration");
      diffs[root] = runWriter(pluginRoot, root, tracker, tag);
      commitAll(root, "fixture: shared-container declaration");
    }

    const ctx = { tracker, jira, linear, project };
    let mA: MilestoneRef;
    let mB: MilestoneRef;
    if (opts.shape === "span") {
      mA = seedContainer(ctx, "Shared Release");
      mB = mA;
    } else {
      mA = seedContainer(ctx, "Alpha Release");
      mB = seedContainer(ctx, "Beta Release");
    }
    writePlanFile(a, mA);
    commitAll(a, "fixture: milestone plan");
    writePlanFile(b, mB);
    commitAll(b, "fixture: milestone plan");

    const fx: SharedTrackerFixture = {
      tracker,
      shape: opts.shape,
      pluginRoot,
      a: { name: "a", root: a, tag: TAG_A, server: SERVERS[tracker].a, declarationDiff: diffs[a]!, milestone: mA },
      b: { name: "b", root: b, tag: TAG_B, server: SERVERS[tracker].b, declarationDiff: diffs[b]!, milestone: mB },
      scratch,
      double,
      jira,
      linear,
      project,
      team,
      addWorktree(repo, o = {}) {
        const root = repo === "a" ? a : b;
        const parent = realpathSync(mkdtempSync(join(tmpdir(), `dpt-ste616-wt-${repo}-`)));
        extra.push(parent);
        const wt = join(parent, "wt");
        const branch = o.branch ?? `wt-${Math.random().toString(36).slice(2, 8)}`;
        git(root, "worktree", "add", "-q", "-b", branch, wt, o.at === "pre-declaration" ? "pre-declaration" : "HEAD");
        return realpathSync(wt);
      },
      track(path) {
        extra.push(path);
      },
      cleanup,
    };
    return fx;
  } catch (e) {
    cleanup();
    throw e;
  }
}

/** Run `body` over a fresh fixture; `cleanup()` runs in `finally`, including when `body` throws. */
export async function withSharedTrackerFixture<T>(
  opts: SharedTrackerFixtureOptions,
  body: (fx: SharedTrackerFixture) => Promise<T> | T,
): Promise<T> {
  const fx = makeSharedTrackerFixture(opts);
  try {
    return await body(fx);
  } finally {
    fx.cleanup();
  }
}
