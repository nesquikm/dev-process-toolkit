// gate_identity_run — run a project's gate ONCE and come back with both of the
// signals the skip ratchet needs: the bytes a counter can be parsed out of, and
// the identities of the skips that run reported.
//
// WHY THIS IS ONE MODULE AND NOT TWO COPIES. The ratchet has two halves, and
// they must observe the world the same way or they are not comparing like with
// like. `capture_skip_baseline` (the WRITE side) records a branch's baseline;
// `gate_capture` (the READ side) measures the run being evidenced right now.
// Both need the same three rules to hold, and each rule is a place a hand-copied
// second implementation can drift:
//
//   1. ONE RUN, BOTH SIGNALS. Where the stack's runner can name its skips, the
//      command actually executed is `skipIdentityCommand`'s invocation: the
//      machine-readable report goes to a file and the human summary still goes
//      to the console, so the counts a caller parses and the identities it
//      compares come from ONE measurement. Two runs could disagree, and the
//      ratchet would have no way to say which one it ratcheted against.
//   2. THE REPORT IS WRITTEN OUTSIDE THE PROJECT TREE. A report dropped inside
//      the project dirties the tree, and a dirty tree is precisely what the
//      capture side refuses on (AC-STE-527.2). The path is composed HERE, in
//      the caller's layer, and handed to both halves of `skip_identities`
//      (AC-STE-529.10) — those two ask nobody where the report lives.
//   3. UNAVAILABLE IS NOT EMPTY, and NEITHER IS SILENT. Three states leave this
//      module and all three are distinct: `null` for a stack whose runner has
//      no report at all ("this run says nothing about identities"), `named` for
//      a report that was read (an EMPTY name list is a real answer — nothing
//      was skipped), and `unavailable` for a stack that has a report which
//      could not be read ("this run states it could not name its skips").
//      Collapsing any pair of those is a fail-open: the last-into-the-first
//      reports every skip in the tree as newly introduced, and the
//      first-into-the-last silently downgrades a readable-report stack to a
//      count comparison while saying nothing about the downgrade.
//
// Callers map those three states into their own record shapes. What they do NOT
// do is decide them a second time.

