// STE-616 (M_2306b6) — the scenario runner: S1..S18 end to end, offline.
//
// Leading underscore: a helper module, never collected as a suite.
//
// `runScenario(id, tracker, { pluginRoot })` builds the two-repository fixture
// (tests/_shared_tracker_fixture.ts), then drives the scenario the way a
// session does: every tracker DECISION is a front door spawned as a subprocess
// from `pluginRoot` (`bun run <pluginRoot>/adapters/_shared/src/<door>.ts …`,
// with CLAUDE_PLUGIN_ROOT=pluginRoot and CLAUDE_CODE_SESSION_ID set), fed the
// double's answers, in the order the skill prose gives; every tracker WRITE
// passes through a model of the Claude Code harness before it reaches the
// double:
//
//   1. the write is hooked only when a PreToolUse matcher that
//      `<pluginRoot>/hooks/hooks.json` registers for the tracker-write hook
//      matches the tool name (B's writes go out under the second server name,
//      so a matcher that knows one server lets them through unhooked);
//   2. the hook is `<pluginRoot>/templates/hooks/process/pre-tracker-write-gate.sh`,
//      run through `bash` with a PreToolUse payload on stdin;
//   3. the write is BLOCKED only when the wrapper exits 2, or exits 0 with a
//      deny decision on stdout (`harnessBlocks`). Every other outcome — an
//      advisory exit 1 included — reaches the double.
//
// This module imports nothing under `adapters/` or `templates/hooks/`
// (AC-STE-616.3): the guards run where the live path runs them, in a
// subprocess. Transcript announcements name the deciding module through the
// literal `${CLAUDE_PLUGIN_ROOT}`, which the hook expands against its OWN
// plugin root — so a mutated copy's own modules are the ones it trusts.
//
// A scenario never throws out of `runScenario`: the first failed expectation
// (or any unexpected error) is recorded in the result, with every invocation
// counted so far, so the suite can grade vacuity and the mutation matrix can
// tell a guard going red from a subprocess that could not load.

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import {
  doorEnv,
  type FixtureRepo,
  type FixtureShape,
  type MilestoneRef,
  type SharedTrackerFixture,
  type Tracker,
  JIRA_PROJECT,
  LINEAR_PROJECT,
  LINEAR_TEAM,
  REAL_PLUGIN_ROOT,
  TAG_A,
  TAG_B,
  seedContainer,
  tokenOfEpic,
  tokenOfLinearMilestone,
  withSharedTrackerFixture,
  writePlanFile,
} from "./_shared_tracker_fixture";
import { claudeMd, commitAll, git, GIT_ENV } from "./_span_fixture";
import { JiraDouble, LinearDouble, TransportError, readInventory } from "./_tracker_doubles";

export type { Tracker } from "./_shared_tracker_fixture";

export type InvocationKind = "front-door" | "tracker-write-hook" | "commit-pr-hook" | "detector" | "gate-probe";
export const INVOCATION_KINDS: readonly InvocationKind[] = [
  "front-door",
  "tracker-write-hook",
  "commit-pr-hook",
  "detector",
  "gate-probe",
];

