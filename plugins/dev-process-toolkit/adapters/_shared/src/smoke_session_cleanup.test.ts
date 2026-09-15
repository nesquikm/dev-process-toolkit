// STE-593 — a smoke run's session debris is found by identity and removed by
// exact path.
//
// Every root in this file lives in a synthetic home under mkdtemp. Nothing here
// reads, lists or writes the real ~/.claude*, ~/Library/Caches, ~/.cmuxterm or
// the repo's own .dpt/ — the CLI front-door tests point every root flag at the
// synthetic home AND set HOME / CLAUDE_CONFIG_DIR to it, so a default that
// leaks past a flag still lands in the temp dir.
//
// Liveness is real wherever it can be: live sessions are backed by spawned
// `sleep` processes (the default kill -0 path), dead ones use pids above any
// OS pid_max. In-process tests inject only the process-command-line and
// open-file-holder probes; the CLI tests make those real too (a process holding
// the file open, a process whose cwd is the lock dir, a process whose argv names
// the snapshot).
//
// Store shapes measured 2026-09-15 on Claude Code 2.1.x. The one shape not
// measured is the cmux registry temp name: a registry `.tmp` orphan here is a
// `claude-hook-sessions.json.<n>.tmp` file in the cmux dir.

import { afterEach, describe, expect, test } from "bun:test";
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  appendFileSync,
  chmodSync,
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, sep } from "node:path";
import { ledgerPath } from "./dpt_paths";
import { cwdToSlug } from "./find_current_session";
import {
  buildPlan,
  buildRunSet,
  type CleanupOptions,
  type CleanupProbes,
  defaultProbes,
  executePlan,
  PLAN_CLASSES,
  PLANNERS,
  type PlanClass,
  type PlanContext,
  readLiveSessionIds,
  rewriteLedgerCAS,
  runCleanup,
} from "./smoke_session_cleanup";

const SCRIPT = join(__dirname, "smoke_session_cleanup.ts");
const HOUR = 3_600_000;
const MIN = 60_000;
const CLI_TIMEOUT = 90_000;

/** The ten stores, in the FR's order. The token ledger is not a path store. */
const CLASS_NAMES: PlanClass[] = [
  "transcripts",
  "transcript_subdirs",
  "session_env",
  "telemetry",
  "mcp_logs",
  "shell_snapshots",
  "config_temps",
  "plugin_orphans",
  "cmux_tmp",
  "zcompdump_locks",
] as PlanClass[];

const SID_STORES: PlanClass[] = [
  "transcripts",
  "transcript_subdirs",
  "session_env",
  "telemetry",
  "mcp_logs",
] as PlanClass[];

// Sessions in the synthetic home:
//   A1..A6  run A — A1/A3 ledgered, A2 inferred by rule (a), A4/A5/A6 by rule (b)
//   B1      concurrent run B (sdk-cli, /smoke-test, born in the window)
//   I1      interactive session (entrypoint cli) in the window
//   L1      live session (registry pid answers kill -0), sdk-cli /smoke-test
//   N1      sdk-cli whose FIRST user message is not /smoke-test
//   O1      sdk-cli /smoke-test born before the window
//   F1      transcript-less, MCP log whose cwd is NOT a run cwd
//   T1      transcript-less, telemetry cli + interactive
//   T2      transcript-less, telemetry sdk-cli but born before the window
//   G1,G1b  grandchildren in a dpt-test-project-* cwd, in the window
//   G2      live grandchild in another dpt-test-project-* cwd
//   G3      grandchild in a third dpt-test-project-* cwd, before the window
const SID_KEYS = [
  "A1", "A2", "A3", "A4", "A5", "A6",
  "B1", "I1", "L1", "N1", "O1", "F1", "T1", "T2",
  "G1", "G1b", "G2", "G3",
] as const;
type SidKey = (typeof SID_KEYS)[number];

// Pids above every OS pid_max (macOS 99998, Linux ≤ 4194304): kill -0 → ESRCH.
const DEAD_PID_A1 = 4_000_101;

// ---------------------------------------------------------------------------
// process + temp-dir hygiene
// ---------------------------------------------------------------------------

const procs: ChildProcess[] = [];
const tempRoots: string[] = [];
const chmodRestore: string[] = [];

afterEach(() => {
  for (const p of chmodRestore.splice(0)) {
    try {
      chmodSync(p, 0o755);
    } catch {}
  }
  for (const p of procs.splice(0)) {
    try {
      p.kill("SIGKILL");
    } catch {}
  }
  for (const r of tempRoots.splice(0)) rmSync(r, { recursive: true, force: true });
});

function liveSleep(opts: Parameters<typeof spawn>[2] = {}): ChildProcess {
  const p = spawn("sleep", ["300"], { stdio: "ignore", ...opts });
  procs.push(p);
  if (typeof p.pid !== "number") throw new Error("could not spawn sleep");
  return p;
}

async function killAndWait(p: ChildProcess): Promise<void> {
  const exited = new Promise<void>((res) => p.once("exit", () => res()));
  p.kill("SIGKILL");
  await exited;
}

// ---------------------------------------------------------------------------
// store writers (measured shapes)
// ---------------------------------------------------------------------------

const iso = (ms: number) => new Date(ms).toISOString();

function stamp(path: string, ms: number): void {
  utimesSync(path, ms / 1000, ms / 1000);
}

function put(path: string, body: string, ms: number): string {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body);
  stamp(path, ms);
  return path;
}

function emptyDir(path: string, ms: number): string {
  mkdirSync(path, { recursive: true });
  stamp(path, ms);
  return path;
}

function transcript(
  cfg: string,
  cwd: string,
  sid: string,
  ms: number,
  entrypoint: "sdk-cli" | "cli",
  userContents: unknown[],
): string {
  const lines: object[] = [
    { type: "queue-operation", operation: "enqueue", timestamp: iso(ms), sessionId: sid },
    { type: "attachment", sessionId: sid, cwd, timestamp: iso(ms), entrypoint },
  ];
  userContents.forEach((content, i) => {
    lines.push({
      type: "user",
      message: { role: "user", content },
      sessionId: sid,
      cwd,
      timestamp: iso(ms + (2 * i + 1) * 1000),
      entrypoint,
      uuid: randomUUID(),
      userType: "external",
      version: "2.1.268",
    });
    lines.push({
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text: "done" }] },
      sessionId: sid,
      cwd,
      timestamp: iso(ms + (2 * i + 2) * 1000),
      entrypoint,
      uuid: randomUUID(),
    });
  });
  const body = `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`;
  return put(join(cfg, "projects", cwdToSlug(cwd), `${sid}.jsonl`), body, ms + 10_000);
}

function transcriptSubdir(cfg: string, cwd: string, sid: string, ms: number): string {
  const d = join(cfg, "projects", cwdToSlug(cwd), sid);
  put(join(d, "subagents", "agent-a1b2.jsonl"), `${JSON.stringify({ sessionId: sid, timestamp: iso(ms) })}\n`, ms);
  stamp(join(d, "subagents"), ms);
  stamp(d, ms);
  return d;
}

function sessionEnv(cfg: string, sid: string, ms: number): string {
  return emptyDir(join(cfg, "session-env", sid), ms);
}

function telemetry(cfg: string, sid: string, ms: number, entrypoint: "sdk-cli" | "cli", interactive: boolean): string {
  const body = `${[0, 1]
    .map((i) =>
      JSON.stringify({
        event_type: "ClaudeCodeInternalEvent",
        event_data: {
          event_name: i ? "tengu_exit" : "tengu_init",
          client_timestamp: iso(ms + i * 1000),
          session_id: sid,
          entrypoint,
          is_interactive: interactive,
          user_type: "external",
        },
      }),
    )
    .join("\n")}\n`;
  return put(join(cfg, "telemetry", `1p_failed_events.${sid}.${randomUUID()}.json`), body, ms + 2000);
}

