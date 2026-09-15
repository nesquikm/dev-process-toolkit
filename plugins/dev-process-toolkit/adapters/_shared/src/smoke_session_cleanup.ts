// smoke_session_cleanup — STE-593.
//
// A smoke run's session debris is found by identity and removed by exact path.
//
// AC-STE-593.1 — the run set. It is the union of the run's spawn-ledger
// session ids and, when a window is given, ids inferred from it; a session
// registered live (`sessions/<pid>.json` whose pid answers `kill -0`) or passed
// as kept is never in it. Inference admits a session born inside the window
// when either
//   (a) its transcript's entrypoint is `sdk-cli` and its first user message
//       invokes `/smoke-test`, or
//   (b) it has no transcript in any config dir, and its only evidence is an
//       empty `session-env` dir, an MCP log whose `cwd` is a run cwd, or a
//       telemetry file whose events are `sdk-cli` and non-interactive. One piece
//       of evidence outside those three shapes disqualifies the session.
// A session's birth is the earliest timestamp its evidence carries.

import { spawnSync } from "node:child_process";
import {
  chmodSync,
  closeSync,
  type Dirent,
  lstatSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { ledgerPath } from "./dpt_paths";

// ---------------------------------------------------------------------------
// types
// ---------------------------------------------------------------------------

/** The ten path stores, in the FR's order. The token ledger is not a path store. */
export const PLAN_CLASSES = [
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
] as const;
export type PlanClass = (typeof PLAN_CLASSES)[number];

export interface CleanupRoots {
  /** Every Claude Code config dir in play (e.g. `~/.claude-st`, `~/.claude`). */
  configDirs: string[];
  /** The CLI cache root holding `<cwd-slug>/mcp-logs-<server>/` dirs. */
  cacheRoot: string;
  homeDir: string;
  cmuxDir: string;
  projectRoot: string;
}

export interface CleanupWindow {
  startMs: number;
  endMs: number;
}

export interface CleanupProbes {
  /** `kill -0 pid`: true while the pid exists (EPERM counts as alive). */
  isAlive: (pid: number) => boolean;
  /** Every live process's command line. */
  commandLines: () => string[];
  /** True when some process holds the path open (or has it as its cwd). */
  isHeld: (path: string) => boolean;
}

export interface CleanupOptions {
  roots: CleanupRoots;
  /** The run's spawn-ledger session ids. */
  sessionIds?: string[];
  /** Session ids that never enter the set. */
  kept?: string[];
  /** Without a window nothing is inferred. */
  window?: CleanupWindow;
  /** Cwds the run's sessions ran in (rule (b)'s MCP-log evidence keys on them). */
  runCwds?: string[];
  manual?: boolean;
  probes?: CleanupProbes;
  delete?: boolean;
}

export interface PlanContext {
  roots: CleanupRoots;
  runSet: Set<string>;
  window?: CleanupWindow;
  manual?: boolean;
  probes: CleanupProbes;
}

export interface PlanEntry {
  cls: PlanClass;
  path: string;
  bytes: number;
}

export interface Plan {
  runSet: Set<string>;
  entries: PlanEntry[];
  /** The context the plan was built in: the executor re-validates every entry against it. */
  roots: CleanupRoots;
  window?: CleanupWindow;
  manual?: boolean;
}

export type Planner = (ctx: PlanContext) => Promise<string[]>;

// ---------------------------------------------------------------------------
// probes
// ---------------------------------------------------------------------------

function isAlive(pid: number): boolean {
  // kill(0) and negative pids signal process groups — never probe those.
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

function commandLines(): string[] {
  const r = spawnSync("ps", ["-axo", "command="], { encoding: "utf8" });
  if (r.status !== 0 || typeof r.stdout !== "string") return [];
  return r.stdout.split("\n").filter((l) => l.trim().length > 0);
}

function isHeld(path: string): boolean {
  const r = spawnSync("lsof", ["-t", "--", path], { encoding: "utf8" });
  return r.status === 0 && typeof r.stdout === "string" && r.stdout.trim().length > 0;
}

export function defaultProbes(): CleanupProbes {
  return { isAlive, commandLines, isHeld };
}

// ---------------------------------------------------------------------------
// fs helpers
// ---------------------------------------------------------------------------

function listDir(dir: string): Dirent[] {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function readText(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/** Up to `max` bytes from the head of a file, cut back to the last whole line. */
function readHead(path: string, max = 1 << 20): string | null {
  let fd: number;
  try {
    fd = openSync(path, "r");
  } catch {
    return null;
  }
  try {
    const buf = Buffer.alloc(max);
    const n = readSync(fd, buf, 0, max, 0);
    const text = buf.subarray(0, n).toString("utf8");
    if (n < max) return text;
    const cut = text.lastIndexOf("\n");
    return cut < 0 ? "" : text.slice(0, cut);
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}

function jsonLines(text: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const v = JSON.parse(line);
      if (v && typeof v === "object" && !Array.isArray(v)) out.push(v as Record<string, unknown>);
    } catch {}
  }
  return out;
}

function timeOf(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? null : ms;
}

const inWindow = (ms: number, w: CleanupWindow) => ms >= w.startMs && ms <= w.endMs;

/** The smallest of the times, or null for none (no spread: a long list cannot overflow the stack). */
function earliest(times: number[]): number | null {
  return times.reduce<number | null>((min, t) => (min === null || t < min ? t : min), null);
}

function mtimeOf(path: string): number | null {
  try {
    return lstatSync(path).mtimeMs;
  } catch {
    return null;
  }
}

function isRealDir(path: string): boolean {
  try {
    return lstatSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** `<sid>.jsonl` → `<sid>`; any other name → null. */
function transcriptSid(name: string): string | null {
  return name.endsWith(".jsonl") ? name.slice(0, -".jsonl".length) : null;
}

/** `telemetry/1p_failed_events.<sid>.*` — capture 1 is the session id. */
const TELEMETRY = /^1p_failed_events\.([^.]+)\./;

/** Every `<cfg>/projects/<slug>/` dir across the config dirs. */
function projectDirs(configDirs: string[]): string[] {
  const out: string[] = [];
  for (const cfg of configDirs) {
    const projects = join(cfg, "projects");
    for (const slug of listDir(projects)) if (slug.isDirectory()) out.push(join(projects, slug.name));
  }
  return out;
}

/** Every file under `<cacheRoot>/<slug>/mcp-logs-<server>/`. */
function mcpLogFiles(cacheRoot: string): string[] {
  const out: string[] = [];
  for (const slug of listDir(cacheRoot)) {
    if (!slug.isDirectory()) continue;
    const slugDir = join(cacheRoot, slug.name);
    for (const server of listDir(slugDir)) {
      if (!server.isDirectory() || !server.name.startsWith("mcp-logs-")) continue;
      const logDir = join(slugDir, server.name);
      for (const e of listDir(logDir)) if (e.isFile()) out.push(join(logDir, e.name));
    }
  }
  return out;
}

/** The session id an MCP log is attributed to: its first line's `sessionId`. */
function firstSessionId(lines: Record<string, unknown>[]): string | undefined {
  return lines.find((l) => typeof l.sessionId === "string")?.sessionId as string | undefined;
}

// ---------------------------------------------------------------------------
// liveness
// ---------------------------------------------------------------------------

/** One live entry of the session registry: `<cfg>/sessions/<pid>.json` whose pid answers `kill -0`. */
interface LiveRegistryRow {
  sessionId: unknown;
  startedAt: unknown;
}

/**
 * Every LIVE registry entry across the config dirs. The one reader of the registry's
 * on-disk shape (the JSON `pid`, else the file name's stem), so a change to that
 * shape lands in one place for every caller.
 */
function liveRegistryRows(configDirs: readonly string[], probes: Pick<CleanupProbes, "isAlive">): LiveRegistryRow[] {
  const out: LiveRegistryRow[] = [];
  for (const cfg of configDirs) {
    const dir = join(cfg, "sessions");
    for (const e of listDir(dir)) {
      if (!e.name.endsWith(".json")) continue;
      const text = readText(join(dir, e.name));
      if (text === null) continue;
      let row: { pid?: unknown; sessionId?: unknown; startedAt?: unknown };
      try {
        row = JSON.parse(text);
      } catch {
        continue;
      }
      if (!row || typeof row !== "object") continue;
      const pid = typeof row.pid === "number" ? row.pid : Number(e.name.slice(0, -".json".length));
      if (probes.isAlive(pid)) out.push({ sessionId: row.sessionId, startedAt: row.startedAt });
    }
  }
  return out;
}

/** Session ids registered in any config dir's `sessions/<pid>.json` whose pid answers `kill -0`. */
export async function readLiveSessionIds(
  configDirs: string[],
  probes: Pick<CleanupProbes, "isAlive"> = defaultProbes(),
): Promise<Set<string>> {
  const live = new Set<string>();
  for (const row of liveRegistryRows(configDirs, probes)) {
    if (typeof row.sessionId === "string") live.add(row.sessionId);
  }
  return live;
}

/** The run set minus sessions that have gone live since it was built. */
function withoutLive(runSet: Set<string>, live: Set<string>): Set<string> {
  return new Set([...runSet].filter((sid) => !live.has(sid)));
}

// ---------------------------------------------------------------------------
// window inference
// ---------------------------------------------------------------------------

interface TranscriptIndex {
  /** Every sid with a transcript file or transcript subdir in any config dir. */
  sids: Set<string>;
  files: { sid: string; path: string }[];
}

function indexTranscripts(configDirs: string[]): TranscriptIndex {
  const sids = new Set<string>();
  const files: { sid: string; path: string }[] = [];
  for (const dir of projectDirs(configDirs)) {
    for (const e of listDir(dir)) {
      const sid = e.isFile() ? transcriptSid(e.name) : null;
      if (sid !== null) {
        sids.add(sid);
        files.push({ sid, path: join(dir, e.name) });
      } else if (e.isDirectory()) {
        sids.add(e.name);
      }
    }
  }
  return { sids, files };
}

function userText(line: Record<string, unknown>): string {
  const msg = line.message as { content?: unknown } | undefined;
  const content = msg?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((c) => (c && typeof c === "object" && (c as { type?: unknown }).type === "text" ? (c as { text?: unknown }).text : ""))
    .filter((t): t is string => typeof t === "string")
    .join("\n");
}

function invokesSmokeTest(text: string): boolean {
  return /^\s*\/smoke-test(?:\s|$)/.test(text) || /<command-name>\/smoke-test<\/command-name>/.test(text);
}

/** Rule (a): born in the window, entrypoint `sdk-cli`, first user message invokes `/smoke-test`. */
function ruleA(path: string, w: CleanupWindow): boolean {
  // A file's mtime is never before the session's birth.
  try {
    if (statSync(path).mtimeMs < w.startMs) return false;
  } catch {
    return false;
  }
  const head = readHead(path);
  if (head === null) return false;
  let birth: number | null = null;
  const entrypoints: unknown[] = [];
  for (const line of jsonLines(head)) {
    const t = timeOf(line.timestamp);
    if (t !== null && (birth === null || t < birth)) birth = t;
    if ("entrypoint" in line) entrypoints.push(line.entrypoint);
    if (line.type === "user" && line.isMeta !== true) {
      return (
        birth !== null &&
        inWindow(birth, w) &&
        entrypoints.length > 0 &&
        entrypoints.every((e) => e === "sdk-cli") &&
        invokesSmokeTest(userText(line))
      );
    }
  }
  return false;
}

interface Evidence {
  births: number[];
  disqualified: boolean;
}

/** Rule (b): transcript-less sessions whose every piece of evidence has an admitted shape. */
function ruleB(roots: CleanupRoots, transcriptSids: Set<string>, runCwds: string[], w: CleanupWindow): string[] {
  const ev = new Map<string, Evidence>();
  const note = (sid: string, birth: number | null, ok: boolean) => {
    if (transcriptSids.has(sid)) return;
    const cur = ev.get(sid) ?? { births: [], disqualified: false };
    if (birth !== null) cur.births.push(birth);
    if (!ok || birth === null) cur.disqualified = true;
    ev.set(sid, cur);
  };

  for (const cfg of roots.configDirs) {
    // empty session-env dirs
    const se = join(cfg, "session-env");
    for (const e of listDir(se)) {
      if (transcriptSids.has(e.name)) continue;
      const p = join(se, e.name);
      let birth: number | null = null;
      let ok = false;
      try {
        const st = lstatSync(p);
        birth = st.mtimeMs;
        ok = st.isDirectory() && readdirSync(p).length === 0;
      } catch {}
      note(e.name, birth, ok);
    }

    // telemetry files: every event sdk-cli and non-interactive
    const tel = join(cfg, "telemetry");
    for (const e of listDir(tel)) {
      const sid = TELEMETRY.exec(e.name)?.[1];
      if (!sid || transcriptSids.has(sid)) continue;
      const text = e.isFile() ? readText(join(tel, e.name)) : null;
      const events = text === null ? [] : jsonLines(text).map((l) => l.event_data as Record<string, unknown> | undefined);
      const ok =
        events.length > 0 && events.every((d) => !!d && d.entrypoint === "sdk-cli" && d.is_interactive === false);
      const times = events.map((d) => timeOf(d?.client_timestamp)).filter((t): t is number => t !== null);
      note(sid, earliest(times), ok);
    }
  }

  // MCP logs: attributed to their first sessionId; every cwd must be a run cwd
  const cwds = new Set(runCwds);
  for (const path of mcpLogFiles(roots.cacheRoot)) {
    const text = readText(path);
    if (text === null) continue;
    const lines = jsonLines(text);
    const sid = firstSessionId(lines);
    if (!sid) continue;
    const seen = lines.map((l) => l.cwd).filter((c) => c !== undefined);
    const ok = seen.length > 0 && seen.every((c) => typeof c === "string" && cwds.has(c));
    const times = lines.map((l) => timeOf(l.timestamp)).filter((t): t is number => t !== null);
    note(sid, earliest(times), ok);
  }

  const admitted: string[] = [];
  for (const [sid, e] of ev) {
    const birth = e.disqualified ? null : earliest(e.births);
    if (birth !== null && inWindow(birth, w)) admitted.push(sid);
  }
  return admitted;
}

// ---------------------------------------------------------------------------
// manual mode — AC-STE-593.6
// ---------------------------------------------------------------------------
//
// A pre-ledger run's grandchildren ran in `dpt-test-project-*` cwds. Manual mode
// takes such a transcript dir whole when every session in it was born inside
// the window and none of them is live or kept: its sessions join the run set,
// and the transcript planner lists the dir itself instead of its children.

const DPT_SLUG = /-dpt-test-project-./;
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface DptDir {
  dir: string;
  /** Session id → birth (earliest transcript timestamp, else the entry's mtime). */
  births: Map<string, number | null>;
}

function transcriptBirth(path: string): number | null {
  const times = jsonLines(readHead(path) ?? "")
    .map((l) => timeOf(l.timestamp))
    .filter((t): t is number => t !== null);
  return earliest(times) ?? mtimeOf(path);
}

/** Every `<cfg>/projects/<slug>/` whose slug is a `dpt-test-project-*` cwd, with its sessions. */
function dptDirs(configDirs: string[]): DptDir[] {
  const out: DptDir[] = [];
  for (const dir of projectDirs(configDirs)) {
    const slug = dir.slice(dir.lastIndexOf("/") + 1);
    if (!DPT_SLUG.test(slug) || !isRealDir(dir)) continue;
    const births = new Map<string, number | null>();
    for (const e of listDir(dir)) {
      const p = join(dir, e.name);
      const sid = e.isFile() ? transcriptSid(e.name) : null;
      if (sid !== null) {
        if (SESSION_ID.test(sid)) births.set(sid, transcriptBirth(p));
      } else if (e.isDirectory() && SESSION_ID.test(e.name) && !births.has(e.name)) {
        births.set(e.name, mtimeOf(p));
      }
    }
    out.push({ dir, births });
  }
  return out;
}

/** Sessions of the dpt dirs born wholly in the window with no live or kept session. */
function manualSessions(configDirs: string[], w: CleanupWindow, excluded: Set<string>): Set<string> {
  const out = new Set<string>();
  for (const d of dptDirs(configDirs)) {
    const sids = [...d.births.keys()];
    if (sids.length === 0 || sids.some((s) => excluded.has(s))) continue;
    if (![...d.births.values()].every((b) => b !== null && inWindow(b, w))) continue;
    for (const s of sids) out.add(s);
  }
  return out;
}

/** In manual mode, the dpt dirs every one of whose sessions is in the run set. */
function wholeDptDirs(ctx: PlanContext): Set<string> {
  const out = new Set<string>();
  if (!ctx.manual) return out;
  for (const d of dptDirs(ctx.roots.configDirs)) {
    const sids = [...d.births.keys()];
    if (sids.length > 0 && sids.every((s) => ctx.runSet.has(s))) out.add(d.dir);
  }
  return out;
}

function inferWindowSessions(roots: CleanupRoots, w: CleanupWindow, runCwds: string[]): Set<string> {
  const idx = indexTranscripts(roots.configDirs);
  const out = new Set<string>();
  for (const t of idx.files) if (ruleA(t.path, w)) out.add(t.sid);
  for (const sid of ruleB(roots, idx.sids, runCwds, w)) out.add(sid);
  return out;
}

// ---------------------------------------------------------------------------
// run set
// ---------------------------------------------------------------------------

/** Ledger ids ∪ window-inferred ids, minus live and kept sessions. */
export async function buildRunSet(opts: CleanupOptions): Promise<Set<string>> {
  const probes = opts.probes ?? defaultProbes();
  const set = new Set<string>(opts.sessionIds ?? []);
  const live = await readLiveSessionIds(opts.roots.configDirs, probes);
  if (opts.window) {
    for (const sid of inferWindowSessions(opts.roots, opts.window, opts.runCwds ?? [])) set.add(sid);
    if (opts.manual) {
      const excluded = new Set([...live, ...(opts.kept ?? [])]);
      for (const sid of manualSessions(opts.roots.configDirs, opts.window, excluded)) set.add(sid);
    }
  }
  for (const sid of live) set.delete(sid);
  for (const sid of opts.kept ?? []) set.delete(sid);
  return set;
}

// ---------------------------------------------------------------------------
// planners — AC-STE-593.2
// ---------------------------------------------------------------------------
//
// One planner per store: a directory listing in, the paths the run set owns out.
// Symlinks are never planned. `.claude.json` and every `.claude.json.bak*` match
// no planner's shape, so they are never planned.

const planTranscripts: Planner = async (ctx) => {
  const { roots, runSet } = ctx;
  const whole = wholeDptDirs(ctx);
  const out: string[] = [...whole];
  for (const dir of projectDirs(roots.configDirs)) {
    if (whole.has(dir)) continue;
    for (const e of listDir(dir)) {
      const sid = e.isFile() ? transcriptSid(e.name) : null;
      if (sid !== null && runSet.has(sid)) out.push(join(dir, e.name));
    }
  }
  return out;
};

const planTranscriptSubdirs: Planner = async (ctx) => {
  const { roots, runSet } = ctx;
  const whole = wholeDptDirs(ctx);
  const out: string[] = [];
  for (const dir of projectDirs(roots.configDirs)) {
    if (whole.has(dir)) continue;
    for (const e of listDir(dir)) if (e.isDirectory() && runSet.has(e.name)) out.push(join(dir, e.name));
  }
  return out;
};

const planSessionEnv: Planner = async ({ roots, runSet }) => {
  const out: string[] = [];
  for (const cfg of roots.configDirs) {
    const dir = join(cfg, "session-env");
    for (const e of listDir(dir)) if (e.isDirectory() && runSet.has(e.name)) out.push(join(dir, e.name));
  }
  return out;
};

const planTelemetry: Planner = async ({ roots, runSet }) => {
  const out: string[] = [];
  for (const cfg of roots.configDirs) {
    const dir = join(cfg, "telemetry");
    for (const e of listDir(dir)) {
      const sid = TELEMETRY.exec(e.name)?.[1];
      if (e.isFile() && sid && runSet.has(sid)) out.push(join(dir, e.name));
    }
  }
  return out;
};

const planMcpLogs: Planner = async ({ roots, runSet }) => {
  const out: string[] = [];
  for (const path of mcpLogFiles(roots.cacheRoot)) {
    const head = readHead(path, 1 << 16);
    if (head === null) continue;
    const sid = firstSessionId(jsonLines(head));
    if (sid && runSet.has(sid)) out.push(path);
  }
  return out;
};

/** A snapshot's birth: the epoch-ms its name carries, else its mtime. */
function snapshotBirth(path: string, name: string): number | null {
  const m = /-(\d{12,})-[^-]*$/.exec(name.replace(/\.[^.]+$/, ""));
  return m ? Number(m[1]) : mtimeOf(path);
}

/**
 * The earliest `startedAt` (epoch ms) of any session registered live in any config
 * dir, or null when none is. Parsed exactly as `readLiveSessionIds` parses the
 * registry; an entry without a numeric `startedAt` contributes nothing.
 */
function earliestLiveStart(configDirs: readonly string[], probes: Pick<CleanupProbes, "isAlive">): number | null {
  const starts: number[] = [];
  for (const row of liveRegistryRows(configDirs, probes)) {
    if (typeof row.startedAt === "number") starts.push(row.startedAt);
  }
  return earliest(starts);
}

const planShellSnapshots: Planner = async ({ roots, window, probes }) => {
  // No session id: attributed by birth time and liveness only — no window, nothing.
  if (!window) return [];
  const lines = probes.commandLines();
  // A live session names its snapshot only while one of its Bash calls runs;
  // between calls nothing does, so "named by no live command line" cannot tell an
  // idle live session's snapshot from an orphan. A snapshot carries no session id,
  // so keep every one born at or after the earliest live session's start: it may
  // be that session's. This only ever deletes less.
  const liveFrom = earliestLiveStart(roots.configDirs, probes);
  const out: string[] = [];
  for (const cfg of roots.configDirs) {
    const dir = join(cfg, "shell-snapshots");
    for (const e of listDir(dir)) {
      if (!e.isFile() || !e.name.startsWith("snapshot-")) continue;
      const path = join(dir, e.name);
      const birth = snapshotBirth(path, e.name);
      if (birth === null || !inWindow(birth, window)) continue;
      if (liveFrom !== null && birth >= liveFrom) continue;
      if (lines.some((l) => l.includes(e.name))) continue;
      out.push(path);
    }
  }
  return out;
};

// The four stores below carry no session id, so like the shell snapshots they
// are attributed by birth time and liveness only: without a window nothing ties
// them to the run — a ledger-only cleanup (the per-leg Termination call) never
// touches them — and with one only entries born inside it are the run's.

/** An orphan's birth: the earliest mtime of the path and, for a dir, its direct entries. */
function orphanBirth(path: string): number | null {
  const times: number[] = [];
  const own = mtimeOf(path);
  if (own !== null) times.push(own);
  if (isRealDir(path)) {
    for (const e of listDir(path)) {
      const t = mtimeOf(join(path, e.name));
      if (t !== null) times.push(t);
    }
  }
  return earliest(times);
}

const bornIn = (path: string, window: CleanupWindow) => {
  const birth = orphanBirth(path);
  return birth !== null && inWindow(birth, window);
};

const CONFIG_TEMP = /^\.claude\.json\.tmp\.(\d+)\./;

const planConfigTemps: Planner = async ({ roots, window, probes }) => {
  if (!window) return [];
  const out: string[] = [];
  for (const dir of new Set([...roots.configDirs, roots.homeDir])) {
    for (const e of listDir(dir)) {
      const m = e.isFile() ? CONFIG_TEMP.exec(e.name) : null;
      if (!m) continue;
      // Unheld is not orphaned: a live writer's temp is unheld between its
      // close() and its rename(). The pid in the name has to be dead too.
      if (probes.isAlive(Number(m[1]))) continue;
      const path = join(dir, e.name);
      if (bornIn(path, window) && !probes.isHeld(path)) out.push(path);
    }
  }
  return out;
};

/** Raw text of every plugin state file (`<cfg>/plugins/*.json`). */
function pluginStateTexts(cfg: string): string[] {
  const dir = join(cfg, "plugins");
  const out: string[] = [];
  for (const e of listDir(dir)) {
    if (!e.isFile() || !e.name.endsWith(".json")) continue;
    const text = readText(join(dir, e.name));
    if (text !== null) out.push(text);
  }
  return out;
}

const planPluginOrphans: Planner = async ({ roots, window }) => {
  if (!window) return [];
  const out: string[] = [];
  for (const cfg of roots.configDirs) {
    const state = pluginStateTexts(cfg);
    const named = (name: string) => state.some((t) => t.includes(name));
    const candidates: { dir: string; match: (n: string) => boolean }[] = [
      { dir: join(cfg, "plugins", "marketplaces"), match: (n) => n.endsWith(".bak") && n.length > ".bak".length },
      { dir: join(cfg, "plugins", "cache"), match: (n) => n.startsWith("temp_git_") },
    ];
    for (const { dir, match } of candidates) {
      for (const e of listDir(dir)) {
        if (e.isSymbolicLink() || !match(e.name) || named(e.name)) continue;
        const path = join(dir, e.name);
        if (bornIn(path, window)) out.push(path);
      }
    }
  }
  return out;
};

const CMUX_TMP = /^claude-hook-sessions\.json(?:\.[^/]+)?\.tmp$/;

const planCmuxTmp: Planner = async ({ roots, window, probes }) => {
  if (!window) return [];
  const out: string[] = [];
  for (const e of listDir(roots.cmuxDir)) {
    if (!e.isFile() || !CMUX_TMP.test(e.name)) continue;
    const path = join(roots.cmuxDir, e.name);
    if (bornIn(path, window) && !probes.isHeld(path)) out.push(path);
  }
  return out;
};

const planZcompdumpLocks: Planner = async ({ roots, window, probes }) => {
  if (!window) return [];
  const out: string[] = [];
  for (const e of listDir(roots.homeDir)) {
    if (!e.isDirectory() || !/^\.zcompdump-.+\.lock$/.test(e.name)) continue;
    const path = join(roots.homeDir, e.name);
    let empty = false;
    try {
      empty = readdirSync(path).length === 0;
    } catch {}
    if (empty && bornIn(path, window) && !probes.isHeld(path)) out.push(path);
  }
  return out;
};

export const PLANNERS: Record<PlanClass, Planner> = {
  transcripts: planTranscripts,
  transcript_subdirs: planTranscriptSubdirs,
  session_env: planSessionEnv,
  telemetry: planTelemetry,
  mcp_logs: planMcpLogs,
  shell_snapshots: planShellSnapshots,
  config_temps: planConfigTemps,
  plugin_orphans: planPluginOrphans,
  cmux_tmp: planCmuxTmp,
  zcompdump_locks: planZcompdumpLocks,
};

/** Bytes a removal would free: a file's size, a dir's files summed (symlinks not followed). */
function bytesOf(path: string): number {
  try {
    const st = lstatSync(path);
    if (!st.isDirectory()) return st.size;
    return listDir(path).reduce((n, e) => n + bytesOf(join(path, e.name)), 0);
  } catch {
    return 0;
  }
}

/** The run set, then every store's owned paths, each classed and sized. */
export async function buildPlan(opts: CleanupOptions): Promise<Plan> {
  const probes = opts.probes ?? defaultProbes();
  const runSet = await buildRunSet({ ...opts, probes });
  const ctx: PlanContext = { roots: opts.roots, runSet, window: opts.window, manual: opts.manual, probes };
  const entries: PlanEntry[] = [];
  const seen = new Set<string>();
  for (const cls of PLAN_CLASSES) {
    for (const path of await PLANNERS[cls](ctx)) {
      if (seen.has(path)) continue;
      seen.add(path);
      entries.push({ cls, path, bytes: bytesOf(path) });
    }
  }
  return { runSet, entries, roots: opts.roots, window: opts.window, manual: opts.manual };
}

// ---------------------------------------------------------------------------
// executor + front door — AC-STE-593.3
// ---------------------------------------------------------------------------

/** True while anything (a symlink included) sits at the path. */
function present(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * AC-STE-593.4 — removes each planned path by its exact name; no glob is ever
 * expanded. Before anything goes, the live registry is read afresh and every
 * store's rule is re-run over the plan's run set minus the now-live sessions:
 * an entry its own store's rule no longer lists is refused and left in place.
 * Afterwards every planned path is re-listed: what is still there survived.
 */
export async function executePlan(
  plan: Plan,
  opts: { probes?: CleanupProbes },
): Promise<{ removed: PlanEntry[]; refused: PlanEntry[]; survivors: string[] }> {
  const probes = opts.probes ?? defaultProbes();
  const runSet = withoutLive(plan.runSet, await readLiveSessionIds(plan.roots.configDirs, probes));
  const ctx: PlanContext = { roots: plan.roots, runSet, window: plan.window, manual: plan.manual, probes };
  const owned = new Map<PlanClass, Set<string>>();
  for (const cls of new Set(plan.entries.map((e) => e.cls))) {
    const planner = Object.hasOwn(PLANNERS, cls) ? PLANNERS[cls] : undefined;
    owned.set(cls, new Set(planner ? await planner(ctx) : []));
  }

  const refused = new Set<PlanEntry>();
  for (const e of plan.entries) {
    if (!owned.get(e.cls)?.has(e.path)) {
      refused.add(e);
      continue;
    }
    try {
      rmSync(e.path, { recursive: true });
    } catch {}
  }
  const removed: PlanEntry[] = [];
  const survivors: string[] = [];
  for (const e of plan.entries) {
    if (present(e.path)) survivors.push(e.path);
    else if (!refused.has(e)) removed.push(e);
  }
  return { removed, refused: [...refused], survivors };
}

/** One `<class> count=<n> bytes=<b>` line per store, in the FR's order. */
function classReport(entries: PlanEntry[]): string[] {
  return PLAN_CLASSES.map((cls) => {
    const mine = entries.filter((e) => e.cls === cls);
    return `  ${cls} count=${mine.length} bytes=${mine.reduce((n, e) => n + e.bytes, 0)}`;
  });
}

/** The stores the cleanup deliberately never touches, named in every report. */
const LEFT_IN_PLACE = [
  "left in place (deliberately):",
  "  cmux registry rows that name run sessions — never edited while cmux runs",
  "  cmux workstream lines that name run sessions — never edited while cmux runs",
  "  OS crash reports",
  "  the bun install cache",
];

/** Dry run unless `delete`: plan, then either report the plan or remove it and report what went. */
export async function runCleanup(opts: CleanupOptions): Promise<{ exitCode: number; output: string }> {
  const plan = await buildPlan(opts);
  if (!opts.delete) {
    const lines = [
      `smoke-session-cleanup: dry run — nothing deleted; ${plan.runSet.size} session(s) in the run set`,
      "would remove:",
      ...classReport(plan.entries),
      ...LEFT_IN_PLACE,
    ];
    return { exitCode: 0, output: `${lines.join("\n")}\n` };
  }
  const res = await executePlan(plan, { probes: opts.probes });
  const lines = [
    `smoke-session-cleanup: delete; ${plan.runSet.size} session(s) in the run set`,
    "removed:",
    ...classReport(res.removed),
  ];
  if (res.refused.length > 0) {
    lines.push(
      `refused (${res.refused.length}) — no longer owned by the run at delete time:`,
      ...res.refused.map((e) => `  ${e.cls} ${e.path}`),
    );
  }
  if (res.survivors.length > 0) {
    lines.push(`survivors (${res.survivors.length}) — planned but still present:`, ...res.survivors.map((p) => `  ${p}`));
  }
  // The ledger is rewritten for the run set minus whatever went live meanwhile.
  const live = await readLiveSessionIds(plan.roots.configDirs, opts.probes ?? defaultProbes());
  const ledgerSet = withoutLive(plan.runSet, live);
  let ledgerFailed = false;
  try {
    const lr = await rewriteLedgerCAS(ledgerPath(plan.roots.projectRoot), ledgerSet);
    lines.push(`token ledger: ${lr.dropped} run row(s) removed`);
  } catch (e) {
    ledgerFailed = true;
    lines.push(`token ledger: not rewritten — ${(e as Error).message}`);
  }
  lines.push(...LEFT_IN_PLACE);
  return { exitCode: res.survivors.length > 0 || ledgerFailed ? 1 : 0, output: `${lines.join("\n")}\n` };
}

// ---------------------------------------------------------------------------
// token ledger — AC-STE-593.5
// ---------------------------------------------------------------------------

/** Each line of `buf` with its own `\n` (a trailing partial line has none). */
function lineChunks(buf: Buffer): Buffer[] {
  const out: Buffer[] = [];
  let start = 0;
  while (start < buf.length) {
    const nl = buf.indexOf(0x0a, start);
    const end = nl < 0 ? buf.length : nl + 1;
    out.push(buf.subarray(start, end));
    start = end;
  }
  return out;
}

/** The row's `session_id`, or null for a malformed or id-less line. */
function rowSessionId(chunk: Buffer): string | null {
  try {
    const v = JSON.parse(chunk.toString("utf8"));
    return v && typeof v === "object" && typeof v.session_id === "string" ? v.session_id : null;
  } catch {
    return null;
  }
}

/**
 * Drops every ledger row whose `session_id` is in the set by a compare-and-swap
 * rewrite: every other line goes back byte-for-byte into a sibling temp file,
 * the ledger is re-read and compared with what was read, and only an unchanged
 * ledger is swapped by rename. A write in between (a hook appending a row)
 * makes it retry; after `maxAttempts` it throws and the ledger is left as is.
 */
export async function rewriteLedgerCAS(
  ledgerFile: string,
  runSet: Set<string>,
  opts: { maxAttempts?: number; beforeSwap?: () => void } = {},
): Promise<{ attempts: number; dropped: number }> {
  const maxAttempts = opts.maxAttempts ?? 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let before: Buffer;
    let mode: number;
    try {
      before = readFileSync(ledgerFile);
      mode = statSync(ledgerFile).mode & 0o777;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return { attempts: attempt, dropped: 0 };
      throw e;
    }
    const chunks = lineChunks(before);
    const kept = chunks.filter((c) => {
      const sid = rowSessionId(c);
      return sid === null || !runSet.has(sid);
    });
    const dropped = chunks.length - kept.length;
    if (dropped === 0) return { attempts: attempt, dropped: 0 };

    const tmp = `${ledgerFile}.cleanup-${process.pid}-${attempt}.tmp`;
    try {
      writeFileSync(tmp, Buffer.concat(kept));
      chmodSync(tmp, mode);
      opts.beforeSwap?.();
      if (readFileSync(ledgerFile).equals(before)) {
        renameSync(tmp, ledgerFile);
        return { attempts: attempt, dropped };
      }
    } finally {
      rmSync(tmp, { force: true });
    }
  }
  throw new Error(`token ledger ${ledgerFile} kept changing; not rewritten after ${maxAttempts} attempt(s)`);
}

// ---------------------------------------------------------------------------
// command line
// ---------------------------------------------------------------------------
//
//   bun run smoke_session_cleanup.ts [--config-dir <d>]... [--cache-root <d>]
//     [--home <d>] [--cmux-dir <d>] [--project-root <d>] [--session <sid>]...
//     [--keep <sid>]... [--run-cwd <d>]... [--since <iso> --until <iso>]
//     [--manual] [--delete]
//
// Without --delete nothing is removed. Under `import` this block does not run.

function parseCli(argv: string[], env: NodeJS.ProcessEnv): CleanupOptions {
  const { values: v } = parseArgs({
    args: argv,
    strict: true,
    allowPositionals: false,
    options: {
      "config-dir": { type: "string", multiple: true },
      "cache-root": { type: "string" },
      home: { type: "string" },
      "cmux-dir": { type: "string" },
      "project-root": { type: "string" },
      session: { type: "string", multiple: true },
      keep: { type: "string", multiple: true },
      "run-cwd": { type: "string", multiple: true },
      since: { type: "string" },
      until: { type: "string" },
      manual: { type: "boolean" },
      delete: { type: "boolean" },
    },
  });
  const home = v.home ?? env.HOME ?? homedir();
  let window: CleanupWindow | undefined;
  if (v.since !== undefined || v.until !== undefined) {
    if (v.since === undefined || v.until === undefined) throw new Error("--since and --until go together");
    const startMs = Date.parse(v.since);
    const endMs = Date.parse(v.until);
    if (Number.isNaN(startMs) || Number.isNaN(endMs)) throw new Error("--since/--until must be ISO timestamps");
    window = { startMs, endMs };
  }
  return {
    roots: {
      configDirs: v["config-dir"] ?? [env.CLAUDE_CONFIG_DIR ?? join(home, ".claude")],
      cacheRoot: v["cache-root"] ?? join(home, "Library", "Caches", "claude-cli-nodejs"),
      homeDir: home,
      cmuxDir: v["cmux-dir"] ?? join(home, ".cmuxterm"),
      projectRoot: v["project-root"] ?? process.cwd(),
    },
    sessionIds: v.session ?? [],
    kept: v.keep ?? [],
    window,
    runCwds: v["run-cwd"] ?? [],
    manual: v.manual ?? false,
    delete: v.delete ?? false,
  };
}

if (import.meta.main) {
  let cliOpts: CleanupOptions;
  try {
    cliOpts = parseCli(process.argv.slice(2), process.env);
  } catch (e) {
    process.stderr.write(`smoke-session-cleanup: ${(e as Error).message}\n`);
    process.exit(2);
  }
  const r = await runCleanup(cliOpts);
  process.stdout.write(r.output);
  process.exit(r.exitCode);
}
