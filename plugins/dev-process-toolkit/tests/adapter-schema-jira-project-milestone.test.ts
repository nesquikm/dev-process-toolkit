// STE-329 AC-STE-329.1 — Capability flip for the Jira adapter.
//
// `adapters/jira.md` Schema M frontmatter must declare:
//   - `project_milestone: true`  (was `false` — STE-38/STE-154 left it off)
//   - `milestone_binding: label` (new key — selects the create-on-write
//     label path instead of Linear's projectMilestone-object path)
//
// The `object` value (Linear / default when the key is absent) preserves
// projectMilestone-object semantics; `label` selects the label path. This
// conformance test pins the jira.md frontmatter post-flip.
//
// Pattern reference: tests/adapter-schema-w-list-project-statuses.test.ts.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const pluginRoot = join(import.meta.dir, "..");
const jiraPath = join(pluginRoot, "adapters", "jira.md");
const linearPath = join(pluginRoot, "adapters", "linear.md");

function read(path: string): string {
  return readFileSync(path, "utf8");
}

function frontmatter(body: string): string {
  // Frontmatter is the leading `---\n...\n---\n` block.
  const m = body.match(/^---\n([\s\S]*?)\n---\n/);
  expect(m).not.toBeNull();
  return m![1]!;
}

describe("AC-STE-329.1 — jira.md frontmatter flips project_milestone to true", () => {
  test("frontmatter contains the literal `project_milestone: true` key", () => {
    const fm = frontmatter(read(jiraPath));
    expect(fm).toMatch(/^project_milestone:\s*true\s*$/m);
  });

  test("the stale `project_milestone: false` declaration is gone", () => {
    const fm = frontmatter(read(jiraPath));
    expect(fm).not.toMatch(/^project_milestone:\s*false\s*$/m);
  });
});

// STE-375 AC-STE-375.4 (M101) extends the STE-329 milestone_binding schema:
// the enum grows from { object, label } to { object, label, epic }, and
// jira.md's declared binding flips from `label` to `epic` (the label path
// stays as the documented runtime FALLBACK when the project's issue-type
// metadata lacks Epic / cannot set parent — see § Project Milestone).
const MILESTONE_BINDING_ENUM = ["object", "label", "epic"] as const;

describe("STE-375 — jira.md frontmatter declares milestone_binding: epic", () => {
  test("frontmatter contains the literal `milestone_binding: epic` key", () => {
    const fm = frontmatter(read(jiraPath));
    expect(fm).toMatch(/^milestone_binding:\s*epic\s*$/m);
  });

  test("the superseded `milestone_binding: label` declaration is gone", () => {
    const fm = frontmatter(read(jiraPath));
    expect(fm).not.toMatch(/^milestone_binding:\s*label\s*$/m);
  });

  test("the declared value is a member of the documented enum (object | label | epic)", () => {
    const fm = frontmatter(read(jiraPath));
    const m = fm.match(/^milestone_binding:\s*(\S+)\s*$/m);
    expect(m).not.toBeNull();
    expect(MILESTONE_BINDING_ENUM).toContain(
      m![1]! as (typeof MILESTONE_BINDING_ENUM)[number],
    );
  });
});

describe("AC-STE-329.1 — Linear keeps object semantics (default when key absent)", () => {
  test("linear.md declares neither milestone_binding: label nor epic (object is the default)", () => {
    const fm = frontmatter(read(linearPath));
    // Linear stays on the projectMilestone-object path. It either omits
    // the key (→ defaults to `object`) or explicitly carries `object`,
    // but it must never carry `label` or `epic`.
    expect(fm).not.toMatch(/^milestone_binding:\s*label\s*$/m);
    expect(fm).not.toMatch(/^milestone_binding:\s*epic\s*$/m);
  });
});
