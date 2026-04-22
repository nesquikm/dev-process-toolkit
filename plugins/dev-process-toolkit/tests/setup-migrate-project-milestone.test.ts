import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseFrontmatter } from "../adapters/_shared/src/frontmatter";

// FR-59 conformance — /setup --migrate must bind each pushed Linear ticket
// to the Linear Project Milestone whose name begins with the FR's
// frontmatter `milestone: M<N>` value, so the tracker view mirrors the
// spec's milestone grouping instead of piling every FR into one flat
// project.
//
// These tests lock:
//   1. The procedure-doc wording the LLM follows during migration
//      (mapping step, missing-milestone prompt, Jira one-liner).
//   2. The declarative adapter metadata — Linear declares the capability
//      true, Jira/template declare it false so FR-38 AC-38.6 graceful
//      degradation skips the milestone step on adapters that don't
//      support it.
//   3. The side-by-side documentation table so adapter authors can see
//      at a glance how each tracker maps milestones.

const pluginRoot = join(import.meta.dir, "..");
const migrateDocPath = join(pluginRoot, "docs", "setup-migrate.md");
const trackerAdaptersDocPath = join(pluginRoot, "docs", "tracker-adapters.md");
const linearAdapterPath = join(pluginRoot, "adapters", "linear.md");
const jiraAdapterPath = join(pluginRoot, "adapters", "jira.md");
const templateAdapterPath = join(pluginRoot, "adapters", "_template.md");

function read(path: string): string {
  return readFileSync(path, "utf8");
}

describe("FR-59 — migration populates Linear Project Milestone field", () => {
  test("AC-59.1 — none→tracker procedure names the prefix-match rule + save_issue milestone param", () => {
    const body = read(migrateDocPath);
    const section = body.match(/## `none → <tracker>` procedure[\s\S]*?(?=^## )/m);
    expect(section).not.toBeNull();
    // Guard against a silent empty-section pass: if the doc ever grows
    // a `## …` heading between the section header and its real content,
    // the capture could go empty and every inner toMatch below would
    // vacuously pass.
    expect(section![0].length).toBeGreaterThan(500);
    // Capability gate — only runs when the adapter declares support.
    expect(section![0]).toContain("project_milestone");
    // Exact prefix-match rule is load-bearing so the LLM doesn't fall
    // back to fuzzy/substring matching and bind the wrong milestone.
    expect(section![0]).toMatch(/starts with `M<N>`|case-sensitive.*exact-prefix/);
    // The MCP field name the LLM actually sets — naming it keeps the
    // call shape unambiguous when the procedure is executed.
    expect(section![0]).toMatch(/save_issue.*milestone|milestone.*save_issue/);
  });

  test("AC-59.2 — missing-milestone prompt is verbatim with the 3-way choice", () => {
    const body = read(migrateDocPath);
    // The prompt wording is how the LLM signals an off-ramp to the
    // operator — paraphrasing it would cause drift.
    expect(body).toContain(
      "Linear milestone 'M<N>' not found on project '<name>'.",
    );
    expect(body).toMatch(/\[1\] Create it/);
    expect(body).toMatch(/\[2\] Skip milestone binding for these N FRs/);
    expect(body).toMatch(/\[3\] Cancel migration/);
    expect(body).toMatch(/Enter 1-3/);
  });

  test("AC-59.3 — Jira branch logs the one-liner and skips milestone binding", () => {
    const body = read(migrateDocPath);
    // Verbatim message so operators using Jira get the same guidance
    // every time and can grep for it in logs.
    expect(body).toContain(
      "Jira does not map milestones at push time; use Jira fixVersions manually.",
    );
  });

  test("AC-59.4 — Linear adapter declares project_milestone: true", () => {
    const fm = parseFrontmatter(read(linearAdapterPath));
    expect(fm.project_milestone).toBe(true);
  });

  test("AC-59.4 — Jira adapter declares project_milestone: false", () => {
    const fm = parseFrontmatter(read(jiraAdapterPath));
    expect(fm.project_milestone).toBe(false);
  });

  test("AC-59.4 — _template adapter declares project_milestone: false with a pointer comment", () => {
    const fm = parseFrontmatter(read(templateAdapterPath));
    expect(fm.project_milestone).toBe(false);
    const body = read(templateAdapterPath);
    // Comment must point custom-adapter authors at the Linear impl so
    // they have a reference implementation when extending this field.
    expect(body).toMatch(/project_milestone[\s\S]{0,300}Linear/);
  });

  test("AC-59.5 — tracker-adapters.md has a side-by-side milestone-mapping table", () => {
    const body = read(trackerAdaptersDocPath);
    // Dedicated section + table so the behaviour is discoverable from
    // the doc entry point rather than hidden inside per-adapter files.
    expect(body).toMatch(/project milestone|Project Milestone/i);
    // Per-adapter columns for Linear, Jira, custom — same shape the
    // AC's side-by-side comparison requires.
    const match = body.match(/[Pp]roject [Mm]ilestone[\s\S]{0,1500}/);
    expect(match).not.toBeNull();
    const section = match![0];
    expect(section).toMatch(/\|\s*Linear\s*\|/);
    expect(section).toMatch(/\|\s*Jira\s*\|/);
    // Custom column may carry a parenthetical qualifier (e.g., `Custom
    // (_template)`) so match the word without requiring the trailing pipe.
    expect(section).toMatch(/\|\s*Custom\b/);
  });
});
