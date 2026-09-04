// STE-377 — /spec-write Jira Epic-first milestone-allocation branch
// (SKILL prose contract).
//
// AC-STE-377.1/.3/.5: skills/spec-write/SKILL.md's milestone-allocation step
// gains a Jira-mode branch — create the milestone Epic first, derive the id
// via `milestoneIdFromEpicKey` as `M_<epic-key>`, bypass
// `nextFreeMilestoneNumber` on that path, write the plan file at
// `specs/plan/M_<epic-key>.md`, and bind each FR with `milestone:
// M_<epic-key>` frontmatter. Byte-checkable literal pins, same discipline as
// probe #47/#55 (literal substring, no regex on canonical phrases).
//
// Gate preservation (STE-401): the Jira branch routes through the SAME
// `requireOrRefuse` milestone-allocation gate at the same gate site with the
// Epic-derived id as `defaultValue` — the canonical phrases pinned by
// `spec_write_milestone_gate_routed.ts` must survive the edit verbatim, so
// the marker-absent + non-tty path still refuses (never a prose-ask no-op).

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runSpecWriteMilestoneGateRoutedProbe } from "../adapters/_shared/src/spec_write_milestone_gate_routed";

const SKILL_PATH = join(__dirname, "..", "skills", "spec-write", "SKILL.md");
const REPO_ROOT = join(__dirname, "..", "..", "..");

const skill = readFileSync(SKILL_PATH, "utf-8");

// The Jira Epic-first allocation contract as byte-checkable literals the
// SKILL body MUST carry (drawn from the FR's own vocabulary):
//   - `M_<epic-key>`                 — the derived milestone-id shape (AC .1)
//   - `milestoneIdFromEpicKey`       — the sanitizer routing (AC .1)
//   - `Epic-first`                   — the branch's claim-on-create posture (AC .1)
//   - `Epic before FR tickets`       — ordering: Tasks can `parent` to it (AC .1/.3)
//   - "bypass `nextFreeMilestoneNumber`" — no sequential scan on the Jira path (AC .1/.2)
//   - `milestone: M_<epic-key>`      — FR frontmatter binding (AC .3)
//   - `specs/plan/M_<epic-key>.md`   — the plan-file path (AC .5)
//   - `Epic-derived`                 — the gate's defaultValue on the Jira
//                                      path is the Epic-derived id (STE-401 routing)
const REQUIRED_EPIC_FIRST_LITERALS = [
  "M_<epic-key>",
  "milestoneIdFromEpicKey",
  "Epic-first",
  "Epic before FR tickets",
  "bypass `nextFreeMilestoneNumber`",
  "milestone: M_<epic-key>",
  "specs/plan/M_<epic-key>.md",
  "Epic-derived",
] as const;

describe("AC-STE-377.1/.3/.5 — spec-write SKILL documents the Jira Epic-first branch", () => {
  for (const literal of REQUIRED_EPIC_FIRST_LITERALS) {
    test(`SKILL body carries the literal ${JSON.stringify(literal)}`, () => {
      expect(skill).toContain(literal);
    });
  }

  test("the allocator guard is still present for the explicitly-typed `M<N>` path (AC .4)", () => {
    // The existing allocation guard paragraph must survive the Jira branch
    // edit. It once said so because "the five-way scan remains the Linear
    // path"; that reason is dead (see RETARGETED below) and the paragraph
    // survives for the hand-typed-`M<N>` check instead.
    //
    // RETIRED (M119 STE-440): the full
    // `nextFreeMilestoneNumber(specsDir, changelogPath, provider, branchScanner)`
    // call literal. This was the SIXTH pin on that wording — AC-STE-440.6
    // enumerates five and all five live in
    // `tests/m115-ste-417-docs-pins.test.ts`; this one sits in a different
    // file and was undercounted. It is retired for the same reason as the
    // other five: /spec-write now instructs ONE `resolveMilestoneIdentity`
    // call that routes by mode, so no per-mode call signature survives in the
    // prose. Coverage moved to
    // `tests/m119-ste-440-milestone-identity-dispatcher.test.ts`, which
    // asserts the dispatcher's linear branch equals the helper's own answer
    // with all four arguments forwarded.
    // RETARGETED (M139 STE-541, AC-STE-541.6). This asserted `"five-way scan"`
    // as prose evidence that "the five-way scan remains the Linear path". That
    // claim is now false: `mode: linear` no longer resolves an identity
    // OFFLINE — the sequential scan needed no tracker, whereas
    // `mintMilestoneLinear` requires a provider carrying the milestone-create
    // op, because an identity derived from a tracker object cannot be computed
    // without the tracker. AC-STE-377.4's Linear-unchanged block and
    // AC-STE-417.5's narrowed survivor are both retired by name in
    // `specs/plan/M139.md`.
    //
    // REPLACEMENT, named at the site: the mint-equality and zero-call-count
    // assertions in `tests/m139-ste-541-linear-minted-milestone.test.ts`
    // (AC-STE-541.1) own the Linear branch's behaviour now. What survives here
    // is the half this file was ever answerable for — the guard still NAMES the
    // allocator module, for the one job it keeps: checking a hand-typed `M<N>`
    // against everything the project can see. Retargeted onto that job rather
    // than deleted, so the Jira edit still cannot silently drop the reference.
    expect(skill).toContain("adapters/_shared/src/next_free_milestone_number.ts");
    expect(skill).not.toContain("five-way scan");
    expect(skill).toContain("Explicitly-typed `M<N>` check");
  });
});

describe("AC-STE-377.1 — milestone-allocation gate routing preserved verbatim (STE-401)", () => {
  test("spec_write_milestone_gate_routed probe stays green on the edited SKILL", async () => {
    const report = await runSpecWriteMilestoneGateRoutedProbe(REPO_ROOT);
    expect(report.violations).toEqual([]);
  });

  test("gate site + refusal outcome literals survive the Jira branch edit", () => {
    // Marker-absent + non-tty must still refuse at the same gate site —
    // never a prose-ask-then-end-turn no-op (2026-07-19 conformance F1).
    expect(skill).toContain("milestone-allocation");
    expect(skill).toContain("requireOrRefuse");
    expect(skill).toContain("RequiresInputRefusedError");
    expect(skill).toContain("milestone_allocation_default_applied");
    expect(skill).toContain("prose-ask-then-end-turn is forbidden under non-tty");
  });
});
