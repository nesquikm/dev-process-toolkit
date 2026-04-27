import { describe, expect, test } from "bun:test";
import { computeWorkspaceMigrationDiff } from "../scripts/migrate-task-tracking-add-workspace";

// STE-117 AC-STE-117.9 — `migrate-task-tracking-add-workspace.ts` (dry-run).
//
// Reads CLAUDE.md, detects active adapter from `mode:`, and emits a unified
// diff that adds a `### Linear` (`team:` + `project:`) or `### Jira`
// (`project:`) sub-section under `## Task Tracking`.
//
// Test scope:
//   (a) clean tracker mode without sub-section → diff inserts canonical sub-section
//   (b) sub-section already present (idempotent) → empty diff
//   (c) `mode: none` → empty diff (vacuous, nothing to migrate)
//   (d) section absent → empty diff
//   (e) Jira mode emits `### Jira` with `project:` only

describe("(a) Linear mode without sub-section → inserts ### Linear", () => {
  test("appends `### Linear` block with team + project", () => {
    const body = [
      "# Project",
      "",
      "## Task Tracking",
      "",
      "mode: linear",
      "mcp_server: linear",
      "jira_ac_field:",
      "",
    ].join("\n");
    const diff = computeWorkspaceMigrationDiff(body, "CLAUDE.md", {
      adapter: "linear",
      team: "STE",
      project: "DPT — Dev Process Toolkit",
    });
    expect(diff).not.toBe("");
    expect(diff).toMatch(/\+### Linear/);
    expect(diff).toMatch(/\+team: STE/);
    expect(diff).toMatch(/\+project: DPT — Dev Process Toolkit/);
  });
});

describe("(b) sub-section already present → empty diff (idempotent)", () => {
  test("Linear sub-section already populated → no change", () => {
    const body = [
      "## Task Tracking",
      "",
      "mode: linear",
      "",
      "### Linear",
      "",
      "team: STE",
      "project: DPT",
      "",
    ].join("\n");
    const diff = computeWorkspaceMigrationDiff(body, "CLAUDE.md", {
      adapter: "linear",
      team: "STE",
      project: "DPT",
    });
    expect(diff).toBe("");
  });
});

describe("(c) mode: none → vacuous", () => {
  test("returns empty diff (nothing to migrate)", () => {
    const body = ["## Task Tracking", "", "mode: none", ""].join("\n");
    const diff = computeWorkspaceMigrationDiff(body, "CLAUDE.md", {
      adapter: "linear",
      team: "STE",
      project: "DPT",
    });
    expect(diff).toBe("");
  });
});

describe("(d) section absent → vacuous", () => {
  test("returns empty diff", () => {
    const body = "# Project\n\nNo task tracking.\n";
    const diff = computeWorkspaceMigrationDiff(body, "CLAUDE.md", {
      adapter: "linear",
      team: "STE",
      project: "DPT",
    });
    expect(diff).toBe("");
  });
});

describe("absolute path collapses to bare basename in diff header", () => {
  test("absolute CLAUDE.md path → diff header `a/CLAUDE.md`", () => {
    const body = [
      "## Task Tracking",
      "",
      "mode: linear",
      "",
    ].join("\n");
    const diff = computeWorkspaceMigrationDiff(body, "/Users/jane/proj/CLAUDE.md", {
      adapter: "linear",
      team: "STE",
      project: "DPT",
    });
    expect(diff).toMatch(/^--- a\/CLAUDE\.md$/m);
    expect(diff).toMatch(/^\+\+\+ b\/CLAUDE\.md$/m);
    // The full absolute path must NOT leak into the header.
    expect(diff).not.toMatch(/Users\/jane/);
  });
});

describe("(e) Jira mode → ### Jira with project only", () => {
  test("inserts `### Jira` block with project, no team key", () => {
    const body = [
      "## Task Tracking",
      "",
      "mode: jira",
      "mcp_server: atlassian",
      "jira_ac_field: customfield_10047",
      "",
    ].join("\n");
    const diff = computeWorkspaceMigrationDiff(body, "CLAUDE.md", {
      adapter: "jira",
      project: "ENG",
    });
    expect(diff).not.toBe("");
    expect(diff).toMatch(/\+### Jira/);
    expect(diff).toMatch(/\+project: ENG/);
    // Jira sub-section MUST NOT have team key
    expect(diff).not.toMatch(/\+team:/);
  });
});
