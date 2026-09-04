// M115 STE-417 — the doc-surface half of tracker-less minted milestone ids.
//
// AC map:
//   AC-STE-417.2 — `skills/spec-write/SKILL.md`'s milestone-allocation guard
//                  gains a `mode: none` minted branch (mint → derive → write
//                  `specs/plan/M_<short-ULID>.md` → bind FRs), names the
//                  `nextFreeMilestoneNumber` bypass, and narrows the old
//                  "Linear and `mode: none` keep the sequential five-way scan"
//                  sentence to Linear only. The Linear five-way scan and the
//                  Jira Epic-first branch stay byte-unchanged.
//   AC-STE-417.3 — probe #73 `plan_identity_mode_conditional` is registered in
//                  `skills/gate-check/SKILL.md`, the probe count moves 72 → 73
//                  at every enumerated surface, `plan.md.template` documents
//                  the mode-none `id:` key WITHOUT emitting it as an active
//                  frontmatter key, and `docs/layout-reference.md`'s
//                  plan-frontmatter enforcing-probe list (today naming only
//                  #16 and #27) names #73.
//   AC-STE-417.5 — `docs/layout-reference.md` documents tracker-less milestone
//                  identity beside the FR identity rule, including the
//                  no-migration coexistence promise for existing `M<N>` plans.
//
// Shape precedent: `tests/m108-ste-393-docs-pins.test.ts` and
// `tests/m109-ste-394-docs-pins.test.ts`, whose probe-count pins this FR
// re-keys.
//
// HARD CONSTRAINT honoured by every literal required below: the `skills/`
// tree sits at its STE-token ceiling (246) and `skills/spec-write/SKILL.md`
// sits one line under the per-SKILL line cap. Nothing pinned here contains an
// `STE-N` token, and the whole mode-none branch is required to live INSIDE the
// existing milestone-allocation-guard paragraph rather than in a new one.
//
// ── M119 STE-440 RETIREMENT (AC-STE-440.6) ─────────────────────────────────
// The guard no longer instructs three per-mode calls; it instructs one
// `resolveMilestoneIdentity` call that routes by mode in code. Five pins below
// asserted the wording that change deletes, so they are retired in place and
// re-aimed at the dispatcher contract:
//   1. the `milestoneIdFromUlid` literal (mints/derives test)
//   2. the `bypass \`nextFreeMilestoneNumber\`` >= 2 occurrence count
//   3. the `mintMilestoneId` literal (shared-minter-module test)
//   4. the `never hand-roll the mint` literal (same test)
//   5. the full `nextFreeMilestoneNumber(specsDir, changelogPath, provider,
//      branchScanner)` call literal (Linear-byte-unchanged test)
// Everything else in this file stands: the artifact SHAPES each mode produces,
// the module references, and the record-the-`id` instruction are unchanged by
// STE-440, which moves the routing decision without moving any outcome.
// The replacement assertions live in
// `tests/m119-ste-440-dispatcher-surfaces.test.ts` (prose) and
// `tests/m119-ste-440-milestone-identity-dispatcher.test.ts` (behavior).

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseFrontmatter } from "../adapters/_shared/src/frontmatter";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");

const read = (path: string): string => readFileSync(path, "utf-8");

const specWriteSkillPath = join(PLUGIN_ROOT, "skills", "spec-write", "SKILL.md");
const gateCheckSkillPath = join(PLUGIN_ROOT, "skills", "gate-check", "SKILL.md");
const planTemplatePath = join(PLUGIN_ROOT, "templates", "spec-templates", "plan.md.template");
const layoutRefPath = join(PLUGIN_ROOT, "docs", "layout-reference.md");
const readmePath = join(REPO_ROOT, "README.md");

/** The single blank-line-delimited paragraph carrying `marker`. */
function paragraphWith(body: string, marker: string): string {
  const hits = body.split(/\n\s*\n/).filter((p) => p.includes(marker));
  expect(hits.length).toBe(1);
  return hits[0]!;
}

/** The body of a `## <heading>` section, up to the next level-2 heading. */
function section(body: string, heading: string): string {
  const start = body.indexOf(`## ${heading}`);
  expect(start).toBeGreaterThanOrEqual(0);
  const rest = body.slice(start + heading.length + 3);
  const end = rest.indexOf("\n## ");
  return end < 0 ? rest : rest.slice(0, end);
}

// ---------------------------------------------------------------------------
// AC-STE-417.2 — the mode-none minted branch in the allocation guard
// ---------------------------------------------------------------------------

