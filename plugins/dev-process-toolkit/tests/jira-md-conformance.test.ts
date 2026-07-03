import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// STE-154 (M43) — Jira adapter Phase H live-MCP conformance.
//
// Locks the post-conditions of the bulk doc rewrite of `adapters/jira.md`
// against smoke-test #5 (2026-04-29) findings F1–F7. Every `expect()` here
// corresponds to an AC-STE-154.<N> checkbox in `specs/plan/M43.md`.
//
// Extended by STE-361 (M96): the `list_project_statuses` status-fetch
// documentation must carry the two-path probe order (company-managed
// `allowedValues` vs. team-managed transitions-derived) — see the
// AC-STE-361.<N> describe blocks at the bottom of this file.

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

// ---------------------------------------------------------------------------
// STE-361 (M96) — transitions API as primary status-vocabulary path for
// team-managed projects. Provenance: /conformance-loop iter-2 2026-07-02
// finding F5 — `getJiraIssueTypeMetaWithFields` returns no `allowedValues`
// for team-managed (`"simplified": true`) projects; the healthy /setup
// grandchild recovered by reading issue transitions on DST-44 unprompted.
// ---------------------------------------------------------------------------

/**
 * Extract the status-fetch documentation region for `list_project_statuses`
 * from `adapters/jira.md`: a dedicated heading section (any `##`+ level whose
 * heading line names the operation), if one exists, concatenated with every
 * MCP-tool-table row that names the operation. Tolerant of either doc shape
 * (table-row-only vs. table row + prose section) so the assertion targets the
 * content, not the layout.
 */
function statusFetchRegion(doc: string): string {
  const parts: string[] = [];
  const section = doc.match(/#{2,4}\s+[^\n]*list_project_statuses[\s\S]+?(?=\n##+\s|$)/);
  if (section) parts.push(section[0]);
  for (const line of doc.split("\n")) {
    if (line.startsWith("|") && line.includes("list_project_statuses")) parts.push(line);
  }
  return parts.join("\n");
}

describe("AC-STE-361.1 — status-fetch documents the two-path probe order", () => {
  const region = statusFetchRegion(body);

  test("the status-fetch region exists", () => {
    expect(region.length).toBeGreaterThan(0);
  });

  test("probe step 1: project-style detection via getVisibleJiraProjects `\"simplified\": true`", () => {
    expect(region).toContain("getVisibleJiraProjects");
    expect(region).toMatch(/"simplified":\s*true/);
    expect(region).toMatch(/team-managed/);
  });

  test("allowedValues path is scoped company-managed-only", () => {
    expect(region).toContain("getJiraIssueTypeMetaWithFields");
    expect(region).toMatch(/allowedValues[\s\S]{0,300}?company-managed|company-managed[\s\S]{0,300}?allowedValues/);
  });

  test("transitions-derived path is primary for team-managed projects", () => {
    expect(region).toContain("getTransitionsForJiraIssue");
    expect(region).toMatch(/to\.name/);
    expect(region).toMatch(/team-managed[\s\S]{0,300}?primary|primary[\s\S]{0,300}?team-managed/i);
  });

  test("probe order: style detection precedes the transitions-derived dispatch", () => {
    const detection = region.search(/"simplified":\s*true/);
    const transitions = region.indexOf("getTransitionsForJiraIssue");
    expect(detection).toBeGreaterThan(-1);
    expect(transitions).toBeGreaterThan(-1);
    expect(detection).toBeLessThan(transitions);
  });

  test("transitions path dedups `to.name` preserving first occurrence, in API order", () => {
    expect(region).toMatch(/dedup/i);
    expect(region).toMatch(/first occurrence/i);
    expect(region).toMatch(/API order/i);
  });

  test("zero-issue edge: statusCategory-names fallback with an mcp_unavailable-style advisory", () => {
    expect(region).toMatch(/no issues?/i);
    expect(region).toMatch(/statusCategory/);
    expect(region).toContain("tracker_config_write_mcp_unavailable");
  });

  test("AC-STE-303.3 output contract preserved: ordered verbatim string array", () => {
    expect(region).toMatch(/ordered string array/);
    expect(region).toMatch(/verbatim/);
  });
});

describe("AC-STE-361.2 — skill-prose references to the allowedValues fetch name the team-managed fallback", () => {
  const setupSkillPath = join(pluginRoot, "skills", "setup", "SKILL.md");
  const setupBody = readFileSync(setupSkillPath, "utf8");

  test("/setup step 7f tracker-config names the team-managed fallback ordering", () => {
    const m = setupBody.match(/###\s+7f\. Tracker-config write[\s\S]+?(?=\n###?\s)/);
    expect(m).not.toBeNull();
    const section = m![0];
    expect(section).toMatch(/allowedValues/);
    expect(section).toMatch(/team-managed/);
    expect(section).toMatch(/fallback|falls back/i);
    // The fallback must be attributed to team-managed projects, not incidental.
    expect(section).toMatch(/team-managed[\s\S]{0,200}?transitions|transitions[\s\S]{0,200}?team-managed/i);
  });

  test("meta-sweep: every skills/docs prose file naming allowedValues also names the team-managed fallback", () => {
    const markdownFilesUnder = (dir: string): string[] =>
      (readdirSync(dir, { recursive: true }) as string[])
        .filter((p) => p.endsWith(".md"))
        .map((p) => join(dir, p));

    const offenders: string[] = [];
    for (const path of [
      ...markdownFilesUnder(join(pluginRoot, "skills")),
      ...markdownFilesUnder(join(pluginRoot, "docs")),
    ]) {
      const text = readFileSync(path, "utf8");
      if (!text.includes("allowedValues")) continue;
      if (!/team-managed/.test(text) || !/fallback|falls back/i.test(text)) offenders.push(path);
    }
    expect(offenders).toEqual([]);
  });
});
