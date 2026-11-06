// STE-719 (M_d1b4b7) shared fixture helper — the /retro rule engine and its
// front door.
//
// Leading underscore: a helper module, never collected as a suite.
//
// Two kinds of fixture:
//   - the committed case directories under tests/fixtures/m_d1b4b7-retro/,
//     each a `case.json` (scope sessions + the tracking switches the run saw)
//     beside a `ledger/` subtree laid out as `.dpt/ledger/` lays it out
//     (`tool-calls/<sid>.timeline.json`, `tool-calls/<sid>.jsonl`,
//     `token-ledger.jsonl`), in the M_7bc805 `tool-call-timeline/v1` and
//     `tool-call/v1` formats and the `token-ledger/v1` format;
//   - temp project trees built per test, outside the repo, for the
//     `bun run retro.ts` front door.
//
// Every session id is synthetic (00000000-0000-4000-8000-0000000000NN).

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { createHash } from "node:crypto";

export const PLUGIN_ROOT = resolve(import.meta.dir, "..");
export const REPO_ROOT = resolve(PLUGIN_ROOT, "..", "..");
export const SRC = join(PLUGIN_ROOT, "adapters", "_shared", "src");
export const RETRO_FRONT_DOOR = join(SRC, "retro.ts");
export const FIXTURE_ROOT = join(PLUGIN_ROOT, "tests", "fixtures", "m_d1b4b7-retro");

export const SKIPPED = "skipped: input not observable";
export const RULE_IDS = ["slow_gate_run", "gate_rerun_unchanged_key", "zero_yield_round", "cost_per_changed_line"] as const;
export const TIMELINE_RULE_IDS = ["slow_gate_run", "gate_rerun_unchanged_key", "zero_yield_round"] as const;

