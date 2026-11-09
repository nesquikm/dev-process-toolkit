// STE-724 (M_fd9a03) — the live reuse key.
//
// `computeReuseKey(projectRoot, commandText, options?)` composes the M_7bc805
// `gateReuseKey` and adds only the per-command hash. `options` pass through to
// `gateReuseKey` unchanged; this module reads no toolchain, toolkit or settings
// input of its own.

import { createHash, randomBytes } from "node:crypto";
import { closeSync, fstatSync, mkdirSync, openSync, readFileSync, readSync } from "node:fs";
import { join, resolve } from "node:path";

import { firstCopies } from "../../../templates/hooks/_lib/session";
import { detectGate } from "./capture_skip_baseline";
import { deriveRunCounts } from "./deliver_stage_evidence";
import { gateStepLogsDir, receiptsDir } from "./dpt_paths";
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
import { isNeverReusable, readOptimizations, validateOptimizations } from "./optimizations_config";
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
  // `git status` cannot see an edit behind a skip-worktree or assume-unchanged
  // flag, an fsmonitor hook, a clean filter or a stat shortcut, so the tree is
  // re-read with each of those off, and any one of them set means no key.
  if (statusHidersSet(projectRoot)) return null;
  const command_sha256 = `sha256:${createHash("sha256").update(commandText).digest("hex")}`;
  return { gate, command_sha256 };
}

/**
 * The paths `git ls-files -v` tags with anything but `H` (a plain cached
 * entry): `h` and every other lowercase tag (assume-unchanged), `S` and `s`
 * (skip-worktree), and any other tag, unmerged `M` included. Fails safe.
 */
export function hiddenIndexEntries(lsFilesV: string): string[] {
  return lsFilesV
    .split("\n")
    .filter((l) => l !== "")
    .filter((l) => !l.startsWith("H "))
    .map((l) => l.slice(2));
}

/**
 * The flags every git call of the clean check runs with: no fsmonitor hook and
 * no untracked cache answers for the worktree, and no optional index lock is
 * taken (PR #133 review 2). The ctime, full-stat and mode checks are forced on,
 * so a local `core.trustctime=false`, `core.checkStat=minimal` or
 * `core.fileMode=false` cannot hide an edit (PR #133 review 3). On a
 * filesystem without modes, fileMode=true reports every file changed: no key,
 * which fails safe. Case folding and Unicode precomposition are forced off, so
 * the macOS defaults (`core.ignorecase=true`, `core.precomposeunicode=true`)
 * cannot hide a case-only or NFC/NFD rename done with plain `mv` (PR #133
 * review 4). A tree whose on-disk names differ from the index in case or
 * normal form then never reuses, which fails safe.
 */
export const TRUSTED_GIT = ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", "-c", "core.trustctime=true", "-c", "core.checkStat=default", "-c", "core.fileMode=true", "-c", "core.ignorecase=false", "-c", "core.precomposeunicode=false"] as const;

/** `git <TRUSTED_GIT> -C root <args>`'s stdout; throws on any failure. */
function trustedGit(root: string, args: readonly string[], stdin?: string): string {
  const p = Bun.spawnSync(["git", ...TRUSTED_GIT, "-C", root, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    stdin: stdin === undefined ? "ignore" : Buffer.from(stdin),
  });
  if (p.exitCode !== 0) throw new Error(`git ${args.join(" ")} exited ${p.exitCode}`);
  return p.stdout.toString();
}

/**
 * `git config --get` of `key` as the repo configures it, or null when it is
 * unset (exit 1). Never through TRUSTED_GIT: its `-c` overrides would answer
 * for the very keys this reads.
 */
