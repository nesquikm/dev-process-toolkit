// Shared sandbox for the M_4df444 / STE-594 fence-run suites:
//   tests/m_4df444-ste-594-spawn-ledger-run.test.ts        (AC.1 behaviour, AC.3)
//   tests/m_4df444-ste-594-termination-cleanup-run.test.ts (AC.4 – AC.8)
// and the static pairing/shape helpers the meta-test shares with them.
//
// SAFETY: STE-595's fence-run rules, plus the ones a run ledger and a cleanup
// front door add.
//   * `claude`, `bun` and `sleep` are stubbed on PATH, and every run first
//     asserts that `command -v claude` and `command -v bun` resolve to the stubs,
//     refusing to run otherwise. The claude stub records its pid, its argv and
//     its whole environment (`env -0`), then `exec -a claude /bin/sleep 1.594`.
//     A real `claude` is never started. The `sleep` stub shortens every
//     fence-side poll sleep to 0.2 s. The stubs themselves call `/bin/sleep` by
//     absolute path, so their own lifetimes are unchanged.
//   * The bun stub records every call. `smoke_session_cleanup.ts` is ALWAYS
//     stubbed. The stub records its argv and which of the watched pids
//     (`STE594_WATCH_PIDS`) still answer `kill -0` at that moment, prints a
//     report, and exits `STE594_CLEANUP_RC` (default 0). It never deletes
//     anything, so a fence under test can never reach a real config dir.
//   * "delegate" mode runs `smoke_verdict.ts`, `smoke_run_ledger.ts` and
//     `smoke_fixture_groups.ts` for real, from this plugin's source, with
//     cwd = <sandbox>/work and HOME = <sandbox>/home. They are the pure or
//     sandboxed readers and the ledger writer. The stub refuses (exit 97) any
//     delegated call whose arguments still name the real repo root.
//     "record" mode records a ledger `append` and does NOT execute it.
//   * Before a fence runs, every `/tmp/` path and every spelling of the real
//     repo root in it is rebased into the sandbox. A fence therefore never reads
//     or writes a real run's artifacts, pidfiles, findings or approval record,
//     nor the repo's real `.dpt/`. HOME is the sandbox's, so `~/.claude-st`
//     resolves inside it too.
//   * A guard lists the real repo's `.dpt/ledger/` tree before and after each
//     termination scenario and fails the test if a run-ledger file appeared
//     there.
//   * Every fence runs from a FILE (`bash <file>`), never through stdin.
//   * Cleanup signals only processes this run started, waits for them, then
//     removes the sandbox. A process the harness plants is started through a
//     double fork: launchd/init reaps it, so it stops answering `kill -0` the
//     moment it exits, even while this process is blocked in a spawnSync.

import { expect } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { parseSpawnFenceGroups } from "../adapters/_shared/src/leg_prose_surfaces";
import {
  classify,
  countSites,
  parseFences,
  phaseAFence,
  pluginRoot,
  readDoc,
  repoRoot,
  type Fence,
} from "./_spawn_fences";

export const STUB_SLEEP = "1.594";
const SRC_DIR = join(pluginRoot, "adapters", "_shared", "src");
const REAL_BUN = process.execPath;

let seq = 0;
export const unique = (prefix: string): string => `${prefix}${process.pid}x${Date.now().toString(36)}x${++seq}`;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const today = (): string => Bun.spawnSync(["date", "+%Y-%m-%d"]).stdout.toString().trim();

// ===========================================================================
// Static helpers: logical lines, the pairing contract, the Termination fence.
// ===========================================================================

export interface Logical {
  /** 0-based body index of the first physical line. */
  start: number;
  /** 0-based body index of the last physical line (backslash continuations joined). */
  end: number;
  text: string;
}

