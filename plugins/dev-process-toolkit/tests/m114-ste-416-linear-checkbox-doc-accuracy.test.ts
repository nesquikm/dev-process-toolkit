// M114 / STE-416 post-release defect backfill — DOC ACCURACY on the shipped
// Linear checkbox transform.
//
// `adapters/linear.md` § `upsert_ticket_metadata` documents
// `checkboxifyLinearACs` and closes its idempotence paragraph with:
//
//   "…is idempotent — an existing box is canonicalized rather than left as-is,
//    with its checked state preserved, so re-pushing a description never
//    resets an operator's toggle."
//
// The final clause is FALSE for the operation the paragraph documents.
//
// State preservation is a property of the transform's INPUT: `checkboxifyLinearACs`
// preserves whatever `[x]` / `[ ]` it is handed. But the update path documented
// in the SAME section (step 2: `save_issue(id=…, description=<rendered
// template>)`; step 4: render `ticket_description_template` with `{fr_body}` =
// full FR description body) re-renders the description FROM THE FR FILE — and
// an FR file carries plain `- AC-<id>.<n>:` bullets with no checkbox state at
// all. So a re-sync hands the transform a stateless body, every criterion comes
// back `- [ ]`, and the operator's toggle is wiped. The doc promises the exact
// opposite of what a re-push does.
//
// This is not a wording nit: the sentence is a behavioural guarantee an
// operator would rely on before toggling boxes in Linear, and it is the only
// prose in the repo describing what a re-push does to their state.
//
// SCOPE CONSTRAINT: `adapters/**/*.md` carries an STE-token ceiling of 5.
// Every assertion below is satisfiable by an in-paragraph prose edit that adds
// NO `STE-<digits>` token — pinned explicitly by the last test in the file.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkboxifyLinearACs } from "../adapters/linear/src/format_description";

const pluginRoot = join(import.meta.dir, "..");
const linearDoc = readFileSync(
  join(pluginRoot, "adapters", "linear.md"),
  "utf-8",
);

const CHECKBOX_CLAUSE = "**Emit acceptance criteria as task-list checkboxes.**";

/**
 * The single blank-line-delimited paragraph a bold-lead clause occupies.
 * Paragraph-scoped so a correction has to land IN the claim's own paragraph —
 * a caveat three sections away does not retract a guarantee.
 */
function boldParagraph(doc: string, leadIn: string): string {
  const lines = doc.split("\n");
  const start = lines.findIndex((line) => line.startsWith(leadIn));
  if (start === -1) return "";
  let end = start + 1;
  while (end < lines.length && lines[end]!.trim() !== "") end++;
  return lines.slice(start, end).join("\n");
}

function sentences(paragraph: string): string[] {
  return paragraph.replace(/\n+/g, " ").split(/(?<=[.!?])\s+/);
}

const checkboxClause = () => boldParagraph(linearDoc, CHECKBOX_CLAUSE);

// --- the over-claim -------------------------------------------------------

/** An unconditional "your toggle survives a re-push" guarantee. */
const TOGGLE_GUARANTEE_RE = new RegExp(
  [
    "\\bnever\\b[^.]{0,120}\\b(?:reset|wipe|clear|lose|lost|discard)\\w*\\b[^.]{0,60}\\btoggle\\b",
    "\\btoggle\\b[^.]{0,80}\\bis (?:never|not)\\b[^.]{0,40}\\b(?:reset|wiped|cleared|lost|discarded)\\b",
    "\\bwithout\\b[^.]{0,60}\\b(?:reset|wip|clear|discard)\\w*\\b[^.]{0,60}\\btoggle\\b",
  ].join("|"),
  "i",
);

/**
 * Vocabulary that makes a preservation claim TRUE by naming what it depends
 * on — the state carried by the body being pushed, or the re-render that
 * supplies none.
 */
const SCOPE_QUALIFIER_RE = new RegExp(
  [
    "already (?:carr|present|there|checked|has|holds|set)",
    "\\binput\\b",
    "\\bincoming\\b",
    "\\bsource body\\b",
    "\\bre-?render",
    "\\bfr_body\\b",
    "\\bFR (?:file|body)\\b",
    "\\bno state to preserve\\b",
  ].join("|"),
  "i",
);

/** A guarantee sentence with nothing scoping it to the state it depends on. */
function makesUnscopedToggleGuarantee(paragraph: string): boolean {
  return sentences(paragraph).some(
    (s) => TOGGLE_GUARANTEE_RE.test(s) && !SCOPE_QUALIFIER_RE.test(s),
  );
}

/**
 * The accurate replacement. Either shape closes it, per the defect's own
 * framing ("scopes preservation to a body that already carries state, AND/OR
 * warns that a re-render from the FR file supplies no state to preserve"):
 *
 *   (a) preservation stated as a property of the input body;
 *   (b) an explicit warning that the FR-file re-render carries no state.
 */