import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { constants as osConstants, tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import {
  extractFailureIdentities,
  extractSkipIdentities,
  SKIP_IDENTITY_SEPARATOR,
  skipIdentityCommand,
  type SkipIdentities,
} from "./skip_identities";

/**
 * The line a cut run leaves in its own output, so the bytes a counter parses
 * carry the reason they are short rather than looking merely unparseable.
 */
export const TIMED_OUT_MARKER = "dpt-gate-run: the gate command did not finish";

/**
 * How long a gate run may take before it is cut. Generous — this project's own
 * suite takes about seven minutes on a quiet machine and far longer on a loaded
 * one — but FINITE, because a runner really does hang: `bun test
 * --reporter=junit` stalled at 0% CPU with no children twice on one machine,
 * and an unbounded run turns that into a gate that never returns, blocking
 * every commit and every release. A verdict beats a hang (M_85e846). Forty
 * minutes since AC-STE-686.9.
 */
export const GATE_RUN_TIMEOUT_MS = 40 * 60_000;

/**
 * The bound in force: `DPT_GATE_TIMEOUT_MS` when it names a positive number of
 * milliseconds, else the default. A malformed value is not silently obeyed —
 * a project whose suite legitimately runs longer raises it on purpose.
 */
export function gateRunTimeoutMs(): number {
  return positiveMsFromEnv("DPT_GATE_TIMEOUT_MS", GATE_RUN_TIMEOUT_MS);
}

/**
 * How long a run that outlived its bound is given, after SIGTERM, before it is
 * sent SIGKILL (AC-STE-686.9). A single SIGTERM is a request: a gate run once
 * spun for an hour past its bound because nothing in it handled the signal.
 */
export const GATE_KILL_GRACE_MS = 5_000;

/** The grace in force: `DPT_GATE_KILL_GRACE_MS` when positive, else the default. */
export function gateKillGraceMs(): number {
  return positiveMsFromEnv("DPT_GATE_KILL_GRACE_MS", GATE_KILL_GRACE_MS);
}

function positiveMsFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** What one gate run observed. */
export interface GateRunObservation {
  /**
   * stdout and stderr together: bun writes its summary to stderr, pytest to
   * stdout, and a gate that half-failed still carries the counters a parser
   * reads. One string, so no caller has to remember which stream to look in.
   */
  readonly output: string;
  /**
   * `null` — this stack's runner writes no machine-readable report, so the run
   * says NOTHING about identities and the caller keeps whatever count-shaped
   * path it took before identities existed. Otherwise the extractor's own
   * verdict, `named` or `unavailable`, forwarded without interpretation.
   */
  readonly identities: SkipIdentities | null;
  /**
   * The identities of the tests that FAILED in this run, read from the same
   * report before it is removed (AC-STE-686.8). Absent exactly when
   * `identities` carries no `named` answer from a report.
   */
  readonly failures?: SkipIdentities;
  /**
   * Present exactly when the run outlived its bound and was killed: the bound,
   * in milliseconds, it was killed on (AC-STE-686.9).
   */
  readonly killedOnBoundMs?: number;
}

// ---------------------------------------------------------------------------
// The identity ANCHOR (AC-STE-529.2).
// ---------------------------------------------------------------------------
//
// A runner names the file it ran RELATIVE TO ITS OWN CWD. That makes the raw
// identity a function of where the gate happened to be invoked: a baseline
// captured with the repo root as cwd calls a test
// `pkg/tests/x.test.ts > parked`, and the very same test, captured from `pkg`,
// is `tests/x.test.ts > parked`. The two sets are then DISJOINT, so a set
// comparison of an untouched tree reports every skip as newly introduced — a
// confident wrong answer, strictly worse than the count-only comparison the
// set path replaces.
//
// So the cwd is divided out before the identity leaves this module: the scope is
// resolved against the run's own root and re-expressed relative to the top of
// the git working tree that holds it. Two runs of one tree from any two
// directories inside it therefore produce the SAME identity space, while two
// different files keep two identities — the anchor moves the whole path, it does
// not shorten it to a name, and a normalisation that discarded the file would
// merge every same-named test in the tree into one.
//
// PRE-EXISTING RECORDS. A baseline captured before this change holds names in
// the raw, cwd-relative shape. Where that capture ran at the top of the working
// tree — what `capture_skip_baseline` does, and the only shape its own trunk
// resolution supports — the two shapes are byte-identical and the old record
// keeps comparing correctly. A capture taken from a SUBDIRECTORY is the case
// that moves, and it is visible rather than silent: its stored names are
// relative to a directory that no longer appears in any name this build
// produces, so a reader diffing a record against a fresh run sees two whole
// disjoint sets rather than a plausible one-test difference.

/** git working-tree top per directory. Asked once; a checkout does not move. */
const ANCHOR_CACHE = new Map<string, string | null>();

/** The realpath of `path`, or `path` itself when it cannot be resolved. */
function realOrSelf(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/**
 * The top of the git working tree containing `directory`, or `null` when the
 * directory is not in one.
 *
 * Asked of git rather than inferred from a `.git` entry: a worktree and a
 * submodule both carry a `.git` FILE, not a directory, and a hand-rolled walk
 * that stops at the first one it recognises anchors at the wrong place.
 */
function gitToplevel(directory: string): string | null {
  const cached = ANCHOR_CACHE.get(directory);
  if (cached !== undefined) return cached;

  const proc = Bun.spawnSync(["git", "-C", directory, "rev-parse", "--show-toplevel"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = proc.exitCode === 0 ? proc.stdout.toString().trim() : "";
  const anchor = out.length === 0 ? null : realOrSelf(out);
  ANCHOR_CACHE.set(directory, anchor);
  return anchor;
}

/**
 * Re-express one identity's scope against a root-invariant anchor.
 *
 * The identity is returned UNCHANGED whenever its scope is not a file that
 * exists: a producer whose scope is a `classname` rather than a path has
 * nothing to re-anchor, and an identity carrying no scope at all has no
 * boundary to split on. Only a real file is moved, and when no working tree
 * claims it the absolute path is the fallback — still the same string from
 * either cwd, which is the property that matters, and visibly not a repo-
 * relative path, which is the honest way to say the anchor was unavailable.
 */
function anchorIdentity(identity: string, runRoot: string): string {
  const cut = identity.indexOf(SKIP_IDENTITY_SEPARATOR);
  if (cut === -1) return identity;

  const scope = identity.slice(0, cut);
  const rest = identity.slice(cut + SKIP_IDENTITY_SEPARATOR.length);
  const absolute = isAbsolute(scope) ? scope : resolve(runRoot, scope);
  if (!existsSync(absolute)) return identity;

  const file = realOrSelf(absolute);
  const anchor = gitToplevel(dirname(file));
  const within = anchor === null ? "" : relative(anchor, file);
  // An empty or escaping relative path means the anchor does not contain the
  // file — fall back rather than emit `../..`, which is cwd-shaped again.
  const scoped =
    within.length === 0 || within === ".." || within.startsWith(`..${sep}`)
      ? file
      : within.split(sep).join("/");
  return `${scoped}${SKIP_IDENTITY_SEPARATOR}${rest}`;
}

/** Every identity in `identities`, anchored — `unavailable` passes through. */
function anchorIdentities(identities: SkipIdentities, runRoot: string): SkipIdentities {
  if (identities.status !== "named") return identities;
  return {
    status: "named",
    names: identities.names.map((name) => anchorIdentity(name, runRoot)),
  };
}

/**
 * Run `command` in `projectRoot` and report what the run said.
 *
 * `stack` is typed as a plain string to match `skipIdentityCommand`'s own
 * signature: this module asks that table whether the runner can name its skips
 * and has no opinion of its own about which stacks exist, so it needs no import
 * of the stack vocabulary to stay correct when that vocabulary grows.
 */
export function runGateNamingSkips(
  projectRoot: string,
  stack: string,
  command: readonly string[],
  timeoutMs: number = gateRunTimeoutMs(),
): GateRunObservation {
  const reportDir = mkdtempSync(join(tmpdir(), "dpt-gate-report-"));
  const reportPath = join(reportDir, "junit.xml");
  const identityCommand = skipIdentityCommand(stack, reportPath);

  try {
    // ONE spawn, one options object. The branch is over WHAT is run — the
    // runner's own argv, or a shell asked to run the identity invocation — and
    // never over how it is run: a second options literal is a second place the
    // cwd or a captured stream can be forgotten, and a gate run in the wrong
    // directory measures another project's skips.
    const argv = identityCommand === null ? [...command] : ["/bin/sh", "-c", identityCommand];
    // The run goes through a SUPERVISOR — this same module, re-entered below —
    // rather than `spawnSync`'s own `timeout`. That option sends ONE SIGTERM and
    // then blocks for as long as the child ignores it, which is how a gate run
    // spun an hour past its bound. The supervisor puts the gate in its own
    // process group, sends the group SIGTERM at the bound and SIGKILL after the
    // grace period, so `/bin/sh -c` and every runner under it end. The
    // supervisor's stdio is the gate's stdio, so the bytes are captured here
    // exactly as before, and this call stays synchronous.
    const graceMs = gateKillGraceMs();
    const cutFile = join(reportDir, "killed-on-bound");
    const pidFile = join(reportDir, "gate.pid");
    const backstopMs = positiveMsFromEnv("DPT_GATE_SUPERVISOR_BACKSTOP_MS", SUPERVISOR_BACKSTOP_MS);
    const proc = Bun.spawnSync(
      [
        process.execPath,
        import.meta.path,
        SUPERVISE_FLAG,
        String(timeoutMs),
        String(graceMs),
        cutFile,
        pidFile,
        ...argv,
      ],
      {
        cwd: projectRoot,
        stdout: "pipe",
        stderr: "pipe",
        // A backstop for a wedged supervisor only — far past the escalation,
        // so it never pre-empts the supervisor's own kill.
        timeout: timeoutMs + graceMs + backstopMs,
        killSignal: "SIGKILL",
      },
    );
    // The backstop kills only the SUPERVISOR. The gate lives in its own process
    // group, so a supervisor cut here leaves that group running as orphans
    // unless this caller ends it: the supervisor recorded the group's pid.
    if (proc.exitCode === null) {
      const gatePid = readGatePid(pidFile);
      if (gatePid !== null) signalGroup(gatePid, "SIGKILL");
    }
    // A cut run has no complete report and no honest exit code. SAY so in the
    // bytes: a caller parsing counts out of a half-written summary would
    // otherwise read the silence as a clean-but-unparseable run, which is the
    // confident nothing this avoids.
    const cut = existsSync(cutFile) || proc.exitCode === null;
    const output =
      `${proc.stdout.toString()}\n${proc.stderr.toString()}` +
      (cut
        ? `\n${TIMED_OUT_MARKER} within ${timeoutMs} ms and was killed ` +
          `(SIGTERM, then SIGKILL after ${graceMs} ms).\n`
        : "");

    // A cut run states it could not name its skips, rather than handing back
    // the identities of a report that was still being written.
    if (cut) {
      return {
        output,
        identities: identityCommand === null ? null : { status: "unavailable" },
        killedOnBoundMs: timeoutMs,
      };
    }
    if (identityCommand === null) return { output, identities: null };
    // Anchored HERE, at the one place both halves of the ratchet run their
    // gate: the WRITE side and the READ side must divide out the same cwd or
    // they are not comparing like with like, and a second anchoring in either
    // caller is the drift this module exists to prevent.
    return {
      output,
      identities: anchorIdentities(extractSkipIdentities(reportPath), projectRoot),
      failures: anchorIdentities(extractFailureIdentities(reportPath), projectRoot),
    };
  } finally {
    // The report directory is this module's alone, and it goes whether the run
    // succeeded, failed, or threw — a leaked temp tree per gate run is how a
    // long-lived session fills a disk.
    rmSync(reportDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// The SUPERVISOR (AC-STE-686.9).
// ---------------------------------------------------------------------------
//
// `runGateNamingSkips` re-enters this module as a separate process:
//
//   bun gate_identity_run.ts --dpt-gate-supervise <boundMs> <graceMs> <cutFile> <pidFile> <argv...>
//
// It runs the gate in a NEW process group (`detached`), with this process's
// stdio, and waits. At the bound it records the cut in `cutFile`, sends the
// whole group SIGTERM, and after the grace period sends the group SIGKILL —
// unconditionally, so a runner that exited on TERM leaves no grandchild
// behind either. It never exits before the gate does: returning early would
// let a TERM-ignoring gate keep running unseen behind a "killed" verdict.

const SUPERVISE_FLAG = "--dpt-gate-supervise";

/**
 * How far past bound + grace the caller's backstop sits. `DPT_GATE_SUPERVISOR_BACKSTOP_MS`
 * (positive ms) replaces it, so a test can reach the backstop in seconds.
 */
const SUPERVISOR_BACKSTOP_MS = 60_000;

/** The gate group's pid the supervisor recorded, or `null` when none was. */
function readGatePid(pidFile: string): number | null {
  try {
    const pid = Number(readFileSync(pidFile, "utf8").trim());
    return Number.isInteger(pid) && pid > 1 ? pid : null;
  } catch {
    return null;
  }
}

/** Signal a whole process group; a group that is already gone is not an error. */
function signalGroup(pid: number, signal: "SIGTERM" | "SIGKILL"): void {
  try {
    process.kill(-pid, signal);
  } catch {
    // ESRCH — every member has already exited.
  }
}

async function supervise(args: readonly string[]): Promise<number> {
  const [boundRaw, graceRaw, cutFile, pidFile, ...argv] = args;
  const boundMs = Number(boundRaw);
  const graceMs = Number(graceRaw);
  // TEST-ONLY SEAM: `DPT_GATE_SUPERVISOR_WEDGE_FILE` simulates a supervisor
  // that wedges. When set, the supervisor writes that file, starts the gate
  // exactly as in production, then never arms the bound and never exits — the
  // caller's backstop is the only thing left to end the run. Inert when unset.
  const wedgeFile = process.env.DPT_GATE_SUPERVISOR_WEDGE_FILE;
  if (wedgeFile !== undefined && wedgeFile !== "") writeFileSync(wedgeFile, "wedged\n");
  const child = Bun.spawn([...argv], { stdin: "inherit", stdout: "inherit", stderr: "inherit", detached: true });
  writeFileSync(pidFile as string, `${child.pid}\n`);
  if (wedgeFile !== undefined && wedgeFile !== "") {
    setInterval(() => {}, 1 << 30);
    return new Promise<number>(() => {});
  }

  const kill: { escalated: Promise<void> | null } = { escalated: null };
  const bound = setTimeout(() => {
    writeFileSync(cutFile as string, `${boundMs}\n`);
    signalGroup(child.pid, "SIGTERM");
    kill.escalated = new Promise((done) =>
      setTimeout(() => {
        signalGroup(child.pid, "SIGKILL");
        done();
      }, graceMs),
    );
  }, boundMs);

  const code = await child.exited;
  clearTimeout(bound);
  if (kill.escalated !== null) await kill.escalated;
  return child.signalCode === null ? code : 128 + (osConstants.signals[child.signalCode] ?? 0);
}

if (import.meta.main && process.argv[2] === SUPERVISE_FLAG) {
  void supervise(process.argv.slice(3)).then((code) => process.exit(code));
}
