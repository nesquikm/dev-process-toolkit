// skip_baseline — the branch-point skip baseline and the delta verdict read
// against it (STE-509: newly introduced skips are red; pre-existing skips are
// not).
//
// The module holds three invariants. Each is stated ONCE, at the declaration
// that enforces it, together with the defect it exists to prevent.
//
//   1. LOCATION (AC-STE-509.1). The store is a single JSON file, keyed by
//      TRUNK COMMIT since M136 / STE-527 (it was branch-keyed under STE-509),
//      under the toolkit-owned tree, at a path composed exclusively by
//      `dpt_paths.skipBaselinePath`. This module holds no layout literal of
//      its own. M104 / STE-382 AC-STE-382.1 made that module the sole composer
//      precisely because a second composer agrees with the canonical tree right
//      up until the tree moves, and then diverges silently. Every path touched
//      here is derived from the shared function, so a relocation reaches this
//      module for free.
//
//   2. IDENTITY (AC-STE-509.4, re-keyed by AC-STE-527.1). Records are keyed by
//      the TRUNK COMMIT SHA the work departed from, not by a branch name, and
//      the first capture for a sha wins. A branch name is not an identity: it
//      is reused, renamed, and rebased under a standing record, so a number
//      captured on one tree's `feat/x` was being served to another's. The store
//      is a VERSIONED ENVELOPE — `version` / `checkoutId` / `baselines` — so a
//      v1 file (branch-keyed, carrying no `version` key) is recognised as v1
//      rather than reinterpreted: a v1 key that happens to look like a sha is
//      otherwise indistinguishable from a real one, and its count is served as
//      if it were measured here. See `readStore` and `captureSkipBaseline`.
//
//   3. HONESTY (AC-STE-509.2, AC-STE-509.3, AC-STE-530.1). The verdict is
//      four-valued, because two distinct things can go wrong before a
//      comparison happens. An absent baseline is `unmeasured`; a baseline that
//      stands but cannot be measured against this run is `incomparable`. Each
//      is a state of its own — never read as zero, never read as equal to
//      current, and never surfaced in the words that report a clean run — and
//      each names a different remedy, because one shared remedy is right about
//      one of them and wrong about the other. See `classifySkipDelta` and the
//      surfacing section below.
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
//   * The copy is imported from a throwaway directory holding copies of this
//     module's local imports and their transitive local imports (M136's
//     `MUTANT_DEPS`). A new sibling import must be added there or the mutant
//     resolves to nothing while still reporting GREEN.
//
// Each of those failures is silent in the same way: the mutation stops applying
// while the test keeps reporting GREEN, having proved nothing.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { PROTECTED_TRUNKS } from "./branch_proposal";
import { checkoutIdPath, skipBaselinePath } from "./dpt_paths";

// ---------------------------------------------------------------------------
// Vocabulary — the record on disk, and the verdict read out of it.
// ---------------------------------------------------------------------------

/** One trunk commit's baseline: the skip count observed standing on that sha. */
export interface SkipBaselineRecord {
  /** The trunk commit sha this baseline was measured at. */
  readonly sha: string;
  /** Skipped-test count at that commit. */
  readonly skipped: number;
  /** ISO-8601 capture instant. Moves only when the record is genuinely written. */
  readonly capturedAt: string;
  /** Which working tree measured it — see `readCheckoutId`. */
  readonly checkoutId: string;
  /**
   * The identities of the skipped tests at capture, when the stack could name
   * them (AC-STE-529.1).
   *
   * OPTIONAL, and OMITTED rather than empty when nothing was supplied. An empty
   * array is the claim "named, and none were skipped", which is a different
   * fact from "not named": the first makes every skip a later run observes look
   * newly introduced.
   */
  readonly names?: readonly string[];
  /**
   * Where those identities came from — or, when `names` is absent, which stack
   * could not produce them (AC-STE-529.8).
   *
   * Written so that a stack with no identity source and a writer that simply
   * forgot do not read the same on disk.
   */
  readonly namesSource?: string;
}

/**
 * What a capture was told about WHO was skipping (AC-STE-529.1).
 *
 * Both halves are optional and independent: a stack that can name its skips
 * supplies both, a stack that cannot supplies only `namesSource` — which is the
 * degrade written down rather than inferred from an absent key — and a caller
 * that knows neither supplies nothing at all.
 */
export interface SkipIdentityCapture {
  /** Identities of the skipped tests, as extracted from the runner's report. */
  readonly names?: readonly string[];
  /** Where those identities came from, or which stack could not produce them. */
  readonly namesSource?: string;
}

/** Outcome of a capture attempt: the stored record, and whether it was written. */
export interface CaptureResult {
  /** `true` when these bytes landed on disk; `false` when a record already stood. */
  readonly written: boolean;
  /** The record now in force for the branch — freshly written or pre-existing. */
  readonly record: SkipBaselineRecord;
}

/**
 * The version this build writes and the ONLY version it reads (AC-STE-527.1).
 *
 * A store carrying any other value — or, in the v1 case, no `version` key at
 * all — is a store this build cannot interpret. It is refused rather than
 * indexed: a v1 branch key and a v2 sha key are the same JSON object key, so a
 * reader that indexes the raw map hands out a v1 count as a measurement taken
 * here. That reinterpretation is silent, which is what makes it worth a
 * version.
 */
export const SKIP_BASELINE_STORE_VERSION = 2;

/** The on-disk store: a versioned envelope around a sha → record map. */
interface SkipBaselineStore {
  /** Always `SKIP_BASELINE_STORE_VERSION` when this build wrote the file. */
  readonly version: number;
  /** The checkout that owns these records. */
  readonly checkoutId: string;
  /** Trunk commit sha → the baseline measured at it. */
  readonly baselines: Record<string, SkipBaselineRecord>;
}

