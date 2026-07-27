// smoke_verdict — STE-420: a machine-readable verdict artifact for the
// `/smoke-test` driver, plus the rc reconciliation `/conformance-loop`'s
// Phase A applies to each leg's rc-file.
//
// THE DEFECT. Phase A's documented gate reads each leg's rc-file and aborts on
// non-zero. The driver is an LLM inside `claude -p` and CANNOT set the process
// exit status — `claude -p` returns 0 for any session that finishes without a
// harness error. On 2026-07-27 the Jira leg's final message led with
// `SMOKE-ABORT: incomplete grandchild chain` and self-reported `VERDICT: FAIL
// (rc=1)` while its rc-file contained `0`; the Linear leg declared
// `SMOKE-TEST FAIL` and also wrote `0`. The gate never fired.
//
// THE FIX. The driver writes its verdict to a per-tracker artifact
// (`smokeVerdictPath`), and the Phase A spawn wrapper reconciles the collected
// exit code against that artifact (`reconcileLegRc`) BEFORE persisting the
// rc-file. Every existing rc-file consumer — the documented RC-collection
// gate, the fail-fast clause — becomes truthful without changing shape.
//
// Two abort triggers feed the artifact, and the emitter must consume BOTH: the
// live-pidfile scan the `/smoke-test` self-check fence already computes, and
// the incomplete-chain finding set produced by Phase 2.Y's
// `assertChainIntegrity` (smoke_child_capture.ts). A pidfile-only emitter
// misses the exact shape the 2026-07-27 Jira leg produced.

import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";

import type { ChildSpawnFinding } from "./smoke_child_capture";

// --- the artifact ----------------------------------------------------------

/** The three outcomes a leg can record. Anything else is malformed. */
export const SMOKE_OUTCOMES = ["pass", "fail", "abort"] as const;

export type SmokeOutcome = (typeof SMOKE_OUTCOMES)[number];

/** The artifact's payload: the outcome, plus the abort trigger when aborting. */
export interface SmokeVerdict {
  outcome: SmokeOutcome;
  /** Human-readable abort trigger. Absent on a `pass`. */
  trigger?: string;
}

/** `parseSmokeVerdict`'s failure branch — a parse never throws. */
export interface SmokeVerdictMalformed {
  malformed: true;
}

/**
 * A tracker segment safe to interpolate into the artifact path: a bare
 * `[a-z0-9]`-led token. Rejects `..`, `/`, and the empty string, so no tracker
 * can be handed a path that escapes its own scope (STE-423 isolation).
 */
const TRACKER_SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/**
 * The documented per-tracker artifact path,
 * `/tmp/dpt-smoke-verdict-<tracker>.json`.
 *
 * Tracker-scoped from the start: a tandem `/conformance-loop` run has both
 * legs live at once, so an unscoped path would let each leg overwrite the
 * other's verdict. Throws on any segment that is not a bare token.
 */
export function smokeVerdictPath(tracker: string): string {
  if (typeof tracker !== "string" || !TRACKER_SEGMENT_RE.test(tracker)) {
    throw new Error(
      `smokeVerdictPath: unsafe tracker segment ${JSON.stringify(tracker)} — ` +
        "expected a bare [A-Za-z0-9][A-Za-z0-9_-]* token (e.g. `linear` / `jira`)",
    );
  }
  return `/tmp/dpt-smoke-verdict-${tracker}.json`;
}

// --- building the verdict --------------------------------------------------

/** The two deterministic abort-trigger sources the emitter consumes. */
export interface SmokeVerdictInput {
  /**
   * Pidfiles whose recorded PID still answers `kill -0` — the live-pidfile
   * trigger, as computed by the `/smoke-test` final-message self-check fence.
   */
  livePidfiles: readonly string[];
  /**
   * `assertChainIntegrity` findings (smoke_child_capture.ts) — the
   * incomplete-chain trigger. Its deterministic source is Phase 2.Y, NOT the
   * self-check fence, which computes only the pidfile scan.
   */
  chainFindings: readonly ChildSpawnFinding[];
  /**
   * An outcome the driver declares independently of the two triggers — a run
   * that completed its chain but is reporting `SMOKE-TEST FAIL`. It can only
   * make the verdict worse: a trigger-armed `abort` is never downgraded.
   */
  declared?: SmokeOutcome;
}

