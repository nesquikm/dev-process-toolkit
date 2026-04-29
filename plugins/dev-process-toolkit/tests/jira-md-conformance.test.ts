import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// STE-154 (M43) — Jira adapter Phase H live-MCP conformance.
//
// Locks the post-conditions of the bulk doc rewrite of `adapters/jira.md`
// against smoke-test #5 (2026-04-29) findings F1–F7. Every `expect()` here
// corresponds to an AC-STE-154.<N> checkbox in `specs/plan/M43.md`.

const pluginRoot = join(import.meta.dir, "..");
const jiraPath = join(pluginRoot, "adapters", "jira.md");
const body = readFileSync(jiraPath, "utf8");

describe("AC-STE-154.1 — MCP tool table uses live camelCase names", () => {
  test("snake_case Atlassian tool names from the provisional table are gone", () => {
    // The plan's verify line: zero hits of mcp__atlassian__(get|update|transition|create)_(issue|transitions).
    expect(body).not.toMatch(/mcp__atlassian__(get|update|transition|create)_(issue|transitions)/);
  });

  for (const name of [
    "getJiraIssue",
    "editJiraIssue",
    "transitionJiraIssue",
    "getTransitionsForJiraIssue",
    "createJiraIssue",
    "addCommentToJiraIssue",
  ]) {
    test(`mentions live tool name \`${name}\``, () => {
      expect(body).toContain(name);
    });
  }
});

describe("AC-STE-154.2 — transition_status documents name-then-category fallback", () => {
  test("operation section describes the canonical-category fallback", () => {
    expect(body).toMatch(/statusCategory\.key/);
    expect(body).toMatch(/canonicalCategory/);
  });

  test("in_review collapses to indeterminate is documented", () => {
    expect(body).toMatch(/in_review[\s\S]{0,80}indeterminate/i);
  });
});

describe("AC-STE-154.3 — jira_ac_field accepts `description` sentinel", () => {
  test("both Schema L value forms appear as backtick-quoted literals", () => {
    // Operator-facing dispatch keys in `## Task Tracking`. Order is
    // doc-author choice; both must be present and unambiguously quoted so a
    // bare `description` token mid-prose can't satisfy the assertion.
    expect(body).toMatch(/`jira_ac_field:\s*description`/);
    expect(body).toMatch(/`jira_ac_field:\s*customfield_/);
  });
});

describe("AC-STE-154.4 — pull_acs / push_ac_toggle dispatch on jira_ac_field value", () => {
  test("pull_acs section describes both branches", () => {
    const m = body.match(/###\s+`pull_acs[\s\S]+?(?=\n##+\s|$)/);
    expect(m).not.toBeNull();
    const section = m![0];
    expect(section).toMatch(/description/);
    expect(section).toMatch(/customfield_|custom-field/i);
    expect(section).toMatch(/## Acceptance Criteria/);
  });

  test("push_ac_toggle section describes both branches", () => {
    const m = body.match(/###\s+`push_ac_toggle[\s\S]+?(?=\n##+\s|$)/);
    expect(m).not.toBeNull();
    const section = m![0];
    expect(section).toMatch(/description/);
    expect(section).toMatch(/customfield_|custom-field/i);
  });
});

describe("AC-STE-154.5 — upsert_ticket_metadata defaults Task + jira_issue_type override", () => {
  test("the hard-coded `issuetype=\"Story\"` is gone", () => {
    expect(body).not.toMatch(/issuetype="Story"/);
  });

  test("the operation section names `Task` as the default", () => {
    const m = body.match(/###\s+`upsert_ticket_metadata[\s\S]+?(?=\n##+\s|$)/);
    expect(m).not.toBeNull();
    const section = m![0];
    expect(section).toMatch(/Task/);
    expect(section).toMatch(/jira_issue_type/);
  });
});

describe("AC-STE-154.6 — contentFormat: \"markdown\" documented on three ops", () => {
  for (const op of ["pull_acs", "push_ac_toggle", "upsert_ticket_metadata"]) {
    test(`${op} section mentions contentFormat: "markdown"`, () => {
      const m = body.match(new RegExp(`###\\s+\`${op}[\\s\\S]+?(?=\\n##+\\s|$)`));
      expect(m).not.toBeNull();
      const section = m![0];
      expect(section).toMatch(/contentFormat[^\n]*markdown/);
    });
  }
});

describe("AC-STE-154.7 — Space pre-creation + getVisibleJiraProjects visibility check", () => {
  test("jira.md documents manual Space pre-creation", () => {
    expect(body).toMatch(/create the Space[\s\S]{0,80}before running/i);
  });

  test("jira.md references getVisibleJiraProjects visibility probe", () => {
    expect(body).toContain("getVisibleJiraProjects");
  });
});

describe("AC-STE-154.8 — provisional warnings replaced with live-MCP provenance", () => {
  test("zero `provisional` hits in jira.md", () => {
    expect(body).not.toMatch(/provisional/i);
  });

  test("provenance line names the live-MCP verification date", () => {
    expect(body).toMatch(/Verified against live MCP 2026-04-29 \(smoke-test #5\)/);
  });
});
