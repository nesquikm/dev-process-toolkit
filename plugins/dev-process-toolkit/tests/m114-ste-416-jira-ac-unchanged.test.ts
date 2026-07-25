// STE-416 (M114) AC-STE-416.3 — CROSS-ADAPTER GUARD: the Linear push-path
// checkbox transform must never leak into the Jira path.
//
// Jira has no description-composition TS function to call: `adapters/jira/src/`
// holds only `discover_field.ts` and `list_milestones.ts`, and the Jira
// `upsert_ticket_metadata` capability is LLM-emulated over
// `mcp__atlassian__createJiraIssue` (adapters/jira.md § Operations). The Jira
// composition is therefore the IDENTITY on the description body — the
// plain-bullet `## Acceptance Criteria` section that /spec-write composes is
// exactly what Jira receives, byte for byte.
//
// A pure "identity is identity" assertion would be vacuous (it would pass even
// if `checkboxifyLinearACs` were a no-op), so every assertion below is paired
// with a discriminating negative: the Jira body must DIFFER from the Linear
// body, and the difference must be the checkbox syntax itself.
//
// Second leg: a static leakage guard — no file under `adapters/jira/` may
// reference the Linear transform, and `adapters/jira.md` must still document
// plain bullets under `## Acceptance Criteria`.

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { checkboxifyLinearACs } from "../adapters/linear/src/format_description";

const pluginRoot = join(import.meta.dir, "..");

/**
 * The Jira push path applies no description transform (see file header).
 * Modelled explicitly so the assertions below name the composition step
 * rather than asserting on a bare literal.
 */
function jiraPushDescription(body: string): string {
  return body;
}

/** What /spec-write composes for a Jira FR: plain bullets, no checkboxes. */
const JIRA_BODY =
  "## Summary\n" +
  "- context bullet\n" +
  "\n" +
  "## Acceptance Criteria\n" +
  "- AC-STE-416.1: first\n" +
  "- AC-STE-416.2: second\n" +
  "- AC-STE-416.3: third\n" +
  "\n" +
  "## Notes\n" +
  "- a note\n";

describe("AC-STE-416.3 — the Jira push path leaves the AC section byte-identical", () => {
  test("the plain-bullet AC body survives the Jira composition unchanged", () => {
    expect(jiraPushDescription(JIRA_BODY)).toBe(JIRA_BODY);
    expect(jiraPushDescription(JIRA_BODY)).toContain("- AC-STE-416.1: first");
    expect(jiraPushDescription(JIRA_BODY)).not.toContain("- [ ]");
    expect(jiraPushDescription(JIRA_BODY)).not.toContain("- [x]");
  });

  test("DISCRIMINATOR: the Linear transform is a real, observable change", () => {
    // Non-vacuity guard. If `checkboxifyLinearACs` were a no-op this test
    // fails, and with it the byte-identity claim above loses its meaning.
    const linearBody = checkboxifyLinearACs(JIRA_BODY);
    expect(linearBody).not.toBe(JIRA_BODY);
    expect(linearBody).toContain("- [ ] AC-STE-416.1: first");
    expect(linearBody).toContain("- [ ] AC-STE-416.2: second");
    expect(linearBody).toContain("- [ ] AC-STE-416.3: third");
  });

  test("the Jira body and the Linear body differ exactly by the checkbox syntax", () => {
    const jiraOut = jiraPushDescription(JIRA_BODY);
    const linearOut = checkboxifyLinearACs(JIRA_BODY);
    expect(jiraOut).not.toBe(linearOut);
    // The Linear-only difference is confined to the AC section: stripping the
    // `[ ] ` markers from the Linear body recovers the Jira body byte for byte.
    expect(linearOut.replaceAll("- [ ] AC-STE-416.", "- AC-STE-416.")).toBe(jiraOut);
    // Prose and non-AC bullets are identical on both paths.
    for (const shared of ["## Summary\n- context bullet", "## Notes\n- a note"]) {
      expect(jiraOut).toContain(shared);
      expect(linearOut).toContain(shared);
    }
  });

  test("the Jira composition is unaffected by an already-checkboxed Linear body", () => {
    // Cross-contamination check: feeding the Jira path its own plain-bullet
    // body twice is stable, and the Linear form is never what Jira stores.
    expect(jiraPushDescription(jiraPushDescription(JIRA_BODY))).toBe(JIRA_BODY);
    expect(jiraPushDescription(JIRA_BODY)).not.toBe(checkboxifyLinearACs(JIRA_BODY));
  });
});

// ---------------------------------------------------------------------------
// Static leakage guard
// ---------------------------------------------------------------------------

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      out.push(...walkFiles(p));
      continue;
    }
    out.push(p);
  }
  return out;
}