function documentsAccuratePreservationScope(paragraph: string): boolean {
  const ss = sentences(paragraph);
  const scopedToInput = ss.some(
    (s) => /\bpreserv\w*/i.test(s) && SCOPE_QUALIFIER_RE.test(s),
  );
  const warnsAboutFrRerender = ss.some(
    (s) =>
      /\{?fr_body\}?|\bFR (?:file|body)\b|\bre-?render/i.test(s) &&
      /\bno (?:checked )?state\b|\bcarr\w+ no\b|\bplain\b|\bunchecked\b|\breset\w*\b|\bwipe\w*\b/i.test(
        s,
      ),
  );
  return scopedToInput || warnsAboutFrRerender;
}

// ---------------------------------------------------------------------------
// Slice sanity + drift guards (GREEN today — the fix corrects the claim, it
// does not delete the documentation).
// ---------------------------------------------------------------------------

describe("adapters/linear.md — the checkbox-emit clause still documents the transform", () => {
  test("slice sanity: the clause is one paragraph inside the push-path section", () => {
    const clause = checkboxClause();
    expect(clause.length).toBeGreaterThan(0);
    expect(clause).toContain("checkboxifyLinearACs");
    expect(clause).toContain("## Acceptance Criteria");
    // Paragraph-scoped: the neighbouring backtick-wrap clause must not leak in,
    // or the assertions below could be satisfied by editing the wrong clause.
    expect(clause).not.toContain("formatLinearDescription(description)");
  });

  test("drift guard: idempotence + canonicalization stay documented", () => {
    const clause = checkboxClause();
    expect(clause).toMatch(/idempotent/i);
    expect(clause).toMatch(/canonicaliz/i);
    // The GFM one-character rule is the reason canonicalization exists.
    expect(clause).toMatch(/- \[x ?\]|\[  \]|- \[ x\]/);
  });

  test("drift guard: the update path this clause describes really does re-render from the FR body", () => {
    // Grounds the defect. If these ever stop holding, the "toggle is wiped on
    // re-sync" premise would no longer follow and this file should be revisited.
    expect(linearDoc).toContain("ticket_description_template");
    expect(linearDoc.replace(/\s+/g, " ")).toContain(
      "Render `ticket_description_template` with `{fr_body}` = full FR description body",
    );
    expect(linearDoc.replace(/\s+/g, " ")).toContain(
      "`mcp__linear__save_issue(id=ticket_id_or_null, title, description=<rendered template>)` (update: pass `id`)",
    );
  });
});

// ---------------------------------------------------------------------------
// The behavioural fact the prose has to match (GREEN today — this is what
// makes the doc assertion non-vacuous rather than a style preference).
// ---------------------------------------------------------------------------

describe("the transform preserves INPUT state — and an FR body carries none", () => {
  const FR_BODY =
    "## Acceptance Criteria\n" +
    "- AC-STE-416.1: first\n" +
    "- AC-STE-416.2: second\n";
  const OPERATOR_TOGGLED_IN_LINEAR =
    "## Acceptance Criteria\n" +
    "- [x] AC-STE-416.1: first\n" +
    "- [ ] AC-STE-416.2: second\n";

  test("state IS preserved when the body handed to the transform already carries it", () => {
    const out = checkboxifyLinearACs(OPERATOR_TOGGLED_IN_LINEAR);
    expect(out).toContain("- [x] AC-STE-416.1: first");
    expect(out).toContain("- [ ] AC-STE-416.2: second");
  });

  test("a re-render from the FR file supplies no state, so every criterion comes back unchecked", () => {
    // This is the documented update path: description = template rendered with
    // {fr_body}. The operator's `[x]` above is nowhere in that input.
    const out = checkboxifyLinearACs(FR_BODY);
    expect(out).toContain("- [ ] AC-STE-416.1: first");
    expect(out).toContain("- [ ] AC-STE-416.2: second");
    expect(out).not.toContain("- [x]");
    // The toggle the operator set is gone — which is exactly what the doc's
    // "never resets an operator's toggle" clause promises cannot happen.
    expect(out).not.toBe(OPERATOR_TOGGLED_IN_LINEAR);
  });

  test("an FR file on disk really does carry plain, stateless AC bullets", () => {
    // Non-vacuity for the premise: FR bodies are the transform's real input on
    // the update path, and none of them carries a checkbox.
    const fr = readFileSync(
      join(pluginRoot, "..", "..", "specs", "frs", "STE-417.md"),
      "utf-8",
    );
    expect(fr).toMatch(/^- AC-STE-417\.1:/m);
    expect(fr).not.toMatch(/^- \[[ xX]\] AC-/m);
  });
});

// ---------------------------------------------------------------------------
// The defect itself
// ---------------------------------------------------------------------------

describe("adapters/linear.md — the toggle-preservation claim is accurate", () => {
  test("the clause carries no unscoped `never resets an operator's toggle` guarantee", () => {
    expect(makesUnscopedToggleGuarantee(checkboxClause())).toBe(false);
  });

  test("preservation is scoped to the state its input carries, or the FR-file re-render is called out", () => {
    expect(documentsAccuratePreservationScope(checkboxClause())).toBe(true);
  });

  test("the correction spends no `adapters/**/*.md` STE-token headroom", () => {
    // The ceiling is 5 across `adapters/**/*.md`. The fix is prose-only, so the
    // clause must stay tracker-ID-free.
    expect(checkboxClause()).not.toMatch(/\bSTE-\d+\b/);
  });
});
