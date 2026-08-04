// M119 STE-440 — the DOC/TEMPLATE/GATE half of "route /spec-write milestone
// allocation through a single identity dispatcher".
//
// Split out from `tests/m119-ste-440-milestone-identity-dispatcher.test.ts` on
// purpose: that file statically imports the new module, so before the module
// lands it fails at resolution and every assertion in it is hidden. These
// three surfaces must go RED on their own merits.
//
// AC map:
//   AC-STE-440.5 — `skills/spec-write/SKILL.md` replaces the three per-mode
//                  allocation branches with ONE `resolveMilestoneIdentity`
//                  call.
//   AC-STE-440.7 — `templates/spec-templates/plan.md.template` stops
//                  scaffolding a literal `milestone: M<N>` VALUE, and the mint
//                  requirement stops being expressed solely in an HTML
//                  comment.
//   AC-STE-440.8 — `resolveMilestoneIdentity` joins
//                  `MILESTONE_GATE_REQUIRED_LITERALS`; no new gate probe is
//                  registered.
//
// ── Constraints deliberately NOT re-pinned here (they already have owners) ──
//
//   * the 358-line NFR-1 cap on every SKILL.md — `tests/skill-nfr-1-length.test.ts`
//     (`SKILL_LINE_CAP = 358`), re-pinned for this same file by
//     `tests/m116-ste-424-short-ulid-collision.test.ts`.
//   * the skills-tree `STE-<N>` token ceiling of 246 —
//     `tests/shipped-prose-no-internal-namespace.test.ts` (`CEILINGS.skills`),
//     with the guard paragraph's own zero-token pin in
//     `tests/m115-ste-417-docs-pins.test.ts`.
//   * the documented probe count of 74 —
//     `tests/m115-ste-417-docs-pins.test.ts` ("the highest numbered probe is
//     now 74, with no gap in the sequence") plus the README agreement pins in
//     the same file.
//   Duplicating any of them here would create a second place to bump and a
//   chance for the two to disagree. AC-STE-440.8's "no NEW probe" clause is
//   the one part with no existing owner, so only the negative is asserted.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseFrontmatter } from "../adapters/_shared/src/frontmatter";
import { MILESTONE_GATE_REQUIRED_LITERALS } from "../adapters/_shared/src/spec_write_milestone_gate_routed";

const PLUGIN_ROOT = join(import.meta.dir, "..");

const read = (path: string): string => readFileSync(path, "utf-8");

const specWriteSkillPath = join(PLUGIN_ROOT, "skills", "spec-write", "SKILL.md");
const gateCheckSkillPath = join(PLUGIN_ROOT, "skills", "gate-check", "SKILL.md");
const planTemplatePath = join(PLUGIN_ROOT, "templates", "spec-templates", "plan.md.template");

/** The single blank-line-delimited paragraph carrying `marker`. */
function paragraphWith(body: string, marker: string): string {
  const hits = body.split(/\n\s*\n/).filter((p) => p.includes(marker));
  expect(hits.length).toBe(1);
  return hits[0]!;
}

const guard = (): string =>
  paragraphWith(read(specWriteSkillPath), "**Milestone-number allocation guard.**");

// ---------------------------------------------------------------------------
// AC-STE-440.5 — the guard collapses to a single dispatcher call
// ---------------------------------------------------------------------------

