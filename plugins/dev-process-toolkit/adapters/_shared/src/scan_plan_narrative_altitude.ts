// scan_plan_narrative_altitude — pure scanner backing the plan half of the
// /gate-check `fr_summary_altitude` probe (#67, STE-535). Given a project root,
// walk the ACTIVE plans only (`specs/plan/*.md`, non-recursive, so
// `specs/plan/archive/` is frozen history the walk never enters) and measure
// every LEVEL-3 subsection.
//
// WHERE THIS PARTS FROM THE SIBLING SCANNER — and where it does not.
// `scan_fr_summary_altitude.ts` locates a section by exact level-2 heading
// TEXT and caps it from a per-name table. That cannot work on plans: a plan's
// length lives under level-3 headings whose names vary between plans
// ("Follow-ups carried into M137", "Dependency graph", "Notes on the
// rollout"). No fixed name finds them. So this scanner decides by what a body
// IS — `classifySectionBody`, a pure function of the BODY, which never
// receives the heading (AC-STE-535.1). That is what makes AC-STE-535.7 —
// rename a section, get the same verdict — assertable rather than merely
// intended.
//
// The DIFFERENCE is therefore the grading policy, not the walk. Finding the
// sections is the same job in both files, and both now do it through
// `markdown_section_walk.ts`: this scanner passes `PLAN_SECTION_WALK` (level-3
// opens, level-1/2 close, fence-aware), the FR scanner passes its own row. A
// fix to fence handling or to heading recognition lands once, for both.
//
// Classification. Every non-empty body line falls into exactly one category:
//
//   code   — inside a MATCHED fence pair (an unterminated fence opens nothing,
//            so it cannot swallow the rest of the file; AC-STE-535.4).
//   table  — a row line immediately followed by a delimiter row, plus the
//            contiguous rows beneath it. Recognised by the delimiter row, NOT
//            by counting pipes, so prose mentioning a | pipe | stays prose
//            (AC-STE-535.3).
//   item   — a checkbox bullet line PLUS any more-indented continuation lines
//            beneath it. The plan template mandates a two-line task entry (an
//            action line plus an indented `verify:` line), which sits at
//            exactly 50% by bare LINE and so could never clear a 60%
//            threshold. Counting ITEMS is the whole point of the FR
//            (AC-STE-535.2, AC-STE-535.2a).
//   prose  — everything else.
//
// A body more than `CHECKBOX_ITEM_MAJORITY` structural (code + table + item)
// is structural and exempt; anything else is narrative and capped at
// `PLAN_NARRATIVE_WORD_CAP`. Strictly more than: a body sitting exactly on the
// line is prose. A half-prose, half-checklist body is narrative, because the
// prose half is the part that grows.
//
// Reporting. Detection-only + deterministic: `file` is repo-root-relative with
// POSIX separators; `line` is 1-indexed; every violation names the `section`
// heading it was measured under. The violation carries the same
// `file/line/rule/section` shape and the same `word_cap` rule id as
// `FrSummaryAltitudeViolation`, so probe #67 renders plan and FR findings
// through one code path. The anchor is the CROSSING line — the first body line
// at which the running word count first EXCEEDS the cap — mirroring the FR
// scanner's `word_cap` anchor exactly.
//
// THE BUDGET IS PER HEADING NAME PER FILE, NOT PER OCCURRENCE (M137 round 3).
// The cap is a rule that carries STATE ACROSS LINES — a running word total —
// and an accumulator scoped to one occurrence of a heading is defeated by a
// second occurrence of the same name. Measured on the shipped scanner: three
// `### Notes` of 140 narrative words each — nearly three times
// `PLAN_NARRATIVE_WORD_CAP` in total — scored ZERO, while the identical words
// under one heading flagged. So the running total is keyed by the heading TEXT
// and carried across every occurrence in the file, and the violation is
// reported once per name.
//
// THE SCOPE IS THE FILE, chosen over the parent `##`. Both satisfy the
// contract — measured, zero of this repository's 136 archived plans repeat a
// `###` name at all, let alone under different parents — and per-file is the
// scope the sibling FR scanner already uses, so the two altitude scanners
// answer "how far does an accumulator reach?" the same way. A plan file is one
// milestone; there is no second parent for a name to hide under.
//
// STRUCTURAL SUBSECTIONS DO NOT ACCUMULATE. A structural body is EXEMPT from
// the cap, not merely under it, so its words never enter the running total —
// otherwise ten `### Tasks` of checkbox rows would redden every real plan in
// this repository. And repetition is NOT itself a violation here, for the same
// reason it is not in `scan_fr_summary_altitude.ts`: accumulating per name
// closes the quantity hole without adding a retroactive content rule.
//
// The classifier is an injectable PARAMETER defaulting to the shipped
// `classifySectionBody`, so a mutation test can hand in a mutant (invert it,
// count bare lines instead of items) and prove the shipped silence over a
// 346-word checkbox body is a measurement rather than a stub. This mirrors the
// sibling scanner's injectable section table.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";

