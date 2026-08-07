// STE-449 — the fixture-group roster audit and the `/setup` step 7c resolution.
//
// WHAT THIS FR FOUND, because the ACs were written expecting a different answer
// and a later reader should not have to reconstruct the difference.
//
// The FR and `specs/plan/M121.md` § Blast radius both pre-concluded that step
// 7c's line 194 ("branch automation stays disabled") was the surviving truth
// and line 190 the false clause. HALF of that is right. The write question is
// settled exactly as predicted — Schema L *is* the `## Task Tracking` section,
// a tracker-less project emits no such section, so `branch_template:` has
// nowhere to go and `/setup` writes nothing. But the CONSEQUENCE clause is
// false: branch automation does not stay disabled.
//
// Two mechanisms read that key and only one is gated on it:
//   - `/implement` § 0.b″ branch PROPOSAL — "Absent `branch_template:` ⇒ skip
//     entirely". Genuinely disabled under `mode: none`.
//   - The STE-228 UNIVERSAL PRE-COMMIT BRANCH GATE (`requireCommittableBranch`)
//     — `docs/patterns.md` § Pattern 28: "The gate has no tracker awareness."
//     Called unconditionally by `/spec-write` § 7a and five other
//     commit-producing skills; takes its template from
//     `canonicalBranchTemplate({ milestone })` in CODE, never from CLAUDE.md.
//
// So BOTH lines carried a false clause and both are corrected. And the stated
// reason to expect otherwise — that a minted `M_<tail>` identity leaves `{N}`
// with no referent — is refuted by execution below: `M_<tail>` parses as an
// epic token and renders in sanitizer form.
//
// The roster consequence follows directly. Group 5's SUT is STE-228, i.e. the
// unconditional gate, so the group is NOT `not-applicable` on the tracker-less
// leg — it keeps a full roster and its outcome comes from observation. The
// group that DOES lose the leg is group 4, for an unrelated reason the audit
// turned up: it is constituted as two tracker-parameterized sub-fixtures.
//
// PIN DISCIPLINE (docs/patterns.md § Pattern 31). The prose corrections below
// QUOTE the false clauses they retire, so a whole-file `not.toContain` would
// fire on the paragraph explaining the fix — the collision this repo has hit
// ten times. Every ban here is therefore scoped to the OPERATIVE line (the
// instruction bullet), and each is paired with a positive assertion that the
// replacement is present, since "the bad string is gone" is also satisfied by
// deleting the section outright.

import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  CANONICAL_FIXTURE_GROUPS,
  FIXTURE_GROUP_OUTCOMES,
  SMOKE_LEGS,
  reconcileFixtureGroups,
} from "../adapters/_shared/src/smoke_fixture_groups";
import {
  canonicalBranchTemplate,
  buildBranchProposal,
} from "../adapters/_shared/src/branch_proposal";
import { mintMilestoneId } from "../adapters/_shared/src/mint_milestone_id";
import { parseMilestoneToken } from "../adapters/_shared/src/milestone_token";

const pluginRoot = join(import.meta.dir, "..");
const SETUP_SKILL_REL = "skills/setup/SKILL.md";
const SETUP_SKILL = join(pluginRoot, SETUP_SKILL_REL);

function setupDoc(): string {
  expect(existsSync(SETUP_SKILL)).toBe(true);
  return readFileSync(SETUP_SKILL, "utf8");
}

/** The `- Write the resolved value …` instruction bullet of step 7c, alone. */
function writeBullet(doc: string): string {
  const line = doc
    .split("\n")
    .find((l) => l.startsWith("- Write the resolved value as `branch_template:"));
  // Non-vacuity: every ban below is scoped to this line, so a rename that made
  // it unfindable would silently satisfy all of them.
  expect(typeof line).toBe("string");
  return line!;
}

