// deps_research_result_shape (STE-373 AC-STE-373.1) — /gate-check probe
// `deps_research_result_shape`. Severity: error. Probe #64.
//
// Structural clone of `spec_research_result_shape.ts` (probe #41), but the
// per-block shape validation is delegated to the EXISTING deterministic
// parser `parseDepsResearchBlock` (deps_research_result.ts) instead of a
// re-implemented line-by-line scan. When a parent skill (`/brainstorm` or
// `/spec-write`) invokes the `/dev-process-toolkit:deps-research` forked
// skill, it MAY persist the most recent subagent output for inspection.
// This probe walks those recorded result blocks and asserts the fixed-shape
// contract from AC-STE-301.10 / AC-STE-301.11 (banner / fence
// ```deps-research-result / canonical section order / ≤ 25-line cap /
// exactly-one block).
//
// Any violation surfaces as a `file:line — reason` note in NFR-10 canonical
// shape. The probe is vacuous when no result log is recorded — the common
// no-invocation path. Sibling probe: `spec_research_result_shape.ts`
// (STE-230 / probe #41).

import { type Stats, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  DEPS_RESEARCH_OPTIONAL_SECTION,
  DEPS_RESEARCH_SECTIONS,
  parseDepsResearchBlock,
} from "./deps_research_result";
import { scratchRoot } from "./dpt_paths";

export type Severity = "error" | "warning";

export interface DepsResearchResultShapeViolation {
  file: string;
  line: number;
  reason: string;
  note: string;
  message: string;
  severity: "error";
}

export interface DepsResearchResultShapeReport {
  violations: DepsResearchResultShapeViolation[];
}

const PROBE_ID = "deps_research_result_shape";

/**
 * The parser reports no line number for a shape violation (it validates the
 * block as a whole). The recorded log carries a single block, so a fixed
 * line-1 anchor is sufficient for the NFR-10 `file:line — reason` note.
 */
const VIOLATION_LINE = 1;

function buildMessage(relFile: string, line: number, reason: string): string {
  const canonical = DEPS_RESEARCH_SECTIONS.join(" / ");
  return [
    `${PROBE_ID}: ${relFile}:${line} — ${reason}`,
    `Remedy: re-run the parent skill (/brainstorm or /spec-write); ` +
      `if the violation persists, the deps-researcher subagent or its ` +
      `forked skill (skills/deps-research/SKILL.md) has drifted from the ` +
      `STE-301 output contract. Check the canonical banner line, the ` +
      `three section headings (${canonical}), the optional ` +
      `${DEPS_RESEARCH_OPTIONAL_SECTION} subsection, and the ≤ 25-line cap.`,
    `Context: file=${relFile}, probe=${PROBE_ID}, severity=error`,
  ].join("\n");
}

function violation(
  absPath: string,
  projectRoot: string,
  line: number,
  reason: string,
): DepsResearchResultShapeViolation {
  const rel = relative(projectRoot, absPath);
  return {
    file: absPath,
    line,
    reason,
    note: `${rel}:${line} — ${reason}`,
    message: buildMessage(rel, line, reason),
    severity: "error",
  };
}

/**
 * Scan a single recorded result-log file. Delegates block-shape validation
 * to `parseDepsResearchBlock`; maps a single `{ ok: false, reason }` to one
 * NFR-10 violation. A conforming block yields no violation.
 */
function scanResultFile(
  absPath: string,
  projectRoot: string,
): DepsResearchResultShapeViolation[] {
  let content: string;
  try {
    content = readFileSync(absPath, "utf-8");
  } catch {
    return [];
  }
  const parsed = parseDepsResearchBlock(content);
  if (parsed.ok) return [];
  return [violation(absPath, projectRoot, VIOLATION_LINE, parsed.reason)];
}

/**
 * Walk a directory tree under `.dpt/scratch/` and return every file that
 * matches the canonical result-log basename. Convention from AC-STE-301.11,
 * relocated by STE-382 AC-STE-382.5:
 * `.dpt/scratch/<ulid>/deps-research-result.txt`. The recursive walk
 * tolerates a flat layout too (a single file at the scratch root), since the
 * convention is not externally enforced.
 *
 * Returns absolute paths.
 */
function findResultFiles(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const abs = join(dir, name);
    let s: Stats;
    try {
      s = statSync(abs);
    } catch {
      continue;
    }
    if (s.isDirectory()) {
      out.push(...findResultFiles(abs));
      continue;
    }
    if (name === "deps-research-result.txt") {
      out.push(abs);
    }
  }
  return out;
}

/**
 * Run the probe over a project root. Vacuous when no recorded result log
 * exists (`.dpt/scratch/` absent, or no `deps-research-result.txt` found
 * anywhere under it) — the AC-STE-230.12 vacuity contract, preserved
 * verbatim across the STE-382 AC-STE-382.5 relocation: a run that invoked
 * no research fork stays green with no note. The probe never invokes the
 * subagent itself — it is purely a read-side shape check on whatever the
 * parent skills happen to have persisted, delegating shape validation to
 * `parseDepsResearchBlock`.
 *
 * Forward-only: the retired pre-M104 scratch site is NOT scanned and is not
 * consulted as a fallback (zero installs ⇒ no migration path needed).
 *
 * Project layout the probe expects:
 *
 *   <root>/.dpt/scratch/<ulid>/deps-research-result.txt
 *   <root>/.dpt/scratch/deps-research-result.txt   (flat fallback)
 */
export function runDepsResearchResultShapeProbe(
  projectRoot: string,
): DepsResearchResultShapeReport {
  const root = scratchRoot(projectRoot);
  if (!existsSync(root)) return { violations: [] };
  const files = findResultFiles(root);
  const violations: DepsResearchResultShapeViolation[] = [];
  for (const f of files) {
    violations.push(...scanResultFile(f, projectRoot));
  }
  return { violations };
}