export interface ProcRun {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * The Claude Code PreToolUse rule (docs/hooks-reference.md, "Exit-code
 * contract"): a call is blocked only when the hook exits 2, or exits 0 with a
 * deny decision on stdout. Any other non-zero exit is advisory and the tool
 * call proceeds.
 */
export function harnessBlocks(r: ProcRun): boolean {
  if (r.exitCode === 2) return true;
  if (r.exitCode !== 0 || r.stdout.trim() === "") return false;
  try {
    const j = JSON.parse(r.stdout) as Record<string, any>;
    return (
      j?.hookSpecificOutput?.permissionDecision === "deny" ||
      j?.decision === "block" ||
      j?.decision === "deny"
    );
  } catch {
    return false;
  }
}

/** NEGATIVE CONTROL ONLY (AC-STE-616.23): the kind runner that reads every non-zero exit as a block. */
export function exitNonZeroBlocks(r: ProcRun): boolean {
  return r.exitCode !== 0;
}

export interface ScenarioResult {
  id: string;
  tracker: Tracker;
  ok: boolean;
  failures: string[];
  invocations: Record<InvocationKind, number>;
  hookRefused: number;
  hookPermitted: number;
  loadErrors: string[];
  steps: string[];
}

export interface RunScenarioOptions {
  pluginRoot: string;
  /** The harness block rule; `harnessBlocks` unless a negative control swaps it. */
  blockRule?: (r: ProcRun) => boolean;
}

class ScenarioFailure extends Error {}

/** A subprocess that died before its guard ran: module load, syntax or missing file. */
const LOAD_ERROR =
  /SyntaxError|Cannot find module|Cannot find package|Module not found|Could not resolve|Unexpected token|^error: (?:Unexpected|Expected|Unterminated|Cannot find|Could not resolve|Module not found)|ENOENT[^\n]*\.(?:ts|sh|json)\b|No such file or directory[^\n]*\.(?:ts|sh)\b/m;

const ADAPTERS_SRC = "adapters/_shared/src";

// ===========================================================================
// Transcript
// ===========================================================================

let SESSION_SEQ = 0;

export class Session {
  readonly lines: string[] = [];
  readonly file: string;
  private seq = 0;

  constructor(readonly id: string, dir: string) {
    this.file = join(dir, `transcript-${id}.jsonl`);
    this.flush();
  }

  private flush(): void {
    writeFileSync(this.file, this.lines.join("\n") + (this.lines.length ? "\n" : ""));
  }

  nextId(): string {
    this.seq += 1;
    return `toolu_616_${this.id.replace(/[^A-Za-z0-9]/g, "")}_${String(this.seq).padStart(4, "0")}`;
  }

  push(obj: unknown): void {
    this.lines.push(JSON.stringify(obj));
    this.flush();
  }

  toolUse(name: string, input: unknown, timestamp?: string): string {
    const id = this.nextId();
    this.push({
      type: "assistant",
      sessionId: this.id,
      ...(timestamp ? { timestamp } : {}),
      message: { role: "assistant", content: [{ type: "tool_use", id, name, input }] },
    });
    return id;
  }

  toolResult(id: string, content: unknown, isError = false, extra: Record<string, unknown> = {}): void {
    this.push({
      type: "user",
      sessionId: this.id,
      message: {
        role: "user",
        content: [{ tool_use_id: id, type: "tool_result", content, ...(isError ? { is_error: true } : { is_error: false }) }],
      },
      ...extra,
    });
  }

  bash(command: string, output: string, isError = false): string {
    const id = this.toolUse("Bash", { command, description: "run" });
    this.toolResult(id, output, isError);
    return id;
  }

  /** The AskUserQuestion a deciding command's option labels drive, answered `answer`. */
  ask(key: string, verb: "Import" | "Adopt", answer: string): void {
    const question = `${verb} ${key} into this repository?`;
    const questions = [
      {
        question,
        header: verb,
        multiSelect: false,
        options: [
          { label: `${verb} ${key}`, description: `${verb} the ticket.` },
          { label: `Skip ${key}`, description: "Leave it alone." },
        ],
      },
    ];
    const id = this.toolUse("AskUserQuestion", { questions });
    this.toolResult(
      id,
      `Your questions have been answered: "${question}"="${answer}". You can now continue with these answers in mind.`,
      false,
      { toolUseResult: { questions, answers: { [question]: answer } } },
    );
  }

  /** A Skill call with a record-level timestamp, as the commit / PR evidence windows need. */
  skill(skill: string, timestamp: string): void {
    const id = this.toolUse("Skill", { skill }, timestamp);
    this.toolResult(id, `Launching skill: ${skill}`);
  }

  /** A free-text operator message (never a consent answer). */
  userText(text: string): void {
    this.push({ type: "user", sessionId: this.id, message: { role: "user", content: text } });
  }
}

// ===========================================================================
// The scenario context
// ===========================================================================

export interface WriteOutcome {
  hooked: boolean;
  blocked: boolean;
  run: ProcRun | null;
  result: Record<string, unknown> | null;
  transportError: boolean;
  toolName: string;
}

function quoteArg(a: string): string {
  if (/^[A-Za-z0-9_./:=@%+,-]+$/.test(a)) return a;
  if (/["$`\\\n]/.test(a)) throw new Error(`runner: argument ${JSON.stringify(a)} cannot be spelled as one plain command word`);
  return `"${a}"`;
}

function sha256(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const PAST = new Date(Date.now() - 3_600_000).toISOString();

export class Ctx {
  readonly counts: Record<InvocationKind, number> = {
    "front-door": 0,
    "tracker-write-hook": 0,
    "commit-pr-hook": 0,
    detector: 0,
    "gate-probe": 0,
  };
  hookRefused = 0;
  hookPermitted = 0;
  readonly loadErrors: string[] = [];
  readonly steps: string[] = [];
  private fileSeq = 0;
  private hookMatcherCache: RegExp[] | null = null;

  constructor(
    readonly fx: SharedTrackerFixture,
    readonly pluginRoot: string,
    readonly blockRule: (r: ProcRun) => boolean,
  ) {}

  get tracker(): Tracker {
    return this.fx.tracker;
  }
  get jira(): JiraDouble {
    if (!this.fx.jira) throw new Error("runner: this leg needs the Jira double");
    return this.fx.jira;
  }
  get linear(): LinearDouble {
    if (!this.fx.linear) throw new Error("runner: this leg needs the Linear double");
    return this.fx.linear;
  }
  get writes(): number {
    return this.fx.double.writeCount;
  }

  step(s: string): void {
    this.steps.push(s);
  }

  check(cond: unknown, msg: string): asserts cond {
    if (!cond) throw new ScenarioFailure(msg);
  }

  eq<T>(actual: T, expected: T, msg: string): void {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) throw new ScenarioFailure(`${msg}: expected ${e}, got ${a}`);
  }

  session(label: string): Session {
    SESSION_SEQ += 1;
    return new Session(`s616-${label}-${process.pid}-${SESSION_SEQ}`, this.fx.scratch);
  }

  file(name: string, content: unknown): string {
    this.fileSeq += 1;
    const p = join(this.fx.scratch, `${String(this.fileSeq).padStart(4, "0")}-${name}`);
    writeFileSync(p, typeof content === "string" ? content : JSON.stringify(content));
    return p;
  }

  private noteLoadError(label: string, r: ProcRun): void {
    if (r.exitCode !== 0 && LOAD_ERROR.test(r.stderr)) {
      this.loadErrors.push(`${label}: exit ${r.exitCode}: ${r.stderr.split("\n").find((l) => LOAD_ERROR.test(l))}`);
    }
  }

  async spawn(argv: string[], opts: { cwd?: string; env: Record<string, string>; stdin?: string }, label: string): Promise<ProcRun> {
    const r = await new Promise<ProcRun>((resolveRun) => {
      const child = spawn(argv[0]!, argv.slice(1), { cwd: opts.cwd ?? this.fx.scratch, env: opts.env, stdio: ["pipe", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => (stdout += d.toString()));
      child.stderr.on("data", (d) => (stderr += d.toString()));
      child.on("error", (e) => resolveRun({ exitCode: 127, stdout, stderr: stderr + String(e) }));
      child.on("close", (code) => resolveRun({ exitCode: code ?? -1, stdout, stderr }));
      child.stdin.end(opts.stdin ?? "");
    });
    this.noteLoadError(label, r);
    return r;
  }

  /**
   * Spawn a front door `bun run <pluginRoot>/<rel> …args`. With a session, the
   * run is recorded in its transcript as the exact plain command the hook
   * accepts, its stdout (or stderr, on a refusal) as the tool result.
   */
  async door(
    rel: string,
    args: string[],
    o: { session?: Session; sessionId?: string; cwd?: string; kind?: InvocationKind; env?: Record<string, string>; pluginRoot?: string } = {},
  ): Promise<ProcRun & { command: string }> {
    const root = o.pluginRoot ?? this.pluginRoot;
    const sid = o.session?.id ?? o.sessionId ?? "s616-unrecorded";
    const env = doorEnv(root, sid, o.env);
    const r = await this.spawn(["bun", "run", join(root, rel), ...args], { cwd: o.cwd, env }, rel);
    this.counts[o.kind ?? "front-door"] += 1;
    const command = `bun run "\${CLAUDE_PLUGIN_ROOT}/${rel}" ${args.map(quoteArg).join(" ")}`.trimEnd();
    if (o.session) o.session.bash(command, r.exitCode === 0 ? r.stdout.trimEnd() : `Exit code ${r.exitCode}\n${r.stderr.trimEnd()}`, r.exitCode !== 0);
    return { ...r, command };
  }

  /** The registered PreToolUse matchers of the tracker-write hook, from `<pluginRoot>/hooks/hooks.json`. */
  trackerHookMatchers(): RegExp[] {
    if (this.hookMatcherCache) return this.hookMatcherCache;
    this.hookMatcherCache = trackerHookMatchers(this.pluginRoot);
    return this.hookMatcherCache;
  }

  /**
   * One tracker write through the harness model. `pluginRootForHook` runs the
   * hook from another plugin root (S6's lowered manifest); the matcher is still
   * the tree under test's.
   */
  async write(
    repo: Pick<FixtureRepo, "server">,
    session: Session,
    tool: string,
    input: Record<string, unknown>,
    o: { cwd: string; pluginRootForHook?: string; sessionIdOverride?: string } = { cwd: this.fx.scratch },
  ): Promise<WriteOutcome> {
    const toolName = `mcp__${repo.server}__${tool}`;
    const id = session.toolUse(toolName, input);
    const hooked = this.trackerHookMatchers().some((m) => m.test(toolName));
    let run: ProcRun | null = null;
    if (hooked) {
      const hookRoot = o.pluginRootForHook ?? this.pluginRoot;
      const payload = JSON.stringify({
        session_id: o.sessionIdOverride ?? session.id,
        transcript_path: session.file,
        cwd: o.cwd,
        permission_mode: "default",
        hook_event_name: "PreToolUse",
        tool_name: toolName,
        tool_input: input,
        tool_use_id: id,
      });
      const env = doorEnv(hookRoot, session.id);
      run = await this.spawn(
        ["bash", join(hookRoot, "templates", "hooks", "process", "pre-tracker-write-gate.sh")],
        { cwd: this.fx.scratch, env, stdin: payload },
        "pre-tracker-write-gate.sh",
      );
      this.counts["tracker-write-hook"] += 1;
      if (this.blockRule(run)) {
        this.hookRefused += 1;
        session.toolResult(id, `PreToolUse:${toolName} hook error: ${run.stderr.trim()}`, true);
        return { hooked, blocked: true, run, result: null, transportError: false, toolName };
      }
      this.hookPermitted += 1;
    }
    try {
      const result = this.fx.double.apply(tool, input);
      session.toolResult(id, [{ type: "text", text: JSON.stringify(result) }]);
      return { hooked, blocked: false, run, result, transportError: false, toolName };
    } catch (e) {
      if (e instanceof TransportError) {
        session.toolResult(id, e.message, true);
        return { hooked, blocked: false, run, result: null, transportError: true, toolName };
      }
      throw e;
    }
  }

  expectRefused(w: WriteOutcome, what: string, needle?: string | RegExp): void {
    this.check(w.hooked, `${what}: expected the tracker-write hook to run for ${w.toolName}, but no registered matcher matched it (the write went through unhooked)`);
    this.check(
      w.blocked,
      `${what}: expected the hook to block the write (exit 2), got exit ${w.run?.exitCode} — the write reached the double\n${w.run?.stderr ?? ""}`,
    );
    this.check(w.run!.exitCode === 2, `${what}: expected exit 2, got exit ${w.run!.exitCode}`);
    const lines = w.run!.stderr.split("\n");
    this.check(
      lines.some((l) => l.startsWith("Refusing:")) && lines.some((l) => l.startsWith("Remedy:")) && lines.some((l) => l.startsWith("Context:")),
      `${what}: expected a three-line NFR-10 refusal (Refusing:/Remedy:/Context:) on stderr, got:\n${w.run!.stderr}`,
    );
    if (needle !== undefined) {
      const hit = typeof needle === "string" ? w.run!.stderr.includes(needle) : needle.test(w.run!.stderr);
      this.check(hit, `${what}: expected the refusal to name ${String(needle)}, got:\n${w.run!.stderr}`);
    }
  }

  expectPermitted(w: WriteOutcome, what: string): void {
    this.check(w.hooked, `${what}: expected the tracker-write hook to run for ${w.toolName}, but no registered matcher matched it`);
    this.check(!w.blocked, `${what}: expected the hook to permit the write, but it blocked it (exit ${w.run?.exitCode}):\n${w.run?.stderr ?? ""}`);
    this.check(w.run!.exitCode === 0, `${what}: expected exit 0 from the hook, got exit ${w.run!.exitCode}:\n${w.run!.stderr}`);
  }

  expectSilent(w: WriteOutcome, what: string): void {
    this.check(!w.blocked, `${what}: expected the hook to stay silent (exit 0), but it blocked (exit ${w.run?.exitCode}):\n${w.run?.stderr ?? ""}`);
    if (w.run) {
      this.check(
        w.run.exitCode === 0 && w.run.stdout === "" && w.run.stderr === "",
        `${what}: expected exit 0 with empty stdout and stderr, got exit ${w.run.exitCode}\nstdout=${w.run.stdout}\nstderr=${w.run.stderr}`,
      );
    }
  }

  // ------------------------------------------------------------------ tracker legs

  /** The container listing the decision and attach doors read, saved to a file. */
  containerListing(): string {
    if (this.tracker === "jira") {
      const pages = this.jira.searchAll(`project = ${JIRA_PROJECT} AND issuetype = Epic`, ["summary", "project", "issuetype", "status", "labels"], 100);
      this.check(pages.length === 1, `the Epic listing should fit one page, got ${pages.length}`);
      return this.file("epic-listing.json", pages[0]);
    }
    return this.file("milestone-listing.json", this.linear.listMilestones({ project: LINEAR_PROJECT }));
  }

  /** The attach front door for `plan` in `repo`, recorded in `session`. */
  async attach(repo: FixtureRepo | { root: string }, session: Session, plan: string, listing?: string): Promise<ProcRun & { command: string }> {
    const project = this.tracker === "jira" ? JIRA_PROJECT : LINEAR_PROJECT;
    return this.door(`${ADAPTERS_SRC}/attach_project_milestone.ts`, [repo.root, this.tracker, project, plan, listing ?? this.containerListing()], {
      session,
    });
  }

  containerFlags(m: MilestoneRef): string[] {
    return this.tracker === "jira" ? ["--parent", m.key] : ["--linear-milestone", m.key];
  }

  /** `query` → the double's pages → `decide`: returns the decision and the create's tool input. */
  async decide(
    root: string,
    session: Session,
    title: string,
    m: MilestoneRef,
    attempt: "fast" | "retry-1" | "retry-2" | "retry-3" = "fast",
    o: { feed?: "all" | "first" } = {},
  ): Promise<{ decision: Record<string, any>; input: Record<string, unknown> | null; run: ProcRun; pageCount: number; fed: number; lastFedIsLast: boolean }> {
    const titleFile = this.file("title.txt", `${title}\n`);
    const q = await this.door(`${ADAPTERS_SRC}/create_idempotency_probe.ts`, ["query", root, "--title-file", titleFile, ...this.containerFlags(m)], {
      sessionId: session.id,
    });
    this.check(q.exitCode === 0, `query in ${root} failed (exit ${q.exitCode}): ${q.stderr}`);
    const qj = JSON.parse(q.stdout.trim().split("\n").find((l) => l.startsWith("{"))!);
    const pages =
      this.tracker === "jira" ? this.jira.searchAll(qj.jql, qj.fields, 100) : this.linear.listAll(qj);
    const fedPages = o.feed === "first" ? pages.slice(0, 1) : pages;
    const pageFiles = fedPages.map((p, i) => this.file(`page-${i + 1}.json`, p));
    const last = fedPages[fedPages.length - 1] as Record<string, any> | undefined;
    const lastFedIsLast = last === undefined ? false : this.tracker === "jira" ? last.isLast === true : last.pageInfo?.hasNextPage === false;
    const d = await this.door(
      `${ADAPTERS_SRC}/create_idempotency_probe.ts`,
      ["decide", root, ...pageFiles, "--title-file", titleFile, ...this.containerFlags(m), "--attempt", attempt],
      { session },
    );
    this.check(d.exitCode === 0, `decide in ${root} failed (exit ${d.exitCode}): ${d.stderr}`);
    const decision = JSON.parse(d.stdout.trim().split("\n").find((l) => l.startsWith("{"))!);
    let input: Record<string, unknown> | null = null;
    if (decision.outcome === "create") input = this.createInput(decision.createPayload);
    return { decision, input, run: d, pageCount: pages.length, fed: pageFiles.length, lastFedIsLast };
  }

  /** The create call the model sends for a decided `createPayload`. */
  createInput(p: Record<string, any>): Record<string, unknown> {
    if (this.tracker === "jira") {
      return {
        cloudId: "fixture-cloud",
        projectKey: p.project,
        issueTypeName: "Task",
        summary: p.summary,
        ...(p.parent ? { parent: p.parent } : {}),
        additional_fields: { labels: p.labels },
      };
    }
    return {
      ...(p.team ? { team: p.team } : {}),
      project: p.project,
      title: p.title,
      labels: p.labels,
      ...(p.milestone ? { milestone: p.milestone } : {}),
    };
  }

  createdKey(w: WriteOutcome): string {
    this.check(w.result !== null, `expected the create to return a key, got none (blocked=${w.blocked}, transportError=${w.transportError})`);
    return String(w.result!.key ?? w.result!.identifier);
  }

  /** attach (once per session+plan) → decide → create through the harness. */
  async createFr(
    repo: FixtureRepo,
    session: Session,
    title: string,
    o: { cwd?: string; milestone?: MilestoneRef; skipAttach?: boolean } = {},
  ): Promise<{ w: WriteOutcome; decision: Record<string, any>; key: string | null; pageCount: number; fed: number; lastFedIsLast: boolean }> {
    const m = o.milestone ?? repo.milestone;
    const plan = join(repo.root, "specs", "plan", `${m.token}.md`);
    const attachedKey = `${session.id}|${plan}`;
    if (!o.skipAttach && !ATTACHED.has(attachedKey)) {
      const a = await this.attach(repo, session, plan);
      this.check(a.exitCode === 0, `the attach front door did not resolve ${plan} (exit ${a.exitCode}): ${a.stderr}`);
      ATTACHED.add(attachedKey);
    }
    const { decision, input, pageCount, fed, lastFedIsLast } = await this.decide(repo.root, session, title, m);
    this.check(decision.outcome === "create", `decide for "${title}" in ${repo.name} should create, got ${JSON.stringify(decision)}`);
    const tool = this.tracker === "jira" ? "createJiraIssue" : "save_issue";
    const w = await this.write(repo, session, tool, input!, { cwd: o.cwd ?? repo.root });
    return { w, decision, key: w.result ? String(w.result.key ?? w.result.identifier) : null, pageCount, fed, lastFedIsLast };
  }

  ticket(key: string): { key: string; title: string; labels: string[] } {
    if (this.tracker === "jira") {
      const i = this.jira.find(key);
      this.check(i, `the double holds no ticket ${key}`);
      return { key: i.key, title: i.summary, labels: i.labels };
    }
    const i = this.linear.find(key);
    this.check(i, `the double holds no ticket ${key}`);
    return { key: i.identifier, title: i.title, labels: i.labels };
  }

  tickets(): Array<{ key: string; title: string; labels: string[]; container: string | null; isContainer: boolean }> {
    if (this.tracker === "jira") {
      return this.jira.issues.map((i) => ({ key: i.key, title: i.summary, labels: i.labels, container: i.parent, isContainer: i.issuetype === "Epic" }));
    }
    return this.linear.issues.map((i) => ({ key: i.identifier, title: i.title, labels: i.labels, container: i.projectMilestone?.id ?? null, isContainer: false }));
  }

  seedTicket(o: { title: string; labels: string[]; container?: MilestoneRef | null; project?: string }): string {
    if (this.tracker === "jira") {
      return this.jira.seed({ project: o.project ?? JIRA_PROJECT, summary: o.title, labels: o.labels, parent: o.container?.key ?? null }).key;
    }
    return this.linear.seed({
      project: o.project ?? LINEAR_PROJECT,
      team: LINEAR_TEAM,
      title: o.title,
      labels: o.labels,
      projectMilestone: o.container ? { id: o.container.key, name: o.container.title } : null,
    }).identifier;
  }

  /** The full container page set the orphan listing and the detector read. */
  containerPages(): string[] {
    const pages =
      this.tracker === "jira"
        ? this.jira.searchAll(`project = ${JIRA_PROJECT} AND statusCategory != Done`, ["key", "summary", "issuetype", "labels", "description", "creator", "project"], 100)
        : this.linear.listAll({ team: LINEAR_TEAM, project: LINEAR_PROJECT, fields: ["id", "title", "labels", "description", "createdBy", "project", "team"], limit: 250 });
    return pages.map((p, i) => this.file(`container-page-${i + 1}.json`, p));
  }

  /** The raw single-ticket answer the ownership decision reads. */
  ticketFile(key: string): string {
    const raw = this.tracker === "jira" ? this.jira.get({ cloudId: "fixture-cloud", issueIdOrKey: key }) : this.linear.get({ id: key });
    return this.file(`ticket-${key}.json`, raw);
  }

  /** Run the M_947c79 untagged-ticket detector (probe #49's front door) over `pages` from `root`. */
  async detector(root: string, pages: string[]): Promise<ProcRun> {
    return this.door(`${ADAPTERS_SRC}/tracker_local_reconciliation_drift.ts`, [root, ...pages], { kind: "detector" });
  }

  /** Milestone decision front door. */
  async resolveMilestone(
    root: string,
    session: Session,
    how: { title: string } | { joinKey: string },
    o: { sibling?: string; listing?: string } = {},
  ): Promise<ProcRun & { command: string; fields: Record<string, string> }> {
    const project = this.tracker === "jira" ? JIRA_PROJECT : LINEAR_PROJECT;
    const args = [root, this.tracker, project, o.listing ?? this.containerListing()];
    if ("title" in how) args.push("--title", how.title);
    else args.push("--join-key", how.joinKey);
    if (o.sibling !== undefined) args.push("--sibling", o.sibling);
    const r = await this.door(`${ADAPTERS_SRC}/resolve_milestone_identity.ts`, args, { session });
    const fields: Record<string, string> = {};
    for (const line of r.stdout.split("\n")) {
      const m = /^([A-Za-z]+)=(.*)$/.exec(line);
      if (m) fields[m[1]!] = m[2]!;
    }
    return { ...r, fields };
  }

  /** The container-create call a decided milestone sends. */
  milestoneCreateInput(title: string): { tool: string; input: Record<string, unknown> } {
    if (this.tracker === "jira") {
      return { tool: "createJiraIssue", input: { cloudId: "fixture-cloud", projectKey: JIRA_PROJECT, issueTypeName: "Epic", summary: title } };
    }
    return { tool: "save_milestone", input: { project: LINEAR_PROJECT, name: title } };
  }

  /** Mint: decision (act=create) → container create through the hook → the plan, committed. */
  async mint(repo: FixtureRepo, session: Session, title: string): Promise<MilestoneRef> {
    const d = await this.resolveMilestone(repo.root, session, { title });
    this.check(d.exitCode === 0, `the milestone decision for "${title}" in ${repo.name} refused (exit ${d.exitCode}): ${d.stderr}`);
    this.eq(d.fields.act, "create", `the milestone decision for a new title "${title}" in ${repo.name} prints act=`);
    const c = this.milestoneCreateInput(title);
    const w = await this.write(repo, session, c.tool, c.input, { cwd: repo.root });
    this.expectPermitted(w, `the container create of "${title}" under its create decision`);
    const key = String(w.result!.key ?? w.result!.id);
    const m: MilestoneRef = { token: this.tracker === "jira" ? tokenOfEpic(key) : tokenOfLinearMilestone(key), key, title };
    writePlanFile(repo.root, m);
    commitAll(repo.root, `plan ${m.token}`);
    return m;
  }

  // ------------------------------------------------------------------ commit / PR hooks

  async commitHook(
    which: "pre-commit-gate-check" | "pre-pr-spec-review" | "pre-commit-tdd-orchestrator",
    command: string,
    o: { session: Session; cwd: string; env?: Record<string, string>; pathOverride?: string },
  ): Promise<ProcRun> {
    const payload = JSON.stringify({
      session_id: o.session.id,
      transcript_path: o.session.file,
      cwd: o.cwd,
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command },
    });
    const env = doorEnv(this.pluginRoot, o.session.id, o.env);
    if (o.pathOverride !== undefined) env.PATH = o.pathOverride;
    const r = await this.spawn(["/bin/bash", join(this.pluginRoot, "templates", "hooks", "process", `${which}.sh`)], { cwd: o.cwd, env, stdin: payload }, `${which}.sh`);
    this.counts["commit-pr-hook"] += 1;
    return r;
  }

  /** Mint a gate receipt in `root` through the gate-receipt front door; returns its announcement line. */
  async gateReceipt(root: string, skill: "gate-check" | "spec-review" | "tdd", session: Session): Promise<string> {
    const r = await this.door(`${ADAPTERS_SRC}/gate_receipt.ts`, [skill, root], { sessionId: session.id });
    this.check(r.exitCode === 0, `the gate-receipt front door failed in ${root} (exit ${r.exitCode}): ${r.stderr}`);
    const line = r.stdout.split("\n").find((l) => l.startsWith("dpt-receipt: "));
    this.check(line, `the gate-receipt front door printed no dpt-receipt line: ${r.stdout}`);
    return line.trim();
  }

  /** A Skill window for `skill` holding exactly `announcements`. */
  evidenceWindow(session: Session, skill: string, announcements: string[], front: string): void {
    session.skill(`dev-process-toolkit:${skill}`, PAST);
    for (const line of announcements) session.bash(`bun run "\${CLAUDE_PLUGIN_ROOT}/${ADAPTERS_SRC}/gate_receipt.ts" ${front} .`, line);
  }
}

const ATTACHED = new Set<string>();

/** Every PreToolUse matcher `hooks.json` registers for the tracker-write hook, as regular expressions. */
export function trackerHookMatchers(pluginRoot: string): RegExp[] {
  const hooks = JSON.parse(readFileSync(join(pluginRoot, "hooks", "hooks.json"), "utf-8")) as {
    hooks?: { PreToolUse?: Array<{ matcher?: string; hooks?: Array<{ command?: string }> }> };
  };
  const out: RegExp[] = [];
  for (const g of hooks.hooks?.PreToolUse ?? []) {
    if ((g.hooks ?? []).some((h) => String(h.command ?? "").includes("pre-tracker-write-gate.sh"))) {
      out.push(new RegExp(g.matcher ?? ""));
    }
  }
  return out;
}

// ===========================================================================
// Scenarios
// ===========================================================================

export type ScenarioBody = (ctx: Ctx) => Promise<void>;

export interface ScenarioDef {
  shape: FixtureShape;
  body: ScenarioBody;
  trackers: readonly Tracker[];
  title: string;
}

/** Title pairs for S1 / S2: identical, then dash, NBSP and whitespace variants. */
const TITLE_VARIANTS: Array<{ label: string; a: string; b: string }> = [
  { label: "identical", a: "Payout export daily run", b: "Payout export daily run" },
  { label: "dash", a: "Ledger sync — nightly", b: "Ledger sync - nightly" },
  { label: "NBSP", a: "Refund report weekly", b: "Refund report weekly" },
  { label: "whitespace", a: "Invoice  batch   close ", b: "Invoice batch close" },
];

function carriesOnly(ctx: Ctx, key: string, own: string, other: string, what: string): void {
  const t = ctx.ticket(key);
  ctx.check(t.labels.includes(own), `${what}: ticket ${key} should carry its own tag ${own}, labels=${JSON.stringify(t.labels)}`);
  ctx.check(!t.labels.includes(other), `${what}: ticket ${key} must not carry the sibling's tag ${other}, labels=${JSON.stringify(t.labels)}`);
}

/** S1 / S2: same-title creates in each repository never resolve to the sibling's ticket. */
async function sameTitle(ctx: Ctx): Promise<void> {
  const { a, b } = ctx.fx;
  const sA = ctx.session("a");
  const sB = ctx.session("b");
  for (const v of TITLE_VARIANTS) {
    ctx.step(`title variant ${v.label}`);
    const ra = await ctx.createFr(a, sA, v.a);
    ctx.expectPermitted(ra.w, `A's create of "${v.label}" title`);
    const rb = await ctx.createFr(b, sB, v.b);
    ctx.expectPermitted(rb.w, `B's create of the ${v.label} variant of A's title`);
    ctx.check(rb.decision.outcome === "create", `B's decision for the ${v.label} variant must be create, never a reuse of A's ticket: ${JSON.stringify(rb.decision)}`);
    ctx.check(ra.key !== null && rb.key !== null && ra.key !== rb.key, `${v.label}: A and B must end with distinct tickets, got A=${ra.key} B=${rb.key}`);
    carriesOnly(ctx, ra.key!, a.tag, b.tag, `${v.label}: A's ticket`);
    carriesOnly(ctx, rb.key!, b.tag, a.tag, `${v.label}: B's ticket`);
  }

  // The nearest honest form of "A's ticket on the second page of B's
  // pre-create listing": the real query carries B's tag, so A's ticket is on
  // no page of it at all. What is graded instead: B's listing is forced to
  // span >= 2 pages (three phrase-containing B rows at page size 2), A's
  // same-title ticket is created AFTER them (so any listing that lost the tag
  // conjunct would carry it on its second page), the decide is fed every page
  // and still never resolves to A's ticket, and a decide fed only the first
  // page refuses `page-cap` with no write (row (ai) reds exactly that).
  ctx.step("A's ticket on the second page of B's pre-create listing");
  const title = "Cache warmup job";
  for (let n = 1; n <= 3; n++) ctx.seedTicket({ title: `${title} (old ${n})`, labels: [b.tag], container: b.milestone });
  const ra = await ctx.createFr(a, sA, title);
  ctx.expectPermitted(ra.w, "A's create of the paged title");
  ctx.fx.double.pageSize = 2;
  let rb: Awaited<ReturnType<Ctx["createFr"]>>;
  try {
    ctx.step("B's decision fed only the FIRST page of its multi-page listing");
    const w0 = ctx.writes;
    const first = await ctx.decide(b.root, sB, title, b.milestone, "fast", { feed: "first" });
    ctx.check(first.pageCount >= 2, `B's pre-create listing must span at least two pages at page size 2, got ${first.pageCount}`);
    ctx.check(first.fed === 1 && !first.lastFedIsLast, `the first-page-only decide must be fed exactly one page that is not the last (fed=${first.fed}, lastFedIsLast=${first.lastFedIsLast})`);
    ctx.eq(first.run.exitCode, 0, "the first-page-only decide prints its refusal as a decision, exit");
    ctx.eq(
      [first.decision.outcome, first.decision.reason ?? null],
      ["refused", "page-cap"],
      `B's decision from only the first page of its ${first.pageCount}-page listing (outcome, reason)`,
    );
    ctx.eq(ctx.writes, w0, "the double's write count after the first-page-only refusal");
    ctx.step("permit twin: the same decide fed every page");
    rb = await ctx.createFr(b, sB, title);
  } finally {
    ctx.fx.double.pageSize = null;
  }
  ctx.check(rb.pageCount >= 2, `B's pre-create listing must span at least two pages at page size 2, got ${rb.pageCount}`);
  ctx.eq(rb.fed, rb.pageCount, "pages of B's pre-create listing fed to its decide");
  ctx.check(rb.lastFedIsLast, "the final page fed to B's decide must be the last page of its listing");
  ctx.expectPermitted(rb.w, "B's create when its listing pages at 2 rows");
  ctx.check(rb.key !== null && rb.key !== ra.key, `B's paged create must make its own ticket, got B=${rb.key} A=${ra.key}`);
  carriesOnly(ctx, rb.key!, b.tag, a.tag, "paged: B's ticket");

  ctx.step("the decide consumes every page: B's own exact-title ticket sits only on page 2");
  {
    const t2 = "Nightly digest";
    for (let n = 1; n <= 2; n++) ctx.seedTicket({ title: `${t2} (old ${n})`, labels: [b.tag], container: b.milestone });
    const own = ctx.seedTicket({ title: t2, labels: [b.tag], container: b.milestone });
    ctx.fx.double.pageSize = 2;
    try {
      const all = await ctx.decide(b.root, sB, t2, b.milestone);
      ctx.check(all.pageCount >= 2 && all.fed === all.pageCount, `the digest listing must span >= 2 pages, all fed (pages=${all.pageCount}, fed=${all.fed})`);
      ctx.eq([all.decision.outcome, all.decision.key], ["reused", own], "B's decision when its own exact-title ticket is on page 2 only");
      const w1 = ctx.writes;
      const first = await ctx.decide(b.root, sB, t2, b.milestone, "fast", { feed: "first" });
      ctx.eq([first.decision.outcome, first.decision.reason ?? null], ["refused", "page-cap"], `B's digest decision from only the first page of its ${first.pageCount}-page listing (outcome, reason)`);
      ctx.eq(ctx.writes, w1, "the double's write count after the digest first-page refusal");
    } finally {
      ctx.fx.double.pageSize = null;
    }
  }

  ctx.step("permit twin: A's own network-error retry resolves to A's own ticket");
  const rTitle = "Audit trail export";
  const plan = join(a.root, "specs", "plan", `${a.milestone.token}.md`);
  void plan;
  const { decision, input } = await ctx.decide(a.root, sA, rTitle, a.milestone);
  ctx.eq(decision.outcome, "create", "A's fast decision for the retry title");
  ctx.fx.double.failNextWrite = true;
  const tool = ctx.tracker === "jira" ? "createJiraIssue" : "save_issue";
  const lost = await ctx.write(a, sA, tool, input!, { cwd: a.root });
  ctx.expectPermitted(lost, "A's create that lands and then times out");
  ctx.check(lost.transportError, "the double should have answered A's create with a transport error");
  const writesBefore = ctx.writes;
  const again = await ctx.write(a, sA, tool, input!, { cwd: a.root });
  ctx.expectRefused(again, "A re-sending the create whose outcome is unknown");
  ctx.eq(ctx.writes, writesBefore, "the refused re-send leaves the double's write count");
  const retry = await ctx.decide(a.root, sA, rTitle, a.milestone, "retry-1");
  ctx.eq(retry.decision.outcome, "reused", "A's retry-1 decision after the lost create");
  const mine = ctx.tickets().filter((t) => t.title === rTitle);
  ctx.eq(mine.length, 1, `tickets titled "${rTitle}" after the retry`);
  ctx.eq(retry.decision.key, mine[0]!.key, "the retry reuses A's own landed ticket");
  carriesOnly(ctx, mine[0]!.key, a.tag, b.tag, "retry: A's ticket");
}

/** `<root>/.dpt/ledger/receipts/<session>/` — the receipt store (dpt_paths.ts, spelled here, not imported). */
export function receiptsDirOf(root: string, sessionId: string): string {
  return join(root, ".dpt", "ledger", "receipts", sessionId);
}

export function receiptFiles(root: string, sessionId: string): string[] {
  const dir = receiptsDirOf(root, sessionId);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => n.endsWith(".json")).map((n) => join(dir, n));
}

/** S3: A mints; B joins by key; B's coincident title is never a silent bind. */
async function mintAndJoin(ctx: Ctx): Promise<void> {
  const { a, b } = ctx.fx;
  const sA = ctx.session("a");
  const sB = ctx.session("b");
  const stale = ctx.containerListing(); // B's listing, read before A mints
  ctx.step("A mints");
  const m = await ctx.mint(a, sA, "Gamma Release");

  ctx.step("B joins A's milestone by key");
  const join = await ctx.resolveMilestone(b.root, sB, { joinKey: m.key }, { sibling: a.root });
  ctx.check(join.exitCode === 0, `B's join of ${m.key} by key refused (exit ${join.exitCode}): ${join.stderr}`);
  ctx.eq(join.fields.act, "join", "B's join by key prints act=");
  ctx.eq(join.fields.via, "key", "B's join by key prints via=");
  ctx.eq(join.fields.milestoneId, m.token, "B's join prints A's milestone token as milestoneId=");
  const bPlan = writePlanFile(b.root, { token: join.fields.milestoneId!, key: m.key, title: m.title });
  ctx.check(basename(bPlan) === `${m.token}.md` && readFileSync(bPlan, "utf-8").includes(`milestone: ${m.token}`), `B's plan written from its join output must carry A's token ${m.token}`);

  ctx.step("B's coincident title without a join key");
  const approved = await ctx.resolveMilestone(b.root, sB, { title: m.title }, { listing: stale });
  ctx.check(approved.exitCode === 0 && approved.fields.act === "create", `B's decision on the stale listing should be an approved create, got exit ${approved.exitCode} act=${approved.fields.act}: ${approved.stderr}`);
  const writes0 = ctx.writes;
  const receipts0 = receiptFiles(b.root, sB.id).length;
  const silent = await ctx.resolveMilestone(b.root, sB, { title: m.title });
  ctx.check(silent.exitCode === 1, `B's coincident title with no join key must refuse (exit 1), got exit ${silent.exitCode}: stdout=${silent.stdout} stderr=${silent.stderr}`);
  ctx.check(silent.stderr.includes(m.key), `the refusal must name A's milestone key ${m.key}: ${silent.stderr}`);
  ctx.eq(receiptFiles(b.root, sB.id).length, receipts0, "receipts written by the refused coincident-title decision");
  ctx.eq(ctx.writes, writes0, "the double's write count after the refused decision");
  const titled = await ctx.resolveMilestone(b.root, sB, { title: m.title }, { sibling: a.root });
  ctx.check(titled.exitCode === 0 && titled.fields.act === "join", `with --sibling the coincident title decides a join, got exit ${titled.exitCode} act=${titled.fields.act}: ${titled.stderr}`);
  const c = ctx.milestoneCreateInput(m.title);
  const w = await ctx.write(b, sB, c.tool, c.input, { cwd: b.root });
  ctx.expectRefused(w, "B's container create under its superseded approved-create receipt");
  ctx.eq(ctx.writes, writes0, "the double's write count after the refused container create");

  ctx.step("joins of absent, closed and malformed keys");
  const absentKey = ctx.tracker === "jira" ? `${JIRA_PROJECT}-999` : "bbbbbb00-2222-4222-8222-000000000999";
  const cases: Array<[string, string]> = [["absent", absentKey], ["malformed", "not-a-key"]];
  if (ctx.tracker === "jira") {
    const closed = ctx.jira.seed({ project: JIRA_PROJECT, summary: "Closed Release", issuetype: "Epic", status: { name: "Done", category: "done" } });
    cases.push(["closed", closed.key]);
  } else {
    // The Linear closed-key leg is absent BY DESIGN, and that is graded, not
    // assumed: Linear milestones carry no status, so the decision door has no
    // closed rule to apply (resolve_milestone_identity.ts:656 prints it). Its
    // own listing line must say so; a door that grew a closed state would
    // change this line and red here, forcing the leg to be written.
    ctx.check(
      /^\d+ rows, closed rule not applicable \(Linear milestones carry no status\)$/.test(join.fields.listing ?? ""),
      `the Linear decision door must print that no closed rule applies, got listing=${join.fields.listing}`,
    );
  }
  for (const [label, key] of cases) {
    const r = await ctx.resolveMilestone(b.root, sB, { joinKey: key }, { sibling: a.root });
    ctx.check(r.exitCode === 1, `a join naming the ${label} key ${key} must refuse (exit 1), got exit ${r.exitCode}: ${r.stdout}`);
    ctx.eq(ctx.writes, writes0, `the double's write count after the ${label}-key join`);
  }

  if (ctx.tracker === "jira") {
    ctx.step("a milestone decision from a listing that is not the last page (Jira)");
    ctx.jira.pageSize = 1;
    const page1 = ctx.jira.search({ cloudId: "fixture-cloud", jql: `project = ${JIRA_PROJECT} AND issuetype = Epic`, fields: ["summary", "project", "issuetype", "status", "labels"] });
    ctx.jira.pageSize = null;
    ctx.check(page1.isLast === false, "the forced one-row page must not be the last");
    const r = await ctx.resolveMilestone(b.root, sB, { title: "Delta Release" }, { listing: ctx.file("not-last.json", page1) });
    ctx.check(r.exitCode === 1, `a decision from a not-last listing page must refuse (exit 1), got exit ${r.exitCode}: ${r.stdout}`);
    ctx.eq(ctx.writes, writes0, "the double's write count after the not-last-page decision");
  }
}

interface ListingRow {
  key: string;
  cls: string;
}

function listingRows(out: string): ListingRow[] {
  return out
    .split("\n")
    .filter((l) => l.startsWith("| ") && !l.startsWith("| Key ") && !l.startsWith("|---"))
    .map((l) => l.split("|").map((c) => c.trim()))
    .map((c) => ({ key: c[1]!, cls: c[2]! }));
}

/** S4: the orphan listing and the untagged detector from both repositories. */
async function orphanListing(ctx: Ctx): Promise<void> {
  const { a, b } = ctx.fx;
  const aKeys = [1, 2].map((n) => ctx.seedTicket({ title: `A work ${n}`, labels: [a.tag], container: a.milestone }));
  const bKeys = [1, 2].map((n) => ctx.seedTicket({ title: `B work ${n}`, labels: [b.tag], container: b.milestone }));
  const untagged = ctx.seedTicket({ title: "Filed by hand", labels: [] });
  const pages = ctx.containerPages();
  for (const [self, own, sib] of [
    [a, aKeys, bKeys],
    [b, bKeys, aKeys],
  ] as const) {
    ctx.step(`${self.name}'s reconcile listing`);
    const list = await ctx.door(`${ADAPTERS_SRC}/container_ownership.ts`, ["list", self.root, ...pages]);
    ctx.check(list.exitCode === 0, `${self.name}'s listing failed (exit ${list.exitCode}): ${list.stderr}`);
    const rows = listingRows(list.stdout);
    for (const k of sib) {
      ctx.eq(rows.find((r) => r.key === k)?.cls, "sibling", `${self.name}'s listing class of the sibling's tagged ticket ${k}`);
      ctx.check(!list.stdout.includes(`options: Import ${k} `), `${self.name}'s listing must not offer the sibling's ticket ${k} as an import:\n${list.stdout}`);
    }
    for (const k of own) ctx.eq(rows.find((r) => r.key === k)?.cls, "ours", `${self.name}'s listing class of its own ticket ${k}`);
    ctx.eq(rows.find((r) => r.key === untagged)?.cls, "unowned", `${self.name}'s listing class of the untagged ticket ${untagged} (never ours, never a sibling's)`);
    await detectorFlagsOnly(ctx, self.root, pages, [untagged], [...aKeys, ...bKeys], self.name);
  }

  ctx.step("an empty container yields the named empty outcome");
  const empty = ctx.tracker === "jira" ? { issues: [], isLast: true } : { issues: [], pageInfo: { hasNextPage: false, endCursor: null } };
  const e = await ctx.detector(a.root, [ctx.file("empty.json", empty)]);
  ctx.check(e.exitCode === 0 && /^info container-empty:/m.test(e.stdout), `an empty complete container must report "info container-empty", got exit ${e.exitCode}:\n${e.stdout}${e.stderr}`);

  ctx.step("a listing the detector cannot complete is a named refusal");
  ctx.fx.double.pageSize = 2;
  const multi = ctx.containerPages();
  ctx.fx.double.pageSize = null;
  ctx.check(multi.length >= 3, `the forced two-row pages should make at least three pages, got ${multi.length}`);
  const errorBody = ctx.file(
    "transport-error.json",
    ctx.tracker === "jira" ? { errorMessages: ["Internal server error"], errors: {} } : { error: "fetch failed: socket hang up" },
  );
  const incomplete: Array<[string, string[], string]> = [
    ["a transport-error body on page 2", [multi[0]!, errorBody], errorBody],
    ["a set whose last page is not the last", [multi[0]!], multi[0]!],
  ];
  for (const [label, set, named] of incomplete) {
    for (const root of [a.root, b.root]) {
      const r = await ctx.detector(root, set);
      const all = `${r.stdout}${r.stderr}`;
      ctx.check(r.exitCode !== 0, `${label}: the detector must refuse (non-zero exit), got exit 0:\n${all}`);
      ctx.check(all.includes(named), `${label}: the refusal must name the page ${named}:\n${all}`);
      ctx.check(!/container-empty/.test(all), `${label}: must never read as the empty outcome:\n${all}`);
      ctx.check(!/^warning container-partial/m.test(all), `${label}: must be a refusal, never "warning container-partial":\n${all}`);
    }
  }
  ctx.step("permit row: a complete multi-page listing");
  await detectorFlagsOnly(ctx, a.root, multi, [untagged], [...aKeys, ...bKeys], "a (multi-page)");
}

async function detectorFlagsOnly(ctx: Ctx, root: string, pages: string[], flagged: string[], neverFlagged: string[], who: string): Promise<void> {
  const d = await ctx.detector(root, pages);
  ctx.check(d.exitCode === 0, `${who}: the detector over a complete listing should exit 0, got ${d.exitCode}: ${d.stderr}`);
  ctx.check(!/container-partial/.test(d.stdout), `${who}: a complete listing must not read as partial:\n${d.stdout}`);
  const unowned = d.stdout.split("\n").filter((l) => /^warning unowned-container-ticket:/.test(l));
  for (const k of flagged) {
    ctx.check(unowned.some((l) => l.includes(`${k} `)), `${who}: the detector must flag the untagged ticket ${k}:\n${d.stdout}`);
  }
  for (const k of neverFlagged) {
    const flaggedRow = d.stdout.split("\n").find((l) => /^(warning|error) (unowned-container-ticket|bound-ticket-untagged):/.test(l) && new RegExp(`\\b${k}\\b`).test(l));
    ctx.check(flaggedRow === undefined, `${who}: no ticket carrying a declared tag may be flagged as untagged, but ${k} was: ${flaggedRow}`);
  }
}

/** S10: a ticket written straight to the double — no tag, no hook. */
async function oldClient(ctx: Ctx): Promise<void> {
  const { a, b } = ctx.fx;
  const sA = ctx.session("a");
  const sB = ctx.session("b");
  const ka = (await ctx.createFr(a, sA, "Settlement report")).key!;
  const kb = (await ctx.createFr(b, sB, "Settlement report")).key!;
  const writes0 = ctx.writes;
  const old = ctx.seedTicket({ title: "Hotfix filed by an old client", labels: [], container: a.milestone });
  ctx.eq(ctx.writes, writes0, "a straight-to-the-double ticket passes no hook and no front door");
  const pages = ctx.containerPages();
  await detectorFlagsOnly(ctx, a.root, pages, [old], [ka, kb], "a");
  await detectorFlagsOnly(ctx, b.root, pages, [old], [ka, kb], "b");
}

/** An FR file bound to `milestone` (active under specs/frs/, archived under specs/frs/archive/). */
export function writeFrFile(root: string, id: string, milestone: string, status: "active" | "archived", trackerKey?: string, tracker?: Tracker): string {
  const dir = status === "active" ? join(root, "specs", "frs") : join(root, "specs", "frs", "archive");
  mkdirSync(dir, { recursive: true });
  const p = join(dir, `${id}.md`);
  writeFileSync(
    p,
    [
      "---",
      `title: Fixture FR ${id}`,
      `milestone: ${milestone}`,
      `status: ${status}`,
      `archived_at: ${status === "archived" ? "2026-09-10T00:00:00Z" : "null"}`,
      ...(trackerKey ? ["tracker:", `  ${tracker ?? "jira"}: ${trackerKey}`] : []),
      "---",
      "",
      `# Fixture FR ${id}`,
      "",
    ].join("\n"),
  );
  return p;
}

/** Mint in A, join from B (plan written from the join output), declare the span, commit both plans. */
async function spannedMilestone(ctx: Ctx, title: string): Promise<{ m: MilestoneRef; aPlan: string; bPlan: string }> {
  const { a, b } = ctx.fx;
  const sA = ctx.session("a-mint");
  const sB = ctx.session("b-join");
  const m = await ctx.mint(a, sA, title);
  const aPlan = join(a.root, "specs", "plan", `${m.token}.md`);
  const j = await ctx.resolveMilestone(b.root, sB, { joinKey: m.key }, { sibling: a.root });
  ctx.check(j.exitCode === 0 && j.fields.act === "join", `B's join of ${m.key} refused (exit ${j.exitCode}): ${j.stderr}`);
  const bPlan = writePlanFile(b.root, { token: j.fields.milestoneId!, key: m.key, title: m.title });
  commitAll(b.root, `plan ${j.fields.milestoneId} from the join output`);
  const d = await ctx.door(`${ADAPTERS_SRC}/spans_repos.ts`, [aPlan, m.token, "--declare", b.root], { cwd: a.root });
  ctx.check(d.exitCode === 0, `declaring the span from A refused (exit ${d.exitCode}): ${d.stderr}`);
  commitAll(a.root, "declare span");
  commitAll(b.root, "declare span");
  return { m, aPlan, bPlan };
}

/** S5: the sibling ship gate in A while B is busy, unreadable, absent, malformed, idle, or busy elsewhere. */
async function siblingBusy(ctx: Ctx): Promise<void> {
  const { a, b } = ctx.fx;
  const { m, aPlan, bPlan } = await spannedMilestone(ctx, "Span Release");
  writeFrFile(b.root, "FR-0", m.token, "archived");
  commitAll(b.root, "B: one archived FR bound to the shared token");
  const gate = () => ctx.door(`${ADAPTERS_SRC}/sibling_release.ts`, [a.root, aPlan, m.token, "--offer"], { cwd: a.root });
  const held = async (label: string) => {
    const r = await gate();
    ctx.check(r.exitCode === 1, `${label}: A's release must be held (exit 1), got exit ${r.exitCode}:\n${r.stdout}${r.stderr}`);
    ctx.check(r.stderr.includes(b.tag) || r.stderr.includes(b.root), `${label}: the refusal must name B (${b.tag}):\n${r.stderr}`);
  };
  const passes = async (label: string) => {
    const r = await gate();
    ctx.check(r.exitCode === 0, `${label}: A's release must pass (exit 0), got exit ${r.exitCode}:\n${r.stdout}${r.stderr}`);
  };

  ctx.step("B idle");
  await passes("B idle (one archived FR, plan names A back)");

  ctx.step("busy in B's main checkout");
  const fr1 = writeFrFile(b.root, "FR-1", m.token, "active");
  await held("B holds an active FR in its main checkout");
  rmSync(fr1);

  ctx.step("busy only on a second worktree of B");
  const wt = ctx.fx.addWorktree("b");
  writeFrFile(wt, "FR-2", m.token, "active");
  await held("B holds an active FR only on a second worktree");
  git(b.root, "worktree", "remove", "--force", wt);

  ctx.step("busy only on an unmerged branch of B");
  const br = ctx.fx.addWorktree("b", { branch: "feat-busy" });
  writeFrFile(br, "FR-3", m.token, "active");
  commitAll(br, "FR-3 on an unmerged branch");
  git(b.root, "worktree", "remove", "--force", br);
  await held("B holds an active FR only on an unmerged branch");

  ctx.step("permit twin: that FR archived on every ref");
  const br2 = ctx.fx.addWorktree("b", { branch: "feat-busy-archive" });
  git(br2, "checkout", "-q", "feat-busy");
  git(br2, "rm", "-q", join("specs", "frs", "FR-3.md"));
  writeFrFile(br2, "FR-3", m.token, "archived");
  commitAll(br2, "archive FR-3");
  git(b.root, "worktree", "remove", "--force", br2);
  await passes("B's FR archived on every ref");

  ctx.step("permit twin: B busy only on a different milestone");
  const other = writeFrFile(b.root, "FR-5", "M_OTHER_1", "active");
  await passes("B holds an active FR bound only to a different milestone token");
  rmSync(other);

  ctx.step("B unreadable");
  const frs = join(b.root, "specs", "frs");
  chmodSync(frs, 0o000);
  try {
    await held("B's specs cannot be read");
  } finally {
    chmodSync(frs, 0o755);
  }

  ctx.step("B's root itself unreadable");
  chmodSync(b.root, 0o000);
  try {
    await held("B's root directory cannot be read");
  } finally {
    chmodSync(b.root, 0o755);
  }

  ctx.step("B's plan for the shared token malformed");
  const original = readFileSync(bPlan, "utf-8");
  ctx.check(/^spans_repos:/m.test(original), `B's plan should carry the declared spans_repos block:\n${original}`);
  writeFileSync(bPlan, original.replace(/^spans_repos:\n(?:[ \t]+.*\n)+/m, "spans_repos: 42\n"));
  try {
    await held("B's plan carries a malformed spans_repos");
  } finally {
    writeFileSync(bPlan, original);
  }

  ctx.step("B absent");
  const moved = `${b.root}.moved`;
  renameSync(b.root, moved);
  try {
    await held("B's path no longer exists");
  } finally {
    renameSync(moved, b.root);
  }
  await passes("B restored, idle again");
}

/**
 * D-2, measured (never skipped): B's FR archived on B's main branch but still
 * active on an unmerged branch. AC-STE-616.8 requires exit 1; the gate counts
 * an FR archived on any one ref as inactive everywhere
 * (`active_plan_ship_ready.ts:376-379`). Returns the gate's exit code.
 */
export async function measureKnownDefectD2(tracker: Tracker, pluginRoot: string): Promise<{ exitCode: number; output: string }> {
  let out = { exitCode: -1, output: "" };
  await withSharedTrackerFixture({ tracker, shape: "coexist", pluginRoot }, async (fx) => {
    const ctx = new Ctx(fx, pluginRoot, harnessBlocks);
    const { m, aPlan } = await spannedMilestone(ctx, "Span Release");
    writeFrFile(fx.b.root, "FR-0", m.token, "archived");
    commitAll(fx.b.root, "B: archived FR");
    const br = fx.addWorktree("b", { branch: "feat-still-active" });
    writeFrFile(br, "FR-4", m.token, "active");
    commitAll(br, "FR-4 active on an unmerged branch");
    git(fx.b.root, "worktree", "remove", "--force", br);
    writeFrFile(fx.b.root, "FR-4", m.token, "archived");
    commitAll(fx.b.root, "FR-4 archived on main only");
    const r = await ctx.door(`${ADAPTERS_SRC}/sibling_release.ts`, [fx.a.root, aPlan, m.token, "--offer"], { cwd: fx.a.root });
    out = { exitCode: r.exitCode, output: `${r.stdout}${r.stderr}` };
  });
  return out;
}

/** The milestone's children as the tracker returns them, for `sibling_release.ts --children`. */
function childrenListing(ctx: Ctx, m: MilestoneRef): string {
  if (ctx.tracker === "jira") {
    const pages = ctx.jira.searchAll(`parent = ${m.key}`, ["summary", "issuetype", "labels", "description", "creator", "project"], 100);
    return ctx.file("children.json", pages.length === 1 ? pages[0] : pages);
  }
  const pages = ctx.linear.listAll({
    team: LINEAR_TEAM,
    project: LINEAR_PROJECT,
    fields: ["id", "title", "labels", "description", "createdBy", "projectMilestone", "project", "team"],
    limit: 250,
  });
  return ctx.file("children.json", pages.length === 1 ? pages[0] : pages);
}

/** S14: the zero-write join, the span, and A's release against B. */
async function zeroWriteJoin(ctx: Ctx): Promise<void> {
  const { a, b } = ctx.fx;
  const sA = ctx.session("a");
  const sB = ctx.session("b");
  const m = await ctx.mint(a, sA, "Epsilon Release");
  const aPlan = join(a.root, "specs", "plan", `${m.token}.md`);
  const tool = ctx.tracker === "jira" ? "createJiraIssue" : "save_issue";

  ctx.step("B's new plan names A's container with no milestone decision");
  const bPlan = writePlanFile(b.root, m);
  const receipts0 = receiptFiles(b.root, sB.id).length;
  const refused = await ctx.attach(b, sB, bPlan);
  ctx.check(refused.exitCode === 1, `the attach front door must refuse B's undecided plan naming ${m.key} (exit 1), got exit ${refused.exitCode}:\n${refused.stdout}${refused.stderr}`);
  ctx.eq(receiptFiles(b.root, sB.id).length, receipts0, "receipts written by the refused attach");
  const d0 = await ctx.decide(b.root, sB, "Span child work", m);
  ctx.eq(d0.decision.outcome, "create", "B's create decision for its FR");
  const writes0 = ctx.writes;
  const w0 = await ctx.write(b, sB, tool, d0.input!, { cwd: b.root });
  ctx.expectRefused(w0, "B's FR create with no attach target");
  ctx.eq(ctx.writes, writes0, "the double's write count after the refused create");

  ctx.step("after B's decided join by key the same plan resolves");
  const j = await ctx.resolveMilestone(b.root, sB, { joinKey: m.key }, { sibling: a.root });
  ctx.check(j.exitCode === 0 && j.fields.act === "join", `B's join by key refused (exit ${j.exitCode}): ${j.stderr}`);
  const ok = await ctx.attach(b, sB, bPlan);
  ctx.check(ok.exitCode === 0, `the attach front door must resolve B's plan after the decided join, got exit ${ok.exitCode}: ${ok.stderr}`);
  const d1 = await ctx.decide(b.root, sB, "Span child work", m);
  const w1 = await ctx.write(b, sB, tool, d1.input!, { cwd: b.root });
  ctx.expectPermitted(w1, "B's FR create under its join-decided attach target (the join path)");
  const bKey = ctx.createdKey(w1);

  ctx.step("the span declared through STE-610's writer");
  const decl = await ctx.door(`${ADAPTERS_SRC}/spans_repos.ts`, [aPlan, m.token, "--declare", b.root], { cwd: a.root });
  ctx.check(decl.exitCode === 0, `declaring the span refused (exit ${decl.exitCode}): ${decl.stderr}`);
  writeFrFile(b.root, bKey, m.token, "archived", bKey, ctx.tracker);
  commitAll(a.root, "declare span");
  commitAll(b.root, "join, declare span, B's FR archived");
  for (const [self, plan, sib] of [
    [a, aPlan, b],
    [b, bPlan, a],
  ] as const) {
    const r = await ctx.door(`${ADAPTERS_SRC}/spans_repos.ts`, [plan, m.token, self.root]);
    ctx.check(r.exitCode === 0, `resolving the span from ${self.name} failed: ${r.stderr}`);
    const lines = r.stdout.trim().split("\n");
    ctx.check(lines.some((l) => l.startsWith(`${self.tag} self `) && l.includes(`root=${self.root}`)), `from ${self.name}, ${self.tag} must resolve as self at ${self.root}:\n${r.stdout}`);
    ctx.check(lines.some((l) => l.startsWith(`${sib.tag} sibling `) && l.includes(`root=${sib.root}`)), `from ${self.name}, ${sib.tag} must resolve as the sibling at ${sib.root}:\n${r.stdout}`);
  }

  const release = () => ctx.door(`${ADAPTERS_SRC}/sibling_release.ts`, [a.root, aPlan, m.token, "--children", childrenListing(ctx, m)], { cwd: a.root });

  ctx.step("A's release with B's plan not naming A back");
  const declared = readFileSync(bPlan, "utf-8");
  writeFileSync(bPlan, declared.replace(/^spans_repos:\n(?:[ \t]+.*\n)+/m, ""));
  commitAll(b.root, "drop the back-reference");
  const oneSided = await release();
  ctx.check(oneSided.exitCode === 1 && /one-sided/.test(oneSided.stderr) && oneSided.stderr.includes(b.tag), `A's release must refuse with B one-sided (exit 1), got exit ${oneSided.exitCode}:\n${oneSided.stderr}`);
  writeFileSync(bPlan, declared);
  commitAll(b.root, "restore the back-reference");

  ctx.step("a child ticket carrying neither declared tag");
  const stray = ctx.seedTicket({ title: "Stray child", labels: [], container: m });
  const foreign = await release();
  ctx.check(foreign.exitCode === 1 && foreign.stderr.includes(stray), `A's release must refuse naming the untagged child ${stray} (exit 1), got exit ${foreign.exitCode}:\n${foreign.stderr}`);

  ctx.step("both fixed");
  if (ctx.tracker === "jira") ctx.jira.find(stray)!.labels = [a.tag];
  else ctx.linear.find(stray)!.labels = [a.tag];
  const pass = await release();
  ctx.check(pass.exitCode === 0, `A's release must pass once B names A back and every child carries a declared tag, got exit ${pass.exitCode}:\n${pass.stderr}`);
}

/** A plugin root holding only `.claude-plugin/plugin.json` (in the given state) beside links to `pluginRoot`'s code. */
function manifestRoot(ctx: Ctx, state: { version: string } | "absent" | "unreadable"): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "dpt-ste616-manifest-")));
  ctx.fx.track(dir);
  symlinkSync(join(ctx.pluginRoot, "templates"), join(dir, "templates"), "dir");
  symlinkSync(join(ctx.pluginRoot, "adapters"), join(dir, "adapters"), "dir");
  if (state === "absent") return dir;
  mkdirSync(join(dir, ".claude-plugin"), { recursive: true });
  if (state === "unreadable") {
    mkdirSync(join(dir, ".claude-plugin", "plugin.json")); // a directory: reading it fails
    return dir;
  }
  writeFileSync(join(dir, ".claude-plugin", "plugin.json"), `${JSON.stringify({ name: "dev-process-toolkit", version: state.version }, null, 2)}\n`);
  return dir;
}

