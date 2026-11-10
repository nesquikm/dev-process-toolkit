// Shared fixture for STE-729 (M_b2fdc0) — the Epic edit with consent, and the
// fetched-ticket ownership route of the tracker-write gate.
//
// Leading underscore: a helper module, never collected as a suite. Consumers:
//   tests/m_b2fdc0-ste-729-epic-edit.test.ts
//   tests/m_b2fdc0-ste-729-transcript-ownership.test.ts
//   tests/m_b2fdc0-ste-729-mutation.test.ts
//
// Every runner takes a `pluginRoot`, so the mutation battery can drive the very
// same legs against a mutated copy of the plugin (AC-STE-729.10). Every gate
// leg runs the SHIPPED `.sh` wrapper on a recorded PreToolUse payload over a
// synthetic transcript (AC-STE-729.9); every module leg spawns the real
// `epic_edit.ts`.
//
// Interfaces under test (from the FR, not from an implementation):
//   bun run adapters/_shared/src/epic_edit.ts <projectRoot> <EPIC-KEY>
//     permit: exit 0; stdout holds `default=forbidden`,
//             `options=["Edit <KEY>","Skip <KEY>"]` and ONE `dpt-receipt:` line;
//             one receipt { kind: "epic-edit", subject: <KEY>, adapter: "jira" }.
//     refuse: non-zero, NFR-10 lines on stderr naming the failed check, no receipt.
//
// Synthetic identities only: Jira project PROJ (PROJ-500 the Epic), Linear
// team STE / project DPT, tags demo-be / demo-fe, an example.invalid cloud.

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { receiptsDir } from "../adapters/_shared/src/dpt_paths";
import { milestoneIdFromEpicKey } from "../adapters/_shared/src/milestone_token";
import { RECEIPT_ANNOUNCEMENT_PREFIX, receiptDigest } from "../adapters/_shared/src/tracker_receipts";
import { claudeMd, commitAll, git, pluginManifest } from "./_span_fixture";
import { buildPassingBundle, serverPrefix, type BundleSession, type LiveBundle, type ToolCall } from "./_live_bundle_fixtures";

export const PLUGIN_ROOT = join(import.meta.dir, "..");
export const SESSION = "s-729-main";
export const OTHER_SESSION = "s-729-other";
/** At the declared `min_dpt_version` (2.87.0) of every fixture repository. */
export const MANIFEST_VERSION = "2.87.0";
export const PROJECT = "PROJ";
export const EPIC = "PROJ-500";
export const OTHER_EPIC = "PROJ-501";
export const MILESTONE = milestoneIdFromEpicKey(EPIC); // M_PROJ_500
export const TICKET = "PROJ-510";
export const OTHER_TICKET = "PROJ-511";
export const BOUND_TICKET = "PROJ-520";
export const LINEAR_TICKET = "STE-510";
export const TAG = "demo-be";
export const SIBLING_TAG = "demo-fe";
export const CLOUD = "example.invalid";
export const HOOK = "pre-tracker-write-gate";
export const EPIC_EDIT = "epic_edit.ts";
export const EDIT_LABEL = (k: string): string => `Edit ${k}`;
export const SKIP_LABEL = (k: string): string => `Skip ${k}`;

export const moduleRel = (m: string): string => join("adapters", "_shared", "src", m);
export const hookModuleRel = join("templates", "hooks", "_lib", "hooks", `${HOOK}.ts`);
export const graderRel = moduleRel("shared_tracker_live_grader.ts");
const SH_ENTRY_REL = join("templates", "hooks", "process", `${HOOK}.sh`);

// ------------------------------------------------------------------ cleanup

const tempDirs: string[] = [];
export function tempDir(label: string): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), `dpt-729-${label}-`)));
  tempDirs.push(d);
  return d;
}
export function cleanupTemps(): void {
  for (const d of tempDirs.splice(0)) rmSync(d, { recursive: true, force: true });
}

let neutral = "";
/** A directory outside every fixture repository, for spawned children's cwd and transcripts. */
export function neutralCwd(): string {
  if (neutral === "" || !existsSync(neutral)) neutral = tempDir("neutral");
  return neutral;
}

const shRoots = new Map<string, string>();
/**
 * The shipped wrapper's plugin root for `pluginRoot`: a fixture manifest (the
 * floor reads MANIFEST_VERSION) beside symlinks to that root's templates/adapters.
 */
export function shRootFor(pluginRoot: string): string {
  let r = shRoots.get(pluginRoot);
  if (r && existsSync(r)) return r;
  r = tempDir("sh-root");
  pluginManifest(r, MANIFEST_VERSION);
  symlinkSync(join(pluginRoot, "templates"), join(r, "templates"));
  symlinkSync(join(pluginRoot, "adapters"), join(r, "adapters"));
  shRoots.set(pluginRoot, r);
  return r;
}

// ------------------------------------------------------------------- worlds

/** The one fact a twin changes; the permit world changes none. */
export interface WorldOpts {
  /** (a) the plan is on disk but not in the git index. */
  untrackedPlan?: boolean;
  /** (b) the plan (index AND working tree, identically) carries this `milestone:` instead of M_PROJ_500. */
  planMilestone?: string;
  /** (c) the working-tree plan's frontmatter differs from the indexed one (status). */
  driftWorkingTree?: boolean;
  /** (d) the repository's binding is Linear, not Jira. */
  linear?: boolean;
  /** The plan sits at specs/plan/archive/ instead of specs/plan/. */
  archived?: boolean;
  /** No repo_tag: an unshared repository (AC-STE-729.11). */
  unshared?: boolean;
  /** The Jira project this repository declares (default PROJ). */
  project?: string;
  /** A tracked FR file binding this key (AC-STE-729.11). */
  boundFr?: string;
  /** No plan at all. */
  noPlan?: boolean;
  /**
   * (e) the plan's `container_origin:` (AC-STE-729.12). Default `minted`: the
   * permit world models the repository that MINTED its Epic. `null` omits the
   * key; `joined` models a joining repository.
   */
  containerOrigin?: string | null;
  /** The repo tag this repository declares (default demo-be). */
  tag?: string;
}

export interface World {
  root: string;
  scratch: string;
  planRel: string;
  planFile: string;
}

/** A plan's frontmatter; `containerOrigin` null omits the `container_origin:` key (AC-STE-729.12). */
function planText(milestone: string, status: "active" | "archived", containerOrigin: string | null = "minted"): string {
  return [
    "---",
    `milestone: ${milestone}`,
    `status: ${status}`,
    `archived_at: ${status === "archived" ? "2026-11-01T00:00:00Z" : "null"}`,
    "shipped_in: null",
    ...(containerOrigin === null ? [] : [`container_origin: ${containerOrigin}`]),
    "---",
    "",
    `# ${milestone}`,
    "",
    "The milestone's plan.",
    "",
  ].join("\n");
}

function frText(key: string, adapter: "jira" | "linear"): string {
  return [
    "---",
    `title: ${key}`,
    `milestone: ${MILESTONE}`,
    "status: active",
    "archived_at: null",
    "tracker:",
    `  ${adapter}: ${key}`,
    "created_at: 2026-11-01T00:00:00Z",
    "---",
    "",
    `# ${key}`,
    "",
  ].join("\n");
}

