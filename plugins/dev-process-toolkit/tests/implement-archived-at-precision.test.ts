import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// STE-158 AC-STE-158.2 — `archived_at` precision contract.
//
// Smoke #6 finding F1 (Jira): an archived FR landed with
// `archived_at: 2026-04-29T00:00:00Z` while the actual archive commit
// landed at ~17:23 local. The shape is ISO-8601, but the time component
// is zeroed.
//
// Decision (M45): the contract is **full ISO-8601 with non-zero time**
// (date + time + Z). The skill prose for /implement Phase 4 step 14 and
// /spec-archive must spec the canonical timestamp form unambiguously,
// not the looser placeholder `<ISO now>` that the LLM renders as
// midnight UTC.
//
// The implementation is LLM-driven prose; the test is a doc-conformance
// probe.

const pluginRoot = join(import.meta.dir, "..");
const implementSkill = join(pluginRoot, "skills", "implement", "SKILL.md");
const specArchiveSkill = join(pluginRoot, "skills", "spec-archive", "SKILL.md");
const implementRef = join(pluginRoot, "docs", "implement-reference.md");

function read(path: string): string {
  return readFileSync(path, "utf8");
}

describe("AC-STE-158.2 — implement SKILL.md spec the full-ISO-8601 archived_at contract", () => {
  test("implement SKILL.md prose names the date+time+Z (non-zero time) contract", () => {
    const body = read(implementSkill);
    // Prose must explicitly call for the full ISO-8601 timestamp shape, not
    // just the loose `<ISO now>` placeholder. Anchor on the precision call-out.
    expect(body).toMatch(/full ISO-?8601|date \+ time \+ Z|non-zero time|YYYY-MM-DDTHH:MM:SSZ/i);
  });

  test("implement SKILL.md prose explicitly bans date-only / midnight rendering", () => {
    const body = read(implementSkill);
    // The smoke regression was the LLM rendering `<ISO now>` as midnight
    // UTC. Prose must bar that form so the prompt is unambiguous.
    expect(body).toMatch(/not date-only|not zero(?:ed)? time|do not zero|reject midnight|T00:00:00Z/i);
  });
});

describe("AC-STE-158.2 — spec-archive SKILL.md mirrors the same contract", () => {
  test("spec-archive SKILL.md prose names the full-ISO-8601 contract", () => {
    const body = read(specArchiveSkill);
    expect(body).toMatch(/full ISO-?8601|date \+ time \+ Z|non-zero time|YYYY-MM-DDTHH:MM:SSZ/i);
  });
});

describe("AC-STE-158.2 — docs/implement-reference.md mirrors the same contract", () => {
  test("docs/implement-reference.md prose names the full-ISO-8601 contract", () => {
    const body = read(implementRef);
    expect(body).toMatch(/full ISO-?8601|date \+ time \+ Z|non-zero time|YYYY-MM-DDTHH:MM:SSZ/i);
  });
});
