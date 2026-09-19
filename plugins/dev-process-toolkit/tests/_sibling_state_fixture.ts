// Shared sibling-state trees for STE-609 (M_685ff6) — one real two-root tree
// per state of the closed sibling-state set.
//
// Leading underscore: a helper module, never collected as a suite.
//
// Every tree is built on `makeSpanFixture` (both roots real git repositories,
// each with one commit holding a toolkit-managed CLAUDE.md bound to
// FIXTURE_TRACKER_PROJECT). Root A is the invoking repository: its LIVE plan
// spans A (`.`) and the sibling B, and it holds one FR bound to the milestone —
// archived by default, so the milestone is locally ship-ready and only the
// sibling can hold it; `local: "active"` leaves it active instead, for the
// FR-scope resume leg (the last LOCAL active FR).
//
// Root B starts idle-capable and each state changes exactly the one fact that
// names it:
//
//   idle                — B holds a plan for the milestone and one ARCHIVED FR
//   busy                — idle, plus one ACTIVE FR in B's working tree
//   not-started         — B holds the plan and no FR bound to the milestone
//   no-plan             — B holds an archived FR and no plan
//   unlocatable         — A declares a path that does not exist
//   not-a-repository    — A declares a plain directory (plan, FR, CLAUDE.md, no git)
//   not-toolkit-managed — idle, with CLAUDE.md removed (and the removal committed)
//   different-container — idle, with CLAUDE.md bound to another tracker project
//   unreadable          — idle, with a CLAUDE.md declaration `readWorkspaceBinding`
//                         refuses (a `repo_tag` with no `min_dpt_version`)
//
// Callers own teardown: `cleanup()` in a `finally`.

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import {
  FIXTURE_TRACKER_PROJECT,
  FIXTURE_TRACKER_TEAM,
  GIT_ENV,
  type SpanFixture,
  claudeMd,
  commitAll,
  git,
  makeSpanFixture,
} from "./_span_fixture";

export const PLUGIN_ROOT = join(import.meta.dir, "..");
export const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");

export const MILESTONE = "M_GF_609";
export const A_NAME = "glacy-app-fe";
export const B_NAME = "glacy-app-be";
/** Root A's own FR bound to the milestone. */
export const A_FR = "STE-96090";
/** Root B's finished FR bound to the milestone. */
export const B_FR_DONE = "STE-96091";
/** Root B's unfinished FR bound to the milestone. */
export const B_FR_ACTIVE = "STE-96092";

/** The closed sibling-state set, in the FR's order. */
export const SIBLING_STATES = [
  "idle",
  "busy",
  "not-started",
  "no-plan",
  "unlocatable",
  "not-a-repository",
  "not-toolkit-managed",
  "different-container",
  "unreadable",
] as const;

export type SiblingStateName = (typeof SIBLING_STATES)[number];

/** Every state but `idle` — each one holds the release. */
export const NON_IDLE_STATES = SIBLING_STATES.filter(
  (s): s is Exclude<SiblingStateName, "idle"> => s !== "idle",
);

/** The verdict text `readWorkspaceBinding` refuses the `unreadable` sibling's CLAUDE.md with. */
export const UNREADABLE_READER_TEXT = 'repo_tag "glacy-be" is declared with no min_dpt_version';

export type Where = "live" | "archive";

/**
 * Write a plan for `token` under `root`, `shipped_in: null` unless `shippedIn`
 * says otherwise. An empty `spans` record omits `spans_repos:`. Returns the file.
 */
