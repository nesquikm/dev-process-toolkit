import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// STE-42 AC-STE-42.6 conformance — /gate-check carries a lint rule that greps
// specs/technical-spec.md and specs/testing-spec.md for `^#{1,3} M\d+`
// and fails the gate with a pointer to AC-STE-26.3 (no per-milestone content
// in cross-cutting files).

const pluginRoot = join(import.meta.dir, "..");
const repoRoot = join(pluginRoot, "..", "..");
const gateCheckSkillPath = join(pluginRoot, "skills", "gate-check", "SKILL.md");

function read(path: string): string {
  return readFileSync(path, "utf8");
}

describe("STE-42 AC-STE-42.6 — /gate-check per-milestone heading strip probe", () => {
  test("SKILL.md names the Per-milestone heading probe with AC references", () => {
    const body = read(gateCheckSkillPath);
    expect(body).toMatch(/Per-milestone heading/i);
    expect(body).toMatch(/AC-STE-42\.6/);
    expect(body).toMatch(/AC-STE-26\.3/);
  });

  test("probe names technical-spec.md and testing-spec.md and uses GATE FAILED", () => {
    const body = read(gateCheckSkillPath);
    expect(body).toContain("technical-spec.md");
    expect(body).toContain("testing-spec.md");
    expect(body).toMatch(/GATE FAILED/);
  });

  test("probe describes the `^#{1,3} M\\d+` regex (escaped in markdown)", () => {
    const body = read(gateCheckSkillPath);
    expect(body).toMatch(/#\{1,3\}\s*M\\d\+/);
  });
});

// The plugin's own `specs/` directory is gitignored (dogfood workspace, not
// tracked). When the dogfood specs happen to be present locally, assert the
// STE-42 AC-STE-42.1 / AC-STE-42.2 / AC-STE-42.4 conditions directly. Downstream projects
// running this plugin get the same enforcement via `/gate-check` probe #8
// (covered by the SKILL.md prose assertions above).

describe("STE-42 AC-STE-42.1/STE-42.2/63.4 — dogfood spec files satisfy the probe conditions", () => {
  const technicalSpec = join(repoRoot, "specs", "technical-spec.md");
  const testingSpec = join(repoRoot, "specs", "testing-spec.md");

  test.skipIf(!existsSync(technicalSpec))(
    "specs/technical-spec.md has zero `^#{1,3} M\\d+` matches and ≤ 600 lines",
    () => {
      const body = read(technicalSpec);
      const matches = body.split("\n").filter((line) => /^#{1,3}\s+M\d+/.test(line));
      expect(matches).toEqual([]);
      expect(body.split("\n").length).toBeLessThanOrEqual(600);
    },
  );

  test.skipIf(!existsSync(testingSpec))(
    "specs/testing-spec.md has zero `^#{1,3} M\\d+` matches and ≤ 300 lines",
    () => {
      const body = read(testingSpec);
      const matches = body.split("\n").filter((line) => /^#{1,3}\s+M\d+/.test(line));
      expect(matches).toEqual([]);
      expect(body.split("\n").length).toBeLessThanOrEqual(300);
    },
  );
});
