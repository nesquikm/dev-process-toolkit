// spec_research_result_shape (STE-230 AC-STE-230.12) — /gate-check probe
// `spec_research_result_shape`. Severity: error. Probe #41.
//
// When a parent skill (`/brainstorm` or `/spec-write`) invokes the
// `/dev-process-toolkit:spec-research` forked skill, it MAY persist the
// most recent subagent output for inspection. This probe scans those
// recorded result blocks and asserts the fixed-shape contract from
// AC-STE-230.3 / AC-STE-230.4 / AC-STE-230.5:
//
//   (a) the literal banner line is present immediately above the fence,
//   (b) the fence opens with ```spec-research-result,
//   (c) exactly three `## ` headings appear in the canonical order,
//   (d) the entire block (banner + opening fence + sections + closing
//       fence) is ≤ 25 lines.
//
// Any violation surfaces as a `file:line — reason` note in NFR-10
// canonical shape. The probe is vacuous when no result log is recorded
// — the common no-invocation path. Sibling probe family: see
// `commit_producing_skill_branch_gate.ts` (STE-228 / STE-229).

import { type Stats, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { scratchRoot } from "./dpt_paths";

export type Severity = "error" | "warning";

export interface SpecResearchResultShapeViolation {
  file: string;
  line: number;
  reason: string;
  note: string;
  message: string;
  severity: Severity;
}

export interface SpecResearchResultShapeReport {
  violations: SpecResearchResultShapeViolation[];
}

const PROBE_ID = "spec_research_result_shape";

/**
 * Canonical banner line — byte-equal match required. Substring match
 * elsewhere in the file is not enough; the banner must sit on its own
 * line immediately above the opening fence.
 */
export const SPEC_RESEARCH_BANNER =
  "> [historical reference — decisions below may be stale; use as background, not authority]";

/**
 * Canonical section names in canonical order. Byte-equal heading lines
 * required (the `## ` prefix is included so a future indent or bullet
 * shape change surfaces as a violation).
 */
export const SPEC_RESEARCH_SECTIONS: readonly string[] = [
  "## Related FRs",
  "## Prior Decisions",
  "## Reusable ACs / Patterns",
];

const FENCE_OPEN = "```spec-research-result";
const FENCE_CLOSE = "```";
const MAX_BLOCK_LINES = 25;

function buildMessage(relFile: string, line: number, reason: string): string {
  return [
    `${PROBE_ID}: ${relFile}:${line} — ${reason}`,
    `Remedy: re-run the parent skill (/brainstorm or /spec-write); ` +
      `if the violation persists, the spec-researcher subagent or its ` +
      `forked skill (skills/spec-research/SKILL.md) has drifted from the ` +
      `STE-230 output contract. Check the canonical banner line, the ` +
      `three section headings (## Related FRs / ## Prior Decisions / ` +
      `## Reusable ACs / Patterns), and the ≤ 25-line cap.`,
    `Context: file=${relFile}, probe=${PROBE_ID}, severity=error`,
  ].join("\n");
}

function violation(
  absPath: string,
  projectRoot: string,
  line: number,
  reason: string,
): SpecResearchResultShapeViolation {
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
 * Scan a single recorded result-log file. Returns one violation per
 * shape-contract failure. Most call sites carry exactly one block, but
 * the parser tolerates pre-block prose (e.g. a header line) by
 * scanning forward for the first banner line.
 */
function scanResultFile(
  absPath: string,
  projectRoot: string,
): SpecResearchResultShapeViolation[] {
  let content: string;
  try {
    content = readFileSync(absPath, "utf-8");
  } catch {
    return [];
  }
  const lines = content.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    // trailing newline is conventional; drop the synthetic empty entry
    lines.pop();
  }

  // Find the opening fence first — it anchors the block. The banner
  // must sit on the immediately-preceding line.
  const fenceOpenIdx = lines.findIndex((l) => l === FENCE_OPEN);
  if (fenceOpenIdx === -1) {
    return [
      violation(
        absPath,
        projectRoot,
        1,
        `missing opening fence \`${FENCE_OPEN}\``,
      ),
    ];
  }

  const violations: SpecResearchResultShapeViolation[] = [];

  // (a) banner immediately above the fence
  const bannerIdx = fenceOpenIdx - 1;
  if (bannerIdx < 0 || lines[bannerIdx] !== SPEC_RESEARCH_BANNER) {
    violations.push(
      violation(
        absPath,
        projectRoot,
        Math.max(1, fenceOpenIdx + 1),
        `missing canonical banner line on the line immediately above ` +
          `\`${FENCE_OPEN}\` (expected: \`${SPEC_RESEARCH_BANNER}\`)`,
      ),
    );
  }

  // Find the closing fence after the opening one.
  let fenceCloseIdx = -1;
  for (let i = fenceOpenIdx + 1; i < lines.length; i++) {
    if (lines[i] === FENCE_CLOSE) {
      fenceCloseIdx = i;
      break;
    }
  }
  if (fenceCloseIdx === -1) {
    violations.push(
      violation(
        absPath,
        projectRoot,
        fenceOpenIdx + 1,
        `missing closing fence \`${FENCE_CLOSE}\` for the ` +
          `\`${FENCE_OPEN}\` block`,
      ),
    );
    return violations;
  }

  // (c) exactly three `## ` headings in canonical order, all inside
  // the fenced block.
  const inner = lines.slice(fenceOpenIdx + 1, fenceCloseIdx);
  const headings: { line: number; text: string }[] = [];
  for (let i = 0; i < inner.length; i++) {
    const l = inner[i]!;
    if (l.startsWith("## ")) {
      headings.push({ line: fenceOpenIdx + 2 + i, text: l });
    }
  }
  const expected = SPEC_RESEARCH_SECTIONS;
  if (headings.length !== expected.length) {
    violations.push(
      violation(
        absPath,
        projectRoot,
        fenceOpenIdx + 1,
        `expected exactly ${expected.length} \`## \` headings inside ` +
          `the block, found ${headings.length}`,
      ),
    );
  } else {
    for (let i = 0; i < expected.length; i++) {
      if (headings[i]!.text !== expected[i]) {
        violations.push(
          violation(
            absPath,
            projectRoot,
            headings[i]!.line,
            `heading at this position is \`${headings[i]!.text}\`; ` +
              `expected \`${expected[i]}\` (canonical position ${i + 1})`,
          ),
        );
      }
    }
  }

  // (d) ≤ 25-line cap on the whole block (banner + open-fence +
  // sections + close-fence). Banner counts as 1 line.
  const blockLineCount =
    1 /* banner */ +
    (fenceCloseIdx - fenceOpenIdx + 1); /* open + body + close */
  if (blockLineCount > MAX_BLOCK_LINES) {
    violations.push(
      violation(
        absPath,
        projectRoot,
        Math.max(1, fenceOpenIdx),
        `block is ${blockLineCount} lines; the ≤ ${MAX_BLOCK_LINES}-` +
          `line cap is exceeded (banner + opening fence + sections + ` +
          `closing fence)`,
      ),
    );
  }

  return violations;
}

/**
 * Walk a directory tree under `.dpt/scratch/` and return every file that
 * matches the canonical result-log basename. Convention from
 * AC-STE-230.12, relocated by STE-382 AC-STE-382.5:
 * `.dpt/scratch/<ulid>/spec-research-result.txt`. The recursive walk
 * tolerates a flat layout too (a single file at the scratch root), since
 * the convention is not externally enforced.
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
    if (name === "spec-research-result.txt") {
      out.push(abs);
    }
  }
  return out;
}

/**
 * Run the probe over a project root. Vacuous when no recorded result
 * log exists (`.dpt/scratch/` absent, or no `spec-research-result.txt`
 * found anywhere under it) — the AC-STE-230.12 contract, preserved
 * verbatim across the STE-382 AC-STE-382.5 relocation: a run that
 * invoked no research fork stays green with no note. The probe never
 * invokes the subagent itself — it is purely a read-side shape check on
 * whatever the parent skills happen to have persisted.
 *
 * Forward-only: the retired pre-M104 scratch site is NOT scanned and is
 * not consulted as a fallback (zero installs ⇒ no migration path needed).
 *
 * Project layout the probe expects:
 *
 *   <root>/.dpt/scratch/<ulid>/spec-research-result.txt
 *   <root>/.dpt/scratch/spec-research-result.txt   (flat fallback)
 */
export function runSpecResearchResultShapeProbe(
  projectRoot: string,
): SpecResearchResultShapeReport {
  const root = scratchRoot(projectRoot);
  if (!existsSync(root)) return { violations: [] };
  const files = findResultFiles(root);
  const violations: SpecResearchResultShapeViolation[] = [];
  for (const f of files) {
    violations.push(...scanResultFile(f, projectRoot));
  }
  return { violations };
}