function mcpLog(cache: string, cwd: string, server: string, sid: string, ms: number): string {
  const body = `${[
    { debug: `MCP server "${server}": Starting connection`, timestamp: iso(ms), sessionId: sid, cwd },
    { debug: `MCP server "${server}": Connected`, timestamp: iso(ms + 500), sessionId: sid, cwd },
  ]
    .map((l) => JSON.stringify(l))
    .join("\n")}\n`;
  const name = `${iso(ms).replace(/:/g, "-")}.jsonl`;
  return put(join(cache, cwdToSlug(cwd), `mcp-logs-${server}`, name), body, ms + 500);
}

function registry(cfg: string, pid: number, sid: string, cwd: string, ms: number, entrypoint: string): string {
  return put(
    join(cfg, "sessions", `${pid}.json`),
    JSON.stringify({ pid, sessionId: sid, cwd, startedAt: ms, kind: "interactive", entrypoint }),
    ms,
  );
}

// ---------------------------------------------------------------------------
// the synthetic home
// ---------------------------------------------------------------------------

interface Fixture {
  home: string;
  cfg1: string;
  cfg2: string;
  cache: string;
  cmux: string;
  projectRoot: string;
  roots: CleanupOptions["roots"];
  window: { startMs: number; endMs: number };
  runCwd: string;
  otherCwd: string;
  sid: Record<SidKey, string>;
  owned: Record<SidKey, string[]>;
  live: { L1: ChildProcess; G2: ChildProcess };
  f: Record<string, string>;
  expected: Record<PlanClass, string[]>;
  foreign: Record<PlanClass, string[]>;
  held: string[];
  cmdlineNamed: string[];
  neverPlanned: string[];
  ledgerFile: string;
  ledgerLines: string[];
  runLedgerLineIdx: number[];
  dptDirs: { L: string; J: string; N: string };
}

