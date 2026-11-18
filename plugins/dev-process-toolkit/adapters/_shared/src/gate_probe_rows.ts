// gate_probe_rows (STE-756) — the one row grammar for /gate-check probe rows.
//
//   probe #<N> <probe-id>: <verdict> (<count>)
//
// `gate_probe_runner.ts` renders rows with it; nothing else defines the shape.

/** Every verdict a row may carry: the row grammar and the `probe-row` assertion read this one list. */
export const PROBE_VERDICTS = ["pass", "notes", "fail", "vacuous"] as const;
export type ProbeVerdict = (typeof PROBE_VERDICTS)[number];
export type ProbeSeverity = "error" | "warning" | "note";

export interface ProbeRow {
  n: number;
  id: string;
  verdict: ProbeVerdict;
  count: number;
  /** Set on a probe that threw: the row reads `fail (error: <message>)`. */
  error?: string;
}

export function renderProbeRow(row: ProbeRow): string {
  const tail = row.error !== undefined ? `error: ${row.error}` : String(row.count);
  return `probe #${row.n} ${row.id}: ${row.verdict} (${tail})`;
}

const ROW_RE = new RegExp(`^probe #(\\d+) ([A-Za-z0-9_-]+): (${PROBE_VERDICTS.join("|")}) \\((?:(\\d+)|error: (.*))\\)$`);

/** Every line of `text` that is a row in the grammar, in order; nothing else. */
export function parseProbeRows(text: string): ProbeRow[] {
  const rows: ProbeRow[] = [];
  for (const raw of text.split("\n")) {
    const m = ROW_RE.exec(raw.trim());
    if (!m) continue;
    const verdict = m[3] as ProbeVerdict;
    if (m[5] !== undefined) {
      if (verdict !== "fail") continue;
      rows.push({ n: Number(m[1]), id: m[2]!, verdict, count: 0, error: m[5] });
    } else {
      rows.push({ n: Number(m[1]), id: m[2]!, verdict, count: Number(m[4]) });
    }
  }
  return rows;
}

/** What a probe's own report says, read off it by the runner. */
export interface ProbeOutcomeInput {
  count: number;
  vacuous: boolean;
  severity: ProbeSeverity;
  reportSeverity?: string;
  /**
   * The `severity` each violation carries, in order, `undefined` where a
   * violation carries none. When at least one carries its own, the row is
   * decided per violation: `fail` if any is `error`, `notes` otherwise.
   */
  violationSeverities?: (string | undefined)[];
  /** How many entries the report's `notes` and `warnings` lists hold together. */
  notesCount?: number;
  /**
   * The probe's runner entry declares that its notes explain its own vacuity
   * (#62): a vacuous report with notes stays `vacuous` instead of `notes`.
   */
  vacuityNotes?: boolean;
}

/** A derived row's verdict and the count it prints. */
export interface ProbeOutcome {
  verdict: ProbeVerdict;
  count: number;
}

/**
 * The verdict is derived from the report, never chosen.
 *
 * - Zero violations: `notes (<n>)` when the report's `notes` or `warnings`
 *   lists hold n entries, because a note never escalates and never vanishes
 *   into `pass` -- a vacuous report included, unless the entry declares
 *   `vacuityNotes` (its notes explain the vacuity), which stays `vacuous`;
 *   otherwise `vacuous` when the report says so, `pass` when it does not.
 * - Violations that carry their own `severity`: `fail` when any of them is
 *   neither `warning` nor `note` -- `error` or an unknown severity (one
 *   without its own falls back to the report's, then the declared one),
 *   `notes` otherwise.
 * - Violations that carry none: the report's `severity`, else the declared one,
 *   with the same rule: `notes` for `warning` or `note`, `fail` for anything else.
 */
export function deriveProbeOutcome(input: ProbeOutcomeInput): ProbeOutcome {
  const fallback = (input.reportSeverity ?? input.severity).toLowerCase();
  if (input.count === 0) {
    const notes = input.notesCount ?? 0;
    if (input.vacuous && (notes === 0 || input.vacuityNotes === true)) return { verdict: "vacuous", count: 0 };
    if (notes > 0) return { verdict: "notes", count: notes };
    return { verdict: "pass", count: 0 };
  }
  const own = input.violationSeverities ?? [];
  if (own.some((s) => s !== undefined)) {
    const anyFailing = own.some((s) => {
      const sev = (s ?? fallback).toLowerCase();
      return sev !== "warning" && sev !== "note";
    });
    return { verdict: anyFailing ? "fail" : "notes", count: input.count };
  }
  return { verdict: fallback === "warning" || fallback === "note" ? "notes" : "fail", count: input.count };
}

/** The verdict half of `deriveProbeOutcome`. */
export function deriveVerdict(input: ProbeOutcomeInput): ProbeVerdict {
  return deriveProbeOutcome(input).verdict;
}