/**
 * One repository: Jira project PROJ shared under tag demo-be (or Linear team
 * STE / project DPT), planning M_PROJ_500 at specs/plan/M_PROJ_500.md,
 * everything committed. Each `WorldOpts` flag changes exactly the one fact its
 * check reads.
 */
export function makeWorld(o: WorldOpts = {}): World {
  const root = tempDir("world");
  const tag = o.tag ?? TAG;
  const shared = o.unshared ? {} : { defaultLabels: [tag], repoTag: tag, minDptVersion: "2.87.0" };
  if (o.linear) claudeMd(root, { mode: "linear", team: "STE", project: "DPT", ...shared });
  else claudeMd(root, { mode: "jira", project: o.project ?? PROJECT, ...shared });
  const planRel = o.archived ? `specs/plan/archive/${MILESTONE}.md` : `specs/plan/${MILESTONE}.md`;
  const planFile = join(root, planRel);
  mkdirSync(join(root, "specs", "plan", "archive"), { recursive: true });
  mkdirSync(join(root, "specs", "frs"), { recursive: true });
  const status = o.archived ? "archived" : "active";
  const origin = o.containerOrigin === undefined ? "minted" : o.containerOrigin;
  if (!o.noPlan) writeFileSync(planFile, planText(o.planMilestone ?? MILESTONE, status, origin));
  if (o.boundFr) writeFileSync(join(root, "specs", "frs", `${o.boundFr}.md`), frText(o.boundFr, o.linear ? "linear" : "jira"));
  git(root, "init", "-q", "-b", "main");
  commitAll(root, "fixture");
  if (o.untrackedPlan) {
    git(root, "rm", "-q", "--cached", "--", planRel);
    git(root, "commit", "-q", "-m", "fixture: untrack the plan");
    if (!existsSync(planFile)) throw new Error("fixture: the untracked plan must stay on disk");
  }
  if (o.driftWorkingTree) {
    writeFileSync(planFile, planText(o.planMilestone ?? MILESTONE, status === "active" ? "archived" : "active", origin));
  }
  return { root, scratch: tempDir("scratch"), planRel, planFile };
}

// ------------------------------------------------------------ module runs

export interface ModuleRun {
  exitCode: number;
  stdout: string;
  stderr: string;
  /** The command a transcript records for this run. */
  command: string;
}

export function childEnv(pluginRoot: string, session = SESSION): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, val] of Object.entries(process.env)) if (val !== undefined) env[k] = val;
  delete env.CLAUDE_PROJECT_DIR;
  delete env.CLAUDE_PLUGIN_OPTION_TRACKER_WRITE_GATE;
  env.CLAUDE_PLUGIN_ROOT = pluginRoot;
  env.CLAUDE_CODE_SESSION_ID = session;
  return env;
}

/** Spawn `<pluginRoot>/adapters/_shared/src/<module>` with `args` after the module path. */
export function runModule(pluginRoot: string, module: string, args: string[], session = SESSION): ModuleRun {
  const path = join(pluginRoot, moduleRel(module));
  const p = Bun.spawnSync(["bun", "run", path, ...args], { cwd: neutralCwd(), env: childEnv(pluginRoot, session), stdout: "pipe", stderr: "pipe" });
  return {
    exitCode: p.exitCode ?? -1,
    stdout: p.stdout.toString(),
    stderr: p.stderr.toString(),
    command: `bun run "${path}" ${args.join(" ")}`,
  };
}

/** Spawn the REAL epic_edit.ts: `bun run epic_edit.ts <root> <KEY>`. */
export function runEpicEdit(pluginRoot: string, w: World, key = EPIC, session = SESSION): ModuleRun {
  return runModule(pluginRoot, EPIC_EDIT, [w.root, key], session);
}

export function show(r: { exitCode: number; stdout: string; stderr: string }): string {
  return `exit=${r.exitCode}\n--- stdout ---\n${r.stdout}\n--- stderr ---\n${r.stderr}`;
}

export const announcementLines = (out: string): string[] => out.split("\n").filter((l) => l.startsWith(RECEIPT_ANNOUNCEMENT_PREFIX));

/** The receipt files `session` wrote under `root`. */
export function receiptFiles(root: string, session = SESSION): string[] {
  const dir = receiptsDir(root, session);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => n.endsWith(".json")).map((n) => join(dir, n));
}

/** The one announced receipt path of a permitted run. */
export function announcedPath(r: ModuleRun): string {
  const lines = announcementLines(r.stdout);
  if (lines.length !== 1) throw new Error(`expected exactly one announcement, got:\n${show(r)}`);
  return lines[0]!.slice(RECEIPT_ANNOUNCEMENT_PREFIX.length).trim().split(/\s+/)[0]!;
}

/** Is this run the module's permit: exit 0, the consent lines, one intact `epic-edit` receipt for `key`? Returns the reason it is not, or null. */
export function epicEditPermitProblem(r: ModuleRun, w: World, key = EPIC, session = SESSION): string | null {
  if (r.exitCode !== 0) return `exit ${r.exitCode}`;
  const out = r.stdout.split("\n").map((l) => l.trim());
  if (!out.includes("default=forbidden")) return "no `default=forbidden` line";
  if (!out.includes(`options=${JSON.stringify([EDIT_LABEL(key), SKIP_LABEL(key)])}`)) return `no \`options=["Edit ${key}","Skip ${key}"]\` line`;
  const lines = announcementLines(r.stdout);
  if (lines.length !== 1) return `${lines.length} announcement lines`;
  const path = lines[0]!.slice(RECEIPT_ANNOUNCEMENT_PREFIX.length).trim().split(/\s+/)[0]!;
  if (!resolve(path).startsWith(receiptsDir(w.root, session))) return `the receipt ${path} is not in this session's directory of ${w.root}`;
  if (!existsSync(path)) return `the announced receipt ${path} does not exist`;
  if (!lines[0]!.includes(`sha256:${receiptDigest(readFileSync(path))}`)) return "the announcement does not carry the receipt's digest";
  if (receiptFiles(w.root, session).length !== 1) return `${receiptFiles(w.root, session).length} receipt files`;
  const rc = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
  const got = { kind: rc.kind, subject: rc.subject, adapter: rc.adapter, sessionId: rc.sessionId };
  const want = { kind: "epic-edit", subject: key, adapter: "jira", sessionId: session };
  if (JSON.stringify(got) !== JSON.stringify(want)) return `receipt ${JSON.stringify(got)} is not ${JSON.stringify(want)}`;
  return null;
}

/** Is this run an NFR-10 refusal that writes nothing and names every needle? Returns the reason it is not, or null. */
export function epicEditRefusalProblem(r: ModuleRun, w: World, needles: RegExp[], session = SESSION): string | null {
  if (r.exitCode === 0) return "exit 0";
  if (announcementLines(r.stdout).length + announcementLines(r.stderr).length > 0) return "a refusal announced a receipt";
  if (receiptFiles(w.root, session).length > 0) return "a refusal wrote a receipt";
  if (/^options=/m.test(r.stdout)) return "a refusal printed options=";
  const lines = r.stderr.split("\n").filter((l) => l.trim() !== "");
  if (lines.length < 3) return "fewer than three stderr lines (NFR-10)";
  if (/^(Remedy|Context): /.test(lines[0]!)) return "the first line is a sub-line, not the verdict";
  if (!lines.some((l) => l.startsWith("Remedy: "))) return "no Remedy: line";
  if (!lines.some((l) => l.startsWith("Context: "))) return "no Context: line";
  for (const n of needles) if (!n.test(r.stderr)) return `the refusal does not name ${n}`;
  return null;
}

