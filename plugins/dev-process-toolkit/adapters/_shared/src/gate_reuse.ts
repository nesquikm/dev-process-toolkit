// STE-724 (M_fd9a03) — the live reuse key.
//
// `computeReuseKey(projectRoot, commandText, options?)` composes the M_7bc805
// `gateReuseKey` and adds only the per-command hash. `options` pass through to
// `gateReuseKey` unchanged; this module reads no toolchain, toolkit or settings
// input of its own.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { firstCopies } from "../../../templates/hooks/_lib/session";
import { detectGate } from "./capture_skip_baseline";
import { deriveRunCounts } from "./deliver_stage_evidence";
import { receiptsDir } from "./dpt_paths";
import { nfr10Message } from "./dpt_version";
import { sessionTranscriptPath } from "./find_current_session";
import { renderTotalsLine } from "./gate_capture";
import { type GateReuseKey, type GateReuseKeyOptions, gateReuseKey } from "./gate_reuse_key";
import { gateKillGraceMs, gateRunTimeoutMs, signalGroup } from "./gate_identity_run";
import {
  GATE_OUTCOME_ANNOUNCEMENT_PREFIX,
  GATE_OUTCOME_KIND,
  GATE_RECEIPT_KIND,
  announcesGateReceipt,
  gateSubject,
  runsGateOutcome,
  sessionReceiptFiles,
  STEP_NAME,
  type StoredReceipt,
} from "./gate_receipt";
import { loadProjectSection, gateOutcomesSwitchOn } from "./project_settings";
import { NEVER_REUSABLE_STEPS, readOptimizations, validateOptimizations } from "./optimizations_config";
import { bunInvocation, realpathOr } from "./shell_invocations";
import {
  announceReceipt,
  assertReceiptSession,
  oneLine,
  parseReceiptAnnouncement,
  RECEIPT_ANNOUNCEMENT_PREFIX,
  receiptDigest,
  writeReceipt,
} from "./tracker_receipts";

export interface ReuseKey {
  gate: GateReuseKey;
  command_sha256: string;
}

export function computeReuseKey(
  projectRoot: string,
  commandText: string,
  options: GateReuseKeyOptions = {},
): ReuseKey | null {
  let gate: GateReuseKey;
  try {
    gate = gateReuseKey(projectRoot, options);
  } catch {
    return null;
  }
  if (gate.head === null || !gate.clean) return null;
  const command_sha256 = `sha256:${createHash("sha256").update(commandText).digest("hex")}`;
  return { gate, command_sha256 };
}

// ---------------------------------------------------------------------------
// The decision and the front door (STE-724 § "The decision").
//
//   bun run gate_reuse.ts run <root> <label> -- <command text>
//
// A stored pass counts only when a `gate-step` receipt of this session passed
// on the live key, its run is referenced by a `gate-outcome` pass with
// `key_stable: true`, and both were announced in this session's transcript by
// the call that wrote them (the STE-614 vouching rule).
// ---------------------------------------------------------------------------

/** The receipt kind a front-door step is recorded under. */
export const GATE_STEP_KIND = "gate-step";

/** The subject every step receipt names. */
const STEP_SUBJECT = gateSubject("gate-check");

/** This module's own file, as the filesystem sees it. */
const OWN_FRONT_DOOR = realpathOr(resolve(import.meta.dir, "gate_reuse.ts"));

/**
 * Whether a Bash command RAN this front door's `run` verb: one plain
 * `bun [run] <absolute path> run …` whose path realpaths to THIS file, read by
 * the `bunInvocation` grammar `announcesGateReceipt` uses.
 */
export function announcesGateStep(command: string): boolean {
  const run = bunInvocation(command);
  return run !== null && run.module === OWN_FRONT_DOOR && run.args[0] === "run";
}

export type ReuseDecision =
  | { reuse: true; receipt: string; summary: string; createdAt: string; key: ReuseKey }
  | { reuse: false; reason: string; key: ReuseKey | null };

type StoredFile = StoredReceipt;

/** `sessionReceiptFiles`, but an unsafe session id reads as an empty store. */
function storedFiles(root: string, sessionId: string): StoredFile[] {
  try {
    receiptsDir(root, sessionId);
  } catch {
    return [];
  }
  return sessionReceiptFiles(root, sessionId);
}

