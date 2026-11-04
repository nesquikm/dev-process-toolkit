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
import { renderSettingsPointer } from "../adapters/_shared/src/project_settings";

const pluginRoot = join(import.meta.dir, "..");
const templatePath = join(pluginRoot, "templates", "CLAUDE.md.template");
const layoutRefPath = join(pluginRoot, "docs", "layout-reference.md");
const setupSkillPath = join(pluginRoot, "skills", "setup", "SKILL.md");

function read(path: string): string {
  return readFileSync(path, "utf-8");
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

describe("AC-STE-378.1 — the always-emitted Token Stats default lives in the settings file", () => {
  // Amended by M_94e6f7/STE-710 (AC-.9): the `## Token Stats` block left the template;
  // the flag is `tracking.token_stats` in specs/settings.yaml, reached through the
  // template's `## Project Settings` pointer and documented in docs/settings-reference.md.
  test("template carries the `## Project Settings` pointer at column 0 in place of `## Token Stats`", () => {
    // Amended by M_94e6f7/STE-710 (AC-.9): the column-0 heading the reader finds is now the settings pointer.
    const body = read(templatePath);
    expect(body).toMatch(/^## Project Settings$/m);
    expect(body).not.toMatch(/^## Token Stats$/m);
    expect(body).toContain(renderSettingsPointer("3.0.0"));
  });

  test("`tracking.token_stats` defaults to `{ enabled: false }` (default-off)", () => {
    // Amended by M_94e6f7/STE-710 (AC-.9): the `enabled: false` seed is the settings-reference default of `tracking.token_stats`.
    const body = read(join(pluginRoot, "docs", "settings-reference.md"));
    expect(body).toMatch(/^\| `tracking\.token_stats` \| block `\{ enabled: boolean \}` \| `\{ enabled: false \}` \|/m);
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