function bump(v: string, dir: -1 | 1): string {
  const [maj, min, pat] = v.split(".").map(Number) as [number, number, number];
  if (dir === 1) return `${maj}.${min + 1}.0`;
  if (pat > 0) return `${maj}.${min}.${pat - 1}`;
  return `${maj}.${min - 1}.0`;
}

/** The M_947c79 reader front door's JSON line for `root`. */
async function readBinding(ctx: Ctx, root: string): Promise<Record<string, any>> {
  const r = await ctx.door(`${ADAPTERS_SRC}/workspace_binding.ts`, [root]);
  ctx.check(r.exitCode === 0, `the reader front door failed on ${root} (exit ${r.exitCode}): ${r.stderr}`);
  return JSON.parse(r.stdout.split("\n")[0]!);
}

/** S6: the version floor, from a hook whose plugin copy is below, at and above the target's floor. */
async function versionFloor(ctx: Ctx): Promise<void> {
  const { b } = ctx.fx;
  const floor = String((await readBinding(ctx, b.root)).minDptVersion);
  ctx.check(/^\d+\.\d+\.\d+$/.test(floor), `B's declared floor should be strict X.Y.Z, got ${floor}`);
  const s = ctx.session("b");
  const plan = join(b.root, "specs", "plan", `${b.milestone.token}.md`);
  const a0 = await ctx.attach(b, s, plan);
  ctx.check(a0.exitCode === 0, `attach failed: ${a0.stderr}`);
  const tool = ctx.tracker === "jira" ? "createJiraIssue" : "save_issue";
  let n = 0;
  const attempt = async (hookRoot: string | undefined) => {
    n += 1;
    const { input } = await ctx.decide(b.root, s, `Floor probe ${n}`, b.milestone);
    return ctx.write(b, s, tool, input!, { cwd: b.root, pluginRootForHook: hookRoot });
  };
  const cases: Array<[string, ReturnType<typeof manifestRoot>, "refuse" | "permit", RegExp | undefined]> = [
    [`running ${bump(floor, -1)} below the floor ${floor}`, manifestRoot(ctx, { version: bump(floor, -1) }), "refuse", /below its min_dpt_version/],
    [`running ${floor} at the floor`, manifestRoot(ctx, { version: floor }), "permit", undefined],
    [`running ${bump(floor, 1)} above the floor`, manifestRoot(ctx, { version: bump(floor, 1) }), "permit", undefined],
    ["the hook's own plugin.json absent", manifestRoot(ctx, "absent"), "refuse", /version cannot be read/],
    ["the hook's own plugin.json unreadable", manifestRoot(ctx, "unreadable"), "refuse", /version cannot be read/],
    ["the hook's own plugin.json carrying a non-semver version", manifestRoot(ctx, { version: floor.split(".").slice(0, 2).join(".") }), "refuse", /version cannot be read/],
  ];
  for (const [label, root, want, needle] of cases) {
    ctx.step(label);
    const writes0 = ctx.writes;
    const w = await attempt(root);
    if (want === "refuse") {
      ctx.expectRefused(w, label, needle);
      ctx.eq(ctx.writes, writes0, `${label}: the double's write count`);
    } else ctx.expectPermitted(w, label);
  }

  ctx.step("a target whose min_dpt_version is malformed");
  const md = join(b.root, "CLAUDE.md");
  const original = readFileSync(md, "utf-8");
  const { input } = await ctx.decide(b.root, s, "Floor probe malformed", b.milestone);
  writeFileSync(md, original.replace(/^min_dpt_version: .*$/m, `min_dpt_version: ${floor.split(".").slice(0, 2).join(".")}`));
  try {
    const w = await ctx.write(b, s, tool, input!, { cwd: b.root });
    ctx.expectRefused(w, "a target carrying a non-strict min_dpt_version", /cannot be read/);
  } finally {
    writeFileSync(md, original);
  }
  const twin = await attempt(undefined);
  ctx.expectPermitted(twin, "permit twin: the same target with its well-formed floor");
}