/** The transcript's announcements of each kind, each vouched by the call that printed it. */
interface Announcements {
  steps: Map<string, string>;
  outcomes: Map<string, string>;
  runs: Map<string, string>;
}

function vouchedAnnouncements(transcript: string): Announcements {
  const steps = new Map<string, string>();
  const outcomes = new Map<string, string>();
  const runs = new Map<string, string>();
  let records: unknown[];
  try {
    records = readFileSync(transcript, "utf-8")
      .split("\n")
      .map((l) => {
        try {
          return l.trim() === "" ? null : JSON.parse(l);
        } catch {
          return null;
        }
      });
  } catch {
    return { steps, outcomes, runs };
  }
  const commands = new Map<string, string>();
  for (const { block, record } of firstCopies(records)) {
    if (block.type === "tool_use" && block.name === "Bash" && typeof block.id === "string") {
      const command = (block.input as { command?: unknown } | undefined)?.command;
      if (typeof command === "string") commands.set(block.id, command);
      continue;
    }
    if (block.type !== "tool_result" || block.is_error === true || typeof block.tool_use_id !== "string") continue;
    const command = commands.get(block.tool_use_id);
    if (command === undefined) continue;
    const isStep = announcesGateStep(command);
    const isOutcome = !isStep && runsGateOutcome(command);
    const isRun = !isStep && !isOutcome && announcesGateReceipt(command);
    if (!isStep && !isOutcome && !isRun) continue;
    // A step is vouched only by the door's own stdout: the recorded
    // `toolUseResult.stdout`, never the concatenated content, which also
    // carries the gated command's output. No string stdout vouches nothing.
    const text = isStep ? recordedStdout(record) : resultText(block.content);
    if (text === null) continue;
    // The door prints exactly one stdout line of its own, so a step call whose
    // recorded stdout holds any other non-empty line vouches for nothing
    // (AC-STE-724.5): the extra line may have come from a child writing to the
    // door's stdout directly.
    if (isStep && text.split("\n").filter((l) => l.trim() !== "").length !== 1) continue;
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      if (isStep || isRun) {
        const a = parseReceiptAnnouncement(line);
        if (a !== null && a.digest !== null) (isStep ? steps : runs).set(resolve(a.path), a.digest);
      } else if (line.startsWith(GATE_OUTCOME_ANNOUNCEMENT_PREFIX)) {
        const a = parseReceiptAnnouncement(RECEIPT_ANNOUNCEMENT_PREFIX + line.slice(GATE_OUTCOME_ANNOUNCEMENT_PREFIX.length));
        if (a !== null && a.digest !== null) outcomes.set(resolve(a.path), a.digest);
      }
    }
  }
  return { steps, outcomes, runs };
}

/** The Bash result record's `toolUseResult.stdout`, or null when it is not a string. */
function recordedStdout(record: unknown): string | null {
  const result = (record as { toolUseResult?: unknown } | null)?.toolUseResult;
  if (result === null || typeof result !== "object") return null;
  const stdout = (result as { stdout?: unknown }).stdout;
  return typeof stdout === "string" ? stdout : null;
}

function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((b) => (b !== null && typeof b === "object" && typeof (b as { text?: unknown }).text === "string" ? (b as { text: string }).text : ""))
    .join("\n");
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/** Whether the knob reads `reuse` for `root` with a valid section. */
function knobOn(root: string): boolean {
  try {
    if (readOptimizations(root).gate_commands !== "reuse") return false;
    return validateOptimizations(loadProjectSection(root, "optimizations"), gateOutcomesSwitchOn(root)).length === 0;
  } catch {
    return false;
  }
}

/** This session's stored receipts, read against what its transcript announced. */
interface VouchedSession {
  files: StoredFile[];
  announced: Announcements;
  /** The digests of the runs an announced `gate-outcome` pass with `key_stable: true` references. */
  passedRuns: Set<unknown>;
}

const vouched = (f: StoredFile, announced: Map<string, string>): boolean =>
  announced.get(resolve(f.path)) === receiptDigest(f.bytes);

