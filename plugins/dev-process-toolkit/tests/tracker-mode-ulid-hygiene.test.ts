import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Prose assertion for STE-67 AC-STE-67.7.
//
// Asserts that `adapters/linear.md`'s `ticket_description_template` frontmatter
// value does NOT contain the case-sensitive substring `ULID`. Follows the
// shape of `linear-adapter-doc-markers.test.ts` — grep-based invariant on the
// adapter's declarative frontmatter. Defense against regression: if a future
// edit re-introduces a `**ULID:**` header block into the template, the
// `/gate-check` runtime probe catches ticket descriptions on pull-back, but
// this test catches the static template itself at CI time.

const pluginRoot = join(import.meta.dir, "..");
const linearAdapterPath = join(pluginRoot, "adapters", "linear.md");

function extractFrontmatterField(source: string, field: string): string {
  // Front-matter between lines 1..first `---` on its own line after the first.
  // The template is a `|` block scalar; we capture everything from the
  // `<field>: |` line up to the next top-level YAML key (column-0 word + `:`).
  const lines = source.split("\n");
  let inFrontmatter = false;
  let captureIndent = -1;
  const captured: string[] = [];
  let seenField = false;

  for (const line of lines) {
    if (line === "---") {
      if (!inFrontmatter) {
        inFrontmatter = true;
        continue;
      }
      if (seenField) break;
      continue;
    }
    if (!inFrontmatter) continue;

    if (!seenField) {
      if (line.startsWith(`${field}:`)) {
        seenField = true;
        captureIndent = 0;
      }
      continue;
    }
    // Next top-level YAML key (column-0, alphanumeric + `:`) ends the capture.
    if (/^[A-Za-z_][A-Za-z0-9_]*:/.test(line)) break;
    captured.push(line);
  }

  if (!seenField) throw new Error(`frontmatter field "${field}" not found in ${linearAdapterPath}`);
  return captured.join("\n");
}

describe("STE-67 AC-STE-67.7 — linear.md ticket_description_template no-ULID invariant", () => {
  test("ticket_description_template frontmatter does NOT contain the substring 'ULID'", () => {
    const body = readFileSync(linearAdapterPath, "utf-8");
    const templateValue = extractFrontmatterField(body, "ticket_description_template");
    // Case-sensitive per AC: catch `ULID` specifically. Lowercase "ulid" is
    // not banned (could legitimately appear in a path or code reference).
    expect(templateValue).not.toContain("ULID");
  });

  test("template references tracker ID, not the retired fr_anchor variable", () => {
    const body = readFileSync(linearAdapterPath, "utf-8");
    const templateValue = extractFrontmatterField(body, "ticket_description_template");
    expect(templateValue).toContain("{tracker_id}");
    expect(templateValue).not.toContain("{fr_anchor}");
  });

  test("template back-link points at specs/frs/, not v1 specs/requirements.md#anchor", () => {
    const body = readFileSync(linearAdapterPath, "utf-8");
    const templateValue = extractFrontmatterField(body, "ticket_description_template");
    expect(templateValue).toContain("specs/frs/");
    expect(templateValue).not.toContain("specs/requirements.md#");
  });
});
