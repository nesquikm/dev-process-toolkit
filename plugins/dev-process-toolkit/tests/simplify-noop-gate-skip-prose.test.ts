import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// STE-174 — /simplify SKILL.md "Verify" step documents the no-op gate-skip
// conditional. Doc-conformance only.

const pluginRoot = join(import.meta.dir, "..");
const skillPath = join(pluginRoot, "skills", "simplify", "SKILL.md");

function readSkill(): string {
  return readFileSync(skillPath, "utf8");
}

describe("STE-174 AC-STE-174.1 — Verify step states the no-op gate-skip rule", () => {
  test("prose carries the canonical 'no refactors are warranted' phrasing", () => {
    const body = readSkill();
    expect(body).toMatch(/no refactors are warranted/i);
    expect(body).toMatch(/gate re-run is skipped/i);
  });

  test("prose explains why (wasted tokens) + where to find the active gate stamp", () => {
    const body = readSkill();
    expect(body).toMatch(/wasted tokens/i);
    expect(body).toMatch(/\/implement|\/gate-check/);
    expect(body).toMatch(/gate stamp/i);
  });
});

describe("STE-174 AC-STE-174.2 — grep returns the canonical match cluster", () => {
  test("grep -nE 'no refactors are warranted|gate re-run is skipped' returns at least 1 hit each", () => {
    const body = readSkill();
    expect(body.match(/no refactors are warranted/gi)?.length || 0).toBeGreaterThanOrEqual(1);
    expect(body.match(/gate re-run is skipped/gi)?.length || 0).toBeGreaterThanOrEqual(1);
  });
});

describe("STE-174 AC-STE-174.3 — pre-existing 'Run gate check' instruction is preserved", () => {
  test("the existing Verify step still names a gate-check command", () => {
    const body = readSkill();
    // The new sentence is an addendum, not a replacement.
    expect(body).toMatch(/4\.\s*\*\*Verify\*\*/);
    expect(body).toMatch(/gate check|gate-check/i);
  });
});
