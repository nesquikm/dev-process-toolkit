// Tests for /gate-check probe `commit_producing_skill_branch_gate`
// (STE-228 AC-STE-228.9). Severity: error.
//
// Globs each commit-producing skill's SKILL.md and refuses any
// `git commit` reference that is not preceded (in document order) by a
// documented call to `requireCommittableBranch`. Catches future drift
// when a new skill is added or an existing skill grows a new commit
// site.

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  COMMIT_PRODUCING_SKILLS,
  runCommitProducingSkillBranchGateProbe,
} from "../adapters/_shared/src/commit_producing_skill_branch_gate";

function makeFixture(skills: { name: string; content: string }[]): {
  root: string;
  cleanup: () => void;
} {
  const root = mkdtempSync(join(tmpdir(), "branch-gate-probe-"));
  const skillsDir = join(
    root,
    "plugins",
    "dev-process-toolkit",
    "skills",
  );
  mkdirSync(skillsDir, { recursive: true });
  for (const s of skills) {
    const dir = join(skillsDir, s.name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), s.content);
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

// -----------------------------------------------------------------------------
// Positive cases — probe passes when every commit ref is preceded by a
// documented call to requireCommittableBranch.
// -----------------------------------------------------------------------------

describe("commit_producing_skill_branch_gate — positive cases", () => {
  test("SKILL.md with requireCommittableBranch before a fenced 'git commit' → no violation", () => {
    const content = [
      "# /spec-write",
      "",
      "Step 1: call `requireCommittableBranch({ ... })`.",
      "",
      "Step 2: stage and commit.",
      "",
      "```bash",
      "git add specs/frs/STE-X.md",
      "git commit -m 'chore(specs): write FR'",
      "```",
      "",
    ].join("\n");
    const { root, cleanup } = makeFixture([{ name: "spec-write", content }]);
    try {
      const report = runCommitProducingSkillBranchGateProbe(root);
      expect(report.violations).toEqual([]);
    } finally {
      cleanup();
    }
  });

  test("requireCommittableBranch reference can be inline-coded, not just bare prose", () => {
    const content = [
      "# /spec-archive",
      "",
      "First, run the gate via `requireCommittableBranch`.",
      "Then run `git commit`.",
      "",
    ].join("\n");
    const { root, cleanup } = makeFixture([
      { name: "spec-archive", content },
    ]);
    try {
      const report = runCommitProducingSkillBranchGateProbe(root);
      expect(report.violations).toEqual([]);
    } finally {
      cleanup();
    }
  });

  test("multiple git commit references all covered by a single preceding gate call", () => {
    const content = [
      "# /implement",
      "",
      "Call requireCommittableBranch.",
      "",
      "```bash",
      "git commit -m 'first'",
      "git commit -m 'second'",
      "```",
    ].join("\n");
    const { root, cleanup } = makeFixture([{ name: "implement", content }]);
    try {
      const report = runCommitProducingSkillBranchGateProbe(root);
      expect(report.violations).toEqual([]);
    } finally {
      cleanup();
    }
  });

  test("SKILL.md with no git commit references at all → vacuously passes", () => {
    const content = "# /docs\n\nNo commits here.\n";
    const { root, cleanup } = makeFixture([{ name: "docs", content }]);
    try {
      const report = runCommitProducingSkillBranchGateProbe(root);
      expect(report.violations).toEqual([]);
    } finally {
      cleanup();
    }
  });
});

// -----------------------------------------------------------------------------
// Negative cases — probe fails when a git commit appears before any gate
// call (or no gate call exists).
// -----------------------------------------------------------------------------

describe("commit_producing_skill_branch_gate — negative cases", () => {
  test("git commit with NO preceding requireCommittableBranch → violation with file + line", () => {
    const content = [
      "# /spec-write",
      "",
      "Just commit and move on:",
      "",
      "```bash",
      "git commit -m 'chore(specs): write FR'",
      "```",
      "",
    ].join("\n");
    const { root, cleanup } = makeFixture([{ name: "spec-write", content }]);
    try {
      const report = runCommitProducingSkillBranchGateProbe(root);
      expect(report.violations.length).toBe(1);
      const v = report.violations[0]!;
      expect(v.file).toContain("spec-write");
      expect(v.file).toContain("SKILL.md");
      expect(v.line).toBeGreaterThan(0);
      expect(v.severity).toBe("error");
    } finally {
      cleanup();
    }
  });

  test("git commit BEFORE the gate call (out of document order) → violation", () => {
    const content = [
      "# /implement",
      "",
      "```bash",
      "git commit -m 'oops'",
      "```",
      "",
      "Later, call requireCommittableBranch.",
    ].join("\n");
    const { root, cleanup } = makeFixture([{ name: "implement", content }]);
    try {
      const report = runCommitProducingSkillBranchGateProbe(root);
      expect(report.violations.length).toBeGreaterThan(0);
      expect(report.violations[0]!.severity).toBe("error");
    } finally {
      cleanup();
    }
  });

  test("inline `git commit` reference without preceding gate call → violation", () => {
    const content = [
      "# /ship-milestone",
      "",
      "Run `git commit -m 'chore(release)'` to ship.",
      "",
    ].join("\n");
    const { root, cleanup } = makeFixture([
      { name: "ship-milestone", content },
    ]);
    try {
      const report = runCommitProducingSkillBranchGateProbe(root);
      expect(report.violations.length).toBeGreaterThan(0);
    } finally {
      cleanup();
    }
  });

  test("violation message names the literal probe ID and the offending file:line", () => {
    const content = [
      "# /spec-archive",
      "",
      "```bash",
      "git commit -m 'chore: archive'",
      "```",
    ].join("\n");
    const { root, cleanup } = makeFixture([
      { name: "spec-archive", content },
    ]);
    try {
      const report = runCommitProducingSkillBranchGateProbe(root);
      expect(report.violations.length).toBeGreaterThan(0);
      const v = report.violations[0]!;
      // Probe IDs are the slug-style key from /gate-check.
      expect(v.message).toContain("commit_producing_skill_branch_gate");
      // Cite the file path + 1-based line number.
      expect(v.message).toContain(":");
    } finally {
      cleanup();
    }
  });
});

// -----------------------------------------------------------------------------
// Scope — probe only inspects SKILL.md files under the commit-producing
// skill list. Non-commit-producing skills (e.g. /gate-check, /docs)
// are ignored by the probe even if they happen to mention `git commit`.
// -----------------------------------------------------------------------------

describe("commit_producing_skill_branch_gate — scope", () => {
  test("the canonical commit-producing skill list is exhaustive", () => {
    // STE-228 calls out exactly these 5 skills as commit-producing.
    expect(new Set(COMMIT_PRODUCING_SKILLS)).toEqual(
      new Set(["setup", "spec-write", "spec-archive", "ship-milestone", "implement"]),
    );
  });
});
