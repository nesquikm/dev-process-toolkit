import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Prose convention gates for STE-87 AC-STE-87.3, AC-STE-87.9, AC-STE-87.10.
//
// - /implement `## Rules` section adds a tracker-write-routing rule that
//   forbids raw `mcp__<tracker>__save_issue` / `transition_status` writes on
//   in-flight FRs during an /implement session. Reads remain permitted.
// - /brainstorm and /spec-write `## Rules` sections add the same
//   conversational-leak rule verbatim, forbidding narration of a specific
//   unallocated tracker ID when drafting.
//
// Same shape as spec-write-placeholder-convention.test.ts — grep-based,
// no runtime. Regression guard: if a future edit silently strips these
// rules, the deterministic write-routing + conversational-leak guardrails
// revert to undocumented tribal knowledge.

const pluginRoot = join(import.meta.dir, "..");
const implementPath = join(pluginRoot, "skills", "implement", "SKILL.md");
const brainstormPath = join(pluginRoot, "skills", "brainstorm", "SKILL.md");
const specWritePath = join(pluginRoot, "skills", "spec-write", "SKILL.md");

function readSkill(path: string): string {
  return readFileSync(path, "utf8");
}

function rulesBlock(body: string): string {
  const start = body.indexOf("\n## Rules");
  expect(start).toBeGreaterThan(-1);
  // End of the Rules section is the next `## ` heading.
  const remainder = body.slice(start + 1);
  const endRel = remainder.search(/\n## \S/);
  return endRel === -1 ? body.slice(start) : body.slice(start, start + 1 + endRel);
}

describe("AC-STE-87.3 — /implement tracker-write routing rule", () => {
  test("implement SKILL.md ## Rules forbids raw mcp__<tracker>__save_issue on in-flight FRs", () => {
    const rules = rulesBlock(readSkill(implementPath));
    expect(rules).toMatch(/mcp__<tracker>__save_issue/);
    expect(rules).toMatch(/mcp__<tracker>__transition_status/);
    // The rule must scope itself to in-flight FRs (not a blanket ban on MCP).
    expect(rules.toLowerCase()).toContain("in-flight");
  });

  test("rule routes writes through Provider.claimLock / Provider.releaseLock", () => {
    const rules = rulesBlock(readSkill(implementPath));
    expect(rules).toMatch(/Provider\.claimLock/);
    expect(rules).toMatch(/Provider\.releaseLock/);
  });

  test("rule explicitly permits read operations (get_issue for display)", () => {
    const rules = rulesBlock(readSkill(implementPath));
    expect(rules).toMatch(/mcp__<tracker>__get_issue/);
    // "fine" or "permitted" or similar — the exclusion must be unambiguous
    // so the LLM doesn't over-apply the rule to read paths.
    expect(rules.toLowerCase()).toMatch(/fine|permitted|allowed/);
  });

  test("rule references STE-65 as the rationale (guardrail fires only on Provider path)", () => {
    const rules = rulesBlock(readSkill(implementPath));
    expect(rules).toMatch(/STE-65/);
  });
});

describe("AC-STE-87.9 — /brainstorm conversational-leak rule", () => {
  test("brainstorm SKILL.md ## Rules forbids narrating unallocated tracker IDs", () => {
    const rules = rulesBlock(readSkill(brainstormPath));
    expect(rules).toMatch(/unallocated tracker ID/i);
    // The placeholder convention must be cited so the reader knows the fix.
    expect(rules).toContain("<tracker-id>");
  });

  test("brainstorm rule cross-references STE-66 (draft-file placeholder) as the sibling coverage", () => {
    const rules = rulesBlock(readSkill(brainstormPath));
    expect(rules).toMatch(/STE-66/);
  });

  test("brainstorm rule names the conversational-hazard scope (chat, not file)", () => {
    const rules = rulesBlock(readSkill(brainstormPath));
    // Must distinguish conversational speech from file content so the
    // rule doesn't collapse into STE-66's file-level probe.
    expect(rules.toLowerCase()).toMatch(/conversation|conversational|chat|narrat/);
  });
});

describe("AC-STE-87.10 — /spec-write conversational-leak rule", () => {
  test("spec-write SKILL.md ## Rules carries the same rule as /brainstorm", () => {
    const rules = rulesBlock(readSkill(specWritePath));
    expect(rules).toMatch(/unallocated tracker ID/i);
    expect(rules).toContain("<tracker-id>");
    expect(rules).toMatch(/STE-66/);
    expect(rules.toLowerCase()).toMatch(/conversation|conversational|chat|narrat/);
  });

  test("spec-write rule is verbatim with /brainstorm rule (AC-STE-87.10 explicit)", () => {
    // Extract the rule line from each file and compare. The AC says "same line
    // verbatim" — lock that in so a future edit to one doesn't silently drift
    // from the other.
    const extractLeakRule = (body: string): string => {
      const rules = rulesBlock(body);
      const match = rules.match(/^- Do NOT narrate[^\n]*$/m);
      expect(match).not.toBeNull();
      return match![0];
    };
    const brainstormRule = extractLeakRule(readSkill(brainstormPath));
    const specWriteRule = extractLeakRule(readSkill(specWritePath));
    expect(specWriteRule).toBe(brainstormRule);
  });
});