function configValue(root: string, key: string, type?: "bool"): string | null {
  const p = Bun.spawnSync(["git", "--no-optional-locks", "-C", root, "config", ...(type ? [`--type=${type}`] : []), "--get", key], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (p.exitCode === 1) return null;
  if (p.exitCode !== 0) throw new Error(`git config --get ${key} exited ${p.exitCode}`);
  return p.stdout.toString().trim();
}

/**
 * The filter drivers the `filter` attribute names on `paths` that have a
 * `clean`, `smudge` or `process` command configured. An attribute naming no
 * configured driver filters nothing, so it is not listed.
 */
function configuredFilters(root: string, paths: string): string[] {
  if (paths === "") return [];
  const fields = trustedGit(root, ["check-attr", "-z", "--stdin", "filter"], paths).split("\0");
  const names = new Set<string>();
  for (let i = 2; i < fields.length; i += 3) {
    const v = fields[i]!;
    if (v !== "" && v !== "unspecified" && v !== "unset" && v !== "set") names.add(v);
  }
  return [...names].filter((n) => ["clean", "smudge", "process"].some((k) => (configValue(root, `filter.${n}.${k}`) ?? "") !== ""));
}

/**
 * Whether local git state could make `git status` call an edited tree clean:
 * a dirty `git status` once fsmonitor and the untracked cache are off (with
 * every untracked file and submodule shown), any index entry `git ls-files -v`
 * tags other than `H`, `core.ignoreStat` true, `core.checkStat` minimal, or a
 * configured clean, smudge or process filter on a tracked path. Any git
 * failure reads as set. Fails safe.
 */
function statusHidersSet(root: string): boolean {
  try {
    if (trustedGit(root, ["status", "--porcelain", "--untracked-files=normal", "--ignore-submodules=none"]).trim() !== "") return true;
    if (hiddenIndexEntries(trustedGit(root, ["ls-files", "-v"])).length > 0) return true;
    if (configValue(root, "core.ignoreStat", "bool") === "true") return true;
    if ((configValue(root, "core.checkStat") ?? "").toLowerCase() === "minimal") return true;
    return configuredFilters(root, trustedGit(root, ["ls-files", "-z"])).length > 0;
  } catch {
    return true;
  }
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

/** The prefix of the ONE line the door prints after running a gated command. */
export const GATE_STEP_ANNOUNCEMENT_PREFIX = "dpt-gate-step: ";

/** The hint every step line carries: the command's own output is in the log, never on the door's streams. */
const READ_THE_LOG = "read the log on failure";

const STEP_LINE = new RegExp(
  `^${GATE_STEP_ANNOUNCEMENT_PREFIX}([a-z][a-z0-9_-]{0,39}) exit (\\d+) — (.*?), log (\\S.*?), ${READ_THE_LOG}, receipt (.+)$`,
);

/**
 * `dpt-gate-step: <label> exit <N> — <summary>, log <log path>, read the log
 * on failure, receipt <receipt path> sha256:<digest>`, the door's one line
 * after a run. The summary is the stored one, flattened onto the line; text
 * in it that mimics the grammar only breaks the parse, which vouches nothing.
 */
export function announceStep(label: string, exit: number, summary: string, log: string, receiptPath: string): string {
  const receipt = announceReceipt(receiptPath).slice(RECEIPT_ANNOUNCEMENT_PREFIX.length);
  return `${GATE_STEP_ANNOUNCEMENT_PREFIX}${label} exit ${exit} — ${oneLine(summary)}, log ${resolve(log)}, ${READ_THE_LOG}, receipt ${receipt}`;
}

/** Parse a step line; the receipt part is read by `parseReceiptAnnouncement`, never a second parser. */
export function parseStepAnnouncement(
  line: string,
): { label: string; exit: number; summary: string; log: string; path: string; digest: string } | null {
  const m = STEP_LINE.exec(line);
  if (m === null) return null;
  const a = parseReceiptAnnouncement(RECEIPT_ANNOUNCEMENT_PREFIX + m[5]!);
  if (a === null || a.digest === null) return null;
  return { label: m[1]!, exit: Number(m[2]), summary: m[3]!, log: m[4]!, path: a.path, digest: a.digest };
}

/** What a vouched step line binds a receipt file to: its digest, label and exit. */
const stepToken = (digest: string, label: unknown, exit: unknown): string => `${digest} ${String(label)} ${String(exit)}`;

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
  /** Step receipt path → its vouched token and the transcript line of the call that printed it. */
  steps: Map<string, { token: string; line: number }>;
  outcomes: Map<string, string>;
  runs: Map<string, string>;
  /** Run receipt path → the transcript line of the call that announced it. */
  runLines: Map<string, number>;
  /**
   * The door calls recorded `is_error: true` (how Claude Code records a
   * non-zero exit), each a FAIL for its label at its transcript line. No vouch
   * is needed: a forged fail can only cause a rerun.
   */
  failedCalls: Array<{ label: string; line: number }>;
}

function vouchedAnnouncements(transcript: string): Announcements {
  const steps = new Map<string, { token: string; line: number }>();
  const outcomes = new Map<string, string>();
  const runs = new Map<string, string>();
  const runLines = new Map<string, number>();
  const failedCalls: Array<{ label: string; line: number }> = [];
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
    return { steps, outcomes, runs, runLines, failedCalls };
  }
  const commands = new Map<string, string>();
  const real = realResults(records);
  for (const { block, line: first } of firstCopies(records)) {
    if (block.type === "tool_use" && block.name === "Bash" && typeof block.id === "string") {
      const command = (block.input as { command?: unknown } | undefined)?.command;
      if (typeof command === "string") commands.set(block.id, command);
      continue;
    }
    if (block.type !== "tool_result" || typeof block.tool_use_id !== "string") continue;
    const command = commands.get(block.tool_use_id);
    if (command === undefined) continue;
    // The copy that vouches is the real result record, never an
    // `api-request-blob` copy of it (PR #133 review 4). A fail on any copy
    // still counts as a fail.
    const copy = real.get(block.tool_use_id);
    const at = copy?.line ?? first;
    if (block.is_error === true || copy?.block.is_error === true) {
      const label = failedDoorLabel(command);
      if (label !== null) failedCalls.push({ label, line: at });
      continue;
    }
    if (copy === undefined) continue;
    const { record } = copy;
    const isStep = announcesGateStep(command);
    const isOutcome = !isStep && runsGateOutcome(command);
    const isRun = !isStep && !isOutcome && announcesGateReceipt(command);
    if (!isStep && !isOutcome && !isRun) continue;
    // A step is vouched only by the recorded `toolUseResult.stdout`. Claude
    // Code records the process's stderr inside it too, and the door sends the
    // gated command's output to its log, so the door's whole recorded output
    // is its one line (operator ruling 2026-11-09). No string stdout vouches nothing.
    const text = isStep ? recordedStdout(record) : resultText(copy.block.content);
    if (text === null) continue;
    // Any other non-empty line (a child writing to the door's streams, say)
    // and the call vouches for nothing (AC-STE-724.5).
    if (isStep) {
      const lines = text.split("\n").filter((l) => l.trim() !== "");
      const a = lines.length === 1 ? parseStepAnnouncement(lines[0]!.trim()) : null;
      if (a !== null) steps.set(resolve(a.path), { token: stepToken(a.digest, a.label, a.exit), line: at });
      continue;
    }
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      if (isRun) {
        const a = parseReceiptAnnouncement(line);
        if (a !== null && a.digest !== null) {
          runs.set(resolve(a.path), a.digest);
          runLines.set(resolve(a.path), at);
        }
      } else if (line.startsWith(GATE_OUTCOME_ANNOUNCEMENT_PREFIX)) {
        const a = parseReceiptAnnouncement(RECEIPT_ANNOUNCEMENT_PREFIX + line.slice(GATE_OUTCOME_ANNOUNCEMENT_PREFIX.length));
        if (a !== null && a.digest !== null) outcomes.set(resolve(a.path), a.digest);
      }
    }
  }
  return { steps, outcomes, runs, runLines, failedCalls };
}