/** Copy a receipt file into another session directory and return the copy's path. */
function copyReceipt(src: string, root: string, sessionId: string): string {
  const dir = receiptsDirOf(root, sessionId);
  mkdirSync(dir, { recursive: true });
  const dst = join(dir, `copied-${basename(src)}`);
  copyFileSync(src, dst);
  return dst;
}

function announcementOf(stdout: string): string {
  const line = stdout.split("\n").find((l) => l.startsWith("dpt-receipt: "));
  if (!line) throw new ScenarioFailure(`the front door announced no receipt:\n${stdout}`);
  return line.slice("dpt-receipt: ".length).trim().split(/\s+/)[0]!;
}

/** S7: receipt integrity — every broken receipt refuses, its one-variable twin permits. */
async function receiptIntegrity(ctx: Ctx): Promise<void> {
  const { a, b } = ctx.fx;
  const s = ctx.session("b");
  const other = ctx.session("b-other");
  const tool = ctx.tracker === "jira" ? "createJiraIssue" : "save_issue";
  const plan = join(b.root, "specs", "plan", `${b.milestone.token}.md`);
  const at = await ctx.attach(b, s, plan);
  ctx.check(at.exitCode === 0, `attach failed: ${at.stderr}`);
  const flags = ctx.containerFlags(b.milestone);

  // The reason each refusal must name (AC-STE-616.9), spelled as the hook
  // prints it (templates/hooks/_lib/hooks/pre-tracker-write-gate.ts,
  // gateCreate / unreadableInputsNote). Each case that is graded on the
  // no-receipt reason runs in a FRESH attached session, so no unrelated
  // receipt of an earlier step can stand in as the reason.
  const NO_RECEIPT = "no create receipt announced by create_idempotency_probe.ts decide in this session authorises it.";
  const noReceiptOnly = new RegExp(`in ${b.root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}: ${NO_RECEIPT.replace(/[.]/g, "\\.")}$`, "m");
  const fresh = async (label: string): Promise<Session> => {
    const x = ctx.session(label);
    const att = await ctx.attach(b, x, plan);
    ctx.check(att.exitCode === 0, `attach in the ${label} session failed: ${att.stderr}`);
    return x;
  };

  ctx.step("no receipt");
  const bare =
    ctx.tracker === "jira"
      ? ctx.createInput({ project: JIRA_PROJECT, summary: "No receipt work", labels: [b.tag], parent: b.milestone.key })
      : ctx.createInput({ team: LINEAR_TEAM, project: LINEAR_PROJECT, title: "No receipt work", labels: [b.tag], milestone: b.milestone.key });
  const writes0 = ctx.writes;
  ctx.expectRefused(await ctx.write(b, s, tool, bare, { cwd: b.root }), "a create with no receipt", noReceiptOnly);
  ctx.eq(ctx.writes, writes0, "no receipt: the double's write count");
  const twin = await ctx.createFr(b, s, "Receipt twin work");
  ctx.expectPermitted(twin.w, "permit twin: the same create with its own receipt");

  const pageFor = async (title: string) => {
    const tf = ctx.file("title.txt", `${title}\n`);
    const empty = ctx.tracker === "jira" ? { issues: [], isLast: true } : { issues: [], pageInfo: { hasNextPage: false, endCursor: null } };
    return { tf, page: ctx.file("empty-page.json", empty) };
  };
  const decideAs = async (title: string, sessionId: string) => {
    const { tf, page } = await pageFor(title);
    const args = ["decide", b.root, page, "--title-file", tf, ...flags, "--attempt", "fast"];
    const r = await ctx.door(`${ADAPTERS_SRC}/create_idempotency_probe.ts`, args, { sessionId });
    ctx.check(r.exitCode === 0, `decide as ${sessionId} failed: ${r.stderr}`);
    const decision = JSON.parse(r.stdout.split("\n")[0]!);
    return { r, args, decision, input: ctx.createInput(decision.createPayload) };
  };
  const announce = (in_: Session, args: string[], decisionLine: string, path: string) => {
    in_.bash(
      `bun run "\${CLAUDE_PLUGIN_ROOT}/${ADAPTERS_SRC}/create_idempotency_probe.ts" ${args.map(quoteArg).join(" ")}`,
      `${decisionLine}\ndpt-receipt: ${path} sha256:${sha256(readFileSync(path))}`,
    );
  };

  ctx.step("another session's receipt, in its own directory");
  {
    const s2 = await fresh("b-other-dir");
    const d = await decideAs("Other session work", other.id);
    announce(s2, d.args, d.r.stdout.split("\n")[0]!, announcementOf(d.r.stdout));
    ctx.expectRefused(await ctx.write(b, s2, tool, d.input, { cwd: b.root }), "a create whose receipt another session wrote", noReceiptOnly);
    const own = await decideAs("Other session twin", s2.id);
    announce(s2, own.args, own.r.stdout.split("\n")[0]!, announcementOf(own.r.stdout));
    ctx.expectPermitted(await ctx.write(b, s2, tool, own.input, { cwd: b.root }), "permit twin: the same shape with this session's own receipt in its own directory");
  }
  ctx.step("another session's receipt, copied into this session's directory");
  {
    const s3 = await fresh("b-copied");
    const d = await decideAs("Copied receipt work", other.id);
    const copy = copyReceipt(announcementOf(d.r.stdout), b.root, s3.id);
    announce(s3, d.args, d.r.stdout.split("\n")[0]!, copy);
    ctx.expectRefused(await ctx.write(b, s3, tool, d.input, { cwd: b.root }), "a create whose receipt JSON names another session", noReceiptOnly);
    const own = await decideAs("Copied receipt twin", s3.id);
    announce(s3, own.args, own.r.stdout.split("\n")[0]!, announcementOf(own.r.stdout));
    ctx.expectPermitted(await ctx.write(b, s3, tool, own.input, { cwd: b.root }), "permit twin: the same shape with this session's own receipt");
  }

  ctx.step("a malformed receipt, and its twin: the same receipt well-formed");
  {
    const s4 = await fresh("b-malformed");
    const d = await decideAs("Malformed receipt work", s4.id);
    const path = announcementOf(d.r.stdout);
    const good = readFileSync(path);
    writeFileSync(path, "{ not json\n");
    announce(s4, d.args, d.r.stdout.split("\n")[0]!, path);
    ctx.expectRefused(
      await ctx.write(b, s4, tool, d.input, { cwd: b.root }),
      "a create announced with a malformed receipt",
      /in this session authorises it\. 1 announced receipt file\(s\) failed to parse and were ignored\.$/m,
    );
    writeFileSync(path, good);
    announce(s4, d.args, d.r.stdout.split("\n")[0]!, path);
    ctx.expectPermitted(await ctx.write(b, s4, tool, d.input, { cwd: b.root }), "permit twin: the same receipt, well-formed");
  }

  ctx.step("an unreadable receipt directory");
  {
    const d = await decideAs("Unreadable dir work", s.id);
    announce(s, d.args, d.r.stdout.split("\n")[0]!, announcementOf(d.r.stdout));
    const dir = receiptsDirOf(b.root, s.id);
    chmodSync(dir, 0o000);
    let w: WriteOutcome;
    try {
      w = await ctx.write(b, s, tool, d.input, { cwd: b.root });
    } finally {
      chmodSync(dir, 0o755);
    }
    // No reason needle: the hook names an unreadable receipt as one that
    // "failed to parse" — the malformed-receipt wording — so no substring of
    // its refusal tells this case from the malformed one (reported, STE-616
    // hardening pass).
    ctx.expectRefused(w, "a create whose receipt directory cannot be read");
    const again = await decideAs("Readable dir twin", s.id);
    announce(s, again.args, again.r.stdout.split("\n")[0]!, announcementOf(again.r.stdout));
    ctx.expectPermitted(await ctx.write(b, s, tool, again.input, { cwd: b.root }), "permit twin: the receipt directory readable");
  }

  ctx.step("a tool input that differs from what the receipt decided");
  {
    const d = await ctx.decide(b.root, s, "Decided title work", b.milestone);
    const edited = { ...d.input! };
    if (ctx.tracker === "jira") edited.summary = "Decided title work, edited after the decision";
    else edited.title = "Decided title work, edited after the decision";
    ctx.expectRefused(
      await ctx.write(b, s, tool, edited, { cwd: b.root }),
      "a create whose title differs from its receipt",
      /does not match its create receipt \([^)]*\): title "Decided title work, edited after the decision" differs from the receipt's "Decided title work"/,
    );
  }

  ctx.step("a create whose container differs from the key a join receipt recorded");
  {
    const j = await ctx.resolveMilestone(b.root, s, { joinKey: a.milestone.key }, { sibling: a.root });
    ctx.check(j.exitCode === 0 && j.fields.act === "join", `B's join of A's milestone refused: ${j.stderr}`);
    const joinedPlan = writePlanFile(b.root, a.milestone);
    const att = await ctx.attach(b, s, joinedPlan);
    ctx.check(att.exitCode === 0, `attach after the join failed: ${att.stderr}`);
    const d = await ctx.decide(b.root, s, "Joined container work", a.milestone);
    const moved = { ...d.input! };
    if (ctx.tracker === "jira") moved.parent = b.milestone.key;
    else moved.milestone = b.milestone.key;
    const field = ctx.tracker === "jira" ? "parent" : "milestone";
    ctx.expectRefused(
      await ctx.write(b, s, tool, moved, { cwd: b.root }),
      "a create whose container differs from the joined milestone",
      `: ${field} "${b.milestone.key}" differs from the receipt's "${a.milestone.key}"`,
    );
    const d2 = await ctx.decide(b.root, s, "Joined container twin", a.milestone);
    ctx.expectPermitted(await ctx.write(b, s, tool, d2.input!, { cwd: b.root }), "permit twin: the create under B's join receipt for A's milestone (the join path)");
  }
}

