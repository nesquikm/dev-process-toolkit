// external_link_verdicts — the /gate-check probe that GRADES the external-link
// verdicts STE-542 recorded into the spec tree.
//
// STE-542 writes rows; this reads them back. The walk is
// `scanExternalReferences` (adapters/_shared/src/scan_design_references.ts) —
// the SAME parser the recorder's `formatExternalReferenceLine` round-trips
// against, never a reader-side copy: producer/consumer asymmetry has shipped
// in this repository three times.
//
// PURE. File reads only: no network, no `fetch`, no sockets, no child
// processes and no git. That purity is load-bearing — it is what lets probes
// #68 (`migration_coverage`) and #69 (`upgrade_staleness`) keep saying
// "no git, no network" with no edit. Liveness was already measured at
// authoring time by `/spec-write`; this probe only grades what is on disk.
//
// CLASSIFICATION IS THE SECTION, not a token on the row.
// `recordExternalReferences` routes REQUIRED links to `## Design References`
// and INFORMATIONAL ones to `## External References`, and the emitted line
// carries no classification word. So `section: "design"` ⇒ required (a bad
// verdict GATE FAILEDs) and `section: "external"` ⇒ informational (a bad
// verdict is a note).
//
// `now` is INJECTED. A probe that grades a hard-coded `checked_at` against the
// wall clock passes today and rots silently.
//
// CLI: `bun run external_link_verdicts.ts <projectRoot>` prints the notes and
// the violation messages; exit 1 when the gate failed.

import {
  type ExternalReferenceRow,
  scanExternalReferences,
} from "./scan_design_references";

export const PROBE_ID = "external_link_verdicts";

/**
 * How old a recorded `(checked …)` verdict may be and still be graded.
 * A record OLDER than this is stale: it is reported as a note and never as a
 * gate failure, because an aged measurement is not evidence about today.
 *
 * (The FR's Technical Design homes this constant in an
 * `external_link_record.ts` that does not exist — STE-542 shipped the parser
 * inside `scan_design_references.ts` and no TTL at all. AC-STE-543.4 requires
 * only that the threshold be EXPORTED, so it lives here with its grader.)
 */
export const EXTERNAL_LINK_TTL_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Which section an entry was authored under, in gate-verdict terms. */
export type LinkClassification = "required" | "informational";

/** One graded outcome: a rule that fires makes the row a GATE FAILURE. */
export interface VerdictRule {
  /** Stable id — the mutation handle AC-STE-543.6 removes. */
  id: string;
  /** Only rows of this classification are candidates. */
  classification: LinkClassification;
  /** Short phrase naming WHY, distinct per rule. */
  reason: string;
  /**
   * One sentence naming WHAT WAS OBSERVED, distinct per rule.
   *
   * This is the field that keeps a dead link and an unrecorded link from
   * collapsing into one generic message: a dead row WAS checked and the check
   * answered badly, while an unrecorded row was NEVER CHECKED AT ALL. A
   * shared string would report the second as if it were the first.
   */
  detail: string;
  /** The one-line fix. */
  remedy: string;
  /** True when this rule condemns the row. */
  matches(row: ExternalReferenceRow): boolean;
}

/**
 * The rule table. Only REQUIRED rows can fail the gate; informational rows
 * with the same defect surface as notes (handled below, off the table, so
 * mutating the table cannot silently retitle an informational note).
 */
export const VERDICT_RULES: readonly VerdictRule[] = [
  {
    id: "dead-required",
    classification: "required",
    reason: "required external link recorded dead",
    detail:
      "the liveness check RAN and answered `dead` — the URL was reachable " +
      "at authoring time and is not now.",
    remedy:
      "restore the link (or replace it with a live URL) and re-run " +
      "`/spec-write` so the row is re-checked; demote it to " +
      "`## External References` if it is only informational",
    matches: (row) => row.verdict === "dead",
  },
  {
    id: "unrecorded-required",
    classification: "required",
    reason: "required external link has no recorded liveness record",
    detail:
      "the liveness check never ran for this link — the row carries no " +
      "`(checked <ISO>: <verdict>)` tail, so nothing on disk says whether the " +
      "URL resolves. An unmeasured required link is a gate failure, not a " +
      "pass by default.",
    remedy:
      "re-run the authoring check so the row gains a `(checked <ISO>: " +
      "<verdict>)` tail, or move the link to `## External References`",
    matches: (row) => row.verdict === null,
  },
] as const;

export interface ExternalLinkVerdictViolation {
  file: string;
  line: number;
  severity: "error";
  reason: string;
  /** `file:line — reason`, per STE-82. */
  note: string;
  /** NFR-10 canonical multi-line shape. */
  message: string;
}

export interface ExternalLinkVerdictsReport {
  violations: ExternalLinkVerdictViolation[];
  notes: string[];
  vacuous: boolean;
}