// The hatch and the epoch are IMPORTED, never re-declared. A second list of
// exempt kinds, or a second copy of the epoch date, is a second thing to keep
// in sync with the operator-facing documentation that names them.
import { EXEMPT_PLAN_KINDS, planKind } from "./plan_identity_mode_conditional";
import { FR_WORD_CAP_EPOCH } from "./scan_fr_summary_altitude";

import {
  countWords,
  fencedFlags,
  walkSections,
  type SectionWalkSpec,
} from "./markdown_section_walk";
import type {
  FrSummaryAltitudeViolation,
  RuleName,
} from "./scan_fr_summary_altitude";

/** Word cap over a NARRATIVE level-3 plan subsection body. */
export const PLAN_NARRATIVE_WORD_CAP = 150;
/** Strictly-more-than share of structural ITEMS that exempts a body. */
export const CHECKBOX_ITEM_MAJORITY = 0.6;

/** The closed kind union. */
export type SectionKind = "narrative" | "structural";

/**
 * The one rule this scanner reports, narrowed out of the FR scanner's closed
 * `RuleName` union so it can never name a rule probe #67 does not know.
 */
export type PlanNarrativeRule = Extract<RuleName, "word_cap">;

/**
 * The violation shape, IMPORTED rather than copied. Plan findings and FR
 * findings are literally one type, so probe #67 renders both halves through a
 * single code path and a second look-alike interface cannot drift away from
 * the first. `file` is repo-root-relative with POSIX separators, `line` is the
 * 1-indexed crossing line, `rule` is always `word_cap`, and `section` is the
 * exact level-3 heading text the body was measured under.
 */
export type PlanNarrativeViolation = FrSummaryAltitudeViolation;

export interface MeasuredSubsection {
  /** Repo-root-relative path of the plan file, POSIX separators. */
  file: string;
  /** Exact level-3 heading text. */
  section: string;
  /** 1-indexed line of the heading itself. */
  line: number;
  /** Whitespace-delimited token count over the subsection BODY. */
  words: number;
  /** The verdict `classifySectionBody` returned for this body. */
  kind: SectionKind;
}

/** A classifier as the scanner calls it: body alone, never a heading. */
export type BodyClassifier = (body: readonly string[]) => SectionKind;

// ------------------------------------------------------------------ line shapes

/** A level-3 heading (`####` deliberately excluded); group 1 is the text. */
const H3_RE = /^###(?!#)\s+(.*?)\s*$/;
/** Any heading of level 1 or 2 — these END an open subsection. */
const H1_H2_RE = /^#{1,2}(?!#)\s+/;
/**
 * This scanner's row in the shared walk's config: level-3 headings open, the
 * two levels above them close, and a heading quoted inside a matched fence is
 * sample text rather than structure (AC-STE-535.4).
 */
const PLAN_SECTION_WALK: SectionWalkSpec = {
  opens: H3_RE,
  closes: H1_H2_RE,
  fenceAware: true,
};
/** A checkbox bullet; group 1 is its leading indent. */
/**
 * A TASK ITEM: a checkbox row, or an ORDERED-list row.
 *
 * MEASURED, and it is why the ordered arm exists. This project's own plans
 * M132..M136 carry 13-21 ordered task rows each and ZERO checkbox rows, while
 * the shipped `plan.md.template` teaches `- [ ] <task>`. A guard recognising
 * only the checkbox shape therefore exempts whoever copies our TEMPLATE and
 * flags whoever copies our PRACTICE — punishing the closer reader. This is the
 * second guard in this repository keyed on a task shape the project stopped
 * writing (`plan_task_state` parses checkbox tasks only, so every modern
 * `### Tasks` reports zero); a third is likely, and is worth going to look for.
 *
 * PLAIN BULLETS ARE DELIBERATELY EXCLUDED. `- some observation` is how prose
 * lists are written in `### Notes` and `### Risks`, and those should be capped.
 * Only shapes that mean "a task" earn the exemption.
 */
