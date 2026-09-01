// scan_fr_summary_altitude — pure scanner backing the /gate-check
// `fr_summary_altitude` probe (#67, STE-386; word caps added by STE-534).
// Given a project root, walk the ACTIVE FRs only (`specs/frs/*.md`,
// `archive/` excluded) and enter every NARRATIVE section named by the section
// table (`SECTION_RULES`). A section is located by exact level-2 heading text
// (matched by /^##\s+<text>\s*$/ — an h3 `### Summary` does NOT count); it ends
// at the next LEVEL-2 `## ` heading or EOF — an h3 subheading inside the body
// does not end it, so content after it stays scanned.
//
// The rule union is CLOSED at five members. Four of them are prose rules the
// table binds to `## Summary` alone — Technical Design and Notes legitimately
// carry backticks, AC-IDs and paths, and that asymmetry lives in the TABLE as
// data, not in control flow:
//
//   line_cap   — more than 6 non-empty lines fails; the violation anchors at
//                the first non-empty line beyond the cap (the 7th). The
//                3-line floor is authoring guidance (STE-385), NOT enforced.
//                Counted PER SECTION NAME PER FILE — see the taxonomy below.
//   backtick   — any backtick character on a line (subsumes code fences).
//   ac_id      — an AC-ID token of the AC-prefix shape, regardless of tracker
//                flavor: tracker-mode (AC-STE-386.2, AC-DST-45.1) and the
//                mode-none short-ULID flavor (AC-VDTAF4.1) all flag.
//   path_token — a whitespace-delimited token containing BOTH a slash and a
//                dot-extension. "and/or", "read/write", "v2.46.0", and the
//                sentence-final "request/response." all stay clean.
//
// The fifth, `word_cap`, is driven by the section's own `wordCap` number
// rather than by the rule list, and applies wherever the table sets one:
// Summary, Technical Design and Notes each carry a different cap. Requirement,
// Acceptance Criteria and Testing are absent from the table and are therefore
// neither capped nor measured. The violation anchors at the CROSSING line —
// the first body line at which the running word count first EXCEEDS the cap,
// mirroring line_cap's "first line beyond the cap".
//
// THE TAXONOMY — WHICH RULES ACCUMULATE, AND WHY IT IS SCOPED PER NAME PER
// FILE (M137 round 3). Every rule here falls into exactly one of two classes,
// and the class decides the scope:
//
//   * A rule that carries STATE ACROSS LINES — `line_cap`'s running non-empty
//     count, `word_cap`'s running word total — is graded against an
//     ACCUMULATOR. An accumulator scoped to ONE OCCURRENCE of a heading is
//     defeated by a second occurrence of the same heading: measured on the
//     shipped scanner, three `## Summary` sections of 70 words each — well over
//     `SUMMARY_WORD_CAP` in total — scored ZERO violations, while the identical
//     words under one heading scored two. Those rules are therefore keyed by
//     SECTION NAME PER FILE, so a repeated heading spends one budget rather
//     than buying another.
//   * A PER-LINE PREDICATE — `backtick`, `ac_id`, `path_token` — carries no
//     state, so each offending line fires wherever it sits. MEASURED: one
//     Summary with three offending lines and three Summaries with one each
//     produce the identical multiset. Those rules must NOT be made stateful;
//     doing so would double-count them.
//
// REPETITION IS NOT ITSELF A VIOLATION HERE, deliberately, and this is where
// this scanner parts from `stage_block_adoption.ts` (which refuses a duplicate
// exempt heading outright). Nothing in the FR template forbids a repeated
// level-2 heading; 2 of this repository's 447 archived FRs already carry one,
// and a rule firing on repetition alone would be a NEW CONTENT RULE applied
// retroactively to real prose — exactly what `FR_WORD_CAP_EPOCH` exists to
// prevent. Accumulating per name closes the QUANTITY hole without one.
//
// MEASURED CONSEQUENCE FOR `line_cap`, which is NOT grandfathered: no archived
// FR in this repository splits a capped section (Summary / Technical Design /
// Notes) across repeated headings, so scoping the accumulator per name newly
// flags NOTHING in the existing corpus. Closing this hole is not a retroactive
// tightening — the opposite of the word-cap situation the epoch below exists
// for.
//
// Detection-only + deterministic: `file` is repo-root-relative with POSIX
// separators; `line` is 1-indexed; every violation names the `section` it was
// measured over, because a rule id alone cannot say which of three caps broke.
// A flagged accumulating rule reports ONCE PER NAME PER FILE — at the crossing
// line, wherever in the file that lands.
// Vacuous paths (no capped/ruled section present, empty or absent
// `specs/frs/`) yield zero violations and zero measurements — the probe caller
// renders zero violations as a bare GATE PASSED row.
//
// The section table is an injectable PARAMETER defaulting to the shipped
// `SECTION_RULES`, so a mutation test can hand in a mutated table (raise a
// cap, widen a rule set, cap an uncapped section) and prove the shipped
// numbers are measurements rather than stubs.
//
// Reading the file follows `scan_design_references.ts` (readFileSync + line
// walk). Splitting it into sections does NOT live here: that is
// `markdown_section_walk.ts`, which `scan_plan_narrative_altitude.ts` runs on
// too, configured by this file's `FR_SECTION_WALK` row. What stays here is the
// grading — the table, the rules and the caps.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, relative } from "node:path";