/** A hook run with no write applied — for the undeclared-root sweep of every tracker-write tool. */
async function hookOnly(ctx: Ctx, server: string, session: Session, tool: string, input: Record<string, unknown>, cwd: string): Promise<ProcRun> {
  const toolName = `mcp__${server}__${tool}`;
  const payload = JSON.stringify({
    session_id: session.id,
    transcript_path: session.file,
    cwd,
    permission_mode: "default",
    hook_event_name: "PreToolUse",
    tool_name: toolName,
    tool_input: input,
    tool_use_id: session.nextId(),
  });
  const r = await ctx.spawn(
    ["bash", join(ctx.pluginRoot, "templates", "hooks", "process", "pre-tracker-write-gate.sh")],
    { cwd: ctx.fx.scratch, env: doorEnv(ctx.pluginRoot, session.id), stdin: payload },
    "pre-tracker-write-gate.sh",
  );
  ctx.counts["tracker-write-hook"] += 1;
  return r;
}

/** A plausible input for any gated write tool, in the fixture's container. */
export function genericWriteInput(tracker: Tracker, tool: string, key: string): Record<string, unknown> {
  if (tracker === "jira") {
    if (tool === "createJiraIssue") return { cloudId: "fixture-cloud", projectKey: JIRA_PROJECT, issueTypeName: "Task", summary: "Sweep work" };
    if (tool === "createIssueLink") return { cloudId: "fixture-cloud", inwardIssue: key, outwardIssue: key, type: "Relates" };
    return { cloudId: "fixture-cloud", issueIdOrKey: key, fields: { summary: "x" }, transition: { id: "21" }, commentBody: "x", timeSpent: "1h" };
  }
  if (tool === "save_issue") return { team: LINEAR_TEAM, project: LINEAR_PROJECT, title: "Sweep work" };
  if (tool === "save_milestone" || tool === "save_status_update" || tool === "save_document") return { project: LINEAR_PROJECT, name: "Sweep", body: "x", title: "x" };
  if (tool === "save_project") return { name: LINEAR_PROJECT, team: LINEAR_TEAM };
  if (/label/.test(tool)) return { name: "sweep-label", id: "sweep-label" };
  return { id: key, issueId: key, issue: key, body: "x" };
}

/** Gated-write tool names of one server, from the inventory fixture's recorded classification. */
export function gatedWriteTools(tracker: Tracker): string[] {
  const server = readInventory().servers[tracker === "jira" ? "atlassian" : "linear"]!;
  return Object.entries(server.classification ?? {}).filter(([, c]) => c.class === "gated-write").map(([t]) => t);
}

/** S9: a session rooted in A writes for B; and writes whose target the hook cannot resolve. */
async function crossRepository(ctx: Ctx): Promise<void> {
  const { a, b } = ctx.fx;
  const m = b.milestone; // span: one container both carry
  const s = ctx.session("rooted-in-a");
  const tool = ctx.tracker === "jira" ? "createJiraIssue" : "save_issue";
  const bPlan = join(b.root, "specs", "plan", `${m.token}.md`);
  const at = await ctx.attach(b, s, bPlan);
  ctx.check(at.exitCode === 0, `B's attach failed: ${at.stderr}`);

  ctx.step("the receipt sits only in the session's cwd repository, the write is decided for B");
  const inA = await ctx.decide(a.root, s, "Cross repository work", m);
  const forB = { ...inA.input! };
  if (ctx.tracker === "jira") (forB.additional_fields as Record<string, unknown>) = { labels: [b.tag] };
  else forB.labels = [b.tag];
  const writes0 = ctx.writes;
  ctx.expectRefused(
    await ctx.write(b, s, tool, forB, { cwd: a.root }),
    "a write for B whose receipt sits only in A (the session's cwd repository)",
    `${tool} in ${b.root}: no create receipt announced by create_idempotency_probe.ts decide in this session authorises it.`,
  );
  ctx.eq(ctx.writes, writes0, "the double's write count after the cross-repository refusal");

  ctx.step("permit twin: the same write decided in B, from a session rooted in A");
  const inB = await ctx.decide(b.root, s, "Cross repository twin", m);
  const ok = await ctx.write(b, s, tool, inB.input!, { cwd: a.root });
  ctx.expectPermitted(ok, "a write decided in B from a session rooted in A");
  const bKey = ctx.createdKey(ok);

  ctx.step("targets the hook cannot resolve among the declared repositories");
  const base = (await ctx.decide(b.root, s, "Unresolvable target work", m)).input!;
  const noProject = { ...base };
  delete noProject.projectKey;
  delete noProject.project;
  delete noProject.team;
  const opaque = ctx.tracker === "jira" ? { ...base, projectKey: "10042" } : { ...base, team: "3f2b8c1e-0000-4000-8000-00000000abcd", project: "dptshared-0123456789ab" };
  const twoTags = ctx.tracker === "jira" ? { ...base, additional_fields: { labels: [a.tag, b.tag] } } : { ...base, labels: [a.tag, b.tag] };
  const noTags = ctx.tracker === "jira" ? { ...base, additional_fields: { labels: [] } } : { ...base, labels: [] };
  const cases: Array<[string, string, Record<string, unknown>, RegExp]> = [
    ["a create naming no project", tool, noProject, /names no project, so its target among .* cannot be resolved/],
    ["a container named by an opaque id", tool, opaque, /names its container by the id "[^"]+", which cannot be resolved/],
    ["a shared-container create whose labels carry two declared tags", tool, twoTags, /carry more than one repo tag of the declared targets .*so the target cannot be resolved/],
    ["a shared-container create whose labels carry no declared tag", tool, noTags, /labels \[\] carry no repo tag of the declared targets .*so the target cannot be resolved/],
    [
      "a ticket call with no parsable key",
      ctx.tracker === "jira" ? "transitionJiraIssue" : "save_issue",
      ctx.tracker === "jira" ? { cloudId: "fixture-cloud", issueIdOrKey: "10001", transition: { id: "21" } } : { id: "10001", state: "Done" },
      /names no resolvable ticket key \(got "10001"\), so its subject among the declared targets .* cannot be resolved/,
    ],
  ];
  for (const [label, t, input, needle] of cases) {
    const w0 = ctx.writes;
    ctx.expectRefused(await ctx.write(b, s, t, input, { cwd: a.root }), label, needle);
    ctx.eq(ctx.writes, w0, `${label}: the double's write count`);
  }
  ctx.step("permit twin: a ticket call naming B's own ticket by its key");
  const claim =
    ctx.tracker === "jira"
      ? { tool: "transitionJiraIssue", input: { cloudId: "fixture-cloud", issueIdOrKey: bKey, transition: { id: "21" } } }
      : { tool: "save_issue", input: { id: bKey, state: "In Progress" } };
  ctx.expectPermitted(await ctx.write(b, s, claim.tool, claim.input, { cwd: a.root }), "a ticket call on B's own created ticket");
}

/** S11: the decided-for repository is a worktree of B; a worktree predating the declaration; an unreadable declaration. */
async function relocatedCheckout(ctx: Ctx): Promise<void> {
  const { a, b } = ctx.fx;
  const tool = ctx.tracker === "jira" ? "createJiraIssue" : "save_issue";
  const wt = ctx.fx.addWorktree("b");
  const wtRepo: FixtureRepo = { ...b, root: wt };
  const plan = (root: string) => join(root, "specs", "plan", `${b.milestone.token}.md`);

  ctx.step("receipts in B's main checkout, the write decided in B's worktree");
  {
    const s = ctx.session("in-wt");
    const at = await ctx.attach(b, s, plan(b.root));
    ctx.check(at.exitCode === 0, `attach in B failed: ${at.stderr}`);
    const d = await ctx.decide(b.root, s, "Relocated work", b.milestone);
    ctx.expectRefused(await ctx.write(b, s, tool, d.input!, { cwd: wt }), "a write in B's worktree whose receipts sit in B's main checkout");
  }
  ctx.step("the reverse: receipts in the worktree, the write decided in the main checkout");
  {
    const s = ctx.session("in-main");
    const at = await ctx.attach(wtRepo, s, plan(wt));
    ctx.check(at.exitCode === 0, `attach in the worktree failed: ${at.stderr}`);
    const d = await ctx.decide(wt, s, "Relocated reverse work", b.milestone);
    ctx.expectRefused(await ctx.write(b, s, tool, d.input!, { cwd: b.root }), "a write in B's main checkout whose receipts sit in its worktree");
  }
  ctx.step("permit twin: receipts and write both in the worktree");
  {
    const s = ctx.session("wt-own");
    const r = await ctx.createFr(wtRepo, s, "Relocated own work", { cwd: wt });
    ctx.expectPermitted(r.w, "a write in B's worktree decided in that worktree");
  }

  ctx.step("a worktree of B on a branch whose CLAUDE.md predates the declaration");
  const old = ctx.fx.addWorktree("b", { at: "pre-declaration" });
  const s0 = ctx.session("undeclared");
  for (const t of gatedWriteTools(ctx.tracker)) {
    const r = await hookOnly(ctx, b.server, s0, t, genericWriteInput(ctx.tracker, t, ctx.tracker === "jira" ? `${JIRA_PROJECT}-1` : `${LINEAR_TEAM}-1`), old);
    ctx.check(r.exitCode === 0 && r.stdout === "" && r.stderr === "", `an undeclared root: ${t} must exit 0 with empty stdout and stderr, got exit ${r.exitCode}\n${r.stdout}${r.stderr}`);
  }
  const untaggedInput =
    ctx.tracker === "jira"
      ? { cloudId: "fixture-cloud", projectKey: JIRA_PROJECT, issueTypeName: "Task", summary: "Written from a pre-declaration branch", parent: b.milestone.key }
      : { team: LINEAR_TEAM, project: LINEAR_PROJECT, title: "Written from a pre-declaration branch", milestone: b.milestone.key };
  const w = await ctx.write(b, s0, tool, untaggedInput, { cwd: old });
  ctx.expectSilent(w, "the create from the undeclared worktree");
  ctx.check(!w.blocked && w.result !== null, "the undeclared worktree's create must reach the double");
  const stray = ctx.createdKey(w);
  const pages = ctx.containerPages();
  await detectorFlagsOnly(ctx, a.root, pages, [stray], [], "a");
  await detectorFlagsOnly(ctx, b.root, pages, [stray], [], "b");

  ctx.step("a worktree of B whose CLAUDE.md exists but cannot be read");
  const broken = ctx.fx.addWorktree("b");
  rmSync(join(broken, "CLAUDE.md"));
  mkdirSync(join(broken, "CLAUDE.md"));
  const s1 = ctx.session("unreadable-declaration");
  const w1 = await ctx.write(b, s1, tool, untaggedInput, { cwd: broken });
  ctx.expectRefused(w1, "a write in a root whose CLAUDE.md cannot be read", join(broken, "CLAUDE.md"));
}

// ---------------------------------------------------------------- S8 repoint

const OLD_JIRA_PROJECT = "OLDB";
const OLD_LINEAR_PROJECT = "OldB";
const MCP_URL: Record<Tracker, string> = { jira: "https://mcp.atlassian.com/v1/sse", linear: "https://mcp.linear.app/sse" };
const STATUSES = ["To Do", "In Progress", "Done"];

async function writerDoor(ctx: Ctx, root: string, project: string, shared: string | "unshare"): Promise<ProcRun> {
  const args = [root, ctx.tracker, "--project", project];
  if (ctx.tracker === "linear") args.push("--team", LINEAR_TEAM);
  if (shared === "unshare") args.push("--unshare");
  else args.push("--shared", shared);
  return ctx.door(`${ADAPTERS_SRC}/setup/tracker_binding_write.ts`, args);
}

function insertAfterProject(root: string, line: string): void {
  const p = join(root, "CLAUDE.md");
  const body = readFileSync(p, "utf-8");
  if (body.includes(line)) return;
  writeFileSync(p, body.replace(/^(project: .*)$/m, `$1\n${line}`));
}

function repointSetup(ctx: Ctx, root: string): void {
  const server = ctx.tracker === "jira" ? "atlassian" : "linear";
  writeFileSync(join(root, ".mcp.json"), `${JSON.stringify({ mcpServers: { [server]: { type: "http", url: MCP_URL[ctx.tracker] } } }, null, 2)}\n`);
  if (ctx.tracker === "jira") insertAfterProject(root, "jira_issue_type: Task");
}

