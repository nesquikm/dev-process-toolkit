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

describe("AC-STE-329.1 — jira.md frontmatter adds milestone_binding: label", () => {
  test("frontmatter contains the literal `milestone_binding: label` key", () => {
    const fm = frontmatter(read(jiraPath));
    expect(fm).toMatch(/^milestone_binding:\s*label\s*$/m);
  });
});

describe("AC-STE-329.1 — Linear keeps object semantics (default when key absent)", () => {
  test("linear.md does NOT declare milestone_binding: label (object is the default)", () => {
    const fm = frontmatter(read(linearPath));
    // Linear stays on the projectMilestone-object path. It either omits
    // the key (→ defaults to `object`) or explicitly carries `object`,
    // but it must never carry `label`.
    expect(fm).not.toMatch(/^milestone_binding:\s*label\s*$/m);
  });
});
