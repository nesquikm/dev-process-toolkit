// guessed_tracker_id_scan — STE-122 post-write scanner.
//
// /spec-write calls `scanGuessedTrackerIdLiterals([frFile, requirementsMd])`
// after writing AC content. Any literal `AC-<digit>.<N>` token (the
// pre-substitution placeholder shape) outside fenced/indented/inline-backtick
// code surfaces as a violation; /spec-write refuses with NFR-10 canonical
// shape rather than committing the malformed file.
//
// Probe-15 (`guessed_tracker_id`) at /gate-check time is the safety net for
// any path that bypasses /spec-write (manual edits, copy-paste).

import { readFileSync } from "node:fs";

const FENCED_FENCE = /^```/;
const INDENTED_FENCE = /^    /;
// Bare-digit milestone-numbered shape only. Letters in the prefix segment
// (e.g. `AC-STE-1.1` or `AC-VDTAF4.1`) are canonical and excluded by `\b\d+`.
const GUESSED_AC = /\bAC-\d+\.\d+\b/g;

export interface GuessedTrackerIdViolation {
  file: string;
  line: number;
  column: number;
  match: string;
  message: string;
}

/**
 * Scan `files` for literal `AC-<digit>.<N>` placeholders that survived
 * /spec-write's substitution pass. Returns the empty array on a clean file.
 *
 * Exemptions (AC-STE-122.4): lines inside triple-backtick fenced blocks,
 * lines beginning with 4 spaces, and inline-backtick spans. Pathological
 * markdown (mismatched fences) is out of scope — the scope is /spec-write
 * outputs which the toolkit controls.
 */
export function scanGuessedTrackerIdLiterals(files: string[]): GuessedTrackerIdViolation[] {
  const violations: GuessedTrackerIdViolation[] = [];
  for (const file of files) {
    let content: string;
    try {
      content = readFileSync(file, "utf-8");
    } catch {
      continue;
    }
    const lines = content.split("\n");
    let inFence = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      if (FENCED_FENCE.test(line)) {
        inFence = !inFence;
        continue;
      }
      if (inFence || INDENTED_FENCE.test(line)) continue;
      // Strip inline backticks (single-line code spans) so `AC-1.1`
      // round-trips clean. Replace with spaces to preserve column positions
      // for any bare match that sits after the span on the same line.
      const stripped = line.replace(/`[^`]*`/g, (m) => " ".repeat(m.length));
      const re = new RegExp(GUESSED_AC.source, "g");
      let m: RegExpExecArray | null;
      while ((m = re.exec(stripped)) !== null) {
        const col = m.index + 1;
        violations.push({
          file,
          line: i + 1,
          column: col,
          match: m[0]!,
          message: [
            `guessed_tracker_id: literal ${m[0]} at ${file}:${i + 1}:${col}`,
            `Remedy: substitute <tracker-id> via acPrefix(spec) from adapters/_shared/src/ac_prefix.ts and retry`,
            `Context: file=${file}, line=${i + 1}, column=${col}, match=${m[0]}`,
          ].join("\n"),
        });
      }
    }
  }
  return violations;
}
