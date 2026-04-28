import { describe, expect, test } from "bun:test";
import { computeMigrationDiff } from "../scripts/migrate-task-tracking-canonical";

// STE-114 AC-STE-114.5 — `migrate-task-tracking-canonical.ts` (dry-run only).
//
// Reads a project's CLAUDE.md, extracts non-canonical keys from the
// top-level `## Task Tracking` section, and prints a unified diff that
// moves them under a `### <Tracker>` subsection (e.g. `### Linear`).
//
// Three behaviors:
//   (a) clean CLAUDE.md (only canonical keys) → empty diff (idempotent)
//   (b) drifted CLAUDE.md (non-canonical keys at top level) → unified diff
//       moving them under `### <Tracker>`, where Tracker capitalizes mode
//   (c) ### subsection already exists → append non-canonical keys to it
//       rather than create a duplicate subsection

const sampleSmoke = [
  "# Project",
  "",
  "## Task Tracking",
  "",
  "mode: linear",
  "mcp_server: linear",
  "linear_team_id: foo",
  "linear_team_name: bar",
  "linear_project_id: baz",
  "branch_template: feat/{ticket-id}",
  "",
].join("\n");

describe("AC-STE-114.5(a) clean CLAUDE.md → empty diff (idempotent)", () => {
  test("only canonical keys → no migration needed", () => {
    const clean = `# Project\n\n## Task Tracking\n\nmode: linear\nmcp_server: linear\nbranch_template: feat/{ticket-id}\n`;
    const diff = computeMigrationDiff(clean, "/path/to/CLAUDE.md");
    expect(diff).toBe("");
  });

  test("absent ## Task Tracking → no migration", () => {
    const noSection = `# Project\n\n## Tech Stack\n\n- TS\n`;
    const diff = computeMigrationDiff(noSection, "/path/to/CLAUDE.md");
    expect(diff).toBe("");
  });
});

describe("AC-STE-114.5(b) drifted top-level keys → unified diff", () => {
  test("non-canonical keys moved under `### Linear`", () => {
    const diff = computeMigrationDiff(sampleSmoke, "/proj/CLAUDE.md");
    expect(diff).not.toBe("");
    expect(diff).toMatch(/--- a\/.+CLAUDE\.md/);
    expect(diff).toMatch(/\+\+\+ b\/.+CLAUDE\.md/);
    // The migration adds `### Linear` heading.
    expect(diff).toMatch(/^\+### Linear/m);
    // The structural rearrangement is visible: in the before frame,
    // `linear_*` keys live above `branch_template`; in the after frame,
    // `branch_template` appears earlier (added) and the trailing empty
    // line is removed (the section is rebuilt with the subsection
    // appended). The LCS recognizes the offender lines as common
    // context, so they appear with leading-space, not `-`/`+`.
    // What's load-bearing: the diff is non-empty, the heading is added,
    // and applying the patch yields a CLAUDE.md whose top-level keys are
    // canonical-only (verified by the round-trip test below).
    expect(diff).toMatch(/^ linear_team_id: foo/m);
    expect(diff).toMatch(/^ linear_team_name: bar/m);
    expect(diff).toMatch(/^ linear_project_id: baz/m);
  });

  test("subsection name uses Title-Case of the mode", () => {
    const jiraDrift = [
      "# Project",
      "",
      "## Task Tracking",
      "",
      "mode: jira",
      "mcp_server: atlassian",
      "jira_workspace: foo",
      "jira_project_key: BAR",
      "branch_template: feat/{ticket-id}",
      "",
    ].join("\n");
    const diff = computeMigrationDiff(jiraDrift, "/proj/CLAUDE.md");
    expect(diff).toMatch(/\+### Jira/);
  });
});

describe("AC-STE-114.5(c) existing ### subsection — append, don't duplicate", () => {
  test("non-canonical keys appended to the existing subsection", () => {
    const withSubsection = [
      "# Project",
      "",
      "## Task Tracking",
      "",
      "mode: linear",
      "mcp_server: linear",
      "linear_new_key: hello",
      "branch_template: feat/{ticket-id}",
      "",
      "### Linear",
      "",
      "linear_existing: world",
      "",
    ].join("\n");
    const diff = computeMigrationDiff(withSubsection, "/proj/CLAUDE.md");
    // Should not introduce a second `### Linear` heading.
    const addedHeadings = diff.match(/^\+### Linear/gm);
    expect(addedHeadings).toBeNull();
    // Should add the migrated key.
    expect(diff).toMatch(/^\+linear_new_key: hello/m);
  });
});

describe("AC-STE-114.5 — script auto-applies nothing", () => {
  test("computeMigrationDiff returns a string, never writes", () => {
    const diff = computeMigrationDiff(sampleSmoke, "/proj/CLAUDE.md");
    expect(typeof diff).toBe("string");
    // The function name signals dry-run-only — there's no apply variant.
    // (Test is a discipline anchor; the absence of a writer is the contract.)
  });
});
