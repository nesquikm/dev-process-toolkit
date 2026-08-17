// first_turn_refusal_marker — /gate-check probe #77 (M126).
//
// Invariant: every plugin `SKILL.md` that carries a `> **FIRST ACTION …`
// blockquote — the ask-or-refuse first-turn contract — MUST also name the
// canonical refusal marker `REQUIRES_INPUT_REFUSED_MARKER` somewhere in that
// same file. A clause that mandates a refusal without ever naming the marker
// the refusal has to put on the stream is unobservable: a correct refusal is
// byte-indistinguishable from a run that simply did nothing, so the scorer
// reads it as `vacuous` (a non-pass) and the breach cannot name itself.
//
// This is the read-side net for the measured 2026-08-16 conformance gap: of
// the five FIRST ACTION carriers, four named the marker and scored a pass;
// the fifth named it nowhere (measured occurrence count: 0) and scored a
// non-pass on all three tracker legs. The probe makes the next carrier that
// forgets it fail deterministically instead of surfacing three legs later.
//
// SCOPE, deliberately narrow in two directions:
//
//   * CARRIER-scoped. A SKILL.md with no FIRST ACTION blockquote is out of
//     scope entirely — it makes no first-turn promise, so it owes no marker.
//     Without this the probe would demand the marker of every skill in the
//     tree, a false red on the large majority of them and a completely
//     different (and wrong) contract.
//   * FILE-scoped, not clause-scoped. The marker must appear in the file, not
//     necessarily inside the blockquote: `/report-issue` names it in its
//     publish gate rather than its FIRST ACTION clause, which is correct for
//     that skill's shape. Demanding an in-clause occurrence would fail a
//     compliant shipped skill.
//
// The walk is rooted at `plugins/dev-process-toolkit/skills/` (the house
// idiom, shared with probe #66 `public_surface_count_drift` and probe #33
// `commit_producing_skill_branch_gate`), so a consumer project's
// `.claude/skills/` tree is never dragged into scope.
//
// Violation shape follows probe #37 `cross_cutting_spec_stale_file_refs`:
// `note` is `<repo-relative-file>:<line> — <reason>`, `message` is the NFR-10
// canonical multi-line shape with `Remedy:` and `Context:` sub-lines, and
// `severity` travels per violation.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { REQUIRES_INPUT_REFUSED_MARKER } from "./requires_input";

export type Severity = "error" | "warning";

export interface FirstTurnRefusalMarkerViolation {
  file: string;
  line: number;
  reason: string;
  note: string;
  message: string;
  severity: Severity;
}

export interface FirstTurnRefusalMarkerReport {
  violations: FirstTurnRefusalMarkerViolation[];
}

/** The probe id, as registered in `skills/gate-check/SKILL.md` row #77. */
export const PROBE_ID = "first_turn_refusal_marker";

/** The anchor that identifies a first-turn contract blockquote. */
const FIRST_ACTION_ANCHOR = "FIRST ACTION";

/**
 * Locate the FIRST ACTION blockquote line, 1-based. Returns `0` when the file
 * carries no such clause (the out-of-scope predicate).
 *
 * Every carrier writes it as a single unwrapped `> **FIRST ACTION …` line, so
 * line-scoped detection is exact. A leading BOM on the first line and CRLF
 * line endings are both normalized away before matching — the CRLF/BOM
 * blindness closed repo-wide on 2026-07-26 is not re-introduced here.
 */
function findFirstActionLine(lines: readonly string[]): number {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.startsWith(">")) continue;
    if (!line.includes(FIRST_ACTION_ANCHOR)) continue;
    return i + 1;
  }
  return 0;
}

function buildMessage(reason: string, rel: string): string {
  return [
    `${PROBE_ID}: ${reason}`,
    `Remedy: extend that skill's FIRST ACTION clause so it names the canonical ` +
      `refusal marker verbatim (${REQUIRES_INPUT_REFUSED_MARKER}) and states why ` +
      `it is load-bearing — a prose-only refusal reads as \`vacuous\` (a non-pass), ` +
      `byte-indistinguishable from a run that did nothing. Source the literal from ` +
      `\`REQUIRES_INPUT_REFUSED_MARKER\`; never re-type it. A skill that makes no ` +
      `first-turn promise should carry no FIRST ACTION blockquote at all.`,
    `Context: file=${rel}, probe=${PROBE_ID}, severity=error`,
  ].join("\n");
}

/** Scan one SKILL.md. Returns `[]` for non-carriers and for compliant files. */
function scanSkillFile(
  absPath: string,
  projectRoot: string,
): FirstTurnRefusalMarkerViolation[] {
  let content: string;
  try {
    content = readFileSync(absPath, "utf-8");
  } catch {
    return [];
  }
  const lines = content
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .split("\n");
  const clauseLine = findFirstActionLine(lines);
  // Not a carrier — no first-turn promise, so no marker owed.
  if (clauseLine === 0) return [];
  // FILE-scoped: the marker may live outside the clause (see the header note).
  if (content.includes(REQUIRES_INPUT_REFUSED_MARKER)) return [];

  const rel = relative(projectRoot, absPath);
  const reason =
    `SKILL.md carries a FIRST ACTION first-turn clause but never names the ` +
    `canonical refusal marker, so a correct refusal cannot be observed on the stream`;
  return [
    {
      file: absPath,
      line: clauseLine,
      reason,
      note: `${rel}:${clauseLine} — ${reason}`,
      message: buildMessage(reason, rel),
      severity: "error",
    },
  ];
}

/**
 * Walk every `plugins/dev-process-toolkit/skills/<name>/SKILL.md` under `projectRoot`
 * and flag every FIRST ACTION carrier that never names the canonical refusal
 * marker. Pure function — no side effects, no writes.
 *
 * Vacuous (zero violations, no crash) when the skills tree is absent.
 *
 * Call site: `/gate-check` conformance probe #77 + the M126 integration test
 * at `tests/m126-ste-479-brainstorm-refusal-marker.test.ts`.
 */
export async function runFirstTurnRefusalMarkerProbe(
  projectRoot: string,
): Promise<FirstTurnRefusalMarkerReport> {
  const skillsDir = join(projectRoot, "plugins", "dev-process-toolkit", "skills");
  const violations: FirstTurnRefusalMarkerViolation[] = [];
  if (!existsSync(skillsDir)) return { violations };

  let entries: string[];
  try {
    entries = readdirSync(skillsDir).sort();
  } catch {
    return { violations };
  }

  for (const name of entries) {
    const dir = join(skillsDir, name);
    try {
      if (!statSync(dir).isDirectory()) continue;
    } catch {
      continue;
    }
    const skillMd = join(dir, "SKILL.md");
    if (!existsSync(skillMd)) continue;
    violations.push(...scanSkillFile(skillMd, projectRoot));
  }

  return { violations };
}
