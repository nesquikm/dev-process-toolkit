// Shared helper for Process-category enforcement hooks (STE-285 / STE-290).
//
// Reads the current Claude Code session log (JSONL stream at the hook
// payload's `transcript_path`) and looks for a `Skill` tool_use entry naming
// a specific skill. Fail-open when the payload is unparseable / missing
// `transcript_path` (hook invoked outside a Claude Code session, e.g. a bare
// `git commit`).
//
// Public API:
//   parseHookPayload(stdin) => HookPayload | null
//   readTranscriptLines(payload) => string[] | null           (THE reader)
//   harnessAbsent(payload) => boolean                         (the ONE fail-open leg)
//   findSkillToolUse(skill, payload) => { found: boolean }   (no stderr emit)
//   requireSkillToolUse(skill, hook, payload) => { found: boolean }
//   findRedBeforeProof(payload, requiredPaths) => { found, uncovered }
//   requireTddEvidence(skill, hook, payload, requiredPaths) => { found: boolean }
//   emitNFR10(verdict, why, how, skill, hook) => void
//   RED_BEFORE_PROOF_MARKER                                  (operator contract)
//
// STE-598 — the /tdd requirement has TWO satisfying doors, not one. The
// orchestrator Skill tool_use is the first; a recorded red-before proof naming
// the staged test paths is the second, for audit-driven work that has no FR and
// therefore cannot run the per-FR orchestrator honestly. Both doors are read
// through the SAME transcript reader (`readTranscriptLines`) — no second
// discovery mechanism ships (AC-STE-598.3).

import { existsSync, readFileSync, realpathSync } from "node:fs";

// ---------------------------------------------------------------------------
// Hook payload shape (Claude Code 2.1.x stdin JSON contract)
// ---------------------------------------------------------------------------

export type HookPayload = {
  session_id: string;
  transcript_path: string;
  cwd: string;
  permission_mode?: string;
  hook_event_name: string;
  tool_name?: string;
  tool_input?: {
    command?: string;
    description?: string;
    [k: string]: unknown;
  };
  tool_use_id?: string;
  prompt?: string;
};

// ---------------------------------------------------------------------------
// parseHookPayload — fail-open JSON parser
// ---------------------------------------------------------------------------

/**
 * Parse a Claude Code hook stdin JSON payload. Returns `null` on:
 *   - empty / whitespace-only stdin
 *   - unparseable JSON
 *   - missing `transcript_path` field
 *
 * Fail-open by design: hooks invoked outside a Claude Code session (e.g. a
 * bare `git commit` from the terminal) get an empty stdin and must not
 * block the user.
 */
export function parseHookPayload(stdin: string): HookPayload | null {
  if (!stdin || stdin.trim() === "") {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdin);
  } catch {
    return null;
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    typeof (parsed as Record<string, unknown>).transcript_path !== "string"
  ) {
    return null;
  }
  return parsed as HookPayload;
}

// ---------------------------------------------------------------------------
// emitNFR10 — byte-stable NFR-10 stderr block (STE-286 §104)
// ---------------------------------------------------------------------------

/**
 * Collapse every run of control characters and Unicode line separators to one
 * space, then trim: the same rule as `oneLine` in `tracker_receipts.ts`, kept
 * here because this file stays free of relative imports (its suites load it
 * from a temp copy); a parity test pins the two together. A refusal quotes
 * words the model wrote, and the transcript records hook stderr verbatim, so an
 * embedded newline must never start a line of its own — a forged
 * `dpt-receipt:` among them (STE-601 review).
 */
export function oneLine(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f\u0085\u2028\u2029]+/g, " ").trim();
}


/**
 * Emit a 3-line NFR-10-shape block to stderr.
 *
 * Byte-stable substrings (per STE-286 §104):
 *   "<verdict>: <why>"
 *   "Remedy: <how>"
 *   "Context: mode=hook, ticket=unbound, skill=<skill>, hook=<hook>"
 */
export function emitNFR10(
  verdict: "Refusing" | "Reminder",
  why: string,
  how: string,
  skill: string,
  hook: string,
): void {
  const block =
    `${verdict}: ${oneLine(why)}\n` +
    `Remedy: ${oneLine(how)}\n` +
    `Context: mode=hook, ticket=unbound, skill=${skill}, hook=${hook}\n`;
  process.stderr.write(block);
}

// ---------------------------------------------------------------------------
// readTranscriptLines — the ONE transcript reader (STE-598 AC.3)
// ---------------------------------------------------------------------------

/**
 * Read the session transcript at `payload.transcript_path` and return its JSONL
 * lines. Returns `null` when the transcript is missing or unreadable — callers
 * translate that into their own fail-open verdict.
 *
 * This is the only place in the guard family that touches the filesystem for a
 * transcript. Every evidence check (Skill tool_use, red-before proof) reads
 * through it, so a change to how sessions are discovered lands once.
 */