/**
 * The STE-82 note shape — `file:line — reason: url` — built in ONE place.
 * Both the violation path and the notes path render through it, so the two
 * cannot drift apart into two spellings of the same line.
 */
const note = (row: ExternalReferenceRow, reason: string): string =>
  `${row.file}:${row.line} — ${reason}: ${row.url}`;

/** The NFR-10 canonical rendering — one per row, never one shared string. */
function makeViolation(
  row: ExternalReferenceRow,
  rule: VerdictRule,
): ExternalLinkVerdictViolation {
  // `headline` is the rule's phrase WITH the offending URL appended; the
  // `reason` FIELD stays the bare phrase, which is what AC-STE-543.3 compares
  // across two rules to prove they are distinct. Naming them apart keeps that
  // difference visible.
  const headline = `${rule.reason}: ${row.url}`;
  return {
    file: row.file,
    line: row.line,
    severity: "error",
    reason: rule.reason,
    note: note(row, rule.reason),
    message: [
      // `rule.detail` rides the VERDICT line rather than a `Detail:` sub-line
      // of its own. NFR-10 (specs/requirements.md) defines exactly three
      // parts — a one-line verdict, `Remedy:` and `Context:` — and a fourth
      // sub-line would be a silent local extension of a canonical shape the
      // whole toolkit shares. The distinguishing text AC-STE-543.3 needs is
      // preserved verbatim; only its position changed.
      `${PROBE_ID}: ${headline} — ${rule.detail}`,
      `Remedy: ${rule.remedy}`,
      `Context: file=${row.file}, line=${row.line}, url=${row.url}, ` +
        `rule=${rule.id}, probe=${PROBE_ID}`,
    ].join("\n"),
  };
}

/** Age of the record in days, or `null` when there is no parsable timestamp. */
function ageInDays(row: ExternalReferenceRow, now: Date): number | null {
  if (row.checkedAt === null) return null;
  const at = Date.parse(row.checkedAt);
  if (Number.isNaN(at)) return null;
  return (now.getTime() - at) / DAY_MS;
}

/**
 * Grade every recorded external-link verdict in the spec tree.
 *
 * `rules` is defaulted LAST, mirroring
 * `runUpgradeStalenessProbe(projectRoot, registry)`.
 */
export function runExternalLinkVerdictsProbe(
  projectRoot: string,
  now: Date = new Date(),
  rules: readonly VerdictRule[] = VERDICT_RULES,
): ExternalLinkVerdictsReport {
  const rows = scanExternalReferences(projectRoot);
  const violations: ExternalLinkVerdictViolation[] = [];
  const notes: string[] = [];

  for (const row of rows) {
    const classification: LinkClassification =
      row.section === "design" ? "required" : "informational";

    // STALENESS OUTRANKS CLASSIFICATION: an aged measurement is reported, not
    // enforced, whichever section it sits in.
    const age = ageInDays(row, now);
    if (age !== null && age > EXTERNAL_LINK_TTL_DAYS) {
      notes.push(
        note(
          row,
          `stale external-link record (checked ${row.checkedAt}, older than ` +
            `${EXTERNAL_LINK_TTL_DAYS} days)`,
        ),
      );
      continue;
    }

    const rule = rules.find(
      (r) => r.classification === classification && r.matches(row),
    );
    if (rule !== undefined) {
      violations.push(makeViolation(row, rule));
      continue;
    }

    // Nothing to enforce. An informational row with the same defect — and a
    // required row whose condemning rule was mutated away — is a note.
    if (row.verdict === "dead") {
      notes.push(note(row, "informational external link recorded dead"));
    } else if (row.verdict === "unchecked") {
      notes.push(note(row, "external link could not be checked"));
    } else if (row.verdict === null) {
      notes.push(note(row, "external link has no recorded liveness record"));
    }
  }

  return {
    violations,
    notes,
    // VACUOUS is a MEASURED state: no reference section anywhere in the spec
    // tree carried a URL row, so the probe graded nothing.
    vacuous: rows.length === 0,
  };
}

// Read-only CLI front door. Imported by tests and by /gate-check, where
// `import.meta.main` is false and this block never runs — the module stays
// side-effect free at import. Its presence is also load-bearing: a probe
// registration whose module has no front door turns probe #81 red.
if (import.meta.main) {
  // `||`, not `??`: `??` substitutes only on null/undefined, so `bun run
  // external_link_verdicts.ts ""` would pass an empty string straight through
  // as the project root and resolve every spec path against "". The sibling
  // shim in check_external_link.ts rejects an empty argv entry explicitly;
  // this one falls back, which is the same decision reached two ways.
  const projectRoot = process.argv[2] || process.cwd();
  const report = runExternalLinkVerdictsProbe(projectRoot);
  if (report.notes.length > 0) console.log(report.notes.join("\n"));
  if (report.violations.length > 0) {
    console.log(report.violations.map((v) => v.message).join("\n\n"));
    process.exit(1);
  }
}
