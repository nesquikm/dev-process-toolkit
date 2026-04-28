// Prose convention gates for STE-121 AC-STE-121.2 / AC-STE-121.3 and
// STE-122 AC-STE-122.2 / AC-STE-122.3.
//
// Asserts /spec-write SKILL.md mandates `buildFRFrontmatter` (frontmatter
// helper, STE-121), substitutes the `<tracker-id>` placeholder via
// `acPrefix(spec)` (STE-122), and runs the two post-write self-checks
// (`runFrontmatterShapeCheck` + `scanGuessedTrackerIdLiterals`) before
// /spec-write returns clean. Pattern mirrors `spec-write-placeholder-convention.test.ts`.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const pluginRoot = join(import.meta.dir, "..");
const specWritePath = join(pluginRoot, "skills", "spec-write", "SKILL.md");
const body = readFileSync(specWritePath, "utf-8");

function zeroBBlock(): string {
  const start = body.indexOf("### 0b.");
  const next = body.indexOf("### 1.", start);
  expect(start).toBeGreaterThan(-1);
  expect(next).toBeGreaterThan(start);
  return body.slice(start, next);
}

describe("STE-121 AC-STE-121.2 — /spec-write mandates buildFRFrontmatter helper", () => {
  test("§0b references `buildFRFrontmatter`", () => {
    expect(zeroBBlock()).toContain("buildFRFrontmatter");
  });

  test("§0b references the helper module path", () => {
    expect(zeroBBlock()).toContain("adapters/_shared/src/fr_frontmatter.ts");
  });

  test("§0b carries the 'never author YAML by hand' instruction", () => {
    expect(zeroBBlock().toLowerCase()).toMatch(/never author yaml by hand|never.*author.*by hand/);
  });
});

describe("STE-121 AC-STE-121.3 — /spec-write runs runFrontmatterShapeCheck post-write", () => {
  test("§0b references `runFrontmatterShapeCheck`", () => {
    expect(zeroBBlock()).toContain("runFrontmatterShapeCheck");
  });

  test("§0b mentions FRFrontmatterShapeError as the refusal surface", () => {
    expect(zeroBBlock()).toContain("FRFrontmatterShapeError");
  });
});

describe("STE-122 AC-STE-122.2 — /spec-write substitutes AC-<tracker-id>.<N>", () => {
  test("§0b references `acPrefix(spec)` for AC-prefix derivation", () => {
    expect(zeroBBlock()).toContain("acPrefix(spec)");
  });

  test("§0b carries the 'never emit AC-<digit>.<N>' rule", () => {
    expect(zeroBBlock().toLowerCase()).toMatch(/never emit literal `?ac-<digit>/i);
  });
});

describe("STE-122 AC-STE-122.3 — /spec-write runs scanGuessedTrackerIdLiterals post-write", () => {
  test("§0b references `scanGuessedTrackerIdLiterals`", () => {
    expect(zeroBBlock()).toContain("scanGuessedTrackerIdLiterals");
  });

  test("§0b references the scanner module path", () => {
    expect(zeroBBlock()).toContain("adapters/_shared/src/guessed_tracker_id_scan.ts");
  });
});