export function readTranscriptLines(payload: HookPayload): string[] | null {
  const transcript = payload.transcript_path;
  if (!transcript || !existsSync(transcript)) {
    return null;
  }
  try {
    return readFileSync(transcript, "utf-8").split("\n");
  } catch {
    return null;
  }
}

/**
 * The ONE fail-open leg (STE-614 AC.2), named so it is a DECISION rather than an
 * accident of where each hook happens to consult the transcript.
 *
 * True when no harness spoke to this hook at all: stdin was empty or
 * unparseable (`payload === null`), or `transcript_path` names a file that does
 * not exist or cannot be read. In that state the guard has no session to grade —
 * not a session that skipped its gate — so every blocking hook exits 0, on a
 * toolkit-managed target with no receipt just as on any other.
 *
 * Callers ask this ONCE, before any other verdict. The /tdd hook in particular
 * used to reach its advisory `Reminder:` legs first, so a bare `git commit` run
 * outside Claude Code could exit 1 on a target the guard could not place —
 * stderr shown for a session with nobody in it.
 */
export function harnessAbsent(payload: HookPayload | null): boolean {
  return payload === null || readTranscriptLines(payload) === null;
}

// ---------------------------------------------------------------------------
// STE-614 AC.5 — the repository-scoped leg, INJECTED.
// ---------------------------------------------------------------------------

/** The two sentences a failed repository-scoped leg refuses with. */
export interface EvidenceMiss {
  why: string;
  how: string;
  /** The checkout this miss is about, so a multi-root refusal can name them all. */
  root?: string;
}

/**
 * One vouching window, `[start, end)` in epoch milliseconds (STE-614).
 *
 * A receipt is a file, and a file proves only that something wrote it. What
 * places a gate run is the TRANSCRIPT: each non-error Skill call for the skill
 * opens a window that runs to the next Skill call for it, or to the end of the
 * transcript, and the receipts written inside that window are the ones that
 * call vouches for. Computed here because this is where the transcript is
 * already parsed — the receipt leg is handed the windows rather than re-reading
 * the file, which keeps this module's one `readFileSync` the only one.
 *
 * Declared here rather than imported: this file carries no relative import (its
 * suites load it from a temp copy), so the leg's own module declares a
 * structurally identical shape and the two meet as values.
 */
export interface VouchWindow {
  start: number;
  /** `Infinity` for the window the end of the transcript closes. */
  end: number;
  /** Transcript line the opening Skill call sits on; `-1` when unknown. */
  startLine: number;
  /** Transcript line the next Skill call sits on, or `Infinity`. */
  endLine: number;
}

/**
 * A receipt's OWN announcement, as the front door printed it into the result of
 * the Bash call that ran it: `dpt-receipt: <absolute path> sha256:<digest>`.
 *
 * A receipt is a file any Bash call can write, so the file alone proves only
 * that something wrote it — and `createdAt` inside it is written by whoever
 * wrote the file. Measured: a hand-written receipt naming an ungated checkout,
 * with a `createdAt` one millisecond earlier than the genuine one, took the
 * window and its commit was permitted. So a receipt counts only when the
 * transcript carries its announcement, and the ORDER that decides which root a
 * window vouched for is transcript order, which no file content can forge.
 * The sibling tracker-write gate (M_947c79) already binds its receipts this
 * way; this is the same rule for the gate receipt.
 */
export interface ReceiptAnnouncement {
  /** The absolute path the front door printed. */
  path: string;
  /** The sha256 the front door printed over the bytes it wrote. */
  digest: string;
  /** Transcript line it was announced on — the ordering key. */
  line: number;
}

/**
 * A result that WAS read as a front-door run and still contributed no
 * announcement, because it did not carry exactly one.
 *
 * Carried out rather than dropped. "Nothing in this session was read as a run
 * of the front door" is a claim about COMMANDS, and it is false of a session
 * where a command WAS read and its OUTPUT is what failed the rule. Without
 * this record the receipt leg can only see an empty announcement list and has
 * to guess which of the two happened — a cause read off a count, which is the
 * defect this whole leg exists to stop making.
 */
export interface AnnouncementMisread {
  /** How many `dpt-receipt:` lines the result carried — anything but 1. */
  count: number;
  /** Transcript line the result sits on. */
  line: number;
}

/**
 * Where the action writes, and how to grade the repository-scoped leg there.
 *
 * The grading itself is a VALUE, not an import. This file is loaded from a temp
 * copy by its own suite, so it carries no relative import of its own, and the
 * transcript's `readFileSync` stays the only file read in it: receipts are read
 * behind `receiptLeg`, inside `adapters/_shared/src/gate_receipt.ts`, which is
 * where the receipt envelope is written and therefore where "valid" is defined.
 *
 * A caller that passes NO target keeps today's session-wide rule exactly — the
 * shape the advisory hooks and every pre-STE-614 suite are written against.
 */