/** S8: B, bound to its own container with one legacy ticket, moves into the shared container. */
async function repoint(ctx: Ctx): Promise<void> {
  const { a, b } = ctx.fx;
  const oldProject = ctx.tracker === "jira" ? OLD_JIRA_PROJECT : OLD_LINEAR_PROJECT;
  const newProject = ctx.tracker === "jira" ? JIRA_PROJECT : LINEAR_PROJECT;

  ctx.step("B first bound to its own container");
  rmSync(join(b.root, "specs", "plan", `${b.milestone.token}.md`)); // B holds no plan in the shared container yet
  const w0 = await writerDoor(ctx, b.root, oldProject, b.tag);
  ctx.check(w0.exitCode === 0, `re-binding B to its own container failed: ${w0.stderr}`);
  repointSetup(ctx, a.root);
  repointSetup(ctx, b.root);
  mkdirSync(join(b.root, "specs"), { recursive: true });
  writeFileSync(
    join(b.root, "specs", "tracker-config.yaml"),
    [`tracker_key: ${ctx.tracker}`, "statuses:", ...STATUSES.map((s) => `  - ${s}`), "roles:", "  initial: To Do", "  in_progress: In Progress", "  in_review: In Progress", "  done: Done", ""].join("\n"),
  );
  const legacyTitle = "Legacy B work";
  const legacy =
    ctx.tracker === "jira"
      ? ctx.jira.seed({ project: OLD_JIRA_PROJECT, summary: legacyTitle, labels: [b.tag] }).key
      : ctx.linear.seed({ project: OLD_LINEAR_PROJECT, team: LINEAR_TEAM, title: legacyTitle, labels: [b.tag] }).identifier;
  writeFrFile(b.root, legacy, "M1", "archived", legacy, ctx.tracker);
  commitAll(a.root, "repoint fixture: .mcp.json");
  commitAll(b.root, "repoint fixture: B bound to its own container");

  const projectsListing =
    ctx.tracker === "jira"
      ? ctx.file("projects.json", { values: [newProject, oldProject].map((key, i) => ({ id: String(10001 + i), key, name: `Project ${key}` })), isLast: true })
      : ctx.file("projects.json", { projects: [newProject, oldProject].map((name, i) => ({ id: `p-${i}`, name })) });
  const containers = ctx.containerListing();
  const flags = (o: { projects?: string | null; containers?: string | null } = {}): string[] => {
    const out = [b.root, ctx.tracker, newProject];
    const proj = o.projects === undefined ? projectsListing : o.projects;
    const cont = o.containers === undefined ? containers : o.containers;
    if (proj !== null) out.push("--projects", proj);
    if (cont !== null) out.push("--containers", cont);
    out.push("--statuses", ctx.file("statuses.json", { statuses: STATUSES.map((name, i) => ({ id: String(i + 1), name })) }));
    if (ctx.tracker === "jira") {
      out.push("--issue-types", ctx.file("issue-types.json", { issueTypes: ["Epic", "Task", "Bug"].map((name, i) => ({ id: String(11100 + i), name })) }));
      const labels = [...new Set(ctx.jira.issues.filter((i) => i.project === JIRA_PROJECT).flatMap((i) => i.labels))];
      out.push("--labels", ctx.file("labels.json", { values: labels, isLast: true }));
    } else out.push("--team", LINEAR_TEAM);
    out.push("--peer", a.root);
    return out;
  };
  const aListing = async () => (await ctx.door(`${ADAPTERS_SRC}/container_ownership.ts`, ["list", a.root, ...ctx.containerPages()])).stdout;
  const aBefore = await aListing();
  const md = join(b.root, "CLAUDE.md");
  const refuses = async (label: string, args: string[]) => {
    const before = readFileSync(md, "utf-8");
    const w = ctx.writes;
    const r = await ctx.door(`${ADAPTERS_SRC}/repoint_tracker_binding.ts`, args, { sessionId: "s616-repoint" });
    ctx.check(r.exitCode === 1, `${label}: the repoint must refuse (exit 1), got exit ${r.exitCode}:\n${r.stdout}${r.stderr}`);
    ctx.eq(readFileSync(md, "utf-8") === before, true, `${label}: B's CLAUDE.md is unchanged by the refused repoint`);
    ctx.eq(ctx.writes, w, `${label}: the double's write count`);
  };

  ctx.step("B's declaration carries no repo_tag");
  const un = await writerDoor(ctx, b.root, oldProject, "unshare");
  ctx.check(un.exitCode === 0, `unsharing B failed: ${un.stderr}`);
  await refuses("B declares no repo_tag", flags());
  const re = await writerDoor(ctx, b.root, oldProject, b.tag);
  ctx.check(re.exitCode === 0, `re-declaring B failed: ${re.stderr}`);

  ctx.step("B's declaration carries a malformed repo_tag");
  const good = readFileSync(md, "utf-8");
  writeFileSync(md, good.replace(/^repo_tag: .*$/m, "repo_tag: Not_A_Kebab_Tag"));
  await refuses("B declares a malformed repo_tag", flags());
  writeFileSync(md, good);

  ctx.step("B still holds an active plan in its old container");
  const oldPlan =
    ctx.tracker === "jira"
      ? writePlanFile(b.root, { token: tokenOfEpic(`${OLD_JIRA_PROJECT}-7`), key: `${OLD_JIRA_PROJECT}-7`, title: "Old B Milestone" })
      : writePlanFile(b.root, { token: "M_cccccc", key: "cccccc00-0000-4000-8000-000000000007", title: "Old B Milestone" });
  commitAll(b.root, "an active plan in the old container");
  await refuses("B holds an active plan in its old container", flags());
  const archived = join(b.root, "specs", "plan", "archive", basename(oldPlan));
  mkdirSync(dirname(archived), { recursive: true });
  git(b.root, "mv", oldPlan, archived);
  writeFileSync(archived, readFileSync(archived, "utf-8").replace("status: active", "status: archived"));
  commitAll(b.root, "archive the old plan");

  ctx.step("a listing the repoint reads is absent or malformed");
  const bad = ctx.file("malformed.json", "{ not json");
  await refuses("--projects absent", flags({ projects: null }));
  await refuses("--projects malformed", flags({ projects: bad }));
  await refuses("--containers absent", flags({ containers: null }));
  await refuses("--containers malformed", flags({ containers: bad }));

  ctx.step("all resolved: the repoint proceeds");
  const ok = await ctx.door(`${ADAPTERS_SRC}/repoint_tracker_binding.ts`, flags(), { sessionId: "s616-repoint" });
  ctx.check(ok.exitCode === 0, `the repoint must proceed once every check is resolved, got exit ${ok.exitCode}:\n${ok.stdout}${ok.stderr}`);
  ctx.check(new RegExp(`^project: ${newProject}$`, "m").test(readFileSync(md, "utf-8")), `B's CLAUDE.md must now bind ${newProject}`);
  // "Still resolves by key", through B's own ownership decision on the
  // ticket fetched by key — not by reading the double.
  const own = await ctx.door(`${ADAPTERS_SRC}/ticket_ownership.ts`, ["decide", b.root, ctx.ticketFile(legacy)]);
  ctx.check(own.exitCode === 0, `B's ownership decision on its legacy ticket ${legacy} failed after the repoint (exit ${own.exitCode}): ${own.stderr}`);
  const verdict = (JSON.parse(own.stdout.trim().split("\n")[0]!) as { verdict: string }).verdict;
  ctx.eq(verdict, "owned", `B's ownership decision on its legacy ticket ${legacy} after the repoint (never foreign-project)`);
  const dup = ctx.tickets().filter((x) => x.key !== legacy && x.title === legacyTitle);
  ctx.eq(dup.length, 0, "tickets duplicating B's legacy ticket in the shared container");
  ctx.eq((await aListing()) === aBefore, true, "A's listing output is byte-identical before and after the repoint");
}

/**
 * D-3, measured (never skipped): B's CLAUDE.md with its `project:` line
 * removed routes to `resume`, which rewrites the binding and exits 0 with none
 * of the seven checks run (`repoint_tracker_binding.ts:343`, `:875-880`).
 */
export async function measureKnownDefectD3(tracker: Tracker, pluginRoot: string): Promise<{ exitCode: number; stdout: string; rowLines: number; claudeMdChanged: boolean }> {
  let out = { exitCode: -1, stdout: "", rowLines: -1, claudeMdChanged: false };
  await withSharedTrackerFixture({ tracker, shape: "coexist", pluginRoot }, async (fx) => {
    const ctx = new Ctx(fx, pluginRoot, harnessBlocks);
    const md = join(fx.b.root, "CLAUDE.md");
    writeFileSync(md, readFileSync(md, "utf-8").replace(/^project: .*\n/m, ""));
    const before = readFileSync(md, "utf-8");
    const newProject = tracker === "jira" ? JIRA_PROJECT : LINEAR_PROJECT;
    const r = await ctx.door(`${ADAPTERS_SRC}/repoint_tracker_binding.ts`, [fx.b.root, tracker, newProject, "--peer", fx.a.root], { sessionId: "s616-d3" });
    out = {
      exitCode: r.exitCode,
      stdout: r.stdout,
      rowLines: r.stdout.split("\n").filter((l) => /^\d+ (PASS|REFUSE|NOT-APPLICABLE)/.test(l)).length,
      claudeMdChanged: readFileSync(md, "utf-8") !== before,
    };
  });
  return out;
}

/**
 * D-4, measured (never skipped): B's milestone create decided `act=create`
 * from a container listing captured BEFORE A minted the same title, in a
 * session with no join decision, is permitted by the hook — the hook cannot
 * see the container A created (`pre-tracker-write-gate.ts:1592`,
 * `if (matching.some((d) => !d.spent)) return 0;`). AC-STE-616.6 requires a
 * refusal (exit 2, write count unchanged).
 */
export async function measureKnownDefectD4(
  tracker: Tracker,
  pluginRoot: string,
): Promise<{ decisionAct: string | undefined; exitCode: number | undefined; blocked: boolean; containersWithTitle: number; writesAdded: number }> {
  let out = { decisionAct: undefined as string | undefined, exitCode: undefined as number | undefined, blocked: false, containersWithTitle: -1, writesAdded: -1 };
  await withSharedTrackerFixture({ tracker, shape: "coexist", pluginRoot }, async (fx) => {
    const ctx = new Ctx(fx, pluginRoot, harnessBlocks);
    const title = "Gamma Release";
    const stale = ctx.containerListing(); // B's listing, captured before A mints
    await ctx.mint(fx.a, ctx.session("a"), title);
    const sB = ctx.session("b-stale-only"); // fresh: no join decision in it
    const d = await ctx.resolveMilestone(fx.b.root, sB, { title }, { listing: stale });
    const w0 = ctx.writes;
    const c = ctx.milestoneCreateInput(title);
    const w = await ctx.write(fx.b, sB, c.tool, c.input, { cwd: fx.b.root });
    const containers = tracker === "jira" ? fx.jira!.issues.filter((i) => i.issuetype === "Epic" && i.summary === title).length : fx.linear!.milestones.filter((m) => m.name === title).length;
    out = { decisionAct: d.fields.act, exitCode: w.run?.exitCode, blocked: w.blocked, containersWithTitle: containers, writesAdded: ctx.writes - w0 };
  });
  return out;
}

/**
 * D-5, measured: a write whose receipts sit in B's main checkout while the
 * write is decided in B's worktree (and the reverse) is refused, but worded as
 * a label set carrying more than one repo tag — the labels carry one; two
 * declared roots share it. The receipt location is never named.
 */
export async function measureKnownDefectD5(
  tracker: Tracker,
  pluginRoot: string,
): Promise<{ mainReceiptWorktreeWrite: ProcRun | null; worktreeReceiptMainWrite: ProcRun | null; roots: { main: string; worktree: string } }> {
  let out: { mainReceiptWorktreeWrite: ProcRun | null; worktreeReceiptMainWrite: ProcRun | null; roots: { main: string; worktree: string } } = {
    mainReceiptWorktreeWrite: null,
    worktreeReceiptMainWrite: null,
    roots: { main: "", worktree: "" },
  };
  await withSharedTrackerFixture({ tracker, shape: "coexist", pluginRoot }, async (fx) => {
    const ctx = new Ctx(fx, pluginRoot, harnessBlocks);
    const b = fx.b;
    const tool = tracker === "jira" ? "createJiraIssue" : "save_issue";
    const wt = fx.addWorktree("b");
    const wtRepo: FixtureRepo = { ...b, root: wt };
    const plan = (root: string) => join(root, "specs", "plan", `${b.milestone.token}.md`);
    const s1 = ctx.session("d5-in-wt");
    await ctx.attach(b, s1, plan(b.root));
    const d1 = await ctx.decide(b.root, s1, "Relocated work", b.milestone);
    const w1 = await ctx.write(b, s1, tool, d1.input!, { cwd: wt });
    const s2 = ctx.session("d5-in-main");
    await ctx.attach(wtRepo, s2, plan(wt));
    const d2 = await ctx.decide(wt, s2, "Relocated reverse work", b.milestone);
    const w2 = await ctx.write(b, s2, tool, d2.input!, { cwd: b.root });
    out = { mainReceiptWorktreeWrite: w1.run, worktreeReceiptMainWrite: w2.run, roots: { main: b.root, worktree: wt } };
  });
  return out;
}

/**
 * D-6 and D-7, measured, each case in its own fresh attached session of one
 * fixture so the four refusals are comparable:
 *   malformed   — this session's own receipt, overwritten with bytes that do not parse;
 *   unreadable  — this session's own receipt, its directory chmod 000 for the write;
 *   otherSession — a receipt another session wrote, announced in this session;
 *   noReceipt   — the same create with no receipt at all.
 */
export async function measureKnownDefectsReceipts(
  tracker: Tracker,
  pluginRoot: string,
): Promise<{ malformed: ProcRun | null; unreadable: ProcRun | null; otherSession: ProcRun | null; noReceipt: ProcRun | null; writesAdded: number }> {
  const out = { malformed: null as ProcRun | null, unreadable: null as ProcRun | null, otherSession: null as ProcRun | null, noReceipt: null as ProcRun | null, writesAdded: -1 };
  await withSharedTrackerFixture({ tracker, shape: "coexist", pluginRoot }, async (fx) => {
    const ctx = new Ctx(fx, pluginRoot, harnessBlocks);
    const b = fx.b;
    const tool = tracker === "jira" ? "createJiraIssue" : "save_issue";
    const plan = join(b.root, "specs", "plan", `${b.milestone.token}.md`);
    const flags = ctx.containerFlags(b.milestone);
    const fresh = async (label: string) => {
      const x = ctx.session(label);
      const att = await ctx.attach(b, x, plan);
      if (att.exitCode !== 0) throw new Error(`attach in ${label} failed: ${att.stderr}`);
      return x;
    };
    const decideAs = async (title: string, sessionId: string) => {
      const tf = ctx.file("title.txt", `${title}\n`);
      const page = ctx.file("empty-page.json", tracker === "jira" ? { issues: [], isLast: true } : { issues: [], pageInfo: { hasNextPage: false, endCursor: null } });
      const args = ["decide", b.root, page, "--title-file", tf, ...flags, "--attempt", "fast"];
      const r = await ctx.door(`${ADAPTERS_SRC}/create_idempotency_probe.ts`, args, { sessionId });
      if (r.exitCode !== 0) throw new Error(`decide as ${sessionId} failed: ${r.stderr}`);
      const decision = JSON.parse(r.stdout.split("\n")[0]!);
      return { r, args, path: announcementOf(r.stdout), input: ctx.createInput(decision.createPayload) };
    };
    const announce = (in_: Session, d: { r: ProcRun; args: string[] }, path: string) =>
      in_.bash(
        `bun run "\${CLAUDE_PLUGIN_ROOT}/${ADAPTERS_SRC}/create_idempotency_probe.ts" ${d.args.map(quoteArg).join(" ")}`,
        `${d.r.stdout.split("\n")[0]!}\ndpt-receipt: ${path} sha256:${sha256(readFileSync(path))}`,
      );
    const title = "Receipt defect work";
    const w0 = ctx.writes;

    const sM = await fresh("d6-malformed");
    const dM = await decideAs(title, sM.id);
    writeFileSync(dM.path, "{ not json\n");
    announce(sM, dM, dM.path);
    out.malformed = (await ctx.write(b, sM, tool, dM.input, { cwd: b.root })).run;

    const sU = await fresh("d6-unreadable");
    const dU = await decideAs(title, sU.id);
    announce(sU, dU, dU.path);
    const dir = receiptsDirOf(b.root, sU.id);
    chmodSync(dir, 0o000);
    try {
      out.unreadable = (await ctx.write(b, sU, tool, dU.input, { cwd: b.root })).run;
    } finally {
      chmodSync(dir, 0o755);
    }

    const other = ctx.session("d7-writer");
    const sO = await fresh("d7-other");
    const dO = await decideAs(title, other.id);
    announce(sO, dO, dO.path);
    out.otherSession = (await ctx.write(b, sO, tool, dO.input, { cwd: b.root })).run;

    const sN = await fresh("d7-none");
    out.noReceipt = (await ctx.write(b, sN, tool, dO.input, { cwd: b.root })).run;
    out.writesAdded = ctx.writes - w0;
  });
  return out;
}

// ---------------------------------------------------------------- S12 / S17 / S18 commit hooks

async function onlyEvidence(ctx: Ctx, label: string, skill: "gate-check" | "spec-review", roots: string[]): Promise<Session> {
  const s = ctx.session(label);
  const lines: string[] = [];
  for (const r of roots) lines.push(await ctx.gateReceipt(r, skill, s));
  ctx.evidenceWindow(s, skill, lines, skill);
  return s;
}