const OUTCOME_SEVERITY: Record<SmokeOutcome, number> = {
  pass: 0,
  fail: 1,
  abort: 2,
};

/**
 * Build the verdict from BOTH abort triggers.
 *
 * `abort` when either trigger is armed, with a `trigger` string naming every
 * armed trigger (not just the first). `pass` when neither is armed and nothing
 * worse was declared. A `declared` outcome is merged by severity, so it can
 * escalate a clean run to `fail` but can never mask an armed trigger.
 */
export function buildSmokeVerdict(input: SmokeVerdictInput): SmokeVerdict {
  const live = input.livePidfiles ?? [];
  const findings = input.chainFindings ?? [];
  const triggers: string[] = [];

  if (findings.length > 0) {
    const plural = findings.length === 1 ? "finding" : "findings";
    const detail = findings.map((finding) => finding.diagnostic).join("; ");
    triggers.push(
      `incomplete grandchild chain (${findings.length} chain-integrity ${plural}: ${detail})`,
    );
  }
  if (live.length > 0) {
    const plural = live.length === 1 ? "pidfile" : "pidfiles";
    triggers.push(
      `live ${plural} still answering kill -0 (${live.join(", ")})`,
    );
  }

  const triggered: SmokeOutcome = triggers.length > 0 ? "abort" : "pass";
  const declared = input.declared;
  const outcome: SmokeOutcome =
    declared !== undefined &&
    OUTCOME_SEVERITY[declared] > OUTCOME_SEVERITY[triggered]
      ? declared
      : triggered;

  if (triggers.length === 0) {
    return outcome === "pass" ? { outcome } : { outcome, trigger: "declared" };
  }
  return { outcome, trigger: triggers.join(" + ") };
}

// --- serializing / parsing -------------------------------------------------

/** Render a verdict as the artifact's on-disk JSON (trailing newline). */
export function formatSmokeVerdict(verdict: SmokeVerdict): string {
  const body: Record<string, unknown> = { outcome: verdict.outcome };
  if (verdict.trigger !== undefined && verdict.trigger !== "") {
    body.trigger = verdict.trigger;
  }
  return `${JSON.stringify(body, null, 2)}\n`;
}

/**
 * Parse artifact text. Pure and total — non-JSON, a non-object, an unknown
 * outcome, or a missing outcome all yield `{ malformed: true }`, never a throw.
 * A reader that threw would take the driver down with it.
 */
export function parseSmokeVerdict(
  text: string,
): SmokeVerdict | SmokeVerdictMalformed {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { malformed: true };
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { malformed: true };
  }
  const record = raw as Record<string, unknown>;
  const outcome = record.outcome;
  if (
    typeof outcome !== "string" ||
    !(SMOKE_OUTCOMES as readonly string[]).includes(outcome)
  ) {
    return { malformed: true };
  }
  const trigger = record.trigger;
  if (trigger === undefined || trigger === null) {
    return { outcome: outcome as SmokeOutcome };
  }
  if (typeof trigger !== "string") return { malformed: true };
  return { outcome: outcome as SmokeOutcome, trigger };
}

// --- reading the artifact --------------------------------------------------

/** Every way the artifact can read. Only `ok` carries a verdict. */
export type SmokeVerdictRead =
  | { status: "ok"; verdict: SmokeVerdict }
  | { status: "missing" }
  | { status: "stale" }
  | { status: "unreadable" }
  | { status: "malformed" };

export interface ReadSmokeVerdictOptions {
  /** Epoch ms (or a Date) of run-start. Omitted ⇒ no freshness gate. */
  runStart?: number | Date;
}

/**
 * Read a verdict artifact, freshness-gated.
 *
 * Mirrors `assertChainIntegrity`'s mtime gate (smoke_child_capture.ts): when
 * `runStart` is supplied, an artifact whose mtime is strictly before it is a
 * previous run's leftover and reads `stale` — never its recorded outcome. The
 * gate runs BEFORE the content check for the same reason it does there: a
 * well-formed `pass` from last night must not satisfy tonight's run. An mtime
 * exactly at run-start is fresh. Omitting `runStart` leaves the gate off.
 */