/** The record type Claude Code gives its request-body copies of earlier messages. */
const API_REQUEST_BLOB = "api-request-blob";

/**
 * Each `tool_use_id`'s real result: the first `tool_result` block for it in a
 * record that is not an `api-request-blob` copy, preferring a record that
 * carries `toolUseResult`. Claude Code 2.1.319 writes the blob copy, which has
 * no `toolUseResult`, AHEAD of the real record, so the first copy alone would
 * leave the step unvouched (PR #133 review 4). An id whose only copies are
 * blobs has no entry, and vouches nothing.
 */
function realResults(records: readonly unknown[]): Map<string, { block: Record<string, unknown>; record: unknown; line: number }> {
  const out = new Map<string, { block: Record<string, unknown>; record: unknown; line: number }>();
  records.forEach((raw, line) => {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return;
    const record = raw as { type?: unknown; toolUseResult?: unknown; message?: { content?: unknown } };
    if (record.type === API_REQUEST_BLOB) return;
    const content = record.message?.content;
    if (!Array.isArray(content)) return;
    for (const b of content) {
      if (b === null || typeof b !== "object" || Array.isArray(b)) continue;
      const block = b as Record<string, unknown>;
      if (block.type !== "tool_result" || typeof block.tool_use_id !== "string") continue;
      const earlier = out.get(block.tool_use_id);
      const carries = record.toolUseResult !== undefined;
      const earlierCarries = (earlier?.record as { toolUseResult?: unknown } | undefined)?.toolUseResult !== undefined;
      if (earlier === undefined || (carries && !earlierCarries)) out.set(block.tool_use_id, { block, record, line });
    }
  });
  return out;
}

