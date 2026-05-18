// STE-303 AC-STE-303.9 — Adapter Schema W must declare
// `list_project_statuses: true` for the two shipped MCP-backed adapters
// (Linear, Jira). The `_template.md` is exempt: custom adapters opt in.
//
// Schema W is the capability declaration block in adapter frontmatter.
// `project_milestone: true` (already shipped on Linear) is the precedent
// shape — a flat key:value pair declaring an opt-in capability. This test
// locks the new `list_project_statuses` key onto Linear + Jira.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const pluginRoot = join(import.meta.dir, "..");
const linearPath = join(pluginRoot, "adapters", "linear.md");
const jiraPath = join(pluginRoot, "adapters", "jira.md");

function read(path: string): string {
  return readFileSync(path, "utf8");
}

function frontmatter(body: string): string {
  // Frontmatter is the leading `---\n...\n---\n` block.
  const m = body.match(/^---\n([\s\S]*?)\n---\n/);
  expect(m).not.toBeNull();
  return m![1];
}

describe("AC-STE-303.9 — linear.md frontmatter declares list_project_statuses: true", () => {
  test("frontmatter contains the literal `list_project_statuses: true` key", () => {
    const body = read(linearPath);
    const fm = frontmatter(body);
    expect(fm).toMatch(/^list_project_statuses:\s*true\s*$/m);
  });

  test("body documents the canonical MCP call for the list_project_statuses capability", () => {
    const body = read(linearPath);
    // FR locks the call to `mcp__linear__list_issue_statuses`. The adapter
    // doc must reference this MCP tool name when describing the capability.
    expect(body).toContain("mcp__linear__list_issue_statuses");
    expect(body).toMatch(/list_project_statuses/);
  });
});

describe("AC-STE-303.9 — jira.md frontmatter declares list_project_statuses: true", () => {
  test("frontmatter contains the literal `list_project_statuses: true` key", () => {
    const body = read(jiraPath);
    const fm = frontmatter(body);
    expect(fm).toMatch(/^list_project_statuses:\s*true\s*$/m);
  });

  test("body documents the canonical MCP call for the list_project_statuses capability", () => {
    const body = read(jiraPath);
    // FR notes: candidate calls are getJiraIssueTypeMetaWithFields,
    // searchJiraIssuesUsingJql, or a dedicated workflow endpoint. The
    // adapter doc must name a `mcp__atlassian__` MCP tool inside the
    // list_project_statuses section.
    expect(body).toMatch(/list_project_statuses/);
    // Section anchored: find the `list_project_statuses` capability section
    // and assert it names at least one mcp__atlassian__ tool.
    const sectionMatch = body.match(
      /list_project_statuses[\s\S]{0,1200}?mcp__atlassian__\w+/,
    );
    expect(sectionMatch).not.toBeNull();
  });
});
