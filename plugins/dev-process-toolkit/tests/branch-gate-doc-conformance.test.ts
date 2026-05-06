// Doc-conformance tests for STE-228.
//
// 1. Each commit-producing skill's SKILL.md MUST reference
//    `requireCommittableBranch` at least once.
// 2. STE-228's FR file MUST carry the canonical branch-name table.
// 3. Each commit-producing skill's SKILL.md MUST reference (not duplicate)
//    the branch-name table — it points at STE-228's FR file rather than
//    inlining the table.

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { COMMIT_PRODUCING_SKILLS } from "../adapters/_shared/src/commit_producing_skill_branch_gate";

const REPO_ROOT = join(__dirname, "..", "..", "..");

function readSkillMd(skillName: string): string {
  const path = join(
    REPO_ROOT,
    "plugins",
    "dev-process-toolkit",
    "skills",
    skillName,
    "SKILL.md",
  );
  if (!existsSync(path)) {
    throw new Error(`SKILL.md not found at ${path}`);
  }
  return readFileSync(path, "utf-8");
}

function readSte228Fr(): string {
  const activePath = join(REPO_ROOT, "specs", "frs", "STE-228.md");
  const archivePath = join(REPO_ROOT, "specs", "frs", "archive", "STE-228.md");
  const path = existsSync(activePath) ? activePath : archivePath;
  if (!existsSync(path)) {
    throw new Error(`STE-228 FR file not found at ${activePath} or ${archivePath}`);
  }
  return readFileSync(path, "utf-8");
}

describe("branch-gate doc conformance — SKILL.md references requireCommittableBranch", () => {
  for (const skill of COMMIT_PRODUCING_SKILLS) {
    test(`/${skill} SKILL.md references requireCommittableBranch`, () => {
      const content = readSkillMd(skill);
      expect(content).toContain("requireCommittableBranch");
    });
  }
});

describe("branch-gate doc conformance — canonical table location", () => {
  test("STE-228 FR carries the canonical branch-name table", () => {
    const fr = readSte228Fr();
    // Markdown table header from FR Section "Branch-name canonical table".
    // Match a row known to be in the table — `release/v<X.Y.Z>` for /ship-milestone.
    expect(fr).toContain("Branch-name canonical table");
    expect(fr).toContain("release/v<X.Y.Z>");
    expect(fr).toContain("chore/setup-bootstrap");
    expect(fr).toContain("chore/archive-");
    expect(fr).toContain("docs/specs-cross-cutting");
  });

  test("each commit-producing skill's SKILL.md references STE-228 (not duplicates the table)", () => {
    for (const skill of COMMIT_PRODUCING_SKILLS) {
      const content = readSkillMd(skill);
      // Reference is via "STE-228" cite — not a duplicated markdown table
      // header. We treat any cite to STE-228 as the documented anchor.
      expect(content).toContain("STE-228");
    }
  });
});