export function writePlan(
  root: string,
  where: Where,
  token: string,
  spans: Record<string, string>,
  opts: { shippedIn?: string | null; extra?: Record<string, string> } = {},
): string {
  const dir =
    where === "archive" ? join(root, "specs", "plan", "archive") : join(root, "specs", "plan");
  mkdirSync(dir, { recursive: true });
  const lines = [
    "---",
    `milestone: ${token}`,
    `status: ${where === "archive" ? "archived" : "active"}`,
    `archived_at: ${where === "archive" ? "2026-09-10T00:00:00Z" : "null"}`,
    opts.shippedIn === undefined || opts.shippedIn === null
      ? "shipped_in: null"
      : `shipped_in: ${opts.shippedIn}`,
  ];
  const entries = Object.entries(spans);
  if (entries.length > 0) {
    lines.push("spans_repos:");
    for (const [name, path] of entries) lines.push(`  ${name}: ${path}`);
  }
  for (const [key, value] of Object.entries(opts.extra ?? {})) lines.push(`${key}: ${value}`);
  lines.push("---", "", `# ${token}`, "");
  const file = join(dir, `${token}.md`);
  writeFileSync(file, lines.join("\n"));
  return file;
}

/** Write one FR file bound to `milestone` under `root`, active or archived. */
export function writeFr(
  root: string,
  id: string,
  milestone: string,
  status: "active" | "archived",
): void {
  const dir =
    status === "archived" ? join(root, "specs", "frs", "archive") : join(root, "specs", "frs");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${id}.md`),
    [
      "---",
      `title: ${id}`,
      `milestone: ${milestone}`,
      `status: ${status}`,
      `archived_at: ${status === "archived" ? "2026-09-10T00:00:00Z" : "null"}`,
      "---",
      "",
      `# ${id}`,
      "",
    ].join("\n"),
  );
}

/** The toolkit-managed CLAUDE.md both fixture roots carry, optionally overridden. */
export function boundClaudeMd(
  root: string,
  over: { project?: string; repoTag?: string; defaultLabels?: string[] } = {},
): void {
  claudeMd(root, {
    mode: "linear",
    team: FIXTURE_TRACKER_TEAM,
    project: over.project ?? FIXTURE_TRACKER_PROJECT,
    ...(over.repoTag !== undefined ? { repoTag: over.repoTag } : {}),
    ...(over.defaultLabels !== undefined ? { defaultLabels: over.defaultLabels } : {}),
  });
}

/** A's declaration: itself as `.`, and B at `bPath`. */
export const spansFromA = (bPath: string): Record<string, string> => ({
  [A_NAME]: ".",
  [B_NAME]: bPath,
});

/** B's declaration: A relative to B, and itself as `.`. */
export const spansFromB = (fx: SpanFixture): Record<string, string> => ({
  [A_NAME]: relative(fx.b, fx.a),
  [B_NAME]: ".",
});

export interface StateTree {
  readonly fx: SpanFixture;
  /** Root A — the invoking repository. */
  readonly a: string;
  /** The sibling's root as built (for `unlocatable`, the path that does not exist). */
  readonly sibling: string;
  /** A's live plan file. */
  readonly planFile: string;
  readonly state: SiblingStateName;
  cleanup(): void;
}

/** Make root B idle: its plan (naming A back) and one archived FR, committed. */
export function makeIdle(fx: SpanFixture): void {
  fx.planB(spansFromB(fx));
  fx.archivedFr(fx.b, B_FR_DONE, MILESTONE);
  commitAll(fx.b, "fixture: B idle on the milestone");
}

/**
 * Build the tree for one sibling state. `local` sets root A's own FR: archived
 * (the default — A is locally ship-ready) or active (A's last local active FR).
 */