export interface EvidenceTarget {
  /** Every checkout the action writes to. Empty ⇒ nothing repository-scoped to grade. */
  roots: readonly string[];
  /**
   * One root's verdict: `null` when satisfied or not applicable, the refusal
   * otherwise. `windows` is what the transcript leg vouched for (see
   * `VouchWindow`): a receipt outside every window is a file nobody's gate run
   * accounts for.
   */
  receiptLeg(
    root: string,
    windows: readonly VouchWindow[],
    announcements: readonly ReceiptAnnouncement[],
    misreads?: readonly AnnouncementMisread[],
  ): EvidenceMiss | null;
  /**
   * Whether a Bash command RAN the receipt front door — ONE plain
   * `bun [run] <the front door's own file> <gate skill>`.
   *
   * A VALUE, exactly like `receiptLeg` above and for the same reason: this file
   * is loaded from a temp copy by its own suite, so it holds no relative import
   * and cannot reach the front door's module by name. It therefore holds no
   * reading of the command text either — the module that IS the front door
   * answers whether a command ran it, with the same tokeniser the sibling
   * tracker-write gate reads its own deciding modules with, so a command that
   * merely mentions the module (an echo, a `#` comment, a `cd … &&` chain)
   * announces nothing.
   */
  announcesReceipts(command: string): boolean;
  /**
   * STE-614 NF-2 — where a red-before proof has to say it ran (see `ProofScope`).
   * Absent ⇒ the second door keeps its pre-STE-614 session-wide reading, which
   * is what every caller with no repository in hand wants.
   */
  proof?: ProofScope;
}

/**
 * The repository a red-before proof is graded against (STE-614 NF-2).
 *
 * Door two is not placed by the receipt leg — a proof is a line an operator
 * typed, not a receipt a gate minted — so it has to carry its own scope, or an
 * FE session's honest proof about FE would open a commit aimed at BE.
 *
 * Both roots are REALPATHS, resolved by the caller: the same checkout reached
 * through a symlink is one checkout, exactly as it is for the receipt store.
 */
export interface ProofScope {
  /** The checkout the required paths are staged in. */
  targetRoot: string;
  /** The session's own checkout root, or `null` when it sits in none. */
  sessionRoot: string | null;
}

/**
 * The repository-scoped miss to refuse with, or `null` when every root passes
 * (and when there is no target at all).
 *
 * EVERY failing root is named, not just the first. The FR's rule for several
 * checkouts is that "the refusal names each checkout that lacks it": a command
 * writing to two checkouts, refused one root at a time, costs the operator one
 * gate run per attempt to discover a list the guard already had. The remedy
 * stays the first root's, because it is the first thing to do.
 */
function firstReceiptMiss(
  windows: readonly VouchWindow[] | null,
  target?: EvidenceTarget,
  announcements: readonly ReceiptAnnouncement[] = [],
  misreads: readonly AnnouncementMisread[] = [],
): EvidenceMiss | null {
  // `windows === null` is the fail-open state: no transcript was readable at
  // all, so there is nothing to grade a receipt against and nothing to refuse.
  if (target === undefined || windows === null) {
    return null;
  }
  const misses: EvidenceMiss[] = [];
  for (const root of target.roots) {
    const miss = target.receiptLeg(root, windows, announcements, misreads);
    if (miss !== null) misses.push(miss);
  }
  const first = misses[0];
  if (first === undefined) return null;
  if (misses.length === 1) return first;
  // Same remedy (the first root's), one `why` that names them all in order.
  return {
    why: `${first.why} ${misses.length - 1} further checkout(s) in this command lack it too: ${misses
      .slice(1)
      .map((m) => m.root ?? "an unnamed checkout")
      .join(", ")}.`,
    how: first.how,
    root: first.root,
  };
}

// ---------------------------------------------------------------------------
// findSkillToolUse / requireSkillToolUse — atomic-line check (STE-285),
// structural since STE-614 (NF-3).
// ---------------------------------------------------------------------------

/**
 * One content block of a transcript record — the few fields this file reads.
 * Deliberately the same field set the tracker-write gate's `ContentBlock`
 * carries (`templates/hooks/_lib/hooks/pre-tracker-write-gate.ts`), because
 * STE-614's pairing rule IS that hook's pairing rule: a `tool_result` belongs
 * to the `tool_use` whose `id` equals its `tool_use_id`, and `is_error: true`
 * marks the call as denied or failed.
 */
interface TranscriptBlock {
  type?: string;
  id?: string;
  name?: string;
  input?: { skill?: unknown; command?: unknown };
  tool_use_id?: string;
  is_error?: boolean;
  /** A `tool_result`'s payload: a string, or content blocks carrying text. */
  content?: unknown;
  /** Record-level only: the wall-clock stamp Claude Code writes on each line. */
  timestamp?: unknown;
}

