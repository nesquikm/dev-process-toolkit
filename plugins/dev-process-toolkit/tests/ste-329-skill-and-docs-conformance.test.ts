// STE-329 AC-STE-329.6 / AC-STE-329.7 — skill-wiring + docs conformance.
//
// AC-STE-329.6: `/spec-write` § 0b "Milestone attachment" and `/implement`
//   Phase 1 step 0.e milestone-attach prose must drop the "(Linear-only)"
//   label and instead frame the capability as covering ANY adapter with
//   `project_milestone: true` (Linear + Jira).
//
// AC-STE-329.7: `docs/tracker-adapters.md` Project-Milestone table Jira row
//   flips to `project_milestone: true`, maps to the `milestone-<M-token>`
//   label via `editJiraIssue` read-merge-write, missing-milestone handling
//   `N/A (create-on-write)`; the "use Jira fixVersions manually" line is
//   REMOVED. `adapters/jira.md` gains a Project Milestone section documenting
//   the mapping + read-merge-write + read-back verify + on-create-only
//   default_labels carve-out.
//
// Assertions are pinned to the milestone-attach prose specifically (not
// unrelated "Linear" mentions elsewhere in the files).

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const pluginRoot = join(import.meta.dir, "..");
const specWritePath = join(pluginRoot, "skills", "spec-write", "SKILL.md");
const implementPath = join(pluginRoot, "skills", "implement", "SKILL.md");
const trackerAdaptersPath = join(pluginRoot, "docs", "tracker-adapters.md");
const jiraPath = join(pluginRoot, "adapters", "jira.md");

function read(path: string): string {
  return readFileSync(path, "utf8");
}

// Extract the single line containing the milestone-attach anchor phrase so
// assertions pin the milestone-attach prose, not unrelated "Linear" text.
function milestoneAttachLine(body: string, anchor: RegExp): string {
  const line = body.split("\n").find((l) => anchor.test(l));
  expect(line, `expected a line matching ${anchor}`).toBeDefined();
  return line!;
}

describe("AC-STE-329.6 — /spec-write § 0b milestone-attach prose un-Linear-only", () => {
  test("the Milestone attachment prose no longer carries `(Linear-only)`", () => {
    const line = milestoneAttachLine(read(specWritePath), /\*\*Milestone attachment/);
    expect(line).not.toMatch(/Linear-only/);
  });

  test("the Milestone attachment prose references project_milestone: true (Linear + Jira)", () => {
    const line = milestoneAttachLine(read(specWritePath), /\*\*Milestone attachment/);
    expect(line).toMatch(/project_milestone:\s*true/);
    expect(line).toMatch(/Jira/);
    expect(line).toMatch(/Linear/);
  });
});

describe("AC-STE-329.6 — /implement Phase 1 step 0.e milestone-attach prose un-Linear-only", () => {
  test("step 0.e prose no longer carries `Linear-only`", () => {
    const line = milestoneAttachLine(read(implementPath), /0\.e\s+Project-milestone attach/);
    expect(line).not.toMatch(/Linear-only/);
  });

  test("step 0.e prose references project_milestone: true (Linear + Jira)", () => {
    const line = milestoneAttachLine(read(implementPath), /0\.e\s+Project-milestone attach/);
    expect(line).toMatch(/project_milestone:\s*true/);
    expect(line).toMatch(/Jira/);
    expect(line).toMatch(/Linear/);
  });
});

describe("AC-STE-329.7 — tracker-adapters.md Project-Milestone table Jira row", () => {
  // Isolate the Jira row of the Project-Milestone table (the markdown table
  // row whose first cell is `Jira`).
  function jiraTableRow(): string {
    const body = read(trackerAdaptersPath);
    // The Project Milestone mapping section's table; the Jira row leads with
    // `| Jira`.
    const row = body
      .split("\n")
      .find((l) => /^\|\s*Jira\s*\|/.test(l) && /project_milestone|milestone|fixVersion|label/i.test(l));
    expect(row, "expected a Jira row in the Project-Milestone table").toBeDefined();
    return row!;
  }

  test("Jira row declares `project_milestone: true` (no longer false)", () => {
    const row = jiraTableRow();
    expect(row).toMatch(/`?true`?/);
    expect(row).not.toMatch(/`?false`?/);
  });

  test("Jira row maps FR milestone to the milestone-<M-token> label via editJiraIssue read-merge-write", () => {
    const row = jiraTableRow();
    expect(row).toMatch(/milestone-/);
    expect(row).toMatch(/label/i);
    expect(row).toMatch(/editJiraIssue/);
    expect(row).toMatch(/read-merge-write/i);
  });

  test("Jira row missing-milestone handling is `N/A (create-on-write)`", () => {
    const row = jiraTableRow();
    expect(row).toMatch(/N\/A\s*\(create-on-write\)/i);
  });

  test("the `use Jira fixVersions manually` line is removed from the doc", () => {
    const body = read(trackerAdaptersPath);
    expect(body).not.toMatch(/fixVersions manually/i);
  });
});

describe("AC-STE-329.7 — adapters/jira.md gains a Project Milestone section", () => {
  const body = read(jiraPath);

  // Anchor: the `## Project Milestone` section. Split on `## ` headings and
  // take the whole section body (heading + prose up to the next `##` or EOF)
  // — NOT just the heading line, so the required facts can live in the body.
  function projectMilestoneSection(): string {
    const section = body
      .split(/^##\s+/m)
      .find((s) => /^Project Milestone\b/.test(s));
    expect(section, "expected a `Project Milestone` section in jira.md").toBeDefined();
    return section!;
  }

  test("a Project Milestone heading exists", () => {
    projectMilestoneSection();
  });

  test("documents the milestone-<M-token> label mapping", () => {
    const section = projectMilestoneSection();
    expect(section).toMatch(/milestone-/);
    expect(section).toMatch(/label/i);
  });

  test("documents the read-merge-write attach via editJiraIssue", () => {
    const section = projectMilestoneSection();
    expect(section).toMatch(/read-merge-write/i);
    expect(section).toMatch(/editJiraIssue/);
  });

  test("documents the read-back verify", () => {
    const section = projectMilestoneSection();
    expect(section).toMatch(/read-back|re-read|verif/i);
  });

  test("documents the on-create-only default_labels carve-out", () => {
    const section = projectMilestoneSection();
    expect(section).toMatch(/default_labels/);
    expect(section).toMatch(/create/i);
  });
});
