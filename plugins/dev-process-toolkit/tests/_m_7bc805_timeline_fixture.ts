// STE-717 (M_7bc805) shared fixture helper — the tool-call timeline reader and
// its session-stop fold.
//
// Leading underscore: a helper module, never collected as a suite.
//
// The shapes these suites assume (the FR's Requirement is the design):
//
//   adapters/_shared/src/tool_call_timeline.ts   the reader; CLI
//       `bun run tool_call_timeline.ts <transcript> <checkout root>` prints the
//       `tool-call-timeline/v1` JSON and exits 0; the session id is the
//       transcript's basename without `.jsonl`.
//   adapters/_shared/src/dpt_paths.ts            `toolCallTimelinePath(root, sid)`
//       = `<root>/.dpt/ledger/tool-calls/<sid>.timeline.json`
//   templates/hooks/process/session-token-ledger.sh  the fold's wrapper
//
// Every transcript is built in a temp dir in the measured Claude Code record
// shape (STE-714): `{ type, timestamp, cwd, gitBranch, sessionId, message: {
// role, content: [ blocks ] } }`. A forked Skill call's tool_result is the
// background stub; its result block arrives later as a `<task-notification>`
// (a `queue-operation` enqueue record and/or a `user` text record) carrying
// `<tool-use-id>` and a `<result>…</result>` body.
//
// All names, paths and ids are synthetic.

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { readSpecFile } from "./_spec_tree";
import { GIT_ENV, PLUGIN_REL, PLUGIN_ROOT, REPO_ROOT, V300, makeCheckout, recordFor, runRegistration, tempDir } from "./_m_7bc805_capture_fixture";

export const TIMELINE_REL = "adapters/_shared/src/tool_call_timeline.ts";
export const TIMELINE_MODULE = join(PLUGIN_ROOT, TIMELINE_REL);
export const LEDGER_WRAPPER_REL = "templates/hooks/process/session-token-ledger.sh";
export const LEDGER_ENTRY_REL = "templates/hooks/_lib/hooks/session-token-ledger.ts";

/** Base instant for every fixture timestamp. */
export const T0 = Date.parse("2026-11-06T10:00:00.000Z");
export const iso = (ms: number): string => new Date(ms).toISOString();

// ------------------------------------------------------------ the closed sets

export const TOP_KEYS = ["schema", "calls", "rounds", "gate_runs", "gaps"].sort();
/** D2 answered no: no `exit_code`. */
export const CALL_KEYS = [
  "tool_use_id",
  "tool",
  "class",
  "skill",
  "started_at",
  "ended_at",
  "wall_ms",
  "is_error",
  "diff",
  "duration_ms",
  "pairing",
].sort();
export const ROUND_KEYS = ["tool_use_id", "skill", "status", "tree_changed", "tree_disposition", "tokens"].sort();
export const GATE_RUN_KEYS = ["subject", "ran_at", "outcome", "wall_ms", "key_digest", "key_stable"].sort();
export const GAP_KEYS = ["orphan_pre", "orphan_post", "uncaptured", "duplicates"].sort();

// ---------------------------------------------------------- decision table

/** The STE-714 decision table's answer for row `Dn` (`yes` → true). */
export function decision(row: "D1" | "D2" | "D3" | "D4" | "D5" | "D6"): boolean {
  const body = readSpecFile(REPO_ROOT, "specs/notes", "ste-714-hook-payload-measurement.md").body;
  const m = new RegExp(`^\\| ${row} \\| \\*\\*(yes|no)\\*\\* \\|`, "m").exec(body);
  if (m === null) throw new Error(`decision row ${row} not found in the STE-714 notes`);
  return m[1] === "yes";
}

// ------------------------------------------------------------- transcripts

export interface RecOpts {
  cwd?: string;
  gitBranch?: string;
  sid?: string;
  /** Omit the record's timestamp entirely (an unstamped copy). */
  unstamped?: boolean;
  extra?: Record<string, unknown>;
}

function base(type: string, at: number, o: RecOpts): Record<string, unknown> {
  const r: Record<string, unknown> = { type, sessionId: o.sid ?? "00000000-0000-4000-8000-000000000717", isSidechain: false };
  if (!o.unstamped) r.timestamp = iso(at);
  if (o.cwd !== undefined) r.cwd = o.cwd;
  if (o.gitBranch !== undefined) r.gitBranch = o.gitBranch;
  return { ...r, ...(o.extra ?? {}) };
}

