// STE-614 AC-STE-614.3 + AC-STE-614.4 — the gate-receipt front door.
//
// ONE place mints a gate receipt. A gate skill does not compose an envelope,
// does not know where receipts live and does not print its own announcement:
// it runs
//
//   bun run "${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/gate_receipt.ts" <skill> <path>
//
// and the announcement this module prints is the whole of what it says.
//
// NO STORE OF ITS OWN. The envelope, the directory and the announcement line
// all come from the M_947c79 receipt store (`tracker_receipts.ts`, which
// composes its directory through `dpt_paths.ts` alone). This module adds no
// second composer, writer, reader or ignore rule — it supplies the two facts
// the store cannot know, the SUBJECT (which gate ran) and the EVIDENCE (the
// commit the gate ran against), and hands them over.
//
// FAIL-CLOSED ON BOTH CHANNELS. Every refusal below exits 1, prints the house
// NFR-10 envelope on STDERR, prints NOTHING on stdout, and leaves nothing on
// disk. The two halves are one guard, not two: a front door that announced a
// receipt and then failed to write it would leave its caller quoting a path
// that does not exist, which is worse than the missing receipt it was told
// about. So stdout carries a whole announcement or nothing at all.

import { readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { receiptsDir } from "./dpt_paths";
import { nfr10Message } from "./dpt_version";
import { bunInvocation, realpathOr } from "./shell_invocations";
import { isToolkitManaged } from "./toolkit_managed";
import { announceReceipt, oneLine, readSessionReceipts, receiptDigest, writeReceipt } from "./tracker_receipts";

/**
 * The gates that mint a receipt, by bare skill name.
 *
 * A CLOSED list, and that is the point: an unknown name is refused rather than
 * recorded, so a typo in a skill's own order cannot mint evidence under a
 * subject no reader grades.
 */
export const GATE_SKILL_NAMES = ["gate-check", "tdd", "spec-review"] as const;

export type GateSkillName = (typeof GATE_SKILL_NAMES)[number];

/** The plugin namespace every gate subject is spelled under. */
export const GATE_SKILL_NAMESPACE = "dev-process-toolkit";

/** The receipt `kind` a gate run is filed under. */
export const GATE_RECEIPT_KIND = "gate";

/** The receipt `decision` a gate run records: it RAN. Not that it passed. */
export const GATE_RECEIPT_DECISION = "ran";

export function isGateSkillName(name: string): name is GateSkillName {
  return (GATE_SKILL_NAMES as readonly string[]).includes(name);
}

/** `dev-process-toolkit:<name>` — the full skill name, never the bare one. */
export function gateSubject(name: GateSkillName): string {
  return `${GATE_SKILL_NAMESPACE}:${name}`;
}

/** This module's own file, as the filesystem sees it: the front door itself. */
const OWN_FRONT_DOOR = realpathOr(resolve(import.meta.dir, "gate_receipt.ts"));

/**
 * Whether a Bash command RAN this front door — the question every `dpt-receipt:`
 * line's provenance turns on, since the line is evidence only when the call that
 * printed it is the call that wrote the receipt.
 *
 * Read, not pattern-matched, and read by the SAME grammar the sibling
 * tracker-write gate reads its own deciding modules with (`bunInvocation`, on
 * the shared `simpleCommandWords`): ONE plain `bun [run] <absolute path>
 * <gate skill>` whose path realpaths to THIS file. So `echo bun run <front
 * door> …`, a trailing `# …` comment naming it, a `cd … &&` chain that could
 * print anything, and a same-named `gate_receipt.ts` somewhere this plugin does
 * not own all run nothing here, and announce nothing.
 *
 * Scope, not reading, is what separates this from `invokedDecidingModule`: the
 * gate receipt is deliberately NOT one of the tracker gate's
 * `RECEIPT_ANNOUNCING_MODULES` (AC-STE-614.4), so it asks the same question
 * about a different module.
 */
export function announcesGateReceipt(command: string): boolean {
  const run = bunInvocation(command);
  if (run === null || run.module !== OWN_FRONT_DOOR) return false;
  const subcommand = run.args[0];
  return subcommand !== undefined && isGateSkillName(subcommand);
}

/**
 * Every refusal this front door can raise, named. A caller branches on the
 * reason rather than grepping the prose.
 */
export const GATE_RECEIPT_REASONS = [
  "incomplete-argv",
  "unknown-skill",
  "no-checkout",
  "session-id-unavailable",
  "receipt-not-written",
] as const;

export type GateReceiptReason = (typeof GATE_RECEIPT_REASONS)[number];

/** A refusal carrying the NFR-10 three-line shape plus its machine reason. */
export class GateReceiptError extends Error {
  readonly reason: GateReceiptReason;

  constructor(reason: GateReceiptReason, verdict: string, remedy: string, context: string) {
    super(nfr10Message(`Refusing: ${oneLine(verdict)}`, oneLine(remedy), oneLine(context)));
    this.name = "GateReceiptError";
    this.reason = reason;
  }
}

// ---------------------------------------------------------------------------
// The two facts the store cannot know.
// ---------------------------------------------------------------------------

/** The realpath of `path`, or `path` itself when it cannot be resolved. */
function realOrSelf(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/** The directory a target path sits in — the target itself when it is one. */
function containingDirectory(target: string): string {
  const abs = resolve(target);
  try {
    if (statSync(abs).isDirectory()) return abs;
  } catch {
    // A path that does not exist still names a directory to ask git about.
  }
  return dirname(abs);
}

function git(directory: string, args: readonly string[]): string | null {
  const proc = Bun.spawnSync(["git", "-C", directory, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (proc.exitCode !== 0) return null;
  const out = proc.stdout.toString().trim();
  return out.length === 0 ? null : out;
}

/**
 * The REALPATH of the checkout containing `target`, or `null` when no checkout
 * does.
 *
 * Asked of git (`rev-parse --show-toplevel`) rather than inferred from a `.git`
 * entry: a worktree and a submodule both carry a `.git` FILE, so a hand-rolled
 * walk anchors at the wrong place. Realpath'd because the same checkout reached
 * through a symlink must key ONE store, not two — a receipt filed under the
 * link is a receipt the reader looking under the real root never sees.
 */
export function checkoutRootOf(target: string): string | null {
  const top = git(containingDirectory(target), ["rev-parse", "--show-toplevel"]);
  return top === null ? null : realOrSelf(top);
}

/**
 * The commit the gate ran against, or `null` on an unborn branch.
 *
 * Null is a fact, not a failure: a checkout with no commit yet is a legitimate
 * place to run a gate, and refusing there would make the very first commit of a
 * project the one commit no gate could cover.
 */
export function headOf(root: string): string | null {
  return git(root, ["rev-parse", "HEAD"]);
}

// ---------------------------------------------------------------------------
// The one act.
// ---------------------------------------------------------------------------

/**
 * Record that `skill` ran against the checkout containing `target`, and return
 * the receipt file's path.
 *
 * The session id is read by the STORE, from `CLAUDE_CODE_SESSION_ID`; the check
 * below is not a second rule but a better message for the one case an operator
 * actually hits — a gate run by hand, outside a Claude Code session, where the
 * store's own throw would name a variable without saying why a gate needs it.
 */
export function recordGateRun(skill: string, target: string): string {
  if (!isGateSkillName(skill)) {
    throw new GateReceiptError(
      "unknown-skill",
      `"${skill}" is not a gate that mints a receipt, so nothing was recorded`,
      `name one of ${GATE_SKILL_NAMES.join(", ")} when running the gate-receipt front door`,
      `reason=unknown-skill, skill=${skill}`,
    );
  }

  const sessionId = process.env.CLAUDE_CODE_SESSION_ID;
  if (sessionId === undefined || sessionId === "") {
    throw new GateReceiptError(
      "session-id-unavailable",
      "CLAUDE_CODE_SESSION_ID is unset or empty, and gate evidence is keyed by the session that produced it, so this run cannot be recorded",
      "run the skill from a Claude Code session, which exports CLAUDE_CODE_SESSION_ID, rather than invoking the front door by hand",
      `reason=session-id-unavailable, skill=${skill}`,
    );
  }

  const root = checkoutRootOf(target);
  if (root === null) {
    throw new GateReceiptError(
      "no-checkout",
      `"${target}" is not inside a git checkout, so there is no project to record a gate run against`,
      "run the gate against a path inside a git checkout, or initialise one there first",
      `reason=no-checkout, path=${target}`,
    );
  }

  try {
    return writeReceipt(root, {
      kind: GATE_RECEIPT_KIND,
      adapter: null,
      container: null,
      subject: gateSubject(skill),
      decision: GATE_RECEIPT_DECISION,
      evidence: { head: headOf(root) },
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new GateReceiptError(
      "receipt-not-written",
      `the gate receipt for ${gateSubject(skill)} could not be stored under ${root}: ${detail}`,
      `make the toolkit's ${root}/.dpt tree writable, and run the skill from a session whose id is a single path-safe segment, then re-run the gate`,
      `reason=receipt-not-written, skill=${skill}, root=${root}`,
    );
  }
}

// ---------------------------------------------------------------------------
// The other direction: reading the receipt back (STE-614 AC.5).
//
// The transcript says a gate RAN IN THIS SESSION. It does not say WHICH
// checkout it ran against, and that gap is HS-1: a session rooted in one
// managed repository ran its gate there, then committed to a second managed
// repository the gate had never seen, and the transcript leg waved it through.
//
// So a toolkit-managed target demands a receipt of its own, IN ADDITION to the
// transcript leg. The verdict lives HERE, beside the writer, because a reader
// that re-derived the envelope's rules would be a second definition of "valid"
// — and the one thing worse than no receipt is two disagreeing opinions about
// what one means.
// ---------------------------------------------------------------------------

/**
 * Why the repository-scoped leg answered the way it did — ONE name per state.
 *
 * Named rather than collapsed, because the FR's rule is that each state
 * "refuses by name": a `v: 2` envelope, a receipt for another skill and a
 * receipt naming another checkout are three different things to fix, and a
 * single "no receipt" would send the operator looking for a file that is
 * sitting right there. The prose for each lives in ONE table (`MISS_PROSE`),
 * so a reason and the sentence it refuses with cannot drift apart.
 *
 * The same rule split the last leg (M_85e846 review), and then split it again
 * (review round 2) when the first split turned out to read its cause off a
 * post-filter COUNT — `announced.length === 0` — which cannot say why the
 * filter emptied any more than a sentence can. A receipt no run vouches for
 * now gets there by EIGHT named states, each read from the value that decided
 * it:
 *
 *   `not-vouched`                   another checkout's announcement took the
 *                                   window this receipt falls in
 *   `outside-window`                windows exist, and every announcement sits
 *                                   before the first of them
 *   `between-windows`               windows exist and an announcement sits
 *                                   AFTER one of them and before the next, in
 *                                   a hole no standing call covers — so the
 *                                   order claim `outside-window` makes is FALSE
 *                                   of it (M_85e846 review round 3)
 *   `run-errored`                   a command WAS read as a front-door run and
 *                                   the call came back errored, so it left no
 *                                   result to read an announcement out of
 *   `run-unresolved`                a command WAS read as a front-door run and
 *                                   the transcript carries no result for it
 *   `no-window`                     an announcement survived, and no standing
 *                                   Skill call carries a timestamp, so there
 *                                   is no window to place it in — NOT the same
 *                                   fact as "the receipt came first"
 *   `announcement-tampered`         a run announced a receipt and the file no
 *                                   longer hashes to the announced digest.
 *                                   Ranked FIRST of the drops: this is the one
 *                                   state the digest binding exists to detect,
 *                                   and reporting a detected forgery as
 *                                   "nothing ran" sends the operator to re-run
 *                                   the gate instead of to the rewritten file
 *   `announcement-unreadable`       the announced file could not be read back
 *   `announcement-foreign-store`    the announced path is a receipt of another
 *                                   session's store
 *   `run-announced-many`            a command WAS read as a front-door run and
 *                                   its result carried more than one
 *                                   announcement, so it announced none
 *   `run-announced-none`            a command WAS read as a front-door run and
 *                                   its result carried no announcement at all
 *   `nothing-announced`             no command in this session was read as a
 *                                   run of the front door — the ONE state that
 *                                   sentence is true of
 *
 * The last five used to share `nothing-announced`'s sentence, a positive claim
 * about COMMANDS that was true of exactly one of them; `no-window` used to
 * share `outside-window`'s, telling the operator their announcement predated a
 * Skill call it had in fact followed.
 */
export type GateEvidenceReason =
  | "not-managed"
  | "receipt-found"
  | "session-id-missing"
  | "store-unreadable"
  | "no-receipt"
  | "wrong-subject"
  | "foreign-root"
  | "not-vouched"
  | "outside-window"
  | "between-windows"
  | "no-window"
  | "run-errored"
  | "run-unresolved"
  | "announcement-tampered"
  | "announcement-unreadable"
  | "announcement-foreign-store"
  | "run-announced-many"
  | "run-announced-none"
  | "nothing-announced";

export interface GateEvidence {
  /** False ONLY when the leg applies and is not satisfied. */
  ok: boolean;
  /** True when the target is toolkit-managed, so the leg applies at all. */
  applies: boolean;
  reason: GateEvidenceReason;
  /** This session's receipt directory under the target, or null when unnamable. */
  store: string | null;
  /** Files in that directory the store's reader skipped as unreadable or malformed. */
  skipped: number;
  /**
   * On `not-vouched`: the checkout that took the window this receipt fell in.
   * Named in the refusal so the operator is told WHICH run their gate is being
   * credited to. Null on every other reason — each runless state carries its
   * own name (see `GateEvidenceReason`) rather than a null here.
   */
  claimant: string | null;
  /**
   * On `wrong-subject`: the skill the receipt that IS there names.
   * On `foreign-root`: the checkout that receipt was written for.
   *
   * Kept apart from `claimant` on purpose: both name "the other thing", but a
   * window's claimant and a misfiled receipt's own subject are different facts,
   * and one field holding either would make every reader ask which it holds.
   */
  named: string | null;
  /**
   * Every announced receipt FILE this session's transcript named that no longer
   * hashes to the digest its own announcement carried.
   *
   * Carried on EVERY verdict, `ok: true` included, and that is the point
   * (M_85e846 review round 3). A tamper detected alongside a genuine in-window
   * announcement for the same checkout does not refuse — the gate really did
   * run — but the signal was being thrown away with the permit, so a receipt
   * rewritten under its own announcement was detected and never mentioned.
   * Empty on every verdict reached before the announcements are read.
   */
  tampered: string[];
  /**
   * On `wrong-subject`: EVERY distinct other-skill subject this store holds a
   * gate receipt for, and how many receipts that is. `named` is the first of
   * them, kept because it is what the one-receipt sentence says.
   *
   * Carried out of the verdict rather than re-derived by the renderer: the
   * sentence and the verdict must be counting the same read of the same
   * directory, or the refusal is quoting a number nothing decided anything on.
   */
  namedAll: string[];
  namedCount: number;
  /**
   * How many announcements were dropped for the CAUSE the reason names — the
   * quantity `announcement-foreign-store` and its siblings were asserting
   * without measuring. 0 for every reason that is not a drop.
   */
  droppedCount: number;
}

// ---------------------------------------------------------------------------
// Vouching (STE-614, Requirement item 2).
//
// A receipt is a FILE, and any Bash call can write one. So the store on its own
// proves nothing about which checkout a gate ran for — it proves only that
// something wrote a file there. What places the run is the transcript: a
// non-error Skill `tool_use` for the same skill VOUCHES for the receipts
// written after it.
//
// One run, one checkout. Each such call opens a window running from its own
// transcript timestamp to the next Skill call for that skill (or to the end of
// the transcript), and within a window only the FIRST checkout to be written
// is vouched for. A second root minted in the same window is a receipt with no
// gate behind it, and a receipt older than every call is a receipt nothing ran
// for. A call the transcript gives no parseable timestamp to opens no window,
// so it vouches for nothing: a window with no start is not a bound at all.
// ---------------------------------------------------------------------------

/**
 * One vouching window, in epoch milliseconds AND in transcript lines.
 *
 * Both halves ship because both are read: the wall-clock bounds place a receipt
 * FILE, and the line bounds place an ANNOUNCEMENT, which is what actually
 * decides the claim (a timestamp inside a file is written by whoever wrote the
 * file; a transcript line number is not).
 */
export interface VouchWindow {
  start: number;
  /** `Infinity` for the window the end of the transcript closes. */
  end: number;
  /** Transcript line the vouching Skill call sits on. */
  startLine: number;
  /** Transcript line the next Skill call sits on, or `Infinity`. */
  endLine: number;
}

/** What the transcript leg hands the receipt leg so it can place a receipt. */
export interface VouchContext {
  /** Every window this session's non-error Skill calls for the subject opened. */
  windows: readonly VouchWindow[];
  /**
   * Every `dpt-receipt:` announcement the transcript carries, in transcript
   * order. A receipt counts only when its own announcement is here and the file
   * still hashes to the announced digest, and the order that decides which root
   * a window vouched for is THIS order — not `createdAt`, which is a field
   * inside the file whoever wrote it chose. Measured before the fix: a
   * hand-written receipt for an ungated checkout, stamped one millisecond
   * earlier than the genuine one, took the window and its commit was permitted.
   */
  announcements?: readonly ReceiptAnnouncement[];
  /**
   * Every result the transcript leg READ as a front-door run and kept nothing
   * from, because it did not carry exactly one `dpt-receipt:` line.
   *
   * Without this the leg sees only an empty `announcements` and cannot tell
   * "no command in this session was read as a run of the front door" — a claim
   * about COMMANDS — from "a command was read, and its OUTPUT failed the
   * rule". Those are different things to fix, and a count cannot separate them.
   */
  misreadRuns?: readonly AnnouncementMisread[];
  /**
   * Every front-door run the transcript leg read that left NO readable result
   * at all — errored, or with no result written yet (see `IncompleteRun`).
   *
   * The third thing an empty `announcements` can mean, and the one that has no
   * output to count: a misread run failed the one-line rule, an incomplete run
   * never produced a line to fail it. Without this the leg fell through to
   * "no command in this session was read as a run of the front door", which is
   * false of a session where the operator watched the mint run and interrupted
   * it — the COMMON path here, since the front door has five named exit-1
   * refusals of its own.
   */
  incompleteRuns?: readonly IncompleteRun[];
  /**
   * Every OTHER checkout this session could have minted a receipt in — the
   * session's own root and the command's other targets. A window is claimed by
   * the earliest receipt written in it across all of them, so without the peers
   * a second checkout minted by hand would look like the first.
   */
  peerRoots: readonly string[];
}

/** A receipt's own announcement, as the front door printed it (STE-614 review). */
export interface ReceiptAnnouncement {
  path: string;
  digest: string;
  /** Transcript line — the ordering key no file content can forge. */
  line: number;
}

/**
 * A result read as a front-door run that announced nothing — structurally the
 * same shape `templates/hooks/_lib/session.ts` declares, for the same reason
 * every other shape here is declared twice: that file carries no relative
 * import and the two meet as values.
 */
export interface AnnouncementMisread {
  /** How many `dpt-receipt:` lines the result carried — anything but 1. */
  count: number;
  /** Transcript line the result sits on. */
  line: number;
}

/**
 * A front-door run that left no readable result at all — structurally the same
 * shape `templates/hooks/_lib/session.ts` declares, for the reason every other
 * shape here is declared twice: that file carries no relative import and the
 * two meet as values.
 */
export interface IncompleteRun {
  /** `errored` — the call came back `is_error`. `unresolved` — no result yet. */
  outcome: "errored" | "unresolved";
  /** Transcript line: the result's for `errored`, the call's for `unresolved`. */
  line: number;
}

/**
 * The checkout an announced receipt path belongs to, or null when the path is
 * not a receipt of THIS session's store.
 *
 * The candidate root is walked up from the announced file and then CHECKED by
 * asking `receiptsDir` what that root's store would be: the store's own
 * composer decides, so this module still spells no path of its own and the
 * check follows the store if it ever moves.
 */
function announcedRoot(path: string, sessionId: string): string | null {
  const dir = dirname(resolve(path));
  const root = dirname(dirname(dirname(dirname(dir))));
  return receiptsDir(root, sessionId) === dir ? realOrSelf(root) : null;
}

/**
 * Why one announcement did not survive the filter — a VALUE, recorded where the
 * drop happens.
 *
 * Each name is one of `announcedRoots`'s three rejections. They used to be
 * bare `continue`s, so the only trace a drop left was the output being shorter
 * than the input, and the caller had nothing to read but `announced.length`.
 */
type AnnouncementDrop = "tampered" | "unreadable" | "foreign-store";

/** What `announcedRoots` measured: what survived, and why the rest did not. */
interface AnnouncedReading {
  /** The roots this session announced a still-intact receipt for, in order. */
  kept: Array<{ root: string; line: number }>;
  /**
   * One entry per announcement the filter rejected, with its cause AND the
   * file it named. The path is carried because a report that says a receipt
   * was rewritten and does not say WHICH sends the operator to a directory of
   * receipts with no way to tell them apart.
   */
  dropped: Array<{ drop: AnnouncementDrop; line: number; path: string }>;
}

/**
 * The roots this session ANNOUNCED a still-intact receipt for, in transcript
 * order — AND, for every announcement that did not make it, the reason it did
 * not. A file rewritten after its announcement no longer hashes to the
 * announced digest and stops counting, exactly as the sibling tracker-write
 * gate reads its own receipts; what is new is that it stops counting OUT LOUD.
 */
function announcedRoots(
  announcements: readonly ReceiptAnnouncement[],
  sessionId: string,
): AnnouncedReading {
  const kept: Array<{ root: string; line: number }> = [];
  const dropped: Array<{ drop: AnnouncementDrop; line: number; path: string }> = [];
  for (const a of announcements) {
    const root = announcedRoot(a.path, sessionId);
    if (root === null) {
      dropped.push({ drop: "foreign-store", line: a.line, path: a.path });
      continue;
    }
    let bytes: Buffer;
    try {
      bytes = readFileSync(resolve(a.path));
    } catch {
      dropped.push({ drop: "unreadable", line: a.line, path: a.path });
      continue;
    }
    if (receiptDigest(bytes) !== a.digest) {
      dropped.push({ drop: "tampered", line: a.line, path: a.path });
      continue;
    }
    kept.push({ root, line: a.line });
  }
  return {
    kept: kept.sort((x, y) => x.line - y.line),
    dropped: dropped.sort((x, y) => x.line - y.line),
  };
}

/** One valid gate receipt, reduced to the two facts vouching asks about. */
interface GateReceiptRecord {
  /** The realpath of the checkout it names, which is its own store's root. */
  root: string;
  /** `createdAt` in epoch ms; `NaN` when the envelope's stamp is unreadable. */
  at: number;
}

/**
 * What ONE checkout's store holds for this session, read once and split into
 * the states the refusal has to tell apart.
 *
 * The near misses are carried out rather than dropped. A store holding a gate
 * receipt for another skill, or one whose `root` names a different checkout,
 * is not the same fact as a store holding nothing — and an operator told "no
 * receipt" about a directory with a receipt in it looks for the wrong thing.
 */
interface StoreReading {
  /** Gate receipts for `subject` naming THIS checkout: the ones that count. */
  records: GateReceiptRecord[];
  /** The subject of a gate receipt for this checkout under ANOTHER skill. */
  otherSubject: string | null;
  /**
   * EVERY other-skill subject this store holds a gate receipt for, distinct and
   * in the order first seen, and how many receipts that is.
   *
   * `otherSubject` alone is `??=` — the FIRST of however many — and the refusal
   * built on it said "the only gate receipt this session holds", a singularity
   * claim about a set nothing had counted (M_85e846 review round 3). The count
   * is of RECEIPTS and the list is of SUBJECTS, because two receipts can name
   * one skill and "the only receipt" would still be false.
   */
  otherSubjects: string[];
  otherCount: number;
  /** The checkout a gate receipt for `subject` in this store was written FOR. */
  foreignRoot: string | null;
  /** Files in the directory the store's reader skipped as unreadable or malformed. */
  skipped: number;
  /** False for an unreadable or unnamable store — never an exception. */
  readable: boolean;
}

const UNREADABLE_STORE: StoreReading = {
  records: [],
  otherSubject: null,
  otherSubjects: [],
  otherCount: 0,
  foreignRoot: null,
  skipped: 0,
  readable: false,
};

/**
 * Read `root`'s store for `subject` and classify what it holds.
 *
 * NEVER THROWS: this runs inside a PreToolUse guard, and a guard that throws
 * decides nothing. An unreadable or unnamable store comes back
 * `readable: false`.
 */
function readGateStore(root: string, subject: string, sessionId: string): StoreReading {
  let read: ReturnType<typeof readSessionReceipts>;
  try {
    read = readSessionReceipts(root, sessionId);
  } catch {
    return UNREADABLE_STORE;
  }
  const real = realOrSelf(root);
  const out: StoreReading = {
    records: [],
    otherSubject: null,
    otherSubjects: [],
    otherCount: 0,
    foreignRoot: null,
    skipped: read.skipped,
    readable: true,
  };
  for (const r of read.receipts) {
    // The session is asked again here although the store's reader keys on it
    // twice over (the directory it opened, and the envelope's own field):
    // "whose session" is half of what makes a receipt valid, and this module
    // owns that verdict.
    if (r.kind !== GATE_RECEIPT_KIND || r.sessionId !== sessionId) continue;
    if (typeof r.root !== "string") continue;
    // By REALPATH on both sides, for the reason `checkoutRootOf` realpaths when
    // writing: the same checkout reached through a symlink is ONE checkout. It
    // is compared at all because a receipt file can be copied or a tree
    // relocated, and a receipt whose `root` names somewhere else is evidence
    // about somewhere else.
    const here = realOrSelf(r.root) === real;
    if (r.subject !== subject) {
      if (here && typeof r.subject === "string") {
        out.otherSubject ??= r.subject;
        out.otherCount += 1;
        if (!out.otherSubjects.includes(r.subject)) out.otherSubjects.push(r.subject);
      }
      continue;
    }
    if (here) out.records.push({ root: real, at: Date.parse(String(r.createdAt)) });
    else out.foreignRoot ??= realOrSelf(r.root);
  }
  return out;
}

/**
 * Is there, in `root`'s store, a receipt of THIS session recording that
 * `subject` ran against THIS checkout?
 *
 * `subject` is the full skill name (`dev-process-toolkit:gate-check`), compared
 * against the receipt's own `subject` field — the value `gateSubject` wrote.
 *
 * ONE rule, read as named legs in order: does it apply at all (`not-managed`),
 * can the store be found (`session-id-missing`, `store-unreadable`), does it
 * hold the right receipt (`no-receipt`, `wrong-subject`, `foreign-root`), and
 * does a gate run in this session account for it (`not-vouched` when another
 * checkout took the window, and one of the seven runless names when nothing
 * places it — see `GateEvidenceReason` for the full set and why each is its
 * own value).
 *
 * NEVER THROWS. An unreadable store, a path-unsafe session id, a `root` that has
 * since vanished: each is a `false` with a reason, not an exception. A
 * PreToolUse guard that throws decides nothing, which is an unexplained
 * interruption rather than a verdict.
 */
export function gateReceiptEvidence(
  subject: string,
  root: string,
  sessionId: string | undefined,
  vouch?: VouchContext,
): GateEvidence {
  const blank = {
    store: null,
    skipped: 0,
    claimant: null,
    named: null,
    tampered: [] as string[],
    namedAll: [] as string[],
    namedCount: 0,
    droppedCount: 0,
  };
  if (!isToolkitManaged(root)) {
    return { ok: true, applies: false, reason: "not-managed", ...blank };
  }
  if (sessionId === undefined || sessionId === "") {
    return { ok: false, applies: true, reason: "session-id-missing", ...blank };
  }
  let storeDir: string;
  try {
    storeDir = receiptsDir(root, sessionId);
  } catch {
    // A session id the store refuses to spell as a directory segment.
    return { ok: false, applies: true, reason: "store-unreadable", ...blank };
  }
  const held = readGateStore(root, subject, sessionId);
  const here = {
    applies: true as const,
    store: storeDir,
    skipped: held.skipped,
    tampered: [] as string[],
    namedAll: held.otherSubjects,
    namedCount: held.otherCount,
    droppedCount: 0,
  };
  if (!held.readable) {
    return { ok: false, reason: "store-unreadable", claimant: null, named: null, ...here };
  }
  if (held.records.length === 0) {
    // The three ways the store holds no receipt FOR THIS CHECKOUT, told apart:
    // a receipt written for somewhere else, a receipt for another gate, or
    // nothing (which includes every file the reader skipped and counted).
    if (held.foreignRoot !== null) {
      return { ok: false, reason: "foreign-root", claimant: null, named: held.foreignRoot, ...here };
    }
    if (held.otherSubject !== null) {
      return { ok: false, reason: "wrong-subject", claimant: null, named: held.otherSubject, ...here };
    }
    return { ok: false, reason: "no-receipt", claimant: null, named: null, ...here };
  }
  /**
   * The PERMIT, carrying whatever was detected on the way to it.
   *
   * A function rather than a constant because the permit is not the end of what
   * there is to say: a forgery detected alongside a genuine vouch rides out on
   * `tampered` instead of dying with the `return` (M_85e846 review round 3).
   */
  const vouched = (tampered: string[] = []): GateEvidence => ({
    ok: true,
    reason: "receipt-found",
    claimant: null,
    named: null,
    ...here,
    tampered,
  });
  if (vouch === undefined) {
    // No transcript to place the receipt against — the pre-vouching reading,
    // kept for callers that hold no session (and for the fail-open leg).
    return vouched();
  }

  // Every receipt this session could have written anywhere the guard can see,
  // so "the FIRST root written in this window" is answered against all of them
  // rather than against the one store that happens to be under grading.
  const real = realOrSelf(root);
  const all = [...held.records];
  const seen = new Set<string>([real]);
  for (const peer of vouch.peerRoots) {
    const p = realOrSelf(peer);
    if (seen.has(p)) continue;
    seen.add(p);
    all.push(...readGateStore(peer, subject, sessionId).records);
  }

  // `all` is read for its side conditions only; the CLAIM is decided by the
  // announcements, because a store's contents are writable by any Bash call.
  void all;
  const reading = announcedRoots(vouch.announcements ?? [], sessionId);
  const announced = reading.kept;
  // EVERY detected rewrite, kept for the verdict to carry out whichever branch
  // it leaves by. Read from the drop that recorded it, so it says which FILE.
  const tampered = reading.dropped.filter((d) => d.drop === "tampered").map((d) => d.path);
  let claimant: string | null = null;
  for (const window of vouch.windows) {
    const inside = announced.filter(
      (a) => a.line >= window.startLine && a.line < window.endLine,
    );
    if (inside.length === 0) continue;
    const first = inside[0]!;
    if (first.root === real) {
      // PERMITTED — and the tamper goes with it rather than being discarded
      // here, which is the whole of HIGH-3. Refusing would be a false positive:
      // a genuine announcement in this window vouches for this checkout, so the
      // gate demonstrably ran against it.
      return vouched(tampered);
    }
    if (claimant === null) claimant = first.root;
  }
  // Eight states, eight names, each decided HERE by the VALUE that produced it
  // — never by `announced.length`, which is a post-filter count and so cannot
  // say why the filter emptied. Reading a cause off a count is the same mistake
  // as reconstructing one from a string.
  if (claimant !== null) {
    return { ok: false, reason: "not-vouched", claimant, named: null, ...here, tampered };
  }
  const miss = (reason: GateEvidenceReason, droppedCount = 0): GateEvidence => ({
    ok: false,
    reason,
    claimant: null,
    named: null,
    ...here,
    tampered,
    droppedCount,
  });
  /** How many announcements this exact drop accounts for — measured, not assumed. */
  const countOf = (drop: AnnouncementDrop): number =>
    reading.dropped.filter((d) => d.drop === drop).length;
  if (announced.length > 0) {
    // An announcement SURVIVED and no window holds it. THREE different facts,
    // and the third used to be told as the first:
    //
    //   no windows at all      no standing Skill call could be placed in time,
    //                          so there is no order to compare against;
    //   before every window    it really does predate the first call — the one
    //                          state the order claim is TRUE of;
    //   in a HOLE              windows exist, the announcement came AFTER one
    //                          of them opened, and it still sits in none.
    //
    // The hole is ordinary: `lineBounds` in the transcript leg takes a line
    // from EVERY call while `windows` keeps only the standing, timed ones, so a
    // second /gate-check that gets interrupted CLOSES the first window without
    // opening a replacement. Told as `outside-window`, that state accused an
    // announcement of predating a call it had in fact followed.
    if (vouch.windows.length === 0) return miss("no-window");
    const firstStart = Math.min(...vouch.windows.map((w) => w.startLine));
    return miss(announced.some((a) => a.line >= firstStart) ? "between-windows" : "outside-window");
  }
  // Nothing survived. WHY is read from `dropped`, in the order the operator
  // needs to hear it: a DETECTED forgery first. A receipt rewritten after it
  // was announced is the one thing the digest binding exists to catch, and
  // folding it into "nothing ran" sends the operator to re-run the gate rather
  // than to the file that changed underneath them.
  const drops = new Set(reading.dropped.map((d) => d.drop));
  if (drops.has("tampered")) return miss("announcement-tampered", countOf("tampered"));
  if (drops.has("unreadable")) return miss("announcement-unreadable", countOf("unreadable"));
  if (drops.has("foreign-store")) return miss("announcement-foreign-store", countOf("foreign-store"));
  // No announcement reached the filter at all. Upstream, a result read as a
  // front-door run that did not carry exactly one line announced nothing — and
  // that is not the same session as one where no command was read as a run.
  const misreads = vouch.misreadRuns ?? [];
  if (misreads.some((m) => m.count > 1)) return miss("run-announced-many");
  if (misreads.some((m) => m.count === 0)) return miss("run-announced-none");
  // And the two states with no output at all to have failed a rule: the run
  // errored, or the transcript has not answered it yet. Both are sessions in
  // which a command WAS read as a run of the front door, so neither may be
  // told with the one sentence that is true only when none was.
  const incomplete = vouch.incompleteRuns ?? [];
  if (incomplete.some((r) => r.outcome === "errored")) return miss("run-errored");
  if (incomplete.some((r) => r.outcome === "unresolved")) return miss("run-unresolved");
  return miss("nothing-announced");
}

/** The two sentences a failed repository-scoped leg refuses with, and where. */
export interface GateEvidenceMiss {
  why: string;
  how: string;
  /** The checkout this miss is about, so a multi-root refusal can name them all. */
  root: string;
}

/** What each miss sentence is composed from: the verdict, plus the words for it. */
interface MissWords {
  /** The full skill name the leg demanded. */
  subject: string;
  /** The checkout being written to. */
  root: string;
  /** This session's receipt directory under it, or the root when unnamable. */
  where: string;
  /** `` ` N file(s) there were skipped…' ``, or empty. */
  skipped: string;
  /** `GateEvidence.claimant` / `GateEvidence.named`, for the legs that use them. */
  claimant: string | null;
  named: string | null;
  /**
   * The QUANTITIES the two plural-aware sentences were making up (M_85e846
   * review round 3). Both are OPTIONAL and both fall back to the one-item
   * reading, so a caller that composes words by hand — every pre-existing
   * suite does — renders exactly the sentence it rendered before.
   *
   * `namedAll` / `namedCount`: the distinct other-skill subjects this store
   * holds a gate receipt for, and how many receipts that is (`wrong-subject`).
   * `dropCount`: how many announcements were dropped for the reason being
   * refused with (`announcement-foreign-store`).
   */
  namedAll?: readonly string[];
  namedCount?: number;
  dropCount?: number;
}

/** `a`, `a and b`, `a, b and c` — a list a person reads, not an array dump. */
function inWords(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]!}`;
}

/** The closing every "the gate did not run here" leg shares. */
const NOTHING_SHOWS = "so nothing shows the gate ran against that checkout.";

/**
 * The opening every "the receipt is there, no run accounts for it" leg shares.
 *
 * One spelling, so the seven runless sentences differ ONLY in the clause that
 * says what was measured — which is the half a reader has to tell apart.
 */
const UNVOUCHED = (w: MissWords): string =>
  `the ${w.subject} gate receipt under ${w.where} is not vouched for by any ` +
  `${w.subject} Skill call in this session: `;

/**
 * ONE sentence per named leg — the whole vocabulary of this refusal, in one
 * place. Each entry composes the clause that follows "this action writes to
 * <root>, a toolkit-managed checkout, and ".
 *
 * A table rather than a branch chain because the FR's rule is that each state
 * refuses BY NAME: with the reasons and the prose side by side, a state added
 * to `GateEvidenceReason` that nobody worded is a compile error rather than a
 * silent fall-through onto its neighbour's sentence.
 */
/**
 * Exported ONLY so a test can grade that each state refuses with its own
 * sentence; nothing reads it across a module boundary at runtime.
 */
export const MISS_PROSE_FOR_TEST = (): typeof MISS_PROSE => MISS_PROSE;

const MISS_PROSE: Readonly<
  Record<Exclude<GateEvidenceReason, "not-managed" | "receipt-found">, (w: MissWords) => string>
> = {
  "session-id-missing": (w) =>
    `the hook payload carries no session_id — repository-scoped gate evidence ` +
    `is keyed by the session that produced it, so the ${w.subject} receipt for ` +
    `that checkout could not be looked up.`,

  "store-unreadable": (w) =>
    `its ${w.subject} gate receipt store under ${w.where} could not be read, ` +
    `${NOTHING_SHOWS}`,

  "no-receipt": (w) =>
    `this session holds no ${w.subject} gate receipt for it under ${w.where}, ` +
    `${NOTHING_SHOWS}${w.skipped}`,

  // The receipt(s) that ARE there name another gate. Saying "no receipt" would
  // send the operator to a directory that has one in it.
  //
  // "The only" is said ONLY where it was counted (M_85e846 review round 3):
  // `readGateStore` used to keep the FIRST other subject and nothing else, so
  // this sentence claimed singularity about a set the code never sized, and an
  // operator who had run /tdd AND /spec-review was told about one of them.
  "wrong-subject": (w) => {
    const others = w.namedAll ?? (w.named === null ? [] : [w.named]);
    const count = w.namedCount ?? others.length;
    return count > 1
      ? `the ${count} gate receipts this session holds for it under ${w.where} ` +
          `record ${inWords([...others])} — none of them ${w.subject} — ` +
          `${NOTHING_SHOWS}${w.skipped}`
      : `the only gate receipt this session holds for it under ${w.where} records ` +
          `${w.named}, not ${w.subject}, ${NOTHING_SHOWS}${w.skipped}`;
  },

  // A copied or relocated receipt: the file is in this store, but it was
  // written for somewhere else, and evidence about somewhere else is not
  // evidence about here.
  "foreign-root": (w) =>
    `the ${w.subject} gate receipt under ${w.where} was written for ` +
    `${w.named}, not for ${w.root}, ${NOTHING_SHOWS}${w.skipped}`,

  // The receipt EXISTS and names this checkout; what is missing is a gate run
  // in this session that accounts for it. CLAIMED: the run it would have to
  // belong to is already spoken for by another checkout. Reached only with a
  // claimant, because every runless state below carries its own name now.
  "not-vouched": (w) =>
    UNVOUCHED(w) +
    `the ${w.subject} run it would ` +
    `have to belong to already recorded ${w.claimant ?? "another checkout"}, ` +
    `and one gate run vouches for one checkout, ${NOTHING_SHOWS}`,

  // An announcement SURVIVED, windows exist, and it sits before the first of
  // them. The order claim below is only made HERE, where it was measured: a
  // window it could have fallen in exists, and it does not.
  "outside-window": (w) =>
    UNVOUCHED(w) +
    `it was written before the first ` +
    `${w.subject} Skill call in this session, ${NOTHING_SHOWS}`,

  // An announcement survived, windows exist, and it sits in a HOLE between two
  // of them: after one opened, before the next did, inside none. Its own
  // sentence because `outside-window`'s order claim is FALSE here — the
  // announcement came AFTER a Skill call, not before the first one — and the
  // hole is an ordinary shape: a second /gate-check that gets interrupted
  // contributes a line boundary that closes the previous window and, being
  // retired, opens no replacement.
  "between-windows": (w) =>
    UNVOUCHED(w) +
    `it was announced AFTER a ${w.subject} Skill call and BEFORE the next one, ` +
    `in a stretch of the transcript that no vouching window covers: the call ` +
    `that closed the previous window opened none of its own — it was retired ` +
    `by an error or a denial, or the transcript could not place it in time — ` +
    `${NOTHING_SHOWS}`,

  // An announcement survived and there is no window at all, because no standing
  // Skill call carries a stamp the transcript can place. Says THAT, and makes
  // no claim about order: an empty window list is the absence of anything to
  // compare against, not evidence that the receipt came first. Told as
  // `outside-window`, this state accused an announcement made AFTER the call of
  // predating it.
  "no-window": (w) =>
    UNVOUCHED(w) +
    `a receipt was announced, and no ${w.subject} Skill call in this session ` +
    `carries a timestamp the transcript can place it against, so no call ` +
    `opened a window for it to fall in, ${NOTHING_SHOWS}`,

  // THE TAMPER. A run announced a receipt and the file changed afterwards, so
  // the announcement no longer stands for what is on disk. Ranked ahead of the
  // other drops and never folded into "nothing ran": this is the one state the
  // digest binding exists to detect, and the remedy is to look at the file, not
  // to run the gate again.
  "announcement-tampered": (w) =>
    UNVOUCHED(w) +
    `a run in this session DID announce a receipt, and the announced file no ` +
    `longer hashes to the digest that run printed for it — it was rewritten ` +
    `after it was announced, so the announcement no longer stands for the ` +
    `bytes on disk, ${NOTHING_SHOWS}`,

  // The announced file is gone or unreadable, so there are no bytes to check
  // the announcement against. Not "nothing was announced": something was.
  "announcement-unreadable": (w) =>
    UNVOUCHED(w) +
    `a run in this session DID announce a receipt, and the file it named could ` +
    `not be read back, so its announcement could not be checked against any ` +
    `bytes, ${NOTHING_SHOWS}`,

  // The announced path is a receipt of a DIFFERENT session's store — reachable
  // whenever the minting session id and the hook payload's disagree. Evidence
  // filed for another session is not evidence about this one.
  //
  // Plural-aware for the same reason `wrong-subject` is: `announcedRoots`
  // pushes one `dropped` entry PER announcement, so "the only receipt a run in
  // this session announced" was a count the code had, declined to read, and
  // then asserted (M_85e846 review round 3).
  "announcement-foreign-store": (w) =>
    UNVOUCHED(w) +
    ((w.dropCount ?? 1) > 1
      ? `all ${w.dropCount} of the receipts runs in this session announced are ` +
        `filed under another session's receipt store, and a receipt kept for ` +
        `another session is not evidence about this one, ${NOTHING_SHOWS}`
      : `the only receipt a run in this session announced is filed under another ` +
        `session's receipt store, and a receipt kept for another session is not ` +
        `evidence about this one, ${NOTHING_SHOWS}`),

  // A command WAS read as a front-door run; its result carried several
  // announcements, so it announced none of them. Saying "no command was read
  // as a run" here is false of the session the operator just watched.
  "run-announced-many": (w) =>
    UNVOUCHED(w) +
    `a command in this session was read as a run of the ${w.subject} receipt ` +
    `front door, and its output carried more than one receipt announcement — ` +
    `one run writes one receipt, so a result carrying several announces none ` +
    `of them, ${NOTHING_SHOWS}`,

  // A command WAS read as a front-door run, and its result carried no
  // announcement at all — the run's output, not the session, is what failed.
  "run-announced-none": (w) =>
    UNVOUCHED(w) +
    `a command in this session was read as a run of the ${w.subject} receipt ` +
    `front door, and its output carried no announcement at all, so nothing in ` +
    `the transcript binds a receipt to it, ${NOTHING_SHOWS}`,

  // A command WAS read as a front-door run and the CALL came back errored —
  // ESC during the mint, or one of the front door's five named exit-1
  // refusals. That makes this the COMMON way an ordinary session reaches a
  // runless verdict, and it was being told with the one sentence reserved for
  // a session in which no command was read as a run at all.
  "run-errored": (w) =>
    UNVOUCHED(w) +
    `a command in this session was read as a run of the ${w.subject} receipt ` +
    `front door and that call came back errored, so the run left no result to ` +
    `read an announcement out of — it did not finish, ${NOTHING_SHOWS}`,

  // A command WAS read as a front-door run and the transcript carries no result
  // for it at all. A PreToolUse hook fires while the session is still being
  // written, so this is an ordinary state and not a damaged transcript.
  "run-unresolved": (w) =>
    UNVOUCHED(w) +
    `a command in this session was read as a run of the ${w.subject} receipt ` +
    `front door and the transcript carries no result for that call yet, so ` +
    `nothing it printed can be read back, ${NOTHING_SHOWS}`,

  // The receipt exists and names this checkout, and NO run was seen at all.
  // Says only what was measured — that no command in this session read as a
  // run of the front door — and nothing about WHEN the receipt was written,
  // which is the claim the shared sentence used to make and get wrong. The
  // remedy stays "run the skill": the front-door command line is never printed.
  "nothing-announced": (w) =>
    `the ${w.subject} gate receipt under ${w.where} is vouched for by nothing: ` +
    `no command in this session was read as a run of the ${w.subject} receipt ` +
    `front door, so no run announced a receipt for any checkout, ${NOTHING_SHOWS}`,
};

/**
 * The command a refusal names, per gate. The FR's `Decision: the remedy` gives
 * each gate its own spelling because each takes a different argument: only
 * /gate-check accepts a checkout path. `/dev-process-toolkit:tdd <path>` is a
 * command that skill cannot consume — its argument is an FR id — so a uniform
 * `run /<subject> <root>` handed the operator something that does not run.
 * The front-door command line is never printed here: a remedy that hands over
 * the minting command invites a receipt with no gate behind it.
 *
 * At module scope so the PERMIT-path report (`gateReceiptNotes`) spells the
 * remedy the same way the refusal does; nested inside `gateReceiptMiss` it was
 * reachable from exactly one sentence.
 */
function remedyCommand(subject: string, root: string): string {
  if (subject.endsWith(":tdd")) return `run /${subject} on the FR in ${root}`;
  if (subject.endsWith(":spec-review")) return `run /${subject} in ${root}`;
  return `run /${subject} ${root}`;
}

/**
 * Grade `root` for `subject`, and on a miss compose the refusal's own two
 * sentences. `null` means the leg is satisfied or does not apply.
 *
 * The remedy NEVER names the minting front door. A remedy that handed the agent
 * the command that writes a receipt would invite a receipt with no gate behind
 * it, which is the one failure this whole leg exists to make impossible: the
 * only sanctioned way to get a receipt is to run the gate.
 */
export function gateReceiptMiss(
  subject: string,
  root: string,
  sessionId: string | undefined,
  vouch?: VouchContext,
): GateEvidenceMiss | null {
  const evidence = gateReceiptEvidence(subject, root, sessionId, vouch);
  if (evidence.ok) {
    return null;
  }
  const words: MissWords = {
    subject,
    root,
    where: evidence.store ?? root,
    skipped:
      evidence.skipped > 0
        ? ` ${evidence.skipped} file(s) there were skipped as unreadable or malformed.`
        : "",
    claimant: evidence.claimant,
    named: evidence.named,
    namedAll: evidence.namedAll,
    namedCount: evidence.namedCount,
    dropCount: evidence.droppedCount,
  };
  return {
    why:
      `this action writes to ${root}, a toolkit-managed checkout, and ` +
      MISS_PROSE[evidence.reason as keyof typeof MISS_PROSE](words),
    how: `${remedyCommand(subject, root)}, then retry this action.`,
    root,
  };
}

/**
 * What a PERMITTED action at `root` is still owed a word about — the other half
 * of `gateReceiptMiss`, and empty for almost every permit.
 *
 * ONE finding today: a receipt of this session that was REWRITTEN after its own
 * announcement, in a session where a second, genuine announcement still vouches
 * for the checkout. `gateReceiptEvidence` returns the permit from inside the
 * window loop and used to discard `reading.dropped` with it, so the one state
 * the digest binding exists to detect was measured and then dropped on the
 * floor whenever the commit happened to be legitimate.
 *
 * PERMITTING STAYS CORRECT. The gate ran against this checkout and a surviving
 * announcement proves it; turning a detected tamper into a refusal there would
 * refuse a commit the gate really did cover. So the verdict is untouched and
 * only the silence is fixed — and it stays silent when there is nothing to say,
 * which is what keeps this from becoming noise on every permit.
 */
export function gateReceiptNotes(
  subject: string,
  root: string,
  sessionId: string | undefined,
  vouch?: VouchContext,
): GateEvidenceMiss[] {
  const evidence = gateReceiptEvidence(subject, root, sessionId, vouch);
  // A REFUSED root already says this in its refusal (`announcement-tampered`),
  // and saying it twice would read as two findings.
  if (!evidence.ok || evidence.tampered.length === 0) {
    return [];
  }
  const many = evidence.tampered.length > 1;
  return [
    {
      why:
        `this action writes to ${root}, a toolkit-managed checkout, and ` +
        `${many ? `${evidence.tampered.length} ${subject} gate receipts` : `a ${subject} gate receipt`} ` +
        `this session announced there ${many ? "were" : "was"} rewritten after ` +
        `being announced: ${evidence.tampered.join(", ")} no longer ` +
        `${many ? "hash" : "hashes"} to the digest the run that announced ` +
        `${many ? "them" : "it"} printed. The action was NOT refused — another ` +
        `announcement in this session still vouches for that checkout, so the ` +
        `gate did run against it — but a receipt that changed underneath its own ` +
        `announcement is a detected forgery, not a detail to find later.`,
      how:
        `read ${evidence.tampered[0]!} and account for the change; ` +
        `${remedyCommand(subject, root)} if you cannot.`,
      root,
    },
  ];
}

/**
 * The repository-scoped leg as the guards consume it: one closure, asked per
 * resolved root.
 *
 * Shaped as an injected function on purpose. `templates/hooks/_lib/session.ts`
 * is loaded from a temp copy by its own suite, so it carries no relative import
 * and cannot reach this module by name — it takes the leg as a value instead,
 * which also keeps the transcript's one `readFileSync` the only file read in it.
 */
export function gateReceiptLeg(
  subject: string,
  sessionId: string | undefined,
  peerRoots: readonly string[] = [],
): (
  root: string,
  windows: readonly VouchWindow[],
  announcements?: readonly ReceiptAnnouncement[],
  misreadRuns?: readonly AnnouncementMisread[],
  incompleteRuns?: readonly IncompleteRun[],
) => GateEvidenceMiss | null {
  return (root, windows, announcements, misreadRuns, incompleteRuns) =>
    gateReceiptMiss(subject, root, sessionId, {
      windows,
      peerRoots,
      announcements,
      misreadRuns,
      incompleteRuns,
    });
}

/**
 * The PERMIT-path report as the guards consume it — the same shape as
 * `gateReceiptLeg`, asked on the other branch.
 */
export function gateReceiptNoteLeg(
  subject: string,
  sessionId: string | undefined,
  peerRoots: readonly string[] = [],
): (
  root: string,
  windows: readonly VouchWindow[],
  announcements?: readonly ReceiptAnnouncement[],
  misreadRuns?: readonly AnnouncementMisread[],
  incompleteRuns?: readonly IncompleteRun[],
) => GateEvidenceMiss[] {
  return (root, windows, announcements, misreadRuns, incompleteRuns) =>
    gateReceiptNotes(subject, root, sessionId, {
      windows,
      peerRoots,
      announcements,
      misreadRuns,
      incompleteRuns,
    });
}

// ---------------------------------------------------------------------------
// Where an action writes — the guards' shared plumbing (STE-614 AC.9).
//
// Each blocking hook resolves its own target its own way: the commit gates
// through `resolveCommitTargetFromPayload`, and the PR gate through whatever
// STE-615 resolves a `gh pr create` to. What they do with the answer is the
// SAME arithmetic every time — which roots to grade, and which roots to count
// as peers when placing a receipt in its vouching window — and three copies of
// that arithmetic is three chances for the gates to disagree about what the one
// rule means. So the resolvers describe the action, and this composes the leg.
// ---------------------------------------------------------------------------

/** Where an action writes, as a target resolver describes it. */
export interface GateEvidenceWhere {
  /** Every checkout the action was RESOLVED to write to. */
  roots: readonly string[];
  /**
   * True when the target could not be PLACED — an unexpanded word, a wrapper
   * the reader cannot see through, `--git-dir`. The action could land anywhere,
   * so the rule is asked of everywhere it could land instead.
   */
  unplaced?: boolean;
  /** Checkouts an unplaced action could write to (STE-601's candidate roots). */
  candidateRoots?: readonly string[];
  /** The session's own checkout root, or null when it sits in none. */
  sessionRoot?: string | null;
}

/** The repository-scoped leg, bound to the roots it is asked of. */
export interface GateEvidenceTarget {
  /** The checkouts to grade, in the order the refusal will name them. */
  roots: string[];
  receiptLeg(
    root: string,
    windows: readonly VouchWindow[],
    announcements?: readonly ReceiptAnnouncement[],
    misreadRuns?: readonly AnnouncementMisread[],
    incompleteRuns?: readonly IncompleteRun[],
  ): GateEvidenceMiss | null;
  /** What a PERMITTED root is still owed a word about (`gateReceiptNotes`). */
  receiptNotes(
    root: string,
    windows: readonly VouchWindow[],
    announcements?: readonly ReceiptAnnouncement[],
    misreadRuns?: readonly AnnouncementMisread[],
    incompleteRuns?: readonly IncompleteRun[],
  ): GateEvidenceMiss[];
  /**
   * Whether a Bash command RAN the receipt front door (`announcesGateReceipt`).
   *
   * Injected for the same reason `receiptLeg` is: `session.ts` is loaded from a
   * temp copy by its own suite, so it carries no relative import and cannot
   * reach this module by name. It therefore holds no reading of its own — which
   * is what let a pattern there drift away from the sibling gate's tokeniser
   * and re-open HS-1.
   */
  announcesReceipts(command: string): boolean;
}

/**
 * The repository-scoped leg for one action, ready to hand to the session
 * library's `requireSkillToolUse` / `requireTddEvidence`.
 *
 * Two decisions live here, once:
 *
 *   - WHICH ROOTS ARE GRADED. A placed action is graded on the checkouts it
 *     writes to — one, or every one of several. An UNPLACED one is graded on
 *     the session's own checkout plus every root the command named, so a
 *     wrapper around a literal foreign target (`sudo git -C <B> commit`) gets
 *     no easier treatment than the bare command it runs.
 *   - WHICH ROOTS ARE PEERS. A gate run vouches for ONE checkout, so placing a
 *     receipt means knowing which checkout got there first in the same window.
 *     The session's own root is always a peer, because that is where a gate
 *     normally runs, and a receipt minted by hand for a second checkout inside
 *     that same window is exactly what the vouching rule refuses.
 *
 * Roots are deduplicated by REALPATH and kept in the spelling first seen: one
 * checkout must not be graded twice because two resolvers spelled it
 * differently.
 */
export function gateEvidenceTarget(
  subject: string,
  sessionId: string | undefined,
  where: GateEvidenceWhere,
): GateEvidenceTarget {
  const own = where.sessionRoot ?? null;
  const roots = uniqueRoots(
    where.unplaced === true
      ? [...(own === null ? [] : [own]), ...(where.candidateRoots ?? [])]
      : where.roots,
  );
  const peerRoots = uniqueRoots([...roots, ...(own === null ? [] : [own])]);
  return {
    roots,
    receiptLeg: gateReceiptLeg(subject, sessionId, peerRoots),
    receiptNotes: gateReceiptNoteLeg(subject, sessionId, peerRoots),
    announcesReceipts: announcesGateReceipt,
  };
}

/** Distinct checkouts, keyed by realpath, each kept in the spelling first seen. */
function uniqueRoots(roots: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const root of roots) {
    const key = realOrSelf(root);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(root);
  }
  return out;
}

// ---------------------------------------------------------------------------
// The command line.
//
//   bun run gate_receipt.ts <skill> <path>
//
// Exit 0 prints the store's own announcement line — `dpt-receipt: <absolute
// path> sha256:<digest>` — and nothing else. Every refusal prints the NFR-10
// envelope on stderr, exits 1, and prints nothing on stdout.
//
// Under `import` this block does not run, so the exported functions above stay
// callable with no side effect of their own.
// ---------------------------------------------------------------------------

if (import.meta.main) {
  const [skill, target] = process.argv.slice(2);
  try {
    if (skill === undefined || target === undefined) {
      throw new GateReceiptError(
        "incomplete-argv",
        "the gate-receipt front door was given fewer than the two values it needs",
        "run `bun run gate_receipt.ts <skill> <path>`, naming the gate that ran and a path inside the checkout it ran against",
        "reason=incomplete-argv",
      );
    }
    console.log(announceReceipt(recordGateRun(skill, target)));
  } catch (error) {
    // stderr, never stdout — the fail-closed invariant in this file's header.
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
