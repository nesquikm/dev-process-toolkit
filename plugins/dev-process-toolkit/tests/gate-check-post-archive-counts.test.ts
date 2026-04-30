import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// STE-158 AC-STE-158.3 — /gate-check post-archive conformance-probe summary
// must distinguish active vs vacuous probes.
//
// Smoke #6 finding F2 (Jira): /gate-check rendered
//   "conformance-probes pass: 29/29 (most vacuous post-archive)"
// after the only active FR was archived. The "most vacuous" wording is
// soft; the canonical shape is
//   "conformance-probes pass: <N>/<N> [<active> active, <vacuous> vacuous]"
// so the operator sees an unambiguous count of active vs vacuous probes.
//
// The implementation is LLM-driven prose; the test is a doc-conformance
// probe asserting skill prose mandates the canonical summary line shape.

const pluginRoot = join(import.meta.dir, "..");
const gateCheckSkill = join(pluginRoot, "skills", "gate-check", "SKILL.md");

function read(path: string): string {
  return readFileSync(path, "utf8");
}

describe("AC-STE-158.3 — gate-check SKILL.md spec the active-vs-vacuous summary line", () => {
  test("gate-check prose names the canonical [N active, M vacuous] shape", () => {
    const body = read(gateCheckSkill);
    // Pin on the bracketed count form. Either `[N active, M vacuous]` or
    // `[<active> active, <vacuous> vacuous]` is acceptable as the canonical
    // shape — the brackets are the parseable signal.
    expect(body).toMatch(/\[[^\]]*active[^\]]*vacuous[^\]]*\]/i);
  });

  test("gate-check prose names the conformance-probes summary roll-up explicitly", () => {
    const body = read(gateCheckSkill);
    expect(body).toMatch(/conformance.probes pass/i);
  });

  test("gate-check prose explains what counts as a vacuous probe (post-archive)", () => {
    const body = read(gateCheckSkill);
    // The vacuous set is mostly probes scoped to active FRs — when no
    // active FRs remain post-archive, those probes count as vacuous. The
    // prose must explain the distinction so the LLM can compose the count.
    // Anchor the assertion to the summary-line section (the only place
    // where the active/vacuous split is doctrinally defined) so unrelated
    // gate-check prose containing "skipped" or "post-archive" can't false-
    // pass this guard.
    const summarySection = body.slice(body.indexOf("### Conformance-probes summary line"));
    expect(summarySection.length).toBeGreaterThan(0);
    expect(summarySection).toMatch(/early-return.*vacuous|vacuous.*early-return|vacuous.*post-archive|vacuous.*scope/i);
    expect(summarySection).toMatch(/active FR|FR-traversal/i);
  });
});