export function toolUse(id: string, name: string, input: Record<string, unknown>, at: number, o: RecOpts = {}): string {
  return JSON.stringify({
    ...base("assistant", at, o),
    message: { role: "assistant", content: [{ type: "tool_use", id, name, input }] },
  });
}

export const bashUse = (id: string, command: string, at: number, o: RecOpts = {}): string =>
  toolUse(id, "Bash", { command, description: "synthetic" }, at, o);

export const skillUse = (id: string, skill: string, at: number, o: RecOpts = {}): string =>
  toolUse(id, "Skill", { skill, args: "synthetic" }, at, o);

/**
 * A tool_result record. `isError: undefined` leaves the field out entirely
 * (the measured shape of many results); `content` is the result text.
 */
export function toolResult(id: string, at: number, opts: { isError?: boolean; content?: unknown } & RecOpts = {}): string {
  const block: Record<string, unknown> = { type: "tool_result", tool_use_id: id };
  if (opts.isError !== undefined) block.is_error = opts.isError;
  if (opts.content !== undefined) block.content = opts.content;
  return JSON.stringify({ ...base("user", at, opts), message: { role: "user", content: [block] } });
}

export const stubFor = (skill: string): string => `Running in the background as @${skill.replace(":", "-")}`;

function notificationText(id: string, agent: string, result: string): string {
  return (
    `<task-notification>\n<task-id>${agent}</task-id>\n<tool-use-id>${id}</tool-use-id>\n` +
    `<output-file>/synthetic/repo/tmp/tasks/${agent}.output</output-file>\n<status>completed</status>\n` +
    `<summary>Agent finished</summary>\n<result>${result}</result>\n</task-notification>`
  );
}

/** The `<task-notification>` for a forked call, as a queue-operation enqueue record, a user text record, or both. */
export function notification(
  id: string,
  at: number,
  result: string,
  form: "both" | "queue" | "user" = "both",
  agent = "agent_SYNTH_71",
): string[] {
  const text = notificationText(id, agent, result);
  const out: string[] = [];
  if (form !== "user") {
    out.push(JSON.stringify({ type: "queue-operation", sessionId: "00000000-0000-4000-8000-000000000717", timestamp: iso(at), operation: "enqueue", content: text }));
    out.push(JSON.stringify({ type: "queue-operation", sessionId: "00000000-0000-4000-8000-000000000717", timestamp: iso(at + 2), operation: "dequeue", content: "" }));
  }
  if (form !== "queue") {
    out.push(JSON.stringify({ ...base("user", at + 5, {}), message: { role: "user", content: [{ type: "text", text }] } }));
  }
  return out;
}

/** A usage-bearing assistant record attributed to `skill` (the shape D3 measured). */
export function usageRecord(at: number, skill: string | null, tokens = 1000): string {
  return JSON.stringify({
    ...base("assistant", at, {}),
    ...(skill !== null ? { attributionSkill: skill } : {}),
    message: {
      role: "assistant",
      model: "claude-synthetic",
      usage: { input_tokens: tokens, output_tokens: tokens, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      content: [{ type: "text", text: "[elided]" }],
    },
  });
}

/** Write `<dir>/<sid>.jsonl`; returns the path. */
export function writeSessionTranscript(dir: string, sid: string, records: string[]): string {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${sid}.jsonl`);
  writeFileSync(file, `${records.join("\n")}\n`);
  return file;
}

// --------------------------------------------------------- result blocks

export function tddBlock(role: string, status: "ok" | "failed"): string {
  return [
    "```tdd-result",
    `role: ${role}`,
    `status: ${status}`,
    "files:",
    "  - tests/x.test.ts",
    "command: bun test tests/x.test.ts",
    "output_excerpt: |",
    "  FAIL tests/x.test.ts",
    "```",
  ].join("\n");
}

export function tddSpecReviewBlock(status: "ok" | "failed"): string {
  return [
    "```tdd-spec-review-result",
    "role: spec-reviewer",
    `status: ${status}`,
    "missing_acs: []",
    "partial_acs: []",
    "drift_count: 0",
    "advisory_findings: []",
    "cross_cutting_drift: []",
    "command: bun test",
    "output_excerpt: |",
    "  ok",
    "```",
  ].join("\n");
}

