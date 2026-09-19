// Shared helpers for STE-610 (M_685ff6) — declaring a span in both plans,
// the one-sided state, and the shared-container children check.
//
// Leading underscore: a helper module, never collected as a suite.
//
// Every root is a REAL git repository from `makeSpanFixture` (GIT_ENV: no
// global or system git config). Callers own teardown: `cleanup()` in a
// `finally`. Every subprocess is spawned synchronously — one child at a time.

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";

import {
  FIXTURE_TRACKER_PROJECT,
  FIXTURE_TRACKER_TEAM,
  GIT_ENV,
  claudeMd,
  commitAll,
  git,
  makeSpanFixture,
  type SpanFixture,
} from "./_span_fixture";
import { A_NAME, B_NAME, PLUGIN_ROOT, type Run } from "./_sibling_state_fixture";

/** Root A's `repo_tag` — the same string the STE-609 trees use as A's span name. */
export const TAG_A = A_NAME;
/** Root B's `repo_tag`. */
export const TAG_B = B_NAME;
/** The first gated toolkit version — the lowest legal `min_dpt_version`. */
export const FLOOR = "2.87.0";

export const SPANS_DOOR = join(PLUGIN_ROOT, "adapters", "_shared", "src", "spans_repos.ts");
export const DECISION_DOOR = join(
  PLUGIN_ROOT,
  "adapters",
  "_shared",
  "src",
  "resolve_milestone_identity.ts",
);
export const SHIP_DOOR = join(PLUGIN_ROOT, "adapters", "_shared", "src", "sibling_release.ts");

export const SESSION = "s-610-declare-span";

/** A shared-container CLAUDE.md declaring `tag` (with its floor and default label). */
export function sharedClaudeMd(
  root: string,
  tag: string | null,
  opts: { mode?: "linear" | "jira"; project?: string } = {},
): void {
  const mode = opts.mode ?? "linear";
  claudeMd(root, {
    mode,
    ...(mode === "linear" ? { team: FIXTURE_TRACKER_TEAM } : {}),
    project: opts.project ?? FIXTURE_TRACKER_PROJECT,
    ...(tag !== null ? { repoTag: tag, minDptVersion: FLOOR, defaultLabels: [tag] } : {}),
  });
}

/** A `mode: none` CLAUDE.md (toolkit-managed, no tracker). */
export function noneClaudeMd(root: string): void {
  writeFileSync(
    join(root, "CLAUDE.md"),
    ["# Fixture Project", "", "## Task Tracking", "", "mode: none", "", "## Verification", "", "run_cmd: none", ""].join(
      "\n",
    ),
  );
}

/**
 * Write one FR under `root` bound to `milestone`, carrying a `tracker:` binding
 * of `key` under `adapter` — the file is named after the key, as a tracker-mode
 * FR is.
 */
export function trackedFr(
  root: string,
  key: string,
  milestone: string,
  status: "active" | "archived",
  adapter: "linear" | "jira",
): string {
  const dir =
    status === "archived" ? join(root, "specs", "frs", "archive") : join(root, "specs", "frs");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${key}.md`);
  writeFileSync(
    file,
    [
      "---",
      `title: ${key}`,
      `milestone: ${milestone}`,
      `status: ${status}`,
      `archived_at: ${status === "archived" ? "2026-09-10T00:00:00Z" : "null"}`,
      "tracker:",
      `  ${adapter}: ${key}`,
      "---",
      "",
      `# ${key}`,
      "",
    ].join("\n"),
  );
  return file;
}

/** Write a plan with NO `spans_repos:` for `milestone` under `root` (live). */
export function barePlan(root: string, milestone: string): string {
  const dir = join(root, "specs", "plan");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${milestone}.md`);
  writeFileSync(
    file,
    [
      "---",
      `milestone: ${milestone}`,
      "status: active",
      "archived_at: null",
      "shipped_in: null",
      "---",
      "",
      `# ${milestone}`,
      "",
      "Body text the declaration must never touch.",
      "",
    ].join("\n"),
  );
  return file;
}