/** The label a front-door `run` call names (`run <root> <label> -- …`), or null for any other command. */
function failedDoorLabel(command: string): string | null {
  if (!announcesGateStep(command)) return null;
  const label = bunInvocation(command)?.args[2];
  return typeof label === "string" ? label : null;
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
}

const vouched = (f: StoredFile, announced: Map<string, string>): boolean =>
  announced.get(resolve(f.path)) === receiptDigest(f.bytes);

/** A step receipt is vouched by a step line naming its digest, its label and its exit. */
const stepVouched = (s: VouchedSession, f: StoredFile): boolean =>
  s.announced.steps.get(resolve(f.path))?.token === stepToken(receiptDigest(f.bytes), f.record.evidence?.label, f.record.evidence?.exit);

/**
 * Whether a FAIL for vouched step `f`'s label came after it, vouched or not:
 * a stored step receipt for the same label, newer in the store, with a
 * non-zero exit or a decision other than pass, stored on `key` or on a null
 * key (a failing run that changed the tree, PR #133 review 3); or a door call
 * for the label recorded `is_error: true` after the call that announced `f`.
 * A fail on a different non-null key is another tree and does not count.
 */
function failedSince(s: VouchedSession, f: StoredFile, key: ReuseKey): boolean {
  const label = f.record.evidence?.label;
  const newer = s.files.slice(s.files.indexOf(f) + 1);
  const storedFail = newer.some(
    (g) =>
      g.record.kind === GATE_STEP_KIND &&
      g.record.evidence?.label === label &&
      (g.record.evidence?.key === null || deepEqual(g.record.evidence?.key, key)) &&
      (g.record.decision !== "pass" || g.record.evidence?.exit !== 0),
  );
  if (storedFail) return true;
  const at = s.announced.steps.get(resolve(f.path))?.line ?? -1;
  return s.announced.failedCalls.some((c) => c.label === label && c.line > at);
}

