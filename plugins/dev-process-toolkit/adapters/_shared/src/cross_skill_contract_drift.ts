// cross_skill_contract_drift (STE-318 AC-STE-318.4) — /gate-check probe
// `cross_skill_contract_drift`. Severity: error. Probe #58.
//
// Closes three cross-skill contract drifts where shipped FRs changed
// runtime canon but the documentation surfaces never caught up:
//
//   A2  — /tdd 4-stage architecture (STE-296, M77): surfaces still
//          describe /tdd as RED → GREEN → REFACTOR via "three forked
//          subagents". STE-296 added the AUDIT stage making it
//          RED → GREEN → REFACTOR → AUDIT via four forked subagents.
//   A6  — 2-tier ticket-binding resolver (v1.21.0): SKILL.md surfaces
//          still cite "3-tier ticket-binding resolver". The legacy
//          Tier-2 fallback key was retired; only Tier 1 (branch-regex)
//          + Tier 2 (interactive prompt) remain.
//   A14 — Phantom `deps_research_result_shape` probe:
//          agents/deps-researcher.md claimed a runtime probe that does
//          not exist. The architectural-twin asymmetry with
//          spec-researcher.md (which legitimately references the live
//          probe #41 `spec_research_result_shape`) is intentional —
//          deps-research output shape is operator-judgment, not
//          byte-checkable.
//
// Walks the active-surface glob
//   `plugins/dev-process-toolkit/{skills,docs,agents}/**/*.md`
// plus `plugins/dev-process-toolkit/README.md` (archive excluded) and
// scans each line for the literal forbidden substrings listed in
// `FORBIDDEN_SUBSTRINGS`. Each match surfaces a NFR-10 canonical
// refusal (`<file>:<line>:<column> — <reason>` with `Refusing: /
// Remedy: / Context:` sub-lines).
//
// Architectural twin: probe shape mirrors STE-263 / STE-270 / STE-262
// alternate-trigger scan probes (#47, #48). Literal substring match
// (no regex) so future SKILL.md copy edits don't accidentally regress
// detection. Vacuous when the plugin's own active-surface tree is
// absent (downstream toolkit consumers without the plugin's docs).

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export const PROBE_ID = "cross_skill_contract_drift";

export type Severity = "error" | "warning";

export interface CrossSkillContractDriftViolation {
  file: string;
  line: number;
  column: number;
  reason: string;
  note: string;
  message: string;
  severity: Severity;
  matchedPhrase: string;
}

export interface CrossSkillContractDriftReport {
  violations: CrossSkillContractDriftViolation[];
}

// Forbidden cross-skill contract-drift substrings. Literal substring
// match — no regex — so future SKILL.md / docs copy edits don't
// accidentally regress detection. Each phrase encodes a distinct
// already-shipped contract that doc surfaces drifted away from.
export const FORBIDDEN_SUBSTRINGS = [
  // A2 — /tdd 4-stage architecture (STE-296)
  "three forked subagents",
  "three forked TDD subagents",
  "three forked-subagent stages",
  "forks three subagents",
  "RED → GREEN → REFACTOR for one FR via three",
  "RED → GREEN → VERIFY",
  // A6 — 2-tier ticket-binding resolver
  "3-tier ticket-binding",
  "3-tier resolver",
  // A14 — Phantom probe
  "deps_research_result_shape",
] as const;

const REMEDY_BY_PHRASE: Readonly<Record<string, string>> = {
  "three forked subagents":
    "replace with the canonical `four forked subagents " +
    "(test-writer / implementer / refactorer / spec-reviewer)` per " +
    "STE-296 M77; the AUDIT stage shipped in M77.",
  "three forked TDD subagents":
    "replace with `four forked TDD subagents " +
    "(test-writer / implementer / refactorer / spec-reviewer)` per " +
    "STE-296 M77 AUDIT stage.",
  "three forked-subagent stages":
    "replace with `four stages adding spec-reviewer AUDIT at end` per " +
    "STE-296 M77 — the AUDIT stage is canonical.",
  "forks three subagents":
    "replace with `forks four subagents` per STE-296 M77 AUDIT stage.",
  "RED → GREEN → REFACTOR for one FR via three":
    "replace with `RED → GREEN → REFACTOR → AUDIT for one FR via four` " +
    "per STE-296 M77.",
  "RED → GREEN → VERIFY":
    "replace with canonical `RED → GREEN → REFACTOR → AUDIT` per " +
    "STE-296 M77; VERIFY is not the canonical stage name.",
  "3-tier ticket-binding":
    "replace with `2-tier ticket-binding` matching " +
    "`docs/ticket-binding.md:11` and `specs/technical-spec.md:233`; " +
    "the legacy Tier-2 fallback key was retired in v1.21.0.",
  "3-tier resolver":
    "replace with `2-tier resolver` matching " +
    "`docs/ticket-binding.md:11`; only Tier 1 (branch-regex) + Tier 2 " +
    "(interactive prompt) remain.",
  "deps_research_result_shape":
    "drop the phantom probe reference — no probe by that name exists in " +
    "adapters/_shared/src/; deps-research output shape is operator-" +
    "judgment, not runtime-enforced (architectural twin asymmetry with " +
    "spec-researcher.md is intentional).",
};