import {
  countWords,
  walkSections,
  type SectionWalkSpec,
} from "./markdown_section_walk";

export const PROBE_ID = "fr_summary_altitude";

/** The closed rule union. */
export type RuleName = "line_cap" | "backtick" | "ac_id" | "path_token" | "word_cap";

/** Word cap for `## Summary` bodies. */
export const SUMMARY_WORD_CAP = 80;
/** Word cap for `## Technical Design` bodies. */
export const TECHNICAL_DESIGN_WORD_CAP = 120;
/** Word cap for `## Notes` bodies. */
export const NOTES_WORD_CAP = 60;

export interface SectionRuleSpec {
  /** Exact level-2 heading text, e.g. "Technical Design". */
  readonly section: string;
  /** Word cap over the section BODY, or null for uncapped (and unmeasured). */
  readonly wordCap: number | null;
  /** Rules BEYOND word_cap that apply to this section. */
  readonly rules: readonly RuleName[];
}

/**
 * The shipped section table. Summary owns all four prose rules; the two other
 * narrative sections own none — they are word-capped only.
 */
export const SECTION_RULES: readonly SectionRuleSpec[] = [
  {
    section: "Summary",
    wordCap: SUMMARY_WORD_CAP,
    rules: ["line_cap", "backtick", "ac_id", "path_token"],
  },
  { section: "Technical Design", wordCap: TECHNICAL_DESIGN_WORD_CAP, rules: [] },
  { section: "Notes", wordCap: NOTES_WORD_CAP, rules: [] },
];

export interface FrSummaryAltitudeViolation {
  /** Repo-root-relative path of the FR file, POSIX separators. */
  file: string;
  /** 1-indexed line of the violation. */
  line: number;
  /** One of the closed set. */
  rule: RuleName;
  /** Exact level-2 heading text of the section it was measured over. */
  section: string;
}

export interface MeasuredSection {
  /** Repo-root-relative path of the FR file, POSIX separators. */
  file: string;
  /** Exact level-2 heading text. */
  section: string;
  /** Whitespace-delimited token count over the section BODY. */
  words: number;
}

/** Non-empty summary lines beyond this count flag `line_cap`. */
const LINE_CAP = 6;
// Any LEVEL-2 heading; group 1 is the trimmed heading text. `### Summary` (h3)
// fails because the char after `##` is `#`, not whitespace. Mirrors
// scan_design_references.ts: only a level-2 heading ends a section, so an h3
// subheading inside the body cannot mask later violations.
const HEADING_RE = /^##\s+(.*?)\s*$/;
/**
 * This scanner's row in the shared walk's config (`markdown_section_walk.ts`),
 * which `scan_plan_narrative_altitude.ts` runs on too.
 *
 * `closes: null` — here one level-2 heading both ends the previous section and
 * starts the next, so the opener is the only closer. `fenceAware: false` — this
 * walk has never treated a `## ` inside a fence as sample text; that is stated
 * as data rather than left as a silent omission, so a later FR that wants to
 * flip it has one place to do it and one place to test.
 */
