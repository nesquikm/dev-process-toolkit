// STE-378 AC-STE-378.1 / AC-STE-378.3 / AC-STE-378.6 — meta-tests for the
// `## Token Stats` config convention.
//
// Pure file-shape greps (no source import) over three surfaces:
//   1. templates/CLAUDE.md.template carries an ALWAYS-EMITTED `## Token Stats`
//      heading followed by `enabled: false` (AC-STE-378.1).
//   2. docs/layout-reference.md documents the `## Token Stats` CLAUDE.md
//      convention + the closed key set `{enabled}` (AC-STE-378.1).
//   3. skills/setup/SKILL.md carries the new one-at-a-time interview step
//      (token stats + AskUserQuestion + default false + atomic/full-section
//      splice + `[current` re-run handling) (AC-STE-378.3).
//
// All three assert the FINAL desired state — RED until the implementer lands
// the template block, the doc paragraph, and the /setup step.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const pluginRoot = join(import.meta.dir, "..");
const templatePath = join(pluginRoot, "templates", "CLAUDE.md.template");
const layoutRefPath = join(pluginRoot, "docs", "layout-reference.md");
const setupSkillPath = join(pluginRoot, "skills", "setup", "SKILL.md");

function read(path: string): string {
  return readFileSync(path, "utf-8");
}

/**
 * Return the slice of `body` from the `## Token Stats` heading up to (but not
 * including) the next `## ` heading — the live config block. Empty string
 * when the heading is absent.
 */
function tokenStatsBlock(body: string): string {
  const lines = body.split("\n");
  const start = lines.findIndex((l) => l === "## Token Stats");
  if (start < 0) return "";
  const rest = lines.slice(start + 1);
  const nextHeading = rest.findIndex((l) => /^## /.test(l));
  const end = nextHeading < 0 ? rest.length : nextHeading;
  return rest.slice(0, end).join("\n");
}

/**
 * Return the slice of the setup SKILL.md that belongs to the new token-stats
 * interview step — from the `### 7?. …Token Stats…` heading to the next
 * `### ` / `## ` heading. Empty string when no such step heading exists.
 */
function tokenStatsSetupStep(body: string): string {
  const lines = body.split("\n");
  const start = lines.findIndex(
    (l) => /^###\s/.test(l) && /token[\s-]?stats/i.test(l),
  );
  if (start < 0) return "";
  const rest = lines.slice(start + 1);
  const nextHeading = rest.findIndex((l) => /^#{2,3}\s/.test(l));
  const end = nextHeading < 0 ? rest.length : nextHeading;
  return rest.slice(0, end).join("\n");
}

describe("AC-STE-378.1 — CLAUDE.md.template carries the always-emitted `## Token Stats` block", () => {
  test("template has a literal `## Token Stats` heading at column 0", () => {
    const body = read(templatePath);
    expect(body).toMatch(/^## Token Stats$/m);
  });

  test("template seeds `enabled: false` (default-off) inside the `## Token Stats` block", () => {
    const body = read(templatePath);
    const block = tokenStatsBlock(body);
    expect(block).toMatch(/^enabled: false$/m);
  });
});

describe("AC-STE-378.1 — layout-reference documents the `## Token Stats` convention", () => {
  test("layout-reference names the closed key set `{enabled}`", () => {
    const body = read(layoutRefPath);
    expect(body).toContain("{enabled}");
  });

  test("layout-reference describes `{enabled}` as a CLOSED key set (mirrors `## Verification`)", () => {
    const body = read(layoutRefPath);
    expect(body).toMatch(
      /closed[\s\S]{0,160}\{enabled\}|\{enabled\}[\s\S]{0,160}closed/i,
    );
  });
});

describe("AC-STE-378.3 — /setup SKILL.md carries the new token-stats interview step", () => {
  test("a Step-7 sibling heading introduces the token-stats step", () => {
    const body = read(setupSkillPath);
    const step = tokenStatsSetupStep(body);
    expect(step.length).toBeGreaterThan(0);
  });

  test("the step asks via AskUserQuestion with a safe default of false", () => {
    const step = tokenStatsSetupStep(read(setupSkillPath));
    expect(step).toContain("AskUserQuestion");
    expect(step).toMatch(/default[:\s*]+false/i);
  });

  test("the step always writes the `## Token Stats` section atomically (full-section splice)", () => {
    const step = tokenStatsSetupStep(read(setupSkillPath));
    expect(step).toContain("## Token Stats");
    expect(step).toMatch(/atomic/i);
    expect(step).toMatch(/full[\s-]?(section|block)/i);
  });

  test("the re-run path shows `[current: <bool>]` and empty keeps the current value", () => {
    const step = tokenStatsSetupStep(read(setupSkillPath));
    expect(step).toContain("[current");
  });
});
