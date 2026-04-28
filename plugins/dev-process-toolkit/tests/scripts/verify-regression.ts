// Schema L probe (canonical Tracker Mode Probe; see `docs/patterns.md`).
//
// `tests/scripts/verify-regression.test.ts` imports `runSchemaLProbe` and
// runs it against fixture CLAUDE.md files; that test exercises the active
// Schema L invariants used at runtime by every mode-aware skill.
//
// Pre-M18 Schema M support (the v2-minimal fixture, the byte-diff snapshot
// loop, the `if (import.meta.main)` script-mode block) was removed in M39
// STE-141 — the probes asserted retired invariants and had zero `bun test`
// consumers.

import { existsSync, readFileSync } from "node:fs";

/**
 * Canonical Schema L probe (docs/patterns.md § Tracker Mode Probe).
 *
 * Returns:
 *   - "none"        — CLAUDE.md absent OR zero `^## Task Tracking$` lines.
 *   - "malformed"   — more than one `^## Task Tracking$` line (NFR-10).
 *   - tracker mode  — parsed `mode: <value>` under the single heading.
 *
 * Implementation mirrors the literal grep: only lines whose entire content
 * equals "## Task Tracking" count. The probe does NOT read the section
 * body unless exactly one anchor is present, matching the canonical form.
 */
export type SchemaLResult =
  | { mode: "none" }
  | { mode: "malformed"; count: number }
  | { mode: string };

export function runSchemaLProbe(claudeMdPath: string): SchemaLResult {
  if (!existsSync(claudeMdPath)) return { mode: "none" };
  const body = readFileSync(claudeMdPath, "utf8");
  let anchorCount = 0;
  const lines = body.split("\n");
  for (const line of lines) {
    if (line === "## Task Tracking") anchorCount++;
  }
  if (anchorCount === 0) return { mode: "none" };
  if (anchorCount > 1) return { mode: "malformed", count: anchorCount };

  // Exactly one anchor — extract `mode: <value>` from the section body.
  // Mirrors Schema L step 3: scan forward from the anchor, stop at the
  // next `## ` or `### ` heading, or at EOF.
  let inSection = false;
  for (const line of lines) {
    if (line === "## Task Tracking") {
      inSection = true;
      continue;
    }
    if (!inSection) continue;
    if (line.startsWith("## ") || line.startsWith("### ")) break;
    const m = /^mode:\s*(\S+)\s*$/.exec(line);
    if (m && m[1] !== undefined) return { mode: m[1] };
  }
  // Anchor present but no `mode:` key found — treat as malformed per Schema L.
  return { mode: "malformed", count: 1 };
}