const FR_SECTION_WALK: SectionWalkSpec = {
  opens: HEADING_RE,
  closes: null,
  fenceAware: false,
};
// AC-ID token of the AC-prefix shape, any flavor: tracker-mode with a numeric
// ticket segment (AC-STE-386.2, AC-DST-45.1) or the mode-none short-ULID
// prefix with no ticket segment (AC-VDTAF4.1, AC-4F61D7.2).
const AC_ID_RE = /\bAC-[A-Z0-9]+(?:-\d+)?\.\d+/;
// Trailing sentence punctuation stripped from a token before the
// dot-extension check ("request/response." must stay clean).
const TRAILING_PUNCT_RE = /[.,;:!?)\]'"]+$/;
// A dot-extension: a final `.` followed by alphanumerics.
const DOT_EXTENSION_RE = /\.[A-Za-z0-9]+$/;

/** True iff a whitespace-delimited token carries both a slash and a
 * dot-extension (after trailing sentence punctuation is stripped). */
function isPathToken(token: string): boolean {
  const stripped = token.replace(TRAILING_PUNCT_RE, "");
  return stripped.includes("/") && DOT_EXTENSION_RE.test(stripped);
}

/**
 * The rules whose verdict is a pure function of ONE line, in emission order.
 *
 * This table says only HOW a rule id decides a line. WHICH sections it is
 * evaluated over is decided by `SECTION_RULES` and nothing else — the empty
 * `rules: []` on Technical Design and Notes is what keeps all three bound to
 * `## Summary` alone. Adding a row here does NOT widen a rule's scope.
 *
 * `line_cap` and `word_cap` are deliberately absent: both are stateful over
 * the running section (a non-empty-line count and a running word total), so
 * neither can be decided from a line in isolation.
 */
const LINE_PREDICATES: readonly (readonly [RuleName, (line: string) => boolean])[] = [
  ["backtick", (line) => line.includes("`")],
  ["ac_id", (line) => AC_ID_RE.test(line)],
  ["path_token", (line) => line.split(/\s+/).some(isPathToken)],
];

/** Active FR files: `specs/frs/*.md`, non-recursive — `archive/` excluded. */
function listActiveFrs(projectRoot: string): { abs: string; rel: string }[] {
  const frsDir = `${projectRoot}/specs/frs`;
  if (!existsSync(frsDir)) return [];
  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(frsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isFile() && e.name.endsWith(".md"))
    .map((e) => ({ abs: `${frsDir}/${e.name}`, rel: `specs/frs/${e.name}` }))
    .sort((a, b) => a.rel.localeCompare(b.rel));
}

interface FileScan {
  violations: FrSummaryAltitudeViolation[];
  measured: MeasuredSection[];
}

/**
 * One section NAME's running state for the whole file — the accumulator that
 * makes the caps unsplittable (STE-534, M137 round 3).
 *
 * Keyed by name and not by occurrence, and that is the entire fix. See the
 * TAXONOMY note above `LINE_PREDICATES` for which rules need this and which
 * must never get it.
 */
interface SectionAccumulator {
  /** Words seen under this NAME so far, across every occurrence in the file. */
  words: number;
  /** Non-empty body lines seen under this NAME so far, likewise. */
  nonEmpty: number;
  /** Once per name per file, not once per occurrence. */
  lineCapFlagged: boolean;
  wordCapFlagged: boolean;
}

