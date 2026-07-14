// spec_write_next_line_doc — /gate-check probe #66 (STE-380 AC-STE-380.4).
// Severity: error.
//
// Doc-shape probe. Single-file scope: reads ONLY
// `plugins/dev-process-toolkit/skills/spec-write/SKILL.md` (the Next-line
// recommendation contract is uniquely `/spec-write`'s § 7 closing-summary
// surface, not a cross-skill concern) and verifies via literal substring
// checks — no regex anywhere — that:
//
//   (a) the `**Next-line variant rule.**` paragraph is present;
//   (b) the milestone-binding branch literals are present (`milestone
//       binding` discriminator + the `Run /dev-process-toolkit:implement
//       M<N>` command literal);
//   (c) both tail-template `Next:` lines are present (M-form + FR-id form);
//   (d) the retired new-FR-presence discriminator sentence is ABSENT
//       (regression tripwire against re-keying the rule on FR presence).
//
// Missing positives surface as file-level violations (line 0); a tripwire
// hit surfaces on its matched line. Vacuous pass when the SKILL.md is
// absent (downstream toolkit consumers don't ship it).
//
// Shape siblings: `implement_invocation_grammar_doc.ts` (violation/remedy
// message shape, probe #31) and `spec_write_first_turn_drift_scan.ts`
// (single-file scope + literal-substring matching, probe #47).

import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

export interface SpecWriteNextLineDocViolation {
  file: string;
  line: number;
  reason: string;
  note: string;
  message: string;
}

export interface SpecWriteNextLineDocReport {
  violations: SpecWriteNextLineDocViolation[];
}

// Positive literals — every one MUST appear verbatim in the SKILL.md.
// Literal substring match only, so unrelated copy edits never trip this.
export const REQUIRED_NEXT_LINE_LITERALS = [
  // (a) the rule paragraph's bolded name.
  "**Next-line variant rule.**",
  // (b) the discriminator + the M-form command literal from the rule body.
  "milestone binding",
  "Run /dev-process-toolkit:implement M<N>",
  // (c) both tail-template `Next:` lines, in lockstep with the rule.
  "Next: Run `/dev-process-toolkit:implement M<N>` when specs are ready.",
  "Next: Run `/dev-process-toolkit:implement <tracker-id>` when specs are ready.",
] as const;

// (d) Negative tripwire — the retired new-FR-presence discriminator
// sentence. Its reappearance means the rule regressed to keying on
// "run created a single new FR" instead of milestone binding.
export const RETIRED_DISCRIMINATOR_LITERAL =
  "When the run created a single new FR, recommend the FR-id form";

const REMEDY =
  "restore the canonical `**Next-line variant rule.**` paragraph in " +
  "skills/spec-write/SKILL.md § 7 — the discriminator is milestone " +
  "binding (new FR carrying `milestone: M<N>` frontmatter ⇒ recommend " +
  "`Run /dev-process-toolkit:implement M<N>`, one `Next:` line per " +
  "distinct milestone; milestone-less new FR ⇒ FR-id form) — and keep " +
  "both tail-template `Next:` lines in lockstep. Do NOT reintroduce the " +
  "retired new-FR-presence discriminator sentence. See specs/frs/STE-380.md " +
  "for the canonical shape.";

function buildViolation(
  absPath: string,
  projectRoot: string,
  line: number,
  reason: string,
): SpecWriteNextLineDocViolation {
  const rel = relative(projectRoot, absPath);
  const note = `${rel}:${line} — ${reason}`;
  const message = [
    `spec_write_next_line_doc: ${rel}:${line} — ${reason}`,
    `Remedy: ${REMEDY}`,
    `Context: file=${rel}, line=${line}, probe=spec_write_next_line_doc, severity=error`,
  ].join("\n");
  return { file: absPath, line, reason, note, message };
}

export async function runSpecWriteNextLineDocProbe(
  projectRoot: string,
): Promise<SpecWriteNextLineDocReport> {
  const target = join(
    projectRoot,
    "plugins",
    "dev-process-toolkit",
    "skills",
    "spec-write",
    "SKILL.md",
  );
  // Vacuous pass for downstream toolkit consumers that don't ship the
  // toolkit's own SKILL.md tree.
  if (!existsSync(target)) return { violations: [] };
  let body: string;
  try {
    body = readFileSync(target, "utf-8");
  } catch {
    return { violations: [] };
  }

  const violations: SpecWriteNextLineDocViolation[] = [];

  // Positives — a missing literal has no occurrence, so it is reported
  // file-level (line 0).
  for (const literal of REQUIRED_NEXT_LINE_LITERALS) {
    if (body.includes(literal)) continue;
    const reason =
      `required Next-line contract literal ${JSON.stringify(literal)} ` +
      "missing from skills/spec-write/SKILL.md";
    violations.push(buildViolation(target, projectRoot, 0, reason));
  }

  // Tripwire — report every matched line (1-indexed).
  const lines = body.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    if (!(lines[i] ?? "").includes(RETIRED_DISCRIMINATOR_LITERAL)) continue;
    const reason =
      "retired new-FR-presence discriminator literal " +
      `${JSON.stringify(RETIRED_DISCRIMINATOR_LITERAL)} reintroduced ` +
      "(rule must discriminate on milestone binding)";
    violations.push(buildViolation(target, projectRoot, i + 1, reason));
  }

  return { violations };
}