/** The session's vouched store, or the reason there is none. Reads `CLAUDE_CODE_SESSION_ID`; runs nothing. */
function vouchedSession(realRoot: string): VouchedSession | string {
  const sessionId = process.env.CLAUDE_CODE_SESSION_ID;
  if (sessionId === undefined || sessionId === "") return "no-session";
  const transcript = sessionTranscriptPath(sessionId, process.cwd());
  if (transcript === null) return "no-transcript";
  return { files: storedFiles(realRoot, sessionId), announced: vouchedAnnouncements(transcript) };
}

/**
 * The step labels a run's LATEST vouched `gate-outcome` lists, when that
 * outcome is a pass with `key_stable: true` listing every step as `pass`;
 * else null. An earlier pass never rescues a later outcome (STE-725.2).
 */
function passedRunLabels(s: VouchedSession, run: unknown): Set<string> | null {
  if (typeof run !== "string") return null;
  const outcome = s.files
    .filter((f) => f.record.kind === GATE_OUTCOME_KIND && f.record.evidence?.run === run && vouched(f, s.announced.outcomes))
    .pop();
  if (outcome?.record.decision !== "pass" || outcome.record.evidence?.key_stable !== true) return null;
  const listed: unknown = outcome.record.evidence?.steps;
  if (!Array.isArray(listed) || listed.length === 0) return null;
  if (!listed.every((x) => typeof x?.name === "string" && x.result === "pass")) return null;
  return new Set(listed.map((x) => x.name as string));
}

/**
 * The ONE decision both verbs share: whether stored step `f` is a vouched pass
 * on `liveKey` whose run's latest vouched outcome passed and lists its label.
 */
function stepStands(s: VouchedSession, f: StoredFile, liveKey: ReuseKey): boolean {
  const r = f.record;
  if (r.kind !== GATE_STEP_KIND || r.decision !== "pass") return false;
  if (r.evidence?.key === null || !deepEqual(r.evidence?.key, liveKey)) return false;
  if (!stepVouched(s, f)) return false;
  if (failedSince(s, f, liveKey)) return false;
  return passedRunLabels(s, r.evidence?.run)?.has(r.evidence?.label) === true;
}