export function readSmokeVerdict(
  path: string,
  opts?: ReadSmokeVerdictOptions,
): SmokeVerdictRead {
  if (!existsSync(path)) return { status: "missing" };

  const runStart = opts?.runStart;
  const runStartMs = runStart instanceof Date ? runStart.getTime() : runStart;
  if (runStartMs !== undefined) {
    let mtimeMs: number | undefined;
    try {
      mtimeMs = statSync(path).mtimeMs;
    } catch {
      // Stat race (delete/EACCES after the existsSync check): skip the
      // freshness gate; the read below degrades the same miss to
      // `unreadable`, never a crash.
    }
    if (mtimeMs !== undefined && mtimeMs < runStartMs) return { status: "stale" };
  }

  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return { status: "unreadable" };
  }
  const parsed = parseSmokeVerdict(text);
  if ("malformed" in parsed) return { status: "malformed" };
  return { status: "ok", verdict: parsed };
}

/** Write the artifact for one tracker. Returns the path written. */
export function writeSmokeVerdict(
  path: string,
  verdict: SmokeVerdict,
): string {
  writeFileSync(path, formatSmokeVerdict(verdict), "utf8");
  return path;
}

// --- reconciliation --------------------------------------------------------

/**
 * Distinct non-zero codes so a reconciled rc-file says WHY, not just "failed".
 * All inside 1..255 so they survive a shell's exit-status truncation.
 */
export const RC_MISSING_RC_FILE = 1;
export const RC_VERDICT_NON_PASS = 64;
export const RC_VERDICT_MISSING = 65;
export const RC_VERDICT_MALFORMED = 66;
export const RC_VERDICT_STALE = 67;
export const RC_VERDICT_UNREADABLE = 68;

/** `echo $?` output → an exit code, or undefined when it is not one. */
function parseRcFileValue(value: string | number | null | undefined): number | undefined {
  if (typeof value === "number") {
    return Number.isInteger(value) ? value : undefined;
  }
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0 || !/^-?\d+$/.test(trimmed)) return undefined;
  return Number.parseInt(trimmed, 10);
}

/** Fold any non-zero integer into the 1..255 band a shell can carry. */
function clampNonZero(code: number): number {
  const wrapped = ((code % 256) + 256) % 256;
  return wrapped === 0 ? 1 : wrapped;
}

/**
 * Reconcile a leg's collected exit code against its verdict artifact.
 *
 * This is the move that makes every EXISTING rc-file consumer truthful without
 * changing the documented Phase A gate: the wrapper writes THIS value to the
 * rc-file, and "abort on any non-zero" keeps its exact shape.
 *
 * - A non-zero process rc is never downgraded — a real harness failure wins.
 * - A missing / non-numeric rc-file is itself a failure.
 * - rc=0 is believed only beside a fresh, well-formed `pass` artifact. A
 *   non-pass outcome, a missing artifact (the leg died before writing one), a
 *   malformed artifact, or a stale one from a previous run all reconcile to a
 *   distinct non-zero code.
 */
export function reconcileLegRc(
  rcFileValue: string | number | null | undefined,
  verdict: SmokeVerdictRead,
): number {
  const rc = parseRcFileValue(rcFileValue);
  if (rc === undefined) return RC_MISSING_RC_FILE;
  if (rc !== 0) return clampNonZero(rc);

  switch (verdict.status) {
    case "missing":
      return RC_VERDICT_MISSING;
    case "malformed":
      return RC_VERDICT_MALFORMED;
    case "stale":
      return RC_VERDICT_STALE;
    case "unreadable":
      return RC_VERDICT_UNREADABLE;
    case "ok":
      return verdict.verdict.outcome === "pass" ? 0 : RC_VERDICT_NON_PASS;
  }
}

