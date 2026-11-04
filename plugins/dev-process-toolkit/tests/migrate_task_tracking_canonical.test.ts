import { describe, expect, test } from "bun:test";
import { computeMigrationDiff } from "../scripts/migrate-task-tracking-canonical";

// STE-114 AC-STE-114.5 — `migrate-task-tracking-canonical.ts` (dry-run only).
//
// Reads a project's CLAUDE.md, extracts non-canonical keys from the
// top-level `## Task Tracking` section, and prints a unified diff that
// moves them, verbatim and prefixed `- `, into a `## Tracker Notes` prose
// section directly after the `## Task Tracking` span (amended by
// M_94e6f7/STE-708; the destination used to be a `### <Tracker>` subsection).
//
// Three behaviors:
//   (a) clean CLAUDE.md (only canonical keys) → empty diff (idempotent)
//   (b) drifted CLAUDE.md (non-canonical keys at top level) → unified diff
//       moving them into `## Tracker Notes`, whatever the mode
//   (c) ### subsection already exists → left alone, never duplicated; the
//       keys still move to `## Tracker Notes` (appended to an existing one)

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
    // Amended by M_94e6f7/STE-708 (AC-.3): the destination is a
    // `## Tracker Notes` prose section, not a `### Linear` sub-section.
    expect(diff).toMatch(/^\+## Tracker Notes$/m);
    expect(diff).not.toMatch(/^\+### Linear/m);
    // Each offender leaves the top level and lands verbatim, prefixed `- `.
    expect(diff).toMatch(/^-linear_team_id: foo$/m);
    expect(diff).toMatch(/^-linear_team_name: bar$/m);
    expect(diff).toMatch(/^-linear_project_id: baz$/m);
    expect(diff).toMatch(/^\+- linear_team_id: foo$/m);
    expect(diff).toMatch(/^\+- linear_team_name: bar$/m);
    expect(diff).toMatch(/^\+- linear_project_id: baz$/m);
  });

  // Amended by M_94e6f7/STE-708 (AC-.3): the destination no longer depends
  // on the mode — a Jira tree gets the same `## Tracker Notes` section and
  // no `### Jira` sub-section.
  test("destination is ## Tracker Notes whatever the mode", () => {
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
    expect(diff).toMatch(/^\+## Tracker Notes$/m);
    expect(diff).not.toMatch(/^\+### Jira/m);
    expect(diff).toMatch(/^\+- jira_workspace: foo$/m);
    expect(diff).toMatch(/^\+- jira_project_key: BAR$/m);
  });
});

describe("AC-STE-114.5(c) existing ### subsection — append, don't duplicate", () => {
  // Amended by M_94e6f7/STE-708 (AC-.3): an existing `### Linear` is left
  // alone and never duplicated; the key moves to `## Tracker Notes`, and
  // re-running the helper on the result yields an empty diff (idempotent).
  test("existing subsection is not duplicated; key moves to ## Tracker Notes", () => {
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
    // Should add the migrated key, once, under a single notes heading.
    expect(diff).toMatch(/^\+- linear_new_key: hello$/m);
    expect(diff).not.toMatch(/^\+linear_new_key: hello$/m);
    const postImage = diff
      .split("\n")
      .slice(3)
      .filter((l) => l.startsWith(" ") || l.startsWith("+"))
      .map((l) => l.slice(1))
      .join("\n");
    expect(postImage.split("\n").filter((l) => l === "## Tracker Notes").length).toBe(1);
    expect(postImage.split("\n").filter((l) => l === "### Linear").length).toBe(1);
    expect(computeMigrationDiff(postImage, "/proj/CLAUDE.md")).toBe("");
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