// ------------------------------------------------------------- transcripts

export interface AskOpts {
  /** The AskUserQuestion result is an error (it still carries the label). */
  error?: boolean;
}

export class Transcript {
  readonly lines: string[] = [];
  private seq = 0;

  use(name: string, input: unknown, id = this.nextId()): string {
    this.lines.push(
      JSON.stringify({
        type: "assistant",
        sessionId: SESSION,
        timestamp: new Date().toISOString(),
        message: { id: `msg_${id}`, role: "assistant", content: [{ type: "tool_use", id, name, input }] },
      }),
    );
    return id;
  }

  result(id: string, content: unknown, isError = false, extra: Record<string, unknown> = {}): void {
    this.lines.push(
      JSON.stringify({
        type: "user",
        sessionId: SESSION,
        timestamp: new Date().toISOString(),
        message: { role: "user", content: [{ tool_use_id: id, type: "tool_result", content, ...(isError ? { is_error: true } : {}) }] },
        ...extra,
      }),
    );
  }

  bash(command: string, output: string, isError = false): void {
    const id = this.use("Bash", { command, description: "run" });
    this.result(id, output, isError);
  }

  /** A recorded module run, as Claude Code records it: stdout on success, stderr as an error result. */
  run(r: ModuleRun): void {
    this.bash(r.command, r.exitCode === 0 ? r.stdout.trimEnd() : `Exit code ${r.exitCode}\n${r.stderr}`, r.exitCode !== 0);
  }

  /** An answered AskUserQuestion in the shape the harness records (sentence + toolUseResult.answers). */
  ask(question: string, labels: string[], answer: string, o: AskOpts = {}): void {
    const questions = [{ question, header: "Epic", multiSelect: false, options: labels.map((label) => ({ label, description: label })) }];
    const id = this.use("AskUserQuestion", { questions });
    const said = `"${question}"="${answer}"`;
    if (o.error) {
      this.result(id, `<tool_use_error>InputValidationError: AskUserQuestion failed</tool_use_error> ${said}`, true, { toolUseResult: { questions, answers: { [question]: answer } } });
      return;
    }
    this.result(id, `Your questions have been answered: ${said}. You can now continue with these answers in mind.`, false, {
      toolUseResult: { questions, answers: { [question]: answer } },
    });
  }

  /** The operator's own prose message (not an AskUserQuestion answer). */
  prose(text: string): void {
    this.lines.push(JSON.stringify({ type: "user", sessionId: SESSION, timestamp: new Date().toISOString(), message: { role: "user", content: text } }));
  }

  /** A tracker tool call and its JSON answer, as MCP results are recorded (a text block). */
  tool(name: string, input: Record<string, unknown>, answer: unknown, isError = false): void {
    const id = this.use(name, input);
    this.result(id, [{ type: "text", text: typeof answer === "string" ? answer : JSON.stringify(answer) }], isError);
  }

  private nextId(): string {
    this.seq += 1;
    return `toolu_729_${String(this.seq).padStart(4, "0")}`;
  }
}

/** The consent question for an Epic edit, naming the key and offering the printed labels. */
export function askEdit(t: Transcript, key: string, answer: string, o: AskOpts = {}): void {
  t.ask(`Edit the description or summary of Epic ${key}?`, [EDIT_LABEL(key), SKIP_LABEL(key)], answer, o);
}

/** The adopt question for an untagged ticket. */
export function askAdopt(t: Transcript, key: string, answer: string): void {
  t.ask(`Adopt ${key} as this repository's ticket?`, [`Adopt ${key}`, `Skip ${key}`], answer);
}

// ------------------------------------------------------------------ the gate

export interface Run {
  exitCode: number;
  stdout: string;
  stderr: string;
}

const GATED_ID = "toolu_729_gated";
let transcriptSeq = 0;