/** Synthetic session id number `n` (1..99). */
export function sid(n: number): string {
  return `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
}
export const SYNTHETIC_UUID = /^00000000-0000-4000-8000-(?:0000000000\d{2}|0000001000\d{2})$/;
export const UUID_RE = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g;

export type AnyMod = Record<string, any>;

export async function rulesMod(): Promise<AnyMod> {
  return (await import("../adapters/_shared/src/retro_rules")) as AnyMod;
}
export async function reportMod(): Promise<AnyMod> {
  return (await import("../adapters/_shared/src/retro_report")) as AnyMod;
}
export async function aliasMod(): Promise<AnyMod> {
  return (await import("../adapters/_shared/src/session_aliases")) as AnyMod;
}
export async function scopeMod(): Promise<AnyMod> {
  return (await import("../adapters/_shared/src/retro_scope")) as AnyMod;
}
export async function settingsMod(): Promise<AnyMod> {
  return (await import("../adapters/_shared/src/project_settings")) as AnyMod;
}

// ------------------------------------------------------------ engine inputs

export interface Tracking {
  token_stats: boolean;
  tool_calls: boolean;
  gate_outcomes: boolean;
}
export const ALL_ON: Tracking = { token_stats: true, tool_calls: true, gate_outcomes: true };

/**
 * The engine's input, as the front door hands it over: one entry per scope
 * session (its timeline or null, its capture rows), every token-ledger row of
 * the scope's sessions, and the tracking switches the project reads.
 */
export interface RetroInputs {
  sessions: { session_id: string; timeline: unknown | null; capture_rows: unknown[] }[];
  token_rows: unknown[];
  tracking: Tracking;
}

function jsonl(path: string): unknown[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf-8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l));
}

/** Load one committed case directory (relative to FIXTURE_ROOT) as engine inputs. */
export function loadCase(rel: string): RetroInputs {
  const dir = join(FIXTURE_ROOT, rel);
  const c = JSON.parse(readFileSync(join(dir, "case.json"), "utf-8")) as { sessions: string[]; tracking: Tracking };
  const calls = join(dir, "ledger", "tool-calls");
  return {
    sessions: c.sessions.map((s) => {
      const t = join(calls, `${s}.timeline.json`);
      return {
        session_id: s,
        timeline: existsSync(t) ? JSON.parse(readFileSync(t, "utf-8")) : null,
        capture_rows: jsonl(join(calls, `${s}.jsonl`)),
      };
    }),
    token_rows: jsonl(join(dir, "ledger", "token-ledger.jsonl")),
    tracking: { ...c.tracking },
  };
}

export function resultFor(results: any[], id: string): any {
  const r = results.find((x) => x.id === id);
  if (r === undefined) throw new Error(`no result for rule ${id}`);
  return r;
}

// ---------------------------------------------------------- inline builders

export const GC = "dev-process-toolkit:gate-check";
export const SR = "dev-process-toolkit:spec-review";
export const TDD = "dev-process-toolkit:tdd";
export const KEY_A = "a".repeat(64);
export const KEY_B = "b".repeat(64);

export function timeline(p: { calls?: unknown[]; rounds?: unknown[]; gate_runs?: unknown[] } = {}): Record<string, unknown> {
  return {
    schema: "tool-call-timeline/v1",
    calls: p.calls ?? [],
    rounds: p.rounds ?? [],
    gate_runs: p.gate_runs ?? [],
    gaps: { orphan_pre: 0, orphan_post: 0, uncaptured: 0, duplicates: 0 },
  };
}

export function gateRun(
  wall: number | null,
  o: Partial<{ subject: string; outcome: string; key_digest: string | null; key_stable: boolean | null }> = {},
): Record<string, unknown> {
  return {
    subject: o.subject ?? GC,
    ran_at: "2026-11-06T10:00:00.000Z",
    outcome: o.outcome ?? "pass",
    wall_ms: wall,
    key_digest: o.key_digest === undefined ? KEY_A : o.key_digest,
    key_stable: o.key_stable === undefined ? true : o.key_stable,
  };
}

let toolu = 900;
export function round(skill: string, changed: boolean | null): Record<string, unknown> {
  return {
    tool_use_id: `toolu_SYNTH_${++toolu}`,
    skill,
    status: "ok",
    tree_changed: changed,
    tree_disposition: changed === null ? "not-observable" : "observed",
    tokens: "not-observable",
  };
}

export function commitRows(ins: number, del: number, scope: "main" | "fork" = "main"): Record<string, unknown>[] {
  const base = { schema: "tool-call/v1", tool_use_id: `toolu_SYNTH_${++toolu}`, tool: "Bash", class: "commit", skill: null, tree: null, scope };
  return [
    { ...base, event: "pre", ts: "2026-11-06T10:05:00.000Z", diff: { files: 1, insertions: ins, deletions: del } },
    { ...base, event: "post", ts: "2026-11-06T10:05:01.000Z", diff: null },
  ];
}

export function tokenRow(session: string, output: number, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: "token-ledger/v1",
    ts: "2026-11-06T11:00:00.000Z",
    session_id: session,
    git_branch: "synthetic-branch",
    skill: "implement",
    model: "claude-synthetic",
    input_tokens: 100,
    output_tokens: output,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
    message_count: 3,
    ...extra,
  };
}

export function inputs(p: Partial<RetroInputs> & { sessions: RetroInputs["sessions"] }): RetroInputs {
  return { token_rows: [], tracking: { ...ALL_ON }, ...p };
}

export function session(n: number, t: unknown | null, capture: unknown[] = []): RetroInputs["sessions"][number] {
  return { session_id: sid(n), timeline: t, capture_rows: capture };
}

// ---------------------------------------------------------------- temp trees

const TEMPS: string[] = [];

export function tempDir(label: string): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), `md1b4b7-${label}-`)));
  TEMPS.push(d);
  return d;
}

export function cleanupTemps(): void {
  for (const d of TEMPS.splice(0)) rmSync(d, { recursive: true, force: true });
}

export const GIT_ENV: Record<string, string> = {
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_AUTHOR_NAME: "F",
  GIT_AUTHOR_EMAIL: "f@example.invalid",
  GIT_COMMITTER_NAME: "F",
  GIT_COMMITTER_EMAIL: "f@example.invalid",
};

export function git(cwd: string, ...args: string[]): string {
  const p = spawnSync("git", args, { cwd, encoding: "utf-8", env: { ...process.env, ...GIT_ENV } });
  if (p.status !== 0) throw new Error(`git ${args.join(" ")}: ${p.stderr}`);
  return p.stdout ?? "";
}

export const SETTINGS_HEAD = 'schema_version: 1\nmin_dpt_version: "3.0.0"\n';
export const SETUP_MD = "<!-- generated by /dev-process-toolkit:setup -->\n# Fixture\n\n## Key Commands\n\n- `bun test`\n";

export type RetroSetting = "absent" | "false" | "true";

export function retroBlock(setting: RetroSetting): string {
  if (setting === "absent") return "";
  return `retro:\n  enabled: ${setting}\n`;
}

export function trackingBlock(t: Tracking): string {
  return (
    "tracking:\n" +
    `  token_stats:\n    enabled: ${t.token_stats}\n` +
    `  gate_outcomes:\n    enabled: ${t.gate_outcomes}\n` +
    `  tool_calls:\n    enabled: ${t.tool_calls}\n`
  );
}

/**
 * A committed git checkout with a settings file, a `.dpt/.gitignore`
 * carrying the toolkit's `ledger/` rule, and nothing else under `.dpt/`.
 * The branch is named `feat/retro-fixture-branch` so a report can be scanned
 * for it.
 */
export function makeRetroTree(label: string, o: { retro?: RetroSetting; tracking?: Tracking; extraSettings?: string } = {}): string {
  const root = join(tempDir(label), "repo");
  mkdirSync(root, { recursive: true });
  git(root, "init", "-q", "-b", BRANCH);
  writeFileSync(join(root, "CLAUDE.md"), SETUP_MD);
  writeFileSync(join(root, "package.json"), '{"name":"fixture","version":"0.0.0","private":true}\n');
  mkdirSync(join(root, "specs"), { recursive: true });
  writeFileSync(
    join(root, "specs", "settings.yaml"),
    SETTINGS_HEAD + trackingBlock(o.tracking ?? ALL_ON) + retroBlock(o.retro ?? "absent") + (o.extraSettings ?? ""),
  );
  mkdirSync(join(root, ".dpt"), { recursive: true });
  writeFileSync(join(root, ".dpt", ".gitignore"), "ledger/\nscratch/\n");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "fixture");
  return realpathSync(root);
}
export const BRANCH = "feat/retro-fixture-branch";

/**
 * A config dir whose `projects/<slug-of-root>/` holds one transcript per
 * given session, each recording `cwd: root`; the newest mtime is the last.
 */
export function makeConfigDir(label: string, root: string, sessions: string[]): string {
  const dir = tempDir(label);
  const slug = root.replace(/[^A-Za-z0-9]/g, "-");
  const projects = join(dir, "projects", slug);
  mkdirSync(projects, { recursive: true });
  let t = Date.now() / 1000 - 1000;
  for (const s of sessions) {
    const p = join(projects, `${s}.jsonl`);
    writeFileSync(p, JSON.stringify({ type: "user", cwd: root, sessionId: s, gitBranch: BRANCH, message: { role: "user", content: "hi" } }) + "\n");
    utimesSync(p, t, t);
    t += 10;
  }
  return dir;
}

export function writeTimeline(root: string, session: string, t: unknown): void {
  const p = join(root, ".dpt", "ledger", "tool-calls", `${session}.timeline.json`);
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, JSON.stringify(t, null, 2) + "\n");
}

export function writeCaptureRows(root: string, session: string, rows: unknown[]): void {
  const p = join(root, ".dpt", "ledger", "tool-calls", `${session}.jsonl`);
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
}

export function writeTokenLedger(root: string, rows: unknown[]): void {
  const p = join(root, ".dpt", "ledger", "token-ledger.jsonl");
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
}

export function writeFr(root: string, rel: string, trackerId: string, milestone: string): void {
  const p = join(root, "specs", rel);
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(
    p,
    `---\ntitle: Synthetic ${trackerId}\nmilestone: ${milestone}\nstatus: active\narchived_at: null\ntracker:\n  linear: ${trackerId}\ncreated_at: 2026-11-06T00:00:00Z\n---\n\n# Synthetic ${trackerId}\n`,
  );
}

export interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** Run the front door `bun run retro.ts <root> [scope]` with cwd = root. */
export function runRetro(root: string, args: string[], env: Record<string, string> = {}, frontDoor = RETRO_FRONT_DOOR): RunResult {
  const p = spawnSync(process.execPath, ["run", frontDoor, root, ...args], {
    cwd: root,
    encoding: "utf-8",
    env: { ...process.env, ...GIT_ENV, CLAUDE_CONFIG_DIR: env.CLAUDE_CONFIG_DIR ?? tempDir("empty-config"), ...env },
    timeout: 60_000,
  });
  return { status: p.status, stdout: p.stdout ?? "", stderr: p.stderr ?? "" };
}

export function retroDir(root: string): string {
  return join(root, ".dpt", "ledger", "retro");
}

export function reportFiles(root: string): string[] {
  const d = retroDir(root);
  if (!existsSync(d)) return [];
  return readdirSync(d).sort();
}

export const REPORT_NAME_RE = /^[a-z0-9][a-z0-9_-]*-\d{8}T\d{6}Z\.json$/;

/** sha256 of every file under `.dpt/` except `ledger/retro/`, keyed by relative path. */
export function dptSnapshot(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const base = join(root, ".dpt");
  const walk = (d: string) => {
    if (!existsSync(d)) return;
    for (const name of readdirSync(d)) {
      const full = join(d, name);
      const rel = relative(base, full);
      if (rel === join("ledger", "retro")) continue;
      if (statSync(full).isDirectory()) walk(full);
      else out[rel] = createHash("sha256").update(readFileSync(full)).digest("hex");
    }
  };
  walk(base);
  return out;
}

export function gitStatus(root: string): string {
  return git(root, "status", "--porcelain", "--untracked-files=all");
}

export function pluginVersion(): string {
  return JSON.parse(readFileSync(join(PLUGIN_ROOT, ".claude-plugin", "plugin.json"), "utf-8")).version;
}