function scanFile(
  abs: string,
  rel: string,
  sectionRules: readonly SectionRuleSpec[],
): FileScan {
  const violations: FrSummaryAltitudeViolation[] = [];
  const measured: MeasuredSection[] = [];
  let content: string;
  try {
    content = readFileSync(abs, "utf-8");
  } catch {
    return { violations, measured };
  }

  /** Record one violation. `at` is the already-1-indexed file line. */
  const flag = (at: number, rule: RuleName, section: string): void => {
    violations.push({ file: rel, line: at, rule, section });
  };

  // THE ACCUMULATORS LIVE OUT HERE, one per section NAME per FILE — never
  // inside the section loop, where a second `## Summary` would reset them and
  // hand the author a second budget.
  const accumulators = new Map<string, SectionAccumulator>();
  const accumulatorFor = (section: string): SectionAccumulator => {
    let acc = accumulators.get(section);
    if (acc === undefined) {
      acc = { words: 0, nonEmpty: 0, lineCapFlagged: false, wordCapFlagged: false };
      accumulators.set(section, acc);
    }
    return acc;
  };

  // The shared walk yields every level-2 section in file order; the TABLE, and
  // nothing else, decides which of them this scanner grades. A section absent
  // from the table is skipped here rather than never opened — the same result,
  // because sections are disjoint and a skipped one contributes nothing.
  for (const entered of walkSections(content.split("\n"), FR_SECTION_WALK)) {
    const spec = sectionRules.find((s) => s.section === entered.heading);
    if (spec === undefined) continue;

    // Every applicability decision below reads `rules` / `wordCap` off the
    // section's own table row — never off the section NAME.
    const { section, rules, wordCap } = spec;
    const acc = accumulatorFor(section);
    let occurrenceWords = 0;

    for (let i = 0; i < entered.body.length; i++) {
      const line = entered.body[i]!;
      const at = entered.bodyLines[i]!;

      if (line.trim() !== "") {
        acc.nonEmpty++;
        if (rules.includes("line_cap") && acc.nonEmpty > LINE_CAP && !acc.lineCapFlagged) {
          acc.lineCapFlagged = true;
          flag(at, "line_cap", section);
        }
      }
      // PER-LINE PREDICATES ARE UNTOUCHED BY THE ACCUMULATOR. They read the
      // line and nothing else, so they fire once per offending line wherever
      // it sits — three dirty lines under one heading and three headings of
      // one dirty line each produce the identical multiset. Making them
      // stateful would double-count them, which is the OTHER direction of this
      // same defect.
      for (const [rule, matches] of LINE_PREDICATES) {
        if (rules.includes(rule) && matches(line)) flag(at, rule, section);
      }

      const n = countWords(line);
      if (n > 0) {
        acc.words += n;
        occurrenceWords += n;
        if (wordCap !== null && acc.words > wordCap && !acc.wordCapFlagged) {
          acc.wordCapFlagged = true;
          flag(at, "word_cap", section);
        }
      }
    }

    // MEASUREMENT STAYS PER OCCURRENCE. It answers "what is in the tree", not
    // "what broke": one row per capped section actually present, so a dogfood
    // run can still prove it was non-vacuous. GRADING is what accumulates.
    if (wordCap !== null) {
      measured.push({ file: rel, section, words: occurrenceWords });
    }
  }
  return { violations, measured };
}

function scanTree(
  projectRoot: string,
  sectionRules: readonly SectionRuleSpec[],
): FileScan {
  const violations: FrSummaryAltitudeViolation[] = [];
  const measured: MeasuredSection[] = [];
  for (const { abs, rel } of listActiveFrs(projectRoot)) {
    const result = scanFile(abs, rel, sectionRules);
    violations.push(...result.violations);
    measured.push(...result.measured);
  }
  return { violations, measured };
}

export function scanFrSummaryAltitude(
  projectRoot: string,
  sectionRules: readonly SectionRuleSpec[] = SECTION_RULES,
): FrSummaryAltitudeViolation[] {
  return scanTree(projectRoot, sectionRules).violations;
}

/**
 * Every capped section actually present in the tree, with its measured word
 * count. Measurement follows the cap: a section with `wordCap: null` (or
 * absent from the table) is neither entered for words nor reported.
 */
