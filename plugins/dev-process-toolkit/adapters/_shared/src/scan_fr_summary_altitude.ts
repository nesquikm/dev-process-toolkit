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
// Detection-only + deterministic: `file` is repo-root-relative with POSIX
// separators; `line` is 1-indexed; every violation names the `section` it was
// measured over, because a rule id alone cannot say which of three caps broke.
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

import { existsSync, readFileSync, readdirSync } from "node:fs";

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
    let words = 0;
    let nonEmpty = 0;
    let lineCapFlagged = false;
    let wordCapFlagged = false;

    for (let i = 0; i < entered.body.length; i++) {
      const line = entered.body[i]!;
      const at = entered.bodyLines[i]!;

      if (line.trim() !== "") {
        nonEmpty++;
        if (rules.includes("line_cap") && nonEmpty > LINE_CAP && !lineCapFlagged) {
          lineCapFlagged = true;
          flag(at, "line_cap", section);
        }
      }
      for (const [rule, matches] of LINE_PREDICATES) {
        if (rules.includes(rule) && matches(line)) flag(at, rule, section);
      }

      const n = countWords(line);
      if (n > 0) {
        words += n;
        if (wordCap !== null && words > wordCap && !wordCapFlagged) {
          wordCapFlagged = true;
          flag(at, "word_cap", section);
        }
      }
    }

    if (wordCap !== null) {
      measured.push({ file: rel, section, words });
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
