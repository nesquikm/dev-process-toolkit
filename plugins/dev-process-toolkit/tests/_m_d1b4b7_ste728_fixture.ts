// STE-728 (M_d1b4b7) shared fixture helper — the retro settings proposal
// (`retro_proposal.ts propose|apply`) and its transcript approval.
//
// Leading underscore: a helper module, never collected as a suite.
//
// Fixtures:
//   - temp git checkouts (outside the repo) holding `specs/settings.yaml`;
//   - `dpt-retro/1` report files built with `buildRetroReport`, written to a
//     separate temp dir so a tree's `.dpt/` holds only what the test put there;
//   - session transcripts at `<configDir>/projects/<slug>/<sessionId>.jsonl`,
//     in the record shapes `tests/hook-modules-pre-tracker-write-gate.test.ts`
//     already grades: a Bash or AskUserQuestion `tool_use` in an assistant
//     record, and its `tool_result` in a user record; an answered ask carries
//     `toolUseResult: { questions, answers: { [question]: label } }` beside the
//     harness sentence, or the sentence alone.
//
// Every session id and record uuid is synthetic
// (00000000-0000-4000-8000-0000000000NN / 00000000-0000-4000-8000-0000001000NN).

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

import { GIT_ENV, PLUGIN_ROOT, SETTINGS_HEAD, SETUP_MD, SRC, git, pluginVersion, sid, tempDir, type Tracking } from "./_m_d1b4b7_retro_fixture";

export { cleanupTemps, git, sid, tempDir, PLUGIN_ROOT, SRC, SETTINGS_HEAD } from "./_m_d1b4b7_retro_fixture";

export const MODULE = join(SRC, "retro_proposal.ts");
export const CAPTURE_REGISTRATION = join(SRC, "capture_registration.ts");
export const APPLY_LABEL = "Apply the shown change";
export const LEAVE_LABEL = "Leave settings unchanged";
export const LOCAL_SETTINGS = ".claude/settings.local.json";
export const AUTO_APPROVE_MARKER = "<dpt:auto-approve>v1</dpt:auto-approve>";
export const NFR10_RE = /^Refusing: .+\nRemedy: .+\nContext: .+/m;
export const SKIPPED = "skipped: input not observable";

export const TOKEN_STATS_REASON = "parent-visible tokens: no token-ledger rows (tracking.token_stats off)";
export const TOOL_CALLS_REASON = "no scope session has a timeline file (tracking.tool_calls off)";
export const GATE_OUTCOMES_REASON = "no gate run has a non-null wall_ms (tracking.gate_outcomes off)";

/** Synthetic record uuid number `n` (1..99). */
export function ruuid(n: number): string {
  return `00000000-0000-4000-8000-0000001000${String(n).padStart(2, "0")}`;
}

export type AnyMod = Record<string, any>;

export async function proposalMod(): Promise<AnyMod> {
  return (await import("../adapters/_shared/src/retro_proposal")) as AnyMod;
}
export async function sessionMod(): Promise<AnyMod> {
  return (await import("../adapters/_shared/src/find_current_session")) as AnyMod;
}
export async function receiptsMod(): Promise<AnyMod> {
  return (await import("../adapters/_shared/src/tracker_receipts")) as AnyMod;
}
export async function settingsMod(): Promise<AnyMod> {
  return (await import("../adapters/_shared/src/project_settings")) as AnyMod;
}

/** The Claude Code slug rule (`cwdToSlug` for paths under 200 chars). */
export function slugOf(path: string): string {
  return path.replace(/[^A-Za-z0-9]/g, "-");
}

// ------------------------------------------------------------------ reports

export interface RuleRow {
  id: string;
  disposition: "tripped" | "clear" | typeof SKIPPED;
  reason: string | null;
}

const RULE_META: Record<string, { source: string[]; threshold: unknown; unit: string }> = {
  slow_gate_run: { source: ["timeline"], threshold: { "dev-process-toolkit:gate-check": 900000 }, unit: "ms" },
  gate_rerun_unchanged_key: { source: ["timeline"], threshold: 1, unit: "runs" },
  zero_yield_round: { source: ["timeline"], threshold: 2, unit: "rounds" },
  cost_per_changed_line: { source: ["token_ledger", "capture_ledger"], threshold: 500, unit: "parent-visible tokens/line" },
};

