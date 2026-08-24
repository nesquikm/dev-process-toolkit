// skip_baseline — the branch-point skip baseline and the delta verdict read
// against it (STE-509: newly introduced skips are red; pre-existing skips are
// not).
//
// The module holds three invariants. Each is stated ONCE, at the declaration
// that enforces it, together with the defect it exists to prevent.
//
//   1. LOCATION (AC-STE-509.1). The store is a single branch-keyed JSON file
//      under the toolkit-owned tree, at a path composed exclusively by
//      `dpt_paths.skipBaselinePath`. This module holds no layout literal of
//      its own. M104 / STE-382 AC-STE-382.1 made that module the sole composer
//      precisely because a second composer agrees with the canonical tree right
//      up until the tree moves, and then diverges silently. Every path touched
//      here is derived from the shared function, so a relocation reaches this
//      module for free.
//
//   2. IDENTITY (AC-STE-509.4). Records are keyed by branch, and the first
//      capture for a branch wins. A baseline belongs to the branch it was
//      captured on; another branch's number is never silently reused in its
//      place, and a mid-run refresh can never flatten the delta to zero. See
//      `captureSkipBaseline`.
//
//   3. HONESTY (AC-STE-509.2, AC-STE-509.3). The verdict is three-valued. An
//      absent baseline is `unmeasured` — a state of its own, never read as
//      zero, never read as equal to current, and never surfaced in the words
//      that report a clean run. See `classifySkipDelta` and the surfacing
//      section below.
//
// MUTATION ANCHORS — read this before restructuring. AC-STE-509.5 executes two
// real mutations against a copied form of this file: it renames a top-level
// declaration and appends a replacement, relying on this module's internal call
// sites to rebind to the replacement. Three shapes are load-bearing:
//
//   * `readSkipBaseline` and `classifySkipDelta` must stay top-level function
//     declarations, exported inline. An arrow-const form has no anchor, and the
//     anchor text must remain unique in this file.
//   * `evaluateSkipDelta` must call both by BARE NAME. Routing either through
//     an object property, an alias, or a local binding defeats the rebind.
//   * The copy is imported from a throwaway directory holding nothing but a
//     copy of `dpt_paths.ts`, so `./dpt_paths` must remain this module's ONLY
//     local import. Extracting a helper into a new sibling module breaks it.
//
// Each of those failures is silent in the same way: the mutation stops applying
// while the test keeps reporting GREEN, having proved nothing.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { skipBaselinePath } from "./dpt_paths";

// ---------------------------------------------------------------------------
// Vocabulary — the record on disk, and the verdict read out of it.
// ---------------------------------------------------------------------------

/** One branch's baseline: the skip count observed when the branch was cut. */
export interface SkipBaselineRecord {
  /** The branch this baseline belongs to. */
  readonly branch: string;
  /** Skipped-test count at the branch point. */
  readonly skipped: number;
  /** ISO-8601 capture instant. Moves only when the record is genuinely written. */
  readonly capturedAt: string;
}

/** Outcome of a capture attempt: the stored record, and whether it was written. */
export interface CaptureResult {
  /** `true` when these bytes landed on disk; `false` when a record already stood. */
  readonly written: boolean;
  /** The record now in force for the branch — freshly written or pre-existing. */
  readonly record: SkipBaselineRecord;
}

/** The on-disk store: a plain branch → record map. */
type SkipBaselineStore = Record<string, SkipBaselineRecord>;

/** The outcome vocabulary. Three-valued: an absent baseline is not a boolean. */
export const SKIP_OUTCOMES = ["pass", "fail", "unmeasured"] as const;

/** One of the three outcomes. */
export type SkipOutcome = (typeof SKIP_OUTCOMES)[number];

/** A skip-delta verdict: the outcome plus the numbers it was derived from. */
export interface SkipVerdict {
  /** `pass`, `fail`, or `unmeasured` when no baseline stands for the branch. */
  readonly outcome: SkipOutcome;
  /** The branch-point count, or `null` when unmeasured. */
  readonly baseline: number | null;
  /** The count observed on this run. */
  readonly current: number;
  /** `current - baseline`, or `null` when unmeasured. */
  readonly delta: number | null;
}

// ---------------------------------------------------------------------------
// Storage — invariant 1. Every path comes from the shared composer.
// ---------------------------------------------------------------------------

/**
 * Read the whole store. A missing, unreadable, or malformed file is an absent
 * store, not a throw — an unmeasured baseline is a first-class state, and this
 * layer must not turn it into a crash.
 */
function readStore(projectRoot: string): SkipBaselineStore {
  const file = skipBaselinePath(projectRoot);
  if (!existsSync(file)) return {};

  let raw: string;
  try {
    raw = readFileSync(file, "utf-8");
  } catch {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }
  return parsed as SkipBaselineStore;
}

