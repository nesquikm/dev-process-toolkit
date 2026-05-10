// spec_write_first_turn_drift_scan (STE-270 AC-STE-270.2) — /gate-check
// probe `spec_write_first_turn_drift_scan`. Severity: error.
//
// Globs ONLY `plugins/dev-process-toolkit/skills/spec-write/SKILL.md`
// (single-file scope; the regression is uniquely `/spec-write`'s, not a
// cross-skill issue) and scans the file for literal forbidden phrases
// that paraphrase the Pattern-26 first-turn contract into an alternate
// trigger which would license skipping `AskUserQuestion` under non-tty
// stdin. Each occurrence surfaces as a per-line violation row carrying
// `file:line:column` + the matched phrase + a remedy.
//
// Sibling to STE-262's `spec_write_alternate_trigger_scan.ts`
// (marker-trigger paraphrases) and STE-226's `auto_approve_marker.ts`
// (heredoc spawn marker presence). Same shape: literal substring match,
// no regex; one violation per occurrence; NFR-10 canonical message.

import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

export type Severity = "error" | "warning";

export interface SpecWriteFirstTurnDriftViolation {
  file: string;
  line: number;
  column: number;
  reason: string;
  note: string;
  message: string;
  severity: Severity;
  matchedPhrase: string;
}

export interface SpecWriteFirstTurnDriftReport {
  violations: SpecWriteFirstTurnDriftViolation[];
}

// Forbidden alternate-trigger paraphrases. Literal substring match — no
// regex — so future SKILL.md copy edits don't accidentally fail the
// probe. Each phrase encodes a distinct LLM-imputed carve-out path that
// /conformance-loop iter-1 (2026-05-10) and prior magpie incidents
// surfaced; rephrase the surrounding prose to make the canonical mandate
// explicit rather than inferring permission from any of these triggers.
export const FORBIDDEN_FIRST_TURN_DRIFT_PHRASES = [
  "pre-baked args allow",
  "verbose <command-args> permits",
  "autonomous-mode permits skip",
  "marker absence implies",
  "first AskUserQuestion may be deferred",
  "Socratic loop is optional under",
] as const;

const REMEDY =
  "rephrase to make 'first tool call under non-tty MUST be " +
  "AskUserQuestion or RequiresInputRefusedError; pre-baked args + " +
  "autonomous-mode reminder + marker absence do not waive this' " +
  "explicit.";

function buildMessage(
  file: string,
  line: number,
  column: number,
  phrase: string,
): string {
  return [
    `spec_write_first_turn_drift_scan: ${file}:${line}:${column} — ` +
      `forbidden first-turn-drift phrase ${JSON.stringify(phrase)} present.`,
    `Remedy: ${REMEDY}`,
    `Context: file=${file}, probe=spec_write_first_turn_drift_scan, severity=error`,
  ].join("\n");
}

function scanSpecWriteSkill(
  absPath: string,
  projectRoot: string,
): SpecWriteFirstTurnDriftViolation[] {
  if (!existsSync(absPath)) return [];
  let content: string;
  try {
    content = readFileSync(absPath, "utf-8");
  } catch {
    return [];
  }
  const rel = relative(projectRoot, absPath);
  const violations: SpecWriteFirstTurnDriftViolation[] = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const lineText = lines[i]!;
    for (const phrase of FORBIDDEN_FIRST_TURN_DRIFT_PHRASES) {
      const idx = lineText.indexOf(phrase);
      if (idx === -1) continue;
      const lineNo = i + 1;
      const column = idx + 1;
      const reason =
        `forbidden first-turn-drift phrase ${JSON.stringify(phrase)} present`;
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

export async function runSpecWriteFirstTurnDriftScanProbe(
  projectRoot: string,
): Promise<SpecWriteFirstTurnDriftReport> {
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