export const clear = (id: string): RuleRow => ({ id, disposition: "clear", reason: null });
export const skipped = (id: string, reason: string): RuleRow => ({ id, disposition: SKIPPED, reason });

/** Every rule clear except the given overrides. */
export function rules(overrides: RuleRow[] = []): RuleRow[] {
  const ids = ["slow_gate_run", "gate_rerun_unchanged_key", "zero_yield_round", "cost_per_changed_line"];
  return ids.map((id) => overrides.find((o) => o.id === id) ?? clear(id));
}

export const TOKEN_STATS_OFF = (): RuleRow[] => rules([skipped("cost_per_changed_line", TOKEN_STATS_REASON)]);
export const TOOL_CALLS_OFF = (): RuleRow[] => rules([skipped("zero_yield_round", TOOL_CALLS_REASON)]);
export const GATE_OUTCOMES_OFF = (): RuleRow[] => rules([skipped("slow_gate_run", GATE_OUTCOMES_REASON)]);
/** token_stats and tool_calls both off: two rows. */
export const TWO_OFF = (): RuleRow[] =>
  rules([skipped("cost_per_changed_line", TOKEN_STATS_REASON), skipped("zero_yield_round", TOOL_CALLS_REASON)]);

/** Write a `dpt-retro/1` report (built by `buildRetroReport`) to its own temp dir; returns its path. */
export async function writeReport(label: string, rows: RuleRow[]): Promise<string> {
  const { buildRetroReport, parseRetroReport } = (await import("../adapters/_shared/src/retro_report")) as AnyMod;
  const report = buildRetroReport({
    scope: { kind: "session", id: sid(1) },
    sessionIds: [sid(1)],
    results: rows.map((r) => ({
      id: r.id,
      source: RULE_META[r.id]!.source,
      threshold: RULE_META[r.id]!.threshold,
      unit: RULE_META[r.id]!.unit,
      value: r.disposition === SKIPPED ? null : 0,
      disposition: r.disposition,
      reason: r.reason,
    })),
    pluginVersion: pluginVersion(),
    generatedAt: "2026-11-06T12:00:00.000Z",
  });
  const text = `${JSON.stringify(report, null, 2)}\n`;
  parseRetroReport(text); // the fixture is a valid report
  const path = join(tempDir(`${label}-report`), "session-20261106T120000Z.json");
  writeFileSync(path, text);
  return path;
}

// -------------------------------------------------------------------- trees

export const OFF: Tracking = { token_stats: false, tool_calls: false, gate_outcomes: false };

export function trackingYaml(t: Tracking): string {
  return (
    "tracking:\n" +
    `  token_stats:\n    enabled: ${t.token_stats}\n` +
    `  gate_outcomes:\n    enabled: ${t.gate_outcomes}\n` +
    `  tool_calls:\n    enabled: ${t.tool_calls}\n`
  );
}

export interface TreeOpts {
  /** The whole settings file; null for no settings file. Default: header + tracking all off. */
  settings?: string | null;
  /** The root `.gitignore`; null for none. Default: ignores the local settings file. */
  gitignore?: string | null;
  /** Write `.dpt/.gitignore` (`ledger/` rule). Default true. */
  dptGitignore?: boolean;
  /** CLAUDE.md content. Default: the setup-generated stub. */
  claudeMd?: string;
  /** Commit `.claude/settings.local.json` holding this JSON text. */
  trackedLocal?: string;
  /** Leave `.claude/settings.local.json` holding this text, untracked. */
  untrackedLocal?: string;
}

export const IGNORE_LOCAL = `node_modules/\n${LOCAL_SETTINGS}\n`;
export const IGNORE_OTHER = "node_modules/\n";