describe("AC-STE-449.2 — the step 7c contradiction is resolved, not left standing", () => {
  test("the seeded-default line no longer claims mode: none seeds the key", () => {
    const doc = setupDoc();
    const line = doc
      .split("\n")
      .find((l) => l.startsWith("default: `{type}/m{N}-{slug}`"));
    expect(typeof line).toBe("string");

    // The retired claim, scoped to its own line. Elsewhere in the file the
    // phrase legitimately appears inside the correction that explains it.
    expect(line!).not.toContain("in both tracker mode and");
    // Strictly stronger than the ban: the replacement states WHERE it is
    // seeded, so deleting the qualifier entirely does not satisfy this.
    expect(line!).toContain("seeded only where Schema L exists");
  });

  test("the write bullet drops the false disabling claim and states the reason", () => {
    const bullet = writeBullet(setupDoc());
    expect(bullet).not.toContain("branch automation stays disabled");
    // Positive half — the bullet must still forbid the write, and say why,
    // otherwise "the clause is gone" is satisfied by dropping the rule too.
    expect(bullet).toContain("skip writing");
    expect(bullet).toContain("nowhere for the key to go");
  });

  test("both mechanisms are named, with only the gated one called disabled", () => {
    // Scoped to step 7c rather than the whole file: asserting five `toContain`
    // calls against 358 lines would be satisfied by any of them appearing
    // anywhere, which is looser than the discipline this file's own header
    // sets for its negative assertions.
    const full = setupDoc();
    const start = full.indexOf("### 7c. Branch-naming template");
    const end = full.indexOf("### 7d. Docs modes");
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const doc = full.slice(start, end);
    // `/implement`'s proposal — the one that genuinely is disabled.
    expect(doc).toContain("`/implement` § 0.b″'s branch proposal");
    expect(doc).toContain("skipped entirely");
    // The universal gate — the one that is NOT.
    expect(doc).toContain("requireCommittableBranch");
    expect(doc).toContain("has no tracker awareness and never reads Schema L");
    // And the write-path non-change is stated outright rather than implied,
    // because "is this a behaviour change?" is the question a reader arrives
    // with and silence reads as yes.
    expect(doc).toContain("What `/setup` WRITES does not change");
  });
});

describe("AC-STE-449.2 — the delegated long form is corrected too", () => {
  // WHY THIS BLOCK EXISTS. Correcting only `setup/SKILL.md` RELOCATES the
  // contradiction rather than resolving it: step 7c's closing line hands the
  // reader to `docs/setup-tracker-mode.md` § Branch template for the long form,
  // and that section carried both retired claims verbatim plus a third. A
  // reader following the skill's own pointer would have landed on the text the
  // correction had just retired. Caught by an adversarial pass, not by the gate
  // — AC.2's assertions were scoped to one file, so the suite was green at
  // 6781/0 with the falsehood intact two files away.
  const TRACKER_MODE_DOC = join(pluginRoot, "docs", "setup-tracker-mode.md");

  function branchTemplateSection(): string {
    const doc = readFileSync(TRACKER_MODE_DOC, "utf8");
    const start = doc.indexOf("**Single seeded default**");
    const end = doc.indexOf("## `/setup --migrate` entry");
    // Non-vacuity: a renamed heading would otherwise slice to nothing and
    // satisfy every ban below by having no text to match.
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    return doc.slice(start, end);
  }

  test("the long form no longer claims mode: none seeds the key", () => {
    const section = branchTemplateSection();
    expect(section).not.toContain("seeded in both tracker mode and");
    expect(section).toContain("seeded (written) only in tracker mode");
  });

  test("the long form no longer claims branch automation is disabled", () => {
    const section = branchTemplateSection();
    expect(section).not.toContain("Branch automation stays disabled");
    // Positive half: the skip rule must survive, and the surviving mechanism
    // must be named — otherwise deleting the bullet satisfies the ban.
    expect(section).toContain("skip writing `branch_template:`");
    expect(section).toContain("but **not** the universal pre-commit branch gate");
  });

  test("the consumer-scope claim no longer puts commit-producing skills on any branch", () => {
    const section = branchTemplateSection();
    // The retired sentence listed `/spec-write` and `/spec-archive` among
    // skills that "continue to run on whatever branch they're invoked from".
    // They do not — they call the gate, which moves HEAD.
    // NON-VACUITY, AND THE FIRST DRAFT OF IT COULD NOT FAIL — found by the
    // AUDIT stage, in this milestone's own test. It read
    // `section.slice(section.indexOf("**Consumer scope"))` and asserted
    // `length > 0`: on a renamed heading `indexOf` returns -1, `slice(-1)`
    // yields the LAST CHARACTER, and a length of 1 passed. The guard proved
    // nothing. Assert the index instead.
    const at = section.indexOf("**Consumer scope");
    expect(at).toBeGreaterThanOrEqual(0);
    const consumerScope = section.slice(at);

    // The retired sentence put `/spec-write` and `/spec-archive` among skills
    // that "continue to run on whatever branch they're invoked from". Merely
    // finding the names is satisfied by that OLD text too, so the operative
    // assertion is that they sit on the commit-producing side of the split.
    expect(consumerScope).not.toMatch(
      /`\/spec-write`[^.]*continue to run on whatever branch/,
    );
    for (const skill of ["/spec-write", "/spec-archive"]) {
      const idx = consumerScope.indexOf(skill);
      expect({ skill, listed: idx >= 0 }).toEqual({ skill, listed: true });
    }
    expect(consumerScope).toContain("requireCommittableBranch");
    expect(consumerScope).toContain("The commit-producing skills do not");
  });
});