export function measureFrSections(
  projectRoot: string,
  sectionRules: readonly SectionRuleSpec[] = SECTION_RULES,
): MeasuredSection[] {
  return scanTree(projectRoot, sectionRules).measured;
}

// ---------------------------------------------------------------------------
// The probe layer — word_cap grandfathering by git provenance
// ---------------------------------------------------------------------------
//
// THE DEFECT THIS CLOSES (PR #76 finding F11). The word caps are RETROACTIVE:
// they grade prose that was authored years before the rule existed. Measured
// against v2.75.0 — this repository's own archived FRs, restored as ACTIVE
// FRs — the raw scanner returns 638 `word_cap` violations across 320 of 447
// files and ZERO violations of the four older prose rules. A consumer sitting
// on the previous release installs this one, touches nothing, and `/gate-check`
// flips PASSED to FAILED on prose they never wrote. This repository escaped
// only because it currently has no active FRs at all.
//
// THE SHAPE IS PROBE #73's, FOLLOWED RATHER THAN INVENTED
// (`plan_identity_mode_conditional`): grandfather by GIT PROVENANCE against a
// dated epoch. Anything git says arrived BEFORE the epoch is legacy and silent;
// anything at or after it is graded; a tree that is not a git repository at all
// is legacy, because there is no provenance to read and failing there would BE
// the forced migration this design exists to avoid; and an unreachable
// introducing commit degrades to a warning-severity advisory rather than a hard
// failure the operator cannot act on. Probe #68's second lesson applies too:
// the sparing is TALLIED into the report, never dropped in silence.
//
// TWO PROPERTIES PULL IN OPPOSITE DIRECTIONS AND BOTH ARE LOAD-BEARING:
//
//   1. The grandfathering covers `word_cap` ALONE. `line_cap`, `backtick`,
//      `ac_id` and `path_token` shipped in M105 and every consumer already
//      passes them, so an epoch that silenced them would retire four working
//      checks under cover of fixing one. Their severity stays `error` under
//      every provenance class.
//   2. `scanFrSummaryAltitude` is UNCHANGED. It stays the pure content scanner
//      three sibling suites pin on non-git temp fixtures — where grandfathering
//      in place would classify every fixture legacy and silence them. The epoch
//      arm is a LAYER over it, exactly as probe #73 layers
//      `classifyPlanProvenance` over its own walk.

/**
 * Midnight UTC on the ship date of the release that made the caps policy.
 *
 * Written down ONCE. `classifyFrProvenance` binds it as a DEFAULT ARGUMENT
 * rather than restating the literal, so the boundary and the constant cannot
 * drift apart — the `MINT_EPOCH` discipline, adopted verbatim.
 *
 * The `SHIP_DATE_CUTOFF` shape carries probe #73's known residual: an FR
 * committed in a consumer between midnight UTC and the actual release instant
 * on that same day classifies `fresh` and is graded. It is a several-hour
 * window, not zero, and it is accepted rather than designed away.
 */
export const FR_WORD_CAP_EPOCH = "2026-09-01T00:00:00Z";

/** The complete provenance vocabulary — exactly three labels, nothing else. */
export type FrProvenanceClass = "fresh" | "legacy" | "undecidable";

/**
 * Run a git query in `projectRoot`, returning `null` when git refuses.
 *
 * stderr is piped rather than inherited so a severed-object repository does not
 * spray `fatal: bad object` across an otherwise clean gate run.
 */