/**
 * The content blocks one JSONL line carries, as OBJECTS — never as substrings.
 *
 * Two shapes reach this: the real Claude Code record, whose blocks sit under
 * `message.content[]`, and the bare block a fixture writes at top level. Both
 * are returned, so one reader serves both and neither needs a second rule.
 *
 * A line that does not parse is SKIPPED, never thrown on (STE-614 NF-3): a
 * transcript is an append-only log that can be truncated mid-write, and a
 * guard that throws on one bad line decides nothing at all — which, in a
 * PreToolUse hook, is an unexplained interruption rather than a verdict.
 */
function transcriptBlocks(line: string): TranscriptBlock[] {
  if (!line || line.trim() === "") {
    return [];
  }
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return [];
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return [];
  }
  const blocks: TranscriptBlock[] = [raw as TranscriptBlock];
  const content = (raw as { message?: { content?: unknown } }).message?.content;
  if (Array.isArray(content)) {
    for (const b of content) {
      if (b !== null && typeof b === "object" && !Array.isArray(b)) {
        blocks.push(b as TranscriptBlock);
      }
    }
  }
  return blocks;
}

/**
 * The whole verdict on `skill`'s calls in this session — the shape the finders
 * and the refusals below are all built from.
 *
 * `found` answers the guards' question: is there a Skill call for `skill` that
 * did NOT end in an error or a denial? `denied` distinguishes the two ways
 * `found: false` happens, because they are different facts and a refusal that
 * confuses them sends the remedy the wrong way.
 *
 * Kept OFF the exported `findSkillToolUse` return on purpose: that object is
 * compared whole (`toEqual({ found })`) by the STE-290 contract suite, and a
 * published API grows a field only when a caller outside this file needs one.
 */
interface SkillCallScan {
  found: boolean;
  /** The skill WAS called, and every call for it ended in an error or denial. */
  denied: boolean;
  /**
   * Every gate-receipt announcement the transcript carries, in order.
   */
  announcements: ReceiptAnnouncement[];
  /**
   * Every result that WAS read as a front-door run and announced nothing,
   * because it did not carry exactly one `dpt-receipt:` line.
   *
   * The reason half of the line above: an empty `announcements` means one
   * thing when this is empty too (no command was read as a run at all) and a
   * different thing when it is not (a run WAS read; its output is what failed
   * the rule). A refusal that cannot tell those apart is reading its cause off
   * a count.
   */
  misreads: AnnouncementMisread[];
  /**
   * The windows the standing calls opened, for the receipt leg to place
   * receipts in. `null` ONLY in the fail-open state (no readable transcript),
   * where there is nothing to place anything against.
   */
  windows: VouchWindow[] | null;
}

/**
 * A transcript record's `timestamp` as epoch milliseconds, or `null`.
 *
 * Null for anything that is not a parseable stamp — absent, a non-string, or a
 * string `Date.parse` cannot read. A call the transcript cannot place in time
 * opens NO window (STE-614): a window with no start bounds nothing, and
 * treating it as unbounded would vouch for every receipt in the store, which is
 * exactly the session-wide reading this rule replaces.
 */
function recordTimestamp(value: unknown): number | null {
  if (typeof value !== "string") {
    return null;
  }
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/** One Skill call for the subject: its pairing id and when the transcript put it. */
interface SkillCall {
  /** `null` when the call carries no id, so nothing can retire it. */
  id: string | null;
  /** Epoch ms, or `null` when the record carried no parseable timestamp. */
  at: number | null;
  /** The transcript line it sits on — the forge-proof ordering key. */
  line: number;
}

/** The text a `tool_result` carries, whether it is a string or content blocks. */
function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) =>
      block !== null && typeof block === "object" && typeof (block as { text?: unknown }).text === "string"
        ? (block as { text: string }).text
        : "",
    )
    .join("\n");
}

/**
 * Every `dpt-receipt: <absolute path> sha256:<digest>` line in `text`.
 *
 * Both halves are required: a path with no digest cannot be checked against the
 * bytes on disk, and an unchecked announcement would re-admit the file-writing
 * forgery this rule exists to close.
 */
function announcementsIn(text: string): Array<{ path: string; digest: string }> {
  const out: Array<{ path: string; digest: string }> = [];
  for (const line of text.split("\n")) {
    const match = /^dpt-receipt:\s+(\/\S+)\s+sha256:([0-9a-f]{64})\s*$/.exec(line.trim());
    if (match !== null) out.push({ path: match[1]!, digest: match[2]! });
  }
  return out;
}