/** S12: commit and PR hooks by repository, from a session rooted in A. */
async function hooksByRepository(ctx: Ctx): Promise<void> {
  const { a, b } = ctx.fx;
  const wt = ctx.fx.addWorktree("b");
  const forms: Array<[string, string, string]> = [
    ["the bare cd form", `cd ${b.root} && git commit -m x`, b.root],
    ["the git -C form", `git -C ${b.root} commit -m x`, b.root],
    ["a commit into a worktree of B", `git -C ${wt} commit -m x`, wt],
  ];
  for (const [label, command, target] of forms) {
    ctx.step(`commit: ${label}`);
    const onlyA = await onlyEvidence(ctx, "commit-only-a", "gate-check", [a.root]);
    const r0 = await ctx.commitHook("pre-commit-gate-check", command, { session: onlyA, cwd: a.root });
    ctx.check(r0.exitCode === 2, `${label}: a commit into B with only A's evidence must be refused (exit 2), got exit ${r0.exitCode}:\n${r0.stderr}`);
    const withB = await onlyEvidence(ctx, "commit-b", "gate-check", [target]);
    const r1 = await ctx.commitHook("pre-commit-gate-check", command, { session: withB, cwd: a.root });
    ctx.check(r1.exitCode === 0, `${label}: a commit into B with B's own evidence must be allowed (exit 0), got exit ${r1.exitCode}:\n${r1.stderr}`);
  }
  ctx.step("PR into B");
  const pr = `cd ${b.root} && gh pr create --title x --body y`;
  const prA = await onlyEvidence(ctx, "pr-only-a", "spec-review", [a.root]);
  const p0 = await ctx.commitHook("pre-pr-spec-review", pr, { session: prA, cwd: a.root });
  ctx.check(p0.exitCode === 2, `a PR into B with only A's evidence must be refused (exit 2), got exit ${p0.exitCode}:\n${p0.stderr}`);
  const prB = await onlyEvidence(ctx, "pr-b", "spec-review", [b.root]);
  const p1 = await ctx.commitHook("pre-pr-spec-review", pr, { session: prB, cwd: a.root });
  ctx.check(p1.exitCode === 0, `a PR into B with B's own evidence must be allowed (exit 0), got exit ${p1.exitCode}:\n${p1.stderr}`);

  const commit = `git -C ${b.root} commit -m x`;
  ctx.step("B's evidence present but malformed");
  {
    const s = await onlyEvidence(ctx, "commit-b-malformed", "gate-check", [b.root]);
    const file = receiptFiles(b.root, s.id)[0]!;
    writeFileSync(file, "{ not json\n");
    const r = await ctx.commitHook("pre-commit-gate-check", commit, { session: s, cwd: a.root });
    ctx.check(r.exitCode === 2, `B's malformed evidence must be refused like absent evidence (exit 2), got exit ${r.exitCode}:\n${r.stderr}`);
  }
  ctx.step("B's evidence present but unreadable");
  {
    const s = await onlyEvidence(ctx, "commit-b-unreadable", "gate-check", [b.root]);
    const dir = receiptsDirOf(b.root, s.id);
    chmodSync(dir, 0o000);
    let r: ProcRun;
    try {
      r = await ctx.commitHook("pre-commit-gate-check", commit, { session: s, cwd: a.root });
    } finally {
      chmodSync(dir, 0o755);
    }
    ctx.check(r.exitCode === 2, `B's unreadable evidence must be refused like absent evidence (exit 2), got exit ${r.exitCode}:\n${r.stderr}`);
  }
  ctx.step("the PR leg: B's evidence present but malformed");
  {
    const s = await onlyEvidence(ctx, "pr-b-malformed", "spec-review", [b.root]);
    const file = receiptFiles(b.root, s.id)[0]!;
    writeFileSync(file, "{ not json\n");
    const r = await ctx.commitHook("pre-pr-spec-review", pr, { session: s, cwd: a.root });
    ctx.check(r.exitCode === 2, `a PR into B with B's malformed evidence must be refused like absent evidence (exit 2), got exit ${r.exitCode}:\n${r.stderr}`);
  }
  ctx.step("the PR leg: B's evidence present but unreadable");
  {
    const s = await onlyEvidence(ctx, "pr-b-unreadable", "spec-review", [b.root]);
    const dir = receiptsDirOf(b.root, s.id);
    chmodSync(dir, 0o000);
    let r: ProcRun;
    try {
      r = await ctx.commitHook("pre-pr-spec-review", pr, { session: s, cwd: a.root });
    } finally {
      chmodSync(dir, 0o755);
    }
    ctx.check(r.exitCode === 2, `a PR into B with B's unreadable evidence must be refused like absent evidence (exit 2), got exit ${r.exitCode}:\n${r.stderr}`);
  }
  ctx.step("B's CLAUDE.md present but unreadable");
  {
    const md = join(b.root, "CLAUDE.md");
    const s = await onlyEvidence(ctx, "commit-unreadable-md", "gate-check", [a.root]);
    const sp = await onlyEvidence(ctx, "pr-unreadable-md", "spec-review", [a.root]);
    chmodSync(md, 0o000);
    let rc: ProcRun;
    let rp: ProcRun;
    try {
      rc = await ctx.commitHook("pre-commit-gate-check", commit, { session: s, cwd: a.root });
      rp = await ctx.commitHook("pre-pr-spec-review", pr, { session: sp, cwd: a.root });
    } finally {
      chmodSync(md, 0o644);
    }
    for (const [what, r] of [
      ["the commit", rc],
      ["the PR", rp],
    ] as const) {
      ctx.check(r.exitCode === 2, `${what} into B whose CLAUDE.md cannot be read must be refused (exit 2), never read as unmanaged; got exit ${r.exitCode}:\n${r.stderr}`);
      ctx.check(/CLAUDE\.md/.test(r.stderr) && /unreadable|cannot be read|could not be read/i.test(r.stderr), `${what}: the refusal must name the unreadable declaration (CLAUDE.md):\n${r.stderr}`);
    }
  }
  // The mirror of the leg above: there the path stats and the READ fails; here
  // the STAT itself fails (a symlink loop answers ELOOP) or the link dangles.
  // Both are a declaration that exists and cannot be read — never "absent".
  for (const [shape, target] of [
    ["a symlink loop (stat answers ELOOP)", "CLAUDE.md"],
    ["a dangling symlink", "no-such-declaration.md"],
  ] as const) {
    ctx.step(`B's CLAUDE.md is ${shape}`);
    const md = join(b.root, "CLAUDE.md");
    const original = readFileSync(md, "utf-8");
    rmSync(md);
    symlinkSync(target, md);
    try {
      const s = await onlyEvidence(ctx, `commit-md-${target}`, "gate-check", [a.root]);
      const sp = await onlyEvidence(ctx, `pr-md-${target}`, "spec-review", [a.root]);
      const rc = await ctx.commitHook("pre-commit-gate-check", commit, { session: s, cwd: a.root });
      const rp = await ctx.commitHook("pre-pr-spec-review", pr, { session: sp, cwd: a.root });
      for (const [what, r] of [
        ["the commit", rc],
        ["the PR", rp],
      ] as const) {
        ctx.check(r.exitCode === 2, `${what} into B whose CLAUDE.md is ${shape} must be refused (exit 2), never read as unmanaged; got exit ${r.exitCode}:\n${r.stderr}`);
        ctx.check(/CLAUDE\.md/.test(r.stderr) && /could not be read/i.test(r.stderr), `${what}: the refusal must name the unreadable declaration (CLAUDE.md):\n${r.stderr}`);
      }
    } finally {
      rmSync(md, { force: true });
      writeFileSync(md, original);
    }
  }
  ctx.step("permit twin: an ABSENT CLAUDE.md (no directory entry at all) is unmanaged");
  {
    const md = join(b.root, "CLAUDE.md");
    const original = readFileSync(md, "utf-8");
    rmSync(md);
    try {
      const s = await onlyEvidence(ctx, "commit-md-absent", "gate-check", [a.root]);
      const sp = await onlyEvidence(ctx, "pr-md-absent", "spec-review", [a.root]);
      const rc = await ctx.commitHook("pre-commit-gate-check", commit, { session: s, cwd: a.root });
      const rp = await ctx.commitHook("pre-pr-spec-review", pr, { session: sp, cwd: a.root });
      ctx.check(rc.exitCode === 0, `a commit into B with no CLAUDE.md at all is unmanaged and must exit 0, got exit ${rc.exitCode}:\n${rc.stderr}`);
      ctx.check(rp.exitCode === 0, `a PR into B with no CLAUDE.md at all is unmanaged and must exit 0, got exit ${rp.exitCode}:\n${rp.stderr}`);
    } finally {
      writeFileSync(md, original);
    }
  }
  ctx.step("permit twin: a readable CLAUDE.md with no toolkit signal is unmanaged");
  {
    const md = join(b.root, "CLAUDE.md");
    const original = readFileSync(md, "utf-8");
    writeFileSync(md, "# A plain project\n\nNothing managed here.\n");
    try {
      const s = await onlyEvidence(ctx, "commit-unmanaged", "gate-check", [a.root]);
      const r = await ctx.commitHook("pre-commit-gate-check", commit, { session: s, cwd: a.root });
      ctx.check(r.exitCode === 0, `a commit into an unmanaged B must exit 0, got exit ${r.exitCode}:\n${r.stderr}`);
    } finally {
      writeFileSync(md, original);
    }
  }
}

/** S17: commit-writing subcommands and aliases aimed at B, through the real gate-check wrapper. */
async function commitSubcommands(ctx: Ctx): Promise<void> {
  const { a, b } = ctx.fx;
  git(b.root, "config", "alias.ci", "commit");
  git(b.root, "config", "alias.save", "!git commit -m wip");
  git(b.root, "config", "alias.st", "status");
  const B = b.root;
  const writing: Array<[string, string]> = [
    ["merge --no-ff", `git -C ${B} merge --no-ff feature`],
    ["cherry-pick", `git -C ${B} cherry-pick 1234567`],
    ["revert", `git -C ${B} revert 1234567`],
    ["am", `git -C ${B} am patch.mbox`],
    ["commit-tree", `git -C ${B} commit-tree 4b825dc642cb6eb9a060e54bf8d69288fbee4904 -m x`],
    ["the alias ci -> commit", `git -C ${B} ci -m x`],
    ["the ! alias", `git -C ${B} save`],
  ];
  for (const [label, command] of writing) {
    ctx.step(label);
    const onlyA = await onlyEvidence(ctx, "s17-only-a", "gate-check", [a.root]);
    const r0 = await ctx.commitHook("pre-commit-gate-check", command, { session: onlyA, cwd: a.root });
    ctx.check(r0.exitCode === 2, `${label} aimed at B with only A's evidence must exit 2, got exit ${r0.exitCode}:\n${r0.stderr}`);
    const withB = await onlyEvidence(ctx, "s17-b", "gate-check", [B]);
    const r1 = await ctx.commitHook("pre-commit-gate-check", command, { session: withB, cwd: a.root });
    ctx.check(r1.exitCode === 0, `${label} aimed at B must proceed once B's evidence exists (exit 0), got exit ${r1.exitCode}:\n${r1.stderr}`);
  }
  for (const [label, command] of [
    ["merge --ff-only", `git -C ${B} merge --ff-only feature`],
    ["status", `git -C ${B} status`],
    ["an alias to status", `git -C ${B} st`],
  ] as const) {
    ctx.step(label);
    const onlyA = await onlyEvidence(ctx, "s17-quiet", "gate-check", [a.root]);
    const r = await ctx.commitHook("pre-commit-gate-check", command, { session: onlyA, cwd: a.root });
    ctx.check(r.exitCode === 0 && r.stderr === "", `${label} writes no commit: expected exit 0 with empty stderr, got exit ${r.exitCode}:\n${r.stderr}`);
  }
  ctx.step("pull");
  const onlyA = await onlyEvidence(ctx, "s17-pull", "gate-check", [a.root]);
  const r = await ctx.commitHook("pre-commit-gate-check", `git -C ${B} pull`, { session: onlyA, cwd: a.root });
  ctx.check(r.exitCode === 1 && /^Reminder:/m.test(r.stderr), `git -C <B> pull must exit 1 with a Reminder:, got exit ${r.exitCode}:\n${r.stderr}`);
  ctx.check(!ctx.blockRule(r), "the pull's advisory exit 1 must reach the runner as permitted, never blocked");
}

/** S18: the visible /tdd Reminders, through the real tdd wrapper. */
async function tddReminders(ctx: Ctx): Promise<void> {
  const { a, b } = ctx.fx;
  const s = ctx.session("tdd");
  mkdirSync(join(b.root, "src"), { recursive: true });
  writeFileSync(join(b.root, "src", "x.ts"), "export const x = 1;\n");
  git(b.root, "add", "src/x.ts");
  const noGit = realpathSync(mkdtempSync(join(tmpdir(), "dpt-ste616-nogit-")));
  ctx.fx.track(noGit);
  symlinkSync(process.execPath, join(noGit, "bun"));
  const legs: Array<[string, string, { pathOverride?: string }]> = [
    ["a commit whose target cannot be resolved", 'git -C "$X" commit -m x', {}],
    ["a commit into a checkout with no stack marker", `git -C ${b.root} commit -m x`, {}],
    ["a commit where git cannot run in the target", `git -C ${b.root} commit -m x`, { pathOverride: noGit }],
  ];
  for (const [label, command, o] of legs) {
    ctx.step(label);
    const r = await ctx.commitHook("pre-commit-tdd-orchestrator", command, { session: s, cwd: a.root, ...o });
    ctx.check(r.exitCode === 1, `${label}: the /tdd wrapper must exit 1 (a visible Reminder, never a silent allow), got exit ${r.exitCode}:\n${r.stderr}`);
    ctx.check(/^Reminder: \S/m.test(r.stderr), `${label}: expected a non-empty Reminder: on stderr, got:\n${r.stderr}`);
    ctx.check(!ctx.blockRule(r), `${label}: exit 1 does not block — the runner must let the commit through`);
  }
  ctx.step("permit twin: a spec-only commit");
  git(b.root, "reset", "-q", "src/x.ts");
  writeFrFile(b.root, "FR-9", b.milestone.token, "active");
  git(b.root, "add", "specs/frs/FR-9.md");
  const r = await ctx.commitHook("pre-commit-tdd-orchestrator", `git -C ${b.root} commit -m x`, { session: s, cwd: a.root });
  ctx.check(r.exitCode === 0 && r.stderr === "", `a spec-only commit must exit 0 with empty stderr, got exit ${r.exitCode}:\n${r.stderr}`);
}

// ---------------------------------------------------------------- S13 ownership

/** The adapter's own `ticket_id_regex`, read from the Schema M frontmatter of `<pluginRoot>/adapters/<tracker>.md`. */
export function adapterTicketIdRegex(pluginRoot: string, tracker: Tracker): RegExp {
  const md = readFileSync(join(pluginRoot, "adapters", `${tracker}.md`), "utf-8");
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(md);
  const line = fm ? /^ticket_id_regex:\s*'([^']+)'\s*$/m.exec(fm[1]!) : null;
  if (!line) throw new Error(`adapters/${tracker}.md declares no ticket_id_regex in its frontmatter`);
  return new RegExp(line[1]!);
}