/** The newest vouched `gate-step` receipt for `label` on `liveKey`, pass or fail. */
function newestStep(s: VouchedSession, label: string, liveKey: ReuseKey): StoredFile | undefined {
  return [...s.files]
    .reverse()
    .find(
      (f) =>
        f.record.kind === GATE_STEP_KIND &&
        f.record.evidence?.label === label &&
        deepEqual(f.record.evidence?.key, liveKey) &&
        stepVouched(s, f),
    );
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
  // The NEWEST vouched step for this label and key decides; a later fail is never shadowed by an earlier pass.
  const f = newestStep(session, label, key);
  if (f === undefined || !stepStands(session, f, key)) return { reuse: false, reason: "no-stored-pass", key };
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
    // A door call that failed after the run was announced, with or without a stored receipt, is never clean.
    const runAt = session.announced.runLines.get(resolve(latest.path)) ?? -1;
    if (session.announced.failedCalls.some((c) => c.line > runAt)) return false;
    const run = receiptDigest(latest.bytes);
    const ofRun = (r: Record<string, any>): boolean => r.evidence?.run === run;
    const recorded = session.files.filter((f) => f.record.kind === GATE_STEP_KIND && ofRun(f.record));
    if (recorded.length === 0) return false;
    const stands = recorded.filter((f) =>
      stepStands(session, f, { gate: live.gate, command_sha256: f.record.evidence?.key?.command_sha256 }),
    );
    if (stands.length !== recorded.length) return false;
    // One account (STE-724): the run's latest vouched outcome names exactly the labels of its vouched step passes.
    const names = passedRunLabels(session, run);
    if (names === null) return false;
    const labels = new Set(stands.map((f) => f.record.evidence?.label));
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

/** How much of a run's log is read back for the summary: the tail, where the totals line sits. */
const OUTPUT_TAIL_CHARS = 256 * 1024;

/**
 * Run `commandText` through `sh -c` with stdin closed and BOTH its stdout and
 * stderr on the file descriptor `out`: the step log, or the door's own stderr
 * on a hand run that records nothing. The child holds no descriptor of the
 * door's stdout.
 */
async function runCommand(commandText: string, cwd: string, out: number): Promise<{ exit: number; ms: number }> {
  const started = Date.now();
  // A group leader (`detached`), so a timeout reaches every child the shell
  // backgrounded, not just `sh` itself (AC-STE-724.14).
  const proc = Bun.spawn(["sh", "-c", commandText], { cwd, stdout: out, stderr: out, stdin: "ignore", detached: true });
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
  try {
    const code = await Promise.race([proc.exited, onTimeout.then(() => null)]);
    // A run past its bound, or one ended by a signal (no exit code), never reads as exit 0.
    const exit = timedOut ? 124 : code === null || proc.signalCode !== null ? 1 : code;
    return { exit, ms: Date.now() - started };
  } finally {
    clearTimeout(timer);
    if (graceTimer !== undefined) clearTimeout(graceTimer);
  }
}

/** The last `OUTPUT_TAIL_CHARS` bytes of the log behind `fd`, decoded. */
function logTail(fd: number): string {
  const size = fstatSync(fd).size;
  const length = Math.min(size, OUTPUT_TAIL_CHARS);
  const buf = Buffer.alloc(length);
  readSync(fd, buf, 0, length, size - length);
  return buf.toString("utf-8");
}

/** The process's stderr descriptor, the sink of a hand run that records nothing. */
const DOOR_STDERR = 2;

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
  if (isNeverReusable(label)) {
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
    return (await runCommand(commandText, root, DOOR_STDERR)).exit;
  }
  try {
    assertReceiptSession(root);
  } catch {
    console.error("gate_reuse: CLAUDE_CODE_SESSION_ID is unset, empty or not path-safe, so the command runs and no step receipt is written");
    return (await runCommand(commandText, root, DOOR_STDERR)).exit;
  }
  const sessionId = process.env.CLAUDE_CODE_SESSION_ID as string;
  const decision = await decideReuse(root, label, commandText);
  if (decision.reuse) {
    console.log(`dpt-reuse: ${label} — ${oneLine(decision.summary)} (stored run ${decision.createdAt}, exit 0, ${decision.receipt})`);
    return 0;
  }
  // The gated command's stdout and stderr go to its step log, never to the
  // door's streams, so the door's whole recorded output is its one line.
  let log: string;
  let fd: number;
  try {
    const dir = gateStepLogsDir(root, sessionId);
    mkdirSync(dir, { recursive: true });
    log = join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomBytes(4).toString("hex")}-${label}.log`);
    fd = openSync(log, "wx+", 0o600);
  } catch (error) {
    console.error(`gate_reuse: the step log could not be created, so the command runs and no step receipt is written: ${oneLine(String(error))}`);
    return (await runCommand(commandText, root, DOOR_STDERR)).exit;
  }
  let run: { exit: number; ms: number };
  let output: string;
  try {
    run = await runCommand(commandText, root, fd);
    output = logTail(fd);
  } finally {
    closeSync(fd);
  }
  const summary = summarise(root, output);
  // The pass was measured on the bytes the run ended on: a run that left the
  // tree changed stores key: null, which is never reused.
  const after = decision.key === null ? null : computeReuseKey(root, commandText);
  const key = after !== null && deepEqual(after, decision.key) ? decision.key : null;
  const path = writeReceipt(root, {
    kind: GATE_STEP_KIND,
    adapter: null,
    container: null,
    subject: STEP_SUBJECT,
    decision: run.exit === 0 ? "pass" : "fail",
    evidence: {
      key,
      label,
      exit: run.exit,
      summary,
      duration_ms: run.ms,
      run: enclosingRun(root, sessionId),
    },
  });
  console.log(announceStep(label, run.exit, summary, log, path));
  return run.exit;
}

if (import.meta.main) process.exit(await frontDoor(process.argv.slice(2)));