const CHECKBOX_RE = /^(\s*)(?:[-*+]\s+\[[^\]]*\]|\d+[.)]\s+)/;
/**
 * A table delimiter row: cells of dashes with optional alignment colons and
 * optional leading/trailing pipes. A prose line merely mentioning a pipe can
 * never match — the dashes are what is required, not the pipes.
 */
const TABLE_DELIMITER_RE =
  /^\s*\|?(?:\s*:?-{3,}:?\s*\|)*\s*:?-{3,}:?\s*\|?\s*$/;

type LineCategory = "blank" | "code" | "table" | "item" | "prose";

/** Leading-whitespace width of a line. */
function indentOf(line: string): number {
  return /^\s*/.exec(line)![0]!.length;
}

/** Per-line flags for lines belonging to a markdown table block. */
function tableFlags(lines: readonly string[], fenced: readonly boolean[]): boolean[] {
  const flags: boolean[] = new Array(lines.length).fill(false);
  for (let i = 0; i + 1 < lines.length; i++) {
    if (fenced[i] === true || fenced[i + 1] === true) continue;
    if (!lines[i]!.includes("|")) continue;
    if (!TABLE_DELIMITER_RE.test(lines[i + 1]!)) continue;
    flags[i] = true;
    flags[i + 1] = true;
    let j = i + 2;
    while (
      j < lines.length &&
      fenced[j] !== true &&
      lines[j]!.trim() !== "" &&
      lines[j]!.includes("|")
    ) {
      flags[j] = true;
      j++;
    }
    i = j - 1;
  }
  return flags;
}

/**
 * One category per body line. Precedence is code > table > item > prose.
 *
 * An ITEM spans its checkbox line plus every more-indented non-blank line
 * beneath it; a blank line closes the open item.
 */
function categorize(body: readonly string[]): LineCategory[] {
  const fenced = fencedFlags(body);
  const tabled = tableFlags(body, fenced);
  const out: LineCategory[] = [];
  let openItemIndent: number | null = null;

  for (let i = 0; i < body.length; i++) {
    const line = body[i]!;
    if (fenced[i] === true) {
      openItemIndent = null;
      out.push("code");
      continue;
    }
    if (line.trim() === "") {
      openItemIndent = null;
      out.push("blank");
      continue;
    }
    if (tabled[i] === true) {
      openItemIndent = null;
      out.push("table");
      continue;
    }
    const checkbox = CHECKBOX_RE.exec(line);
    if (checkbox !== null) {
      openItemIndent = checkbox[1]!.length;
      out.push("item");
      continue;
    }
    if (openItemIndent !== null && indentOf(line) > openItemIndent) {
      out.push("item");
      continue;
    }
    openItemIndent = null;
    out.push("prose");
  }
  return out;
}

/**
 * The shipped classifier. ONE parameter, by design: it is handed the body and
 * nothing else, so classifying by heading text is unavailable rather than
 * merely discouraged (AC-STE-535.1).
 */
export function classifySectionBody(body: readonly string[]): SectionKind {
  const content = categorize(body).filter((c) => c !== "blank");
  if (content.length === 0) return "narrative";
  const structural = content.filter((c) => c !== "prose").length;
  return structural / content.length > CHECKBOX_ITEM_MAJORITY
    ? "structural"
    : "narrative";
}

// ------------------------------------------------------------------- tree walk

/** Active plan files: `specs/plan/*.md`, non-recursive — `archive/` excluded. */
function listActivePlans(projectRoot: string): { abs: string; rel: string }[] {
  const planDir = `${projectRoot}/specs/plan`;
  if (!existsSync(planDir)) return [];
  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(planDir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isFile() && e.name.endsWith(".md"))
    .map((e) => ({ abs: `${planDir}/${e.name}`, rel: `specs/plan/${e.name}` }))
    .sort((a, b) => a.rel.localeCompare(b.rel));
}

interface FileScan {
  violations: PlanNarrativeViolation[];
  measured: MeasuredSubsection[];
}