/** S13: claim and import ownership of A's tagged, an untagged, and another project's ticket. */
async function claimAndImport(ctx: Ctx): Promise<void> {
  const { a, b } = ctx.fx;
  const jira = ctx.tracker === "jira";
  const kA = ctx.seedTicket({ title: "A's claimed work", labels: [a.tag], container: a.milestone });
  const kU = ctx.seedTicket({ title: "Untagged work", labels: [] });
  const kB = ctx.seedTicket({ title: "B's own work", labels: [b.tag], container: b.milestone });
  const kO = jira
    ? ctx.jira.seed({ project: "OTH", summary: "Other project work", labels: [b.tag] }).key
    : ctx.linear.seed({ project: "OtherProject", team: LINEAR_TEAM, title: "Other project work", labels: [b.tag] }).identifier;
  const own = (key: string) => ctx.ticketFile(key);
  const decideOn = async (key: string) => {
    const r = await ctx.door(`${ADAPTERS_SRC}/ticket_ownership.ts`, ["decide", b.root, own(key)]);
    ctx.check(r.exitCode === 0, `decide on ${key} failed (exit ${r.exitCode}): ${r.stderr}`);
    return JSON.parse(r.stdout.trim().split("\n")[0]!) as { verdict: string; options?: string[] };
  };
  const claimCall = (key: string) =>
    jira ? { tool: "transitionJiraIssue", input: { cloudId: "fixture-cloud", issueIdOrKey: key, transition: { id: "21" } } } : { tool: "save_issue", input: { id: key, state: "In Progress" } };
  const importCall = (key: string) => {
    const labels = [...ctx.ticket(key).labels, b.tag];
    return jira ? { tool: "editJiraIssue", input: { cloudId: "fixture-cloud", issueIdOrKey: key, fields: { labels } } } : { tool: "save_issue", input: { id: key, labels } };
  };
  const writes0 = ctx.writes;

  // The branch-name form reads the key off a real branch of B with the
  // adapter's OWN `ticket_id_regex` (Schema M frontmatter of
  // adapters/<tracker>.md in the tree under test), exactly as Tier 1 of
  // docs/ticket-binding.md does: `git rev-parse --abbrev-ref HEAD`, then the
  // regex. Both adapters anchor it (`^…$`), so Tier 1 resolves only a branch
  // named exactly as the key; the full match is the key.
  const idRegex = adapterTicketIdRegex(ctx.pluginRoot, ctx.tracker);
  for (const form of ["argument", "branch name"] as const) {
    ctx.step(`decisions on the handed keys (${form})`);
    const keyOf = (k: string) => {
      if (form === "argument") return k;
      const wt = ctx.fx.addWorktree("b", { branch: k });
      const branch = git(wt, "rev-parse", "--abbrev-ref", "HEAD").trim();
      const m = idRegex.exec(branch);
      ctx.check(m, `the adapter's ticket_id_regex ${idRegex} finds no key in branch ${branch}`);
      git(b.root, "worktree", "remove", "--force", wt);
      return m[0];
    };
    const dA = await decideOn(keyOf(kA));
    ctx.eq(dA.verdict, "foreign-repo", `B's decision on A's tagged ticket ${kA} (${form})`);
    const dO = await decideOn(keyOf(kO));
    ctx.eq(dO.verdict, "foreign-project", `B's decision on the other project's ticket ${kO} (${form})`);
    const dU = await decideOn(keyOf(kU));
    ctx.eq(dU.verdict, "unowned", `B's decision on the untagged ticket ${kU} (${form})`);
  }
  for (const k of [kA, kO]) {
    const c = await ctx.door(`${ADAPTERS_SRC}/ticket_ownership.ts`, ["confirm", b.root, k, own(k)]);
    ctx.check(c.exitCode !== 0, `confirm on ${k} must exit non-zero, got exit 0: ${c.stdout}`);
  }
  ctx.eq(ctx.writes, writes0, "the flow stops at the refused decisions with zero writes");

  ctx.step("claim and import on A's tagged ticket through the hook");
  const sA = ctx.session("b-on-a");
  for (const [what, call] of [
    ["the claim transition", claimCall(kA)],
    ["the import sync", importCall(kA)],
  ] as const) {
    const w = await ctx.write(b, sA, call.tool, call.input, { cwd: b.root });
    ctx.expectRefused(w, `${what} on A's tagged ticket ${kA}`);
    ctx.eq(ctx.writes, writes0, `${what} on ${kA}: the double's write count`);
  }
  if (jira) {
    ctx.step("the other project's ticket lies outside every declared container");
    const c = claimCall(kO);
    const r = await hookOnly(ctx, b.server, sA, c.tool, c.input, b.root);
    ctx.check(r.exitCode === 0 && r.stdout === "" && r.stderr === "", `the hook is silent outside every declared container (§3): expected exit 0 and empty output on ${kO}, got exit ${r.exitCode}\n${r.stderr}`);
  } else {
    // Linear binds a declared repository by team key, so another project's
    // ticket in the same team is still inside a declared binding: the hook
    // refuses its unreceipted write (AC-STE-616.17, Linear arm).
    ctx.step("the other project's ticket in the same team: the hook refuses its unreceipted write");
    for (const [what, call] of [
      ["the claim transition", claimCall(kO)],
      ["the import sync", importCall(kO)],
    ] as const) {
      const w = await ctx.write(b, sA, call.tool, call.input, { cwd: b.root });
      ctx.expectRefused(w, `${what} on the other project's ticket ${kO} (same team)`, `on ${kO}: the ticket is not owned by the declared target ${b.root}`);
      ctx.eq(ctx.writes, writes0, `${what} on ${kO}: the double's write count`);
    }
  }

  const answers: Array<[string, string | null]> = [
    ["declined", "Skip"],
    ["answered in free text", "free"],
    ["never asked", null],
  ];
  for (const verb of ["Adopt", "Import"] as const) {
    for (const [label, ans] of answers) {
      ctx.step(`${verb} of the untagged ticket, ${label}`);
      const s = ctx.session(`${verb}-${label.split(" ")[0]}`);
      if (ans === "Skip") s.ask(kU, verb, `Skip ${kU}`);
      else if (ans === "free") s.ask(kU, verb, "sure, go ahead with that one");
      const d = verb === "Adopt"
        ? await ctx.door(`${ADAPTERS_SRC}/ticket_ownership.ts`, ["confirm", b.root, kU, own(kU), "--adopt"], { session: s })
        : await ctx.door(`${ADAPTERS_SRC}/container_ownership.ts`, ["consent", b.root, kU, ...ctx.containerPages()], { session: s });
      ctx.check(d.exitCode === 0, `the ${verb.toLowerCase()} receipt front door failed: ${d.stderr}`);
      const call = verb === "Adopt" ? claimCall(kU) : importCall(kU);
      const w0 = ctx.writes;
      const w = await ctx.write(b, s, call.tool, call.input, { cwd: b.root });
      ctx.expectRefused(w, `${verb.toLowerCase()} of ${kU} with the question ${label}`);
      ctx.eq(ctx.writes, w0, `${verb.toLowerCase()} ${label}: the double's write count`);
    }
    ctx.step(`${verb} of the untagged ticket, answered with the printed affirmative label`);
    const s = ctx.session(`${verb}-yes`);
    s.ask(kU, verb, `${verb} ${kU}`);
    const d = verb === "Adopt"
      ? await ctx.door(`${ADAPTERS_SRC}/ticket_ownership.ts`, ["confirm", b.root, kU, own(kU), "--adopt"], { session: s })
      : await ctx.door(`${ADAPTERS_SRC}/container_ownership.ts`, ["consent", b.root, kU, ...ctx.containerPages()], { session: s });
    ctx.check(d.exitCode === 0, `the ${verb.toLowerCase()} receipt front door failed: ${d.stderr}`);
    const call = verb === "Adopt" ? claimCall(kU) : importCall(kU);
    ctx.expectPermitted(await ctx.write(b, s, call.tool, call.input, { cwd: b.root }), `${verb.toLowerCase()} of ${kU} answered "${verb} ${kU}"`);
  }

  ctx.step("permit twin: B's own tagged ticket");
  const dB = await decideOn(kB);
  ctx.eq(dB.verdict, "owned", `B's decision on its own tagged ticket ${kB}`);
  const sB = ctx.session("b-own");
  const cB = await ctx.door(`${ADAPTERS_SRC}/ticket_ownership.ts`, ["confirm", b.root, kB, own(kB)], { session: sB });
  ctx.check(cB.exitCode === 0, `confirm on B's own ticket failed: ${cB.stderr}`);
  const w1 = ctx.writes;
  const claim = claimCall(kB);
  ctx.expectPermitted(await ctx.write(b, sB, claim.tool, claim.input, { cwd: b.root }), `the claim transition on ${kB}`);
  const assign = jira
    ? { tool: "editJiraIssue", input: { cloudId: "fixture-cloud", issueIdOrKey: kB, fields: { assignee: { accountId: "acct-b" } } } }
    : { tool: "save_issue", input: { id: kB, assignee: "me" } };
  ctx.expectPermitted(await ctx.write(b, sB, assign.tool, assign.input, { cwd: b.root }), `the assignee write on ${kB}`);
  ctx.eq(ctx.writes - w1, 2, `B's own claim: one transition and one assignee write`);
}

// ---------------------------------------------------------------- S15 / S16

/** S15 (Jira): the legacy numeric label carried by both repositories' tickets. */
async function numericLabel(ctx: Ctx): Promise<void> {
  const { a, b } = ctx.fx;
  const kA = ctx.seedTicket({ title: "NEX-211 style work", labels: [a.tag, "milestone-M8"] });
  const kB = ctx.seedTicket({ title: "NEX-297 style work", labels: [b.tag, "milestone-M8"] });
  const writes0 = ctx.writes;
  const report = async (root: string) => {
    const d = await ctx.detector(root, ctx.containerPages());
    ctx.check(d.exitCode === 0, `the detector failed from ${root}: ${d.stderr}`);
    return d.stdout.split("\n").filter((l) => /^warning numeric-milestone-shared:/.test(l));
  };
  for (const repo of [a, b]) {
    const rows = await report(repo.root);
    ctx.eq(rows.length, 1, `numeric-milestone-shared rows reported from ${repo.name}`);
    ctx.check(rows[0]!.includes("milestone-M8") && rows[0]!.includes(kA) && rows[0]!.includes(kB), `the warning from ${repo.name} must name milestone-M8, ${kA} and ${kB}: ${rows[0]}`);
  }
  ctx.eq(ctx.writes, writes0, "the double's write count after probe #49");
  ctx.step("permit twin: only A's tickets carry the label");
  ctx.jira.find(kB)!.labels = [b.tag];
  for (const repo of [a, b]) ctx.eq((await report(repo.root)).length, 0, `numeric-milestone-shared rows from ${repo.name} once only A carries milestone-M8`);
}

function gitAt(root: string, date: string, ...args: string[]): void {
  const p = spawnSync("git", args, { cwd: root, env: { ...GIT_ENV, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }, encoding: "utf-8" });
  if (p.status !== 0) throw new Error(`git ${args.join(" ")} failed in ${root}: ${p.stderr}`);
}

function numericPlanBody(token: string, status: "active" | "archived"): string {
  return ["---", `milestone: ${token}`, `status: ${status}`, `archived_at: ${status === "archived" ? "2026-09-20T13:00:00Z" : "null"}`, "shipped_in: null", "---", "", `## ${token} — Hand-written ${token}`, ""].join("\n");
}

/** S16: a new numeric milestone in tracker mode, beside a pre-epoch numeric plan that archives. */
async function newNumericMilestone(ctx: Ctx): Promise<void> {
  const { a, b } = ctx.fx;
  ctx.step("the typed-M<N> door in each root");
  for (const repo of [a, b]) {
    const r = await ctx.door(`${ADAPTERS_SRC}/next_free_milestone_number.ts`, [join(repo.root, "specs"), "M999"]);
    ctx.check(r.exitCode === 1, `the typed door for M999 in ${repo.name} (mode ${ctx.tracker}) must exit 1, got exit ${r.exitCode}:\n${r.stdout}${r.stderr}`);
    ctx.check(/resolve_milestone_identity\.ts/.test(`${r.stdout}${r.stderr}`), `the typed door must name the decision front door as the remedy:\n${r.stdout}${r.stderr}`);
  }
  ctx.step("plans: M8 before every epoch, archived after; M999 hand-written after LINEAR_TRACKER_KEY_EPOCH");
  const planDir = join(a.root, "specs", "plan");
  writeFileSync(join(planDir, "M8.md"), numericPlanBody("M8", "active"));
  gitAt(a.root, "2026-07-01T00:00:00Z", "add", "specs/plan/M8.md");
  gitAt(a.root, "2026-07-01T00:00:00Z", "commit", "-q", "-m", "M8, before every epoch");
  writeFileSync(join(planDir, "M999.md"), numericPlanBody("M999", "active"));
  gitAt(a.root, "2026-09-20T12:00:00Z", "add", "specs/plan/M999.md");
  gitAt(a.root, "2026-09-20T12:00:00Z", "commit", "-q", "-m", "M999, hand-written");
  mkdirSync(join(planDir, "archive"), { recursive: true });
  gitAt(a.root, "2026-09-20T13:00:00Z", "mv", "specs/plan/M8.md", "specs/plan/archive/M8.md");
  writeFileSync(join(planDir, "archive", "M8.md"), numericPlanBody("M8", "archived"));
  gitAt(a.root, "2026-09-20T13:00:00Z", "add", "-A");
  gitAt(a.root, "2026-09-20T13:00:00Z", "commit", "-q", "-m", "archive M8");

  ctx.step("probe #73 through its command-line front door");
  const writes0 = ctx.writes;
  const p = await ctx.door(`${ADAPTERS_SRC}/plan_identity_mode_conditional.ts`, [a.root], { kind: "gate-probe" });
  const jsonLines = p.stdout.split("\n").filter((l) => l.trim().startsWith("{"));
  ctx.check(jsonLines.length === 1, `probe #73's front door must print exactly one JSON report line on stdout, got ${jsonLines.length} (exit ${p.exitCode}):\n${p.stdout}${p.stderr}`);
  const report = JSON.parse(jsonLines[0]!) as { mode: string; violations: Array<{ file: string; expected: string; severity: string }> };
  ctx.eq(report.mode, ctx.tracker, "probe #73's report mode");
  const expected = ctx.tracker === "jira" ? "an Epic-keyed M_<KEY> plan" : "a tracker-minted M_<6-hex> plan";
  const m999 = report.violations.filter((v) => v.file.endsWith(`${"/"}M999.md`));
  ctx.eq(m999.map((v) => [v.severity, v.expected]), [["error", expected]], `probe #73's rows for the hand-written M999.md (the ${ctx.tracker} arm)`);
  const m8 = report.violations.filter((v) => /\/M8\.md$/.test(v.file));
  ctx.eq(m8.length, 0, `probe #73's rows for the pre-epoch M8 plan archived after the epoch (${JSON.stringify(m8)})`);
  ctx.check(p.exitCode === (report.violations.some((v) => v.severity === "error") ? 1 : 0), `probe #73's front door exits 1 when an error row is reported, else 0; got exit ${p.exitCode}`);
  ctx.eq(ctx.writes, writes0, "the double's write count after S16");

  ctx.step("permit twin: M8 archived AND shipped — shipped_in stamped with a matching CHANGELOG heading, committed — yields no row");
  {
    const shipped = "9.9.1";
    const archivedPlan = join(planDir, "archive", "M8.md");
    writeFileSync(archivedPlan, numericPlanBody("M8", "archived").replace("shipped_in: null", `shipped_in: v${shipped}`));
    writeFileSync(join(a.root, "CHANGELOG.md"), ["# Changelog", "", `## [${shipped}] — 2026-09-20 — "Fixture Ship"`, "", "### Added", "", "- M8.", ""].join("\n"));
    gitAt(a.root, "2026-09-20T14:00:00Z", "add", "-A");
    gitAt(a.root, "2026-09-20T14:00:00Z", "commit", "-q", "-m", `release: v${shipped} ships M8`);
    ctx.check(new RegExp(`^shipped_in: v${shipped.replace(/\./g, "\\.")}$`, "m").test(readFileSync(archivedPlan, "utf-8")), "the archived M8 plan carries its shipped_in stamp");
    const p2 = await ctx.door(`${ADAPTERS_SRC}/plan_identity_mode_conditional.ts`, [a.root], { kind: "gate-probe" });
    const lines2 = p2.stdout.split("\n").filter((l) => l.trim().startsWith("{"));
    ctx.check(lines2.length === 1, `probe #73 after the ship must print one JSON line, got ${lines2.length}:\n${p2.stdout}${p2.stderr}`);
    const r2 = JSON.parse(lines2[0]!) as { mode: string; violations: Array<{ file: string; expected: string; severity: string }> };
    ctx.eq(r2.mode, ctx.tracker, "probe #73's report mode after the ship");
    ctx.eq(r2.violations.filter((v) => /\/M8\.md$/.test(v.file)).length, 0, `probe #73's rows for M8 archived and shipped as v${shipped} (${ctx.tracker} arm)`);
    ctx.eq(
      r2.violations.filter((v) => v.file.endsWith("/M999.md")).map((v) => [v.severity, v.expected]),
      [["error", expected]],
      "the one variable is M8's ship: M999's row is unchanged",
    );
    ctx.eq(ctx.writes, writes0, "the double's write count after the M8 ship");
  }

  ctx.step("permit twin: the typed door under mode: none answers free");
  const none = realpathSync(mkdtempSync(join(tmpdir(), "dpt-ste616-none-")));
  ctx.fx.track(none);
  mkdirSync(join(none, "specs", "plan"), { recursive: true });
  writeFileSync(join(none, "CLAUDE.md"), ["# Fixture Project", "", "## Task Tracking", "", "mode: none", "", "## Verification", "", "run_cmd: none", ""].join("\n"));
  const n = await ctx.door(`${ADAPTERS_SRC}/next_free_milestone_number.ts`, [join(none, "specs"), "M999"]);
  ctx.check(n.exitCode === 0 && /^verdict=free$/m.test(n.stdout), `under mode: none the typed door must answer verdict=free (exit 0), got exit ${n.exitCode}:\n${n.stdout}${n.stderr}`);
}

const BOTH: readonly Tracker[] = ["jira", "linear"];

/**
 * The scenarios this runner implements, in registry order. `trackers` and
 * `title` name the tests; the registry (adapters/_shared/src/shared_tracker_scenarios.ts)
 * is graded against this table, never the other way round.
 */
export const SCENARIO_DEFS: Record<string, ScenarioDef> = {
  S1: { shape: "coexist", body: sameTitle, trackers: BOTH, title: "coexist, same title (identical, dash, NBSP, whitespace; second page; retry twin)" },
  S2: { shape: "span", body: sameTitle, trackers: BOTH, title: "span, same title — only the tag separates them" },
  S3: { shape: "coexist", body: mintAndJoin, trackers: BOTH, title: "mint and join; a coincident title is never a silent bind" },
  S4: { shape: "coexist", body: orphanListing, trackers: BOTH, title: "orphan listing and the untagged detector from both repositories" },
  S5: { shape: "coexist", body: siblingBusy, trackers: BOTH, title: "sibling-busy ship gate" },
  S6: { shape: "coexist", body: versionFloor, trackers: BOTH, title: "version floor below, at and above" },
  S7: { shape: "coexist", body: receiptIntegrity, trackers: BOTH, title: "receipt integrity" },
  S8: { shape: "coexist", body: repoint, trackers: BOTH, title: "repoint into the shared container" },
  S9: { shape: "span", body: crossRepository, trackers: BOTH, title: "cross-repository session and unresolvable targets" },
  S10: { shape: "coexist", body: oldClient, trackers: BOTH, title: "old client writes an untagged ticket" },
  S11: { shape: "coexist", body: relocatedCheckout, trackers: BOTH, title: "relocated checkout, pre-declaration branch, unreadable declaration" },
  S12: { shape: "coexist", body: hooksByRepository, trackers: BOTH, title: "commit and PR hooks by repository" },
  S13: { shape: "coexist", body: claimAndImport, trackers: BOTH, title: "claim and import ownership" },
  S14: { shape: "coexist", body: zeroWriteJoin, trackers: BOTH, title: "zero-write join, span and release" },
  S15: { shape: "coexist", body: numericLabel, trackers: ["jira"], title: "numeric-label collision (offline-only)" },
  S16: { shape: "coexist", body: newNumericMilestone, trackers: BOTH, title: "new numeric milestone in tracker mode; the pre-epoch M8, archived and then shipped, yields no row" },
  S17: { shape: "coexist", body: commitSubcommands, trackers: BOTH, title: "commit-writing subcommands and aliases" },
  S18: { shape: "coexist", body: tddReminders, trackers: BOTH, title: "visible /tdd Reminders" },
};

/** The scenario ids this runner implements. */
export const RUNNER_SCENARIO_IDS: readonly string[] = Object.keys(SCENARIO_DEFS);

export async function runScenario(id: string, tracker: Tracker, opts: RunScenarioOptions): Promise<ScenarioResult> {
  const def = SCENARIO_DEFS[id];
  const empty: Record<InvocationKind, number> = { "front-door": 0, "tracker-write-hook": 0, "commit-pr-hook": 0, detector: 0, "gate-probe": 0 };
  if (!def) {
    return { id, tracker, ok: false, failures: [`the runner implements no scenario ${id}`], invocations: empty, hookRefused: 0, hookPermitted: 0, loadErrors: [], steps: [] };
  }
  let ctx: Ctx | null = null;
  const failures: string[] = [];
  try {
    await withSharedTrackerFixture({ tracker, shape: def.shape, pluginRoot: opts.pluginRoot }, async (fx) => {
      ctx = new Ctx(fx, opts.pluginRoot, opts.blockRule ?? harnessBlocks);
      await def.body(ctx);
    });
  } catch (e) {
    const c = ctx as Ctx | null;
    const where = c && c.steps.length ? ` [at step: ${c.steps[c.steps.length - 1]}]` : "";
    failures.push(`${e instanceof ScenarioFailure ? "" : `${(e as Error)?.name ?? "Error"}: `}${(e as Error)?.message ?? String(e)}${where}`);
  }
  const c = ctx as Ctx | null;
  return {
    id,
    tracker,
    ok: failures.length === 0,
    failures,
    invocations: c ? { ...c.counts } : empty,
    hookRefused: c?.hookRefused ?? 0,
    hookPermitted: c?.hookPermitted ?? 0,
    loadErrors: c ? [...c.loadErrors] : [],
    steps: c ? [...c.steps] : [],
  };
}

export { REAL_PLUGIN_ROOT };