/** A committed git checkout under a fresh temp dir; returns its realpath. */
export function makeTree(label: string, o: TreeOpts = {}): string {
  const root = join(tempDir(label), "repo");
  mkdirSync(root, { recursive: true });
  git(root, "init", "-q", "-b", "feat/proposal-fixture");
  writeFileSync(join(root, "CLAUDE.md"), o.claudeMd ?? SETUP_MD);
  writeFileSync(join(root, "package.json"), '{"name":"fixture","version":"0.0.0","private":true}\n');
  const settings = o.settings === undefined ? SETTINGS_HEAD + trackingYaml(OFF) : o.settings;
  if (settings !== null) {
    mkdirSync(join(root, "specs"), { recursive: true });
    writeFileSync(join(root, "specs", "settings.yaml"), settings);
  }
  const gi = o.gitignore === undefined ? IGNORE_LOCAL : o.gitignore;
  if (gi !== null) writeFileSync(join(root, ".gitignore"), gi);
  if (o.dptGitignore !== false) {
    mkdirSync(join(root, ".dpt"), { recursive: true });
    writeFileSync(join(root, ".dpt", ".gitignore"), "ledger/\nscratch/\n");
  }
  if (o.trackedLocal !== undefined) {
    mkdirSync(join(root, ".claude"), { recursive: true });
    writeFileSync(join(root, LOCAL_SETTINGS), o.trackedLocal);
  }
  git(root, "add", "-A");
  if (o.trackedLocal !== undefined) git(root, "add", "-f", LOCAL_SETTINGS);
  git(root, "commit", "-q", "-m", "fixture");
  if (o.untrackedLocal !== undefined) {
    mkdirSync(join(root, ".claude"), { recursive: true });
    writeFileSync(join(root, LOCAL_SETTINGS), o.untrackedLocal);
  }
  return root;
}

export function settingsPath(root: string): string {
  return join(root, "specs", "settings.yaml");
}

export function readOr(path: string): string | null {
  return existsSync(path) ? readFileSync(path, "utf-8") : null;
}

/** sha256 of every file under `root` except `.git/`, keyed by relative path. */
export function snapshot(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const full = join(d, name);
      const rel = relative(root, full);
      if (rel === ".git") continue;
      if (statSync(full).isDirectory()) walk(full);
      else out[rel] = createHash("sha256").update(readFileSync(full)).digest("hex");
    }
  };
  walk(root);
  return out;
}

export function gitStatus(root: string): string {
  return git(root, "status", "--porcelain", "--untracked-files=all");
}

/** The receipt files of one session, relative to the root. */
export function receiptFiles(root: string, session: string): string[] {
  const d = join(root, ".dpt", "ledger", "receipts", session);
  if (!existsSync(d)) return [];
  return readdirSync(d)
    .sort()
    .map((n) => join(".dpt", "ledger", "receipts", session, n));
}

export function retroApplyReceipts(root: string, session: string): any[] {
  return receiptFiles(root, session)
    .map((rel) => JSON.parse(readFileSync(join(root, rel), "utf-8")))
    .filter((r) => r.kind === "retro-apply");
}

/** `after` minus the paths in `allowed`; used to say "identical apart from …". */
export function without(snap: Record<string, string>, allowed: string[]): Record<string, string> {
  const out = { ...snap };
  for (const a of allowed) delete out[a];
  return out;
}

// ------------------------------------------------------------- subprocesses

export interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

export interface RunOpts {
  cwd?: string;
  configDir?: string;
  /** undefined: leave unset (the inherited one is always removed). */
  session?: string;
  module?: string;
  env?: Record<string, string>;
}

export function childEnv(o: RunOpts): Record<string, string> {
  const env: Record<string, string> = { ...(process.env as Record<string, string>), ...GIT_ENV };
  delete env.CLAUDE_CODE_SESSION_ID;
  delete env.CLAUDE_PROJECT_DIR;
  env.CLAUDE_CONFIG_DIR = o.configDir ?? tempDir("empty-config");
  if (o.session !== undefined) env.CLAUDE_CODE_SESSION_ID = o.session;
  return { ...env, ...(o.env ?? {}) };
}

/** `bun run retro_proposal.ts <args…>` (cwd defaults to the first arg after the verb). */
export function runProposal(args: string[], o: RunOpts = {}): RunResult {
  const p = spawnSync(process.execPath, ["run", o.module ?? MODULE, ...args], {
    cwd: o.cwd ?? args[1],
    encoding: "utf-8",
    env: childEnv(o),
    timeout: 60_000,
  });
  return { status: p.status, stdout: p.stdout ?? "", stderr: p.stderr ?? "" };
}

export function propose(root: string, report: string, o: RunOpts = {}): RunResult {
  return runProposal(["propose", root, report], o);
}

export function apply(root: string, report: string, digest: string, o: RunOpts = {}): RunResult {
  return runProposal(["apply", root, report, digest], o);
}