describe("AC-STE-449.2 — EXECUTED: the `{N}`-has-no-referent premise is false", () => {
  test("a minted mode:none milestone id parses as an epic token", () => {
    const specs = mkdtempSync(join(tmpdir(), "ste449-mint-"));
    const minted = mintMilestoneId(specs);
    expect(minted.milestoneId).toMatch(/^M_[A-Za-z0-9]+$/);
    expect(parseMilestoneToken(minted.milestoneId)?.kind).toBe("epic");
  });

  test("so it selects the milestone-keyed template and `{N}` renders", () => {
    const specs = mkdtempSync(join(tmpdir(), "ste449-mint-"));
    const minted = mintMilestoneId(specs);

    // Arm 1 — the selector picks the `{N}` form rather than falling back.
    const template = canonicalBranchTemplate({ milestone: minted.milestoneId });
    expect(template).toBe("{type}/m{N}-{slug}");

    // Arm 2 — and the placeholder actually resolves. This is the arm that
    // refutes the premise: a dangling `{N}` would survive into the output.
    const branch = buildBranchProposal({
      template,
      type: "feat",
      slug: "tracker-less-thing",
      milestone: minted.milestoneId,
    });
    expect(branch).not.toContain("{N}");
    const tail = minted.milestoneId.slice("M_".length).toLowerCase();
    expect(branch).toBe(`feat/m_${tail}-tracker-less-thing`);
  });
});

describe("AC-STE-449.3 — group 5's tracker-less outcome, assigned from the resolution", () => {
  test("group 5 keeps the tracker-less leg on its roster", () => {
    const g5 = CANONICAL_FIXTURE_GROUPS.find((s) => s.group === 5);
    expect(g5).toBeDefined();
    // The AC offers `not-applicable` "when branch automation is off under
    // tracker-less mode". It is not off for STE-228's gate, so the exemption
    // does not apply and the leg stays rostered.
    expect([...g5!.legs].sort()).toEqual(["jira", "linear", "none"]);
  });

  test("so group 5 is `not-applicable` on NO registered leg", () => {
    // The roster assertion above is about the input; this is about the output
    // the driver actually renders, which is what AC.3 asks to be assigned.
    for (const leg of SMOKE_LEGS) {
      const records = reconcileFixtureGroups([], leg);
      const g5 = records.find((r) => r.group === 5);
      expect({ leg, outcome: g5!.outcome }).toEqual({
        leg,
        // Unreported and applicable ⇒ `not-reached`, on every leg alike.
        outcome: "not-reached",
      });
    }
  });

  test("a reported group 5 passes on the tracker-less leg like any other", () => {
    const records = reconcileFixtureGroups(
      [{ group: 5, outcome: "passed" }],
      "none",
    );
    expect(records.find((r) => r.group === 5)!.outcome).toBe("passed");
  });

  test("no outcome token was invented for this FR", () => {
    // AC.3's closing constraint, and the FIRST DRAFT OF THIS TEST COULD NOT
    // FAIL — recorded because catching it is the whole point of the milestone.
    // It collected the outcomes `reconcileFixtureGroups` actually emitted and
    // asserted each was a member of the four. Those outcomes are produced by a
    // function whose return type IS the four, so the assertion re-checked a
    // guarantee the type system already gives and no roster edit could break
    // it. Adding a fifth token — the thing AC.3 forbids — would have left it
    // green, because a token nobody emits never appears in the collected set.
    //
    // What actually bites is the EXPORTED vocabulary, restated by hand. A new
    // token lands in `FIXTURE_GROUP_OUTCOMES` whether or not anything emits it.
    expect([...FIXTURE_GROUP_OUTCOMES]).toEqual([
      "passed",
      "failed",
      "not-reached",
      "not-applicable",
    ]);
  });
});

describe("AC-STE-449.1 — group 4 is the group the audit moved, and it is declared", () => {
  test("group 4 is off the tracker-less leg", () => {
    const g4 = CANONICAL_FIXTURE_GROUPS.find((s) => s.group === 4);
    expect([...g4!.legs].sort()).toEqual(["jira", "linear"]);
  });

  test("group 4 renders n/a rather than not-reached on the tracker-less leg", () => {
    // THE BEHAVIOURAL POINT OF THE CHANGE, and it is worth an assertion of its
    // own. Before the audit, group 4 rostered a leg it has no sub-fixture for,
    // so a tracker-less run reported it `not-reached` — which fails the
    // aggregate. MEASURED at rc 1 before the change: the tracker-less leg could
    // never report a fixture-group pass, no matter how well it ran.
    const observed = CANONICAL_FIXTURE_GROUPS.filter(
      (s) => s.group !== 4 && (s.legs as readonly string[]).includes("none"),
    ).map((s) => ({ group: s.group, outcome: "passed" }));

    const records = reconcileFixtureGroups(observed, "none");
    expect(records.find((r) => r.group === 4)!.outcome).toBe("not-applicable");
    expect(records.find((r) => r.group === 2)!.outcome).toBe("not-applicable");
    // And the run as a whole is now capable of passing on this leg.
    expect(records.every((r) => r.outcome !== "not-reached")).toBe(true);
  });
});