function makeFixture(): Fixture {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ste593-")));
  tempRoots.push(root);
  const home = join(root, "home");
  const cfg1 = join(home, ".claude-st");
  const cfg2 = join(home, ".claude");
  const cache = join(home, "Library", "Caches", "claude-cli-nodejs");
  const cmux = join(home, ".cmuxterm");
  const projectRoot = join(home, "workspace", "dev-process-toolkit");
  mkdirSync(projectRoot, { recursive: true });

  const now = Date.now();
  const window = { startMs: now - 3 * HOUR, endMs: now - 1 * HOUR };
  const IN = now - 2 * HOUR;
  const OUT = now - 6 * HOUR;

  const runCwd = projectRoot;
  const otherCwd = join(home, "workspace", "unrelated-app");
  const dptL = join(home, "workspace", "dpt-test-project-linear");
  const dptJ = join(home, "workspace", "dpt-test-project-jira");
  const dptN = join(home, "workspace", "dpt-test-project-none");

  const sid = Object.fromEntries(SID_KEYS.map((k) => [k, randomUUID()])) as Record<SidKey, string>;
  const owned = Object.fromEntries(SID_KEYS.map((k) => [k, [] as string[]])) as Record<SidKey, string[]>;
  const own = (k: SidKey, p: string) => {
    owned[k].push(p);
    return p;
  };
  const f: Record<string, string> = {};

  const L1 = liveSleep();
  const G2 = liveSleep();

  // ---- run A -------------------------------------------------------------
  f.tA1 = own("A1", transcript(cfg1, runCwd, sid.A1, IN, "sdk-cli", ["/smoke-test --leg linear"]));
  f.sdA1 = own("A1", transcriptSubdir(cfg1, runCwd, sid.A1, IN));
  f.seA1 = own("A1", sessionEnv(cfg1, sid.A1, IN));
  f.telA1 = own("A1", telemetry(cfg1, sid.A1, IN, "sdk-cli", false));
  f.mcpA1 = own("A1", mcpLog(cache, runCwd, "linear", sid.A1, IN + 1000));
  f.regA1dead = registry(cfg1, DEAD_PID_A1, sid.A1, runCwd, IN, "sdk-cli");

  // A2: second config dir, slash-command tag form, NOT ledgered → rule (a)
  f.tA2 = own(
    "A2",
    transcript(cfg2, runCwd, sid.A2, IN + 1 * MIN, "sdk-cli", [
      [
        {
          type: "text",
          text: "<command-message>smoke-test is running…</command-message>\n<command-name>/smoke-test</command-name>\n<command-args>--leg jira</command-args>",
        },
      ],
    ]),
  );
  f.seA2 = own("A2", sessionEnv(cfg2, sid.A2, IN + 1 * MIN));
  f.telA2 = own("A2", telemetry(cfg2, sid.A2, IN + 1 * MIN, "sdk-cli", false));

  // A3: ledgered, no transcript anywhere
  f.seA3 = own("A3", sessionEnv(cfg1, sid.A3, IN + 2 * MIN));
  f.telA3 = own("A3", telemetry(cfg1, sid.A3, IN + 2 * MIN, "sdk-cli", false));

  // A4: only an empty session-env dir → rule (b)
  f.seA4 = own("A4", sessionEnv(cfg1, sid.A4, IN + 3 * MIN));
  // A5: only an MCP log whose cwd is a run cwd → rule (b)
  f.mcpA5 = own("A5", mcpLog(cache, runCwd, "linear", sid.A5, IN + 4 * MIN));
  // A6: only a telemetry file whose events are sdk-cli + non-interactive → rule (b)
  f.telA6 = own("A6", telemetry(cfg1, sid.A6, IN + 5 * MIN, "sdk-cli", false));

  // ---- run B (concurrent) ---------------------------------------------------
  f.tB1 = own("B1", transcript(cfg1, runCwd, sid.B1, IN + 30_000, "sdk-cli", ["/smoke-test --leg none"]));
  f.sdB1 = own("B1", transcriptSubdir(cfg1, runCwd, sid.B1, IN + 30_000));
  f.seB1 = own("B1", sessionEnv(cfg1, sid.B1, IN + 30_000));
  f.telB1 = own("B1", telemetry(cfg1, sid.B1, IN + 30_000, "sdk-cli", false));
  f.mcpB1 = own("B1", mcpLog(cache, runCwd, "linear", sid.B1, IN + 31_000));

  // ---- interactive session (entrypoint cli — even though it typed /smoke-test)
  f.tI1 = own("I1", transcript(cfg1, runCwd, sid.I1, IN + 90_000, "cli", ["/smoke-test --leg linear"]));
  f.seI1 = own("I1", sessionEnv(cfg1, sid.I1, IN + 90_000));
  f.telI1 = own("I1", telemetry(cfg1, sid.I1, IN + 90_000, "cli", true));
  f.mcpI1 = own("I1", mcpLog(cache, runCwd, "linear", sid.I1, IN + 91_000));

  // ---- live session: registered in cfg2, transcript in cfg1 ---------------
  f.regL1 = own("L1", registry(cfg2, L1.pid as number, sid.L1, runCwd, IN + 6 * MIN, "sdk-cli"));
  f.tL1 = own("L1", transcript(cfg1, runCwd, sid.L1, IN + 6 * MIN, "sdk-cli", ["/smoke-test --leg linear"]));
  f.sdL1 = own("L1", transcriptSubdir(cfg1, runCwd, sid.L1, IN + 6 * MIN));
  f.seL1 = own("L1", sessionEnv(cfg1, sid.L1, IN + 6 * MIN));
  f.telL1 = own("L1", telemetry(cfg1, sid.L1, IN + 6 * MIN, "sdk-cli", false));
  f.mcpL1 = own("L1", mcpLog(cache, runCwd, "linear", sid.L1, IN + 6 * MIN + 1000));

  // ---- N1: /smoke-test only in a LATER user message ------------------------
  f.tN1 = own(
    "N1",
    transcript(cfg1, runCwd, sid.N1, IN + 7 * MIN, "sdk-cli", ["/dev-process-toolkit:gate-check", "/smoke-test --leg linear"]),
  );
  f.seN1 = own("N1", sessionEnv(cfg1, sid.N1, IN + 7 * MIN));
  f.telN1 = own("N1", telemetry(cfg1, sid.N1, IN + 7 * MIN, "sdk-cli", false));

  // ---- O1: a smoke session born before the window --------------------------
  f.tO1 = own("O1", transcript(cfg1, runCwd, sid.O1, OUT, "sdk-cli", ["/smoke-test --leg linear"]));
  f.seO1 = own("O1", sessionEnv(cfg1, sid.O1, OUT));
  f.telO1 = own("O1", telemetry(cfg1, sid.O1, OUT, "sdk-cli", false));

  // ---- transcript-less look-alikes that inference must reject --------------
  f.mcpF1 = own("F1", mcpLog(cache, otherCwd, "linear", sid.F1, IN + 8 * MIN));
  f.telT1 = own("T1", telemetry(cfg1, sid.T1, IN + 9 * MIN, "cli", true));
  f.telT2 = own("T2", telemetry(cfg1, sid.T2, OUT + 1 * MIN, "sdk-cli", false));

  // ---- grandchildren in dpt-test-project-* cwds (manual mode, AC.6) --------
  f.tG1 = own("G1", transcript(cfg1, dptL, sid.G1, IN + 10 * MIN, "sdk-cli", ["/dev-process-toolkit:setup"]));
  f.seG1 = own("G1", sessionEnv(cfg1, sid.G1, IN + 10 * MIN));
  f.telG1 = own("G1", telemetry(cfg1, sid.G1, IN + 10 * MIN, "sdk-cli", false));
  f.mcpG1 = own("G1", mcpLog(cache, dptL, "linear", sid.G1, IN + 10 * MIN + 1000));
  f.tG1b = own("G1b", transcript(cfg1, dptL, sid.G1b, IN + 11 * MIN, "sdk-cli", ["/dev-process-toolkit:spec-write"]));
  f.sdG1b = own("G1b", transcriptSubdir(cfg1, dptL, sid.G1b, IN + 11 * MIN));
  f.seG1b = own("G1b", sessionEnv(cfg1, sid.G1b, IN + 11 * MIN));
  f.regG2 = own("G2", registry(cfg1, G2.pid as number, sid.G2, dptJ, IN + 12 * MIN, "sdk-cli"));
  f.tG2 = own("G2", transcript(cfg1, dptJ, sid.G2, IN + 12 * MIN, "sdk-cli", ["/dev-process-toolkit:setup"]));
  f.seG2 = own("G2", sessionEnv(cfg1, sid.G2, IN + 12 * MIN));
  f.tG3 = own("G3", transcript(cfg1, dptN, sid.G3, OUT, "sdk-cli", ["/dev-process-toolkit:setup"]));
  f.seG3 = own("G3", sessionEnv(cfg1, sid.G3, OUT));
  const dptDirs = {
    L: join(cfg1, "projects", cwdToSlug(dptL)),
    J: join(cfg1, "projects", cwdToSlug(dptJ)),
    N: join(cfg1, "projects", cwdToSlug(dptN)),
  };
  stamp(dptDirs.L, IN + 11 * MIN + 10_000);
  stamp(dptDirs.J, IN + 12 * MIN + 10_000);
  stamp(dptDirs.N, OUT + 10_000);

  // ---- shell snapshots (no sid: birth time + live command lines) -----------
  const snapBody = "# shell snapshot\nexport PATH=/usr/bin:/bin\n";
  f.snapIn1 = put(join(cfg1, "shell-snapshots", `snapshot-zsh-${IN}-a1b2c3.sh`), snapBody, IN);
  f.snapIn2 = put(join(cfg2, "shell-snapshots", `snapshot-zsh-${IN + 1000}-d4e5f6.sh`), snapBody, IN + 1000);
  f.snapOut = put(join(cfg1, "shell-snapshots", `snapshot-zsh-${OUT}-g7h8i9.sh`), snapBody, OUT);
  f.snapNamed = put(join(cfg1, "shell-snapshots", `snapshot-zsh-${IN + 2000}-j0k1l2.sh`), snapBody, IN + 2000);

  // ---- config temps + the config files that are never touched ---------------
  const cfgBody = '{"cachedGrowthBookFeatures":{}}';
  f.tmpOrphan = put(join(cfg1, ".claude.json.tmp.4000201.1a2b3c"), cfgBody, IN + 1 * MIN);
  f.tmpHeld = put(join(cfg1, ".claude.json.tmp.4000202.4d5e6f"), cfgBody, IN + 1 * MIN);
  f.cfgJson = put(join(cfg1, ".claude.json"), '{"numStartups":7}', IN);
  f.cfgBak = put(join(cfg1, ".claude.json.bak"), '{"numStartups":6}', IN);
  f.cfgBak2 = put(join(cfg1, ".claude.json.bak.1789000000000"), '{"numStartups":5}', IN);
  f.cfgBackup = put(join(cfg1, ".claude.json.backup"), '{"numStartups":4}', IN);
  f.homeJson = put(join(home, ".claude.json"), '{"numStartups":3}', IN);
  f.homeBak = put(join(home, ".claude.json.bak"), '{"numStartups":2}', IN);

  // ---- plugin orphans --------------------------------------------------------
  const mkts = join(cfg1, "plugins", "marketplaces");
  const pcache = join(cfg1, "plugins", "cache");
  f.bakOrphan = join(mkts, "claude-plugins-official.bak");
  put(join(f.bakOrphan, "config.lock"), "", IN);
  stamp(f.bakOrphan, IN);
  f.liveMkt = join(mkts, "claude-plugins-official");
  put(join(f.liveMkt, ".claude-plugin", "marketplace.json"), "{}", IN);
  f.bakNamed = join(mkts, "team-tools.bak");
  put(join(f.bakNamed, "marketplace.json"), "{}", IN);
  f.gitOrphan = join(pcache, "temp_git_1789073941033_bjjfjm");
  put(join(f.gitOrphan, "README.md"), "orphan\n", IN);
  f.gitNamed = join(pcache, "temp_git_1789000000000_inuse");
  put(join(f.gitNamed, "README.md"), "in use\n", IN);
  f.cachePlugin = join(pcache, "dev-process-toolkit");
  put(join(f.cachePlugin, "2.83.0", "plugin.json"), "{}", IN);
  f.knownMkts = put(
    join(cfg1, "plugins", "known_marketplaces.json"),
    JSON.stringify({ "team-tools": { source: { source: "git" }, installLocation: f.bakNamed } }),
    IN,
  );
  f.installedPlugins = put(
    join(cfg1, "plugins", "installed_plugins.json"),
    JSON.stringify({ version: 2, plugins: { "x@team-tools": [{ installPath: f.gitNamed }] } }),
    IN,
  );

  // ---- cmux: rows naming run sessions are LEFT; only .tmp orphans go --------
  f.cmuxReg = put(
    join(cmux, "claude-hook-sessions.json"),
    JSON.stringify({ sessions: { [sid.A1]: { pid: DEAD_PID_A1 }, [sid.A2]: { pid: 4_000_102 } } }),
    IN,
  );
  f.cmuxWs = put(
    join(cmux, "workstream.jsonl"),
    `${[sid.A1, sid.A2, sid.A4].map((s) => JSON.stringify({ session_id: s, event: "stop" })).join("\n")}\n`,
    IN,
  );
  f.cmuxTmp = put(join(cmux, "claude-hook-sessions.json.4000301.tmp"), "{}", IN);
  f.cmuxTmpHeld = put(join(cmux, "claude-hook-sessions.json.4000302.tmp"), "{}", IN);

  // ---- zsh completion locks --------------------------------------------------
  f.lock = emptyDir(join(home, ".zcompdump-host-5.9.lock"), IN);
  f.zcomp = put(join(home, ".zcompdump-host-5.9"), "#zcompdump\n", IN);
  f.lockBusy = join(home, ".zcompdump-other-5.9.lock");
  put(join(f.lockBusy, "owner"), "123\n", IN);
  stamp(f.lockBusy, IN);
  f.lockHeld = emptyDir(join(home, ".zcompdump-held-5.9.lock"), IN);

  // ---- run findings, approval record, and what the report says it leaves ---
  f.findings = put(join(home, "tmp", "dpt-smoke-findings-2026-09-15-linear.md"), "# findings\n", IN);
  f.approval = put(join(home, "tmp", "dpt-conformance-loop-2026-09-15-approval.txt"), "y\n", IN);
  f.crash = put(join(home, "Library", "Logs", "DiagnosticReports", "git-2026-09-11-011300.ips"), "{}\n", IN);
  f.bunCache = put(join(home, ".bun", "install", "cache", "left-pad@1.3.0", "package.json"), "{}\n", IN);

  // ---- token ledger: odd spacing, a malformed line, a CRLF line -------------
  const ledgerFile = ledgerPath(projectRoot);
  const ledgerLines = [
    JSON.stringify({ session_id: sid.A1, skill: "smoke-test", input_tokens: 10 }),
    JSON.stringify({ session_id: sid.B1, skill: "smoke-test", input_tokens: 20 }),
    `{ "session_id" : "${sid.I1}",   "model": "ö-model" }`,
    "not json {",
    JSON.stringify({ session_id: sid.A3, input_tokens: 30 }),
    `${JSON.stringify({ session_id: sid.L1, input_tokens: 40 })}\r`,
    JSON.stringify({ session_id: sid.A1, input_tokens: 50 }),
    JSON.stringify({ session_id: sid.N1 }),
  ];
  put(ledgerFile, `${ledgerLines.join("\n")}\n`, IN);

  const expected = {
    transcripts: [f.tA1, f.tA2],
    transcript_subdirs: [f.sdA1],
    session_env: [f.seA1, f.seA2, f.seA3, f.seA4],
    telemetry: [f.telA1, f.telA2, f.telA3, f.telA6],
    mcp_logs: [f.mcpA1, f.mcpA5],
    shell_snapshots: [f.snapIn1, f.snapIn2],
    config_temps: [f.tmpOrphan],
    plugin_orphans: [f.bakOrphan, f.gitOrphan],
    cmux_tmp: [f.cmuxTmp],
    zcompdump_locks: [f.lock],
  } as Record<PlanClass, string[]>;

  const foreign = {
    transcripts: [f.tB1, f.tI1, f.tL1, f.tN1, f.tO1, f.tG1],
    transcript_subdirs: [f.sdB1, f.sdL1, f.sdG1b],
    session_env: [f.seB1, f.seI1, f.seL1, f.seN1, f.seO1, f.seG1],
    telemetry: [f.telB1, f.telI1, f.telL1, f.telN1, f.telO1, f.telT1, f.telT2, f.telG1],
    mcp_logs: [f.mcpB1, f.mcpI1, f.mcpL1, f.mcpF1, f.mcpG1],
    shell_snapshots: [f.snapOut, f.snapNamed],
    config_temps: [f.tmpHeld, f.cfgJson, f.cfgBak, f.cfgBak2, f.cfgBackup, f.homeJson, f.homeBak],
    plugin_orphans: [f.bakNamed, f.gitNamed, f.liveMkt, f.cachePlugin, f.knownMkts, f.installedPlugins],
    cmux_tmp: [f.cmuxTmpHeld, f.cmuxReg, f.cmuxWs],
    zcompdump_locks: [f.lockBusy, f.lockHeld, f.zcomp],
  } as Record<PlanClass, string[]>;

  return {
    home,
    cfg1,
    cfg2,
    cache,
    cmux,
    projectRoot,
    roots: { configDirs: [cfg1, cfg2], cacheRoot: cache, homeDir: home, cmuxDir: cmux, projectRoot },
    window,
    runCwd,
    otherCwd,
    sid,
    owned,
    live: { L1, G2 },
    f,
    expected,
    foreign,
    held: [f.tmpHeld, f.cmuxTmpHeld, f.lockHeld],
    cmdlineNamed: [f.snapNamed],
    neverPlanned: [
      f.cfgJson, f.cfgBak, f.cfgBak2, f.cfgBackup, f.homeJson, f.homeBak,
      f.findings, f.approval, f.crash, f.bunCache, f.cmuxReg, f.cmuxWs, f.zcomp,
      f.knownMkts, f.installedPlugins, f.regL1, f.regG2,
    ],
    ledgerFile,
    ledgerLines,
    runLedgerLineIdx: [0, 4, 6],
    dptDirs,
  };
}