/** Code lines only (never prose, never heredoc body text), continuations joined. */
export function logicalCodeLines(f: Fence): Logical[] {
  const kinds = classify(f.lines);
  const out: Logical[] = [];
  for (let i = 0; i < f.lines.length; i++) {
    if (kinds[i] !== "code") continue;
    let end = i;
    let text = f.lines[i]!;
    while (/\\\s*$/.test(f.lines[end]!) && end + 1 < f.lines.length && kinds[end + 1] === "code") {
      end++;
      text = `${text.replace(/\\\s*$/, "")} ${f.lines[end]!.trim()}`;
    }
    out.push({ start: i, end, text });
    i = end;
  }
  return out;
}

const ECHO_RE = /^\s*(?:echo|printf)\b/;
const CLEANUP_DELETE_CALL_RE = /\bbun\b[^\n]*smoke_session_cleanup\.ts[^\n]*(?:^|\s)--delete\b/;

/** A fence whose CODE (not an echo, not prose) calls the STE-593 front door in delete mode. */
export function invokesCleanupDelete(f: Fence): boolean {
  return logicalCodeLines(f).some((l) => !ECHO_RE.test(l.text) && CLEANUP_DELETE_CALL_RE.test(l.text));
}

/** First code logical line that invokes the cleanup in delete mode, or null. */
export function cleanupDeleteLine(f: Fence): Logical | null {
  return logicalCodeLines(f).find((l) => !ECHO_RE.test(l.text) && CLEANUP_DELETE_CALL_RE.test(l.text)) ?? null;
}

export const LOOP_TEXT = readDoc("conformance-loop");
export const LOOP_FENCES = parseFences("conformance-loop", LOOP_TEXT);
export const PHASE_A = phaseAFence(LOOP_FENCES);
/** The registered legs, read off Phase A's own brace groups by the shipped parser. */
export const REGISTERED_LEGS = parseSpawnFenceGroups(LOOP_TEXT)
  .map((g) => g.tracker)
  .filter((t) => t !== "");