/**
 * Scan the transcript for `skill`'s calls and report both halves of the verdict.
 *
 * The atomic-line invariant (STE-285) is unchanged and now structural: the
 * block must be a `tool_use` named `Skill` whose `input.skill` IS `skill`,
 * all on one parsed JSONL record. Two halves on two lines still match
 * nothing — and neither does a JSON-escaped TEXT mention of the needles,
 * which the retired substring check happily accepted (STE-614 NF-3): the
 * bytes `\"name\":\"Skill\"` inside a quoted message contain the old needle
 * verbatim, so an assistant merely SAYING it would run the skill counted as
 * having run it.
 *
 * STE-614 NF-3 — a call the operator DENIED, or that errored, is not evidence.
 * A `tool_result` whose `tool_use_id` matches the call and whose `is_error` is
 * `true` retires that call; `is_error` absent or `false` leaves it standing,
 * and a call with NO paired result at all is still evidence (the gate fires
 * WHILE the skill runs, before its result is written). A Skill call carrying no
 * `id` cannot be paired with anything, so nothing can retire it either.
 *
 * Fail-open (`found: true`) when the transcript is missing or unreadable, via
 * the ONE shared reader (`readTranscriptLines`).
 */
function scanSkillCalls(
  skill: string,
  payload: HookPayload,
  target?: EvidenceTarget,
): SkillCallScan {
  const lines = readTranscriptLines(payload);
  if (lines === null) {
    // Fail-open: no transcript file ⇒ behave as if the hook fired outside
    // a Claude Code session.
    return { found: true, denied: false, windows: null, announcements: [], misreads: [] };
  }

  const calls: SkillCall[] = [];
  const erroredIds = new Set<string>();
  /** Bash `tool_use` ids whose command ran the receipt front door. */
  const minting = new Set<string>();
  const announcements: ReceiptAnnouncement[] = [];
  const misreads: AnnouncementMisread[] = [];

  lines.forEach((line, index) => {
    const blocks = transcriptBlocks(line);
    // The stamp belongs to the RECORD, which `transcriptBlocks` returns first;
    // the `tool_use` nested under it has none of its own.
    const at = blocks.length === 0 ? null : recordTimestamp(blocks[0]!.timestamp);
    for (const block of blocks) {
      if (
        block.type === "tool_use" &&
        block.name === "Skill" &&
        block.input !== null &&
        typeof block.input === "object" &&
        block.input.skill === skill
      ) {
        const id = typeof block.id === "string" && block.id !== "" ? block.id : null;
        calls.push({ id, at, line: index });
      } else if (
        block.type === "tool_result" &&
        block.is_error === true &&
        typeof block.tool_use_id === "string"
      ) {
        erroredIds.add(block.tool_use_id);
      }
      // The announcement half: a Bash call that RAN the front door (the target's
      // own injected reading — see `EvidenceTarget.announcesReceipts`), and the
      // non-error result it printed its `dpt-receipt:` line into.
      if (block.type === "tool_use" && block.name === "Bash" && typeof block.id === "string") {
        const command = block.input === null || typeof block.input !== "object" ? undefined : block.input.command;
        if (target !== undefined && typeof command === "string" && target.announcesReceipts(command)) {
          minting.add(block.id);
        }
      } else if (
        block.type === "tool_result" &&
        block.is_error !== true &&
        typeof block.tool_use_id === "string" &&
        minting.has(block.tool_use_id)
      ) {
        // The rule is graded per RESULT, not per run: THIS result is kept only
        // when IT carries exactly one announcement, and a result carrying any
        // other number announces none of them. (One run writes one receipt is
        // why the number is one; what is counted is one result's lines.) The
        // sibling tracker-write gate's rule, and the reason a replayed line
        // appended to a genuine run's output cannot ride along on it —
        // including the genuine line: a result someone added to cannot be told
        // from one they did not.
        //
        // A result that fails the rule is RECORDED rather than dropped: it was
        // read as a front-door run, so "nothing was read as a run" is false of
        // this session, and only a record says so.
        const found = announcementsIn(resultText(block.content));
        if (found.length === 1) announcements.push({ ...found[0]!, line: index });
        else misreads.push({ count: found.length, line: index });
      }
    }
  });

  // A call with no `id` is unpairable, so nothing can retire it.
  const standing = (call: SkillCall): boolean => call.id === null || !erroredIds.has(call.id);
  const found = calls.some(standing);

  // A window ends at the NEXT Skill call for this skill, whatever became of
  // that call: the next run is what makes the previous one's window stale, and
  // a run that errored still happened. Only a STANDING call opens one.
  const bounds = calls
    .map((call) => call.at)
    .filter((at): at is number => at !== null)
    .sort((a, b) => a - b);
  const lineBounds = calls
    .map((call) => call.line)
    .sort((a, b) => a - b);
  const windows = calls
    .filter((call) => standing(call) && call.at !== null)
    .map((call) => ({
      start: call.at!,
      end: bounds.find((bound) => bound > call.at!) ?? Number.POSITIVE_INFINITY,
      startLine: call.line,
      endLine: lineBounds.find((bound) => bound > call.line) ?? Number.POSITIVE_INFINITY,
    }))
    .sort((a, b) => a.start - b.start);

  return { found, denied: !found && calls.length > 0, windows, announcements, misreads };
}