describe("AC-STE-440.5 — the allocation guard instructs ONE dispatcher call", () => {
  test("the guard names the dispatcher and its module", () => {
    const p = guard();
    expect(p).toContain("resolveMilestoneIdentity");
    expect(p).toContain("adapters/_shared/src/resolve_milestone_identity.ts");
  });

  test("it is a SINGLE call — not three per-mode call sites wearing one name", () => {
    const calls = guard().match(/resolveMilestoneIdentity\(/g) ?? [];
    expect(calls.length).toBe(1);
  });

  test("the guard still routes every mode, so the collapse loses no branch", () => {
    const p = guard();
    expect(p).toContain("mode: none");
    expect(p).toContain("mode: jira");
    expect(p).toMatch(/Linear|linear/);
  });

  test("the retired per-mode call instructions are GONE (tripwire)", () => {
    // AC-STE-440.6 calls these "the removed wording" — the five pins it
    // retires exist because the prose that carried them is deleted, not
    // merely no longer asserted. Each literal below is one of those.
    const p = guard();
    expect(p).not.toContain("nextFreeMilestoneNumber(specsDir, changelogPath, provider, branchScanner)");
    expect(p).not.toContain("mintMilestoneId");
    expect(p).not.toContain("milestoneIdFromUlid");
    expect(p).not.toContain("never hand-roll the mint");
  });

  test("the two per-branch `bypass` declarations collapse to at most one", () => {
    // The retired occurrence-count pin asserted >= 2 (Jira's clause plus the
    // minted path's). One dispatcher decides the routing, so one statement of
    // the bypass is the most the guard can still carry.
    // `tests/spec-write-jira-epic-first-allocation.test.ts` pins >= 1 for the
    // Jira path, so together these bracket it at exactly one.
    const bypasses = guard().match(/bypass `nextFreeMilestoneNumber`/g) ?? [];
    expect(bypasses.length).toBeLessThanOrEqual(1);
  });

  test("the gate-site identifier in the prose matches the one the code exports", () => {
    // AC-STE-440.4's invariant is only real if the prose and the module agree
    // on the identifier; a drifted literal would leave the SKILL naming a
    // gate site no branch actually routes through.
    //
    // Scoped to the gate paragraph, NOT the whole file: `milestone-allocation`
    // also appears in the `RequiresInputRefusedError` clause, so a whole-file
    // `toContain` survives deletion of the very sentence this test protects.
    const gate = paragraphWith(
      read(specWriteSkillPath),
      "**Milestone-allocation gate (marker/refusal routing, not a prose no-op).**",
    );
    expect(gate).toContain("milestone-allocation");
    expect(gate).toContain("same gate, same gate site on all three");
    // The gate spec the code exports must be reachable from the prose, or the
    // producer hand-assembles the pair the module already returns.
    expect(gate).toContain("milestoneAllocationGateSpec");
  });
});

// ---------------------------------------------------------------------------
// AC-STE-440.7 — plan.md.template stops scaffolding the sequential default
//
// RECONCILIATION (stated explicitly, per the two pre-existing pins that read
// this frontmatter):
//   * `tests/m115-ste-417-docs-pins.test.ts` — "the template's existing
//     frontmatter keys survive" asserts `milestone` is among the parsed keys.
//   * `tests/plan-template-shape.test.ts` — AC-STE-197.2 asserts the same key
//     is present AND that `typeof fm["milestone"] === "string"`.
// The reading encoded below is the one the AC's own wording supports: the
// `milestone` KEY survives, only its literal `M<N>` VALUE goes. A key-removal
// reading would turn both pins red and AC-STE-440.9 with them, and the AC
// says "no longer scaffolds a literal `milestone: M<N>` value", not "drops
// the key". The replacement value must therefore still parse as a string
// (`parseFrontmatter` does not strip trailing `#` comments — the shipped
// `migration: none  # ...` line proves the shape), and must not be a
// sequential token.
// ---------------------------------------------------------------------------

const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g;

describe("AC-STE-440.7 — the plan template no longer scaffolds `milestone: M<N>`", () => {
  const template = (): string => read(planTemplatePath);

  test("the `milestone` key survives (the reading this FR encodes)", () => {
    const fm = parseFrontmatter(template());
    expect(Object.keys(fm)).toContain("milestone");
    expect(typeof fm["milestone"]).toBe("string");
  });

  test("its VALUE is no longer the literal sequential `M<N>` placeholder", () => {
    const fm = parseFrontmatter(template());
    const value = String(fm["milestone"]).trim();
    expect(value).not.toBe("M<N>");
    expect(value.startsWith("M<N>")).toBe(false);
    // ...and nothing in the file scaffolds that frontmatter line either.
    expect(template()).not.toMatch(/^milestone:\s*M<N>\s*$/m);
  });

  test("the scaffolded value is not a sequential milestone token of any shape", () => {
    const value = String(parseFrontmatter(template())["milestone"]).trim();
    expect(value).not.toMatch(/^M\d+\b/);
    expect(value).not.toMatch(/^M<N>/);
  });

  test("the mint requirement is expressed OUTSIDE the HTML comments", () => {
    // Two surfaces nudged toward the sequential outcome and both landed: the
    // scaffolded value, and a mint requirement buried in a comment a drafting
    // agent never has to read. Removing the first is only half the fix.
    const visible = template().replace(HTML_COMMENT_RE, "");
    expect(visible).toMatch(/mint/i);
    expect(visible).toContain("mode: none");
  });

  test("the milestone heading placeholders are NOT collateral damage", () => {
    // `M<N>` stays legal everywhere it names a shape rather than scaffolding a
    // value — `tests/plan-template-shape.test.ts` and
    // `tests/m113-ste-415-milestone-name-emit.test.ts` both pin the single
    // `## M<N> — … {#M<N>}` heading, which this change must not touch.
    const headings = template().match(/^##\s+M<N>\s+—\s+.*$/gm) ?? [];
    expect(headings.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-440.8 — the dispatcher is byte-pinned by the EXISTING probe
// ---------------------------------------------------------------------------

describe("AC-STE-440.8 — resolveMilestoneIdentity joins the existing gate literals", () => {
  test("`MILESTONE_GATE_REQUIRED_LITERALS` carries the dispatcher name", () => {
    expect([...MILESTONE_GATE_REQUIRED_LITERALS]).toContain("resolveMilestoneIdentity");
  });

  test("the pre-existing four literals are untouched (the pin is additive)", () => {
    const literals = [...MILESTONE_GATE_REQUIRED_LITERALS];
    for (const literal of [
      "requireOrRefuse",
      "milestone_allocation_default_applied",
      "RequiresInputRefusedError",
      "prose-ask-then-end-turn is forbidden under non-tty",
    ]) {
      expect(literals).toContain(literal);
    }
    expect(literals.length).toBe(5);
  });

  test("NO new gate probe is registered for the dispatcher", () => {
    // The dispatcher contract rides probe #47's sibling
    // (`spec_write_milestone_gate_routed`) precisely so the probe count does
    // not move; registering one would cost ~26 pinned sites across seven test
    // files for zero new coverage.
    const rows = [...read(gateCheckSkillPath).matchAll(/^(\d+)\. \*\*`?([a-z0-9_]+)`?\*\*/gm)];
    const ids = rows.map((m) => m[2]!);
    expect(ids).not.toContain("resolve_milestone_identity");
    expect(ids).not.toContain("milestone_identity_dispatcher");
    expect(ids).not.toContain("spec_write_milestone_identity_dispatcher");
    expect(ids.filter((id) => id.includes("resolve_milestone_identity"))).toEqual([]);
  });
});
