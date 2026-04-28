// Regression guards for STE-70 — the `/docs` skill file.
//
// Covers AC-STE-70.1 (skill file exists at canonical path + frontmatter),
// AC-STE-70.2 (mutually-exclusive flag refusal shape), AC-STE-70.6
// (DocsConfig gate refusal shape), AC-STE-70.7 (NFR-1 300-line budget +
// docs-reference.md overflow pointer), AC-STE-70.8 (nav-contract gate
// reference), plus AC-STE-71.7 / AC-STE-72.3 verbatim-constraint wording.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const pluginRoot = join(import.meta.dir, "..");
const skillPath = join(pluginRoot, "skills", "docs", "SKILL.md");
const referencePath = join(pluginRoot, "docs", "docs-reference.md");
const setupSkillPath = join(pluginRoot, "skills", "setup", "SKILL.md");
const setupDocsModeRefPath = join(pluginRoot, "docs", "setup-docs-mode.md");

describe("STE-70 AC-STE-70.1 — /docs skill exists with canonical frontmatter", () => {
  test("skill file exists at plugins/dev-process-toolkit/skills/docs/SKILL.md", () => {
    const body = readFileSync(skillPath, "utf-8");
    expect(body.length).toBeGreaterThan(0);
  });

  test("frontmatter name is 'docs' and description advertises the three flags", () => {
    const body = readFileSync(skillPath, "utf-8");
    expect(body).toMatch(/^---\nname:\s*docs\n/);
    expect(body).toMatch(/description:[^\n]*--quick[\s\S]*--commit[\s\S]*--full/);
  });
});

describe("STE-70 AC-STE-70.2 — mutually-exclusive flag refusal", () => {
  test("skill body documents the three-flag contract and NFR-10 refusal wording", () => {
    const body = readFileSync(skillPath, "utf-8");
    expect(body).toContain("mutually exclusive");
    // NFR-10 remedy cites the three flag names and names the tracker-mode
    // + skill-name context fields.
    expect(body).toContain("--quick");
    expect(body).toContain("--commit");
    expect(body).toContain("--full");
    expect(body).toContain("Remedy: pick exactly one");
    expect(body).toContain("skill=docs");
  });
});

describe("STE-70 AC-STE-70.6 — DocsConfig gate refusal shape", () => {
  test("skill body documents the 'docs generation is not configured' NFR-10 message", () => {
    const body = readFileSync(skillPath, "utf-8");
    expect(body).toContain("docs generation is not configured for this project");
    expect(body).toContain("user_facing_mode");
    expect(body).toContain("packages_mode");
  });
});

describe("STE-70 AC-STE-70.7 — NFR-1 budget + reference overflow", () => {
  test("SKILL.md is ≤ 300 lines", () => {
    const body = readFileSync(skillPath, "utf-8");
    const lines = body.split("\n").length;
    expect(lines).toBeLessThanOrEqual(300);
  });

  test("SKILL.md links to docs-reference.md for the overflow content", () => {
    const body = readFileSync(skillPath, "utf-8");
    expect(body).toMatch(/docs\/docs-reference\.md/);
  });

  test("docs-reference.md exists and hosts the LLM prompts + merge algorithm", () => {
    const body = readFileSync(referencePath, "utf-8");
    expect(body).toContain("Quick-fragment prompt");
    expect(body).toContain("Packages-mode prompt");
    expect(body).toContain("Merge algorithm");
  });
});

describe("STE-70 AC-STE-70.8 — nav-contract gate on --commit / --full", () => {
  test("skill references runNavContractProbe on --commit and explicitly bypasses on --full", () => {
    const body = readFileSync(skillPath, "utf-8");
    expect(body).toContain("runNavContractProbe");
    // --full path documented as the recovery path that bypasses the nav
    // contract probe.
    expect(body).toMatch(/Bypasses the nav-contract gate|bypass(es)? the nav-contract/i);
  });
});

describe("STE-71 AC-STE-71.7 + STE-72 AC-STE-72.3 — verbatim LLM constraints present", () => {
  test("docs-reference.md contains the ImpactSet verbatim constraint (AC-STE-71.7)", () => {
    const body = readFileSync(referencePath, "utf-8");
    // Key tokens from AC-STE-71.7's prescribed wording.
    expect(body).toContain("Write fragments ONLY for items in this set");
    expect(body).toContain("Reproduce symbol names verbatim");
  });

  test("docs-reference.md contains the SignatureGroundTruth verbatim constraint (AC-STE-72.3)", () => {
    const body = readFileSync(referencePath, "utf-8");
    // Whitespace-normalize so prompt line-wraps don't break substring matches.
    const normalized = body.replace(/\s+/g, " ");
    expect(normalized).toContain("reproduce each signature verbatim");
    expect(normalized).toContain("Do NOT alter signatures");
    expect(normalized).toContain("Do NOT add signatures not in this list");
  });
});

describe("STE-72 AC-STE-72.6 — /setup prompt 2 augmented with probe result", () => {
  test("setup SKILL.md includes the typedoc/ts-morph/stack probe parenthetical on prompt 2", () => {
    const body = readFileSync(setupSkillPath, "utf-8");
    expect(body).toContain("typedoc <detected|not found>");
    expect(body).toContain("ts-morph <bundled>");
    expect(body).toContain("stack: <ts|other>");
  });

  test("setup-docs-mode.md reference mirrors the augmented prompt wording", () => {
    const body = readFileSync(setupDocsModeRefPath, "utf-8");
    expect(body).toContain("typedoc <detected|not found>");
    expect(body).toContain("ts-morph <bundled>");
    expect(body).toContain("AC-STE-72.6");
  });
});
