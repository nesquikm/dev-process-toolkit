import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// STE-154 (M43) — /setup Jira branch carries the AC-discovery + Space-visibility prose.
//
// Two surfaces matter: SKILL.md (the operator-facing summary) routes to
// docs/setup-tracker-mode.md (the long-form). M43 extends both:
// AC-STE-154.3 — prompt + persist `jira_ac_field: description | customfield_XXXXX`
// AC-STE-154.7 — Space pre-creation + getVisibleJiraProjects visibility probe

const pluginRoot = join(import.meta.dir, "..");
const setupSkillPath = join(pluginRoot, "skills", "setup", "SKILL.md");
const setupTrackerDocPath = join(pluginRoot, "docs", "setup-tracker-mode.md");

const skill = readFileSync(setupSkillPath, "utf8");
const trackerDoc = readFileSync(setupTrackerDocPath, "utf8");

describe("AC-STE-154.3 — Jira AC-field prompt branches in /setup", () => {
  test("setup-tracker-mode.md documents the no-field prompt with both choices", () => {
    // Prose names both the description sentinel and the customfield_XXXXX form
    // as the two persisted values for jira_ac_field.
    expect(trackerDoc).toMatch(/jira_ac_field:\s*description/);
    expect(trackerDoc).toMatch(/jira_ac_field:\s*customfield_/);
  });

  test("setup-tracker-mode.md explains the discover_field { ok: false } prompt branch", () => {
    expect(trackerDoc).toMatch(/ok:\s*false/);
    expect(trackerDoc).toMatch(/prompt|choose|select/i);
  });

  test("SKILL.md keeps jira_ac_field as a canonical Schema L key", () => {
    // task_tracking_canonical_keys.ts holds the closed set; SKILL.md must continue
    // to enumerate jira_ac_field there. M43 adds extended-value semantics, not a new key.
    expect(skill).toContain("jira_ac_field");
  });
});

describe("AC-STE-154.7 — Jira Space pre-creation + visibility probe", () => {
  test("setup-tracker-mode.md documents manual Space pre-creation", () => {
    expect(trackerDoc).toMatch(/create the (Jira )?Space[\s\S]{0,200}before running/i);
  });

  test("setup-tracker-mode.md routes through getVisibleJiraProjects", () => {
    expect(trackerDoc).toContain("getVisibleJiraProjects");
  });

  test("setup-tracker-mode.md spells out the NFR-10 refusal shape on no-visibility", () => {
    // The refusal text follows the canonical shape used elsewhere in /setup.
    expect(trackerDoc).toMatch(/Remedy:[\s\S]+/);
    expect(trackerDoc).toMatch(/Context:[\s\S]+skill=setup/);
  });
});