/**
 * Look for a Skill tool_use for `skill` that did NOT end in an error or a
 * denial — the boolean half of `scanSkillCalls`, which carries the full rule
 * and the reasoning behind it.
 *
 * Pure boolean check: returns `{ found: true }` on hit, `{ found: false }`
 * on miss. Fail-open (returns `{ found: true }`) when the transcript file
 * is missing or unreadable. Never writes to stderr — callers that need an
 * NFR-10 Refusing emit on miss should use `requireSkillToolUse` instead.
 */
export function findSkillToolUse(
  skill: string,
  payload: HookPayload,
): { found: boolean } {
  return { found: scanSkillCalls(skill, payload).found };
}

/**
 * Same check as `findSkillToolUse`, but emits the byte-stable NFR-10
 * `Refusing:` block to stderr on miss. Use this in Refusing hooks
 * (gate-check, spec-review, tdd-orchestrator) where a miss must produce
 * the canonical refusal template. Use `findSkillToolUse` in advisory hooks
 * (brainstorm-reminder) that emit their own `Reminder:` block instead.
 *
 * TWO misses, two sentences. The plain miss — the skill was never called — keeps
 * its text byte-for-byte (STE-614 AC.1): operators, docs and suites quote it.
 * The STE-614 miss is a DIFFERENT fact and says so, because "not found in
 * current session" is false when the operator watched themself deny the call,
 * and a refusal that misdescribes what happened sends the remedy the wrong way.
 */
export function requireSkillToolUse(
  skill: string,
  hook: string,
  payload: HookPayload,
  target?: EvidenceTarget,
): { found: boolean } {
  const scan = scanSkillCalls(skill, payload, target);
  if (scan.found) {
    // STE-614 AC.5 — the repository-scoped leg, demanded IN ADDITION to the
    // transcript leg and never instead of it. The transcript says the gate ran
    // in this session; only the receipt says it ran against THIS checkout.
    const miss = firstReceiptMiss(scan.windows, target, scan.announcements, scan.misreads);
    if (miss === null) {
      return { found: true };
    }
    emitNFR10("Refusing", miss.why, miss.how, skill, hook);
    return { found: false };
  }
  emitNFR10(
    "Refusing",
    scan.denied
      ? `every ${skill} Skill tool_use in this session ended in an error or a ` +
          `denial, so none of them is evidence that the skill ran.`
      : `required ${skill} Skill tool_use not found in current session.`,
    scan.denied
      ? `run /${skill} again and let it finish before retrying this action.`
      : `run /${skill} before retrying this action.`,
    skill,
    hook,
  );
  return { found: false };
}

// ---------------------------------------------------------------------------
// STE-598 — the second door: a recorded red-before proof.
// ---------------------------------------------------------------------------

/**
 * The canonical marker an operator types to record that the covered tests were
 * run against the PRE-CHANGE bytes and were red. Byte-stable on purpose: it is
 * a contract a human has to reproduce from the refusal text, so it must not
 * drift.
 */
export const RED_BEFORE_PROOF_MARKER = "dpt-red-before-proof:";

/**
 * Where a claim stops. A marker occurrence claims the path list it actually
 * names, not the rest of the JSONL line — a line carries far more than one
 * message, and the guard's own denial record carries its stderr TWICE, so an
 * unbounded slice from the first marker swallows the second copy's `Refusing:`
 * line and lets a refusal satisfy the door it just refused.
 *
 * A path list ends at the first of: an escaped newline (the message moved on to
 * another line of prose), or a double quote — escaped (`\"`, a quote inside the
 * message text) or bare (`"`, the close of the JSON string value carrying this
 * message). Failing both, at the end of the JSONL line.
 *
 * The BACKTICK is deliberately NOT a terminator (STE-598, second audit). It is
 * also what an operator writes AROUND a path, so
 * `<marker> ` + "`a.test.ts` `b.test.ts`" bounded at the first backtick claimed
 * an empty string and covered nothing: the honest operator was refused and the
 * remedy handed back the very form it had just rejected. Dropping it is safe
 * because within one copy of the refusal `emitNFR10` prints the paths BEFORE
 * the marker, so the escaped newline ending the `Remedy:` line still lands
 * between copy #1's marker and copy #2's paths — measured on the shipped bytes,
 * not assumed. The bare quote is the second, independent bound: it stops a claim
 * at the end of its own JSON string value even when no escaped newline follows
 * the marker, and it cannot truncate an honest proof because a path contains no
 * quote character.
 */