const RUN_A: SidKey[] = ["A1", "A2", "A3", "A4", "A5", "A6"];
const runASids = (fx: Fixture) => RUN_A.map((k) => fx.sid[k]).sort();

/** Probes with real kill -0 and injected holders / command lines. */
function fakeProbes(fx: Fixture, over: Partial<CleanupProbes> = {}): CleanupProbes {
  const held = new Set(fx.held);
  return {
    ...defaultProbes(),
    commandLines: () => [
      "/bin/zsh -l",
      `/bin/zsh -c source ${fx.cmdlineNamed[0]} 2>/dev/null || true && eval 'bun test'`,
    ],
    isHeld: (p: string) => held.has(p),
    ...over,
  };
}

/** Window mode: run A's ledger ids (incl. a live one), run B passed as kept. */
function opts(fx: Fixture, over: Partial<CleanupOptions> = {}): CleanupOptions {
  return {
    roots: fx.roots,
    sessionIds: [fx.sid.A1, fx.sid.A3, fx.sid.L1],
    kept: [fx.sid.B1],
    window: fx.window,
    runCwds: [fx.runCwd],
    manual: false,
    probes: fakeProbes(fx),
    ...over,
  };
}

function ctx(fx: Fixture, over: Partial<PlanContext> = {}): PlanContext {
  return {
    roots: fx.roots,
    runSet: new Set(runASids(fx)),
    window: fx.window,
    manual: false,
    probes: fakeProbes(fx),
    ...over,
  } as PlanContext;
}

// ---------------------------------------------------------------------------
// tree + report helpers
// ---------------------------------------------------------------------------

function snapshotTree(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (p: string) => {
    const st = lstatSync(p);
    if (st.isSymbolicLink()) {
      out.set(p, `link:${readlinkSync(p)}`);
      return;
    }
    if (st.isDirectory()) {
      out.set(p, "dir");
      for (const e of readdirSync(p)) walk(join(p, e));
      return;
    }
    out.set(p, `file:${readFileSync(p).toString("base64")}`);
  };
  walk(dir);
  return out;
}

const under = (p: string, roots: string[]) => roots.some((r) => p === r || p.startsWith(r + sep));

function bytesOf(p: string): number {
  const st = lstatSync(p);
  if (st.isDirectory()) return readdirSync(p).reduce((n, e) => n + bytesOf(join(p, e)), 0);
  return st.size;
}

function classLines(out: string): Record<string, { count: number; bytes: number }> {
  const res: Record<string, { count: number; bytes: number }> = {};
  for (const m of out.matchAll(/^\s*([a-z_]+)\s+count=(\d+)\s+bytes=(\d+)\s*$/gm)) {
    res[m[1]] = { count: Number(m[2]), bytes: Number(m[3]) };
  }
  return res;
}