/** The session's vouched store, or the reason there is none. Reads `CLAUDE_CODE_SESSION_ID`; runs nothing. */
function vouchedSession(realRoot: string): VouchedSession | string {
  const sessionId = process.env.CLAUDE_CODE_SESSION_ID;
  if (sessionId === undefined || sessionId === "") return "no-session";
  const transcript = sessionTranscriptPath(sessionId, process.cwd());
  if (transcript === null) return "no-transcript";
  const announced = vouchedAnnouncements(transcript);
  const files = storedFiles(realRoot, sessionId);
  const passedRuns = new Set(
    files
      .filter(
        (f) =>
          f.record.kind === GATE_OUTCOME_KIND &&
          f.record.decision === "pass" &&
          f.record.evidence?.key_stable === true &&
          vouched(f, announced.outcomes),
      )
      .map((f) => f.record.evidence?.run),
  );
  return { files, announced, passedRuns };
}

/**
 * The ONE decision both verbs share: the `gate-step` receipts `select` picks,
 * newest first, that are vouched passes on `liveKey` of a passed run.
 */
function reusableSteps(
  s: VouchedSession,
  select: (r: Record<string, any>) => boolean,
  liveKey: (r: Record<string, any>) => ReuseKey,
): StoredFile[] {
  const { passedRuns, announced: { steps } } = s;
  const out: StoredFile[] = [];
  for (const f of [...s.files].reverse()) {
    const r = f.record;
    if (r.kind !== GATE_STEP_KIND || r.decision !== "pass" || !select(r)) continue;
    if (r.evidence?.key === null || !deepEqual(r.evidence?.key, liveKey(r))) continue;
    if (typeof r.evidence?.run !== "string" || !passedRuns.has(r.evidence.run)) continue;
    if (!vouched(f, steps)) continue;
    out.push(f);
  }
  return out;
}

/**
 * Decide whether `commandText` under `label` may be reused in `root`. Reads
 * `CLAUDE_CODE_SESSION_ID` and the session transcript; runs nothing.
 */
export async function decideReuse(
  root: string,
  label: string,
  commandText: string,
  options: GateReuseKeyOptions = {},
): Promise<ReuseDecision> {
  const realRoot = realpathOr(root);
  if (!knobOn(realRoot)) return { reuse: false, reason: "knob-off", key: null };
  const key = computeReuseKey(realRoot, commandText, options);
  if (key === null) return { reuse: false, reason: "no-key", key };
  const session = vouchedSession(realRoot);
  if (typeof session === "string") return { reuse: false, reason: session, key };
  const f = reusableSteps(session, (r) => r.evidence?.label === label, () => key)[0];
  if (f === undefined) return { reuse: false, reason: "no-stored-pass", key };
  const r = f.record;
  return { reuse: true, receipt: f.path, summary: String(r.evidence.summary ?? ""), createdAt: String(r.createdAt), key };
}

/** The `gate-check` run receipts among `files` recorded for `root`, oldest first. */
function gateRunReceipts(files: StoredFile[], root: string): StoredFile[] {
  return files.filter(
    (f) => f.record.kind === GATE_RECEIPT_KIND && f.record.subject === STEP_SUBJECT && f.record.root === root,
  );
}

/**
 * STE-725 — whether this session's latest announced `gate-check` run is clean:
 * a passed run that recorded at least one `gate-step`, every one of them a
 * vouched pass on the live key (its `command_sha256` taken from the stored
 * step), and the run's latest vouched `gate-outcome` is itself a pass with
 * `key_stable: true` that lists those step labels exactly, each `pass`. Runs nothing and writes nothing; any error reads as not clean.
 */