describe("AC-STE-417.2 — /spec-write gains a mode: none minted-id branch", () => {
  const guard = (): string =>
    paragraphWith(read(specWriteSkillPath), "**Milestone-number allocation guard.**");

  test("the branch mints, derives, and names both artifacts it writes", () => {
    const p = guard();
    expect(p).toContain("mode: none");
    expect(p).toContain("mintId()");
    // RETIRED (STE-440 #1): the `milestoneIdFromUlid` literal. The derivation
    // is no longer something the guard instructs a reader to call — the
    // dispatcher performs it inside the mode-none branch, and
    // `tests/m119-ste-440-milestone-identity-dispatcher.test.ts` asserts
    // `milestoneIdFromUlid(id) === milestoneId` on the returned value itself.
    expect(p).toContain("resolveMilestoneIdentity");
    expect(p).toContain("specs/plan/M_<short-ULID>.md");
    expect(p).toContain("milestone: M_<short-ULID>");
  });

  test("the minted path still says what it does INSTEAD of the sequential scan", () => {
    const p = guard();
    expect(p).toContain("no scan, no fetch, no five-source collision refusal");
    // RETIRED (STE-440 #2): the `bypass \`nextFreeMilestoneNumber\`` >= 2
    // occurrence count. Two per-branch bypass declarations were the shape of a
    // prose-routed guard; with one dispatcher deciding the route the count is
    // bounded ABOVE, not below — see the `<= 1` pin in
    // `tests/m119-ste-440-dispatcher-surfaces.test.ts`.
  });

  test("minting routes through the collision-guarded minter", () => {
    expect(guard()).toContain("mintUniqueId");
  });

  // --- Phase-3 hardening: gaps the end-of-FR spec audit surfaced -----------

  test("the branch names the shared minter MODULE, reached through the dispatcher", () => {
    // Without a named module the archive leg of the collision predicate is
    // unreachable prose and a drafting agent re-implements it — dropping
    // exactly the half that silently overwrites an archived plan. The MODULE
    // reference therefore stays.
    //
    // RETIRED (STE-440 #3, #4): the `mintMilestoneId` and `never hand-roll the
    // mint` literals. Hand-rolling is no longer a habit prose discourages: the
    // dispatcher is the only call the guard instructs and it owns the
    // delegation, pinned structurally (import + call shape) in
    // `tests/m119-ste-440-milestone-identity-dispatcher.test.ts`.
    const p = guard();
    expect(p).toContain("adapters/_shared/src/mint_milestone_id.ts");
    expect(p).toContain("resolveMilestoneIdentity");
  });

  test("the branch tells the producer to RECORD the minted id in plan frontmatter", () => {
    // The read side (plan-frontmatter identity probe) is severity: error, so a
    // branch that mints without recording turns the very next gate red.
    const p = guard();
    expect(p).toMatch(/recording the returned `id` verbatim as that plan's frontmatter `id:` key/);
  });

  test("the branch-scanner parenthetical no longer claims it runs in mode: none", () => {
    // It sits three sentences above the branch that bypasses the scan
    // entirely — the stale claim contradicted the change inside one paragraph.
    const p = guard();
    expect(p).not.toContain("runs in both tracker and `mode: none`");
    expect(p).toContain("runs on every path that reaches this scan");
  });

  test("the milestone-allocation gate routes all THREE branches, not two", () => {
    // mode: none + non-tty + no marker must have a defined outcome at gate
    // site `milestone-allocation`, or it silently ends the turn under -p.
    const gate = paragraphWith(
      read(specWriteSkillPath),
      "**Milestone-allocation gate (marker/refusal routing, not a prose no-op).**",
    );
    expect(gate).toContain("tracker-less minted branch");
    expect(gate).toContain("M_<short-ULID>");
    expect(gate).toContain("same gate, same gate site on all three");
  });

  test("the retired `Linear and mode: none` sentence is GONE (tripwire)", () => {
    const body = read(specWriteSkillPath);
    expect(body).not.toContain("Linear and `mode: none` keep the sequential five-way scan");
  });

  test("the closing clause says Linear MINTS, and Jira keeps Epic-first", () => {
    // RETARGETED (M139 STE-541, AC-STE-541.6). This pinned
    // `"Linear keeps the sequential five-way scan unchanged"` — the narrowed
    // survivor of AC-STE-377.4's "Linear and mode: none unchanged" block, which
    // AC-STE-417.5 re-scoped to Linear alone. Both are retired by name in
    // `specs/plan/M139.md`: `mode: linear` no longer resolves an identity
    // OFFLINE. The sequential scan needed no tracker; `mintMilestoneLinear`
    // requires a provider carrying the milestone-create op, because an identity
    // derived from a tracker object cannot be computed without the tracker.
    //
    // REPLACEMENT, named here rather than dropped: the clause's other half
    // (`Jira keeps Epic-first`) is kept verbatim, and the Linear half is
    // re-pinned onto the sentence that now states the new contract. The
    // BEHAVIOURAL replacement for the retired scan pin is the mint-equality
    // assertion in `tests/m139-ste-541-linear-minted-milestone.test.ts`
    // ("the returned milestoneId is the mint's own derivation of the allocated
    // identifier"), which pins the dispatcher against the mint's own answer —
    // something a prose literal never could.
    const p = guard();
    expect(p).not.toContain("Linear keeps the sequential five-way scan unchanged");
    expect(p).toContain("Linear mints from the tracker");
    expect(p).toContain("Jira keeps Epic-first");
  });

  test("the allocator still owns the explicitly-typed `M<N>` check, and names its five sources", () => {
    // RETIRED (STE-440 #5): the full
    // `nextFreeMilestoneNumber(specsDir, changelogPath, provider, branchScanner)`
    // call literal. The dispatcher forwards those four arguments now.
    //
    // RETARGETED AGAIN (M139 STE-541, AC-STE-541.6): the ORDER literal
    // `"It runs a **five-way scan**"` is retired with the rest of AC-STE-417.5's
    // Linear-unchanged block, because no mint route runs that scan any more —
    // `mode: linear` no longer resolves an identity OFFLINE, and
    // `mintMilestoneLinear` requires a provider carrying the milestone-create
    // op. REPLACEMENT: the call-count assertion in
    // `tests/m139-ste-541-linear-minted-milestone.test.ts` ("the five-way scan
    // is not run — a CALL COUNT on a double, proven able to increment"), which
    // measures the absence instead of asserting a sentence about it.
    //
    // The MODULE-PATH pin below SURVIVES on purpose and is not retargeted: the
    // guard still names `next_free_milestone_number.ts` for the one job the
    // allocator keeps — checking a hand-typed `M<N>` against everything the
    // project can see — and probe #81's ordered-reference leg
    // (AC-STE-541.2) depends on that reference continuing to exist on a
    // shipped surface. The five-source list is what makes the refusal
    // checkable, so it stays too.
    const p = guard();
    expect(p).toContain("adapters/_shared/src/next_free_milestone_number.ts");
    expect(p).not.toContain("It runs a **five-way scan**");
    expect(p).toContain("`active` / `archived` / `changelog` / `tracker` / `branches`");
  });

  test("the Jira Epic-first branch is byte-unchanged", () => {
    const p = guard();
    expect(p).toContain("milestoneIdFromEpicKey");
    expect(p).toContain("specs/plan/M_<epic-key>.md");
    expect(p).toContain("milestone: M_<epic-key>");
    expect(p).toContain("no Epic is ever created off the Jira path");
  });

  test("the guard paragraph adds no tracker-ID tokens (the skills/ ceiling has zero headroom)", () => {
    expect(guard()).not.toMatch(/\bAC-STE-\d+/);
    expect(guard()).not.toMatch(/\bSTE-\d+/);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-417.3 — probe #73 registration + the 72 → 73 count move
// ---------------------------------------------------------------------------

describe("AC-STE-417.3 — gate-check SKILL.md registers probe #73", () => {
  const skill = (): string => read(gateCheckSkillPath);

  test("#73 is `plan_identity_mode_conditional` and sits directly after #72", () => {
    const body = skill();
    expect(body).toMatch(/^73\.\s+\*\*`?plan_identity_mode_conditional`?\*\*/m);
    const i72 = body.search(/^72\.\s+\*\*`?spec_write_first_turn_tracker_create_clause`?\*\*/m);
    const i73 = body.search(/^73\.\s+\*\*`?plan_identity_mode_conditional`?\*\*/m);
    expect(i72).toBeGreaterThanOrEqual(0);
    expect(i73).toBeGreaterThan(i72);
  });

  test("the #73 entry names its module, severity, scope, and test coverage", () => {
    const block = skill().match(
      /^73\.\s+\*\*`?plan_identity_mode_conditional`?\*\*[\s\S]*?(?=^\d+\.\s|\n## |$)/m,
    );
    expect(block).not.toBeNull();
    const text = block![0];
    expect(text).toContain("adapters/_shared/src/plan_identity_mode_conditional.ts");
    expect(text).toContain("runPlanIdentityModeConditionalProbe");
    expect(text).toMatch(/Severity:\s*\*?\*?error/i);
    expect(text).toContain("specs/plan");
    expect(text).toContain("tests/gate-check-plan-identity-mode-conditional.test.ts");
    // Bidirectional invariant, both directions stated.
    expect(text).toMatch(/mode: none/);
    expect(text).toMatch(/absent|MUST NOT/);
  });

  test("the #73 entry adds no tracker-ID tokens (the skills/ ceiling has zero headroom)", () => {
    const block = skill().match(
      /^73\.\s+\*\*`?plan_identity_mode_conditional`?\*\*[\s\S]*?(?=^\d+\.\s|\n## |$)/m,
    );
    expect(block).not.toBeNull();
    expect(block![0]).not.toMatch(/\bSTE-\d+/);
  });

  test("the highest numbered probe is now 82, with no gap in the sequence", () => {
    // Recalibrated 81 → 82: M137 added #82 stage_block_adoption.
    const numbers = [...skill().matchAll(/^(\d+)\. \*\*/gm)].map((m) => Number(m[1]));
    expect(Math.max(...numbers)).toBe(82);
    expect(numbers.length).toBe(82);
  });
});

describe("AC-STE-417.3 — README probe-count pins move 72 → 73", () => {
  const readme = (): string => read(readmePath);

  test("the Features bullet counts 82 numbered probes", () => {
    expect(readme()).toMatch(/\b82\b\s+numbered `\/gate-check` probes/);
  });

  test("the /implement-invokes-/tdd aside counts 82 probes", () => {
    expect(readme()).toMatch(/layers 82 probes/);
  });

  test("no stale `72 numbered` / `layers 72 probes` token survives in README", () => {
    const body = readme();
    expect(body).not.toMatch(/\b72\b\s+numbered/);
    expect(body).not.toMatch(/layers 72 probes/);
  });

  test("README and gate-check SKILL.md agree on the probe count", () => {
    const numbers = [...read(gateCheckSkillPath).matchAll(/^(\d+)\. \*\*/gm)].map((m) =>
      Number(m[1]),
    );
    const counted = read(readmePath).match(/(\d+) numbered `\/gate-check` probes/);
    expect(counted).not.toBeNull();
    expect(Number(counted![1])).toBe(Math.max(...numbers));
  });
});

// ---------------------------------------------------------------------------
// AC-STE-417.3 — plan.md.template documents the key without emitting it
// ---------------------------------------------------------------------------

describe("AC-STE-417.3 — plan.md.template documents the mode-none `id:` key", () => {
  const template = (): string => read(planTemplatePath);

  test("the template documents `id: fr_<26-char ULID>` and scopes it to mode: none", () => {
    const line = template()
      .split("\n")
      .find((l) => l.includes("id: fr_<26-char ULID>"));
    expect(line).toBeDefined();
    expect(line).toContain("mode: none");
  });

  test("the template does NOT emit `id:` as an active frontmatter key", () => {
    // Tracker-mode plans scaffold from this template verbatim, and probe #73
    // fails any tracker-mode plan carrying `id:` — so the key must ship as
    // documentation only, never as a live key.
    const fm = parseFrontmatter(template());
    expect(Object.keys(fm)).not.toContain("id");
  });

  test("the template's existing frontmatter keys survive", () => {
    const fm = parseFrontmatter(template());
    expect(Object.keys(fm)).toEqual(
      expect.arrayContaining([
        "milestone",
        "status",
        "archived_at",
        "kickoff_branch",
        "frozen_at",
        "migration",
      ]),
    );
  });
});

// ---------------------------------------------------------------------------
// AC-STE-417.3 / AC-STE-417.5 — docs/layout-reference.md
// ---------------------------------------------------------------------------

describe("AC-STE-417.3 — the plan-frontmatter enforcing-probe list names #73", () => {
  test("the plan-frontmatter bullet keeps #16 and #27 and gains #73", () => {
    const planSection = section(read(layoutRefPath), "Plan file access");
    const bullet = planSection
      .split("\n")
      .find((l) => l.includes("Frontmatter shape is enforced at gate time"));
    expect(bullet).toBeDefined();
    expect(bullet).toContain("#16");
    expect(bullet).toContain("#27");
    expect(bullet).toContain("#73");
    expect(bullet).toContain("plan_identity_mode_conditional");
  });
});

describe("AC-STE-417.5 — layout-reference documents tracker-less milestone identity", () => {
  const planSection = (): string => section(read(layoutRefPath), "Plan file access");

  test("the section states how a tracker-less milestone id is minted and derived", () => {
    const s = planSection();
    expect(s).toContain("mode: none");
    expect(s).toContain("mintId()");
    expect(s).toContain("M_<short-ULID>");
    expect(s).toContain("slice(23, 29)");
  });

  test("the section records the no-migration coexistence promise for existing `M<N>` plans", () => {
    const s = planSection();
    expect(s).toContain("no migration");
    expect(s).toMatch(/M<N>/);
  });

  test("the FR identity rule it sits beside is unchanged", () => {
    const frSection = section(read(layoutRefPath), "FR file access");
    expect(frSection).toContain("`spec.id.slice(23, 29)`");
    expect(frSection).toContain(
      "tracker mode has no `id:` line (the tracker ID is the canonical identity)",
    );
  });
});