function expectedClassLines(fx: Fixture): Record<string, { count: number; bytes: number }> {
  const res: Record<string, { count: number; bytes: number }> = {};
  for (const cls of CLASS_NAMES) {
    res[cls] = {
      count: fx.expected[cls].length,
      bytes: fx.expected[cls].reduce((n, p) => n + bytesOf(p), 0),
    };
  }
  return res;
}

const allExpected = (fx: Fixture) => CLASS_NAMES.flatMap((c) => fx.expected[c]);

function isCovered(entries: { path: string }[], p: string): boolean {
  return entries.some((e) => p === e.path || p.startsWith(e.path + sep));
}

function holdForReal(fx: Fixture): void {
  for (const p of [fx.f.tmpHeld, fx.f.cmuxTmpHeld]) {
    const fd = openSync(p, "r");
    procs.push(spawn("sleep", ["300"], { stdio: [fd, "ignore", "ignore"] }));
    closeSync(fd);
  }
  procs.push(spawn("sleep", ["300"], { cwd: fx.f.lockHeld, stdio: "ignore" }));
  procs.push(spawn("/bin/sh", ["-c", "sleep 300; :", fx.f.snapNamed], { stdio: "ignore" }));
}

function cli(fx: Fixture, extra: string[]): { code: number | null; out: string } {
  const args = [
    "run", SCRIPT,
    "--config-dir", fx.cfg1,
    "--config-dir", fx.cfg2,
    "--cache-root", fx.cache,
    "--home", fx.home,
    "--cmux-dir", fx.cmux,
    "--project-root", fx.projectRoot,
    "--session", fx.sid.A1,
    "--session", fx.sid.A3,
    "--session", fx.sid.L1,
    "--keep", fx.sid.B1,
    "--run-cwd", fx.runCwd,
    "--since", iso(fx.window.startMs),
    "--until", iso(fx.window.endMs),
    ...extra,
  ];
  const r = spawnSync("bun", args, {
    encoding: "utf8",
    env: { ...process.env, HOME: fx.home, CLAUDE_CONFIG_DIR: fx.cfg1 },
    timeout: CLI_TIMEOUT - 5000,
  });
  return { code: r.status, out: `${r.stdout ?? ""}\n${r.stderr ?? ""}` };
}

const sorted = (xs: Iterable<string>) => [...xs].sort();

// ===========================================================================
// AC-STE-593.1 — the run set
// ===========================================================================

describe("AC-STE-593.1 — run set = spawn-ledger ids ∪ window-inferred ids, minus live and kept", () => {
  test("window mode: exactly run A — ledgered A1/A3, rule (a) A2, rule (b) A4/A5/A6", async () => {
    const fx = makeFixture();
    const set = await buildRunSet(opts(fx));
    expect(sorted(set)).toEqual(runASids(fx));
    // named negatives, for a readable failure
    for (const k of ["B1", "I1", "L1", "N1", "O1", "F1", "T1", "T2", "G1", "G1b", "G2", "G3"] as SidKey[]) {
      expect({ [k]: set.has(fx.sid[k]) }).toEqual({ [k]: false });
    }
  });

  test("without a window nothing is inferred: the set is the ledger ids minus the live one", async () => {
    const fx = makeFixture();
    const set = await buildRunSet(opts(fx, { window: undefined }));
    expect(sorted(set)).toEqual(sorted([fx.sid.A1, fx.sid.A3]));
  });

  test("a kept id never enters, whether ledgered or inferred", async () => {
    const fx = makeFixture();
    const set = await buildRunSet(
      opts(fx, { sessionIds: [fx.sid.A1, fx.sid.A3], kept: [fx.sid.B1, fx.sid.A3, fx.sid.A2, fx.sid.A5] }),
    );
    expect(sorted(set)).toEqual(sorted([fx.sid.A1, fx.sid.A4, fx.sid.A6]));
  });

  test("rule (b)'s MCP evidence keys on the run cwd: another cwd admits F1 and drops A5", async () => {
    const fx = makeFixture();
    const other = await buildRunSet(opts(fx, { runCwds: [fx.otherCwd] }));
    expect(other.has(fx.sid.F1)).toBe(true);
    expect(other.has(fx.sid.A5)).toBe(false);
    const none = await buildRunSet(opts(fx, { runCwds: [] }));
    expect(none.has(fx.sid.A5)).toBe(false);
    expect(none.has(fx.sid.F1)).toBe(false);
  });

  test("liveness is a real kill -0 over every config dir's registry; a session that dies re-enters", async () => {
    const fx = makeFixture();
    // default probes — no injection at all
    const live = await readLiveSessionIds([fx.cfg1, fx.cfg2]);
    expect(sorted(live)).toEqual(sorted([fx.sid.L1, fx.sid.G2]));

    const ledgerOnly = { roots: fx.roots, sessionIds: [fx.sid.A1, fx.sid.L1] } as CleanupOptions;
    expect(sorted(await buildRunSet(ledgerOnly))).toEqual([fx.sid.A1]);

    await killAndWait(fx.live.L1);
    expect(sorted(await readLiveSessionIds([fx.cfg1, fx.cfg2]))).toEqual([fx.sid.G2]);
    expect(sorted(await buildRunSet(ledgerOnly))).toEqual(sorted([fx.sid.A1, fx.sid.L1]));
  });
});

// ===========================================================================
// AC-STE-593.2 — the ten stores
// ===========================================================================

describe("AC-STE-593.2 — the plan lists exactly what the run set owns in ten stores", () => {
  test("PLAN_CLASSES names the ten stores and PLANNERS has one planner per store", () => {
    expect([...PLAN_CLASSES]).toEqual(CLASS_NAMES);
    expect(Object.keys(PLANNERS).sort()).toEqual([...CLASS_NAMES].sort());
  });

  for (const cls of CLASS_NAMES) {
    test(`planner ${cls}: lists exactly run A's paths in its store`, async () => {
      const fx = makeFixture();
      const got = await PLANNERS[cls](ctx(fx));
      expect(sorted(got)).toEqual(sorted(fx.expected[cls]));
    });

    test(`planner ${cls}: mutation control — the foreign file is not listed, and is once the rule flips`, async () => {
      const fx = makeFixture();
      const got = await PLANNERS[cls](ctx(fx));
      for (const p of fx.foreign[cls]) expect(got).not.toContain(p);

      // Polarity: flip the one fact that makes the foreign file foreign, so an
      // empty planner cannot pass the line above.
      let flipped: PlanContext;
      let nowOwned: string[];
      if (SID_STORES.includes(cls)) {
        flipped = ctx(fx, { runSet: new Set([fx.sid.B1]) });
        nowOwned = fx.owned.B1.filter((p) => fx.foreign[cls].includes(p));
      } else if (cls === "shell_snapshots") {
        flipped = ctx(fx, { probes: fakeProbes(fx, { commandLines: () => [] }) });
        nowOwned = [fx.f.snapNamed];
      } else if (cls === "plugin_orphans") {
        writeFileSync(fx.f.knownMkts, "{}");
        writeFileSync(fx.f.installedPlugins, "{}");
        flipped = ctx(fx);
        nowOwned = [fx.f.bakNamed, fx.f.gitNamed];
      } else {
        flipped = ctx(fx, { probes: fakeProbes(fx, { isHeld: () => false }) });
        nowOwned = { config_temps: [fx.f.tmpHeld], cmux_tmp: [fx.f.cmuxTmpHeld], zcompdump_locks: [fx.f.lockHeld] }[
          cls as "config_temps" | "cmux_tmp" | "zcompdump_locks"
        ];
      }
      expect(nowOwned.length).toBeGreaterThan(0);
      const after = await PLANNERS[cls](flipped);
      for (const p of nowOwned) expect(after).toContain(p);
    });
  }

  test("buildPlan: the union of the ten stores, each entry classed and sized, nothing else", async () => {
    const fx = makeFixture();
    const plan = await buildPlan(opts(fx));
    expect(sorted(plan.runSet)).toEqual(runASids(fx));
    expect(sorted(plan.entries.map((e) => e.path))).toEqual(sorted(allExpected(fx)));
    for (const e of plan.entries) {
      expect({ path: e.path, cls: e.cls }).toEqual({
        path: e.path,
        cls: CLASS_NAMES.find((c) => fx.expected[c].includes(e.path)) as PlanClass,
      });
      expect({ path: e.path, bytes: e.bytes }).toEqual({ path: e.path, bytes: bytesOf(e.path) });
    }
  });

  test(".claude.json, every .claude.json.bak*, and the run's findings/approval are never planned", async () => {
    const fx = makeFixture();
    const plan = await buildPlan(opts(fx, { manual: true }));
    for (const p of fx.neverPlanned) expect({ p, covered: isCovered(plan.entries, p) }).toEqual({ p, covered: false });
  });
});

