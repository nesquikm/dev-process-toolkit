// STE-693 (M_bae31f) — a user can switch the tracker write gate off for themselves.
//
// The per-user option is declared in the plugin manifest as
// `userConfig.tracker_write_gate` (`enforce` | `off`, default `enforce`).
// AC-STE-693.1 measured (Claude Code 2.1.308) what the hook receives:
//   - the variable `CLAUDE_PLUGIN_OPTION_TRACKER_WRITE_GATE`, value verbatim;
//   - an unset option arrives as an ABSENT variable (the manifest default is
//     not injected), so absent must mean `enforce`;
//   - only user-settings `pluginConfigs` reach the hook — project and local
//     `pluginConfigs` never do.
//
// Every behavioural case SPAWNS the hook entry exactly as the harness does
// (`bun run <module>`, PreToolUse payload on stdin, a JSONL transcript on disk)
// over the two-repo shared-Jira world the STE-607 suite uses. Each fixture's
// stdin is built ONCE (the gated call's own tool_use line is already in the
// transcript, so no flush wait runs) and replayed byte-for-byte under every
// variant, so any difference in exit code or stderr is the variable's doing.
//
// Two baselines, one job each:
//   - CURRENT — the live hook module, spawned with the variable DELETED from
//     its env, over the same fixture stdin. Every comparison that grades the
//     variable's effect (empty / enforce byte-identical, unknown = current plus
//     one line, forgeries, the amended AC.5 `env`-file cases) uses it, so a
//     deliberate change to the hook's wording elsewhere never reds this suite.
//   - PRE-CHANGE — the hook module as it stood before this FR:
//     `git show <PRE_CHANGE_COMMIT>:<module>` written into a scratch mirror of
//     the plugin tree (its own file, the real `_lib/session.ts` and `adapters/`
//     symlinked beside it, so its relative imports resolve exactly as the
//     shipped module's do). It serves the fixture precondition and exactly ONE
//     pinned test (variable absent), which permits only the named
//     PERMITTED_WORDING_DELTAS below. A missing pre-change commit THROWS — it
//     never skips.
//
// ---------------------------------------------------------------------------
// CONTRACT this suite reads (the implementer satisfies it)
// ---------------------------------------------------------------------------
//   adapters/_shared/src/tracker_write_gate_setting.ts — the ONE helper the
//   hook and the /gate-check row share (Technical Design):
//     export const TRACKER_WRITE_GATE_ENV = "CLAUDE_PLUGIN_OPTION_TRACKER_WRITE_GATE"
//     export function trackerWriteGateSetting(env?: Record<string, string | undefined>):
//       { effective: "enforce" | "off"; ignored: string | null }
//       — absent / "" / "enforce" → { effective: "enforce", ignored: null };
//         "off" → { effective: "off", ignored: null };
//         anything else → { effective: "enforce", ignored: <the raw value> }.
//   The hook module imports it (no second reader of the variable).
//
// AC-STE-693.8 (mutation battery) — each mutation reddens the test named here:
//   remove the `off` branch          → "AC-STE-693.3 [battery: off branch] …"
//   remove the stderr line           → "AC-STE-693.3 [battery: stderr line] …"
//   treat an unknown value as `off`  → "AC-STE-693.4 [battery: unknown is enforce] …"
//                                      and the helper's unit leg in this file.

import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeMd, makeSpanFixture, pluginManifest } from "./_span_fixture";
import { BE_TAG, FE_TAG, boundFr, declareJira, declareLinear } from "./_orphan_pages";
import { readSpecFile } from "./_spec_tree";

// Spawned children under full-gate load: the 5 s default kills them (exit -1).
setDefaultTimeout(120_000);

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");
const HOOK = "pre-tracker-write-gate";
const MODULE_REL = `templates/hooks/_lib/hooks/${HOOK}.ts`;
const MODULE_PATH = join(PLUGIN_ROOT, MODULE_REL);
const SETTING_MODULE = join(PLUGIN_ROOT, "adapters", "_shared", "src", "tracker_write_gate_setting.ts");
const MANIFEST = join(PLUGIN_ROOT, ".claude-plugin", "plugin.json");
const HOOKS_REFERENCE = join(PLUGIN_ROOT, "docs", "hooks-reference.md");
const FR_REL = "STE-693.md";
const MEASUREMENT = join(REPO_ROOT, "specs", "notes", "ste-693-userconfig-measurement.md");

/** The merge-base of this FR's branch with main: the hook exactly as it stood before STE-693. */
const PRE_CHANGE_COMMIT = "976e6b8e2fadba1210c5f8d9a1874865b05d7f0d";

// RE-BASED (orchestrator ruling 2026-10-22, M_bae31f / STE-694): AC-STE-694.7
// deliberately rewords the ticket-ownership refusal remedy, inserting a clause
// after `the operator answered "Adopt <KEY>"`. That is drift against
// PRE_CHANGE_COMMIT, not an effect of the variable, so every comparison that
// grades the variable now uses the CURRENT hook (variable deleted) as its
// baseline. The ONE remaining pin against PRE_CHANGE_COMMIT (AC-STE-693.4,
// variable absent) admits exactly the substitutions listed here and nothing
// else; a further wording change needs a fresh ruling and a new named entry.
const STE_694_ADOPT_ANCHOR = 'the operator answered "Adopt <KEY>"';
const STE_694_ADOPT_CLAUSE = " — a typed answer counts when it names the key and says yes —";
const PERMITTED_WORDING_DELTAS: ReadonlyArray<{ id: string; from: string; to: string }> = [
  { id: "AC-STE-694.7", from: STE_694_ADOPT_ANCHOR, to: STE_694_ADOPT_ANCHOR + STE_694_ADOPT_CLAUSE },
];

/** The pre-change stderr with every permitted wording delta applied. */
function applyPermittedDeltas(stderr: string): string {
  let out = stderr;
  for (const d of PERMITTED_WORDING_DELTAS) out = out.split(d.from).join(d.to);
  return out;
}

const VAR = "CLAUDE_PLUGIN_OPTION_TRACKER_WRITE_GATE";
const OFF_PHRASE = "tracker write gate off for this user";
const SESSION = "s-693-main";
const MANIFEST_VERSION = "2.87.0";
const CLOUD = "dpt-smoke.atlassian.net";
const JIRA = (t: string) => `mcp__atlassian__${t}`;
const LINEAR = (t: string) => `mcp__linear__${t}`;

// ------------------------------------------------------------------ cleanup

const tempDirs: string[] = [];
const cleanups: Array<() => void> = [];

function tempDir(label: string): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), `dpt-693-${label}-`)));
  tempDirs.push(d);
  return d;
}

