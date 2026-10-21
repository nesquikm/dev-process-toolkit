// STE-689 (M_7a948e) — AC-STE-689.8: `/ship-milestone` under
// `changelog_unversioned: true`, and `branchNameFor` for an unreleased run.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { branchNameFor } from "../skills/ship-milestone/branch_name_for";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const SKILL = readFileSync(join(PLUGIN_ROOT, "skills", "ship-milestone", "SKILL.md"), "utf-8");

/** Every blank-line-separated block of SKILL.md that names the flag, joined. */
function flagProse(): string {
  return SKILL.split(/\n\s*\n/)
    .filter((block) => block.includes("changelog_unversioned"))
    .join("\n\n");
}

describe("AC-STE-689.8 — branchNameFor for an unreleased run", () => {
  test("Epic-keyed milestone → release/<milestone-lowercase>-unreleased", () => {
    expect(branchNameFor({ milestone: "M_7A948E", unreleased: true } as never)).toBe(
      "release/m_7a948e-unreleased",
    );
  });

  test("M<N> milestone → release/m<n>-unreleased", () => {
    expect(branchNameFor({ milestone: "M12", unreleased: true } as never)).toBe("release/m12-unreleased");
  });

  test("the versioned form is unchanged", () => {
    expect(branchNameFor({ version: "2.99.2" })).toBe("release/v2.99.2");
    expect(branchNameFor({ version: "v3.0.0" })).toBe("release/v3.0.0");
  });
});

describe("AC-STE-689.8 — SKILL.md describes the unversioned run", () => {
  test("SKILL.md names the flag", () => {
    expect(SKILL).toContain("changelog_unversioned");
  });

  test("the flag's prose says the run skips version inference and codename resolution", () => {
    const prose = flagProse();
    expect(prose).toMatch(/skip[^.]*version inference/i);
    expect(prose).toMatch(/skip[^.]*codename resolution/i);
  });

  test("the flag's prose keeps the test-gate refusal #3 and writes no test-count line", () => {
    const prose = flagProse();
    expect(prose).toMatch(/refusal #3/);
    expect(prose).toMatch(/no\s+`?(--)?test-count`?\s+line|test-count line[^.]*\b(not|never)\b|(not|never)[^.]*test-count line/i);
  });

  test("the flag's prose proposes the unreleased branch and the unreleased stamp", () => {
    const prose = flagProse();
    expect(prose).toContain("release/<milestone-lowercase>-unreleased");
    expect(prose).toContain("shipped_in: unreleased");
  });

  test("the flag's prose names the unreleased commit subject and footers", () => {
    const prose = flagProse();
    expect(prose).toMatch(/chore\(release\): (<milestone>|M<N>) unreleased/);
    expect(prose).toContain("Release: unreleased");
    expect(prose).toMatch(/Refs: (<milestone>|M<N>)/);
  });

  test("the flag's prose runs the writer with the `unreleased` version slot", () => {
    expect(flagProse()).toMatch(/release_config\.ts <projectRoot> unreleased/);
  });
});