/**
 * What a read of the file found. `absent` and `unknown-version` are separate
 * states on purpose: an absent store means nothing was ever captured, while an
 * unreadable version means a baseline stands that this build must not grade
 * against — collapsing the second into the first silently downgrades a stricter
 * store to "no baseline".
 */
type StoreRead =
  | { readonly kind: "absent" }
  | { readonly kind: "unknown-version" }
  | { readonly kind: "ok"; readonly store: SkipBaselineStore };

/**
 * The outcome vocabulary. Four-valued: neither an absent baseline nor a
 * baseline that cannot be compared is a boolean.
 *
 * AC-STE-530.1 — `incomparable` is a state of its own: a baseline stands, but
 * it cannot be measured against this run. Widening this list is deliberate and
 * narrow; `isCleanPass` stays true for `pass` alone, so a new member joins as a
 * non-clean outcome by default rather than by being remembered about.
 */
export const SKIP_OUTCOMES = ["pass", "fail", "unmeasured", "incomparable"] as const;

/** One of the four outcomes. */
export type SkipOutcome = (typeof SKIP_OUTCOMES)[number];

/**
 * Why an `incomparable` verdict cannot be measured — the discriminator the
 * refusal line is written from.
 *
 * AC-STE-530.8 — the conditions do NOT share one sentence. A baseline captured
 * on a foreign checkout is fixed by re-measuring here; a baseline that meets a
 * run reporting no skip count of its own is fixed by re-running the gate so it
 * names its skips. One shared remedy is correct on one cause and wrong on the
 * others, which is the shape M135 recorded.
 *
 * AC-STE-527.9 adds the THIRD ground, as a MEMBER of this same list rather than
 * as a second vocabulary: a store whose `version` this build cannot read. It is
 * a first-class cause precisely because the fall-through remedy — "re-measure
 * here" — is actively WRONG for it. Re-measuring overwrites the unreadable
 * envelope wholesale (see `captureSkipBaseline`), which is how a store written
 * by a stricter build gets silently discarded by the very line that was meant
 * to help. The migration is the deliberate answer: it names every record it
 * drops.
 *
 * Same house shape as `SKIP_OUTCOMES`, deliberately: this module exports these
 * two string vocabularies and nothing else array-shaped, so a reader (and the
 * test that discovers the vocabulary rather than assuming it) can tell them
 * apart by name alone. A new ground joins as a MEMBER here; a second array
 * would make that discovery ambiguous and stop it testing what it claims.
 */
export const SKIP_INCOMPARABLE_CAUSES = [
  "foreign-checkout",
  "unnamed-run",
  "unknown-store-version",
] as const;

/** One of the incomparable causes. */
export type SkipIncomparableCause = (typeof SKIP_INCOMPARABLE_CAUSES)[number];

/** A skip-delta verdict: the outcome plus the numbers it was derived from. */
export interface SkipVerdict {
  /**
   * `pass` / `fail` when the run was measured against a baseline,
   * `unmeasured` when no baseline stands for the branch, and `incomparable`
   * when one stands but cannot be compared against this run.
   */
  readonly outcome: SkipOutcome;
  /** The branch-point count, or `null` when unmeasured. */
  readonly baseline: number | null;
  /** The count observed on this run. */
  readonly current: number;
  /** `current - baseline`, or `null` when unmeasured. */
  readonly delta: number | null;
  /**
   * Which incomparable condition fired. Present on `incomparable` alone; the
   * other three outcomes have nothing to discriminate.
   */
  readonly cause?: SkipIncomparableCause;
  /**
   * The identities skipping NOW that were not skipping at the branch point
   * (AC-STE-529.2).
   *
   * Present only when both sides of the comparison named their skips. The empty
   * array is a real answer there — compared, and nothing new — which is exactly
   * why absence has to mean something else: no set was compared at all. An
   * inline array type on purpose, not a vocabulary: this module exports two
   * string vocabularies and no third.
   */
  readonly newSkips?: readonly string[];
  /**
   * The comparison was made from counts alone, because at least one side could
   * not name its skips (AC-STE-529.3).
   *
   * Present only on verdicts the SET-aware entry point degraded. A comparison
   * that silently got weaker is indistinguishable from one that did not, and
   * the reader has no other way to tell, so the fact is carried in the verdict
   * and written into the row rather than inferred from what is missing.
   * `classifySkipDelta` never stamps it: its own renderings are byte-pinned by
   * AC-STE-530.7 and must stay exactly as they are.
   */
  readonly countOnly?: true;
}

/**
 * One side of a skip comparison: how many, and — when the stack could say —
 * which (AC-STE-529.2).
 *
 * `names: null` is "this side did not name its skips", and it is NOT the empty
 * array. The empty array is the claim that every skip was named and there were
 * none. Reading one as the other is how a run that could name nothing gets
 * graded as though every skip it reports were newly introduced.
 */
export interface SkipObservation {
  /** Skipped-test count on this side. */
  readonly count: number;
  /** Identities of those skips, or `null` when this side could not name them. */
  readonly names: readonly string[] | null;
}

// ---------------------------------------------------------------------------
// Storage — invariant 1. Every path comes from the shared composer.
// ---------------------------------------------------------------------------

/**
 * Read the whole store. A missing, unreadable, or malformed file is an absent
 * store, not a throw — an unmeasured baseline is a first-class state, and this
 * layer must not turn it into a crash.
 *
 * A file whose top level carries NO `version` key is the shipped v1 shape — a
 * bare branch → record map — and is reported as `unknown-version`. Its entries
 * are never reached: the whole point of the envelope is that a v1 key is never
 * indexed as though it were a sha.
 */