const CLAIM_TERMINATORS = ['\\"', '"', "\\n"];

/** The optional leading token by which a claim names the checkout it covers. */
const REPO_PREFIX = "repo=";

/** One bounded marker occurrence, split into the repository it names and its paths. */
interface ProofClaim {
  /** The `repo=` value, or `null` when the claim named no repository. */
  repo: string | null;
  /** The text that claims paths — the claim minus its `repo=` token. */
  paths: string;
}

/**
 * Split a bounded claim into `repo=<value>` and the path list after it.
 *
 * Leading whitespace and backticks are stepped over because an operator writes
 * the proof in prose and wraps things in code spans (the same reason a backtick
 * is not a claim terminator). A claim that does not open with `repo=` names no
 * repository, and keeps its WHOLE text as the path list — dropping nothing that
 * the pre-STE-614 reading would have counted.
 */
function splitRepo(claim: string): ProofClaim {
  const rest = claim.replace(/^[\s`]+/, "");
  if (!rest.startsWith(REPO_PREFIX)) {
    return { repo: null, paths: claim };
  }
  const after = rest.slice(REPO_PREFIX.length);
  const end = after.search(/[\s`]/);
  return end === -1
    ? { repo: after, paths: "" }
    : { repo: after.slice(0, end), paths: after.slice(end) };
}

/**
 * Every marker occurrence on `line`, each bounded to the text it claims and
 * split into the repository it names and the paths it covers.
 *
 * EVERY occurrence, not just the first and not just the last: two honest proofs
 * in one assistant message share a JSONL line, and each covers its own paths.
 */
function claimsOnLine(line: string): ProofClaim[] {
  const claims: ProofClaim[] = [];
  let from = 0;
  for (;;) {
    const at = line.indexOf(RED_BEFORE_PROOF_MARKER, from);
    if (at === -1) {
      return claims;
    }
    const start = at + RED_BEFORE_PROOF_MARKER.length;
    let end = line.length;
    for (const terminator of CLAIM_TERMINATORS) {
      const hit = line.indexOf(terminator, start);
      if (hit !== -1 && hit < end) {
        end = hit;
      }
    }
    claims.push(splitRepo(line.slice(start, end)));
    from = start;
  }
}