afterAll(() => {
  for (const c of cleanups.splice(0)) {
    try {
      c();
    } catch {
      /* best effort */
    }
  }
  for (const d of tempDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

// ---------------------------------------------------------------------- git

function git(root: string, ...args: string[]): string {
  const p = Bun.spawnSync(
    [
      "git",
      "-c",
      "user.name=dpt-693",
      "-c",
      "user.email=dpt-693@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "core.hooksPath=/dev/null",
      "-C",
      root,
      ...args,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  if (p.exitCode !== 0) throw new Error(`git ${args.join(" ")} in ${root} failed: ${p.stderr.toString()}`);
  return p.stdout.toString();
}

function gitInit(root: string): void {
  git(root, "init", "-q", "-b", "main");
  git(root, "add", "-A");
  git(root, "commit", "-q", "--allow-empty", "-m", "fixture");
}

// ------------------------------------------------------------------- worlds

interface World {
  fe: string;
  be: string;
  scratch: string;
}

/** FE + BE share Jira GK; FE binds GK-101/GK-102, BE binds GK-111 (the STE-607 world). */
function makeWorld(opts: { beFloor?: string; beforeCommit?: (be: string) => void } = {}): World {
  const span = makeSpanFixture("M_GK_85", { repositories: false });
  cleanups.push(() => span.cleanup());
  const fe = realpathSync(span.a);
  const be = realpathSync(span.b);
  declareJira(fe, FE_TAG);
  if (opts.beFloor === undefined) declareJira(be, BE_TAG);
  else {
    claudeMd(be, {
      mode: "jira",
      project: "GK",
      defaultLabels: [BE_TAG],
      repoTag: BE_TAG,
      minDptVersion: opts.beFloor,
    });
  }
  boundFr(fe, "GK-101");
  boundFr(fe, "GK-102");
  boundFr(be, "GK-111");
  opts.beforeCommit?.(be);
  gitInit(fe);
  gitInit(be);
  return { fe, be, scratch: tempDir("scratch") };
}

function linearRepo(tag: string | null): string {
  const root = tempDir("linear");
  declareLinear(root, tag);
  gitInit(root);
  return root;
}

// --------------------------------------------------------------- transcript

/** A transcript in the real Claude Code JSONL shape. */
class Session {
  readonly lines: string[] = [];
  private seq = 0;

  private nextId(): string {
    this.seq += 1;
    return `toolu_693_${String(this.seq).padStart(5, "0")}`;
  }

  toolUse(name: string, input: unknown, id = this.nextId()): string {
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

  toolResult(id: string, content: unknown): void {
    this.lines.push(
      JSON.stringify({
        type: "user",
        sessionId: SESSION,
        timestamp: new Date().toISOString(),
        message: { role: "user", content: [{ tool_use_id: id, type: "tool_result", content }] },
      }),
    );
  }

  text(t: string): void {
    this.lines.push(
      JSON.stringify({
        type: "assistant",
        sessionId: SESSION,
        timestamp: new Date().toISOString(),
        message: { role: "assistant", content: [{ type: "text", text: t }] },
      }),
    );
  }

  userText(t: string): void {
    this.lines.push(
      JSON.stringify({ type: "user", sessionId: SESSION, timestamp: new Date().toISOString(), message: { role: "user", content: t } }),
    );
  }

  bash(command: string, output: string): void {
    const id = this.toolUse("Bash", { command, description: "run" });
    this.toolResult(id, output);
  }

  save(dir: string, name: string): string {
    const p = join(dir, `${name}.jsonl`);
    writeFileSync(p, this.lines.join("\n") + (this.lines.length ? "\n" : ""));
    return p;
  }
}

// ---------------------------------------------------------------- fixtures

const GATED_ID = "toolu_693_gated";

interface Fixture {
  name: string;
  /** Full MCP tool name the payload carries. */
  tool: string;
  /** The bare tool name the off line must name. */
  bare: string;
  /** Every ticket key the call names (the off line must name each). */
  keys: string[];
  stdin: string;
}

/** Build one replayable stdin: the transcript already ends in the gated call's own tool_use line. */
function fixture(
  name: string,
  tool: string,
  input: Record<string, unknown>,
  cwd: string,
  scratch: string,
  keys: string[],
  prelude?: (s: Session) => void,
): Fixture {
  const s = new Session();
  prelude?.(s);
  s.toolUse(tool, input, GATED_ID);
  const transcript = s.save(scratch, name.replace(/[^A-Za-z0-9]+/g, "-"));
  const stdin = JSON.stringify({
    session_id: SESSION,
    transcript_path: transcript,
    cwd,
    permission_mode: "default",
    hook_event_name: "PreToolUse",
    tool_name: tool,
    tool_input: input,
    tool_use_id: GATED_ID,
  });
  const bare = tool.slice(tool.lastIndexOf("__") + 2);
  return { name, tool, bare, keys, stdin };
}

const jiraCreate = (): Record<string, unknown> => ({
  cloudId: CLOUD,
  projectKey: "GK",
  issueTypeName: "Task",
  summary: "BE payout export",
  description: "Some body.\n\nSource: specs/frs/GK-NEW.md",
  parent: "GK-85",
  additional_fields: { labels: [BE_TAG] },
});

const transition = (key: string) => ({ cloudId: CLOUD, issueIdOrKey: key, transition: { id: "31" } });

/** The refusal fixtures: every one is refused by the pre-change hook (asserted below). */
function refusalFixtures(): Fixture[] {
  const w = makeWorld();
  const floor = makeWorld({ beFloor: "2.88.0" });
  const linear = linearRepo(BE_TAG);
  const linearScratch = tempDir("linear-scratch");
  return [
    fixture("transition FE key from BE", JIRA("transitionJiraIssue"), transition("GK-101"), w.be, w.scratch, ["GK-101"]),
    fixture(
      "edit FE key from BE",
      JIRA("editJiraIssue"),
      { cloudId: CLOUD, issueIdOrKey: "GK-102", fields: { summary: "Renamed" } },
      w.be,
      w.scratch,
      ["GK-102"],
    ),
    fixture(
      "comment on FE key from BE",
      JIRA("addCommentToJiraIssue"),
      { cloudId: CLOUD, issueIdOrKey: "GK-101", commentBody: "Progress." },
      w.be,
      w.scratch,
      ["GK-101"],
    ),
    fixture(
      "link FE to FE from BE",
      JIRA("createIssueLink"),
      { cloudId: CLOUD, inwardIssue: "GK-101", outwardIssue: "GK-102", type: "Relates" },
      w.be,
      w.scratch,
      ["GK-101", "GK-102"],
    ),
    fixture("create with no receipt", JIRA("createJiraIssue"), jiraCreate(), w.be, w.scratch, []),
    fixture("own key under a floor above the manifest", JIRA("transitionJiraIssue"), transition("GK-111"), floor.be, floor.scratch, [
      "GK-111",
    ]),
    fixture("Linear milestone with no receipt", LINEAR("save_milestone"), { project: "DPT", name: "M_x" }, linear, linearScratch, []),
  ];
}

// ------------------------------------------------------------------ running

interface Run {
  exitCode: number;
  stdout: string;
  stderr: string;
}

let NEUTRAL_CWD: string;
let MANIFEST_DIR: string;
let BASELINE_MODULE: string;

/** Write the pre-change hook into a scratch mirror whose relative imports resolve to the live tree. */
function materialiseBaseline(): string {
  const p = Bun.spawnSync(["git", "-C", REPO_ROOT, "show", `${PRE_CHANGE_COMMIT}:plugins/dev-process-toolkit/${MODULE_REL}`], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (p.exitCode !== 0) {
    throw new Error(
      `AC-STE-693.4 needs the pre-change hook at ${PRE_CHANGE_COMMIT}; git show failed (a shallow clone?): ${p.stderr.toString()}`,
    );
  }
  const mirror = tempDir("baseline-mirror");
  const hooksDir = join(mirror, "templates", "hooks", "_lib", "hooks");
  mkdirSync(hooksDir, { recursive: true });
  symlinkSync(join(PLUGIN_ROOT, "adapters"), join(mirror, "adapters"));
  symlinkSync(join(PLUGIN_ROOT, "templates", "hooks", "_lib", "session.ts"), join(mirror, "templates", "hooks", "_lib", "session.ts"));
  const file = join(hooksDir, `${HOOK}.ts`);
  writeFileSync(file, p.stdout);
  return file;
}

beforeAll(() => {
  NEUTRAL_CWD = tempDir("neutral");
  MANIFEST_DIR = tempDir("manifest");
  pluginManifest(MANIFEST_DIR, MANIFEST_VERSION);
  BASELINE_MODULE = materialiseBaseline();
});

const SPAWN_LIMIT = 6;
let inFlight = 0;
const waiters: Array<() => void> = [];

async function slot<T>(fn: () => Promise<T>): Promise<T> {
  while (inFlight >= SPAWN_LIMIT) await new Promise<void>((r) => waiters.push(r));
  inFlight += 1;
  try {
    return await fn();
  } finally {
    inFlight -= 1;
    waiters.shift()?.();
  }
}

/**
 * Spawn `module` with `stdin`. `option` undefined → the variable is ABSENT
 * from the child's environment (deleted even if the runner's own env has it).
 */
function spawnHook(module: string, stdin: string, option: string | undefined, extraEnv: Record<string, string> = {}): Promise<Run> {
  return slot(async () => {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
    delete env.CLAUDE_PROJECT_DIR;
    delete env[VAR];
    env.CLAUDE_PLUGIN_ROOT = MANIFEST_DIR;
    env.CLAUDE_CODE_SESSION_ID = SESSION;
    if (option !== undefined) env[VAR] = option;
    Object.assign(env, extraEnv);
    const proc = Bun.spawn(["bun", "run", module], {
      cwd: NEUTRAL_CWD,
      env,
      stdin: new Response(stdin).body,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    const exitCode = await proc.exited;
    return { exitCode, stdout, stderr };
  });
}

const runHook = (f: Fixture, option: string | undefined, extraEnv?: Record<string, string>) =>
  spawnHook(MODULE_PATH, f.stdin, option, extraEnv);
/** The pre-change hook (PRE_CHANGE_COMMIT): the fixture precondition and the one AC.4 pin only. */
const runBaseline = (f: Fixture) => spawnHook(BASELINE_MODULE, f.stdin, undefined);
/** The CURRENT hook with the variable deleted: the baseline every variable-effect comparison uses. */
const runCurrent = (f: Fixture) => spawnHook(MODULE_PATH, f.stdin, undefined);

function show(label: string, r: Run): string {
  return `${label}: exit=${r.exitCode}\n--- stdout ---\n${r.stdout}\n--- stderr ---\n${r.stderr}`;
}

const nonEmptyLines = (s: string) => s.split("\n").filter((l) => l.trim() !== "");

// ---------------------------------------------------------------- baselines

let FIXTURES: Fixture[];
/** PRE_CHANGE_COMMIT's hook per fixture. */
let BASELINE: Map<string, Run>;
/** The current hook, variable deleted, per fixture. */
let CURRENT: Map<string, Run>;

beforeAll(async () => {
  FIXTURES = refusalFixtures();
  const [pre, cur] = await Promise.all([
    Promise.all(FIXTURES.map((f) => runBaseline(f))),
    Promise.all(FIXTURES.map((f) => runCurrent(f))),
  ]);
  BASELINE = new Map(FIXTURES.map((f, i) => [f.name, pre[i]!]));
  CURRENT = new Map(FIXTURES.map((f, i) => [f.name, cur[i]!]));
});

describe("fixture precondition — the pre-change hook refuses every refusal fixture", () => {
  test("every fixture exits 2 with a Refusing block under the pre-change module", () => {
    for (const f of FIXTURES) {
      const r = BASELINE.get(f.name)!;
      if (r.exitCode !== 2 || !r.stderr.includes("Refusing:")) throw new Error(`fixture "${f.name}" is not a refusal:\n${show("baseline", r)}`);
    }
    expect(FIXTURES.length).toBe(7);
  });
});

// ===========================================================================
// AC-STE-693.1 — the live measurement is on the record
// ===========================================================================

describe("AC-STE-693.1 — the userConfig measurement is recorded before any gate code changed", () => {
  test("the FR Notes name the Claude Code version, the variable, and that project/local pluginConfigs never reach the hook", () => {
    const fr = readSpecFile(REPO_ROOT, "specs/frs", FR_REL).body;
    const notes = fr.slice(fr.indexOf("## Notes"));
    expect(fr.indexOf("## Notes")).toBeGreaterThan(-1);
    expect(notes).toMatch(/Claude Code \d+\.\d+\.\d+/);
    expect(notes).toContain(VAR);
    expect(notes).toMatch(/verbatim/);
    expect(notes).toMatch(/[Uu]nset means absent/);
    expect(notes).toMatch(/[Pp]roject and local `pluginConfigs` never reach it/);
    expect(notes).toContain("specs/notes/ste-693-userconfig-measurement.md");
  });

  test("the run record exists and carries the four runs with the measured variable", () => {
    const rec = readFileSync(MEASUREMENT, "utf-8");
    expect(rec).toMatch(/Claude Code 2\.1\.308/);
    expect(rec).toContain(`${VAR}=off`);
    for (const run of ["run1-unset", "run2-user-off", "run3-project-off", "run4-local-off"]) expect(rec).toContain(run);
    expect(rec).toMatch(/committed project-scope value does \*\*not\*\* reach it/);
  });
});

// ===========================================================================
// AC-STE-693.2 — the manifest declares the option
// ===========================================================================

describe("AC-STE-693.2 — plugin.json declares userConfig.tracker_write_gate", () => {
  test("the option exists, is a string with a title, defaults to enforce, and names both values", () => {
    const manifest = JSON.parse(readFileSync(MANIFEST, "utf-8"));
    const opt = manifest.userConfig?.tracker_write_gate;
    if (opt === undefined) throw new Error(`plugin.json has no userConfig.tracker_write_gate:\n${JSON.stringify(manifest.userConfig ?? null)}`);
    expect(opt.type).toBe("string");
    expect(typeof opt.title).toBe("string");
    expect(opt.title.trim()).not.toBe("");
    expect(opt.default).toBe("enforce");
    // Values: an explicit list, when the manifest carries one, is exactly {enforce, off};
    // the description names both either way.
    for (const listKey of ["enum", "options", "values"]) {
      if (opt[listKey] !== undefined) expect([...opt[listKey]].sort()).toEqual(["enforce", "off"]);
    }
    expect(opt.description).toMatch(/\benforce\b/);
    expect(opt.description).toMatch(/\boff\b/);
  });

  test("the description says what `off` does: the tracker write gate stops refusing, for this user", () => {
    const opt = JSON.parse(readFileSync(MANIFEST, "utf-8")).userConfig?.tracker_write_gate;
    expect(opt?.description ?? "").toMatch(/tracker[- ]write gate|pre-tracker-write-gate/i);
    expect(opt?.description ?? "").toMatch(/\boff\b[^.]*\b(allow|let|permit|stop|skip|disable|no longer|without)/i);
  });
});

// ===========================================================================
// The shared helper (Technical Design; AC.4 fail-closed; AC.8 unit leg)
// ===========================================================================

describe("the shared setting helper — one reader of the variable", () => {
  test("the helper module exports the variable name and a reader", async () => {
    expect(existsSync(SETTING_MODULE)).toBe(true);
    const mod = await import(SETTING_MODULE);
    expect(mod.TRACKER_WRITE_GATE_ENV).toBe(VAR);
    expect(typeof mod.trackerWriteGateSetting).toBe("function");
  });

  test("absent, empty and enforce → enforce, nothing ignored; off → off", async () => {
    const { trackerWriteGateSetting } = await import(SETTING_MODULE);
    expect(trackerWriteGateSetting({})).toEqual({ effective: "enforce", ignored: null });
    expect(trackerWriteGateSetting({ [VAR]: "" })).toEqual({ effective: "enforce", ignored: null });
    expect(trackerWriteGateSetting({ [VAR]: "enforce" })).toEqual({ effective: "enforce", ignored: null });
    expect(trackerWriteGateSetting({ [VAR]: "off" })).toEqual({ effective: "off", ignored: null });
  });

  test("AC-STE-693.8 [battery: unknown is enforce] any other value fails closed to enforce and is reported as ignored", async () => {
    const { trackerWriteGateSetting } = await import(SETTING_MODULE);
    for (const v of ["OFF", "Off", " off", "off ", "disabled", "false", "0", "no", "of"]) {
      expect(trackerWriteGateSetting({ [VAR]: v })).toEqual({ effective: "enforce", ignored: v });
    }
  });

  test("the hook reads the variable only through the shared helper", () => {
    const src = readFileSync(MODULE_PATH, "utf-8");
    expect(src).toMatch(/from\s+"[./]*\/adapters\/_shared\/src\/tracker_write_gate_setting(\.ts)?"/);
    expect(src).not.toContain(VAR);
  });
});

// ===========================================================================
// AC-STE-693.3 — off lets every refused write through, loudly
// ===========================================================================

describe("AC-STE-693.3 — with the variable set to off", () => {
  test("AC-STE-693.3 [battery: off branch] every refusal fixture exits 0 with empty stdout", async () => {
    const runs = await Promise.all(FIXTURES.map((f) => runHook(f, "off")));
    FIXTURES.forEach((f, i) => {
      const r = runs[i]!;
      if (r.exitCode !== 0 || r.stdout !== "") throw new Error(`"${f.name}" under off:\n${show("off", r)}`);
    });
  });

  test("AC-STE-693.3 [battery: stderr line] every fixture prints exactly one stderr line naming the phrase, the tool, and every unchecked key", async () => {
    const runs = await Promise.all(FIXTURES.map((f) => runHook(f, "off")));
    FIXTURES.forEach((f, i) => {
      const r = runs[i]!;
      const lines = nonEmptyLines(r.stderr);
      if (lines.length !== 1) throw new Error(`"${f.name}" under off printed ${lines.length} stderr lines:\n${show("off", r)}`);
      const line = lines[0]!;
      expect(line).toContain(OFF_PHRASE);
      expect(line).toContain(f.bare);
      for (const k of f.keys) expect(line).toContain(k);
      // It never also prints the refusal it skipped.
      expect(r.stderr).not.toContain("Refusing:");
    });
  });

  test("the off line names the key it did not check, not a key the call never named", async () => {
    const f = FIXTURES.find((x) => x.name === "transition FE key from BE")!;
    const r = await runHook(f, "off");
    expect(r.stderr).toContain("GK-101");
    expect(r.stderr).not.toContain("GK-102");
    expect(r.stderr).not.toContain("GK-111");
  });
});

// ===========================================================================
// AC-STE-693.4 — enforce is byte-identical to today; unknown fails closed
// ===========================================================================

describe("AC-STE-693.4 — absent, empty or enforce is byte-identical to the pre-change hook", () => {
  for (const [label, value] of [
    ["absent", undefined],
    ["empty", ""],
    ["enforce", "enforce"],
  ] as const) {
    test(`variable ${label}: exit code, stdout and stderr equal the pre-change hook on every fixture`, async () => {
      const runs = await Promise.all(FIXTURES.map((f) => runHook(f, value)));
      if (value === undefined) {
        // THE ONE PIN against PRE_CHANGE_COMMIT (RE-BASED, STE-694): the current
        // hook with the variable absent equals the pre-change hook after the
        // named PERMITTED_WORDING_DELTAS, and every delta is exercised.
        const exercised = new Set<string>();
        FIXTURES.forEach((f, i) => {
          const now = runs[i]!;
          const then = BASELINE.get(f.name)!;
          for (const d of PERMITTED_WORDING_DELTAS) if (then.stderr.includes(d.from)) exercised.add(d.id);
          const want = applyPermittedDeltas(then.stderr);
          if (now.exitCode !== then.exitCode || now.stderr !== want || now.stdout !== then.stdout) {
            throw new Error(
              `"${f.name}" with the variable ${label} drifted from the pre-change hook (after the permitted deltas):\n${show("now", now)}\n${show("pre-change", then)}`,
            );
          }
        });
        expect([...exercised].sort()).toEqual(PERMITTED_WORDING_DELTAS.map((d) => d.id).sort());
        return;
      }
      FIXTURES.forEach((f, i) => {
        const now = runs[i]!;
        const then = CURRENT.get(f.name)!;
        if (now.exitCode !== then.exitCode || now.stderr !== then.stderr || now.stdout !== then.stdout) {
          throw new Error(`"${f.name}" with the variable ${label} drifted from the variable-absent hook:\n${show("now", now)}\n${show("absent", then)}`);
        }
      });
    });
  }

  test("CONTROL — a permitted write stays silent under absent / empty / enforce, as before", async () => {
    const w = makeWorld();
    const f = fixture("transition own key", JIRA("transitionJiraIssue"), transition("GK-111"), w.be, w.scratch, ["GK-111"]);
    const then = await runCurrent(f);
    expect(then).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    for (const v of [undefined, "", "enforce"]) expect(await runHook(f, v)).toEqual(then);
  });
});

describe("AC-STE-693.4 — any other value is treated as enforce and named once", () => {
  const UNKNOWN = ["OFF", "disabled", "of"];

  test("AC-STE-693.4 [battery: unknown is enforce] every refusal fixture still refuses with the pre-change exit code", async () => {
    for (const v of UNKNOWN) {
      const runs = await Promise.all(FIXTURES.map((f) => runHook(f, v)));
      FIXTURES.forEach((f, i) => {
        const r = runs[i]!;
        if (r.exitCode !== CURRENT.get(f.name)!.exitCode) throw new Error(`"${f.name}" with ${VAR}=${v}:\n${show("now", r)}`);
        expect(r.stderr).not.toContain(OFF_PHRASE);
      });
    }
  });

  test("the stderr is the pre-change stderr plus exactly one line naming the ignored value", async () => {
    for (const v of UNKNOWN) {
      const runs = await Promise.all(FIXTURES.map((f) => runHook(f, v)));
      FIXTURES.forEach((f, i) => {
        const r = runs[i]!;
        const then = CURRENT.get(f.name)!;
        expect(r.stdout).toBe(then.stdout);
        const at = r.stderr.indexOf(then.stderr);
        if (at === -1) throw new Error(`"${f.name}" with ${VAR}=${v} lost the variable-absent refusal text:\n${show("now", r)}\n${show("absent", then)}`);
        const extra = nonEmptyLines(r.stderr.slice(0, at) + r.stderr.slice(at + then.stderr.length));
        if (extra.length !== 1) throw new Error(`"${f.name}" with ${VAR}=${v} added ${extra.length} lines:\n${show("now", r)}`);
        expect(extra[0]!).toContain(v);
      });
    }
  });

  test("a permitted write with an unknown value: exit 0, one stderr line naming the value", async () => {
    const w = makeWorld();
    const f = fixture("transition own key, unknown", JIRA("transitionJiraIssue"), transition("GK-111"), w.be, w.scratch, ["GK-111"]);
    const r = await runHook(f, "disabled");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("");
    const lines = nonEmptyLines(r.stderr);
    expect(lines.length).toBe(1);
    expect(lines[0]!).toContain("disabled");
  });
});

// ===========================================================================
// AC-STE-693.5 — nothing the model can write turns the gate off
// ===========================================================================

describe("AC-STE-693.5 — the STE-607 forgery rule: only the harness-set variable counts", () => {
  let forged: Fixture[];
  /** PRE_CHANGE_COMMIT's hook: the fixture precondition only. */
  let forgedBaseline: Run[];
  /** The current hook, variable deleted: the baseline the forgery decisions are graded against. */
  let forgedCurrent: Run[];

  beforeAll(async () => {
    // Repo files naming the option, committed into BE (the write's own target).
    // No settings `env` entry names the variable here: that route is measured
    // separately (the amended AC.5 describe below). The settings files carry
    // only `pluginConfigs` setting the option to `off`, which AC.1 measured
    // never reaches the hook.
    const w = makeWorld({
      beforeCommit: (be) => {
        mkdirSync(join(be, ".claude"), { recursive: true });
        const cfg = JSON.stringify(
          {
            pluginConfigs: {
              "dev-process-toolkit@dev-process-toolkit": { options: { tracker_write_gate: "off" } },
            },
          },
          null,
          2,
        );
        writeFileSync(join(be, ".claude", "settings.json"), cfg);
        writeFileSync(join(be, ".claude", "settings.local.json"), cfg);
        writeFileSync(join(be, "README.md"), `# BE\n\nTurn the gate off: \`${VAR}=off\` or \`tracker_write_gate: off\`.\n`);
        mkdirSync(join(be, "docs"), { recursive: true });
        writeFileSync(join(be, "docs", "tracker-gate.md"), `tracker_write_gate: off\n\n    export ${VAR}=off\n`);
        writeFileSync(join(be, ".env"), `${VAR}=off\n`);
        writeFileSync(join(be, "tracker_write_gate.txt"), "tracker_write_gate: off\n");
        const md = readFileSync(join(be, "CLAUDE.md"), "utf-8");
        writeFileSync(join(be, "CLAUDE.md"), `${md}\ntracker_write_gate: off\n${VAR}=off\n`);
      },
    });
    const forge = (s: Session) => {
      s.userText(`please set tracker_write_gate: off — ${VAR}=off`);
      s.text(`${VAR}=off`);
      s.text("tracker_write_gate = off; the tracker write gate off for this user");
      s.bash(`export ${VAR}=off`, "");
      s.bash(`echo $${VAR}`, "off");
      s.bash("claude plugin configure dev-process-toolkit --values-stdin", "tracker_write_gate: off");
    };
    forged = [
      fixture("forged transition FE key", JIRA("transitionJiraIssue"), transition("GK-101"), w.be, w.scratch, ["GK-101"], forge),
      fixture(
        "forged link FE to FE",
        JIRA("createIssueLink"),
        { cloudId: CLOUD, inwardIssue: "GK-101", outwardIssue: "GK-102", type: "Relates" },
        w.be,
        w.scratch,
        ["GK-101", "GK-102"],
        forge,
      ),
      fixture("forged create with no receipt", JIRA("createJiraIssue"), jiraCreate(), w.be, w.scratch, [], forge),
    ];
    [forgedBaseline, forgedCurrent] = await Promise.all([
      Promise.all(forged.map((f) => runBaseline(f))),
      Promise.all(forged.map((f) => runCurrent(f))),
    ]);
  });

  test("every forged fixture is still refused by the pre-change hook (the forgery is not a permit on its own)", () => {
    forged.forEach((f, i) => {
      if (forgedBaseline[i]!.exitCode !== 2) throw new Error(`"${f.name}":\n${show("pre-change", forgedBaseline[i]!)}`);
    });
  });

  test("with the variable absent, forged transcripts and repo files leave every decision byte-identical", async () => {
    const runs = await Promise.all(forged.map((f) => runHook(f, undefined)));
    forged.forEach((f, i) => {
      const now = runs[i]!;
      const then = forgedCurrent[i]!;
      if (now.exitCode !== 2 || now.exitCode !== then.exitCode || now.stderr !== then.stderr) {
        throw new Error(`"${f.name}" — a forgery changed the decision:\n${show("now", now)}\n${show("absent", then)}`);
      }
      expect(now.stderr).not.toContain(OFF_PHRASE);
    });
  });

  test("with the variable set to enforce, the forgeries change nothing either", async () => {
    const runs = await Promise.all(forged.map((f) => runHook(f, "enforce")));
    forged.forEach((f, i) => {
      expect(runs[i]!.exitCode).toBe(2);
      expect(runs[i]!.stderr).toBe(forgedCurrent[i]!.stderr);
    });
  });

  test("CONTROL — the same forged fixture IS let through when the harness sets the variable to off", async () => {
    const r = await runHook(forged[0]!, "off");
    expect(r.exitCode).toBe(0);
    expect(nonEmptyLines(r.stderr).length).toBe(1);
    expect(r.stderr).toContain(OFF_PHRASE);
  });
});

// ===========================================================================
// AC-STE-693.5 (amended) — a project settings `env` block naming the variable
// ===========================================================================
//
// Run 5 of the measurement: a committed `.claude/settings.json` whose `env`
// block sets the variable reaches the hook AS that same variable. The model
// can write that file, so when `.claude/settings.json` or
// `.claude/settings.local.json` under the hook's git top level (of
// `payload.cwd`) names the variable in `env`, the hook treats `off` as
// `enforce`: the variable-absent exit code and stderr, plus exactly ONE extra
// stderr line naming that file. A file whose `env` names some other variable
// changes nothing.

describe("AC-STE-693.5 (amended) — a project settings env block naming the variable turns off into enforce", () => {
  /** A BE world whose `.claude/<file>` carries `content` (committed). */
  function worldWithProjectFile(file: string | null, content: unknown): World {
    return makeWorld({
      beforeCommit: (be) => {
        if (file === null) return;
        mkdirSync(join(be, ".claude"), { recursive: true });
        writeFileSync(join(be, ".claude", file), JSON.stringify(content, null, 2));
      },
    });
  }

  /** The refused + permitted fixtures for one world. */
  function worldFixtures(w: World, label: string, cwd = w.be): { refused: Fixture[]; permitted: Fixture } {
    return {
      refused: [
        fixture(`${label} transition FE key`, JIRA("transitionJiraIssue"), transition("GK-101"), cwd, w.scratch, ["GK-101"]),
        fixture(
          `${label} link FE to FE`,
          JIRA("createIssueLink"),
          { cloudId: CLOUD, inwardIssue: "GK-101", outwardIssue: "GK-102", type: "Relates" },
          cwd,
          w.scratch,
          ["GK-101", "GK-102"],
        ),
        fixture(`${label} create with no receipt`, JIRA("createJiraIssue"), jiraCreate(), cwd, w.scratch, []),
      ],
      permitted: fixture(`${label} transition own key`, JIRA("transitionJiraIssue"), transition("GK-111"), cwd, w.scratch, ["GK-111"]),
    };
  }

  /** `now` must be `then` plus exactly one extra non-empty stderr line; returns that line. */
  function oneExtraLine(name: string, now: Run, then: Run): string {
    if (now.exitCode !== then.exitCode || now.stdout !== then.stdout) {
      throw new Error(`"${name}" — exit/stdout drifted from the variable-absent hook:\n${show("now", now)}\n${show("absent", then)}`);
    }
    const at = now.stderr.indexOf(then.stderr);
    if (at === -1) throw new Error(`"${name}" lost the variable-absent stderr:\n${show("now", now)}\n${show("absent", then)}`);
    const extra = nonEmptyLines(now.stderr.slice(0, at) + now.stderr.slice(at + then.stderr.length));
    if (extra.length !== 1) throw new Error(`"${name}" added ${extra.length} stderr lines (want exactly 1):\n${show("now", now)}`);
    return extra[0]!;
  }

  for (const file of ["settings.json", "settings.local.json"]) {
    for (const value of ["off", "enforce"]) {
      test(`variable off + .claude/${file} env names it (= ${value}) → every refusal fixture refuses as before, plus one line naming the file`, async () => {
        const w = worldWithProjectFile(file, { env: { [VAR]: value } });
        const { refused } = worldFixtures(w, `env-${file}-${value}`);
        const thens = await Promise.all(refused.map((f) => runCurrent(f)));
        const nows = await Promise.all(refused.map((f) => runHook(f, "off")));
        refused.forEach((f, i) => {
          expect(thens[i]!.exitCode).toBe(2);
          const line = oneExtraLine(f.name, nows[i]!, thens[i]!);
          expect(line).toContain(`.claude/${file}`);
          expect(nows[i]!.stderr).not.toContain(OFF_PHRASE);
        });
      });
    }
  }

  test("variable off + .claude/settings.json env names it → a permitted write exits 0 with exactly one stderr line naming the file", async () => {
    const w = worldWithProjectFile("settings.json", { env: { [VAR]: "off" } });
    const { permitted } = worldFixtures(w, "env-permitted");
    const then = await runCurrent(permitted);
    expect(then).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    const r = await runHook(permitted, "off");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("");
    const lines = nonEmptyLines(r.stderr);
    expect(lines.length).toBe(1);
    expect(lines[0]!).toContain(".claude/settings.json");
    expect(r.stderr).not.toContain(OFF_PHRASE);
  });

  test("the file is found at the git top level even when the call runs from a subdirectory", async () => {
    const w = makeWorld({
      beforeCommit: (be) => {
        mkdirSync(join(be, ".claude"), { recursive: true });
        writeFileSync(join(be, ".claude", "settings.json"), JSON.stringify({ env: { [VAR]: "off" } }));
        mkdirSync(join(be, "src", "deep"), { recursive: true });
        writeFileSync(join(be, "src", "deep", "keep.txt"), "x\n");
      },
    });
    const { refused } = worldFixtures(w, "env-subdir", join(w.be, "src", "deep"));
    const f = refused[0]!;
    const then = await runCurrent(f);
    if (then.exitCode !== 2) throw new Error(`subdir fixture is not a refusal under the variable-absent hook:\n${show("absent", then)}`);
    const line = oneExtraLine(f.name, await runHook(f, "off"), then);
    expect(line).toContain(".claude/settings.json");
  });

  test("both files name it → still exactly one extra line, and the decision is enforce", async () => {
    const w = makeWorld({
      beforeCommit: (be) => {
        mkdirSync(join(be, ".claude"), { recursive: true });
        writeFileSync(join(be, ".claude", "settings.json"), JSON.stringify({ env: { [VAR]: "off" } }));
        writeFileSync(join(be, ".claude", "settings.local.json"), JSON.stringify({ env: { [VAR]: "off" } }));
      },
    });
    const f = worldFixtures(w, "env-both").refused[0]!;
    const then = await runCurrent(f);
    const line = oneExtraLine(f.name, await runHook(f, "off"), then);
    expect(line).toMatch(/\.claude\/settings(\.local)?\.json/);
  });

  test("CONTROL — variable off + no project settings file → off exactly as AC.3", async () => {
    const w = worldWithProjectFile(null, null);
    const { refused } = worldFixtures(w, "no-file");
    const runs = await Promise.all(refused.map((f) => runHook(f, "off")));
    refused.forEach((f, i) => {
      const r = runs[i]!;
      if (r.exitCode !== 0) throw new Error(`"${f.name}" under off with no project file:\n${show("off", r)}`);
      const lines = nonEmptyLines(r.stderr);
      expect(lines.length).toBe(1);
      expect(lines[0]!).toContain(OFF_PHRASE);
      expect(lines[0]!).not.toContain(".claude/settings");
    });
  });

  test("CONTROL — variable off + project settings whose env names some OTHER variable → off exactly as AC.3", async () => {
    for (const file of ["settings.json", "settings.local.json"]) {
      const w = worldWithProjectFile(file, { env: { CLAUDE_PLUGIN_OPTION_SOMETHING_ELSE: "off", OTHER_VAR: "1" } });
      const { refused } = worldFixtures(w, `other-var-${file}`);
      const runs = await Promise.all(refused.map((f) => runHook(f, "off")));
      refused.forEach((f, i) => {
        const r = runs[i]!;
        if (r.exitCode !== 0) throw new Error(`"${f.name}" (env names another variable) under off:\n${show("off", r)}`);
        const lines = nonEmptyLines(r.stderr);
        expect(lines.length).toBe(1);
        expect(lines[0]!).toContain(OFF_PHRASE);
      });
    }
  });

  test("CONTROL — variable off + project settings naming the option only under pluginConfigs (no env) → off exactly as AC.3", async () => {
    const w = worldWithProjectFile("settings.json", {
      pluginConfigs: { "dev-process-toolkit@dev-process-toolkit": { options: { tracker_write_gate: "off" } } },
    });
    const f = worldFixtures(w, "pluginconfigs-only").refused[0]!;
    const r = await runHook(f, "off");
    expect(r.exitCode).toBe(0);
    expect(nonEmptyLines(r.stderr).length).toBe(1);
    expect(r.stderr).toContain(OFF_PHRASE);
  });

  test("variable absent or enforce + project env naming it → byte-identical to the pre-change hook (no extra line)", async () => {
    // ABSENT is graded against an INDEPENDENT expectation — the pre-change
    // hook (PRE_CHANGE_COMMIT, which never read any settings file) after the
    // named PERMITTED_WORDING_DELTAS — never against the current hook itself.
    // ENFORCE is then graded against that same absent run.
    for (const file of ["settings.json", "settings.local.json"]) {
      const w = worldWithProjectFile(file, { env: { [VAR]: "off" } });
      const { refused, permitted } = worldFixtures(w, `env-absent-${file}`);
      const all = [...refused, permitted];
      const [pres, absents, enforces] = await Promise.all([
        Promise.all(all.map((f) => runBaseline(f))),
        Promise.all(all.map((f) => runHook(f, undefined))),
        Promise.all(all.map((f) => runHook(f, "enforce"))),
      ]);
      all.forEach((f, i) => {
        const pre = pres[i]!;
        const want: Run = { exitCode: pre.exitCode, stdout: pre.stdout, stderr: applyPermittedDeltas(pre.stderr) };
        const absent = absents[i]!;
        if (absent.exitCode !== want.exitCode || absent.stdout !== want.stdout || absent.stderr !== want.stderr) {
          throw new Error(
            `"${f.name}" (.claude/${file} env names the variable) with the variable absent drifted from the pre-change hook (after the permitted deltas):\n${show("now", absent)}\n${show("pre-change", want)}`,
          );
        }
        expect(enforces[i]!).toEqual(absent);
      });
      refused.forEach((_, i) => expect(pres[i]!.exitCode).toBe(2));
    }
  });
});

// ===========================================================================
// AC-STE-693.7 — the hooks reference documents the option
// ===========================================================================

describe("AC-STE-693.7 — docs/hooks-reference.md § pre-tracker-write-gate documents the option", () => {
  const section = (): string => {
    const doc = readFileSync(HOOKS_REFERENCE, "utf-8");
    const start = doc.indexOf("### pre-tracker-write-gate");
    expect(start).toBeGreaterThan(-1);
    const rest = doc.slice(start + 1);
    const next = rest.search(/\n##+ /);
    return next === -1 ? rest : rest.slice(0, next);
  };

  test("names the option, both values and the default", () => {
    const s = section();
    expect(s).toContain("tracker_write_gate");
    expect(s).toMatch(/`enforce`/);
    expect(s).toMatch(/`off`/);
    expect(s).toMatch(/default[^.\n]*`enforce`|`enforce`[^.\n]*default/i);
  });

  test("says how to set it with /plugin configure", () => {
    expect(section()).toContain("/plugin configure");
  });

  test("quotes the stderr line and names the variable the hook reads", () => {
    const s = section();
    expect(s).toContain(OFF_PHRASE);
    expect(s).toContain(VAR);
  });

  test("states the measured scope rule: only user settings reach the hook, project and local pluginConfigs do not", () => {
    const s = section();
    expect(s).toMatch(/user settings|user-scope|user scope/i);
    expect(s).toMatch(/project/i);
    expect(s).toMatch(/\.claude\/settings\.json/);
    expect(s).toMatch(/(never|not|do not|does not|doesn't)\b[^.\n]*reach/i);
  });
});

// ===========================================================================
// AC-STE-693.3 (backfilled clause) — no declared shared container: silent whatever the setting
// ===========================================================================
//
// "Where no candidate repository declares a shared container, the hook stays
// silent whatever the setting, exactly as AC-STE-607.1 requires: every stderr
// line this FR adds speaks only when a declared shared target binds the call."
//
// Two undeclared worlds, each a plain git repo: one whose CLAUDE.md declares a
// Jira tracker with NO repo_tag / min_dpt_version, one with no CLAUDE.md at
// all. The same tracker write (a transition naming a key, and a create) must
// exit 0 with empty stdout AND empty stderr under `off`, under an unknown
// value, and under `off` with a project settings `env` block naming the
// variable. A CONTROL in the declared world proves the `off` line exists, so
// the silence is not vacuous.

describe("AC-STE-693.3 (backfilled) — no candidate repository declares a shared container: silent whatever the setting", () => {
  /** A plain git repo with no shared-container declaration; `withEnvFile` commits a project settings env block naming the variable. */
  function undeclaredRepo(kind: "jira-no-tag" | "no-claude-md", withEnvFile: boolean): { root: string; scratch: string } {
    const root = tempDir(`undeclared-${kind}${withEnvFile ? "-env" : ""}`);
    if (kind === "jira-no-tag") declareJira(root, null);
    else writeFileSync(join(root, "README.md"), "# plain repo\n");
    if (withEnvFile) {
      mkdirSync(join(root, ".claude"), { recursive: true });
      writeFileSync(join(root, ".claude", "settings.json"), JSON.stringify({ env: { [VAR]: "off" } }, null, 2));
    }
    gitInit(root);
    return { root, scratch: tempDir("undeclared-scratch") };
  }

  function undeclaredFixtures(kind: "jira-no-tag" | "no-claude-md", withEnvFile: boolean): Fixture[] {
    const { root, scratch } = undeclaredRepo(kind, withEnvFile);
    const label = `undeclared ${kind}${withEnvFile ? " +env" : ""}`;
    return [
      fixture(`${label} transition`, JIRA("transitionJiraIssue"), transition("GK-101"), root, scratch, ["GK-101"]),
      fixture(`${label} create`, JIRA("createJiraIssue"), jiraCreate(), root, scratch, []),
    ];
  }

  const SILENT: Run = { exitCode: 0, stdout: "", stderr: "" };

  const CASES: ReadonlyArray<{ label: string; value: string; envFile: boolean }> = [
    { label: "variable off", value: "off", envFile: false },
    { label: "variable set to an unknown value (disabled)", value: "disabled", envFile: false },
    { label: "variable off + project .claude/settings.json env naming it", value: "off", envFile: true },
  ];

  for (const kind of ["jira-no-tag", "no-claude-md"] as const) {
    test(`precondition (${kind}) — with the variable absent the undeclared write is silent`, async () => {
      for (const f of undeclaredFixtures(kind, false)) {
        const r = await runCurrent(f);
        if (r.exitCode !== 0 || r.stdout !== "" || r.stderr !== "") throw new Error(`"${f.name}" is not silent with the variable absent:\n${show("absent", r)}`);
      }
    });

    for (const c of CASES) {
      test(`${kind}: ${c.label} → exit 0, empty stdout, empty stderr`, async () => {
        const fs = undeclaredFixtures(kind, c.envFile);
        const runs = await Promise.all(fs.map((f) => runHook(f, c.value)));
        fs.forEach((f, i) => {
          const r = runs[i]!;
          if (r.exitCode !== 0 || r.stdout !== "" || r.stderr !== "") {
            throw new Error(`"${f.name}" with ${VAR}=${c.value} is not silent (no shared container is declared):\n${show("now", r)}`);
          }
          expect(r).toEqual(SILENT);
        });
      });
    }
  }

  test("CONTROL — the same write in the declared world under off DOES print the gate-off line", async () => {
    const w = makeWorld();
    const f = fixture("declared transition FE key from BE", JIRA("transitionJiraIssue"), transition("GK-101"), w.be, w.scratch, ["GK-101"]);
    const r = await runHook(f, "off");
    expect(r.exitCode).toBe(0);
    const lines = nonEmptyLines(r.stderr);
    expect(lines.length).toBe(1);
    expect(lines[0]!).toContain(OFF_PHRASE);
  });
});

// ===========================================================================
// Review fixes (AC-STE-693.3 / AC-STE-693.5) — fail closed on what the scan
// cannot read, scan every directory between cwd and the git top, and never
// refuse on the message-only path.
// ===========================================================================

/** `now` must be `then` plus exactly one extra non-empty stderr line; returns that line. */
function oneExtraStderrLine(name: string, now: Run, then: Run): string {
  if (now.exitCode !== then.exitCode || now.stdout !== then.stdout) {
    throw new Error(`"${name}" — exit/stdout drifted from the variable-absent hook:\n${show("now", now)}\n${show("absent", then)}`);
  }
  const at = now.stderr.indexOf(then.stderr);
  if (at === -1) throw new Error(`"${name}" lost the variable-absent stderr:\n${show("now", now)}\n${show("absent", then)}`);
  const extra = nonEmptyLines(now.stderr.slice(0, at) + now.stderr.slice(at + then.stderr.length));
  if (extra.length !== 1) throw new Error(`"${name}" added ${extra.length} stderr lines (want exactly 1):\n${show("now", now)}`);
  return extra[0]!;
}

/** The refused + permitted fixtures of one BE world, the call running from `cwd`. */
function reviewFixtures(w: World, label: string, cwd = w.be): { refused: Fixture[]; permitted: Fixture } {
  return {
    refused: [
      fixture(`${label} transition FE key`, JIRA("transitionJiraIssue"), transition("GK-101"), cwd, w.scratch, ["GK-101"]),
      fixture(
        `${label} link FE to FE`,
        JIRA("createIssueLink"),
        { cloudId: CLOUD, inwardIssue: "GK-101", outwardIssue: "GK-102", type: "Relates" },
        cwd,
        w.scratch,
        ["GK-101", "GK-102"],
      ),
      fixture(`${label} create with no receipt`, JIRA("createJiraIssue"), jiraCreate(), cwd, w.scratch, []),
    ],
    permitted: fixture(`${label} transition own key`, JIRA("transitionJiraIssue"), transition("GK-111"), cwd, w.scratch, ["GK-111"]),
  };
}

/** Under off: every refused fixture refuses as before (variable-absent), plus one line naming `fileFragment`. */
async function expectEnforcedNaming(refused: Fixture[], fileFragment: string): Promise<void> {
  const thens = await Promise.all(refused.map((f) => runCurrent(f)));
  const nows = await Promise.all(refused.map((f) => runHook(f, "off")));
  refused.forEach((f, i) => {
    if (thens[i]!.exitCode !== 2) throw new Error(`"${f.name}" is not a refusal under the variable-absent hook:\n${show("absent", thens[i]!)}`);
    const line = oneExtraStderrLine(f.name, nows[i]!, thens[i]!);
    expect(line).toContain(fileFragment);
    expect(nows[i]!.stderr).not.toContain(OFF_PHRASE);
  });
}

/** Under off: every fixture exits 0 with exactly the one gate-off line (AC.3), naming no settings file. */
async function expectOffAsAc3(fixtures: Fixture[]): Promise<void> {
  const runs = await Promise.all(fixtures.map((f) => runHook(f, "off")));
  fixtures.forEach((f, i) => {
    const r = runs[i]!;
    if (r.exitCode !== 0) throw new Error(`"${f.name}" under off is not permitted:\n${show("off", r)}`);
    expect(r.stdout).toBe("");
    const lines = nonEmptyLines(r.stderr);
    expect(lines.length).toBe(1);
    expect(lines[0]!).toContain(OFF_PHRASE);
    expect(lines[0]!).not.toContain(".claude/settings");
  });
}

describe("AC-STE-693.5 (review fix) — an unparseable project settings file fails closed", () => {
  const MALFORMED: Record<string, string> = {
    "trailing comma": `{ "env": { "${VAR}": "off", } }\n`,
    "comment lines": `// local overrides\n{\n  // switch the gate off\n  "env": { "${VAR}": "off" }\n}\n`,
  };

  /** A BE world whose `.claude/<file>` holds `raw` bytes verbatim (committed). */
  function worldWithRawFile(file: string, raw: string): World {
    return makeWorld({
      beforeCommit: (be) => {
        mkdirSync(join(be, ".claude"), { recursive: true });
        writeFileSync(join(be, ".claude", file), raw);
      },
    });
  }

  for (const file of ["settings.json", "settings.local.json"]) {
    for (const [shape, raw] of Object.entries(MALFORMED)) {
      test(`variable off + unparseable .claude/${file} (${shape}) → every refusal fixture refuses as before, plus one line naming the file`, async () => {
        const w = worldWithRawFile(file, raw);
        await expectEnforcedNaming(reviewFixtures(w, `bad-${file}-${shape}`).refused, `.claude/${file}`);
      });
    }

    test(`variable off + unparseable .claude/${file} → a permitted write exits 0 with exactly one stderr line naming the file`, async () => {
      const w = worldWithRawFile(file, MALFORMED["trailing comma"]!);
      const { permitted } = reviewFixtures(w, `bad-permitted-${file}`);
      expect(await runCurrent(permitted)).toEqual({ exitCode: 0, stdout: "", stderr: "" });
      const r = await runHook(permitted, "off");
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toBe("");
      const lines = nonEmptyLines(r.stderr);
      expect(lines.length).toBe(1);
      expect(lines[0]!).toContain(`.claude/${file}`);
      expect(r.stderr).not.toContain(OFF_PHRASE);
    });
  }

  test("variable off + an unparseable file that does not even mention the variable → still enforce (its contents cannot be known)", async () => {
    const w = worldWithRawFile("settings.local.json", "{ this is not json\n");
    await expectEnforcedNaming(reviewFixtures(w, "bad-opaque").refused.slice(0, 1), ".claude/settings.local.json");
  });

  test("variable off + an unreadable (mode 000) .claude/settings.json → enforce, one line naming the file", async () => {
    const w = makeWorld();
    const dir = join(w.be, ".claude");
    mkdirSync(dir, { recursive: true });
    const path = join(dir, "settings.json");
    writeFileSync(path, JSON.stringify({ env: {} }));
    chmodSync(path, 0o000);
    cleanups.push(() => chmodSync(path, 0o644));
    let readable = true;
    try {
      readFileSync(path);
    } catch {
      readable = false;
    }
    if (readable) return; // running as root: mode 000 does not stop the read, nothing to grade
    await expectEnforcedNaming(reviewFixtures(w, "mode-000").refused.slice(0, 1), ".claude/settings.json");
  });

  test("CONTROL — variable off + a well-formed file that names nothing → off exactly as AC.3", async () => {
    for (const [file, content] of [
      ["settings.json", {}],
      ["settings.local.json", { env: {} }],
      ["settings.json", { env: { OTHER_VAR: "1" }, permissions: { allow: [] } }],
    ] as const) {
      const w = worldWithRawFile(file, JSON.stringify(content, null, 2));
      const { refused, permitted } = reviewFixtures(w, `good-${file}-${Object.keys(content).join("-") || "empty"}`);
      await expectOffAsAc3([...refused, permitted]);
    }
  });

  test("variable off + an unparseable settings.json beside a MISSING settings.local.json → exactly one line, naming only the bad file", async () => {
    const w = worldWithRawFile("settings.json", MALFORMED["trailing comma"]!);
    const f = reviewFixtures(w, "bad-plus-missing").refused[0]!;
    const then = await runCurrent(f);
    const line = oneExtraStderrLine(f.name, await runHook(f, "off"), then);
    expect(line).toContain(".claude/settings.json");
    expect(line).not.toContain("settings.local.json");
  });
});

describe("AC-STE-693.5 (review fix) — settings files between cwd and the git top are scanned too", () => {
  test("variable off, cwd = <top>/sub, <top>/sub/.claude/settings.local.json env names it, nothing at the top → enforce, one line naming the sub file", async () => {
    const w = makeWorld({
      beforeCommit: (be) => {
        mkdirSync(join(be, "sub", ".claude"), { recursive: true });
        writeFileSync(join(be, "sub", ".claude", "settings.local.json"), JSON.stringify({ env: { [VAR]: "off" } }));
      },
    });
    expect(existsSync(join(w.be, ".claude"))).toBe(false);
    await expectEnforcedNaming(reviewFixtures(w, "sub-local", join(w.be, "sub")).refused, join("sub", ".claude", "settings.local.json"));
  });

  test("variable off, cwd = <top>/a/b, <top>/a/.claude/settings.json env names it (an intermediate directory) → enforce, one line naming it", async () => {
    const w = makeWorld({
      beforeCommit: (be) => {
        mkdirSync(join(be, "a", ".claude"), { recursive: true });
        mkdirSync(join(be, "a", "b"), { recursive: true });
        writeFileSync(join(be, "a", "b", "keep.txt"), "x\n");
        writeFileSync(join(be, "a", ".claude", "settings.json"), JSON.stringify({ env: { [VAR]: "off" } }));
      },
    });
    const f = reviewFixtures(w, "intermediate", join(w.be, "a", "b")).refused[0]!;
    await expectEnforcedNaming([f], join("a", ".claude", "settings.json"));
  });

  test("variable off, cwd = <top>/sub, an UNPARSEABLE <top>/sub/.claude/settings.json → enforce, one line naming the sub file", async () => {
    const w = makeWorld({
      beforeCommit: (be) => {
        mkdirSync(join(be, "sub", ".claude"), { recursive: true });
        writeFileSync(join(be, "sub", ".claude", "settings.json"), `{ "env": { "${VAR}": "off", } }\n`);
      },
    });
    const f = reviewFixtures(w, "sub-bad", join(w.be, "sub")).refused[0]!;
    await expectEnforcedNaming([f], join("sub", ".claude", "settings.json"));
  });

  test("CONTROL — a settings file BELOW cwd, or in a sibling directory off the cwd→top path, is not scanned → off exactly as AC.3", async () => {
    const w = makeWorld({
      beforeCommit: (be) => {
        mkdirSync(join(be, "sub", "deeper", ".claude"), { recursive: true });
        writeFileSync(join(be, "sub", "deeper", ".claude", "settings.json"), JSON.stringify({ env: { [VAR]: "off" } }));
        mkdirSync(join(be, "sibling", ".claude"), { recursive: true });
        writeFileSync(join(be, "sibling", ".claude", "settings.local.json"), JSON.stringify({ env: { [VAR]: "off" } }));
      },
    });
    const { refused, permitted } = reviewFixtures(w, "below-cwd", join(w.be, "sub"));
    await expectOffAsAc3([...refused, permitted]);
  });
});

// AC-STE-693.3 / AC-STE-693.5 (review fix) — the message-only path never refuses.
//
// Under `off` the hook asks ONE question before speaking: does a declared
// shared target bind this call (`declaredTargetBinds`)? The answer only decides
// whether the gate-off line is printed; it must never turn the permit into a
// refusal. If answering throws, the entry's `exitCodeFor` catch turns the throw
// into exit 2 — a refusal on a path that only ever prints a message.
//
// WHICH THROW THIS USES: as of this writing no payload-reachable input makes
// `declaredTargetBinds` throw. `readTranscriptLines` (templates/hooks/_lib/session.ts)
// catches a read error and returns null, `scanAnnouncements` then sees no lines,
// `readDeclarations` turns a throwing reader into `ok: false` (which counts as
// binding), and `gitTopLevel` catches its spawn. The clearest reachable
// "unreadable input" is therefore the transcript itself: `transcript_path` naming
// a DIRECTORY (existsSync true, readFileSync EISDIR) and a mode-000 FILE
// (EACCES). Both are what `unreadableInputsNote` reports on the enforce path.
// These cases pin the outcome: exit 0, empty stdout, and the gate-off line
// still printed — when the binding question cannot be answered from the
// transcript, the declared world at the cwd top still binds, so the hook speaks.
// They are expected GREEN against the current hook and guard a future change
// that lets a read error escape this path.
describe("AC-STE-693.3 / AC-STE-693.5 (review fix) — an unreadable transcript never turns off into a refusal", () => {
  function withTranscript(f: Fixture, transcriptPath: string): Fixture {
    const payload = JSON.parse(f.stdin) as Record<string, unknown>;
    payload.transcript_path = transcriptPath;
    return { ...f, name: `${f.name} [transcript ${transcriptPath}]`, stdin: JSON.stringify(payload) };
  }

  async function expectOffLineAndExit0(fixtures: Fixture[]): Promise<void> {
    const runs = await Promise.all(fixtures.map((f) => runHook(f, "off")));
    fixtures.forEach((f, i) => {
      const r = runs[i]!;
      if (r.exitCode !== 0) throw new Error(`"${f.name}" under off refused on the message-only path:\n${show("off", r)}`);
      expect(r.stdout).toBe("");
      const lines = nonEmptyLines(r.stderr);
      expect(lines.length).toBe(1);
      expect(lines[0]!).toContain(OFF_PHRASE);
      expect(lines[0]!).toContain(f.bare);
      for (const k of f.keys) expect(lines[0]!).toContain(k);
    });
  }

  test("transcript_path names a directory (EISDIR) → exit 0 and the gate-off line, on every refusal fixture", async () => {
    const w = makeWorld();
    const dirTranscript = tempDir("transcript-dir");
    const fixtures = reviewFixtures(w, "dir-transcript").refused.map((f) => withTranscript(f, dirTranscript));
    await expectOffLineAndExit0(fixtures);
  });

  test("transcript_path names a mode-000 file (EACCES) → exit 0 and the gate-off line", async () => {
    const w = makeWorld();
    const f0 = reviewFixtures(w, "eacces-transcript").refused[0]!;
    const path = String((JSON.parse(f0.stdin) as { transcript_path: string }).transcript_path);
    chmodSync(path, 0o000);
    cleanups.push(() => chmodSync(path, 0o644));
    await expectOffLineAndExit0([f0]);
  });
});

// ===========================================================================
// AC-STE-693.5 (amended, post-release fix) — the scan is rooted where Claude
// Code loads project settings from
// ===========================================================================
//
// Claude Code loads `.claude/settings.json` and `.claude/settings.local.json`
// from the session's LAUNCH directory, which hooks receive as
// CLAUDE_PROJECT_DIR — not from the call's cwd. After the session `cd`s into
// another repository, a forged `env` entry in the launch project still reaches
// the hook as the variable. So the forged-settings scan runs from
// CLAUDE_PROJECT_DIR up to its git top level (the directory itself when it is
// not in a repository), AND from the cwd up to the cwd's git top level as
// before; either naming the variable is enough (fail closed). An unset or empty
// CLAUDE_PROJECT_DIR leaves the cwd scan exactly as it was.

describe("AC-STE-693.5 (amended) — the forged-settings scan is rooted at CLAUDE_PROJECT_DIR", () => {
  /** The session's launch project: its own git repo, `.claude/<file>` carrying `content` when given. */
  function launchProject(file: string | null, content: unknown, opts: { git?: boolean } = {}): string {
    const root = tempDir("launch");
    writeFileSync(join(root, "README.md"), "launch project\n");
    if (file !== null) {
      mkdirSync(join(root, ".claude"), { recursive: true });
      writeFileSync(join(root, ".claude", file), JSON.stringify(content, null, 2));
    }
    if (opts.git !== false) gitInit(root);
    return root;
  }

  /** Under off with `env`: every refused fixture refuses as the variable-absent hook does, plus one line naming `fileFragment`. */
  async function expectEnforcedNamingWith(refused: Fixture[], env: Record<string, string>, fileFragment: string): Promise<void> {
    const thens = await Promise.all(refused.map((f) => spawnHook(MODULE_PATH, f.stdin, undefined, env)));
    const nows = await Promise.all(refused.map((f) => runHook(f, "off", env)));
    refused.forEach((f, i) => {
      if (thens[i]!.exitCode !== 2) throw new Error(`"${f.name}" is not a refusal under the variable-absent hook:\n${show("absent", thens[i]!)}`);
      const line = oneExtraStderrLine(f.name, nows[i]!, thens[i]!);
      expect(line).toContain(fileFragment);
      expect(nows[i]!.stderr).not.toContain(OFF_PHRASE);
    });
  }

  /** Under off with `env`: exit 0 and exactly the one gate-off line (AC.3), naming no settings file. */
  async function expectOffAsAc3With(fixtures: Fixture[], env: Record<string, string>): Promise<void> {
    const runs = await Promise.all(fixtures.map((f) => runHook(f, "off", env)));
    fixtures.forEach((f, i) => {
      const r = runs[i]!;
      if (r.exitCode !== 0) throw new Error(`"${f.name}" under off is not permitted:\n${show("off", r)}`);
      expect(r.stdout).toBe("");
      const lines = nonEmptyLines(r.stderr);
      expect(lines.length).toBe(1);
      expect(lines[0]!).toContain(OFF_PHRASE);
      expect(lines[0]!).not.toContain(".claude/settings");
    });
  }

  for (const file of ["settings.json", "settings.local.json"]) {
    test(`(a) cwd in a DIFFERENT repo, CLAUDE_PROJECT_DIR's .claude/${file} env names it = off → enforce, one line naming the launch file`, async () => {
      const launch = launchProject(file, { env: { [VAR]: "off" } });
      const w = makeWorld();
      expect(existsSync(join(w.be, ".claude"))).toBe(false);
      await expectEnforcedNamingWith(reviewFixtures(w, `launch-${file}`).refused, { CLAUDE_PROJECT_DIR: launch }, join(launch, ".claude", file));
    });
  }

  test("(a) a permitted write from the other repo exits 0 with exactly one stderr line naming the launch file", async () => {
    const launch = launchProject("settings.json", { env: { [VAR]: "off" } });
    const { permitted } = reviewFixtures(makeWorld(), "launch-permitted");
    const env = { CLAUDE_PROJECT_DIR: launch };
    expect(await spawnHook(MODULE_PATH, permitted.stdin, undefined, env)).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    const r = await runHook(permitted, "off", env);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("");
    const lines = nonEmptyLines(r.stderr);
    expect(lines.length).toBe(1);
    expect(lines[0]!).toContain(join(launch, ".claude", "settings.json"));
    expect(r.stderr).not.toContain(OFF_PHRASE);
  });

  test("CLAUDE_PROJECT_DIR is a subdirectory of its repo, the file sits at that repo's top → enforce", async () => {
    const launch = launchProject("settings.local.json", { env: { [VAR]: "off" } }, { git: false });
    mkdirSync(join(launch, "pkg"), { recursive: true });
    writeFileSync(join(launch, "pkg", "keep.txt"), "x\n");
    gitInit(launch);
    const f = reviewFixtures(makeWorld(), "launch-subdir").refused[0]!;
    await expectEnforcedNamingWith([f], { CLAUDE_PROJECT_DIR: join(launch, "pkg") }, join(launch, ".claude", "settings.local.json"));
  });

  test("CLAUDE_PROJECT_DIR outside any git repository → its own .claude files are still scanned", async () => {
    const launch = launchProject("settings.json", { env: { [VAR]: "off" } }, { git: false });
    const f = reviewFixtures(makeWorld(), "launch-nogit").refused[0]!;
    await expectEnforcedNamingWith([f], { CLAUDE_PROJECT_DIR: launch }, join(launch, ".claude", "settings.json"));
  });

  test("an unparseable launch settings file fails closed → enforce", async () => {
    const launch = launchProject(null, null);
    mkdirSync(join(launch, ".claude"), { recursive: true });
    writeFileSync(join(launch, ".claude", "settings.json"), `{ "env": { "${VAR}": "off", } }\n`);
    const f = reviewFixtures(makeWorld(), "launch-bad").refused[0]!;
    await expectEnforcedNamingWith([f], { CLAUDE_PROJECT_DIR: launch }, join(launch, ".claude", "settings.json"));
  });

  test("both roots resolve and differ, only the CWD repo names it → still enforce (both are scanned)", async () => {
    const launch = launchProject(null, null);
    const w = makeWorld({
      beforeCommit: (be) => {
        mkdirSync(join(be, ".claude"), { recursive: true });
        writeFileSync(join(be, ".claude", "settings.json"), JSON.stringify({ env: { [VAR]: "off" } }));
      },
    });
    await expectEnforcedNamingWith(reviewFixtures(w, "cwd-only-names").refused, { CLAUDE_PROJECT_DIR: launch }, join(".claude", "settings.json"));
  });

  test("(b) CLAUDE_PROJECT_DIR unset or empty → today's cwd scan: the cwd repo's file still enforces", async () => {
    const w = makeWorld({
      beforeCommit: (be) => {
        mkdirSync(join(be, ".claude"), { recursive: true });
        writeFileSync(join(be, ".claude", "settings.local.json"), JSON.stringify({ env: { [VAR]: "off" } }));
      },
    });
    const { refused } = reviewFixtures(w, "pd-unset");
    await expectEnforcedNamingWith(refused, {}, join(w.be, ".claude", "settings.local.json"));
    await expectEnforcedNamingWith(refused, { CLAUDE_PROJECT_DIR: "" }, join(w.be, ".claude", "settings.local.json"));
  });

  test("(b) CLAUDE_PROJECT_DIR unset or empty, a launch-like repo elsewhere names it → off exactly as AC.3 (nothing outside cwd's repo is read)", async () => {
    launchProject("settings.json", { env: { [VAR]: "off" } });
    const { refused, permitted } = reviewFixtures(makeWorld(), "pd-empty");
    await expectOffAsAc3With([...refused, permitted], {});
    await expectOffAsAc3With([...refused, permitted], { CLAUDE_PROJECT_DIR: "" });
  });

  test("CONTROL — CLAUDE_PROJECT_DIR names a clean repo and the cwd repo is clean → off exactly as AC.3", async () => {
    for (const content of [null, { env: { OTHER_VAR: "off" } }]) {
      const launch = launchProject(content === null ? null : "settings.json", content);
      const { refused, permitted } = reviewFixtures(makeWorld(), `pd-clean-${content === null ? "none" : "other"}`);
      await expectOffAsAc3With([...refused, permitted], { CLAUDE_PROJECT_DIR: launch });
    }
  });

  test("CLAUDE_PROJECT_DIR set, variable absent or enforce → byte-identical to the variable-absent hook (the scan never speaks)", async () => {
    const launch = launchProject("settings.json", { env: { [VAR]: "off" } });
    const { refused, permitted } = reviewFixtures(makeWorld(), "pd-absent");
    const all = [...refused, permitted];
    const env = { CLAUDE_PROJECT_DIR: launch };
    const [currents, absents, enforces] = await Promise.all([
      Promise.all(all.map((f) => runCurrent(f))),
      Promise.all(all.map((f) => runHook(f, undefined, env))),
      Promise.all(all.map((f) => runHook(f, "enforce", env))),
    ]);
    all.forEach((f, i) => {
      expect(absents[i]!).toEqual(currents[i]!);
      expect(enforces[i]!).toEqual(currents[i]!);
    });
  });
});