function scanFile(abs: string, rel: string, classify: BodyClassifier): FileScan {
  const violations: PlanNarrativeViolation[] = [];
  const measured: MeasuredSubsection[] = [];
  let content: string;
  try {
    content = readFileSync(abs, "utf-8");
  } catch {
    return { violations, measured };
  }

  // THE ACCUMULATOR IS PER HEADING NAME PER FILE, and it lives out here rather
  // than inside the subsection loop — see the header note. A running total
  // reset on every `### Notes` hands the second one a fresh budget.
  const narrativeWords = new Map<string, number>();
  const crossed = new Set<string>();

  // Finding the subsections is the shared walk's job; grading them is this
  // scanner's, and the two never mix.
  for (const sub of walkSections(content.split("\n"), PLAN_SECTION_WALK)) {
    const kind = classify(sub.body);
    // GRADING IS PER LINE, NOT PER SECTION — this is the smuggling fix.
    // Exempting a whole body because its SHAPE reads structural let an
    // arbitrarily long paragraph ride along under a handful of task rows:
    // seven checkbox items plus a single 1000-word line classified
    // `structural` and scored zero violations at the cap. The exemption a
    // task row earns is for THAT ROW, so only structural lines are skipped and
    // prose is capped wherever it sits.
    const cats = categorize(sub.body);
    let words = 0;
    for (let i = 0; i < sub.body.length; i++) {
      const n = countWords(sub.body[i]!);
      if (n === 0) continue;
      words += n;
      // A NARRATIVE body is graded WHOLE, exactly as before — the section
      // verdict stays load-bearing, and inverting the classifier still turns
      // this scanner red. A STRUCTURAL body is graded PER LINE: its task rows
      // are exempt, its prose is not. That is the smuggling fix — seven
      // checkbox rows plus a single very long line classified `structural` and
      // scored zero violations, because the shape of a body was taken as a
      // licence for its quantity.
      if (kind !== "narrative" && cats[i] !== "prose") continue;
      const running = (narrativeWords.get(sub.heading) ?? 0) + n;
      narrativeWords.set(sub.heading, running);
      if (!crossed.has(sub.heading) && running > PLAN_NARRATIVE_WORD_CAP) {
        crossed.add(sub.heading);
        violations.push({
          file: rel,
          line: sub.bodyLines[i]!,
          rule: "word_cap",
          section: sub.heading,
        });
      }
    }
    // Measurement stays PER OCCURRENCE — it answers "what is in the tree", so
    // a dogfood run can prove it was non-vacuous. GRADING is what accumulates.
    measured.push({ file: rel, section: sub.heading, line: sub.line, words, kind });
  }
  return { violations, measured };
}

function scanTree(projectRoot: string, classify: BodyClassifier): FileScan {
  const violations: PlanNarrativeViolation[] = [];
  const measured: MeasuredSubsection[] = [];
  for (const { abs, rel } of listActivePlans(projectRoot)) {
    const result = scanFile(abs, rel, classify);
    violations.push(...result.violations);
    measured.push(...result.measured);
  }
  return { violations, measured };
}

/** Over-cap NARRATIVE subsections of the ACTIVE plans, in file order. */
export function scanPlanNarrativeAltitude(
  projectRoot: string,
  classify: BodyClassifier = classifySectionBody,
): PlanNarrativeViolation[] {
  return scanTree(projectRoot, classify).violations;
}

/**
 * Every level-3 subsection of the ACTIVE plans, with its word count and its
 * kind. Measurement is unconditional — a structural subsection is exempt from
 * the cap, not invisible — so a dogfood run can assert it was non-vacuous.
 */
export function measurePlanSubsections(
  projectRoot: string,
  classify: BodyClassifier = classifySectionBody,
): MeasuredSubsection[] {
  return scanTree(projectRoot, classify).measured;
}

