// STE-149 — `templates/spec-templates/requirements.md.template` must NOT
// emit `AC-<tracker-id>.<N>` example data rows inside the rendered
// Traceability Matrix. The example survives only inside the HTML comment
// header at the top of the file (where the placeholder convention is
// already documented). After /setup runs, the rendered table carries
// the header row and nothing else — no opaque-literal data rows for a
// careful first-time reader to puzzle over.
//
// Acceptance criteria:
//   AC-STE-149.1: zero `AC-<tracker-id>\.\d+` literal occurrences outside
//     HTML comment blocks (`<!-- ... -->`).
//   AC-STE-149.2: convention documentation explaining the
//     `AC-<tracker-id>.<N>` placeholder pattern is preserved, just
//     relocated into the HTML comment header.
//   AC-STE-149.3: Traceability Matrix has only the table header row — no
//     example data rows.
//   AC-STE-149.4: /setup re-run on a project with a canonical
//     `requirements.md` is a no-op (template-level idempotency: editing
//     the template does not introduce duplicate convention prose).
//
// Pattern mirrors `requirements_md_template_shape.test.ts` (STE-122) and
// `template-tracker-id-convention.test.ts` (STE-80).

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const pluginRoot = join(import.meta.dir, "..");
const templatePath = join(
  pluginRoot,
  "templates",
  "spec-templates",
  "requirements.md.template",
);
const content = readFileSync(templatePath, "utf-8");

// Strip every HTML comment block (multi-line) before scanning the
// rendered (non-comment) prose.
function stripHtmlComments(src: string): string {
  return src.replace(/<!--[\s\S]*?-->/g, "");
}

describe("STE-149 AC-STE-149.1 — zero AC-<tracker-id>.<N> literals outside HTML comments", () => {
  test("rendered (non-comment) content carries no `AC-<tracker-id>.<N>` literal", () => {
    const stripped = stripHtmlComments(content);
    expect(stripped).not.toMatch(/AC-<tracker-id>\.\d+/);
  });
});

describe("STE-149 AC-STE-149.2 — placeholder convention preserved in HTML comment", () => {
  test("HTML comment block still documents the `AC-<tracker-id>.<N>` placeholder shape", () => {
    // The comment block survives — just the example data rows move into it.
    const commentBlocks = content.match(/<!--[\s\S]*?-->/g) ?? [];
    const allComments = commentBlocks.join("\n");
    expect(allComments).toMatch(/AC-<tracker-id>\.<N>|AC-<tracker-id>\.\d+/);
    expect(allComments.toLowerCase()).toMatch(/placeholder|allocator|substitute/);
  });

  test("HTML comment shows at least one rendered-row example so the convention is concrete", () => {
    // The example was previously in the rendered table; it must still
    // appear inside the comment so authors see what a real row looks like.
    const commentBlocks = content.match(/<!--[\s\S]*?-->/g) ?? [];
    const allComments = commentBlocks.join("\n");
    expect(allComments).toMatch(/\|\s*AC-<tracker-id>\.\d+/);
  });
});

describe("STE-149 AC-STE-149.3 — Traceability Matrix has only the header row", () => {
  test("the §6 Traceability Matrix table contains exactly the header + separator rows", () => {
    // Find § 6 Traceability Matrix and the next `## ` heading (or EOF).
    const start = content.indexOf("## 6. Traceability Matrix");
    expect(start).toBeGreaterThan(-1);
    const tail = content.slice(start);
    const nextHeading = tail.search(/\n## \S/);
    const section = nextHeading === -1 ? tail : tail.slice(0, nextHeading);
    // Strip any HTML comment so we count rendered table rows only.
    const renderedSection = stripHtmlComments(section);
    // Match every line that looks like a markdown table row (starts with `|`).
    const tableRows = (renderedSection.match(/^\|.*\|\s*$/gm) ?? []).filter(
      (row) => row.trim().length > 0,
    );
    // Exactly two rows allowed: the header (`| Requirement | ... |`) and the
    // separator (`|----|----|----|`). No data rows.
    expect(tableRows.length).toBe(2);
    expect(tableRows[0]).toMatch(/Requirement/);
    expect(tableRows[1]).toMatch(/^[\s\-|:]+$/);
  });
});

describe("STE-149 AC-STE-149.4 — template idempotency: no duplicate convention prose", () => {
  test("the `<tracker-id>` placeholder convention appears only inside the HTML comment block (single occurrence per phrase)", () => {
    // Idempotency at the template level: a downstream-project's existing
    // canonical `requirements.md` must not gain duplicate convention notes
    // on /setup re-run. /setup's own merge logic guarantees the file is
    // not re-written when it already exists; the template-side guard is
    // that the convention prose lives in exactly one place (the comment).
    const stripped = stripHtmlComments(content);
    // The convention discussion phrases must be absent from rendered prose.
    expect(stripped.toLowerCase()).not.toContain("placeholder convention");
    expect(stripped.toLowerCase()).not.toContain("ac-<tracker-id>");
  });
});