export function buildState(
  state: SiblingStateName,
  opts: { local?: "archived" | "active" } = {},
): StateTree {
  const fx = makeSpanFixture(MILESTONE);
  const extra: string[] = [];
  const cleanup = (): void => {
    try {
      fx.cleanup();
    } finally {
      for (const d of extra) rmSync(d, { recursive: true, force: true });
    }
  };
  try {
    let sibling = fx.b;
    switch (state) {
      case "idle":
        makeIdle(fx);
        break;
      case "busy":
        makeIdle(fx);
        fx.activeFr(fx.b, B_FR_ACTIVE, MILESTONE);
        break;
      case "not-started":
        fx.planB(spansFromB(fx));
        commitAll(fx.b, "fixture: B plan, no FR");
        break;
      case "no-plan":
        fx.archivedFr(fx.b, B_FR_DONE, MILESTONE);
        commitAll(fx.b, "fixture: B FR, no plan");
        break;
      case "unlocatable":
        makeIdle(fx);
        sibling = `${fx.b}-no-such-sibling`;
        break;
      case "not-a-repository": {
        const plain = mkdtempSync(join(tmpdir(), "dpt-609-plain-"));
        extra.push(plain);
        boundClaudeMd(plain);
        writePlan(plain, "live", MILESTONE, { [A_NAME]: relative(plain, fx.a), [B_NAME]: "." });
        writeFr(plain, B_FR_DONE, MILESTONE, "archived");
        sibling = plain;
        break;
      }
      case "not-toolkit-managed":
        makeIdle(fx);
        git(fx.b, "rm", "-q", "CLAUDE.md");
        commitAll(fx.b, "fixture: B no longer toolkit-managed");
        break;
      case "different-container":
        makeIdle(fx);
        boundClaudeMd(fx.b, { project: "Another Tracker Project" });
        commitAll(fx.b, "fixture: B bound to another project");
        break;
      case "unreadable":
        makeIdle(fx);
        boundClaudeMd(fx.b, { repoTag: "glacy-be", defaultLabels: ["glacy-be"] });
        commitAll(fx.b, "fixture: B declaration the reader refuses");
        break;
    }
    const planFile = writePlan(fx.a, "live", MILESTONE, spansFromA(relative(fx.a, sibling)));
    if ((opts.local ?? "archived") === "archived") fx.archivedFr(fx.a, A_FR, MILESTONE);
    else fx.activeFr(fx.a, A_FR, MILESTONE);
    return { fx, a: fx.a, sibling, planFile, state, cleanup };
  } catch (e) {
    cleanup();
    throw e;
  }
}

/** Build, run `body`, always tear down. */
export async function withState<T>(
  state: SiblingStateName,
  body: (t: StateTree) => Promise<T> | T,
  opts: { local?: "archived" | "active" } = {},
): Promise<T> {
  const t = buildState(state, opts);
  try {
    return await body(t);
  } finally {
    t.cleanup();
  }
}

// ---------------------------------------------------------------- subprocesses

export interface Run {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export const describeRun = (r: Run): string =>
  `exit=${r.status}\n--- stdout ---\n${r.stdout}\n--- stderr ---\n${r.stderr}`;

/**
 * Spawn a plugin module by path from the plugin root, under GIT_ENV so a
 * developer's git config cannot move a verdict. Synchronous: one child at a
 * time, never an unbounded fan-out.
 */
export function runModule(relPath: string, args: readonly string[]): Run {
  const proc = spawnSync("bun", ["run", relPath, ...args], {
    cwd: PLUGIN_ROOT,
    env: { ...GIT_ENV, NO_COLOR: "1" },
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return { status: proc.status, stdout: proc.stdout ?? "", stderr: proc.stderr ?? "" };
}

/** Refusal #4's front door. */
export const SHIP_GATE_DOOR = "adapters/_shared/src/sibling_release.ts";
/** The `/implement` close-offer CLI. */
export const CLOSE_OFFER_DOOR = "adapters/_shared/src/active_plan_ship_ready.ts";
/** `/deliver`'s decision front door. */
export const DELIVER_DOOR = "adapters/_shared/src/deliver_decision.ts";

export function shipGateDoor(
  projectRoot: string,
  planFile: string,
  milestone: string,
  partial = false,
): Run {
  return runModule(SHIP_GATE_DOOR, [
    projectRoot,
    planFile,
    milestone,
    ...(partial ? ["--partial"] : []),
  ]);
}

export const closeOfferDoor = (projectRoot: string): Run =>
  runModule(CLOSE_OFFER_DOOR, [projectRoot]);

/** Non-empty lines of `s`. */
export const lines = (s: string): string[] => s.split("\n").filter((l) => l.trim() !== "");