/** Drive the gate through `pluginRoot`'s SHIPPED `.sh` wrapper on a recorded PreToolUse payload. */
export async function gate(pluginRoot: string, toolName: string, input: Record<string, unknown>, t: Transcript, cwd: string): Promise<Run> {
  transcriptSeq += 1;
  const path = join(neutralCwd(), `transcript-${process.pid}-${transcriptSeq}.jsonl`);
  const gated = new Transcript();
  gated.use(toolName, input, GATED_ID);
  writeFileSync(path, [...t.lines, ...gated.lines].join("\n") + "\n");
  const payload = JSON.stringify({
    session_id: SESSION,
    transcript_path: path,
    cwd,
    permission_mode: "default",
    hook_event_name: "PreToolUse",
    tool_name: toolName,
    tool_input: input,
    tool_use_id: GATED_ID,
  });
  const sh = shRootFor(pluginRoot);
  const env = childEnv(sh);
  const proc = Bun.spawn(["bash", join(sh, SH_ENTRY_REL)], { cwd: neutralCwd(), env, stdin: new Response(payload).body, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return { exitCode: await proc.exited, stdout, stderr };
}

export const JIRA = (tool: string): string => `mcp__atlassian__${tool}`;
export const LINEAR = (tool: string): string => `mcp__linear__${tool}`;

/** Why `r` is not a permit (exit 0, silent stdout), or null. */
export const permitProblem = (r: Run): string | null => (r.exitCode !== 0 ? `exit ${r.exitCode}` : r.stdout !== "" ? "stdout not empty" : null);
/** Why `r` is not an NFR-10 gate refusal (exit 2), or null. */
export function refusalProblem(r: Run): string | null {
  if (r.exitCode !== 2) return `exit ${r.exitCode}`;
  if (r.stdout !== "") return "stdout not empty";
  for (const s of ["Refusing:", "Remedy:", `hook=${HOOK}`]) if (!r.stderr.includes(s)) return `stderr lacks ${s}`;
  return null;
}

/** The Remedy: line of a gate refusal. */
export const remedyOf = (r: Run): string => r.stderr.split("\n").find((l) => l.startsWith("Remedy: ")) ?? "";

// -------------------------------------------------------------- tickets

export interface JiraTicketOpts {
  labels?: string[];
  type?: "Task" | "Epic" | "Story";
  project?: string;
  /** The answer's `fields.creator`; a real answer always carries one. `null` omits it. */
  creator?: { displayName: string } | null;
}

/** A fetched Jira ticket, as `getJiraIssue` answers it (always with a `fields.creator`). */
export function jiraTicket(key: string, o: JiraTicketOpts = {}): Record<string, unknown> {
  const type = o.type ?? "Task";
  return {
    key,
    id: "10510",
    fields: {
      summary: `Ticket ${key}`,
      labels: [...(o.labels ?? [TAG])],
      issuetype: { name: type, hierarchyLevel: type === "Epic" ? 1 : 0 },
      project: { key: o.project ?? PROJECT },
      status: { name: "To Do", statusCategory: { key: "new" } },
      ...(o.creator === null ? {} : { creator: o.creator ?? { displayName: "Fixture Author" } }),
      description: "Filed for the fixture.",
    },
  };
}

/** A fetched Linear issue, as `get_issue` answers it (keyed by `id`, team display name). */
export function linearTicket(key: string, labels: string[] = [TAG]): Record<string, unknown> {
  return {
    id: key,
    title: `Issue ${key}`,
    labels: [...labels],
    description: "Filed for the fixture.",
    createdBy: "Fixture Author",
    project: "DPT",
    team: "Example Team Display Name",
  };
}

/** A `getJiraIssue` call on `key` (the input names `key`) and its answer. */
export function fetchJira(t: Transcript, key: string, answer: unknown, o: { server?: string; isError?: boolean } = {}): void {
  t.tool(`mcp__${o.server ?? "atlassian"}__getJiraIssue`, { cloudId: CLOUD, issueIdOrKey: key }, answer, o.isError ?? false);
}

/** The Epic edit input the gate permits: description and/or summary only. */
export const editInput = (key: string, fields: Record<string, unknown> = { description: "A clearer milestone description." }, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  cloudId: CLOUD,
  issueIdOrKey: key,
  fields,
  ...extra,
});

// ------------------------------------------------- the Epic edit legs (gate)

/** A recorded permitted epic_edit run in `w`, announced in a fresh transcript. */
export function editedTranscript(pluginRoot: string, w: World, key = EPIC): { t: Transcript; run: ModuleRun } {
  const run = runEpicEdit(pluginRoot, w, key);
  const problem = epicEditPermitProblem(run, w, key);
  if (problem !== null) throw new Error(`fixture: epic_edit.ts did not permit (${problem}):\n${show(run)}`);
  const t = new Transcript();
  t.run(run);
  return { t, run };
}

export type Expect = "permit" | "refuse";

export interface GateLeg {
  name: string;
  expect: Expect;
  run: (pluginRoot: string) => Promise<Run>;
}

/**
 * AC-STE-729.3 / .4 / .9 — the Epic edit legs: one permit leg and twins, each
 * differing from the permit leg in ONE condition of AC-STE-729.3 (or one
 * forbidden shape of AC-STE-729.4).
 */
export function epicEditLegs(): GateLeg[] {
  const edit = (input: Record<string, unknown>, build: (pluginRoot: string, w: World) => Transcript, tool = "editJiraIssue") => async (pluginRoot: string) => {
    const w = makeWorld();
    return gate(pluginRoot, JIRA(tool), input, build(pluginRoot, w), w.root);
  };
  const consented = (pluginRoot: string, w: World): Transcript => {
    const { t } = editedTranscript(pluginRoot, w);
    askEdit(t, EPIC, EDIT_LABEL(EPIC));
    return t;
  };
  const legs: GateLeg[] = [
    { name: "PERMIT — description only, after the epic-edit receipt and the answer `Edit PROJ-500`", expect: "permit", run: edit(editInput(EPIC), consented) },
    { name: "PERMIT — summary only", expect: "permit", run: edit(editInput(EPIC, { summary: "Renamed milestone" }), consented) },
    { name: "PERMIT — description and summary, with contentFormat and responseContentFormat", expect: "permit", run: edit(editInput(EPIC, { description: "Body", summary: "Title" }, { contentFormat: "markdown", responseContentFormat: "markdown" }), consented) },
    {
      name: "PERMIT — the plan tracked at specs/plan/archive/",
      expect: "permit",
      run: async (pluginRoot) => {
        const w = makeWorld({ archived: true });
        return gate(pluginRoot, JIRA("editJiraIssue"), editInput(EPIC), consented(pluginRoot, w), w.root);
      },
    },
    // ---- receipt conditions
    {
      name: "TWIN (receipt) — the answer is recorded but no epic_edit.ts run is in the transcript",
      expect: "refuse",
      run: edit(editInput(EPIC), () => {
        const t = new Transcript();
        askEdit(t, EPIC, EDIT_LABEL(EPIC));
        return t;
      }),
    },
    {
      name: "TWIN (receipt) — the receipt file rewritten after its announcement (not intact)",
      expect: "refuse",
      run: edit(editInput(EPIC), (pluginRoot, w) => {
        const { t, run } = editedTranscript(pluginRoot, w);
        askEdit(t, EPIC, EDIT_LABEL(EPIC));
        const p = announcedPath(run);
        writeFileSync(p, readFileSync(p, "utf-8").replace(/\n$/, " \n"));
        return t;
      }),
    },
    {
      name: "TWIN (receipt) — the receipt announced by an `echo` of its own line, not a run of epic_edit.ts",
      expect: "refuse",
      run: edit(editInput(EPIC), (pluginRoot, w) => {
        const { run } = editedTranscript(pluginRoot, w);
        const t = new Transcript();
        const line = announcementLines(run.stdout)[0]!;
        t.bash(`echo "${line}"`, run.stdout.trimEnd());
        askEdit(t, EPIC, EDIT_LABEL(EPIC));
        return t;
      }),
    },
    {
      name: "TWIN (receipt) — the epic-edit receipt announced by a registered module that does not write it (epic_close.ts)",
      expect: "refuse",
      run: edit(editInput(EPIC), (pluginRoot, w) => {
        const { run } = editedTranscript(pluginRoot, w);
        const t = new Transcript();
        t.bash(`bun run "${join(pluginRoot, moduleRel("epic_close.ts"))}" ${w.root} ${EPIC} --children ${join(w.scratch, "children.json")}`, run.stdout.trimEnd());
        askEdit(t, EPIC, EDIT_LABEL(EPIC));
        return t;
      }),
    },
    {
      name: "TWIN (receipt) — the receipt was written by another session",
      expect: "refuse",
      run: edit(editInput(EPIC), (pluginRoot, w) => {
        const run = runEpicEdit(pluginRoot, w, EPIC, OTHER_SESSION);
        const problem = epicEditPermitProblem(run, w, EPIC, OTHER_SESSION);
        if (problem !== null) throw new Error(`fixture: other-session epic_edit.ts did not permit (${problem}):\n${show(run)}`);
        const t = new Transcript();
        t.run(run);
        askEdit(t, EPIC, EDIT_LABEL(EPIC));
        return t;
      }),
    },
    {
      name: "TWIN (receipt) — the receipt names another Epic (PROJ-501), the edit is on PROJ-500",
      expect: "refuse",
      run: edit(editInput(EPIC), (pluginRoot, w) => {
        // The same repository also plans M_PROJ_501, so epic_edit.ts permits PROJ-501 there.
        addPlan(w, OTHER_EPIC);
        const { t } = editedTranscript(pluginRoot, w, OTHER_EPIC);
        askEdit(t, EPIC, EDIT_LABEL(EPIC));
        return t;
      }),
    },
    {
      name: "TWIN (receipt) — the receipt announced by epic_edit.ts run in ANOTHER declared root (project OTHR, tag demo-fe), not PROJ-500's target root",
      expect: "refuse",
      run: async (pluginRoot) => {
        // The write's cwd is the PROJ repository; the receipt comes from a second
        // shared repository that also plans (and minted) M_PROJ_500 but declares
        // project OTHR, so it is a declared root yet never PROJ-500's target root.
        const w = makeWorld();
        const other = makeWorld({ project: "OTHR", tag: SIBLING_TAG });
        const t = consented(pluginRoot, other);
        return gate(pluginRoot, JIRA("editJiraIssue"), editInput(EPIC), t, w.root);
      },
    },
    // ---- consent conditions
    {
      name: "TWIN (consent) — no AskUserQuestion answer after the receipt",
      expect: "refuse",
      run: edit(editInput(EPIC), (pluginRoot, w) => editedTranscript(pluginRoot, w).t),
    },
    {
      name: "TWIN (consent) — the answer is `Skip PROJ-500`",
      expect: "refuse",
      run: edit(editInput(EPIC), (pluginRoot, w) => {
        const { t } = editedTranscript(pluginRoot, w);
        askEdit(t, EPIC, SKIP_LABEL(EPIC));
        return t;
      }),
    },
    {
      name: "TWIN (consent) — the answer `Edit PROJ-500` was recorded BEFORE the receipt's announcement",
      expect: "refuse",
      run: edit(editInput(EPIC), (pluginRoot, w) => {
        const t = new Transcript();
        askEdit(t, EPIC, EDIT_LABEL(EPIC));
        const run = runEpicEdit(pluginRoot, w);
        if (epicEditPermitProblem(run, w) !== null) throw new Error(`fixture: epic_edit.ts did not permit:\n${show(run)}`);
        t.run(run);
        return t;
      }),
    },
    {
      name: "TWIN (consent) — `Edit PROJ-500` later answered `Skip PROJ-500` before the call",
      expect: "refuse",
      run: edit(editInput(EPIC), (pluginRoot, w) => {
        const { t } = editedTranscript(pluginRoot, w);
        askEdit(t, EPIC, EDIT_LABEL(EPIC));
        askEdit(t, EPIC, SKIP_LABEL(EPIC));
        return t;
      }),
    },
    {
      name: "TWIN (consent) — `Edit PROJ-500` later followed by a DIFFERENT question naming PROJ-500, answered `Leave PROJ-500 as is`",
      expect: "refuse",
      run: edit(editInput(EPIC), (pluginRoot, w) => {
        const { t } = editedTranscript(pluginRoot, w);
        askEdit(t, EPIC, EDIT_LABEL(EPIC));
        t.ask(`Keep the current text of Epic ${EPIC} after all?`, [`Leave ${EPIC} as is`, "Cancel"], `Leave ${EPIC} as is`);
        return t;
      }),
    },
    {
      name: "TWIN (consent) — the answer names another key (`Edit PROJ-501`)",
      expect: "refuse",
      run: edit(editInput(EPIC), (pluginRoot, w) => {
        const { t } = editedTranscript(pluginRoot, w);
        t.ask(`Edit the description or summary of Epic ${OTHER_EPIC}?`, [EDIT_LABEL(OTHER_EPIC), SKIP_LABEL(OTHER_EPIC)], EDIT_LABEL(OTHER_EPIC));
        return t;
      }),
    },
    {
      name: "TWIN (consent) — consent written in the operator's prose (`Edit PROJ-500`), not an AskUserQuestion answer",
      expect: "refuse",
      run: edit(editInput(EPIC), (pluginRoot, w) => {
        const { t } = editedTranscript(pluginRoot, w);
        t.prose(EDIT_LABEL(EPIC));
        return t;
      }),
    },
    {
      name: "TWIN (consent) — the AskUserQuestion result is an error (it still carries `Edit PROJ-500`)",
      expect: "refuse",
      run: edit(editInput(EPIC), (pluginRoot, w) => {
        const { t } = editedTranscript(pluginRoot, w);
        askEdit(t, EPIC, EDIT_LABEL(EPIC), { error: true });
        return t;
      }),
    },
    // ---- input conditions (AC-STE-729.3 field restriction, AC-STE-729.4)
    { name: "TWIN (fields) — fields also carries labels", expect: "refuse", run: edit(editInput(EPIC, { description: "Body", labels: [TAG] }), consented) },
    { name: "TWIN (fields) — fields carries labels only", expect: "refuse", run: edit(editInput(EPIC, { labels: [TAG] }), consented) },
    { name: "TWIN (fields) — fields also carries parent", expect: "refuse", run: edit(editInput(EPIC, { summary: "Title", parent: { key: OTHER_EPIC } }), consented) },
    { name: "TWIN (fields) — fields also carries issuetype", expect: "refuse", run: edit(editInput(EPIC, { summary: "Title", issuetype: { name: "Task" } }), consented) },
    { name: "TWIN (fields) — fields also carries another field (assignee)", expect: "refuse", run: edit(editInput(EPIC, { description: "Body", assignee: { accountId: "fixture-account" } }), consented) },
    { name: "TWIN (fields) — fields is empty", expect: "refuse", run: edit(editInput(EPIC, {}), consented) },
    { name: "TWIN (input) — the input also carries an `update` block", expect: "refuse", run: edit(editInput(EPIC, { description: "Body" }, { update: { labels: [{ add: "x" }] } }), consented) },
    { name: "TWIN (input) — the input also carries another top-level key (notifyUsers)", expect: "refuse", run: edit(editInput(EPIC, { description: "Body" }, { notifyUsers: false }), consented) },
    // ---- other writes with the receipt and the answer present (AC-STE-729.4)
    { name: "FORBID — a transition on PROJ-500 (the epic_close.ts route is unchanged)", expect: "refuse", run: edit({ cloudId: CLOUD, issueIdOrKey: EPIC, transition: { id: "41" } }, consented, "transitionJiraIssue") },
    { name: "FORBID — a comment on PROJ-500", expect: "refuse", run: edit({ cloudId: CLOUD, issueIdOrKey: EPIC, commentBody: "Note." }, consented, "addCommentToJiraIssue") },
    { name: "FORBID — the same edit on ANOTHER key (PROJ-501)", expect: "refuse", run: edit(editInput(OTHER_EPIC), consented) },
  ];
  return legs;
}

/** Plan (and commit) `key`'s milestone M_<key> in `w` too — a milestone this repository minted. */
export function addPlan(w: World, key: string): void {
  const m = milestoneIdFromEpicKey(key);
  writeFileSync(join(w.root, "specs", "plan", `${m}.md`), planText(m, "active", "minted"));
  commitAll(w.root, `fixture: plan ${m}`);
}

// ------------------------------------------ the fetched-ticket legs (gate)

/**
 * AC-STE-729.5 / .6 / .9 — the transcript route: a write on a non-Epic ticket
 * no tracked FR binds, permitted by the newest non-error get-ticket answer in
 * this session when `decideTicketOwnership` reads it `owned` (or `unowned` after
 * `Adopt <KEY>`). Every twin differs from its permit leg in one condition.
 */
export function fetchedTicketLegs(): GateLeg[] {
  const summaryEdit = editInput(TICKET, { summary: "Retitled" });
  const jira = (build: (t: Transcript) => void, input: Record<string, unknown> = summaryEdit, tool = "editJiraIssue") => async (pluginRoot: string) => {
    const w = makeWorld();
    const t = new Transcript();
    build(t);
    return gate(pluginRoot, JIRA(tool), input, t, w.root);
  };
  return [
    { name: "PERMIT — getJiraIssue on PROJ-510 answered with this repository's tag (owned) → the edit", expect: "permit", run: jira((t) => fetchJira(t, TICKET, jiraTicket(TICKET))) },
    { name: "PERMIT — the same fetch under the claude_ai_Atlassian server name", expect: "permit", run: jira((t) => fetchJira(t, TICKET, jiraTicket(TICKET), { server: "claude_ai_Atlassian" })) },
    { name: "PERMIT — an owned fetch permits a status transition too", expect: "permit", run: jira((t) => fetchJira(t, TICKET, jiraTicket(TICKET)), { cloudId: CLOUD, issueIdOrKey: TICKET, transition: { id: "31" } }, "transitionJiraIssue") },
    {
      name: "PERMIT — Linear: get_issue on STE-510 answered with this repository's tag → save_issue",
      expect: "permit",
      run: async (pluginRoot) => {
        const w = makeWorld({ linear: true });
        const t = new Transcript();
        t.tool(LINEAR("get_issue"), { id: LINEAR_TICKET }, linearTicket(LINEAR_TICKET));
        return gate(pluginRoot, LINEAR("save_issue"), { id: LINEAR_TICKET, title: "Retitled" }, t, w.root);
      },
    },
    {
      name: "TWIN (tool name) — Linear: the same answer from a Bash command → refused",
      expect: "refuse",
      run: async (pluginRoot) => {
        const w = makeWorld({ linear: true });
        const t = new Transcript();
        t.bash(`cat ${join(w.scratch, "issue.json")}`, JSON.stringify(linearTicket(LINEAR_TICKET)));
        return gate(pluginRoot, LINEAR("save_issue"), { id: LINEAR_TICKET, title: "Retitled" }, t, w.root);
      },
    },
    { name: "CONTROL — no fetch at all → refused (as at v3.3.0)", expect: "refuse", run: jira(() => {}) },
    // ---- tool-name rule
    { name: "TWIN (tool name) — the same answer echoed by Bash → refused", expect: "refuse", run: jira((t) => t.bash(`echo '${JSON.stringify(jiraTicket(TICKET))}'`, JSON.stringify(jiraTicket(TICKET)))) },
    {
      name: "TWIN (tool name) — the same answer returned by Read of a ticket file → refused",
      expect: "refuse",
      run: jira((t) => t.tool("Read", { file_path: "/fixture/ticket.json" }, jiraTicket(TICKET))),
    },
    {
      name: "TWIN (tool name) — the same answer returned by searchJiraIssuesUsingJql (not a get-ticket call) → refused",
      expect: "refuse",
      run: jira((t) => t.tool(JIRA("searchJiraIssuesUsingJql"), { cloudId: CLOUD, jql: `key = ${TICKET}` }, jiraTicket(TICKET))),
    },
    // ---- error rule
    { name: "TWIN (error) — the getJiraIssue result is an error → refused", expect: "refuse", run: jira((t) => fetchJira(t, TICKET, jiraTicket(TICKET), { isError: true })) },
    {
      name: "PERMIT TWIN (error) — an owned answer followed by a newer ERROR result for PROJ-510 still permits (the newest NON-error result governs)",
      expect: "permit",
      run: jira((t) => {
        fetchJira(t, TICKET, jiraTicket(TICKET));
        fetchJira(t, TICKET, "Jira 503: service unavailable", { isError: true });
      }),
    },
    // ---- key rule
    { name: "TWIN (key) — the answer reads as another key (PROJ-511) → refused", expect: "refuse", run: jira((t) => fetchJira(t, TICKET, jiraTicket(OTHER_TICKET))) },
    { name: "TWIN (key) — the call fetched PROJ-511 (and its answer reads PROJ-511), the write is on PROJ-510 → refused", expect: "refuse", run: jira((t) => fetchJira(t, OTHER_TICKET, jiraTicket(OTHER_TICKET))) },
    // ---- verdict rule
    { name: "TWIN (verdict) — foreign-repo: the answer carries the sibling's tag demo-fe → refused", expect: "refuse", run: jira((t) => fetchJira(t, TICKET, jiraTicket(TICKET, { labels: [SIBLING_TAG] }))) },
    { name: "TWIN (verdict) — foreign-project: the answer's project is OTHER → refused", expect: "refuse", run: jira((t) => fetchJira(t, TICKET, jiraTicket(TICKET, { project: "OTHER" }))) },
    { name: "TWIN (verdict) — container: the answer is an Epic → refused", expect: "refuse", run: jira((t) => fetchJira(t, TICKET, jiraTicket(TICKET, { type: "Epic" }))) },
    { name: "TWIN (shape) — the answer carries this repository's tag but no fields.creator → refused", expect: "refuse", run: jira((t) => fetchJira(t, TICKET, jiraTicket(TICKET, { creator: null }))) },
    { name: "TWIN (verdict) — unowned: the answer carries no repository tag, no Adopt answer → refused", expect: "refuse", run: jira((t) => fetchJira(t, TICKET, jiraTicket(TICKET, { labels: [] }))) },
    {
      name: "PERMIT TWIN (verdict) — unowned, then the operator answered `Adopt PROJ-510` → permitted",
      expect: "permit",
      run: jira((t) => {
        fetchJira(t, TICKET, jiraTicket(TICKET, { labels: [] }));
        askAdopt(t, TICKET, `Adopt ${TICKET}`);
      }),
    },
    {
      name: "TWIN (verdict) — unowned, the operator answered `Skip PROJ-510` → refused",
      expect: "refuse",
      run: jira((t) => {
        fetchJira(t, TICKET, jiraTicket(TICKET, { labels: [] }));
        askAdopt(t, TICKET, `Skip ${TICKET}`);
      }),
    },
    {
      name: "TWIN (verdict) — unowned, `Adopt PROJ-510` written in prose, not an AskUserQuestion answer → refused",
      expect: "refuse",
      run: jira((t) => {
        fetchJira(t, TICKET, jiraTicket(TICKET, { labels: [] }));
        t.prose(`Adopt ${TICKET}`);
      }),
    },
    // ---- newest-result rule
    {
      name: "TWIN (newest) — an older owned answer superseded by a newer foreign-repo answer for PROJ-510 → refused",
      expect: "refuse",
      run: jira((t) => {
        fetchJira(t, TICKET, jiraTicket(TICKET));
        fetchJira(t, TICKET, jiraTicket(TICKET, { labels: [SIBLING_TAG] }));
      }),
    },
    {
      name: "PERMIT TWIN (newest) — an older foreign-repo answer superseded by a newer owned answer → permitted",
      expect: "permit",
      run: jira((t) => {
        fetchJira(t, TICKET, jiraTicket(TICKET, { labels: [SIBLING_TAG] }));
        fetchJira(t, TICKET, jiraTicket(TICKET));
      }),
    },
  ];
}

// ------------------------------------------------------------ grader legs

export interface Finding {
  code: string;
  session?: string;
  item?: string;
  detail?: string;
}
interface GraderModule {
  gradeBundle: (b: LiveBundle, o: { behaviourDigestNow: string }) => { findings: Finding[] };
  RECEIPT_WRITERS: Readonly<Record<string, { module: string; subcommand: string | null }>>;
}
export const loadGrader = async (pluginRoot: string): Promise<GraderModule> => (await import(join(pluginRoot, graderRel))) as GraderModule;

const sha256Hex = (s: string): string => new Bun.CryptoHasher("sha256").update(s).digest("hex");

let callSeq = 0;
function appendCall(s: BundleSession, name: string, input: Record<string, unknown>, result: ToolCall["result"]): ToolCall {
  callSeq += 1;
  const c: ToolCall = { ref: `${s.sessionId}:toolu_729_${callSeq}`, at: new Date(Date.parse(s.calls.at(-1)!.at) + 1000).toISOString(), name, input, result, sidechain: false };
  s.calls.push(c);
  return c;
}

const okText = (text: string): ToolCall["result"] => ({ isError: false, text, exitCode: null, items: null, lastPage: null });

export const epicEditCommand = (root: string, key: string): string => `bun run "\${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/${EPIC_EDIT}" <${root}> ${key}`;

/** An `epic-edit` receipt for `key` in `s`'s repository, announced by one Bash run of `command`. */
function appendEpicEdit(b: LiveBundle, s: BundleSession, key: string, command: string): string {
  const path = `<${s.root}>/.dpt/ledger/receipts/${s.sessionId}/epic-edit-${++callSeq}.json`;
  const set = b.repos[s.root].receipts;
  if (!set.readable) throw new Error("fixture: receipts unreadable");
  set.records.push({ path, sessionId: s.sessionId, sha256: sha256Hex(path), kind: "epic-edit", adapter: b.run.tracker, container: null, subject: key, decision: "edit", evidence: { key, milestone: milestoneIdFromEpicKey(key) } });
  const out = `default=forbidden\noptions=${JSON.stringify([EDIT_LABEL(key), SKIP_LABEL(key)])}\ndpt-receipt: ${path} sha256:${sha256Hex(path)}`;
  appendCall(s, "Bash", { command, description: "run" }, { isError: false, text: out, exitCode: 0, items: null, lastPage: null });
  return path;
}

/** An answered AskUserQuestion in the bundle's recorded shape (the harness sentence). */
function appendAsk(s: BundleSession, question: string, labels: string[], answer: string, isError = false): void {
  appendCall(
    s,
    "AskUserQuestion",
    { questions: [{ question, header: "Epic", options: labels.map((label) => ({ label })), multiSelect: false }] },
    { ...okText(`User has answered your questions: "${question}"="${answer}". You can now continue with the user's answers in mind.`), isError },
  );
}

function appendJiraWrite(s: BundleSession, tool: string, input: Record<string, unknown>): ToolCall {
  return appendCall(s, serverPrefix("jira", s.root) + tool, input, { isError: false, text: "", exitCode: null, items: [], lastPage: null });
}

export interface GraderLeg {
  name: string;
  /** "gated": the write draws no ungated-write finding; "ungated": it does. */
  expect: "gated" | "ungated";
  run: (pluginRoot: string) => Promise<{ ungated: boolean; unannounced: boolean }>;
}

type EditStep =
  | { op: "edit"; command?: (root: string, key: string) => string }
  | { op: "ask"; key?: string; answer: string; isError?: boolean; question?: string; labels?: string[] }
  | { op: "write"; tool: string; input: (key: string) => Record<string, unknown> };

async function gradeSteps(pluginRoot: string, steps: EditStep[], keyOffset = 950): Promise<{ ungated: boolean; unannounced: boolean }> {
  const g = await loadGrader(pluginRoot);
  const b = buildPassingBundle("jira");
  const s = b.sessions.find((x) => x.marker === "S13")!;
  const key = `${b.run.container}-${keyOffset}`;
  let receipt = "";
  let write: ToolCall | null = null;
  for (const st of steps) {
    if (st.op === "edit") receipt = appendEpicEdit(b, s, key, (st.command ?? epicEditCommand)(s.root, key));
    else if (st.op === "ask") {
      const k = st.key ?? key;
      const sub = (x: string): string => x.replaceAll("<KEY>", k);
      appendAsk(
        s,
        sub(st.question ?? "Edit the description or summary of Epic <KEY>?"),
        (st.labels ?? ["Edit <KEY>", "Skip <KEY>"]).map(sub),
        st.answer.replace("<KEY>", key),
        st.isError ?? false,
      );
    } else write = appendJiraWrite(s, st.tool, st.input(key));
  }
  if (write === null) throw new Error("fixture: no write step");
  const v = g.gradeBundle(b, { behaviourDigestNow: b.run.behaviourDigest.digest });
  return {
    ungated: v.findings.some((f) => f.code === "ungated-write" && (f.detail ?? "").startsWith(`${write!.ref}:`)),
    unannounced: receipt !== "" && v.findings.some((f) => f.code === "unannounced-receipt" && f.item === receipt),
  };
}

const descEdit = (fields: Record<string, unknown> = { description: "Body" }, extra: Record<string, unknown> = {}) => ({
  op: "write" as const,
  tool: "editJiraIssue",
  input: (k: string) => ({ cloudId: "cloud-dst", issueIdOrKey: k, fields, ...extra }),
});

/** AC-STE-729.8 — the grader's mirror of AC-STE-729.3 / .4. */
export function graderEpicEditLegs(): GraderLeg[] {
  const leg = (name: string, expect: GraderLeg["expect"], steps: EditStep[]): GraderLeg => ({ name, expect, run: (p) => gradeSteps(p, steps) });
  const ask = { op: "ask" as const, answer: "Edit <KEY>" };
  return [
    leg("PERMIT — an epic-edit receipt, the answer `Edit <KEY>`, a description-only edit", "gated", [{ op: "edit" }, ask, descEdit()]),
    leg("PERMIT — a summary-only edit", "gated", [{ op: "edit" }, ask, descEdit({ summary: "Title" })]),
    leg("TWIN (receipt) — the answer with no epic-edit receipt", "ungated", [ask, descEdit()]),
    leg("TWIN (consent) — no answer", "ungated", [{ op: "edit" }, descEdit()]),
    leg("TWIN (consent) — the answer `Skip <KEY>`", "ungated", [{ op: "edit" }, { op: "ask", answer: "Skip <KEY>" }, descEdit()]),
    leg("TWIN (consent) — the answer recorded before the receipt", "ungated", [ask, { op: "edit" }, descEdit()]),
    leg("TWIN (consent) — `Edit <KEY>` later answered `Skip <KEY>`", "ungated", [{ op: "edit" }, ask, { op: "ask", answer: "Skip <KEY>" }, descEdit()]),
    leg("TWIN (consent) — `Edit <KEY>` later followed by a DIFFERENT question naming the key, answered `Leave <KEY> as is`", "ungated", [
      { op: "edit" },
      ask,
      { op: "ask", question: "Keep the current text of Epic <KEY> after all?", labels: ["Leave <KEY> as is", "Cancel"], answer: "Leave <KEY> as is" },
      descEdit(),
    ]),
    leg("TWIN (consent) — the AskUserQuestion result is an error", "ungated", [{ op: "edit" }, { op: "ask", answer: "Edit <KEY>", isError: true }, descEdit()]),
    leg("TWIN (fields) — fields also carries labels", "ungated", [{ op: "edit" }, ask, descEdit({ description: "Body", labels: ["x"] })]),
    leg("TWIN (fields) — fields also carries parent", "ungated", [{ op: "edit" }, ask, descEdit({ summary: "Title", parent: { key: "DST-1" } })]),
    leg("TWIN (fields) — fields is empty", "ungated", [{ op: "edit" }, ask, descEdit({})]),
    leg("TWIN (input) — an `update` block beside fields", "ungated", [{ op: "edit" }, ask, descEdit({ description: "Body" }, { update: { labels: [{ add: "x" }] } })]),
    leg("FORBID — a transition on the key", "ungated", [{ op: "edit" }, ask, { op: "write", tool: "transitionJiraIssue", input: (k) => ({ cloudId: "cloud-dst", issueIdOrKey: k, transition: { id: "41" } }) }]),
    leg("FORBID — the edit on ANOTHER key", "ungated", [{ op: "edit" }, ask, { op: "write", tool: "editJiraIssue", input: (k) => ({ cloudId: "cloud-dst", issueIdOrKey: `${k.slice(0, k.lastIndexOf("-"))}-951`, fields: { description: "Body" } }) }]),
  ];
}

/** The receipt announced by a module that is not its writer: ungated AND unannounced. */
export async function graderEpicEditWrongAnnouncer(pluginRoot: string): Promise<{ ungated: boolean; unannounced: boolean }> {
  return gradeSteps(pluginRoot, [
    { op: "edit", command: (root, k) => `bun run "\${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/epic_close.ts" <${root}> ${k} --children <${root}>/.dpt/tmp/children.json` },
    { op: "ask", answer: "Edit <KEY>" },
    descEdit(),
  ]);
}

interface ItemOpts {
  labels?: (tags: { own: string; sibling: string }) => string[];
  issueType?: string;
  container?: string;
  key?: (k: string) => string;
}

type FetchStep =
  | { op: "fetch"; tool?: string; isError?: boolean; item?: ItemOpts; inputKey?: (k: string) => string }
  | { op: "adopt"; answer: string }
  | { op: "write" };

async function gradeFetch(pluginRoot: string, steps: FetchStep[]): Promise<{ ungated: boolean; unannounced: boolean }> {
  const g = await loadGrader(pluginRoot);
  const b = buildPassingBundle("jira");
  const s = b.sessions.find((x) => x.marker === "S13")!;
  const key = `${b.run.container}-960`;
  const own = b.roots[s.root].tag;
  const sibling = b.roots[s.root === "A" ? "B" : "A"].tag;
  let write: ToolCall | null = null;
  for (const st of steps) {
    if (st.op === "fetch") {
      const o = st.item ?? {};
      const item = {
        key: (o.key ?? ((k: string) => k))(key),
        summary: `Ticket ${key}`,
        labels: (o.labels ?? ((t) => [t.own]))({ own, sibling }),
        status: "To Do",
        parent: null,
        milestone: null,
        issueType: o.issueType ?? "Task",
        kind: "issue" as const,
        container: o.container ?? b.run.container,
      };
      const name = st.tool === "Bash" ? "Bash" : serverPrefix("jira", s.root) + (st.tool ?? "getJiraIssue");
      const input = st.tool === "Bash" ? { command: `cat ticket.json`, description: "run" } : { cloudId: "cloud-dst", issueIdOrKey: (st.inputKey ?? ((k: string) => k))(key) };
      appendCall(s, name, input, { isError: st.isError ?? false, text: st.isError ? "Jira 503" : "", exitCode: st.tool === "Bash" ? 0 : null, items: [item], lastPage: null });
    } else if (st.op === "adopt") {
      appendCall(
        s,
        "AskUserQuestion",
        { questions: [{ question: `Adopt ${key} as this repository's ticket?`, header: "Adopt", options: [{ label: `Adopt ${key}` }, { label: `Skip ${key}` }], multiSelect: false }] },
        okText(`User has answered your questions: "Adopt ${key} as this repository's ticket?"="${st.answer.replace("<KEY>", key)}". You can now continue with the user's answers in mind.`),
      );
    } else {
      write = appendJiraWrite(s, "editJiraIssue", { cloudId: "cloud-dst", issueIdOrKey: key, fields: { summary: "Retitled" } });
    }
  }
  if (write === null) throw new Error("fixture: no write step");
  const v = g.gradeBundle(b, { behaviourDigestNow: b.run.behaviourDigest.digest });
  return { ungated: v.findings.some((f) => f.code === "ungated-write" && (f.detail ?? "").startsWith(`${write!.ref}:`)), unannounced: false };
}

/** AC-STE-729.8 — the grader's mirror of AC-STE-729.5 / .6. */
export function graderFetchLegs(): GraderLeg[] {
  const leg = (name: string, expect: GraderLeg["expect"], steps: FetchStep[]): GraderLeg => ({ name, expect, run: (p) => gradeFetch(p, steps) });
  const W = { op: "write" as const };
  return [
    leg("PERMIT — a getJiraIssue answer on the key carrying this root's tag, then the write", "gated", [{ op: "fetch" }, W]),
    leg("CONTROL — no fetch", "ungated", [W]),
    leg("TWIN (tool name) — the same item from a Bash call", "ungated", [{ op: "fetch", tool: "Bash" }, W]),
    leg("TWIN (tool name) — the same item from searchJiraIssuesUsingJql", "ungated", [{ op: "fetch", tool: "searchJiraIssuesUsingJql" }, W]),
    leg("TWIN (error) — the getJiraIssue result is an error", "ungated", [{ op: "fetch", isError: true }, W]),
    leg("TWIN (key) — the answer reads as another key", "ungated", [{ op: "fetch", item: { key: (k) => `${k.slice(0, k.lastIndexOf("-"))}-961` } }, W]),
    leg("TWIN (verdict) — foreign-repo: the sibling root's tag", "ungated", [{ op: "fetch", item: { labels: (t) => [t.sibling] } }, W]),
    leg("TWIN (verdict) — container: an Epic", "ungated", [{ op: "fetch", item: { issueType: "Epic" } }, W]),
    leg("TWIN (verdict) — foreign-project: another container", "ungated", [{ op: "fetch", item: { container: "ZZZ" } }, W]),
    leg("TWIN (verdict) — unowned, no Adopt answer", "ungated", [{ op: "fetch", item: { labels: () => [] } }, W]),
    leg("PERMIT TWIN (verdict) — unowned, then `Adopt <KEY>`", "gated", [{ op: "fetch", item: { labels: () => [] } }, { op: "adopt", answer: "Adopt <KEY>" }, W]),
    leg("TWIN (newest) — an owned answer superseded by a newer foreign-repo answer", "ungated", [{ op: "fetch" }, { op: "fetch", item: { labels: (t) => [t.sibling] } }, W]),
    leg("PERMIT TWIN (newest) — a foreign-repo answer superseded by a newer owned answer", "gated", [{ op: "fetch", item: { labels: (t) => [t.sibling] } }, { op: "fetch" }, W]),
  ];
}