function readStore(projectRoot: string): StoreRead {
  const file = skipBaselinePath(projectRoot);
  if (!existsSync(file)) return { kind: "absent" };

  let raw: string;
  try {
    raw = readFileSync(file, "utf-8");
  } catch {
    return { kind: "absent" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: "absent" };
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { kind: "absent" };
  }

  const envelope = parsed as Partial<SkipBaselineStore>;
  // No `version` key at all is the v1 branch-keyed shape, not a v2 store with
  // a field missing. Both are refused here, and neither is ever indexed.
  if (envelope.version !== SKIP_BASELINE_STORE_VERSION) {
    return { kind: "unknown-version" };
  }
  if (typeof envelope.checkoutId !== "string") return { kind: "unknown-version" };

  const baselines = envelope.baselines;
  if (baselines === null || typeof baselines !== "object" || Array.isArray(baselines)) {
    return { kind: "unknown-version" };
  }

  return {
    kind: "ok",
    store: {
      version: SKIP_BASELINE_STORE_VERSION,
      checkoutId: envelope.checkoutId,
      baselines: baselines as Record<string, SkipBaselineRecord>,
    },
  };
}

/**
 * Write the whole store, creating the toolkit-owned directory if needed.
 *
 * The envelope is spelled out field by field rather than spread, so the file's
 * top level carries exactly `version` / `checkoutId` / `baselines` and nothing
 * a caller happened to be holding.
 */
function writeStore(projectRoot: string, store: SkipBaselineStore): void {
  const file = skipBaselinePath(projectRoot);
  mkdirSync(dirname(file), { recursive: true });
  const envelope = {
    version: SKIP_BASELINE_STORE_VERSION,
    checkoutId: store.checkoutId,
    baselines: store.baselines,
  };
  writeFileSync(file, `${JSON.stringify(envelope, null, 2)}\n`, "utf-8");
}

/**
 * The identity half of a record, OMITTED field by field rather than defaulted.
 *
 * Both writers of a record face the same rule and had reached it by the same
 * pair of conditional spreads: the read-back validator below (AC-STE-529.1) and
 * `captureSkipBaseline` (AC-STE-529.8). The rule is worth ONE statement, at the
 * one place that now enforces it.
 *
 * An absent `names` is not an empty one. A record written before STE-529, or by
 * a stack that cannot name its skips, must read back byte-identical to how it
 * was written — and a defaulted `[]` would be the claim "named, and none were
 * skipped", which makes every skip a later run reports look newly introduced.
 * `namesSource` is omitted on the same terms, so a writer that simply forgot
 * stays distinguishable from a stack that had nothing to say.
 */
function identityFields(
  names: readonly string[] | undefined,
  namesSource: string | undefined,
): Pick<SkipBaselineRecord, "names" | "namesSource"> {
  return {
    ...(names === undefined ? {} : { names }),
    ...(namesSource === undefined ? {} : { namesSource }),
  };
}

/**
 * A stored value is a usable record only when its fields have the right shapes.
 *
 * Applied at every read of an entry, so a hand-edited or partially written file
 * degrades to "no baseline for this sha" rather than to a verdict computed from
 * a `NaN` or a missing count.
 */
function asRecord(value: unknown): SkipBaselineRecord | null {
  if (value === null || typeof value !== "object") return null;
  const candidate = value as Partial<SkipBaselineRecord>;
  if (typeof candidate.sha !== "string") return null;
  if (typeof candidate.skipped !== "number" || !Number.isFinite(candidate.skipped)) {
    return null;
  }
  if (typeof candidate.capturedAt !== "string") return null;
  if (typeof candidate.checkoutId !== "string") return null;
  // The identity fields are OPTIONAL and are rebuilt only when the stored value
  // has the right SHAPE — a `names` holding anything but strings is not a set of
  // identities, and is dropped rather than carried through. What survives that
  // check is omitted-or-written by `identityFields`, which holds the rule.
  const names =
    Array.isArray(candidate.names) && candidate.names.every((n) => typeof n === "string")
      ? (candidate.names as readonly string[])
      : undefined;
  const namesSource = typeof candidate.namesSource === "string" ? candidate.namesSource : undefined;
  return {
    sha: candidate.sha,
    skipped: candidate.skipped,
    capturedAt: candidate.capturedAt,
    checkoutId: candidate.checkoutId,
    ...identityFields(names, namesSource),
  };
}

// ---------------------------------------------------------------------------
// Checkout identity and trunk resolution — what the store is keyed by, and who
// is entitled to read it back.
// ---------------------------------------------------------------------------