export function gateRunClean(root: string): boolean {
  try {
    const realRoot = realpathOr(root);
    if (!knobOn(realRoot)) return false;
    const live = computeReuseKey(realRoot, "");
    if (live === null) return false;
    const session = vouchedSession(realRoot);
    if (typeof session === "string") return false;
    const runs = gateRunReceipts(session.files, realRoot).filter((f) => vouched(f, session.announced.runs));
    const latest = runs[runs.length - 1];
    if (latest === undefined) return false;
    const run = receiptDigest(latest.bytes);
    const ofRun = (r: Record<string, any>): boolean => r.evidence?.run === run;
    const recorded = session.files.filter((f) => f.record.kind === GATE_STEP_KIND && ofRun(f.record));
    if (recorded.length === 0) return false;
    const passes = reusableSteps(session, ofRun, (r) => ({ gate: live.gate, command_sha256: r.evidence?.key?.command_sha256 }));
    if (passes.length !== recorded.length) return false;
    // One account (STE-724): the run's vouched outcome names exactly the labels of its vouched step passes, each `pass`.
    const outcome = session.files
      .filter((f) => f.record.kind === GATE_OUTCOME_KIND && ofRun(f.record) && vouched(f, session.announced.outcomes))
      .pop();
    // STE-725.2: the LATEST vouched outcome alone decides; an earlier pass never rescues it.
    if (outcome?.record.decision !== "pass" || outcome.record.evidence?.key_stable !== true) return false;
    const listed: unknown = outcome.record.evidence?.steps;
    if (!Array.isArray(listed) || listed.length === 0) return false;
    if (!listed.every((s) => typeof s?.name === "string" && s.result === "pass")) return false;
    const names = new Set(listed.map((s) => s.name as string));
    const labels = new Set(passes.map((f) => f.record.evidence?.label));
    return names.size === labels.size && [...names].every((n) => labels.has(n));
  } catch {
    return false;
  }
}

/** The digest of this session's latest `gate` run receipt for `root`, or null. */
function enclosingRun(root: string, sessionId: string): string | null {
  const runs = gateRunReceipts(storedFiles(root, sessionId), root);
  const last = runs[runs.length - 1];
  return last === undefined ? null : receiptDigest(last.bytes);
}