function gitQuery(projectRoot: string, args: string[]): string | null {
  try {
    return execFileSync("git", args, {
      cwd: projectRoot,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    return null;
  }
}

/**
 * The author date of the commit that introduced `rel`, in epoch millis, or
 * `null` when no introducing commit is discoverable.
 *
 * ARCHIVE-AWARE, and that is the load-bearing part. `git log --diff-filter=A`
 * scoped to one path returns the MOST RECENT add, so an FR archived and later
 * reopened reads as introduced at the reopen commit. `/implement` Phase 4 and
 * `/spec-archive` perform exactly that move on every FR they close, so a query
 * blind to it would re-date genuinely legacy FRs past the epoch and hard-fail
 * them — the forced migration this design exists to avoid, fired by the
 * toolkit's own archival step.
 *
 * IDENTITY-KEYED, NOT RENAME-DETECTED, for the reason M119 recorded: FR files
 * are template-shaped, so similarity-based rename detection (`--follow` and
 * per-commit `-M` alike) routinely pairs unrelated FRs and launders a fresh
 * one's date onto an old commit. An FR's basename IS its identity and it can
 * only live at two canonical paths, so the introduction date is simply the
 * OLDEST add across those two — no heuristic to tune.
 *
 * `--full-history` is load-bearing: default history simplification prunes the
 * introducing commit of a path later renamed away, so the plain query returns
 * empty for exactly the archived FRs this must date.
 */
function frIntroducingCommitDate(projectRoot: string, rel: string): number | null {
  const name = basename(rel);
  const out = gitQuery(projectRoot, [
    "log",
    "--full-history",
    "--diff-filter=A",
    "--format=%aI",
    "--",
    `specs/frs/${name}`,
    `specs/frs/archive/${name}`,
  ]);
  if (out === null) return null;

  const dates = out
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((iso) => Date.parse(iso))
    .filter((n) => Number.isFinite(n));
  if (dates.length === 0) return null;
  return Math.min(...dates);
}

/**
 * The repository-wide facts every FR's provenance answer rests on, read ONCE
 * for a whole scope rather than once per file.
 *
 * A gate run over this repository's own archive asks about hundreds of FRs, and
 * a git subprocess costs milliseconds: per-file `rev-parse` + `ls-files` +
 * `cat-file` turned a probe run into thousands of spawns. These three are
 * repository facts, not per-file ones, so they are read for the whole scope and
 * shared. There is still exactly ONE decision function
 * (`classifyAgainstFacts`) — the single-file entry point simply reads the facts
 * for a scope of one, so a batched run and a single call cannot disagree.
 */
interface FrGitFacts {
  /** False when `projectRoot` is not inside a git working tree at all. */
  isGitTree: boolean;
  /**
   * Paths git knows, cwd-relative. `null` means git REFUSED to answer, which
   * is not the same as answering "nothing is tracked".
   */
  tracked: Set<string> | null;
  /**
   * Paths present in the tip tree, cwd-relative. A refusal collapses to the
   * empty set on purpose: the per-file check it replaces (`cat-file -e HEAD:…`)
   * read every failure as "absent from HEAD" too.
   */
  inHead: Set<string>;
}

/** Non-empty, trimmed lines of a git listing. */
const gitLines = (out: string): string[] =>
  out
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

/**
 * Read the repository facts for `scope` — a list of cwd-relative pathspecs.
 *
 * `ls-files` and `ls-tree` both emit paths relative to the CURRENT WORKING
 * DIRECTORY, which is `projectRoot`, so their output is directly comparable to
 * the `relative(projectRoot, …)` paths the caller holds. That is why neither
 * uses the `<rev>:<path>` syntax, which resolves from the repo root instead and
 * would mis-answer for a package nested inside a monorepo.
 */
function readFrGitFacts(projectRoot: string, scope: readonly string[]): FrGitFacts {
  // Asked of git, not inferred from a `.git` entry at the project root — a
  // monorepo package has none and is still fully datable.
  if (gitQuery(projectRoot, ["rev-parse", "--show-toplevel"]) === null) {
    return { isGitTree: false, tracked: null, inHead: new Set() };
  }
  const trackedOut = gitQuery(projectRoot, ["ls-files", "--", ...scope]);
  const headOut = gitQuery(projectRoot, [
    "ls-tree",
    "-r",
    "--name-only",
    "HEAD",
    "--",
    ...scope,
  ]);
  return {
    isGitTree: true,
    tracked: trackedOut === null ? null : new Set(gitLines(trackedOut)),
    inHead: new Set(headOut === null ? [] : gitLines(headOut)),
  };
}

/**
 * THE decision function — one FR's provenance, given the repository facts.
 *
 * The resolution order is load-bearing:
 *
 *   1. Not a git working tree ⇒ `legacy`. There is no provenance to read, and
 *      failing there would BE the forced migration this design exists to avoid.
 *   2. Untracked ⇒ `fresh`. Git cannot predate what it has never seen. A git
 *      that REFUSES to answer is not the same as one answering "not tracked"
 *      and degrades to `undecidable` instead.
 *   3. Tracked but absent from the tip tree ⇒ `fresh` (staged, never
 *      committed). THE discriminator probe #73 records: staged-and-never-
 *      committed and severed-history read identically on `ls-files` and on
 *      `--diff-filter=A`; only the tip tree parts them.
 *   4. No discoverable introducing commit ⇒ `undecidable`.
 *   5. Otherwise compare the introducing commit's author date to `epoch`,
 *      INCLUSIVE at the boundary: at-or-after ⇒ `fresh`, before ⇒ `legacy`.
 */
function classifyAgainstFacts(
  projectRoot: string,
  rel: string,
  epoch: string,
  facts: FrGitFacts,
): FrProvenanceClass {
  if (!facts.isGitTree) return "legacy";
  if (facts.tracked === null) return "undecidable";
  if (!facts.tracked.has(rel)) return "fresh";
  if (!facts.inHead.has(rel)) return "fresh";

  const introducedAt = frIntroducingCommitDate(projectRoot, rel);
  if (introducedAt === null) return "undecidable";

  // The ONLY epoch-sensitive line in the function. Everything above answers
  // "is there a date to compare at all", which no boundary can change.
  return introducedAt >= Date.parse(epoch) ? "fresh" : "legacy";
}

/** `frPath` as git sees it: cwd-relative, POSIX separators even on Windows. */
const gitRelative = (projectRoot: string, frPath: string): string =>
  relative(projectRoot, frPath).split("\\").join("/");

/**
 * Classify one FR's provenance — the signal that separates prose written under
 * the caps policy from prose that predates it.
 *
 * THE EPOCH IS A PARAMETER WITH A DEFAULT, NOT A REQUIRED ARGUMENT, and the
 * default IS `FR_WORD_CAP_EPOCH` itself rather than a copy of its literal.
 * Both halves matter: defaulting makes "today's boundary" true by construction
 * for every existing caller, and binding to the constant means there is exactly
 * one place the epoch is written down.
 *
 * Scope is the caller's job: this answers "when did it arrive", not "is this a
 * file the probe grades".
 */
export function classifyFrProvenance(
  projectRoot: string,
  frPath: string,
  epoch: string = FR_WORD_CAP_EPOCH,
): FrProvenanceClass {
  const rel = gitRelative(projectRoot, frPath);
  return classifyAgainstFacts(projectRoot, rel, epoch, readFrGitFacts(projectRoot, [rel]));
}

/** A graded violation: the raw scanner's row plus the severity it is reported at. */
export interface FrAltitudeViolationRow extends FrSummaryAltitudeViolation {
  severity: "error" | "warning";
}

export interface FrSummaryAltitudeReport {
  violations: FrAltitudeViolationRow[];
  /** Repo-relative FR paths whose `word_cap` rows were spared. Visible, never silent. */
  grandfathered: string[];
  /**
   * How many `word_cap` ROWS those files spared — the same unit `violations`
   * counts in. `grandfathered` counts FILES and `violations` counts ROWS, so a
   * reader comparing the two numbers side by side was comparing units: one
   * pre-epoch FR breaching two caps is one file and two rows. Always a number,
   * zero included, so a clean tree reports the unit rather than omitting it.
   */
  grandfatheredRows: number;
  /** True when nothing measurable was found — no capped section in scope. */
  vacuous: boolean;
}

/**
 * The provenance classes that spare `word_cap` outright — no row, at any
 * severity. Declared as a list rather than an `=== "legacy"` comparison so the
 * disposition is data a reader can enumerate.
 */
const SILENT_PROVENANCE: readonly FrProvenanceClass[] = ["legacy"];

/**
 * `/gate-check` probe #67's FR half — the raw scanner plus the epoch arm.
 *
 * Every non-`word_cap` row passes through byte for byte, at `error`, under
 * every provenance class. A `word_cap` row is disposed of by its file's
 * provenance: `legacy` (including a non-git tree) is dropped, the file is named
 * in `grandfathered` (FILES) and the row is tallied into `grandfatheredRows`
 * (ROWS) — both units reported, because the spared count and the flagged count
 * have to be in the same unit before a reader can compare them;
 * `undecidable` is downgraded to `warning`, because
 * an operator whose object store is severed cannot fix that by rewriting a
 * summary; `fresh` is reported at `error` exactly as before.
 *
 * Provenance is asked ONCE PER FILE and only for files that actually carry a
 * `word_cap` row — a clean pre-epoch FR was never grandfathered, because it
 * never violated anything.
 */
export function runFrSummaryAltitudeProbe(
  projectRoot: string,
  sectionRules: readonly SectionRuleSpec[] = SECTION_RULES,
): FrSummaryAltitudeReport {
  const { violations: raw, measured } = scanTree(projectRoot, sectionRules);

  // The repository facts, read once for the whole active-FR directory, then the
  // same decision function every single-file caller goes through.
  let facts: FrGitFacts | null = null;
  const provenanceOf = new Map<string, FrProvenanceClass>();
  const classify = (rel: string): FrProvenanceClass => {
    const cached = provenanceOf.get(rel);
    if (cached !== undefined) return cached;
    facts ??= readFrGitFacts(projectRoot, ["specs/frs"]);
    const answer = classifyAgainstFacts(projectRoot, rel, FR_WORD_CAP_EPOCH, facts);
    provenanceOf.set(rel, answer);
    return answer;
  };

  const violations: FrAltitudeViolationRow[] = [];
  const grandfathered: string[] = [];
  let grandfatheredRows = 0;
  for (const v of raw) {
    if (v.rule !== "word_cap") {
      violations.push({ ...v, severity: "error" });
      continue;
    }
    const provenance = classify(v.file);
    if (SILENT_PROVENANCE.includes(provenance)) {
      if (!grandfathered.includes(v.file)) grandfathered.push(v.file);
      grandfatheredRows += 1;
      continue;
    }
    violations.push({
      ...v,
      severity: provenance === "undecidable" ? "warning" : "error",
    });
  }

  return { violations, grandfathered, grandfatheredRows, vacuous: measured.length === 0 };
}

// Read-only CLI front door, the same idiom the sibling `scan_plan_narrative_
// altitude.ts` carries. Probe #67's registration is ONE line ordering a reader
// to call BOTH scanners, and probe #81 grades such an order UNREACHABLE unless
// the named module can in fact be run by hand — so a half with no entry point
// stranded the half carrying the whole grandfathering layer. `skills/gate-check/
// SKILL.md` names the two sanctioned resolutions and rules the third out: give
// the module an `import.meta.main` entry, or word the registration so it orders
// nothing — raising the pin to admit one more order nobody can carry out is the
// drift the pin exists to catch. This is the first resolution. Imported by the
// probe and by tests, `import.meta.main` is false and this block never runs, so
// the module stays side-effect-free at import.
//
// IT SPEAKS FOR THE RAW SCANNER, NOT FOR THE GRADED PROBE, and that is a
// decision rather than an oversight. `runFrSummaryAltitudeProbe` grandfathers
// `word_cap` on any file it classifies `legacy`, and a tree that is not a git
// repository classifies EVERY file that way — so a front door wired to the
// graded probe would print nothing on a violating scratch directory and read as
// a clean pass. A door that is silent for the wrong reason is worse than no
// door. Prints `file:line — rule — section` per violation, both rule classes
// alike (the accumulating `word_cap` and the per-line predicates); empty stdout
// means the ACTIVE FRs are clean.
if (import.meta.main) {
  const projectRoot = process.argv[2] ?? process.cwd();
  for (const v of scanFrSummaryAltitude(projectRoot)) {
    console.log(`${v.file}:${v.line} — ${v.rule} — ${v.section}`);
  }
}