// ===========================================================================
// AC-STE-593.3 — dry run by default
// ===========================================================================

describe("AC-STE-593.3 — dry run deletes nothing and prints per-class count and bytes", () => {
  test("runCleanup without delete: tree byte-identical, exit 0, one line per class with its count and bytes", async () => {
    const fx = makeFixture();
    const before = snapshotTree(fx.home);
    const r = await runCleanup(opts(fx));
    expect(r.exitCode).toBe(0);
    expect(snapshotTree(fx.home)).toEqual(before);
    const lines = classLines(r.output);
    for (const cls of CLASS_NAMES) expect({ cls, ...lines[cls] }).toEqual({ cls, ...expectedClassLines(fx)[cls] });
  });

  test("on an unchanged tree a delete removes exactly the planned counts", async () => {
    const fx = makeFixture();
    const plan = await buildPlan(opts(fx));
    const res = await executePlan(plan, { probes: fakeProbes(fx) });
    const count = (xs: { cls: PlanClass }[]) =>
      Object.fromEntries(CLASS_NAMES.map((c) => [c, xs.filter((x) => x.cls === c).length]));
    expect(count(res.removed)).toEqual(count(plan.entries));
    expect(res.survivors).toEqual([]);
    for (const p of allExpected(fx)) expect({ p, exists: existsSync(p) }).toEqual({ p, exists: false });
  });

  test(
    "CLI front door: dry run then delete — same per-class numbers, planned paths gone, the rest byte-identical",
    () => {
      const fx = makeFixture();
      holdForReal(fx);
      const want = expectedClassLines(fx);
      const before = snapshotTree(fx.home);

      const dry = cli(fx, []);
      expect(dry.code).toBe(0);
      expect(snapshotTree(fx.home)).toEqual(before);
      const dryLines = classLines(dry.out);
      for (const cls of CLASS_NAMES) expect({ cls, ...dryLines[cls] }).toEqual({ cls, ...want[cls] });

      const del = cli(fx, ["--delete"]);
      expect(del.code).toBe(0);
      const delLines = classLines(del.out);
      for (const cls of CLASS_NAMES) expect({ cls, ...delLines[cls] }).toEqual({ cls, ...dryLines[cls] });

      const planned = allExpected(fx);
      const ledgerDir = dirname(fx.ledgerFile);
      const after = snapshotTree(fx.home);
      for (const p of planned) expect({ p, exists: existsSync(p) }).toEqual({ p, exists: false });
      const keep = (m: Map<string, string>) =>
        new Map([...m].filter(([p]) => !under(p, planned) && !under(p, [ledgerDir])));
      expect(keep(after)).toEqual(keep(before));
    },
    CLI_TIMEOUT,
  );
});

// ===========================================================================
// AC-STE-593.4 — exact-path delete, re-validated, survivor check
// ===========================================================================

describe("AC-STE-593.4 — the delete path expands no glob and re-validates every path", () => {
  test("a glob-shaped entry removes nothing: every file it would match survives", async () => {
    const fx = makeFixture();
    const plan = await buildPlan(opts(fx));
    const globs = [
      { cls: "telemetry" as PlanClass, path: join(fx.cfg1, "telemetry", `1p_failed_events.${fx.sid.A1}.*`), bytes: 0 },
      { cls: "transcripts" as PlanClass, path: join(fx.cfg1, "projects", cwdToSlug(fx.runCwd), "*.jsonl"), bytes: 0 },
      { cls: "session_env" as PlanClass, path: join(fx.cfg1, "session-env", "*"), bytes: 0 },
    ];
    const before = snapshotTree(fx.home);
    const res = await executePlan({ ...plan, entries: globs }, { probes: fakeProbes(fx) });
    expect(res.removed).toEqual([]);
    expect(snapshotTree(fx.home)).toEqual(before);
  });

  test("an entry that fails its store's rule at delete time is refused, survives, and is reported", async () => {
    const fx = makeFixture();
    const plan = await buildPlan(opts(fx));
    // A planned file swapped for a symlink to the approval record after planning.
    unlinkSync(fx.f.telA6);
    symlinkSync(fx.f.approval, fx.f.telA6);
    const forged = [
      { cls: "transcripts", path: fx.f.tB1 }, // kept run B's transcript
      { cls: "config_temps", path: fx.f.cfgBak }, // a .claude.json backup
      { cls: "config_temps", path: fx.f.cfgJson }, // the config itself
      { cls: "telemetry", path: fx.f.findings }, // run findings file
      { cls: "session_env", path: join(fx.cfg1, "projects") }, // a store root
      { cls: "shell_snapshots", path: fx.f.snapOut }, // born before the window
      { cls: "plugin_orphans", path: fx.f.bakNamed }, // named by plugin state
      { cls: "telemetry", path: fx.f.telA6 }, // now a symlink
    ].map((e) => ({ ...e, cls: e.cls as PlanClass, bytes: 0 }));
    const before = snapshotTree(fx.home);
    const res = await executePlan({ ...plan, entries: forged }, { probes: fakeProbes(fx) });

    expect(res.removed.map((e) => e.path).filter((p) => p !== fx.f.telA6)).toEqual([]);
    expect(readFileSync(fx.f.approval, "utf8")).toBe("y\n");
    const survivorsExpected = forged.map((e) => e.path).filter((p) => p !== fx.f.telA6);
    for (const p of survivorsExpected) expect(res.survivors).toContain(p);
    const keep = (m: Map<string, string>) => new Map([...m].filter(([p]) => p !== fx.f.telA6));
    expect(keep(snapshotTree(fx.home))).toEqual(keep(before));
  });

  test("a session that turns live after planning is re-read at delete time: its paths survive as survivors", async () => {
    const fx = makeFixture();
    const plan = await buildPlan(opts(fx));
    const reborn = liveSleep();
    registry(fx.cfg1, reborn.pid as number, fx.sid.A1, fx.runCwd, Date.now(), "sdk-cli");

    const res = await executePlan(plan, { probes: fakeProbes(fx) });
    for (const p of fx.owned.A1) expect({ p, exists: existsSync(p) }).toEqual({ p, exists: true });
    for (const p of fx.owned.A1) expect(res.survivors).toContain(p);
    for (const p of [fx.f.tA2, fx.f.seA4, fx.f.mcpA5, fx.f.telA6]) {
      expect({ p, exists: existsSync(p) }).toEqual({ p, exists: false });
    }
  });

  test("a planned path that cannot be removed is re-listed as a survivor and fails the front door, named", async () => {
    const fx = makeFixture();
    const telDir = join(fx.cfg1, "telemetry");
    chmodRestore.push(telDir);
    chmodSync(telDir, 0o555);

    const plan = await buildPlan(opts(fx));
    const res = await executePlan(plan, { probes: fakeProbes(fx) });
    expect(sorted(res.survivors)).toEqual(sorted([fx.f.telA1, fx.f.telA3, fx.f.telA6]));
    expect(existsSync(fx.f.tA2)).toBe(false);

    const fx2 = makeFixture();
    const telDir2 = join(fx2.cfg1, "telemetry");
    chmodRestore.push(telDir2);
    chmodSync(telDir2, 0o555);
    const r = await runCleanup({ ...opts(fx2), delete: true });
    expect(r.exitCode).not.toBe(0);
    for (const p of [fx2.f.telA1, fx2.f.telA3, fx2.f.telA6]) expect(r.output).toContain(p);
  });

  test(
    "CLI front door: a survivor makes --delete exit non-zero and name it",
    () => {
      const fx = makeFixture();
      holdForReal(fx);
      const telDir = join(fx.cfg1, "telemetry");
      chmodRestore.push(telDir);
      chmodSync(telDir, 0o555);
      const del = cli(fx, ["--delete"]);
      expect(del.code).not.toBe(0);
      expect(del.code).not.toBeNull();
      expect(del.out).toContain(fx.f.telA1);
      expect(existsSync(fx.f.tA1)).toBe(false);
    },
    CLI_TIMEOUT,
  );
});