/** The step's summary: the totals line when the stack parses, else the last line with paths hidden. */
function summarise(root: string, output: string): string {
  const gate = detectGate(root);
  if (gate !== null && deriveRunCounts({ output, stack: gate.stack }).ok) return renderTotalsLine({ output, stack: gate.stack });
  const lines = output.split("\n").map((l) => l.trim()).filter((l) => l !== "");
  const last = lines[lines.length - 1] ?? "";
  // An absolute path begins at a `/` not inside a word or a relative path (so after `=`, `(`, a quote,
  // `:` or whitespace) and ends at whitespace, a quote, a bracket or a `:<line>` suffix.
  return last.replace(/(?<![\w.~\/-])\/[^\s'"`()[\]{}<>:,;]*/g, "<path>").slice(0, 200);
}

/** How much of a run's output is kept for the summary: the tail, where the totals line sits. */
const OUTPUT_TAIL_CHARS = 256 * 1024;

async function runCommand(commandText: string, cwd: string): Promise<{ exit: number; output: string; ms: number }> {
  const started = Date.now();
  // A group leader (`detached`), so a timeout reaches every child the shell
  // backgrounded, not just `sh` itself (AC-STE-724.14).
  const proc = Bun.spawn(["sh", "-c", commandText], { cwd, stdout: "pipe", stderr: "pipe", stdin: "inherit", detached: true });
  let output = "";
  let timedOut = false;
  let graceTimer: ReturnType<typeof setTimeout> | undefined;
  let releaseOnTimeout: () => void = () => {};
  const onTimeout = new Promise<void>((done) => (releaseOnTimeout = done));
  const timer = setTimeout(() => {
    timedOut = true;
    signalGroup(proc.pid, "SIGTERM");
    graceTimer = setTimeout(() => {
      signalGroup(proc.pid, "SIGKILL");
      releaseOnTimeout();
    }, gateKillGraceMs());
  }, gateRunTimeoutMs());
  const pump = async (stream: ReadableStream<Uint8Array>, sink: NodeJS.WriteStream): Promise<void> => {
    const decoder = new TextDecoder();
    for await (const chunk of stream) {
      sink.write(chunk);
      output += decoder.decode(chunk, { stream: true });
      if (output.length > 2 * OUTPUT_TAIL_CHARS) output = output.slice(-OUTPUT_TAIL_CHARS);
    }
  };
  try {
    // Everything the gated command prints goes to the door's stderr, so the
    // door's stdout carries only the door's own lines (STE-724 self-forgery).
    // A killed group's orphan may still hold a pipe: stop reading once the kill lands.
    try {
      await Promise.race([Promise.all([pump(proc.stdout, process.stderr), pump(proc.stderr, process.stderr)]), onTimeout]);
    } catch (error) {
      // A pump that rejects (e.g. EPIPE on the door's stderr) must not leave the group running.
      signalGroup(proc.pid, "SIGKILL");
      throw error;
    }
    const code = await Promise.race([proc.exited, onTimeout.then(() => null)]);
    // A run past its bound, or one ended by a signal (no exit code), never reads as exit 0.
    const exit = timedOut ? 124 : code === null || proc.signalCode !== null ? 1 : code;
    return { exit, output: output.slice(-OUTPUT_TAIL_CHARS), ms: Date.now() - started };
  } finally {
    clearTimeout(timer);
    if (graceTimer !== undefined) clearTimeout(graceTimer);
  }
}

async function frontDoor(argv: readonly string[]): Promise<number> {
  const [verb, rootArg, label, sep, ...rest] = argv;
  if (verb === "verdict") {
    console.log(rootArg !== undefined && label === undefined && gateRunClean(rootArg) ? "clean" : "rerun");
    return 0;
  }
  if (verb !== "run" || rootArg === undefined || label === undefined || sep !== "--" || rest.length === 0) {
    console.error(
      nfr10Message(
        "gate_reuse: the front door was given fewer than the values it needs, so nothing ran",
        "run `bun run gate_reuse.ts run <root> <label> -- <command text>`",
        "reason=incomplete-argv",
      ),
    );
    return 1;
  }
  // The reuse key hashes the exact command text, so it arrives as ONE argument:
  // joining several argv with spaces would let `sh -c` re-parse quoted ones.
  if (rest.length !== 1) {
    console.error(
      nfr10Message(
        `gate_reuse: the front door takes the command text as exactly one argument after --, and was given ${rest.length}, so nothing ran`,
        "quote the whole command: `bun run gate_reuse.ts run <root> <label> -- \"<command text>\"`",
        `reason=argv-count, count=${rest.length}`,
      ),
    );
    return 1;
  }
  if (!STEP_NAME.test(label)) {
    const shown = oneLine(label);
    console.error(
      nfr10Message(
        `gate_reuse: the label "${shown}" does not match ${STEP_NAME.source}, so nothing ran`,
        "pass a label of 1-40 characters: a lowercase letter, then lowercase letters, digits, _ or -",
        `reason=bad-label, label=${shown}`,
      ),
    );
    return 1;
  }
  if ((NEVER_REUSABLE_STEPS as readonly string[]).includes(label)) {
    console.error(
      nfr10Message(
        `gate_reuse: "${label}" names a step that is never reusable, so nothing ran`,
        "run that step directly; the front door takes only a gate command",
        `reason=never-reusable, label=${label}`,
      ),
    );
    return 1;
  }
  const commandText = rest[0] as string;
  const root = realpathOr(rootArg);
  if (!knobOn(root)) {
    console.error("gate_reuse: optimizations.gate_commands is not reuse, so the command runs and no step receipt is written");
    return (await runCommand(commandText, root)).exit;
  }
  try {
    assertReceiptSession(root);
  } catch {
    console.error("gate_reuse: CLAUDE_CODE_SESSION_ID is unset, empty or not path-safe, so the command runs and no step receipt is written");
    return (await runCommand(commandText, root)).exit;
  }
  const sessionId = process.env.CLAUDE_CODE_SESSION_ID as string;
  const decision = await decideReuse(root, label, commandText);
  if (decision.reuse) {
    console.log(`dpt-reuse: ${label} — ${oneLine(decision.summary)} (stored run ${decision.createdAt}, exit 0, ${decision.receipt})`);
    return 0;
  }
  const run = await runCommand(commandText, root);
  const path = writeReceipt(root, {
    kind: GATE_STEP_KIND,
    adapter: null,
    container: null,
    subject: STEP_SUBJECT,
    decision: run.exit === 0 ? "pass" : "fail",
    evidence: {
      key: decision.key,
      label,
      exit: run.exit,
      summary: summarise(root, run.output),
      duration_ms: run.ms,
      run: enclosingRun(root, sessionId),
    },
  });
  console.log(announceReceipt(path));
  return run.exit;
}

if (import.meta.main) process.exit(await frontDoor(process.argv.slice(2)));