// Read-only CLI front door, the idiom `active_plan_ship_ready.ts` established.
// Probe #67's registration ORDERS a reader to call `scanPlanNarrativeAltitude`,
// and probe #81 grades such an order UNREACHABLE unless the module can in fact
// be run by hand. `skills/gate-check/SKILL.md` names the two sanctioned
// resolutions and rules the third out explicitly: give the module an
// ---------------------------------------------------------------------------
// THE GRANDFATHERING ARM — a cap that lands on prose nobody was warned about
// ---------------------------------------------------------------------------
//
// WHY THIS EXISTS, and why its absence was not merely a missing feature. A
// consumer upgrading the toolkit has ACTIVE plans written long before this cap
// was policy. Measured on a reproduction: two plans authored 2026-01-15
// against an epoch of 2026-09-01 both flagged at `error` — and one of them
// declared `kind: legacy`, which is the operator's documented, permanent,
// manual escape for exactly this, honoured by `plan_identity_mode_conditional`
// and the reason STE-443's accepted exposure is acceptable at all. This
// scanner graded straight through it. A consumer who applies the documented
// remedy and still gets a red gate has been told a lie by the tool; that is a
// different and worse thing than a cap with no epoch.
//
// THE EPOCH IS REUSED, NOT MINTED. `FR_WORD_CAP_EPOCH` is the ship date of the
// release that made the caps policy, and the plan cap shipped in the SAME
// milestone — so the date is identical and there is no second number to keep
// in sync. AC-STE-536.4's one-definition-per-budget rule stays satisfied.
//
// THE MECHANISM IS BORROWED FROM THE SIBLING; THE CONSTANTS ARE NOT. There is
// a strong pull toward calling `classifyPlanProvenance` in
// `plan_identity_mode_conditional.ts` wholesale — it already dates plans by git
// provenance and already honours the hatch. Do not. Its epochs are
// `MINT_EPOCH` and `JIRA_EPIC_EPOCH`, which date plan NAMING, and a word cap
// graded against a naming epoch is a wrong-subject pin that would read as
// working. A sibling's mechanism is a good prior; its constants are not.

/** What a plan's `word_cap` rows are worth, once git has been asked. */
export type PlanProvenanceVerdict = "fresh" | "legacy" | "undecidable";

/** The verdicts that spare a `word_cap` row outright, as data. */
const SILENT_PLAN_PROVENANCE: readonly PlanProvenanceVerdict[] = ["legacy"];

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
 * The OLDEST commit date that introduced `rel`, epoch millis, or `null`.
 *
 * Both canonical paths are asked and the older answer wins: `/spec-archive`
 * moves a plan into `specs/plan/archive/`, so a query blind to that would
 * re-date a reopened plan to its archive commit and fail it — the toolkit's
 * own housekeeping turning a legacy plan fresh.
 */
function planIntroducedAt(projectRoot: string, name: string): number | null {
  let oldest: number | null = null;
  for (const rel of [`specs/plan/${name}`, `specs/plan/archive/${name}`]) {
    const out = gitQuery(projectRoot, [
      "log", "--full-history", "--diff-filter=A", "--format=%aI", "--", rel,
    ]);
    for (const line of (out ?? "").split("\n")) {
      const t = Date.parse(line.trim());
      if (Number.isNaN(t)) continue;
      if (oldest === null || t < oldest) oldest = t;
    }
  }
  return oldest;
}

/**
 * One plan's provenance for `word_cap` purposes.
 *
 * ORDER IS LOAD-BEARING. The hatch is read first — it is declared by the
 * operator and outranks anything git says, which is what "permanent, manual
 * escape" means. Shallowness is asked BEFORE any date, because a truncated
 * store does not fail the date query: every path's first add is the graft
 * commit, so every legacy plan would read `fresh` and hard-fail in CI, where
 * `actions/checkout` defaults to `fetch-depth: 1`.
 */
