import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Prose assertion for STE-67 AC-STE-67.7 (linear.md template frontmatter) and
// AC-STE-67.4 (importFromTracker renderFRFile body does not include the ULID).
//
// Defense against regression: if a future edit re-introduces a `**ULID:**`
// header block into the template, the `/gate-check` runtime probe catches
// ticket descriptions on pull-back, but this test catches the static
// declarative template at CI time — plus AC-STE-67.4's symmetric rule that
// the local FR-body renderer never stamps the ULID into prose.

const pluginRoot = join(import.meta.dir, "..");
const linearAdapterPath = join(pluginRoot, "adapters", "linear.md");
const importSrcPath = join(pluginRoot, "adapters", "_shared", "src", "import.ts");

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

describe("STE-67 AC-STE-67.4 — importFromTracker renderFRFile body omits full ULID", () => {
  // AC-STE-67.4: the description that `Provider.sync(spec)` pushes back to
  // the tracker is `spec.body` — the file content without frontmatter.
  // Frontmatter `id:` is the legitimate home for the full ULID; the rendered
  // body must not duplicate it. The existing `renderFRFile` is already
  // compliant — this test is a defensive pin against regression.
  //
  // Anchor on the template-literal boundaries directly rather than on
  // the enclosing function's closing brace — the `\n}\n` heuristic used
  // earlier was fragile against future additions below `renderFRFile`.
  // The frontmatter is legitimately allowed to interpolate `${p.id}`; the
  // body region (between the frontmatter's closing `---\n\n## ` and the
  // template literal's terminating backtick) must have no references to
  // `${p.id}` or the literal `fr_` ULID prefix.
  test("renderFRFile's template body omits `${p.id}` and `fr_` literals", () => {
    const src = readFileSync(importSrcPath, "utf-8");
    // `---\n\n## ` marks the transition from frontmatter to body — first
    // body heading in the rendered FR (`## Requirement` et al).
    const bodyStart = src.indexOf("---\n\n## ");
    expect(bodyStart).toBeGreaterThan(0);
    // Template literals close with a backtick immediately followed by `;`.
    // If a future renderer introduces an additional template below this one
    // with the same `---\n\n## ` boundary, this anchor still picks the
    // first body region — still a meaningful assertion.
    const templateEnd = src.indexOf("`;", bodyStart);
    expect(templateEnd).toBeGreaterThan(bodyStart);
    const bodyRegion = src.slice(bodyStart, templateEnd);

    expect(bodyRegion).not.toContain("${p.id}");
    expect(bodyRegion).not.toContain("fr_");
  });
});