// --- CLI shim --------------------------------------------------------------
//
// Mirrors socratic_first_turn_assert.ts: a thin `import.meta.main` wrapper over
// the pure functions above, so both driver SKILLs can call one bun command from
// a bash fence instead of hand-rolling JSON in prose.
//
// Usage:
//   bun smoke_verdict.ts emit --tracker <t> [--path <p>] [--outcome pass|fail|abort]
//                            [--live "<pidfile> …"] [--chain-finding "<diag>"]…
//                            [--trigger "<operator context>"]
//   bun smoke_verdict.ts reconcile --rc <n> --artifact <p> [--run-start <epoch-ms>]
//
// `emit` writes the artifact and prints its path. `reconcile` prints the
// reconciled exit code on stdout (so the caller can redirect it straight into
// the rc-file) and exits with it.
//
// `--trigger` is ADDITIVE. The computed trigger — the string naming the armed
// pidfiles and chain findings — is the artifact's only actionable content, so
// operator context is appended to it with the same ` + ` separator
// `buildSmokeVerdict` uses, never substituted for it. On a `pass` the flag is
// inert, because a passing verdict carries no trigger at all.

function parseArgs(argv: readonly string[]): Record<string, string[]> {
  const flags: Record<string, string[]> = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const value = argv[i + 1] !== undefined && !argv[i + 1]!.startsWith("--")
      ? argv[++i]!
      : "";
    (flags[key] ??= []).push(value);
  }
  return flags;
}

function first(flags: Record<string, string[]>, key: string): string | undefined {
  return flags[key]?.[0];
}

if (import.meta.main) {
  const [command, ...rest] = process.argv.slice(2);
  const flags = parseArgs(rest);

  if (command === "emit") {
    const tracker = first(flags, "tracker");
    if (!tracker) {
      console.error("usage: bun smoke_verdict.ts emit --tracker <linear|jira> [--path <p>]");
      process.exit(2);
    }
    const path = first(flags, "path") || smokeVerdictPath(tracker);
    const live = (first(flags, "live") ?? "").split(/\s+/).filter(Boolean);
    const chainFindings: ChildSpawnFinding[] = (flags["chain-finding"] ?? [])
      .filter(Boolean)
      .map((diagnostic) => ({ severity: "high", diagnostic }));
    const declaredRaw = first(flags, "outcome");
    const declared = (SMOKE_OUTCOMES as readonly string[]).includes(declaredRaw ?? "")
      ? (declaredRaw as SmokeOutcome)
      : undefined;
    const verdict = buildSmokeVerdict({ livePidfiles: live, chainFindings, declared });
    // `--trigger` ADDS operator context; it never replaces the computed
    // diagnosis. Overwriting would discard the one string that names the
    // specific armed pidfiles and chain findings — the only actionable part of
    // the artifact — in favour of whatever prose the caller happened to pass.
    // Composed with the same ` + ` separator `buildSmokeVerdict` uses, so the
    // artifact's trigger shape stays a single flat multi-cause string. A
    // `pass` still carries no trigger, and an operator string already present
    // in the computed text is not repeated.
    const trigger = first(flags, "trigger");
    if (trigger && verdict.outcome !== "pass") {
      const computed = verdict.trigger ?? "";
      verdict.trigger = computed === "" || computed.includes(trigger)
        ? computed || trigger
        : `${computed} + ${trigger}`;
    }
    writeSmokeVerdict(path, verdict);
    console.log(`${path}: ${verdict.outcome}${verdict.trigger ? ` — ${verdict.trigger}` : ""}`);
    process.exit(0);
  }

  if (command === "reconcile") {
    const artifact = first(flags, "artifact");
    if (!artifact) {
      console.error("usage: bun smoke_verdict.ts reconcile --rc <n> --artifact <p> [--run-start <ms>]");
      process.exit(2);
    }
    const runStartRaw = first(flags, "run-start");
    const runStart =
      runStartRaw && /^\d+$/.test(runStartRaw)
        ? Number.parseInt(runStartRaw, 10)
        : undefined;
    const read = readSmokeVerdict(artifact, runStart === undefined ? undefined : { runStart });
    const rc = reconcileLegRc(first(flags, "rc"), read);
    console.log(String(rc));
    process.exit(rc);
  }

  console.error("usage: bun smoke_verdict.ts <emit|reconcile> [flags]");
  process.exit(2);
}