// Canonical `<reason>` clause shared by both the short `note` field and the
// first line of the multi-line NFR-10 `message`. Hoisted to keep the two
// surfaces lock-step — drift between them would silently break downstream
// consumers that grep the `note` form.
function buildReason(phrase: string): string {
  return (
    `forbidden cross-skill contract-drift substring ${JSON.stringify(phrase)} ` +
    `present on active surface`
  );
}

function buildMessage(
  relPath: string,
  line: number,
  column: number,
  phrase: string,
): string {
  const reason = buildReason(phrase);
  const remedy = REMEDY_BY_PHRASE[phrase] ?? "remove the forbidden substring.";
  return [
    `${relPath}:${line}:${column} — ${reason}`,
    `Refusing: cross-skill contract-drift substring present on active ` +
      `documentation surface (plugins/dev-process-toolkit/` +
      `{skills,docs,agents,README.md}).`,
    `Remedy: ${remedy}`,
    `Context: file=${relPath}, phrase=${JSON.stringify(phrase)}, ` +
      `probe=${PROBE_ID}, severity=error`,
  ].join("\n");
}

// Walk a directory tree returning the absolute paths of every regular
// markdown file. Filters out `node_modules`, `archive`, and `.archive`
// directories by name so the scan stays inside the active-surface scope.
// Inert (returns []) if the root does not exist — keeps the probe
// vacuous on non-toolkit repos.
function walkActiveMarkdown(root: string): string[] {
  const out: string[] = [];
  if (!existsSync(root)) return out;
  const stack: string[] = [root];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      const name = ent.name;
      if (name === "node_modules" || name === "archive" || name === ".archive") {
        continue;
      }
      const abs = join(cur, name);
      if (ent.isDirectory()) {
        stack.push(abs);
      } else if (ent.isFile() && /\.md$/.test(name)) {
        out.push(abs);
      }
    }
  }
  return out;
}

function scanFile(
  absPath: string,
  projectRoot: string,
): CrossSkillContractDriftViolation[] {
  let content: string;
  try {
    content = readFileSync(absPath, "utf-8");
  } catch {
    return [];
  }
  const rel = relative(projectRoot, absPath);
  const violations: CrossSkillContractDriftViolation[] = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const lineText = lines[i]!;
    for (const phrase of FORBIDDEN_SUBSTRINGS) {
      const idx = lineText.indexOf(phrase);
      if (idx === -1) continue;
      const lineNo = i + 1;
      const column = idx + 1;
      const reason = buildReason(phrase);
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

export async function runCrossSkillContractDriftProbe(
  projectRoot: string,
): Promise<CrossSkillContractDriftReport> {
  const pluginBase = join(projectRoot, "plugins", "dev-process-toolkit");
  // Vacuous when the plugin's active-surface tree is absent.
  if (!existsSync(pluginBase)) return { violations: [] };

  const violations: CrossSkillContractDriftViolation[] = [];

  // Walk the three active-surface subtrees.
  for (const sub of ["skills", "docs", "agents"]) {
    const root = join(pluginBase, sub);
    for (const abs of walkActiveMarkdown(root)) {
      violations.push(...scanFile(abs, projectRoot));
    }
  }

  // README.md at the REPO ROOT (the canonical user-facing README; the
  // plugin packaging convention puts user-facing prose at the repo root,
  // not inside `plugins/dev-process-toolkit/`).
  const readmePath = join(projectRoot, "README.md");
  if (existsSync(readmePath)) {
    let isFile = false;
    try {
      isFile = statSync(readmePath).isFile();
    } catch {
      isFile = false;
    }
    if (isFile) {
      violations.push(...scanFile(readmePath, projectRoot));
    }
  }

  return { violations };
}
