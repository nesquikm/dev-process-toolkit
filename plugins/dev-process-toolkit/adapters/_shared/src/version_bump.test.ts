import { describe, expect, test } from "bun:test";
import { inferBump, InvalidOverrideError, type FrSummary } from "./version_bump";

// STE-73 AC-STE-73.3 — semver inference for /ship-milestone.
//
// Rules:
// - any FR flagged `breaking: true` in frontmatter       → major bump
// - milestone where EVERY FR's changelog_category is     → patch bump
//   `Fixed` / `Removed`                                    (a pure
//                                                          fix-only
//                                                          milestone)
// - otherwise                                            → minor bump
// - `--version X.Y.Z` override wins if it parses as semver

const ADDED_FR: FrSummary = { trackerId: "STE-1", title: "add it", changelogCategory: "Added" };
const FIXED_FR: FrSummary = { trackerId: "STE-2", title: "fix it", changelogCategory: "Fixed" };
const REMOVED_FR: FrSummary = { trackerId: "STE-3", title: "remove it", changelogCategory: "Removed" };
const CHANGED_FR: FrSummary = { trackerId: "STE-4", title: "change it", changelogCategory: "Changed" };
const BREAKING_FR: FrSummary = { trackerId: "STE-5", title: "break it", changelogCategory: "Changed", breaking: true };

describe("inferBump — default minor bump", () => {
  test("minor bump when any FR is additive (Added)", () => {
    const result = inferBump({ currentVersion: "1.22.0", frs: [ADDED_FR] });
    expect(result.version).toBe("1.23.0");
    expect(result.rationale).toMatch(/minor bump/i);
  });

  test("minor bump on mixed Added + Fixed", () => {
    const result = inferBump({ currentVersion: "1.22.0", frs: [ADDED_FR, FIXED_FR] });
    expect(result.version).toBe("1.23.0");
    expect(result.rationale).toMatch(/minor bump/i);
  });

  test("minor bump counts the FRs in the rationale", () => {
    const result = inferBump({ currentVersion: "2.3.4", frs: [ADDED_FR, CHANGED_FR] });
    expect(result.version).toBe("2.4.0");
    expect(result.rationale).toMatch(/2 (additive )?FRs|shipped 2/i);
  });
});

describe("inferBump — major bump on breaking FR", () => {
  test("major bump when any FR has breaking: true", () => {
    const result = inferBump({ currentVersion: "1.22.0", frs: [ADDED_FR, BREAKING_FR] });
    expect(result.version).toBe("2.0.0");
    expect(result.rationale).toMatch(/major bump/i);
    expect(result.rationale).toContain("STE-5");
  });

  test("major bump resets minor and patch", () => {
    const result = inferBump({ currentVersion: "1.22.7", frs: [BREAKING_FR] });
    expect(result.version).toBe("2.0.0");
  });
});

describe("inferBump — patch bump on fix-only milestones", () => {
  test("patch bump when every FR is a Fixed category", () => {
    const result = inferBump({ currentVersion: "1.22.0", frs: [FIXED_FR, { ...FIXED_FR, trackerId: "STE-6" }] });
    expect(result.version).toBe("1.22.1");
    expect(result.rationale).toMatch(/patch bump/i);
  });

  test("patch bump also accepts Removed-only milestones (fix-class housekeeping)", () => {
    const result = inferBump({ currentVersion: "1.22.3", frs: [REMOVED_FR] });
    expect(result.version).toBe("1.22.4");
    expect(result.rationale).toMatch(/patch bump/i);
  });

  test("single Added FR still forces minor (patch requires every FR be fix-class)", () => {
    const result = inferBump({ currentVersion: "1.22.0", frs: [FIXED_FR, ADDED_FR] });
    expect(result.version).toBe("1.23.0");
    expect(result.rationale).toMatch(/minor bump/i);
  });
});

describe("inferBump — user override", () => {
  test("--version X.Y.Z override wins over inferred bump", () => {
    const result = inferBump({ currentVersion: "1.22.0", frs: [ADDED_FR], override: "1.99.0" });
    expect(result.version).toBe("1.99.0");
    expect(result.rationale).toMatch(/override|user-provided/i);
  });

  test("override works even with a breaking FR", () => {
    const result = inferBump({ currentVersion: "1.22.0", frs: [BREAKING_FR], override: "1.23.0" });
    expect(result.version).toBe("1.23.0");
    expect(result.rationale).toMatch(/override/i);
  });

  test("malformed override throws InvalidOverrideError", () => {
    expect(() =>
      inferBump({ currentVersion: "1.22.0", frs: [ADDED_FR], override: "not-a-version" }),
    ).toThrow(InvalidOverrideError);
  });

  test("override without three segments throws", () => {
    expect(() =>
      inferBump({ currentVersion: "1.22.0", frs: [ADDED_FR], override: "1.22" }),
    ).toThrow(InvalidOverrideError);
  });
});

describe("inferBump — edge cases", () => {
  test("empty FR list forces minor bump with a 'no FRs' rationale", () => {
    // /ship-milestone refuses upstream when a milestone is empty, but the
    // bump helper itself must return something deterministic.
    const result = inferBump({ currentVersion: "1.22.0", frs: [] });
    expect(result.version).toBe("1.23.0");
    expect(result.rationale).toMatch(/minor bump|default/i);
  });

  test("current version with extra segments (pre-release) is rejected", () => {
    expect(() =>
      inferBump({ currentVersion: "1.22.0-beta.1", frs: [ADDED_FR] }),
    ).toThrow();
  });

  test("current version missing a segment is rejected", () => {
    expect(() =>
      inferBump({ currentVersion: "1.22", frs: [ADDED_FR] }),
    ).toThrow();
  });
});
