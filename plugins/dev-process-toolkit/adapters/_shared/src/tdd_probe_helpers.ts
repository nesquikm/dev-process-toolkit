// tdd_probe_helpers — STE-296 refactor. Shared low-level helpers for
// the two TDD-stage /gate-check probes:
//   - `tdd_orchestrator_integrity.ts` (STE-225, the 3-stage TDD trio)
//   - `tdd_spec_reviewer_invariants.ts` (STE-296, the AUDIT stage)
//
// Each probe enforces its own load-bearing invariants (different files,
// different field sets, different remedy text). The helpers here are
// schema-agnostic primitives both probes need:
//   - parse frontmatter into a flat `Record<string, string>`
//   - locate the 1-based line number of a frontmatter key
//   - split a comma-separated tools list into trimmed non-empty tokens
//   - push a canonical `IntegrityViolation` (with formatted message)
//
// Frontmatter regex is intentionally shared so behavior tracks 1:1
// across probes; per-probe `buildMessage` lives next to the call site
// to keep remedy text discoverable from the probe file.

import { relative } from "node:path";

export type Severity = "error";

export interface IntegrityViolation {
  file: string;
  line: number;
  reason: string;
  note: string;
  message: string;
  severity: Severity;
}

export interface IntegrityReport {
  violations: IntegrityViolation[];
  vacuous: boolean;
}

export const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---/;

export function parseFrontmatterFields(body: string): Record<string, string> {
  const m = FRONTMATTER_RE.exec(body);
  if (!m) return {};
  const out: Record<string, string> = {};
  for (const line of m[1]!.split("\n")) {
    const c = line.indexOf(":");
    if (c < 0) continue;
    const k = line.slice(0, c).trim();
    const v = line.slice(c + 1).trim();
    if (k.length > 0) out[k] = v;
  }
  return out;
}

export function lineNumberOfKey(body: string, key: string): number {
  const m = FRONTMATTER_RE.exec(body);
  if (!m) return 1;
  const lines = m[1]!.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.split(":")[0]!.trim() === key) return i + 2; // +1 for `---` line, +1 for 1-based
  }
  return 1;
}

export function splitToolsList(value: string): string[] {
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}

/**
 * Append a canonical IntegrityViolation. The caller supplies a
 * `messageBuilder` that wraps the per-probe remedy/context prose
 * around the `note` body so each probe owns its diagnostic text.
 */
export function pushViolation(
  out: IntegrityViolation[],
  projectRoot: string,
  absFile: string,
  line: number,
  reason: string,
  messageBuilder: (note: string, relPath: string) => string,
): void {
  const rel = relative(projectRoot, absFile);
  const note = `${rel}:${line} — ${reason}`;
  out.push({
    file: absFile,
    line,
    reason,
    note,
    message: messageBuilder(note, rel),
    severity: "error",
  });
}
