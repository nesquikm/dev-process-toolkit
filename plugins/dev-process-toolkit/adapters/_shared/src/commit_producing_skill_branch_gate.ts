// commit_producing_skill_branch_gate (STE-228 AC-STE-228.9) — /gate-check
// probe `commit_producing_skill_branch_gate`. Severity: error.
//
// Globs each commit-producing skill's SKILL.md and refuses any
// `git commit` reference (literal, fenced or inline) that is not
// preceded (in document order) by a documented call to
// `requireCommittableBranch`. Catches future drift when a new skill is
// added or an existing skill grows a new commit site.
//
// Sibling probe family: see `auto_approve_marker.ts` (M59 / STE-226)
// for the prompt-bearing-spawn marker probe colocated here.
//
// Scope. The probe inspects SKILL.md files for the canonical
// commit-producing skill list:
//
//   ["setup", "spec-write", "spec-archive", "ship-milestone", "implement"]
//
// In addition, an explicit `NON_COMMIT_PRODUCING_SKILLS` allowlist
// (STE-229 AC-STE-229.10) documents the read-only / outbound-only skills
// that are intentionally exempt from the `requireCommittableBranch`
// contract. Skills on that list are skipped even if their SKILL.md
// mentions `git commit` in prose (e.g. as part of a refusal-message
// example). The allowlist is the canonical record of "this skill
// produces no VCS writes" — referenced by the FR exemption note in each
// allowlisted skill's SKILL.md.

import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

export type Severity = "error" | "warning";

export interface CommitProducingSkillBranchGateViolation {
  file: string;
  line: number;
  reason: string;
  note: string;
  message: string;
  severity: Severity;
}

export interface CommitProducingSkillBranchGateReport {
  violations: CommitProducingSkillBranchGateViolation[];
}

const PROBE_ID = "commit_producing_skill_branch_gate";

/**
 * Canonical commit-producing skill list (STE-228). Single source of
 * truth — imported by the doc-conformance and probe tests so a future
 * skill addition only edits one file.
 */
export const COMMIT_PRODUCING_SKILLS: readonly string[] = [
  "setup",
  "spec-write",
  "spec-archive",
  "ship-milestone",
  "implement",
];

/**
 * Explicit allowlist of skills that produce no VCS writes (STE-229
 * AC-STE-229.10). Items on this list are exempt from the
 * `requireCommittableBranch` contract — they are pure read-side or
 * outbound-only flows (e.g. `/report-issue` shells out to `gh gist
 * create -s` and writes nothing under VCS). The probe skips these
 * SKILL.md files unconditionally.
 *
 * Disjointness invariant: this list MUST NOT overlap with
 * `COMMIT_PRODUCING_SKILLS`. The `branch-gate-probe.test.ts` suite
 * asserts the disjointness so a future drift surfaces deterministically.
 */
export const NON_COMMIT_PRODUCING_SKILLS: readonly string[] = [
  "report-issue",
  "spec-research",
  "deps-research",
];

// The gate symbol skills must reference (bare, in backticks, or in a
// fenced block) before any `git commit` reference. We match the literal
// identifier anywhere on the line — backticks/parens/etc. are fine.
const GATE_RE = /requireCommittableBranch/;

// `git commit` reference matcher. Matches `git commit`, `git commit -m`,
// etc., whether the line is bare prose, inline-coded with backticks, or
// inside a fenced ```bash block.
const COMMIT_RE = /\bgit\s+commit\b/;

function buildMessage(relFile: string, line: number): string {
  return [
    `${PROBE_ID}: ${relFile}:${line} — ` +
      `\`git commit\` reference is not preceded (in document order) by a ` +
      `documented call to \`requireCommittableBranch\`.`,
    `Remedy: add a step that calls \`requireCommittableBranch({ ... })\` ` +
      `before this commit site (STE-228 AC-STE-228.9). The gate refuses ` +
      `commits on protected trunk branches when the Conventional Commits ` +
      `type is not in the trunk-OK allowlist; without a preceding call, ` +
      `the skill can land a commit directly on \`main\` and the subsequent ` +
      `push will be rejected by branch protection.`,
    `Context: file=${relFile}, probe=${PROBE_ID}, severity=error`,
  ].join("\n");
}

/**
 * Scan a single SKILL.md document. Returns one violation per `git
 * commit` reference that does not have a preceding `requireCommittableBranch`
 * mention in document order.
 */
function scanSkillFile(
  absPath: string,
  projectRoot: string,
): CommitProducingSkillBranchGateViolation[] {
  if (!existsSync(absPath)) return [];
  let content: string;
  try {
    content = readFileSync(absPath, "utf-8");
  } catch {
    return [];
  }
  const rel = relative(projectRoot, absPath);
  const lines = content.split("\n");
  const violations: CommitProducingSkillBranchGateViolation[] = [];
  let gateSeen = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (GATE_RE.test(line)) {
      gateSeen = true;
      // A line might mention both — but per the document-order rule,
      // a gate-then-commit on the same line still satisfies the
      // invariant for this commit reference and any subsequent one.
    }
    if (COMMIT_RE.test(line) && !gateSeen) {
      const lineNo = i + 1;
      const reason =
        `\`git commit\` reference not preceded by a call to ` +
        `\`requireCommittableBranch\``;
      violations.push({
        file: absPath,
        line: lineNo,
        reason,
        note: `${rel}:${lineNo} — ${reason}`,
        message: buildMessage(rel, lineNo),
        severity: "error",
      });
    }
  }
  return violations;
}

/**
 * Run the probe over a project root. Sync — the test fixture creates a
 * tmpdir with a couple of small SKILL.md files; no async I/O is
 * justified.
 *
 * The project root layout the probe expects:
 *
 *   <root>/plugins/dev-process-toolkit/skills/<skill>/SKILL.md
 *
 * Skills outside the canonical commit-producing list are ignored. A
 * skill directory that does not contain a SKILL.md is silently skipped
 * (the probe is a doc-conformance check, not a structural one).
 */
export function runCommitProducingSkillBranchGateProbe(
  projectRoot: string,
): CommitProducingSkillBranchGateReport {
  const skillsDir = join(
    projectRoot,
    "plugins",
    "dev-process-toolkit",
    "skills",
  );
  const violations: CommitProducingSkillBranchGateViolation[] = [];
  if (!existsSync(skillsDir)) return { violations };
  const exempt = new Set(NON_COMMIT_PRODUCING_SKILLS);
  for (const skill of COMMIT_PRODUCING_SKILLS) {
    if (exempt.has(skill)) continue;
    const skillMd = join(skillsDir, skill, "SKILL.md");
    violations.push(...scanSkillFile(skillMd, projectRoot));
  }
  return { violations };
}