describe("AC-STE-416.3 — no cross-adapter checkbox leakage into Jira", () => {
  test("no file under adapters/jira/ references the Linear checkbox transform", () => {
    const files = walkFiles(join(pluginRoot, "adapters", "jira"));
    // Guard against a vacuous walk (empty dir would pass trivially).
    expect(files.length).toBeGreaterThan(0);
    const offenders = files.filter((f) => /checkboxif/i.test(readFileSync(f, "utf-8")));
    expect(offenders).toEqual([]);
  });

  test("adapters/jira.md still documents plain bullets under `## Acceptance Criteria`", () => {
    const doc = readFileSync(join(pluginRoot, "adapters", "jira.md"), "utf-8");
    const collapsed = doc.replace(/\s+/g, " ");
    expect(collapsed).toContain(
      "`## Acceptance Criteria` (case-sensitive). Bullet-list items",
    );
    expect(doc).not.toMatch(/checkboxif/i);
  });

  // The `/checkboxif/i` grep above only catches leakage that names the Linear
  // helper. Prose leakage — "emit ACs as `- [ ]`" written into the Jira
  // description-composition step — carries no such token and would slip
  // through. Guard the push side by shape, not by identifier.
  //
  // Scoping matters: `adapters/jira.md` legitimately documents the `- [x]` /
  // `- [ ]` convention on the READ path (`pull_acs` and its ADF round-trip
  // subsection), because Jira's own UI writes those markers and the parser
  // must tolerate them. Only the `upsert_ticket_metadata` composition — the
  // step that builds the description body the toolkit WRITES — must stay
  // checkbox-free.

  /** Slice `jira.md` from a heading line to the next `#`..`###` heading. */
  function jiraDocSection(doc: string, headingPrefix: string): string {
    const lines = doc.split("\n");
    const start = lines.findIndex((l) => l.startsWith(headingPrefix));
    if (start === -1) return "";
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
      if (/^#{1,3}\s/.test(lines[i] ?? "")) {
        end = i;
        break;
      }
    }
    return lines.slice(start, end).join("\n");
  }

  /** A markdown task-list bracket in any form, slack variants included. */
  const CHECKBOX_MARKUP_RE = /\[\s*[xX\s]\s*\]/;
  const CHECKBOX_PROSE_RE = /checkbox|check-box|task[ -]list|togglable box/i;

  test("the Jira push-side upsert section never instructs checkbox emission", () => {
    const doc = readFileSync(join(pluginRoot, "adapters", "jira.md"), "utf-8");
    const upsert = jiraDocSection(doc, "### `upsert_ticket_metadata(");
    // Non-vacuity: the slice really is the description-composition section.
    expect(upsert.length).toBeGreaterThan(0);
    expect(upsert).toContain("createJiraIssue");
    expect(upsert).toContain("description");
    // The push path composes a plain-bullet AC section — no task-list markup,
    // no instruction to synthesize one.
    expect(upsert).not.toMatch(CHECKBOX_MARKUP_RE);
    expect(upsert).not.toMatch(CHECKBOX_PROSE_RE);
  });

  test("DISCRIMINATOR: the same slicer + predicates DO fire on the read path", () => {
    // Without this, the assertions above would be indistinguishable from a
    // broken slicer or an unmatchable regex. `pull_acs` legitimately documents
    // the `- [x]` / `- [ ]` convention and the word "checkbox", so both
    // predicates must fire there — and the slicer must keep them out of the
    // push-side slice.
    const doc = readFileSync(join(pluginRoot, "adapters", "jira.md"), "utf-8");
    const pull = jiraDocSection(doc, "### `pull_acs(");
    expect(pull).toContain("getJiraIssue");
    expect(pull).toContain("- [x]");
    expect(pull).toMatch(CHECKBOX_MARKUP_RE);
    expect(pull).toMatch(CHECKBOX_PROSE_RE);
    // The two slices are disjoint: read-side prose is not inside the push one.
    const upsert = jiraDocSection(doc, "### `upsert_ticket_metadata(");
    expect(pull).not.toContain("createJiraIssue(projectKey");
    expect(upsert).not.toContain("adopt the `- [x]`");
  });

  test("the Linear checkbox transform is exported from the Linear adapter only", () => {
    const linearSrc = readFileSync(
      join(pluginRoot, "adapters", "linear", "src", "format_description.ts"),
      "utf-8",
    );
    expect(linearSrc).toContain("export function checkboxifyLinearACs");
    const jiraSrcFiles = walkFiles(join(pluginRoot, "adapters", "jira")).filter((f) =>
      f.endsWith(".ts"),
    );
    expect(jiraSrcFiles.length).toBeGreaterThan(0);
    for (const f of jiraSrcFiles) {
      expect(readFileSync(f, "utf-8")).not.toContain("checkboxifyLinearACs");
    }
  });
});
