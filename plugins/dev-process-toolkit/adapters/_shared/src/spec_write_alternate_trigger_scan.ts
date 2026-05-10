// spec_write_alternate_trigger_scan (STE-262 AC-STE-262.4) — /gate-check
// probe `spec_write_marker_alternate_trigger_scan`. Severity: error.
//
// Globs ONLY `plugins/dev-process-toolkit/skills/spec-write/SKILL.md`
// (single-file scope; the regression is uniquely /spec-write's marker
// gate) and scans for six literal forbidden phrases that paraphrase the
// STE-226 marker contract into an alternate trigger which would license
// auto-apply on the marker-absent + non-tty path.
//
// Sibling to STE-226's `auto_approve_marker.ts` (heredoc spawn marker
// presence) and STE-270's `spec_write_first_turn_drift_scan.ts` (first-
// turn contract drift). Same shape: literal substring match, no regex;
// per-occurrence violation row carrying `file:line:column` + matched
// phrase + remedy; NFR-10 canonical message.
//
// Negation-context carve-outs. AC-STE-262.2 mandates a literal contract
// sentence at both gate sites that itself quotes some of the forbidden
// phrases (negation form, e.g., "no autonomous-mode reminder ...
// influences the auto-apply branch"). AC-STE-262.7 then requires zero
// violations on the post-sweep file. To satisfy both ACs literally,
// each scanned line is skipped when it carries any of four explicit
// negation/historical signatures:
//
//   1. `single deterministic` — canonical contract anchor (only appears
//      in the AC-STE-262.2 contract sentence at gate sites)
//   2. `are removed` / `is removed` — legacy-removal historical reference
//   3. `regardless of` — disclaimer phrasing
//   4. `NOT acceptable` — explicit forbidden-trigger marker (used by
//      STE-270's hardening clause at /spec-write SKILL.md line 12)
//
// The carve-outs are byte-checkable strings, not heuristics. Future
// SKILL.md drift back into POSITIVE alternate-trigger language (e.g.,
// "Auto Mode triggers default-apply") still fires because none of the
// signatures match positive-trigger prose.

import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

export type Severity = "error" | "warning";

export interface SpecWriteAlternateTriggerViolation {
  file: string;
  line: number;
  column: number;
  reason: string;
  note: string;
  message: string;
  severity: Severity;
  matchedPhrase: string;
}

export interface SpecWriteAlternateTriggerReport {
  violations: SpecWriteAlternateTriggerViolation[];
}

// Forbidden alternate-trigger paraphrases of the STE-226 marker contract.
// Literal substring match — no regex — so future SKILL.md copy edits
// don't accidentally regress detection. Each phrase encodes a distinct
// LLM-imputed alternate-trigger path that prior smoke runs surfaced.
export const FORBIDDEN_PHRASES = [
  "Auto Mode",
  "work without stopping",
  "imputed approval",
  "autonomous-mode reminder",
  "inferred approval",
  "non-interactive inference",
] as const;

// Negation/historical-context carve-out signatures. A line containing
// any of these is excluded from the scan — the forbidden phrase appears
// in legitimate negation, legacy-removal, or canonical-contract-sentence
// context, not as a positive alternate trigger.
const NEGATION_SIGNATURES = [
  "single deterministic",
  "are removed",
  "is removed",
  "regardless of",
  "NOT acceptable",
] as const;

const REMEDY =
  "rephrase to make 'marker is the single deterministic mechanism' " +
  "explicit (sibling phrasing already present at /spec-write SKILL.md " +
  "§ 4); negation/historical references can use one of the canonical " +
  "carve-out signatures (`is removed`, `regardless of`, `NOT acceptable`, " +
  "`single deterministic`) to keep the probe quiet.";

function buildMessage(
  file: string,
  line: number,
  column: number,
  phrase: string,
): string {
  return [
    `spec_write_marker_alternate_trigger_scan: ${file}:${line}:${column} — ` +
      `forbidden alternate-trigger phrase ${JSON.stringify(phrase)} present ` +
      `outside negation/historical context.`,
    `Remedy: ${REMEDY}`,
    `Context: file=${file}, probe=spec_write_marker_alternate_trigger_scan, severity=error`,
  ].join("\n");
}

function isNegationContextLine(line: string): boolean {
  for (const sig of NEGATION_SIGNATURES) {
    if (line.includes(sig)) return true;
  }
  return false;
}

function scanSpecWriteSkill(
  absPath: string,
  projectRoot: string,
): SpecWriteAlternateTriggerViolation[] {
  if (!existsSync(absPath)) return [];
  let content: string;
  try {
    content = readFileSync(absPath, "utf-8");
  } catch {
    return [];
  }
  const rel = relative(projectRoot, absPath);
  const violations: SpecWriteAlternateTriggerViolation[] = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const lineText = lines[i]!;
    if (isNegationContextLine(lineText)) continue;
    for (const phrase of FORBIDDEN_PHRASES) {
      const idx = lineText.indexOf(phrase);
      if (idx === -1) continue;
      const lineNo = i + 1;
      const column = idx + 1;
      const reason =
        `forbidden alternate-trigger phrase ${JSON.stringify(phrase)} present ` +
        `outside negation/historical context`;
      violations.push({
        file: absPath,
        line: lineNo,
        column,
        reason,
        note: `${rel}:${lineNo}:${column} — ${reason}`,
        message: buildMessage(rel, lineNo, column, phrase),
        severity: "error",
        matchedPhrase: phrase,
      });
    }
  }
  return violations;
}

export async function runSpecWriteAlternateTriggerScanProbe(
  projectRoot: string,
): Promise<SpecWriteAlternateTriggerReport> {
  const target = join(
    projectRoot,
    "plugins",
    "dev-process-toolkit",
    "skills",
    "spec-write",
    "SKILL.md",
  );
  const violations = scanSpecWriteSkill(target, projectRoot);
  return { violations };
}