/** Run git in `projectRoot` and return trimmed stdout, or `null` on failure. */
function gitOut(projectRoot: string, args: readonly string[]): string | null {
  const proc = Bun.spawnSync(["git", "-C", projectRoot, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (proc.exitCode !== 0) return null;
  const out = proc.stdout.toString().trim();
  return out.length === 0 ? null : out;
}

/**
 * This working tree's opaque id, minted once and stable thereafter.
 *
 * A baseline is a measurement of one tree; another tree standing on the same
 * trunk sha may have a different dependency state, a different toolchain, or a
 * different set of ignored files, and its number is not this tree's. The id is
 * what lets a read say so instead of subtracting.
 */
export function readCheckoutId(projectRoot: string): string {
  const file = checkoutIdPath(projectRoot);
  if (existsSync(file)) {
    try {
      const existing = readFileSync(file, "utf-8").trim();
      if (existing.length > 0) return existing;
    } catch {
      // Unreadable id file: fall through and mint a fresh one.
    }
  }

  const minted = crypto.randomUUID();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${minted}\n`, "utf-8");
  return minted;
}

/**
 * Do two checkout ids name the SAME working tree?
 *
 * Trivial by body and load-bearing by position: this is the single clause that
 * decides whether a stored number is this tree's to read. It is a top-level
 * declaration, called by bare name from `readSkipBaseline`, so AC-STE-527.8 can
 * stub it and watch AC-STE-527.3's refusal go red — a comparison inlined at its
 * two call sites is unmutatable and therefore unverifiable.
 *
 * A mutation anchor: keep this a top-level function declaration (see the file
 * header).
 */
function sameCheckout(a: string, b: string): boolean {
  return a === b;
}

/**
 * The trunk commit this checkout departed from, or `null` when no protected
 * trunk is present locally.
 *
 * The trunk names come from the shipped `PROTECTED_TRUNKS`, in its order, so
 * this module composes no `"main"` / `"master"` literal of its own — a second
 * spelling agrees with the constant right up until the constant moves.
 */
export function resolveTrunkSha(projectRoot: string): string | null {
  for (const trunk of PROTECTED_TRUNKS) {
    if (gitOut(projectRoot, ["rev-parse", "--verify", "--quiet", `refs/heads/${trunk}`]) === null) {
      continue;
    }
    const base = gitOut(projectRoot, ["merge-base", "HEAD", trunk]);
    if (base !== null) return base;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Capture preconditions — AC-STE-527.2.
//
// A baseline is a claim about ONE commit measured in ONE tree state, and the
// stored record cannot tell afterwards whether it was. Both conditions are
// therefore checked before anything is minted or written:
//
//   * `git rev-parse HEAD` must equal the sha being captured. A count measured
//     while standing somewhere else is a number about another commit filed
//     under this one, and every later delta is read against it as though it
//     were measured here.
//   * `git status --porcelain` must be EMPTY, untracked files included. The
//     untracked half is not pedantry: cutting a branch with untracked FR files
//     present is this repository's own flow, and it happens at exactly the
//     moment capture runs. A status call that hides them measures a tree that
//     is not the commit.
//
// Both refuse by THROWING, in NFR-10 canonical shape, before `readCheckoutId`
// or `writeStore` is reached — a refusal that had already minted an id file
// would dirty the very tree it is judging.
// ---------------------------------------------------------------------------

/**
 * How many offending paths a refusal names.
 *
 * Enough to act on without pasting a whole `git status` into an error message;
 * the count of offenders is reported alongside, so "three" never reads as
 * "all of them".
 */
const NAMED_OFFENDER_LIMIT = 3;

/**
 * What an unreadable `git status` reports as an offender.
 *
 * FAIL-CLOSED on purpose. A status that could not be read is not a clean tree,
 * and returning `[]` here would turn every unreadable repository into a
 * capture — the guard would be satisfied precisely when it learned nothing.
 */
const UNREADABLE_STATUS = "(git status could not be read)";

/**
 * The path a porcelain-v1 line names: `XY <path>`, or `XY <old> -> <new>` for a
 * rename or copy, where the DESTINATION is the path that is now in the tree.
 * Quoting (added for paths with unusual bytes) is stripped so the name in the
 * refusal is the name the operator sees in their own `git status`.
 */
function porcelainPath(line: string): string {
  const body = line.slice(3).trim();
  const arrow = body.lastIndexOf(" -> ");
  const named = arrow === -1 ? body : body.slice(arrow + 4);
  return named.replace(/^"|"$/g, "");
}

/**
 * Every path that makes the tree dirty, in git's order. Empty on a clean tree.
 *
 * `--untracked-files=normal` is passed explicitly rather than relied upon: the
 * default is configurable (`status.showUntrackedFiles`), and a repository that
 * turned it off would hand this guard a clean answer about a tree that is not.
 *
 * This is the sited mutation anchor for AC-STE-527.8's first mutant, which
 * stubs it to always-clean; it is a top-level declaration occurring exactly
 * once so that mutation cannot land anywhere else.
 */
function offendingPaths(projectRoot: string): readonly string[] {
  const proc = Bun.spawnSync(
    ["git", "-C", projectRoot, "status", "--porcelain", "--untracked-files=normal"],
    { stdout: "pipe", stderr: "pipe" },
  );
  if (proc.exitCode !== 0) return [UNREADABLE_STATUS];
  return proc.stdout
    .toString()
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map(porcelainPath);
}

/**
 * The NFR-10 canonical refusal — verdict line, `Remedy:`, `Context:` — built in
 * ONE place so neither precondition can drift out of the shape.
 */
function captureRefusal(verdict: string, remedy: string): Error {
  return new Error(
    [
      verdict,
      `Remedy: ${remedy}`,
      "Context: mode=skip-baseline, ticket=STE-527, skill=/implement",
    ].join("\n"),
  );
}

/**
 * Refuse unless BOTH preconditions hold. Returns normally, or throws; there is
 * no third answer, and no caller may capture without passing through here.
 */
function assertCapturable(projectRoot: string, sha: string): void {
  const head = gitOut(projectRoot, ["rev-parse", "HEAD"]);
  if (head !== sha) {
    throw captureRefusal(
      `skip_baseline: refusing to capture a baseline for ${sha} — HEAD here is ` +
        `${head ?? "unreadable (not a git checkout)"}, which is not the sha being captured, ` +
        `so the count would describe another commit.`,
      `stand on the commit being measured (\`git -C ${projectRoot} checkout ${sha}\`) and ` +
        `re-run the capture: \`${captureBaselineCommand(projectRoot)}\``,
    );
  }

  const offenders = offendingPaths(projectRoot);
  if (offenders.length > 0) {
    const named = offenders.slice(0, NAMED_OFFENDER_LIMIT);
    throw captureRefusal(
      `skip_baseline: refusing to capture a baseline for ${sha} — HEAD is ${head} but the ` +
        `working tree is not clean: ${offenders.length} path(s) differ from the commit, ` +
        `first ${named.length}: ${named.join(", ")}.`,
      `commit or stash every change (untracked files included — \`git -C ${projectRoot} ` +
        `status --porcelain\` must be empty) and re-run the capture: ` +
        `\`${captureBaselineCommand(projectRoot)}\``,
    );
  }
}

// ---------------------------------------------------------------------------
// Capture and read-back — invariant 2.
// ---------------------------------------------------------------------------

/**
 * Capture the pre-work skip count for the trunk commit `sha`, under the
 * toolkit tree.
 *
 * AC-STE-509.4, re-keyed by AC-STE-527.5 — WRITE-ONCE PER TRUNK COMMIT. The
 * first capture for a sha wins; every later capture for that same sha is a
 * no-op that returns the standing record with `written: false`. The bytes on
 * disk are left untouched, so even the `capturedAt` instant does not move.
 *
 * The defect that rule prevents: a baseline that refreshes as the run proceeds
 * always measures the current count against itself, reports a zero delta, and
 * so becomes a guard that structurally cannot fail. Pinning the write to one
 * commit is what keeps the ratchet falsifiable. A genuinely new trunk commit
 * has no standing record and therefore seeds its own baseline as normal.
 *
 * The key moved from the branch to the commit because the branch was the wrong
 * subject: `/spec-write` cuts a branch AFTER writing the FR files, so a count
 * captured at branch creation is a post-work count wearing a pre-work label.
 *
 * AC-STE-527.2 — BOTH PRECONDITIONS FIRST. HEAD must be `sha` and the tree
 * must be clean, checked before an id is minted or a byte is written, so every
 * refusing path leaves the project exactly as it found it.
 *
 * Returns the record now in force together with whether this call is what put
 * it there.
 */
export function captureSkipBaseline(
  projectRoot: string,
  sha: string,
  skipped: number,
  identity?: SkipIdentityCapture,
): CaptureResult {
  assertCapturable(projectRoot, sha);

  const checkoutId = readCheckoutId(projectRoot);
  const read = readStore(projectRoot);
  const baselines: Record<string, SkipBaselineRecord> =
    read.kind === "ok" ? { ...read.store.baselines } : {};

  const existing = asRecord(baselines[sha]);
  if (existing !== null) {
    return { written: false, record: existing };
  }

  // MAY carry, not MUST (AC-STE-529.1). Each identity field is written only
  // when it was actually supplied — see `identityFields` — so a capture given
  // nothing produces exactly the bytes it produced before this parameter
  // existed.
  const record: SkipBaselineRecord = {
    sha,
    skipped,
    capturedAt: new Date().toISOString(),
    checkoutId,
    ...identityFields(identity?.names, identity?.namesSource),
  };
  baselines[sha] = record;
  writeStore(projectRoot, { version: SKIP_BASELINE_STORE_VERSION, checkoutId, baselines });

  return { written: true, record };
}

/** What a migration did: the store keys it dropped, each named. */
export interface SkipBaselineMigration {
  readonly dropped: readonly string[];
}

/**
 * The envelope field names, so a malformed v2 store's own fields are never
 * reported as dropped records.
 */
const ENVELOPE_FIELDS = new Set(["version", "checkoutId", "baselines"]);

/**
 * Bring the on-disk store to the current version (AC-STE-527.6).
 *
 * The records this migration meets are DROPPED and NAMED, never re-keyed. The
 * v1 store shipped on this repository at 9b420ec held three branch-keyed
 * counts; two of them were post-spec numbers written down by hand, and none of
 * the three can say which checkout produced it. Re-keying them to their
 * merge-base shas would install known-wrong numbers behind keys that look
 * measured — the exact failure the sha-keyed envelope exists to prevent. So the
 * numbers go, the keys are reported by name, and the next capture measures
 * honestly.
 *
 * A store this build can already read is left byte-for-byte alone: migration is
 * for the unreadable version, not for every run.
 */
export function migrateSkipBaselineStore(projectRoot: string): SkipBaselineMigration {
  const read = readStore(projectRoot);
  // Nothing stands (`absent`) or what stands is already current (`ok`): there
  // is nothing to drop, and nothing is rewritten.
  if (read.kind !== "unknown-version") return { dropped: [] };

  const file = skipBaselinePath(projectRoot);
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(readFileSync(file, "utf-8"));
  } catch {
    parsed = null;
  }

  const dropped: string[] = [];
  if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
    const top = parsed as Record<string, unknown>;
    const nested = top.baselines;
    // A v1 file is a bare key → record map; a future/malformed envelope keeps
    // its records one level down. Name whichever is actually there.
    if (nested !== null && typeof nested === "object" && !Array.isArray(nested)) {
      dropped.push(...Object.keys(nested as Record<string, unknown>));
    } else {
      dropped.push(...Object.keys(top).filter((key) => !ENVELOPE_FIELDS.has(key)));
    }
  }

  writeStore(projectRoot, {
    version: SKIP_BASELINE_STORE_VERSION,
    checkoutId: readCheckoutId(projectRoot),
    baselines: {},
  });

  return { dropped };
}

