// report_issue_verify_evidence — STE-374 AC-STE-374.3.
//
// Selecting the incident's session (see `report_issue_session_select.ts`) is
// only half the reliability story: even the marker-matched pick can be a
// false positive, and the mtime fallback can grab a transcript that never
// witnessed the incident at all. Before /report-issue uploads the payload,
// `verifyIncidentEvidence` GREPS the captured transcript for the incident
// markers — the offending fork/skill output name(s) plus the narrative's key
// symptom markers — and records whether the evidence is actually present.
//
// The result is advisory: it feeds the `verification` block in metadata.json
// (searched / found / markers) and the severity-cap rule, but never blocks the
// publish. A `found: false` on a high/critical report is exactly the signal
// the maintainer wants — a report whose own transcript does not corroborate it.
//
// Reads are defensive — a null path or an unreadable/absent file is reported
// as `searched: false` rather than fatal, mirroring the non-fatal read idiom
// in the sibling selection helper.

import { readFileSync } from "node:fs";

export interface IncidentEvidence {
  /** `true` when the transcript was readable and the grep actually ran. */
  searched: boolean;
  /** `true` iff >= 1 marker (substring UNION) appears in the transcript. */
  found: boolean;
  /** The searched marker list, echoed verbatim. */
  markers: string[];
}

/**
 * Grep the captured transcript at `transcriptPath` for the incident `markers`.
 *
 * When `transcriptPath` is `null` or the file is unreadable (nonexistent /
 * read throws), the search cannot run → `{ searched: false, found: false,
 * markers }`. When the file is readable, `searched` is `true` and `found` is
 * `true` iff at least one marker appears as a substring of the content (a
 * multi-marker UNION — any match wins; an empty marker list can never match).
 * `markers` always echoes the input list verbatim.
 */
export function verifyIncidentEvidence(
  transcriptPath: string | null,
  markers: string[],
): IncidentEvidence {
  if (transcriptPath === null) {
    return { searched: false, found: false, markers };
  }

  let content: string;
  try {
    content = readFileSync(transcriptPath, "utf-8");
  } catch {
    // Unreadable / absent transcript ⇒ the grep never ran.
    return { searched: false, found: false, markers };
  }

  const found = markers.some((marker) => content.includes(marker));
  return { searched: true, found, markers };
}