// ===========================================================================
// AC-STE-593.5 — token-ledger compare-and-swap
// ===========================================================================

describe("AC-STE-593.5 — token-ledger rows are removed by a compare-and-swap rewrite", () => {
  const otherLines = (fx: Fixture) => fx.ledgerLines.filter((_, i) => !fx.runLedgerLineIdx.includes(i));
  const noTmpLeft = (fx: Fixture) =>
    readdirSync(dirname(fx.ledgerFile)).filter((n) => n !== basename(fx.ledgerFile) && /tmp/i.test(n));

  test("without interference: one attempt, run rows gone, every other line byte-for-byte", async () => {
    const fx = makeFixture();
    const res = await rewriteLedgerCAS(fx.ledgerFile, new Set(runASids(fx)));
    expect(res.attempts).toBe(1);
    expect(res.dropped).toBe(3);
    expect(readFileSync(fx.ledgerFile, "utf8")).toBe(`${otherLines(fx).join("\n")}\n`);
    expect(noTmpLeft(fx)).toEqual([]);
  });

  test("a hook write between read and swap forces a retry; the written row survives, run rows do not", async () => {
    const fx = makeFixture();
    const intruder = JSON.stringify({ session_id: "11111111-2222-3333-4444-555555555555", input_tokens: 99 });
    const lateRunRow = JSON.stringify({ session_id: fx.sid.A2, input_tokens: 77 });
    let calls = 0;
    const res = await rewriteLedgerCAS(fx.ledgerFile, new Set(runASids(fx)), {
      beforeSwap: () => {
        calls += 1;
        if (calls === 1) appendFileSync(fx.ledgerFile, `${intruder}\n${lateRunRow}\n`);
      },
    });
    expect(calls).toBe(2);
    expect(res.attempts).toBe(2);
    expect(readFileSync(fx.ledgerFile, "utf8")).toBe(`${[...otherLines(fx), intruder].join("\n")}\n`);
    expect(noTmpLeft(fx)).toEqual([]);
  });

  test("a ledger that never stops changing is not rewritten: bounded retries, then an error", async () => {
    const fx = makeFixture();
    let calls = 0;
    let err: unknown;
    try {
      await rewriteLedgerCAS(fx.ledgerFile, new Set(runASids(fx)), {
        maxAttempts: 3,
        beforeSwap: () => {
          calls += 1;
          appendFileSync(fx.ledgerFile, `${JSON.stringify({ session_id: `busy-${calls}` })}\n`);
        },
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Error);
    expect(calls).toBe(3);
    const busy = [1, 2, 3].map((n) => JSON.stringify({ session_id: `busy-${n}` }));
    expect(readFileSync(fx.ledgerFile, "utf8")).toBe(`${[...fx.ledgerLines, ...busy].join("\n")}\n`);
    expect(noTmpLeft(fx)).toEqual([]);
  });

  test("front door: dry run leaves the ledger byte-identical; delete leaves zero run rows, others unchanged", async () => {
    const fx = makeFixture();
    const raw = readFileSync(fx.ledgerFile);
    await runCleanup(opts(fx));
    expect(readFileSync(fx.ledgerFile).equals(raw)).toBe(true);

    const r = await runCleanup({ ...opts(fx), delete: true });
    expect(r.exitCode).toBe(0);
    expect(readFileSync(fx.ledgerFile, "utf8")).toBe(`${otherLines(fx).join("\n")}\n`);
  });
});

// ===========================================================================
// AC-STE-593.6 — manual mode for pre-ledger runs
// ===========================================================================

describe("AC-STE-593.6 — manual mode plans whole dpt-test-project-* transcript dirs in the window", () => {
  test("plans the in-window dir with its sessions' session-env, telemetry and MCP logs; not the live or old one", async () => {
    const fx = makeFixture();
    const plan = await buildPlan(opts(fx, { sessionIds: [], manual: true }));
    const paths = plan.entries.map((e) => e.path);
    expect(paths).toContain(fx.dptDirs.L);
    for (const p of [fx.f.seG1, fx.f.seG1b, fx.f.telG1, fx.f.mcpG1]) {
      expect({ p, covered: isCovered(plan.entries, p) }).toEqual({ p, covered: true });
    }
    // a dir holding a live session, and a dir born before the window, stay whole
    for (const p of [fx.dptDirs.J, fx.f.tG2, fx.f.seG2, fx.f.regG2, fx.dptDirs.N, fx.f.tG3, fx.f.seG3]) {
      expect({ p, covered: isCovered(plan.entries, p) }).toEqual({ p, covered: false });
    }
    // no entry swallows the config dir's projects root or a non-dpt project dir
    expect(isCovered(plan.entries, fx.f.tB1)).toBe(false);
    expect(isCovered(plan.entries, fx.f.tI1)).toBe(false);
  });

  test("without manual mode the same window plans no dpt-test-project-* dir or its sessions' files", async () => {
    const fx = makeFixture();
    const plan = await buildPlan(opts(fx, { sessionIds: [] }));
    for (const p of [fx.dptDirs.L, fx.f.tG1, fx.f.tG1b, fx.f.seG1, fx.f.telG1, fx.f.mcpG1]) {
      expect({ p, covered: isCovered(plan.entries, p) }).toEqual({ p, covered: false });
    }
  });
});

// ===========================================================================
// AC-STE-593.7 — the report names what it deliberately leaves
// ===========================================================================

describe("AC-STE-593.7 — the report names what it deliberately leaves", () => {
  test("dry run and delete both name cmux registry rows, workstream lines, OS crash reports, the bun install cache", async () => {
    const fx = makeFixture();
    const dry = await runCleanup(opts(fx));
    const del = await runCleanup({ ...opts(fx), delete: true });
    for (const out of [dry.output, del.output]) {
      expect(out).toMatch(/cmux registry/i);
      expect(out).toMatch(/workstream/i);
      expect(out).toMatch(/crash report/i);
      expect(out).toMatch(/bun install cache/i);
    }
  });

  test("the left stores are left: registry rows and workstream lines naming run sessions stay byte-identical", async () => {
    const fx = makeFixture();
    const keep = [fx.f.cmuxReg, fx.f.cmuxWs, fx.f.crash, fx.f.bunCache].map((p) => [p, readFileSync(p, "utf8")]);
    const r = await runCleanup({ ...opts(fx), delete: true });
    expect(r.exitCode).toBe(0);
    for (const [p, body] of keep) expect({ p, body: readFileSync(p, "utf8") }).toEqual({ p, body });
    expect(existsSync(fx.f.cmuxTmp)).toBe(false);
  });
});

// ===========================================================================
// AC-STE-593.8 — tandem fixture
// ===========================================================================

describe("AC-STE-593.8 — cleaning run A leaves run B, the interactive and live sessions, and A's findings alone", () => {
  function untouched(fx: Fixture): string[] {
    return [
      ...fx.owned.B1,
      ...fx.owned.I1,
      ...fx.owned.L1,
      ...fx.owned.N1,
      ...fx.owned.G1,
      ...fx.owned.G1b,
      ...fx.owned.G2,
      fx.f.findings,
      fx.f.approval,
      fx.f.cmuxReg,
      fx.f.cmuxWs,
      fx.f.tmpHeld,
      fx.f.cmuxTmpHeld,
      fx.f.lockHeld,
      fx.f.snapNamed,
    ];
  }

  function expectUntouched(fx: Fixture, before: Map<string, string>): void {
    const paths = untouched(fx);
    const after = snapshotTree(fx.home);
    for (const [p, v] of before) {
      if (!under(p, paths)) continue;
      expect({ p, v: after.get(p) }).toEqual({ p, v });
    }
    const ledger = readFileSync(fx.ledgerFile, "utf8").split("\n");
    for (const k of ["B1", "I1", "L1", "N1"] as SidKey[]) {
      const rows = fx.ledgerLines.filter((l) => l.includes(fx.sid[k]));
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) expect(ledger).toContain(row);
    }
  }

  test("ledger scope (the Termination call): run A's recorded sessions only, no window", async () => {
    const fx = makeFixture();
    const before = snapshotTree(fx.home);
    const r = await runCleanup({
      roots: fx.roots,
      sessionIds: [fx.sid.A1, fx.sid.A3, fx.sid.L1],
      probes: fakeProbes(fx),
      delete: true,
    });
    expect(r.exitCode).toBe(0);
    for (const p of [...fx.owned.A1.filter((p) => p !== fx.f.regA1dead), ...fx.owned.A3]) {
      expect({ p, exists: existsSync(p) }).toEqual({ p, exists: false });
    }
    expectUntouched(fx, before);
    const ledger = readFileSync(fx.ledgerFile, "utf8");
    expect(ledger.includes(fx.sid.A1) || ledger.includes(fx.sid.A3)).toBe(false);
  });

  test("window scope with run B kept: all of run A goes, everyone else's files stay byte-identical", async () => {
    const fx = makeFixture();
    const before = snapshotTree(fx.home);
    const r = await runCleanup({ ...opts(fx), delete: true });
    expect(r.exitCode).toBe(0);
    for (const k of RUN_A) {
      for (const p of fx.owned[k].filter((p) => p !== fx.f.regA1dead)) {
        expect({ p, exists: existsSync(p) }).toEqual({ p, exists: false });
      }
    }
    expectUntouched(fx, before);
  });
});

// ===========================================================================
// AC-STE-593.2 + AC-STE-593.8 — the orphan classes are owned by the run
// ===========================================================================
//
// The four stores that carry no session id — config temps, plugin orphans,
// cmux temps, zcompdump locks — are attributed by birth time and liveness only.
// Without a window nothing ties them to the run, so a ledger-only cleanup (the
// per-leg Termination call) must never touch them; with one, only entries born
// inside it belong to the run. A config temp also needs its writer dead: an
// unheld temp is not an orphan in the instant between a live writer's close()
// and its rename().

const ID_LESS: PlanClass[] = ["config_temps", "plugin_orphans", "cmux_tmp", "zcompdump_locks"] as PlanClass[];

/** One out-of-window orphan per id-less store, each shaped like its store's real ones. */
function outOfWindowOrphans(fx: Fixture): Record<string, string> {
  const OUT = fx.window.startMs - 3 * HOUR;
  const mkt = join(fx.cfg1, "plugins", "marketplaces", "old-mkt.bak");
  put(join(mkt, "config.lock"), "", OUT);
  stamp(mkt, OUT);
  return {
    config_temps: put(join(fx.cfg1, ".claude.json.tmp.4000203.0ld0ld"), "{}", OUT),
    plugin_orphans: mkt,
    cmux_tmp: put(join(fx.cmux, "claude-hook-sessions.json.4000303.tmp"), "{}", OUT),
    zcompdump_locks: emptyDir(join(fx.home, ".zcompdump-old-5.9.lock"), OUT),
  };
}

describe("AC-STE-593.2 / AC-STE-593.8 — the orphan classes are owned by the run: window + liveness", () => {
  for (const cls of ID_LESS) {
    test(`planner ${cls}: without a window nothing is planned, though the same entries are planned with one`, async () => {
      const fx = makeFixture();
      expect(fx.expected[cls].length).toBeGreaterThan(0);
      // Polarity first: the window plans them, so an empty planner cannot pass.
      expect(sorted(await PLANNERS[cls](ctx(fx)))).toEqual(sorted(fx.expected[cls]));
      expect(await PLANNERS[cls](ctx(fx, { window: undefined }))).toEqual([]);
    });
  }

  test("an orphan born outside the window is not planned, in any of the four stores", async () => {
    const fx = makeFixture();
    const old = outOfWindowOrphans(fx);
    for (const cls of ID_LESS) {
      const got = await PLANNERS[cls](ctx(fx, { probes: fakeProbes(fx, { isHeld: () => false }) }));
      expect({ cls, listed: got.includes(old[cls]!) }).toEqual({ cls, listed: false });
      expect(got).toEqual(expect.arrayContaining(fx.expected[cls]));
    }
  });

  test("a config temp whose writer is still alive is not planned, though no process holds it open", async () => {
    const fx = makeFixture();
    const writer = fx.live.L1.pid as number;
    const racing = put(join(fx.cfg1, `.claude.json.tmp.${writer}.r4c1ng`), "{}", fx.window.startMs + HOUR);
    const got = await PLANNERS.config_temps(ctx(fx, { probes: fakeProbes(fx, { isHeld: () => false }) }));
    expect(got).not.toContain(racing);
    // Polarity: a dead writer's unheld temp, born in the same window, still is.
    expect(got).toContain(fx.f.tmpOrphan);
  });

  test("front door, ledger scope (the Termination call): run A's in-window orphans in all four stores survive", async () => {
    const fx = makeFixture();
    const orphans = ID_LESS.flatMap((c) => fx.expected[c]);
    const r = await runCleanup({
      roots: fx.roots,
      sessionIds: [fx.sid.A1, fx.sid.A3, fx.sid.L1],
      probes: fakeProbes(fx),
      delete: true,
    });
    expect(r.exitCode).toBe(0);
    for (const p of orphans) expect({ p, exists: existsSync(p) }).toEqual({ p, exists: true });
    for (const cls of ID_LESS) expect(r.output).toMatch(new RegExp(`^\\s*${cls} count=0 bytes=0$`, "m"));
    // Polarity: the same call still removed run A's sid-keyed files.
    expect(existsSync(fx.f.tA1)).toBe(false);
  });

  test("front door, window scope: out-of-window orphans survive while run A's in-window ones go", async () => {
    const fx = makeFixture();
    const old = outOfWindowOrphans(fx);
    const r = await runCleanup({ ...opts(fx), delete: true });
    expect(r.exitCode).toBe(0);
    for (const p of Object.values(old)) expect({ p, exists: existsSync(p) }).toEqual({ p, exists: true });
    for (const p of ID_LESS.flatMap((c) => fx.expected[c])) {
      expect({ p, exists: existsSync(p) }).toEqual({ p, exists: false });
    }
  });
});