/** Write the whole store, creating the toolkit-owned directory if needed. */
function writeStore(projectRoot: string, store: SkipBaselineStore): void {
  const file = skipBaselinePath(projectRoot);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(store, null, 2)}\n`, "utf-8");
}

/**
 * A stored value is a usable record only when its fields have the right shapes.
 *
 * Applied at every read of an entry, so a hand-edited or partially written file
 * degrades to "no baseline for this branch" rather than to a verdict computed
 * from a `NaN` or a missing count.
 */
function asRecord(value: unknown): SkipBaselineRecord | null {
  if (value === null || typeof value !== "object") return null;
  const candidate = value as Partial<SkipBaselineRecord>;
  if (typeof candidate.branch !== "string") return null;
  if (typeof candidate.skipped !== "number" || !Number.isFinite(candidate.skipped)) {
    return null;
  }
  if (typeof candidate.capturedAt !== "string") return null;
  return {
    branch: candidate.branch,
    skipped: candidate.skipped,
    capturedAt: candidate.capturedAt,
  };
}

// ---------------------------------------------------------------------------
// Capture and read-back — invariant 2.
// ---------------------------------------------------------------------------

/**
 * Capture the branch point's skip count for `branch` under the toolkit tree.
 *
 * AC-STE-509.4 — WRITE-ONCE PER BRANCH. The first capture for a branch wins;
 * every later capture for that same branch is a no-op that returns the standing
 * record with `written: false`. The bytes on disk are left untouched, so even
 * the `capturedAt` instant does not move.
 *
 * The defect that rule prevents: a baseline that refreshes as the run proceeds
 * always measures the current count against itself, reports a zero delta, and
 * so becomes a guard that structurally cannot fail. Pinning the write to branch
 * creation is what keeps the ratchet falsifiable. A genuinely new branch has no
 * standing record and therefore seeds its own baseline as normal.
 *
 * Returns the record now in force together with whether this call is what put
 * it there.
 */
export function captureSkipBaseline(
  projectRoot: string,
  branch: string,
  skipped: number,
): CaptureResult {
  const store = readStore(projectRoot);

  const existing = asRecord(store[branch]);
  if (existing !== null) {
    return { written: false, record: existing };
  }

  const record: SkipBaselineRecord = {
    branch,
    skipped,
    capturedAt: new Date().toISOString(),
  };
  store[branch] = record;
  writeStore(projectRoot, store);

  return { written: true, record };
}

/**
 * Read the baseline captured for `branch`, or `null` when this branch has none.
 *
 * `null` means unmeasured — never zero, and never some other branch's count.
 *
 * A mutation anchor: keep this a top-level function declaration (see the file
 * header).
 */
export function readSkipBaseline(
  projectRoot: string,
  branch: string,
): SkipBaselineRecord | null {
  const store = readStore(projectRoot);
  return asRecord(store[branch]);
}

// ---------------------------------------------------------------------------
// The delta verdict — invariant 3, arithmetic half (AC-STE-509.2).
//
// The count fed in is the SKIPPED count, never the total: a ratchet on `total`
// compares an unrelated magnitude against the baseline and reports a failure
// for every test the branch adds.
// ---------------------------------------------------------------------------

/**
 * Classify a skip count against its branch-point baseline.
 *
 * Pure arithmetic: `delta = current - baseline`. A POSITIVE delta means this
 * change put skips on the board that were not there when the branch was cut,
 * and that fails. Zero or negative passes — pre-existing skips are not this
 * change's doing, and removing skips is strictly an improvement.
 *
 * A `null` baseline is unmeasured — never read as zero (which makes every
 * pre-existing skip look newly introduced) and never read as equal to current
 * (which makes every new skip invisible).
 *
 * A mutation anchor: keep this a top-level function declaration (see the file
 * header).
 */
export function classifySkipDelta(baseline: number | null, current: number): SkipVerdict {
  if (baseline === null) {
    return { outcome: "unmeasured", baseline: null, current, delta: null };
  }

  const delta = current - baseline;
  return { outcome: delta > 0 ? "fail" : "pass", baseline, current, delta };
}

/**
 * Join the stored baseline for `branch` to a `current` count and classify.
 *
 * Both collaborators are called by bare name so an override of either is
 * genuinely wired through this entry point (see the file header).
 */
export function evaluateSkipDelta(
  projectRoot: string,
  branch: string,
  current: number,
): SkipVerdict {
  const record = readSkipBaseline(projectRoot, branch);
  return classifySkipDelta(record === null ? null : record.skipped, current);
}

// ---------------------------------------------------------------------------
// Surfacing — invariant 3, reporting half (AC-STE-509.3).
//
// The absent-baseline case gets its OWN line, not the passing line with a
// different label: it names itself unmeasured, says why, and says what to do
// about it. The word that reports a clean run is deliberately absent from it,
// so a reader skimming output can never mistake an unmeasured guard for a
// satisfied one.
// ---------------------------------------------------------------------------

/** A verdict is a clean pass only when it is an actual measured `pass`. */
export function isCleanPass(verdict: SkipVerdict): boolean {
  return verdict.outcome === "pass";
}

/**
 * The numbers clause shared by the two MEASURED renderings — and deliberately
 * not by the unmeasured one, which is built from its own words instead. That
 * asymmetry is the point: an `unmeasured` line assembled from the same parts as
 * a passing line is a relabelled pass, which is exactly what AC-STE-509.3
 * forbids.
 */
function measuredAgainstBaseline(verdict: SkipVerdict): string {
  const delta = verdict.delta ?? 0;
  const signed = delta > 0 ? `+${delta}` : `${delta}`;
  return `${verdict.current} now vs ${verdict.baseline} at the branch point (delta ${signed})`;
}

/**
 * Render a verdict as one human-facing line.
 *
 * The `unmeasured` rendering is a distinct sentence, not a relabelled pass —
 * it carries no clean-run wording at all, because a guard that never ran must
 * be surfaced rather than quietly waved through.
 */
export function renderSkipVerdict(verdict: SkipVerdict): string {
  switch (verdict.outcome) {
    case "unmeasured":
      return (
        `skips: UNMEASURED — no baseline recorded for this branch, ` +
        `so the ${verdict.current} skip(s) seen now cannot be attributed; ` +
        `capture a baseline at the branch point`
      );
    case "fail":
      return `skips: FAIL — ${measuredAgainstBaseline(verdict)}`;
    default:
      return `skips: pass — ${measuredAgainstBaseline(verdict)}`;
  }
}