/** Every file under `<root>/specs` and `<root>/CLAUDE.md`: path → bytes + mtime. */
export function snapshot(root: string): Map<string, { bytes: string; mtimeMs: number }> {
  const out = new Map<string, { bytes: string; mtimeMs: number }>();
  const walk = (dir: string): void => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else out.set(relative(root, p), { bytes: readFileSync(p, "utf-8"), mtimeMs: st.mtimeMs });
    }
  };
  walk(join(root, "specs"));
  const cm = join(root, "CLAUDE.md");
  if (existsSync(cm)) {
    out.set("CLAUDE.md", { bytes: readFileSync(cm, "utf-8"), mtimeMs: statSync(cm).mtimeMs });
  }
  return out;
}

/** A snapshot as a plain object, for a readable `toEqual` diff. */
export const snapshotObject = (root: string): Record<string, { bytes: string; mtimeMs: number }> =>
  Object.fromEntries(snapshot(root));

/** Spawn a module by absolute path with `cwd`, under GIT_ENV plus a session id. */
export function spawnDoor(module: string, args: readonly string[], cwd: string = PLUGIN_ROOT): Run {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries({ ...GIT_ENV, NO_COLOR: "1" })) if (v !== undefined) env[k] = v;
  delete env.CLAUDE_PLUGIN_ROOT;
  delete env.CLAUDE_PROJECT_DIR;
  env.CLAUDE_CODE_SESSION_ID = SESSION;
  const proc = spawnSync("bun", ["run", module, ...args], {
    cwd,
    env,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return { status: proc.status, stdout: proc.stdout ?? "", stderr: proc.stderr ?? "" };
}

/** The declare front door, run from the invoking checkout `cwd`. */
export const runDeclare = (cwd: string, planFile: string, milestone: string, sibling: string): Run =>
  spawnDoor(SPANS_DOOR, [planFile, milestone, "--declare", sibling], cwd);

/** Two tagged, toolkit-managed, same-container roots holding a bare plan each. */
export interface DeclarePair {
  readonly fx: SpanFixture;
  readonly a: string;
  readonly b: string;
  readonly planA: string;
  readonly planB: string;
  cleanup(): void;
}

/**
 * Root A and root B, each tagged (`TAG_A` / `TAG_B`) in the same tracker
 * container, the CLAUDE.md committed; each holds a bare live plan for
 * `milestone` in its working tree (B's also committed, so every git source
 * holds it).
 */
export function makeDeclarePair(
  milestone: string,
  opts: { tagA?: string | null; tagB?: string | null; mode?: "linear" | "jira"; project?: string } = {},
): DeclarePair {
  const fx = makeSpanFixture(milestone);
  try {
    const m = { mode: opts.mode, project: opts.project };
    sharedClaudeMd(fx.a, opts.tagA === undefined ? TAG_A : opts.tagA, m);
    commitAll(fx.a, "fixture: A tagged");
    sharedClaudeMd(fx.b, opts.tagB === undefined ? TAG_B : opts.tagB, m);
    commitAll(fx.b, "fixture: B tagged");
    const planA = barePlan(fx.a, milestone);
    const planB = barePlan(fx.b, milestone);
    commitAll(fx.b, "fixture: B plan");
    return { fx, a: fx.a, b: fx.b, planA, planB, cleanup: () => fx.cleanup() };
  } catch (e) {
    fx.cleanup();
    throw e;
  }
}

/** Does `declared`, read from `from`, land on the same directory as `target`? */
export function resolvesTo(from: string, declared: string, target: string): boolean {
  try {
    return realpathSync(resolve(realpathSync(from), declared)) === realpathSync(target);
  } catch {
    return false;
  }
}

/**
 * The NFR-10 shape every refusal carries: a verdict line, then `Remedy:` and
 * `Context:` lines. The verdict line's label is the refusing reader's own.
 */
export const NFR10 = [/^Remedy: /m, /^Context: /m] as const;

export { commitAll, git };