/** The realpath of `path`, or `null` when it cannot be resolved. */
function realOrNull(path: string): string | null {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

/**
 * Does this claim speak about the checkout the required paths are staged in?
 *
 * With NO scope the question does not arise and every claim speaks — the
 * pre-STE-614 session-wide reading, kept for callers that hold no repository.
 *
 * With a scope (STE-614 NF-2):
 *
 *   - `repo=<absolute path>` covers only the checkout whose REALPATH is the
 *     target's. A symlink to it is it; a sibling checkout is not.
 *   - A `repo=` that is not absolute names nothing resolvable — a relative
 *     `./b` depends on a directory the guard does not share, and an unexpanded
 *     `$X` is a variable the transcript never expanded — so it covers nothing
 *     rather than being guessed at.
 *   - An absolute `repo=` that resolves nowhere, or to a directory that is not
 *     this target, covers nothing for the same reason.
 *   - NO `repo=` at all is the pre-STE-614 form, and it means the session's own
 *     checkout: it covers only when the action writes there. A proof typed in
 *     an FE session says nothing about a commit aimed at BE.
 */
function claimInScope(claim: ProofClaim, scope?: ProofScope): boolean {
  if (scope === undefined) {
    return true;
  }
  if (claim.repo === null) {
    return scope.sessionRoot !== null && scope.sessionRoot === scope.targetRoot;
  }
  if (!claim.repo.startsWith("/")) {
    return false;
  }
  return realOrNull(claim.repo) === scope.targetRoot;
}

/**
 * Look for a red-before proof covering EVERY path in `requiredPaths`.
 *
 * A path is covered iff some transcript line carries the marker and names that
 * path AFTER it. Two invariants are deliberate:
 *
 *   - ATOMIC LINE (STE-285, re-applied). The marker and the path must share one
 *     JSONL line. A marker on one line and a path on another is two unrelated
 *     claims, not one proof.
 *   - POSITION. Only text after the marker counts, so a path merely mentioned
 *     earlier in the same message is not silently swept into the claim.
 *   - BOUNDED CLAIM. Only text up to the end of that occurrence's path list
 *     counts (see `claimsOnLine`), so a path mentioned LATER on the same line
 *     in other business is not swept in either — the guard's own denial record
 *     carries its stderr twice and would otherwise satisfy the door it refused.
 *
 *   - REPOSITORY (STE-614 NF-2, when `scope` is given). A claim covers paths
 *     only in the checkout it names with `repo=<absolute root>`, and a claim
 *     naming none covers only the session's own checkout. Without a scope this
 *     rule does not apply and the reading is session-wide, as it was before.
 *
 * Coverage is a UNION across marker lines, so a session that proved two files
 * red in two messages satisfies a commit staging both.
 *
 * An EMPTY `requiredPaths` returns `found: false`: a proof that covers nothing
 * proves nothing, and `[].every(...)` is `true` — the shape that has shipped as
 * a bug here before.
 *
 * Fail-open (`found: true`) when the transcript is missing or unreadable,
 * matching the existing door.
 */
export function findRedBeforeProof(
  payload: HookPayload,
  requiredPaths: string[],
  scope?: ProofScope,
): { found: boolean; uncovered: string[] } {
  const lines = readTranscriptLines(payload);
  if (lines === null) {
    return { found: true, uncovered: [] };
  }
  if (requiredPaths.length === 0) {
    return { found: false, uncovered: [] };
  }
  const covered = new Set<string>();
  for (const line of lines) {
    for (const claim of claimsOnLine(line)) {
      if (!claimInScope(claim, scope)) {
        continue;
      }
      for (const path of requiredPaths) {
        if (claim.paths.includes(path)) {
          covered.add(path);
        }
      }
    }
  }
  const uncovered = requiredPaths.filter((p) => !covered.has(p));
  return { found: uncovered.length === 0, uncovered };
}

/**
 * The /tdd requirement, satisfied by EITHER door (AC-STE-598.1):
 *
 *   1. a `dev-process-toolkit:tdd` Skill tool_use in this session, or
 *   2. a red-before proof covering every path that raised the requirement.
 *
 * With neither present the commit is refused exactly as before, and the
 * refusal NAMES BOTH doors (AC-STE-598.4) so the second one is learned rather
 * than rediscovered. Silent on success: a satisfied requirement must not print
 * a refusal it then ignores.
 */
export function requireTddEvidence(
  skill: string,
  hook: string,
  payload: HookPayload,
  requiredPaths: string[],
  target?: EvidenceTarget,
): { found: boolean } {
  // Door one first, and via the NON-emitting check: `requireSkillToolUse`
  // would write its own refusal before door two had been asked.
  const doorOne = scanSkillCalls(skill, payload, target);
  // STE-614 AC.5 — door one is session-wide, so a /tdd run in the session's own
  // checkout says nothing about a commit aimed at a second one; the receipt leg
  // is what places it. Door two is NOT graded against it: a red-before proof
  // names the repository it covers (NF-2), so it carries its own scope.
  const repoMiss = doorOne.found ? firstReceiptMiss(doorOne.windows, target, doorOne.announcements, doorOne.misreads) : null;
  if (doorOne.found && repoMiss === null) {
    return { found: true };
  }
  if (findRedBeforeProof(payload, requiredPaths, target?.proof).found) {
    return { found: true };
  }
  if (repoMiss !== null) {
    emitNFR10("Refusing", repoMiss.why, repoMiss.how, skill, hook);
    return { found: false };
  }
  // The operator is told to name "every staged test path it covers" — so name
  // them here. `requiredPaths` is the set that raised the requirement, already
  // computed by the caller; withholding it makes the operator re-derive it.
  const one = requiredPaths.length === 1;
  const subject = requiredPaths.length === 0
    ? "the staged test paths"
    : `the staged test ${one ? "path" : "paths"} ${requiredPaths.join(", ")}`;
  const them = one ? "it" : "them";
  // STE-614 NF-3 — when door one was CALLED and every call ended in an error or
  // a denial, say that instead of "was found": the operator saw the call happen
  // and a refusal claiming it never did points the remedy at the wrong thing.
  const doorOneState = doorOne.denied
    ? `every ${skill} Skill tool_use in this session ended in an error or a ` +
      `denial, and no red-before proof covering ${them} was found`
    : `neither a ${skill} Skill tool_use nor a red-before proof covering ` +
      `${them} was found in this session`;
  // STE-614 NF-2 — the remedy hands back the EXACT form the door now accepts,
  // repository and all. The `<paths>` placeholder stays literal: it is the one
  // part the operator has to replace, and it is also what keeps the guard's own
  // refusal record from satisfying the door it just refused — this claim names
  // the right repository and covers no path at all (the STE-598 bound,
  // re-pinned against the new text).
  const proofForm =
    target?.proof === undefined
      ? `${RED_BEFORE_PROOF_MARKER} <paths>`
      : `${RED_BEFORE_PROOF_MARKER} repo=${target.proof.targetRoot} <paths>`;
  emitNFR10(
    "Refusing",
    `no TDD evidence for ${subject}: ${doorOneState}.`,
    `run /${skill}; or, for an audit-driven fix with no FR, run those ` +
      `tests against the pre-change bytes and record the red result in this ` +
      `session as a line reading \`${proofForm}\` ` +
      `naming every staged test path it covers.`,
    skill,
    hook,
  );
  return { found: false };
}