export function classifyPlanNarrativeProvenance(
  projectRoot: string,
  name: string,
  epoch: string = FR_WORD_CAP_EPOCH,
): PlanProvenanceVerdict {
  let raw = "";
  try {
    raw = readFileSync(`${projectRoot}/specs/plan/${name}`, "utf-8");
  } catch {
    raw = "";
  }
  if (EXEMPT_PLAN_KINDS.includes(planKind(raw))) return "legacy";

  if (gitQuery(projectRoot, ["rev-parse", "--show-toplevel"]) === null) return "legacy";
  if ((gitQuery(projectRoot, ["rev-parse", "--is-shallow-repository"]) ?? "").trim() === "true") {
    return "undecidable";
  }

  // NEW WORK IS `fresh`, NOT `undecidable` — both siblings say so and this
  // module used to disagree with them. `classifyFrProvenance` and
  // `classifyPlanProvenance` both return `fresh` for a file git does not track
  // and for one staged but never committed; this returned `undecidable`,
  // because "no introducing commit" collapsed two different facts into one.
  //
  // The consequence was backwards. `undecidable` downgrades to `warning` while
  // `fresh` reports at `error`, so a plan the operator had just written — the
  // newest content in the tree, and precisely what a cap is for — escaped with
  // a warning, while an old committed plan got the error. Absence of history
  // because a file is NEW is not absence of history because it is SEVERED.
  const tracked = gitQuery(projectRoot, ["ls-files", "--", `specs/plan/${name}`]);
  if (tracked === null) return "undecidable"; // git refused to answer at all
  if (tracked.trim().length === 0) return "fresh"; // untracked: brand new
  if (gitQuery(projectRoot, ["cat-file", "-e", `HEAD:./specs/plan/${name}`]) === null) {
    return "fresh"; // tracked but absent from the tip: staged, never committed
  }

  const introducedAt = planIntroducedAt(projectRoot, name);
  if (introducedAt === null) return "undecidable";
  return introducedAt >= Date.parse(epoch) ? "fresh" : "legacy";
}

/** A graded plan-narrative row. */
export interface PlanNarrativeViolationRow extends PlanNarrativeViolation {
  severity: "error" | "warning";
}

export interface PlanNarrativeAltitudeReport {
  violations: PlanNarrativeViolationRow[];
  /** Plans whose rows were spared — named, never silently dropped. */
  grandfathered: string[];
  /** The spared count in the SAME unit `violations` uses: rows, not files. */
  grandfatheredRows: number;
  vacuous: boolean;
}

/**
 * Probe #67's PLAN half with the epoch arm layered over the pure scanner.
 *
 * `legacy` (pre-epoch, an exempt `kind:`, or not a git tree) drops the row and
 * names the file; `undecidable` (severed or shallow history) downgrades to
 * `warning`, because an operator whose object store is truncated cannot fix
 * that by rewriting a subsection; `fresh` stays `error`.
 */
export function runPlanNarrativeAltitudeProbe(
  projectRoot: string,
  classify: BodyClassifier = classifySectionBody,
): PlanNarrativeAltitudeReport {
  const { violations: raw, measured } = scanTree(projectRoot, classify);
  const cache = new Map<string, PlanProvenanceVerdict>();
  const provenanceOf = (rel: string): PlanProvenanceVerdict => {
    const name = rel.split("/").pop() ?? rel;
    const hit = cache.get(name);
    if (hit !== undefined) return hit;
    const answer = classifyPlanNarrativeProvenance(projectRoot, name);
    cache.set(name, answer);
    return answer;
  };

  const violations: PlanNarrativeViolationRow[] = [];
  const grandfathered: string[] = [];
  let grandfatheredRows = 0;
  for (const v of raw) {
    const provenance = provenanceOf(v.file);
    if (SILENT_PLAN_PROVENANCE.includes(provenance)) {
      if (!grandfathered.includes(v.file)) grandfathered.push(v.file);
      grandfatheredRows += 1;
      continue;
    }
    violations.push({ ...v, severity: provenance === "undecidable" ? "warning" : "error" });
  }
  return { violations, grandfathered, grandfatheredRows, vacuous: measured.length === 0 };
}

// `import.meta.main` entry, or word the registration so it orders nothing —
// raising the pin to admit one more order nobody can carry out is the drift
// the pin exists to catch. This is the first resolution. Imported by the probe
// and by tests, `import.meta.main` is false and this block never runs, so the
// module stays side-effect-free at import. Prints `file:line — rule — section`
// per violation; empty stdout means the ACTIVE plans are clean.
if (import.meta.main) {
  // THE GRADED ENTRY, matching the FR scanner and the registration. Calling the
  // raw scanner here skipped the grandfathering arm, so a consumer's pre-epoch
  // plans printed as violations through the one door they are most likely to
  // use by hand.
  const projectRoot = process.argv[2] ?? process.cwd();
  const report = runPlanNarrativeAltitudeProbe(projectRoot);
  for (const v of report.violations) {
    console.log(`${v.file}:${v.line} — ${v.rule} — ${v.section} — ${v.severity}`);
  }
  if (report.grandfathered.length > 0) {
    console.log(
      `grandfathered: ${report.grandfatheredRows} row(s) across ` +
        `${report.grandfathered.length} pre-epoch plan(s) — spared, not silenced`,
    );
  }
}