/**
 * The outcome of reading the baseline in force for this checkout's trunk.
 *
 * Three states, never two: `absent` (nothing captured), `ok` (a record this
 * build can grade against), and `incomparable` (a record stands, but this build
 * must not read it). Collapsing the third into the first turns a refusal into
 * an unmeasured run, which is a strictly weaker verdict.
 */
export type SkipBaselineRead =
  | { readonly status: "ok"; readonly record: SkipBaselineRecord }
  | { readonly status: "absent" }
  | { readonly status: "incomparable"; readonly cause?: SkipIncomparableCause };

/**
 * Read the baseline standing for this checkout's trunk commit.
 *
 * The trunk sha is resolved from git here rather than passed in: a caller that
 * can name the key can name the wrong one, and the store's whole identity claim
 * is that the key was measured, not typed.
 *
 * A mutation anchor: keep this a top-level function declaration (see the file
 * header).
 */
export function readSkipBaseline(projectRoot: string): SkipBaselineRead {
  const read = readStore(projectRoot);
  if (read.kind === "absent") return { status: "absent" };
  // AC-STE-527.9 — NAMED, not merely refused. An unreadable version is its own
  // ground with its own remedy; handing it back causeless drops it onto the
  // renderer's `default:` arm, which orders a re-measurement that would
  // overwrite the very store this build declined to read.
  if (read.kind === "unknown-version") {
    return { status: "incomparable", cause: "unknown-store-version" };
  }

  // AC-STE-527.3 — BOTH ids are checked, and a mismatch on either one refuses.
  // The envelope alone is not enough: a store can be copied wholesale into a
  // second checkout (its envelope id then names the writer, and the mismatch is
  // caught here), but a single record can also be re-stamped underneath a
  // matching envelope, and a reader that stopped at the envelope would subtract
  // a foreign number while believing it checked. Neither id is decorative.
  const here = readCheckoutId(projectRoot);
  if (!sameCheckout(read.store.checkoutId, here)) {
    return { status: "incomparable", cause: "foreign-checkout" };
  }

  const sha = resolveTrunkSha(projectRoot);
  if (sha === null) return { status: "absent" };

  const record = asRecord(read.store.baselines[sha]);
  if (record === null) return { status: "absent" };
  if (!sameCheckout(record.checkoutId, here)) {
    return { status: "incomparable", cause: "foreign-checkout" };
  }
  return { status: "ok", record };
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
 * The set difference the ratchet is really about: which identities are skipping
 * now that were not skipping at the branch point (AC-STE-529.2).
 *
 * A mutation anchor, and deliberately a plain top-level declaration called by
 * BARE NAME from the set path (see the file header). An arrow const, an inlined
 * difference, or a call routed through an object property would leave
 * AC-STE-529.9's first mutation with nothing to rebind, and the leg that proves
 * the difference is computed the right way round would prove nothing.
 */
function newlySkipping(
  baselineNames: readonly string[],
  currentNames: readonly string[],
): readonly string[] {
  const atBaseline = new Set(baselineNames);
  return currentNames.filter((name) => !atBaseline.has(name));
}

/**
 * Classify a run against its branch point by IDENTITY when both sides have one
 * (AC-STE-529.2).
 *
 * When both sides named their skips the question is a SET question, not an
 * arithmetic one: it fails if and only if some test is skipping now that was not
 * skipping at the branch point. That is strictly sharper than the count — a
 * change that deletes one skip and adds another leaves the count exactly where
 * it was, and the scalar path calls it a pass.
 *
 * A SIBLING of `classifySkipDelta`, never a rewrite of it. The scalar verdict
 * and its renderings are byte-pinned by AC-STE-530.7, so every pair this
 * function cannot answer from a set falls through to it unchanged.
 */
export function classifySkipSetDelta(
  baseline: SkipObservation | null,
  current: SkipObservation,
): SkipVerdict {
  if (baseline !== null && baseline.names !== null && current.names !== null) {
    const newSkips = newlySkipping(baseline.names, current.names);
    return {
      outcome: newSkips.length > 0 ? "fail" : "pass",
      baseline: baseline.count,
      current: current.count,
      delta: current.count - baseline.count,
      newSkips,
    };
  }
  // A NAMED baseline met by a run that could not name its skips: refuse
  // (AC-STE-529.4). This is the one mixed direction that is not a weaker
  // comparison but no comparison at all — the baseline states WHICH tests were
  // skipping, the run states only HOW MANY, and subtracting one from the other
  // answers a question neither side asked. With equal counts the arithmetic
  // path would hand back `pass` on a delta of zero, which is precisely "cannot
  // compare" collapsing into "measured zero": the swap of one skip for another
  // is invisible to the count, and the baseline's names — the only evidence
  // that could have caught it — are discarded. So `delta` is `null`, not `0`,
  // and no `pass`/`fail` is claimed.
  //
  // This is the only site that RAISES `unnamed-run` — a member of
  // `SKIP_INCOMPARABLE_CAUSES` that sat in the vocabulary, with a rendering
  // arm in `incomparableLine`, and nothing to raise it at all.
  //
  // Reaching it needs a caller that passes an explicit `null` for the current
  // run's names, meaning "I ran, and I cannot name my skips". Measured: no
  // shipped caller passes anything yet, so this arm is reachable but not
  // reached. Do not read the sentence above as a claim about the live call
  // graph — it is a claim about this function.
  //
  // Deliberately NOT symmetric with the mirrored pair (AC-STE-529.5): a
  // count-only BASELINE met by a named run still holds a number measured on
  // this checkout, so that direction degrades to arithmetic and says so. Only
  // the run can be the side that went silent after the fact.
  if (baseline !== null && baseline.names !== null && current.names === null) {
    return {
      outcome: "incomparable",
      baseline: baseline.count,
      current: current.count,
      delta: null,
      cause: "unnamed-run",
    };
  }
  // Nothing to compare as a set: the arithmetic below is today's, byte for
  // byte, and the degrade is STAMPED on the way out (AC-STE-529.3) rather than
  // left for a reader to notice. An unmeasured run made no comparison at all,
  // so it is not stamped — there is no weaker comparison to confess to.
  const scalar = classifySkipDelta(baseline === null ? null : baseline.count, current.count);
  return scalar.outcome === "unmeasured" ? scalar : { ...scalar, countOnly: true };
}

/**
 * Join the baseline standing for this checkout's trunk to a `current` count and
 * classify.
 *
 * A store this build cannot read is surfaced as `incomparable` rather than
 * handed to `classifySkipDelta` as a `null` baseline: `unmeasured` says no
 * baseline was ever taken, which is a different fact and a different remedy.
 *
 * Both collaborators are called by bare name so an override of either is
 * genuinely wired through this entry point (see the file header).
 *
 * `currentNames` is ADDITIVE and OPTIONAL, and its three states are three
 * distinct facts (AC-STE-529.2):
 *
 *   * OMITTED — this caller says nothing about identities. The call takes
 *     today's scalar path byte for byte, because every existing caller and
 *     every existing pin is on that two-argument form, and reading "said
 *     nothing" as "could not name them" would turn a named baseline's
 *     comparison into a refusal for callers that never opted in.
 *   * `null` — this run STATES it could not name its skips. Against a named
 *     baseline that is `incomparable` / `unnamed-run`, never a delta.
 *   * An array — the identities skipping now, the empty array included (which
 *     is "named, and none", not "not named").
 *
 * The set-aware sibling owns every decision once identities are in play; this
 * entry point only supplies the baseline side of the pair, so the routing and
 * the classification cannot drift apart.
 */
export function evaluateSkipDelta(
  projectRoot: string,
  current: number,
  currentNames?: readonly string[] | null,
): SkipVerdict {
  const back = readSkipBaseline(projectRoot);
  if (back.status === "incomparable") {
    // The four common fields are written ONCE and the cause spread on only when
    // there is one, so a causeless refusal still carries no `cause` key at all
    // — `discoverCauseField` reads the interface, but `incomparableLine`'s
    // `default:` arm is chosen by the key being genuinely absent rather than
    // present-and-undefined.
    const refusal: SkipVerdict = { outcome: "incomparable", baseline: null, current, delta: null };
    return back.cause === undefined ? refusal : { ...refusal, cause: back.cause };
  }
  if (currentNames === undefined) {
    return classifySkipDelta(back.status === "ok" ? back.record.skipped : null, current);
  }
  // A record captured before identities existed carries no `names` key, and its
  // absence is `null` — "this side did not name its skips" — never the empty
  // array, which would make every skip this run reports look newly introduced.
  const baseline: SkipObservation | null =
    back.status === "ok" ? { count: back.record.skipped, names: back.record.names ?? null } : null;
  return classifySkipSetDelta(baseline, { count: current, names: currentNames });
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

// ---------------------------------------------------------------------------
// The commands the refusals hand the reader — AC-STE-530.2.
//
// A refusal that cannot be acted on is a refusal that gets satisfied by
// whatever is nearest. The shipped unmeasured line ended on the words "capture
// a baseline at the branch point" and named nothing to run, and that sentence
// has already produced a hand-typed post-work count written down as a branch
// point. Every non-pass rendering therefore ends on a command, delimited by the
// ONE pair of backticks in the line so it can be lifted out and pasted with no
// editing step in between.
//
// Both are held here rather than spelled inline at each call site: two
// spellings of a command are two things that can drift, and the drifted one
// turns up exactly where somebody is already stuck.
// ---------------------------------------------------------------------------

/**
 * The runnable invocation of a SIBLING entry-point module, addressed by an
 * ABSOLUTE path resolved from this module's own location rather than by the
 * `${CLAUDE_PLUGIN_ROOT}` token the skill surfaces use.
 *
 * AC-STE-530.5 is what forces the choice: the command is asserted by being run
 * with no editing step between extraction and execution, and a shell that has
 * no `CLAUDE_PLUGIN_ROOT` set expands that token to nothing and runs `/adapters
 * /…`, which is a wrong path — the exact class of remedy this FR exists to
 * stop shipping. A reader pasting this line is in a shell too, and theirs may
 * be no better provisioned. The module rendering the line is running FROM the
 * installed plugin, so its own directory is the one place the entry point is
 * known to be.
 *
 * Quoted unconditionally: a plugin installed under a path with a space is not
 * worth a branch that nothing ever exercises.
 *
 * ONE COMPOSER FOR BOTH ENTRY POINTS. The capture command and the migrate
 * command were written against different acceptance criteria and arrived as two
 * copies of this shape. The argument against that is the one made just above
 * for the commands themselves: a second spelling of the invocation agrees with
 * the first right up until either is reworded, and the drifted one turns up
 * exactly where somebody is already stuck. The module NAME stays at each
 * command below, because that is the one thing the two genuinely differ in.
 */
function entryCommand(entryModule: string, projectRoot: string): string {
  // BOTH operands quoted, not just the module path. The root was interpolated
  // bare here while the comment beside it claimed the command was quoted
  // unconditionally — and a root under a macOS `~/Library/…` or `~/Documents/…`
  // tree routinely contains a space. The remedy would then break both ways it
  // is used: a human pasting it, and the AC-STE-530.5 / AC-STE-531 harnesses
  // that EXECUTE it through `/bin/sh -c`. A remedy that cannot be run is the
  // defect this milestone exists to close, so it must not ship inside the
  // remedy itself.
  return `bun run "${join(import.meta.dir, entryModule)}" "${projectRoot}"`;
}

/**
 * The command that captures a baseline for `projectRoot` — one spelling, held
 * here so the refusal line and any surface that orders the capture are reading
 * the same string from the same function.
 */
export function captureBaselineCommand(projectRoot = "."): string {
  return entryCommand("capture_skip_baseline.ts", projectRoot);
}

const CAPTURE_COMMAND = captureBaselineCommand();

/**
 * The command that brings `projectRoot`'s store to the version this build
 * reads — one spelling, for the same reason `captureBaselineCommand` is one.
 */
export function migrateBaselineCommand(projectRoot = "."): string {
  return entryCommand("migrate_skip_baseline.ts", projectRoot);
}

const MIGRATE_COMMAND = migrateBaselineCommand();

/** Re-run the gate so its output NAMES the skips this run only counted. */
const GATE_COMMAND = "bun test";

/**
 * What every `incomparable` line agrees on: a baseline EXISTS. That is the one
 * fact that separates this refusal from `unmeasured`, so all three renderings
 * open on it in the same words — held once here so a reword cannot leave two of
 * them saying it one way and the third another.
 *
 * Deliberately NOT shared any further than this clause. What follows the "but"
 * is the whole point of AC-STE-530.8: each cause names its own condition and
 * ends on its own remedy, because one shared sentence is right about one cause
 * and wrong about the other.
 */
const INCOMPARABLE_OPENING =
  "skips: INCOMPARABLE — a baseline stands for this trunk commit, but ";

/** Remedy for a baseline that cannot serve where it stands: take one here. */
const REMEASURE_HERE = `re-measure here: \`${CAPTURE_COMMAND}\``;

/** Remedy for a usable baseline met by a run that named no skips of its own. */
const RENAME_SKIPS = `re-run the gate so it names its skips: \`${GATE_COMMAND}\``;

/**
 * Remedy for a store this build cannot read: migrate it deliberately, which
 * names every record it drops. Emphatically NOT `REMEASURE_HERE` — a capture
 * rewrites the envelope without saying what it displaced.
 */
const MIGRATE_STORE =
  `migrate the store, which names every record it drops: \`${MIGRATE_COMMAND}\``;

/**
 * The refusal line for an `incomparable` verdict, chosen by cause.
 *
 * Built from its own words — never from `measuredAgainstBaseline`, whose
 * numbers describe a comparison that by definition did not happen here
 * (AC-STE-530.3).
 *
 * The `default` arm is not dead: a verdict can reach here carrying no cause at
 * all, and a refusal is still owed a remedy. It names the weaker condition —
 * the baseline cannot be compared, reason unstated — and hands over the same
 * re-measurement, which is the safe answer when the cause is unknown. It is NOT
 * where a declared cause lands: every member of `SKIP_INCOMPARABLE_CAUSES` has
 * an arm above, because inheriting this arm means inheriting its remedy, and
 * "re-measure here" is wrong advice for a store this build cannot read.
 */
function incomparableLine(verdict: SkipVerdict): string {
  switch (verdict.cause) {
    case "unnamed-run":
      return (
        `${INCOMPARABLE_OPENING}this run counted its skips but did not name them ` +
        `to measure against it; ${RENAME_SKIPS}`
      );
    case "foreign-checkout":
      return (
        `${INCOMPARABLE_OPENING}it was captured on a different checkout, so the ` +
        `${verdict.current} skip(s) seen here cannot be measured against it; ${REMEASURE_HERE}`
      );
    case "unknown-store-version":
      return (
        `${INCOMPARABLE_OPENING}the store holding it is at a version this build ` +
        `cannot read, so neither it nor the ${verdict.current} skip(s) seen here ` +
        `may be graded against the other; ${MIGRATE_STORE}`
      );
    default:
      return (
        `${INCOMPARABLE_OPENING}it cannot be measured against the ` +
        `${verdict.current} skip(s) seen here; ${REMEASURE_HERE}`
      );
  }
}

/**
 * How many newly-skipping identities one line names before it caps.
 *
 * A ceiling, not a default: a smaller set is named in full. The cap exists
 * because a row that pastes twenty-five identities is a row nobody reads.
 */
const NEW_SKIP_NAME_LIMIT = 5;

/**
 * The clause that NAMES the newly skipping tests (AC-STE-529.2).
 *
 * When the cap bites, the TOTAL is stated alongside the names it kept, so the
 * cap hides identities and never magnitude. A capped line that did not say how
 * many it was hiding would read as the whole story.
 */
function newSkipsClause(newSkips: readonly string[]): string {
  const shown = newSkips.slice(0, NEW_SKIP_NAME_LIMIT);
  const hidden = newSkips.length - shown.length;
  const listed = shown.join(", ");
  return hidden > 0
    ? `newly skipping: ${listed} (+${hidden} more, ${newSkips.length} total)`
    : `newly skipping: ${listed}`;
}

/**
 * The clause a degraded comparison writes into its own row (AC-STE-529.3).
 *
 * ONE string literal, deliberately: AC-STE-529.9's second mutation deletes the
 * label to prove the assertion can fail, and a second copy anywhere in this
 * module would leave that mutation with no determined site.
 *
 * EXPORTED because the row a reader actually meets is rendered elsewhere — the
 * gate's own counts line in `deliver_stage_evidence` — and that surface reads
 * this literal rather than re-spelling it. A second copy over there would agree
 * with this one until either is reworded, and the drifted one would be the one
 * on the line a reader reaches.
 */
export const COUNT_ONLY_NOTE = "compared by count only, as the skips were not named";

/**
 * The trailing confession, or nothing at all.
 *
 * Appended to the MEASURED renderings alone. The refusals already say they made
 * no comparison, and the scalar renderings never carry the flag, so the byte
 * pins on them (AC-STE-530.7) hold unchanged.
 */
function countOnlyClause(verdict: SkipVerdict): string {
  return verdict.countOnly === true ? `; ${COUNT_ONLY_NOTE}` : "";
}

/**
 * Render a verdict as one human-facing line.
 *
 * The two REFUSAL renderings are distinct sentences, not relabelled passes —
 * they carry no clean-run wording at all, because a guard that never ran must
 * be surfaced rather than quietly waved through — and each ends on a command
 * that produces the measurement it says is missing.
 */
export function renderSkipVerdict(verdict: SkipVerdict): string {
  switch (verdict.outcome) {
    case "unmeasured":
      return (
        `skips: UNMEASURED — no baseline recorded for this trunk commit, ` +
        `so the ${verdict.current} skip(s) seen now cannot be attributed; ` +
        `capture one on the trunk commit, clean: \`${CAPTURE_COMMAND}\``
      );
    case "incomparable":
      return incomparableLine(verdict);
    case "fail": {
      // The scalar rendering is byte-pinned (AC-STE-530.7), so the names are an
      // APPENDED clause on the set path alone — never a reword of the line a
      // count-derived failure has always produced.
      const failure = `skips: FAIL — ${measuredAgainstBaseline(verdict)}`;
      const named =
        verdict.newSkips === undefined || verdict.newSkips.length === 0
          ? failure
          : `${failure}; ${newSkipsClause(verdict.newSkips)}`;
      return `${named}${countOnlyClause(verdict)}`;
    }
    default:
      return `skips: pass — ${measuredAgainstBaseline(verdict)}${countOnlyClause(verdict)}`;
  }
}