/** `capture_registration.ts status <root>` stdout. */
export function captureStatus(root: string, o: RunOpts = {}): string {
  const p = spawnSync(process.execPath, ["run", o.module ? join(o.module, "..", "capture_registration.ts") : CAPTURE_REGISTRATION, "status", root], {
    cwd: root,
    encoding: "utf-8",
    env: childEnv(o),
    timeout: 60_000,
  });
  return p.stdout ?? "";
}

export function printedLines(stdout: string): string[] {
  return stdout.split("\n").filter((l) => l !== "");
}

/** The `sha256:<hex>` a propose printed on its `digest=` line. */
export function digestOf(stdout: string): string {
  const line = printedLines(stdout).find((l) => l.startsWith("digest="));
  if (line === undefined) throw new Error(`propose printed no digest= line:\n${stdout}`);
  return line.slice("digest=".length);
}

export function hexOf(digest: string): string {
  return digest.replace(/^sha256:/, "");
}

// --------------------------------------------------------------- transcripts

let toolu = 0;
const nextToolId = (): string => `toolu_SYNTH728_${String(++toolu).padStart(4, "0")}`;

export function proposeCommand(root: string, report: string, module = MODULE): string {
  return `bun run ${module} propose ${root} ${report}`;
}
export function applyCommand(root: string, report: string, digest: string, module = MODULE): string {
  return `bun run ${module} apply ${root} ${report} ${digest}`;
}

/** The question text the skill asks: a lead line, then every printed line on its own line. */
export function questionFor(lines: string[]): string {
  return ["Apply this retro settings proposal?", ...lines].join("\n");
}

export function askQuestions(question: string): Record<string, unknown>[] {
  return [
    {
      question,
      header: "Settings",
      multiSelect: false,
      options: [
        { label: APPLY_LABEL, description: "Write the shown settings change." },
        { label: LEAVE_LABEL, description: "Change nothing (default)." },
      ],
    },
  ];
}

export function harnessSentence(question: string, answer: string): string {
  return `Your questions have been answered: "${question}"="${answer}". You can now continue with these answers in mind.`;
}

export interface AskOpts {
  /** "carried" (toolUseResult + sentence, default) or "sentence" (sentence only). */
  form?: "carried" | "sentence";
  isError?: boolean;
  /** The result answers this question instead of the asked one. */
  answeredQuestion?: string;
  uuid?: string;
}

export class Transcript {
  lines: string[] = [];
  private n = 0;
  constructor(readonly session: string, readonly cwd: string) {
    this.lines.push(
      JSON.stringify({ type: "user", uuid: this.uuid(), cwd, sessionId: session, message: { role: "user", content: "run /dev-process-toolkit:retro" } }),
    );
  }

  uuid(): string {
    return ruuid(50 + ++this.n);
  }

  toolUse(name: string, input: unknown): string {
    const id = nextToolId();
    this.lines.push(
      JSON.stringify({
        type: "assistant",
        uuid: this.uuid(),
        sessionId: this.session,
        cwd: this.cwd,
        timestamp: new Date().toISOString(),
        message: { role: "assistant", content: [{ type: "tool_use", id, name, input }] },
      }),
    );
    return id;
  }

  toolResult(id: string, content: unknown, o: { isError?: boolean; extra?: Record<string, unknown>; uuid?: string } = {}): string {
    const uuid = o.uuid ?? this.uuid();
    this.lines.push(
      JSON.stringify({
        type: "user",
        uuid,
        sessionId: this.session,
        cwd: this.cwd,
        timestamp: new Date().toISOString(),
        message: {
          role: "user",
          content: [{ tool_use_id: id, type: "tool_result", content, ...(o.isError ? { is_error: true } : {}) }],
        },
        ...(o.extra ?? {}),
      }),
    );
    return uuid;
  }

  /** A Bash call and (unless `output` is null) its recorded result. */
  bash(command: string, output: string | null): string {
    const id = this.toolUse("Bash", { command, description: "run" });
    if (output !== null) {
      this.toolResult(id, output, { extra: { toolUseResult: { stdout: output, stderr: "", interrupted: false } } });
    }
    return id;
  }

  /** An AskUserQuestion and its answer; returns the answer record's uuid. */
  ask(question: string, answer: string, o: AskOpts = {}): string {
    const questions = askQuestions(question);
    const id = this.toolUse("AskUserQuestion", { questions });
    const answered = o.answeredQuestion ?? question;
    const sentence = harnessSentence(answered, answer);
    const extra = o.form === "sentence" ? {} : { toolUseResult: { questions, answers: { [answered]: answer } } };
    return this.toolResult(id, sentence, { isError: o.isError, extra, uuid: o.uuid });
  }