function headingLine(re: RegExp): number {
  return LOOP_TEXT.replace(/\r\n/g, "\n").split("\n").findIndex((l) => re.test(l)) + 1;
}
export const TERMINATION_HEADING_LINE = headingLine(/^###\s+Termination\s*$/);
export const CLOSING_SUMMARY_HEADING_LINE = headingLine(/^###\s+Closing summary\s*$/);
export const GREEN_FENCE = LOOP_FENCES.find((f) => f.body.includes("STATUS=green"));

/** Every loop fence that calls the cleanup in delete mode, wherever it sits. */
export function cleanupFencesAnywhere(): Fence[] {
  return LOOP_FENCES.filter(invokesCleanupDelete);
}

/**
 * THE Termination cleanup fence, found by shape: inside § Termination (before
 * § Closing summary), after the `green` probe fence, and calling
 * `bun …/smoke_session_cleanup.ts … --delete` on a code line (`--delete`
 * written on the invoking line itself, not hidden in a variable). Exactly one
 * such fence, or undefined.
 */
export function terminationCleanupFence(): Fence | undefined {
  if (TERMINATION_HEADING_LINE === 0 || CLOSING_SUMMARY_HEADING_LINE === 0 || GREEN_FENCE === undefined) return undefined;
  const hits = LOOP_FENCES.filter(
    (f) =>
      f.openLine > TERMINATION_HEADING_LINE &&
      f.openLine > GREEN_FENCE.closeLine &&
      f.closeLine < CLOSING_SUMMARY_HEADING_LINE &&
      invokesCleanupDelete(f),
  );
  return hits.length === 1 ? hits[0] : undefined;
}

// ===========================================================================
// Sandbox.
// ===========================================================================

export type StubMode = "record" | "delegate";

export interface Sandbox {
  root: string;
  bin: string;
  tmp: string;
  work: string;
  home: string;
  envDir: string;
  calls: string;
  mode: StubMode;
  /** Pids of processes the harness planted (double-forked). */
  planted: number[];
}

const sq = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;

function claudeStub(sb: Sandbox): string {
  return [
    "#!/bin/bash",
    `printf 'claude\\t%s\\t%s\\n' "$$" "$*" >> ${sq(sb.calls)}`,
    `/usr/bin/env -0 > ${sq(sb.envDir)}/"$$".env`,
    `exec -a claude /bin/sleep ${STUB_SLEEP}`,
    "",
  ].join("\n");
}

function bunStub(sb: Sandbox): string {
  return `#!/bin/bash
CALLS=${sq(sb.calls)}
printf 'bun\\t%s\\t%s\\n' "$$" "$*" >> "$CALLS"
[ "\${1:-}" = run ] && shift
MOD="\${1:-}"
[ $# -gt 0 ] && shift
BASE="\${MOD##*/}"
if [ "$BASE" = smoke_session_cleanup.ts ]; then
  ALIVE=""
  for P in \${STE594_WATCH_PIDS:-}; do kill -0 "$P" 2>/dev/null && ALIVE="$ALIVE $P"; done
  printf 'cleanup\\t%s\\t%s\\talive=%s\\n' "$$" "$*" "\${ALIVE# }" >> "$CALLS"
  RC="\${STE594_CLEANUP_RC:-0}"
  echo "smoke-session-cleanup: ste594 stub, nothing deleted (rc=$RC)"
  if [ "$RC" != 0 ]; then echo "survivors (1) — planned but still present:"; echo "  /ste594/stub/survivor"; fi
  exit "$RC"
fi
DELEGATE=0
case "${sb.mode}:$BASE" in
  delegate:smoke_verdict.ts|delegate:smoke_run_ledger.ts|delegate:smoke_fixture_groups.ts) DELEGATE=1 ;;
  record:smoke_fixture_groups.ts) DELEGATE=1 ;;
  record:smoke_run_ledger.ts) [ "\${1:-}" = append ] || DELEGATE=1 ;;
esac
if [ "$DELEGATE" = 1 ]; then
  for A in "$@"; do
    case "$A" in *${sq(repoRoot)}*)
      printf 'refused\\t%s\\t%s\\n' "$$" "$*" >> "$CALLS"
      echo "ste594 bun stub: refusing an argument that names the real repo: $A" >&2
      exit 97 ;;
    esac
  done
  if [ "$BASE" = smoke_run_ledger.ts ]; then
    # A run ledger lands only inside this sandbox (M_685ff6 review): the
    # project root is --project-root, or the cwd when none is given, and it
    # must resolve under the sandbox root — any other directory is refused.
    PR="$PWD"
    PREV=""
    for A in "$@"; do
      [ "$PREV" = --project-root ] && PR="$A"
      case "$A" in --project-root=*) PR="\${A#--project-root=}" ;; esac
      PREV="$A"
    done
    PR_REAL=$(cd "$PR" 2>/dev/null && pwd -P) || PR_REAL=""
    SB_REAL=$(cd ${sq(sb.root)} && pwd -P)
    case "$PR_REAL/" in
      "$SB_REAL"/*) ;;
      *)
        printf 'refused\t%s\t%s\n' "$$" "$*" >> "$CALLS"
        echo "ste594 bun stub: refusing a run ledger outside the sandbox: \${PR}" >&2
        exit 97 ;;
    esac
  fi
  exec ${sq(REAL_BUN)} ${sq(SRC_DIR)}/"$BASE" "$@"
fi
[ "$BASE" = smoke_run_ledger.ts ] && exit 0
echo 0
`;
}

export function makeSandbox(mode: StubMode): Sandbox {
  const root = mkdtempSync(join(tmpdir(), "ste594-run-"));
  const sb: Sandbox = {
    root,
    bin: join(root, "bin"),
    tmp: join(root, "tmp"),
    work: join(root, "work"),
    home: join(root, "home"),
    envDir: join(root, "env"),
    calls: join(root, "calls.log"),
    mode,
    planted: [],
  };
  for (const d of [sb.bin, sb.tmp, sb.work, sb.home, sb.envDir]) mkdirSync(d, { recursive: true });
  writeFileSync(join(sb.bin, "claude"), claudeStub(sb), { mode: 0o755 });
  writeFileSync(join(sb.bin, "bun"), bunStub(sb), { mode: 0o755 });
  writeFileSync(join(sb.bin, "sleep"), "#!/bin/bash\nexec /bin/sleep 0.2\n", { mode: 0o755 });
  return sb;
}

/** Every `/tmp/` path and every spelling of the real repo root, moved into the sandbox. */
export function rebase(body: string, sb: Sandbox): string {
  return body.replaceAll("/tmp/", `${sb.tmp}/`).replaceAll(repoRoot, sb.work);
}

/** The caller's environment minus anything a live run could have exported, with the stubs first on PATH. */
export function baseEnv(sb: Sandbox, extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (/DPT|SMOKE|RUN_ID|LEDGER|STE594|CLAUDE_CONFIG_DIR/i.test(k)) continue;
    env[k] = v;
  }
  env.HOME = sb.home;
  env.PATH = `${sb.bin}:${process.env.PATH ?? ""}`;
  return { ...env, ...extra };
}

export interface FenceRun {
  exitCode: number;
  out: string;
  err: string;
  elapsedMs: number;
  timedOut: boolean;
}

/** Run a script FILE with the stubs first on PATH. Refuses to run if a stub is not what resolves. */
export function runScript(sb: Sandbox, script: string, env: Record<string, string>, timeoutMs = 60_000): FenceRun {
  const file = join(sb.root, `fence-${++seq}.sh`);
  writeFileSync(file, script);
  const which = Bun.spawnSync(["bash", "-c", "command -v claude; command -v bun"], { env, cwd: sb.work });
  expect(
    which.stdout.toString().trim().split("\n"),
    "SAFETY: the stubs must shadow the real claude and bun, or nothing runs",
  ).toEqual([join(sb.bin, "claude"), join(sb.bin, "bun")]);
  const out = `${file}.out`;
  const err = `${file}.err`;
  const t0 = Date.now();
  const r = Bun.spawnSync(["bash", "-c", 'bash "$1" >"$2" 2>"$3"', "ste594-runner", file, out, err], {
    env,
    cwd: sb.work,
    timeout: timeoutMs,
  });
  const elapsedMs = Date.now() - t0;
  return {
    exitCode: r.exitCode ?? -1,
    out: existsSync(out) ? readFileSync(out, "utf-8") : "",
    err: existsSync(err) ? readFileSync(err, "utf-8") : "",
    elapsedMs,
    timedOut: elapsedMs >= timeoutMs - 250,
  };
}

// ===========================================================================
// The stub record.
// ===========================================================================

export interface Call {
  kind: "claude" | "bun" | "cleanup" | "refused" | string;
  pid: number;
  args: string;
  /** cleanup only: watched pids that still answered kill -0 when it was invoked. */
  alive: string[];
  /** Position in the shared record: a lower index happened earlier. */
  index: number;
}

export function readCalls(sb: Sandbox): Call[] {
  if (!existsSync(sb.calls)) return [];
  return readFileSync(sb.calls, "utf-8")
    .split("\n")
    .filter((l) => l !== "")
    .map((l, index) => {
      const [kind = "", pid = "0", args = "", alive = ""] = l.split("\t");
      return {
        kind,
        pid: Number(pid),
        args,
        alive: alive.replace(/^alive=/, "").split(/\s+/).filter(Boolean),
        index,
      };
    });
}

export function flagValue(args: string, name: string): string | null {
  const m = new RegExp(`(?:^|\\s)--${name}(?:=|\\s+)(\\S+)`).exec(args);
  return m ? m[1]!.replace(/^["']|["']$/g, "") : null;
}

export const sessionIdOf = (args: string): string | null => flagValue(args, "session-id");
export const trackerOf = (args: string): string => /--tracker\s+(\S+)/.exec(args)?.[1] ?? "";

export interface Append {
  index: number;
  session: string | null;
  run: string | null;
  leg: string | null;
  parent: string | null;
  args: string;
}

/** Every ledger append the fences made, as the bun stub recorded it. */
export function appendsIn(cs: readonly Call[]): Append[] {
  return cs
    .filter((c) => c.kind === "bun" && /smoke_run_ledger\.ts["']?\s+append\b/.test(c.args))
    .map((c) => ({
      index: c.index,
      session: flagValue(c.args, "session") ?? flagValue(c.args, "session-id"),
      run: flagValue(c.args, "run"),
      leg: flagValue(c.args, "leg"),
      parent: flagValue(c.args, "parent"),
      args: c.args,
    }));
}

/** Stubs record themselves a few ms after the fork: wait for `n` of `kind` (from `from` on), then let stragglers land. */
export function waitForKind(sb: Sandbox, kind: string, n: number, from = 0, ms = 5_000): Call[] {
  const deadline = Date.now() + ms;
  const count = () => readCalls(sb).slice(from).filter((c) => c.kind === kind).length;
  while (Date.now() < deadline && count() < n) Bun.sleepSync(50);
  Bun.sleepSync(200);
  return readCalls(sb).slice(from);
}

export const alive = (pid: number): boolean => {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
};

export function waitDead(pids: readonly number[], ms = 10_000): boolean {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline && pids.some(alive)) Bun.sleepSync(50);
  return !pids.some(alive);
}

/** Every pid recorded in a pidfile under the sandbox's rebased /tmp. */
export function pidfilePids(sb: Sandbox): number[] {
  if (!existsSync(sb.tmp)) return [];
  const out: number[] = [];
  for (const name of readdirSync(sb.tmp)) {
    if (!name.endsWith(".pid")) continue;
    const p = join(sb.tmp, name);
    try {
      if (!statSync(p).isFile()) continue;
      const pid = Number.parseInt(readFileSync(p, "utf-8").trim(), 10);
      if (pid > 0) out.push(pid);
    } catch {
      // raced away
    }
  }
  return out;
}

/** Every pidfile under the sandbox's rebased /tmp, path → content. */
export function snapshotPidfiles(sb: Sandbox): Map<string, string> {
  const out = new Map<string, string>();
  if (!existsSync(sb.tmp)) return out;
  for (const name of readdirSync(sb.tmp)) {
    if (!name.endsWith(".pid")) continue;
    const p = join(sb.tmp, name);
    try {
      if (statSync(p).isFile()) out.set(p, readFileSync(p, "utf-8"));
    } catch {
      // raced away
    }
  }
  return out;
}

/**
 * A process named `claude` for `ps -p <pid> -o comm=`, living `seconds`,
 * double-forked so init reaps it: it stops answering `kill -0` the moment it
 * exits, whatever this process is blocked in.
 */
export function spawnLive(sb: Sandbox, seconds: number): number {
  const r = Bun.spawnSync([
    "bash",
    "-c",
    `( exec -a claude /bin/sleep ${seconds} ) </dev/null >/dev/null 2>&1 & echo $!`,
  ]);
  const pid = Number.parseInt(r.stdout.toString().trim(), 10);
  if (!(pid > 0)) throw new Error("could not plant a live process");
  sb.planted.push(pid);
  const deadline = Date.now() + 2_000;
  while (
    Date.now() < deadline &&
    Bun.spawnSync(["ps", "-p", String(pid), "-o", "comm="]).stdout.toString().trim() !== "claude"
  ) {
    Bun.sleepSync(20);
  }
  return pid;
}

// ===========================================================================
// Environment inheritance (AC.3).
// ===========================================================================

export function envOf(sb: Sandbox, pid: number): Record<string, string> | null {
  const p = join(sb.envDir, `${pid}.env`);
  if (!existsSync(p)) return null;
  const env: Record<string, string> = {};
  for (const entry of readFileSync(p, "utf-8").split("\0")) {
    const eq = entry.indexOf("=");
    if (eq <= 0) continue;
    env[entry.slice(0, eq)] = entry.slice(eq + 1);
  }
  return env;
}

const DELTA_IGNORED = new Set(["_", "SHLVL", "PWD", "OLDPWD"]);

/** What the spawning fence exported to its child: keys new to, or different from, the environment the fence was given. */
export function inheritedDelta(child: Record<string, string>, given: Record<string, string>): Record<string, string> {
  const delta: Record<string, string> = {};
  for (const [k, v] of Object.entries(child)) {
    if (DELTA_IGNORED.has(k)) continue;
    if (given[k] !== v) delta[k] = v;
  }
  return delta;
}

// ===========================================================================
// Fence scripts.
// ===========================================================================

export const PHASE_A_ENV = { LINEAR_TEAM: "STE594", JIRA_PROJECT: "DST594" };

export function phaseAScript(sb: Sandbox, iter: string): string {
  if (PHASE_A === undefined) throw new Error("the /conformance-loop Phase A spawn fence was not found by shape");
  expect((PHASE_A.body.match(/^ITER=<N>$/gm) ?? []).length, "the Phase A fence carries exactly one ITER=<N> placeholder").toBe(1);
  return `set -u\n${rebase(PHASE_A.body.replace(/^ITER=<N>$/m, `ITER=${iter}`), sb)}\n`;
}

/** /smoke-test background spawn fences that run as written once placeholders are filled (the retry example is elided pseudo-code). */
export const SMOKE_RUNNABLE = countSites().filter(
  (f) => f.doc === "smoke-test" && !/claude\s+-p\s+\.\.\./.test(f.body),
);

export function smokeScript(f: Fence, sb: Sandbox, tracker: string): string {
  const body = f.body.replaceAll("<tracker>", tracker).replaceAll("<feature-id>", "FR-STE594");
  return `set -u\n${rebase(body, sb)}\n`;
}

// ===========================================================================
// Cleanup and the real-repo guard.
// ===========================================================================

export function reap(sb: Sandbox): void {
  const candidates = new Set<number>([
    ...readCalls(sb).filter((c) => c.kind === "claude").map((c) => c.pid),
    ...pidfilePids(sb),
    ...sb.planted,
  ]);
  const ours = new Set<number>();
  for (const line of Bun.spawnSync(["ps", "-axo", "pid=,args="]).stdout.toString().split("\n")) {
    const m = /^\s*(\d+)\s+(.*)$/.exec(line);
    if (!m) continue;
    const pid = Number(m[1]);
    const args = m[2]!;
    if (args.includes(sb.root)) ours.add(pid);
    else if (candidates.has(pid) && /^claude \d/.test(args)) ours.add(pid);
  }
  for (const p of ours) {
    try {
      process.kill(p, "SIGTERM");
    } catch {
      // already gone
    }
  }
  waitDead([...ours], 5_000);
  rmSync(sb.root, { recursive: true, force: true });
}

const REAL_LEDGER_DIR = join(repoRoot, ".dpt", "ledger");

/** Relative paths of every entry under the real repo's `.dpt/ledger/`. Names only, nothing is opened. */
export function realLedgerTree(): Set<string> {
  const out = new Set<string>();
  if (!existsSync(REAL_LEDGER_DIR)) return out;
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, e.name);
      out.add(relative(REAL_LEDGER_DIR, full));
      if (e.isDirectory()) walk(full);
    }
  };
  walk(REAL_LEDGER_DIR);
  return out;
}

export function assertRealLedgerUntouched(before: Set<string>): void {
  const added = [...realLedgerTree()].filter((p) => !before.has(p) && /smoke|run/i.test(p));
  expect(added, "SAFETY: a fence under test wrote a run ledger into the REAL repo's .dpt/ledger/").toEqual([]);
}

/** Every run-ledger row the sandbox holds: each `.jsonl` under <work>/.dpt/ledger/ except the token ledger. */
export function sandboxLedgerRows(sb: Sandbox): Array<Record<string, unknown>> {
  const dir = join(sb.work, ".dpt", "ledger");
  const rows: Array<Record<string, unknown>> = [];
  if (!existsSync(dir)) return rows;
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith(".jsonl") && e.name !== "token-ledger.jsonl") {
        for (const line of readFileSync(full, "utf-8").split("\n")) {
          if (line.trim() === "") continue;
          try {
            rows.push(JSON.parse(line) as Record<string, unknown>);
          } catch {
            // a torn line is not a row
          }
        }
      }
    }
  };
  walk(dir);
  return rows;
}