export function specReviewBlock(drift: boolean): string {
  const rows = drift
    ? [
        "- ac: AC-X.1, impl: a.ts:1, test: a.test.ts:1, status: done",
        "- ac: AC-X.2, impl: null, test: null, status: missing",
      ]
    : ["- ac: AC-X.1, impl: a.ts:1, test: a.test.ts:1, status: done", "- ac: AC-X.2, impl: b.ts:1, test: b.test.ts:1, status: done"];
  return [
    "```spec-review-result",
    "role: spec-reviewer",
    "",
    "## Traceability map",
    ...rows,
    "",
    "## Findings",
    drift ? "- AC-X.2 missing" : "- all traced",
    "",
    "## Drift hints",
    drift ? "- specs/requirements.md:1 — stale ref" : "- (none)",
    "```",
  ].join("\n");
}

// ------------------------------------------------------------- capture rows

export interface RowSpec {
  event: "pre" | "post";
  id: string;
  tool?: "Bash" | "Skill";
  cls?: string;
  skill?: string | null;
  ts: number;
  tree?: string | null;
  diff?: { files: number; insertions: number; deletions: number } | null;
  scope?: "main" | "fork";
}

export function captureRow(r: RowSpec): Record<string, unknown> {
  return {
    schema: "tool-call/v1",
    event: r.event,
    tool_use_id: r.id,
    tool: r.tool ?? "Bash",
    class: r.cls ?? (r.tool === "Skill" ? "skill" : "other"),
    skill: r.skill ?? null,
    ts: iso(r.ts),
    tree: r.tree ?? null,
    diff: r.diff ?? null,
    scope: r.scope ?? "main",
  };
}