  assistantText(text: string): void {
    this.lines.push(
      JSON.stringify({ type: "assistant", uuid: this.uuid(), sessionId: this.session, message: { role: "assistant", content: [{ type: "text", text }] } }),
    );
  }

  userText(text: string): void {
    this.lines.push(JSON.stringify({ type: "user", uuid: this.uuid(), sessionId: this.session, message: { role: "user", content: text } }));
  }

  text(): string {
    return `${this.lines.join("\n")}\n`;
  }

  /** Write to `<configDir>/projects/<slug folder>/<session>.jsonl`; returns the path. */
  writeTo(configDir: string, folderPath: string = this.cwd): string {
    const dir = join(configDir, "projects", slugOf(folderPath));
    mkdirSync(dir, { recursive: true });
    const p = join(dir, `${this.session}.jsonl`);
    writeFileSync(p, this.text());
    return p;
  }
}

export interface Approved {
  root: string;
  report: string;
  stdout: string;
  lines: string[];
  digest: string;
  configDir: string;
  session: string;
  transcript: Transcript;
  answerUuid: string;
  path: string;
}

/**
 * Run the real `propose`, then build and write a transcript holding its call
 * and result and an AskUserQuestion with every printed line answered
 * `Apply the shown change`. No line for the `apply` call (a live lone call).
 */
export function approve(
  label: string,
  root: string,
  report: string,
  o: { session?: string; cwd?: string; folder?: string; module?: string; configDir?: string; answer?: string; form?: "carried" | "sentence" } = {},
): Approved {
  const session = o.session ?? sid(28);
  const configDir = o.configDir ?? tempDir(`${label}-config`);
  const p = propose(root, report, { module: o.module });
  if (p.status !== 0 || p.stdout === "") throw new Error(`propose printed nothing (status ${p.status}):\n${p.stderr}`);
  const lines = printedLines(p.stdout);
  const digest = digestOf(p.stdout);
  const cwd = o.cwd ?? root;
  const t = new Transcript(session, cwd);
  t.bash(proposeCommand(root, report, o.module), p.stdout.trimEnd());
  const answerUuid = t.ask(questionFor(lines), o.answer ?? APPLY_LABEL, { form: o.form });
  const path = t.writeTo(configDir, o.folder ?? cwd);
  return { root, report, stdout: p.stdout, lines, digest, configDir, session, transcript: t, answerUuid, path };
}

/** Re-write an approval's transcript after more records were appended. */
export function rewrite(a: Approved, folder: string = a.transcript.cwd): void {
  a.transcript.writeTo(a.configDir, folder);
}

export function applyApproved(a: Approved, o: { cwd?: string; module?: string; digest?: string; root?: string } = {}): RunResult {
  return apply(o.root ?? a.root, a.report, o.digest ?? a.digest, {
    cwd: o.cwd ?? a.transcript.cwd,
    configDir: a.configDir,
    session: a.session,
    module: o.module,
  });
}

// ------------------------------------------------------------- plugin copies

/** A temp copy of the plugin's adapters, templates and manifest; returns the copied module path. */
export function pluginCopy(label: string, edit?: { manifest?: (json: Record<string, unknown>) => Record<string, unknown> }): string {
  const root = join(tempDir(label), "plugin");
  cpSync(join(PLUGIN_ROOT, "adapters"), join(root, "adapters"), { recursive: true });
  cpSync(join(PLUGIN_ROOT, "templates"), join(root, "templates"), { recursive: true });
  cpSync(join(PLUGIN_ROOT, ".claude-plugin"), join(root, ".claude-plugin"), { recursive: true });
  if (edit?.manifest) {
    const p = join(root, ".claude-plugin", "plugin.json");
    writeFileSync(p, `${JSON.stringify(edit.manifest(JSON.parse(readFileSync(p, "utf-8"))), null, 2)}\n`);
  }
  return join(root, "adapters", "_shared", "src", "retro_proposal.ts");
}

export function removeIfPresent(path: string): void {
  if (existsSync(path)) rmSync(path, { force: true });
}

export function expectRefusal(r: RunResult): void {
  if (r.status !== 1 || !NFR10_RE.test(r.stderr)) {
    throw new Error(`expected an NFR-10 refusal with exit 1, got status ${r.status}\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  }
}
