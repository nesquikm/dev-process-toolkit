import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Prose convention gate for STE-66 AC-STE-66.5.
//
// Asserts that /spec-write and /brainstorm both carry the "use <tracker-id>
// placeholder; never guess" rule. Same shape as linear-adapter-doc-markers.test.ts
// and implement-phase4-close.test.ts — grep-based invariant, no runtime.
//
// Regression guard: if a future edit silently drops the placeholder rule from
// either skill file, downstream draft sessions could re-introduce the guessed-ID
// failure mode (dogfood origin: M19 /spec-write drafted AC-STE-65.* before the
// Linear ticket existed).

const pluginRoot = join(import.meta.dir, "..");
const specWritePath = join(pluginRoot, "skills", "spec-write", "SKILL.md");
const brainstormPath = join(pluginRoot, "skills", "brainstorm", "SKILL.md");

function readSkill(path: string): string {
  return readFileSync(path, "utf-8");
}

describe("STE-66 AC-STE-66.5 — /spec-write §0b placeholder rule", () => {
  test("spec-write SKILL.md contains the literal `<tracker-id>` placeholder", () => {
    const body = readSkill(specWritePath);
    expect(body).toContain("<tracker-id>");
  });

  test("spec-write SKILL.md contains the phrase 'never guess' (case-insensitive)", () => {
    const body = readSkill(specWritePath);
    expect(body.toLowerCase()).toContain("never guess");
  });

  test("placeholder rule lives in the §0b FR-creation block", () => {
    // Scope the assertion to the §0b block so a stray mention elsewhere
    // doesn't accidentally satisfy it. §0b starts at `### 0b.` and ends at
    // the next `### ` heading (usually `### 1.`).
    const body = readSkill(specWritePath);
    const zeroB = body.indexOf("### 0b.");
    expect(zeroB).toBeGreaterThan(0);
    const nextHeading = body.indexOf("\n### ", zeroB + 1);
    const block = body.slice(zeroB, nextHeading > 0 ? nextHeading : undefined);
    expect(block).toContain("<tracker-id>");
    expect(block.toLowerCase()).toContain("never guess");
  });
});

describe("STE-66 AC-STE-66.5 — /brainstorm phase 4 cross-reference", () => {
  test("brainstorm SKILL.md phase 4 points at /spec-write for the rule", () => {
    const body = readSkill(brainstormPath);
    const phase4 = body.indexOf("### 4. Hand Off to Spec Write");
    expect(phase4).toBeGreaterThan(0);
    const nextSection = body.indexOf("\n## ", phase4 + 1);
    const block = body.slice(phase4, nextSection > 0 ? nextSection : undefined);
    // Cross-reference to /spec-write — either the literal slash command or
    // the §0b anchor is sufficient.
    expect(block.toLowerCase()).toMatch(/\/spec-write|spec-write.*§\s*0b/);
    expect(block).toContain("<tracker-id>");
  });
});