/** Write capture rows to `<root>/.dpt/ledger/tool-calls/<sid>.jsonl` (the STE-716 ledger). */
export function writeCaptureRows(root: string, sid: string, rows: RowSpec[]): void {
  const dir = join(root, ".dpt", "ledger", "tool-calls");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${sid}.jsonl`), rows.map((r) => JSON.stringify(captureRow(r))).join("\n") + (rows.length ? "\n" : ""));
}

// ------------------------------------------------------------------ the CLI

export interface Run {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export function runTimelineCli(transcript: string, root: string, opts: { pluginRoot?: string; env?: Record<string, string> } = {}): Run {
  const p = spawnSync("bun", ["run", join(opts.pluginRoot ?? PLUGIN_ROOT, TIMELINE_REL), transcript, root], {
    cwd: root,
    encoding: "utf-8",
    env: { ...(process.env as Record<string, string>), ...GIT_ENV, ...(opts.env ?? {}) },
    maxBuffer: 64 * 1024 * 1024,
  });
  return { exitCode: p.status ?? -1, stdout: p.stdout ?? "", stderr: p.stderr ?? "" };
}

export type Timeline = {
  schema: string;
  calls: Array<Record<string, any>>;
  rounds: Array<Record<string, any>>;
  gate_runs: Array<Record<string, any>>;
  gaps: Record<string, number>;
};

/** Run the CLI and parse its JSON; a failed run or unparseable stdout throws with the run attached. */
export function timelineOf(transcript: string, root: string, opts: { pluginRoot?: string; env?: Record<string, string> } = {}): Timeline {
  const r = runTimelineCli(transcript, root, opts);
  if (r.exitCode !== 0) throw new Error(`timeline CLI exit ${r.exitCode}: ${r.stderr}`);
  try {
    return JSON.parse(r.stdout) as Timeline;
  } catch {
    throw new Error(`timeline CLI printed no JSON: ${r.stdout.slice(0, 400)}`);
  }
}

export const NFR10_RE = /^Refusing: .+\nRemedy: .+\nContext: .+/m;

// -------------------------------------------------------------- the fold

export const timelineFile = (root: string, sid: string): string => join(root, ".dpt", "ledger", "tool-calls", `${sid}.timeline.json`);

export function runLedgerHook(
  payload: Record<string, unknown>,
  opts: { pluginRoot?: string; cfg?: string; env?: Record<string, string>; cwd?: string } = {},
): Run & { ms: number } {
  const pluginRoot = opts.pluginRoot ?? PLUGIN_ROOT;
  const cwd = opts.cwd ?? (payload.cwd as string);
  const started = performance.now();
  const p = spawnSync("/bin/bash", [join(pluginRoot, LEDGER_WRAPPER_REL)], {
    cwd: existsSync(cwd) ? cwd : undefined,
    input: JSON.stringify(payload),
    encoding: "utf-8",
    env: {
      ...(process.env as Record<string, string>),
      ...GIT_ENV,
      CLAUDE_PLUGIN_ROOT: pluginRoot,
      ...(opts.cfg !== undefined ? { CLAUDE_CONFIG_DIR: opts.cfg } : {}),
      ...(opts.env ?? {}),
    },
  });
  return { exitCode: p.status ?? -1, stdout: p.stdout ?? "", stderr: p.stderr ?? "", ms: performance.now() - started };
}

export function ledgerPayload(sid: string, transcript: string, cwd: string, event: "SessionEnd" | "Stop" = "SessionEnd"): Record<string, unknown> {
  return { session_id: sid, transcript_path: transcript, cwd, hook_event_name: event };
}

/** The gitignore a registrable checkout carries. */
export const REGISTRABLE_GITIGNORE = "ignored.log\n.claude/settings.local.json\n";

/**
 * A checkout with `tracking.tool_calls.enabled: true` and a CURRENT capture
 * registration for the running plugin root, made through the shipped
 * `register` verb. `pluginRoot`/`module` let a temp plugin copy own the
 * registration.
 */
export function registeredCheckout(
  label: string,
  opts: { pluginRoot?: string; module?: string; files?: Record<string, string> } = {},
): { root: string; cfg: string; record: string } {
  const root = makeCheckout(label, "on", { gitignore: REGISTRABLE_GITIGNORE, files: opts.files });
  const { cfg, record } = recordFor(`${label}-rec`, root, opts.pluginRoot !== undefined ? realpathSync(opts.pluginRoot) : undefined);
  const r = runRegistration("register", root, { cfg, module: opts.module });
  if (r.exitCode !== 0) throw new Error(`register failed (exit ${r.exitCode}): ${r.stderr}`);
  const status = runRegistration("status", root, { cfg, module: opts.module });
  if (!/registration: current/.test(status.stdout)) throw new Error(`registration not current: ${status.stdout}${status.stderr}`);
  return { root, cfg, record };
}

/** Make the checkout's capture registration stale (the command names another version). */
export function staleRegistration(root: string, version: string): void {
  const file = join(root, ".claude", "settings.local.json");
  const json = JSON.parse(readFileSync(file, "utf-8")) as { hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>> };
  for (const groups of Object.values(json.hooks)) {
    for (const g of groups) for (const h of g.hooks) h.command = h.command.split(`"version": "${version}"`).join('"version": "0.0.0-stale"');
  }
  writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
}

// ------------------------------------------------------------- v3.0.0 tree

let v300Root: string | null = null;

/**
 * The v3.0.0 plugin tree (merge commit 6c62b32c), extracted once per process.
 * Its own temp dir, outside the shared TEMPS list: another suite's
 * `afterAll(cleanupTemps)` must not delete it under a later suite.
 */
export function v300Plugin(): string {
  if (v300Root !== null && existsSync(v300Root)) return v300Root;
  const dir = mkdtempSync(join(tmpdir(), "m7bc805-v300-plugin-"));
  process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
  const parts = ["adapters", "templates", "skills", "hooks", ".claude-plugin"].map((p) => `${PLUGIN_REL}/${p}`).join(" ");
  const p = spawnSync("bash", ["-c", `git -C '${REPO_ROOT}' archive ${V300} ${parts} | tar -x -C '${dir}'`], { encoding: "utf-8" });
  if (p.status !== 0) throw new Error(`git archive ${V300}: ${p.stderr}`);
  v300Root = join(dir, PLUGIN_REL);
  return v300Root;
}

// ---------------------------------------------------------------- snapshots

/** Every file under `root` (except `.git/`), as relative path → bytes. */
export function snapshot(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      if (dir === root && name === ".git") continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else out[relative(root, p)] = readFileSync(p, "latin1");
    }
  };
  walk(root);
  return out;
}

/** Copy one checkout's working files (not `.git`) into another directory, then init it identically. */
export function copyTree(from: string, to: string): void {
  mkdirSync(to, { recursive: true });
  for (const name of readdirSync(from)) {
    if (name === ".git") continue;
    cpSync(join(from, name), join(to, name), { recursive: true });
  }
}

// -------------------------------------------------------------- marker copies

export const MARKER_ENV = "M7BC805_STE717_MARKER";

/** Prepend a load marker (written only when MARKER_ENV is set) to a module's source. */
export function loadMarker(name: string): string {
  return `import { appendFileSync as __m717 } from "node:fs";\nif (process.env.${MARKER_ENV}) __m717(process.env.${MARKER_ENV}, "loaded ${name}\\n");\n`;
}
