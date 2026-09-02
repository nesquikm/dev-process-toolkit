// M129 / STE-492 — "Ceremony stages must emit the hand-off fence they are
// graded on".
//
// RED-first pins for: the `deliver-stage-result` contract reaching the WORKER
// through the kickoff task text on the operative surface (`skills/deliver/
// SKILL.md`), SKILL↔reference agreement about what that kickoff text carries,
// the reduced-chain (no-toolkit-ceremony) clause, and — the load-bearing half —
// a real capture-subject predicate plus smoke fixture group 14 so the contract
// stops being evidenced solely by a grep of the orchestrator's own prose.
//
// PIN DISCIPLINE (docs/patterns.md Pattern 31; house precedents
// `m123-ste-464-deliver-skill.test.ts`, `m125-ste-469-setup-template.test.ts`):
//
//   * PRODUCER/CONSUMER ASYMMETRY (STE-485 / STE-396). All eighteen shipped
//     STE-464 ACs are prose-greps of `/deliver`'s own SKILL, which is exactly
//     why a fence with NO producer anywhere in the toolkit passed every one of
//     them. So the AC.4/AC.5 clause here takes a CAPTURE as its subject — an
//     artifact shaped like what a worker really emits — never the SKILL text.
//
//   * THE VACUITY THIS SUITE EXISTS TO KILL. `skills/deliver/SKILL.md` itself
//     contains a well-formed ```deliver-stage-result fenced EXAMPLE. A naive
//     "capture contains the banner" predicate would therefore score the SKILL
//     as a valid worker report — the clause would be about the wrong subject
//     entirely (feedback_falsifiability_limits: a perfect pin on a WRONG
//     SUBJECT is worthless). The predicate must demand a report's CONCRETE
//     values (`stage: implement`, `milestone: M129`) where the SKILL's template
//     carries a placeholder `M<N>` and `#`-annotated alternation.
//
//   * MUTATION PAIRS ARE HALF THE TEST. Isolation alone proves nothing: each
//     mutation fixture is asserted to differ from the genuine capture in
//     exactly the intended way (fence removed / sections reordered) AND to be
//     rejected for that reason, while the genuine capture is accepted. The
//     no-fence mutation deliberately KEEPS the literal token
//     `deliver-stage-result` in prose, so a token-grep predicate cannot pass it.
//
//   * ROSTER GROWTH COSTS ~SEVEN FILES (M116 lesson). Registering group 14
//     re-keys every shipped roster-count pin; the meta-meta describe at the
//     bottom names them so the re-key is a requirement, not an accident.

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  CANONICAL_FIXTURE_GROUPS,
  SMOKE_LEGS,
} from "../adapters/_shared/src/smoke_fixture_groups";
import { FENCE_LINE_CAP } from "../adapters/_shared/src/deliver_stage_capture";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");

const DELIVER_SKILL = join(PLUGIN_ROOT, "skills", "deliver", "SKILL.md");
const DELIVER_REFERENCE = join(PLUGIN_ROOT, "docs", "deliver-reference.md");
const SMOKE_SKILL = join(REPO_ROOT, ".claude", "skills", "smoke-test", "SKILL.md");

// The predicate module STE-492 introduces. Absolute path + dynamic import on
// purpose: a static `import` of a not-yet-written module fails the WHOLE file
// at resolution time, collapsing six ACs into one opaque red. Loading it per
// test keeps each AC's RED attributable.
const CAPTURE_MODULE = join(
  PLUGIN_ROOT,
  "adapters",
  "_shared",
  "src",
  "deliver_stage_capture.ts",
);

const FIXTURE_DIR = join(import.meta.dir, "fixtures", "deliver-stage-capture");
const CAPTURE_GENUINE = join(FIXTURE_DIR, "worker-stage-report.txt");
const CAPTURE_NO_FENCE = join(FIXTURE_DIR, "worker-stage-report-no-fence.txt");
const CAPTURE_REORDERED = join(FIXTURE_DIR, "worker-stage-report-reordered.txt");

// The eight sections, in the ONE canonical order, restated byte-for-byte. Not
// imported from the module under test on purpose: deriving them from the SUT
// would compare the source against itself and could never catch a rename that
// stranded the SKILL's and the reference's copies.
//
// STE-510 inserted `drive` and `e2e` between `gate` and `follow_ups`. Restating
// them here is what keeps the kickoff-enumeration check below a FULL check: while
// this list held the retired six, that assertion had silently degraded to a
// subsequence test that could not notice the two new sections vanishing from the
// kickoff bullet.
const STAGE_SECTIONS = [
  "stage",
  "milestone",
  "status",
  "summary",
  "gate",
  "drive",
  "e2e",
  "follow_ups",
] as const;

const FENCE_BANNER = "```deliver-stage-result";
const EMPTY_FALLBACK = "- (none found)";

// The shipped STE-464 assertion AC.6 names — the SKILL-grep that must stop
// being the SOLE evidence. Pinned as a literal so "no longer sole" is checked
// by ADDING a second path, never by deleting the first one.
const M123_SKILL_GREP = 'expect(deliver()).toContain("```deliver-stage-result");';

interface DeliverStageCaptureVerdict {
  ok: boolean;
  reasons: readonly string[];
}

type CaptureVerifier = (capturePath: string) => DeliverStageCaptureVerdict;

function mustRead(path: string): string {
  expect({ path, exists: existsSync(path) }).toEqual({ path, exists: true });
  return readFileSync(path, "utf8");
}

const deliver = (): string => mustRead(DELIVER_SKILL);
const reference = (): string => mustRead(DELIVER_REFERENCE);
const smoke = (): string => mustRead(SMOKE_SKILL);

async function loadVerifier(): Promise<CaptureVerifier> {
  expect({ module: CAPTURE_MODULE, exists: existsSync(CAPTURE_MODULE) }).toEqual({
    module: CAPTURE_MODULE,
    exists: true,
  });
  const mod = (await import(CAPTURE_MODULE)) as {
    verifyDeliverStageCapture?: CaptureVerifier;
  };
  expect(typeof mod.verifyDeliverStageCapture).toBe("function");
  return mod.verifyDeliverStageCapture!;
}

/**
 * The `## <heading>` … next-heading slice of a markdown body.
 */
function section(body: string, heading: RegExp): string {
  const hit = heading.exec(body);
  expect({ heading: String(heading), found: hit !== null }).toEqual({
    heading: String(heading),
    found: true,
  });
  const start = hit!.index;
  const rest = body.slice(start + hit![0].length);
  const next = /^#{2,4} /m.exec(rest);
  return body.slice(
    start,
    next ? start + hit![0].length + next.index : body.length,
  );
}

/**
 * The numbered kickoff step inside `## Phase 3` — the OPERATIVE surface AC.1
 * is about. Slice runs to the next top-level ordered-list item or heading.
 */
function kickoffStep(): string {
  const body = deliver();
  const hit = /^[ \t]*\d+\.[ \t]+\*\*Kickoff task text/m.exec(body);
  expect({ step: "kickoff task text", found: hit !== null }).toEqual({
    step: "kickoff task text",
    found: true,
  });
  const start = hit!.index;
  const rest = body.slice(start + hit![0].length);
  const next = /^[ \t]*\d+\.[ \t]+\*\*|^#{2,4} /m.exec(rest);
  return body.slice(
    start,
    next ? start + hit![0].length + next.index : body.length,
  );
}

/**
 * First whole-word index of every section name, in the order they appear.
 * Whole-word rather than backticked so the pin survives an unbackticked list;
 * FIRST index rather than every index because "fixed order" is a claim about
 * the enumeration, and the enumeration is the first place all six co-occur.
 */
function sectionOrderIndices(text: string): number[] {
  return STAGE_SECTIONS.map((name) => {
    const hit = new RegExp(`\\b${name}\\b`).exec(text);
    return hit === null ? -1 : hit.index;
  });
}

function isStrictlyIncreasing(values: readonly number[]): boolean {
  return values.every(
    (value, index) => value >= 0 && (index === 0 || value > values[index - 1]!),
  );
}

/** Paragraphs (blank-line separated) of `text` matching `probe`. */
function paragraphsMatching(text: string, probe: RegExp): string[] {
  return text.split(/\n\s*\n/).filter((para) => probe.test(para));
}

function countSectionNames(text: string): number {
  return STAGE_SECTIONS.filter((name) => new RegExp(`\\b${name}\\b`).test(text))
    .length;
}

// ---------------------------------------------------------------------------
// AC-STE-492.1 — the kickoff step names the FULL contract on the operative
// surface, not only in docs/deliver-reference.md
// ---------------------------------------------------------------------------

describe("AC-STE-492.1 — skills/deliver/SKILL.md kickoff step carries the whole contract", () => {
  test("the kickoff step still names the effort keyword (regression floor, STE-464 AC.4)", () => {
    const step = kickoffStep();
    expect(step).toContain("readOrchestrationConfig().defaultEffort");
    expect(step).toMatch(/effort keyword/i);
  });

  test("the kickoff step names the deliver-stage-result banner", () => {
    expect(kickoffStep()).toContain("deliver-stage-result");
  });

  test("the kickoff step enumerates the eight sections in fixed order", () => {
    const step = kickoffStep();
    const indices = sectionOrderIndices(step);
    const missing = STAGE_SECTIONS.filter((_, i) => indices[i]! < 0);
    expect({ missing }).toEqual({ missing: [] });
    expect({ order: STAGE_SECTIONS.join(" < "), increasing: isStrictlyIncreasing(indices) }).toEqual(
      { order: STAGE_SECTIONS.join(" < "), increasing: true },
    );
  });

  test("the kickoff step states the line cap, and states the SHIPPED number", () => {
    // STE-510 raised the cap to fit `drive:` and `e2e:`. Pinning the literal
    // `20` made this test a hostage of the constant it was describing, so it
    // now reads the shipped export: the clause stays exactly as strong (the
    // kickoff must still NAME the real cap) while becoming immune to the next
    // raise. Deriving the expectation from the SUT is safe here precisely
    // because the claim is "these two surfaces agree", not "the cap is N".
    const step = kickoffStep();
    expect(step).toMatch(/line cap|-line/i);
    // Word-anchored: a bare toContain would let "126" satisfy a cap of 26.
    expect(step).toMatch(new RegExp(`\\b${FENCE_LINE_CAP}\\b`));
  });

  test("the kickoff step states the `- (none found)` empty-section fallback", () => {
    expect(kickoffStep()).toContain(EMPTY_FALLBACK);
  });

  test("the contract is on the OPERATIVE surface — not delegated to the optional reference", () => {
    // The reference is explicitly "not required reading"; a kickoff step whose
    // only statement of the contract is a pointer at that file is the very
    // defect STE-492 exists to close.
    const step = kickoffStep();
    const stripped = step.replace(/docs\/deliver-reference\.md/g, "");
    expect(stripped).toContain("deliver-stage-result");
    expect(stripped).toContain(EMPTY_FALLBACK);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-492.2 — SKILL and reference agree on what the kickoff text carries
// ---------------------------------------------------------------------------

// Each row is asserted on BOTH surfaces. Pinning only the SKILL side would let
// the disagreement be "resolved" by quietly deleting the reference's claim —
// an absence is also satisfied by deleting the subject.
const KICKOFF_CLAIMS: ReadonlyArray<{ claim: string; probe: RegExp }> = [
  { claim: "the effort keyword", probe: /effort keyword/i },
  { claim: "the milestone identity `M<N>`", probe: /M<N>/ },
  { claim: "the ceremony chain", probe: /\bchain\b/i },
  { claim: "the deliver-stage-result contract", probe: /deliver-stage-result/ },
  { claim: "never the auto-approve marker", probe: /auto-approve marker/i },
];

describe("AC-STE-492.2 — cross-surface agreement on the kickoff text's payload", () => {
  const referenceKickoff = (): string =>
    section(reference(), /^#{2,4} Kickoff task text[ \t]*$/m);

  for (const { claim, probe } of KICKOFF_CLAIMS) {
    test(`docs/deliver-reference.md kickoff section carries: ${claim}`, () => {
      expect({ claim, present: probe.test(referenceKickoff()) }).toEqual({
        claim,
        present: true,
      });
    });

    test(`skills/deliver/SKILL.md kickoff step carries the same: ${claim}`, () => {
      expect({ claim, present: probe.test(kickoffStep()) }).toEqual({
        claim,
        present: true,
      });
    });
  }

  test("no claim is stated on one surface only — the disagreement set is empty", () => {
    const step = kickoffStep();
    const ref = referenceKickoff();
    const disagreements = KICKOFF_CLAIMS.filter(
      ({ probe }) => probe.test(ref) !== probe.test(step),
    ).map(({ claim }) => claim);
    expect({ disagreements }).toEqual({ disagreements: [] });
  });
});

// ---------------------------------------------------------------------------
// AC-STE-492.3 — the reduced-chain case is written into the contract
// ---------------------------------------------------------------------------

const REDUCED_CHAIN_PROBE =
  /reduced chain|toolkit ceremony|without the toolkit|no toolkit|non-toolkit/i;

describe("AC-STE-492.3 — a repo without toolkit ceremony cannot violate the contract", () => {
  const surfaces: ReadonlyArray<{ name: string; text: () => string }> = [
    {
      name: "skills/deliver/SKILL.md § Stage hand-offs",
      text: () => section(deliver(), /^## Stage hand-offs.*$/m),
    },
    {
      name: "docs/deliver-reference.md § the contract, expanded",
      text: () =>
        section(reference(), /^## The `deliver-stage-result` contract, expanded[ \t]*$/m),
    },
  ];

  for (const surface of surfaces) {
    test(`${surface.name} carries a reduced-chain clause`, () => {
      const paras = paragraphsMatching(surface.text(), REDUCED_CHAIN_PROBE);
      expect({ surface: surface.name, clauses: paras.length > 0 }).toEqual({
        surface: surface.name,
        clauses: true,
      });
    });

    test(`${surface.name} reduced-chain clause says which sections are omitted, naming them`, () => {
      const paras = paragraphsMatching(surface.text(), REDUCED_CHAIN_PROBE).join("\n");
      // A clause that merely gestures at "reduced chains are fine" is the
      // silent-scaffolding shape: it has to say WHICH sections, by name.
      expect({ surface: surface.name, omits: /\bomit/i.test(paras) }).toEqual({
        surface: surface.name,
        omits: true,
      });
      expect({
        surface: surface.name,
        namedSections: countSectionNames(paras) >= 2,
      }).toEqual({ surface: surface.name, namedSections: true });
    });
  }
});

// ---------------------------------------------------------------------------
// AC-STE-492.4 — the clause's subject is a CAPTURE, and it fails without a fence
// ---------------------------------------------------------------------------

describe("AC-STE-492.4 — capture fixtures exist and are genuine worker-report shape", () => {
  test("all three capture fixtures are on disk", () => {
    for (const path of [CAPTURE_GENUINE, CAPTURE_NO_FENCE, CAPTURE_REORDERED]) {
      expect({ path, exists: existsSync(path) }).toEqual({ path, exists: true });
    }
  });

  test("the genuine capture is a REPORT, not a template: prose plus one well-formed fence", () => {
    const body = mustRead(CAPTURE_GENUINE);
    const banners = body.match(/```deliver-stage-result/g) ?? [];
    expect(banners).toHaveLength(1);
    // Concrete values where the SKILL's template carries placeholders.
    expect(body).toMatch(/^stage: (?:implement|ship-milestone|pr)[ \t]*$/m);
    expect(body).toMatch(/^milestone: M\d+[ \t]*$/m);
    expect(body).toMatch(/^status: (?:ok|failed)[ \t]*$/m);
    // Report prose lives outside the fence — a bare fence is not a stage report.
    expect(body.slice(0, body.indexOf(FENCE_BANNER)).trim().length).toBeGreaterThan(40);
  });

  test("the no-fence mutation removed the FENCE, not the token (kills a token-grep predicate)", () => {
    const body = mustRead(CAPTURE_NO_FENCE);
    expect(body).not.toContain(FENCE_BANNER);
    expect(body).toContain("deliver-stage-result");
  });

  test("the reordered mutation keeps all eight sections but breaks the order", () => {
    const genuine = mustRead(CAPTURE_GENUINE);
    const reordered = mustRead(CAPTURE_REORDERED);
    expect(reordered).toContain(FENCE_BANNER);
    // Same section multiset …
    for (const name of STAGE_SECTIONS) {
      expect({ name, present: new RegExp(`^${name}:`, "m").test(reordered) }).toEqual({
        name,
        present: true,
      });
    }
    // … different order. Both halves matter: without the first, "reordered"
    // could be satisfied by a fixture that simply dropped a section.
    // The alternation is DERIVED from the restated list above, never spelled
    // out again. A hardcoded copy was a third home for the section names and
    // silently went stale: it matched only the retired six, so `order()` could
    // never see `drive`/`e2e` and the multiset assertion below compared a
    // six-name reading against an eight-name expectation.
    const SECTION_HEADING_RE = new RegExp(`^(${STAGE_SECTIONS.join("|")}):`, "gm");
    const order = (body: string): string[] =>
      (body.match(SECTION_HEADING_RE) ?? []).map((m) => m.replace(":", ""));
    expect(order(genuine)).toEqual([...STAGE_SECTIONS]);
    expect(order(reordered)).not.toEqual([...STAGE_SECTIONS]);
    expect([...order(reordered)].sort()).toEqual([...STAGE_SECTIONS].sort());
  });
});

describe("AC-STE-492.4 — verifyDeliverStageCapture accepts a real capture, rejects a fenceless one", () => {
  test("the genuine captured worker stage report passes with no reasons", async () => {
    const verify = await loadVerifier();
    const verdict = verify(CAPTURE_GENUINE);
    expect({ ok: verdict.ok, reasons: [...verdict.reasons] }).toEqual({
      ok: true,
      reasons: [],
    });
  });

  test("a capture carrying no fence FAILS, and the reason names the fence", async () => {
    const verify = await loadVerifier();
    const verdict = verify(CAPTURE_NO_FENCE);
    expect(verdict.ok).toBe(false);
    expect(verdict.reasons.length).toBeGreaterThan(0);
    expect(verdict.reasons.join(" | ")).toMatch(/fence/i);
  });
});

describe("AC-STE-492.4 — smoke fixture group 14 asserts against the capture", () => {
  const group14 = (): string =>
    section(smoke(), /^#### Fixture group 14 — STE-492.*$/m);

  test("the group heading exists in the house `#### Fixture group <N> — <SUT>` shape", () => {
    expect(smoke()).toMatch(/^#### Fixture group 14 — STE-492/m);
  });

  test("the block names the capture as the subject and the predicate that reads it", () => {
    const block = group14();
    expect(block).toContain("deliver-stage-result");
    expect(block).toContain("adapters/_shared/src/deliver_stage_capture.ts");
    expect(block).toMatch(/captur/i);
    expect(block).toContain("/tmp/dpt-smoke-");
  });

  test("the block states the negative half — a capture with no fence FAILS the group", () => {
    const block = group14();
    expect(block).toMatch(/no fence|without a fence|missing fence|zero .{0,20}fence/i);
  });

  test("the block carries both runtime-check summary lines (house group-footer shape)", () => {
    const block = group14();
    expect(block).toContain("STE-492 runtime check: PASS");
    expect(block).toContain("STE-492 runtime check: FAIL");
  });
});

describe("AC-STE-492.4 — group 14 on the canonical roster", () => {
  test("the roster is 15 groups, 1..15 in order", () => {
    expect(CANONICAL_FIXTURE_GROUPS).toHaveLength(15);
    expect(CANONICAL_FIXTURE_GROUPS.map((s) => s.group)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
    ]);
  });

  test("group 14: sut STE-492, legs = the SMOKE_LEGS alias, a real rationale", () => {
    const g14 = CANONICAL_FIXTURE_GROUPS.find((s) => s.group === 14);
    expect(g14).toBeDefined();
    expect(g14!.sut).toBe("STE-492");
    expect([...g14!.legs].sort()).toEqual(["jira", "linear", "none"]);
    // The ALIAS, not a parallel literal (STE-446). Reference identity is the
    // observable.
    expect(g14!.legs).toBe(SMOKE_LEGS as unknown as typeof g14.legs);
    // STE-449 floor: a rationale is a clause, not a token.
    expect(String(g14!.rationale).trim().split(/\s+/).length).toBeGreaterThanOrEqual(6);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-492.5 — mutation verification, including the wrong-subject vacuity
// ---------------------------------------------------------------------------

describe("AC-STE-492.5 — the clause is mutation-verified", () => {
  test("mutation 1: fence removed ⇒ REJECTED", async () => {
    const verify = await loadVerifier();
    expect(verify(CAPTURE_NO_FENCE).ok).toBe(false);
  });

  test("mutation 2: sections reordered ⇒ REJECTED, and the reason names the order", async () => {
    const verify = await loadVerifier();
    const verdict = verify(CAPTURE_REORDERED);
    expect(verdict.ok).toBe(false);
    expect(verdict.reasons.length).toBeGreaterThan(0);
    expect(verdict.reasons.join(" | ")).toMatch(/order/i);
  });

  test("isolation: the SAME predicate accepts the unmutated capture", async () => {
    // Without this leg, a predicate hard-wired to `ok: false` would pass both
    // mutation tests above. A clause must fail on its sibling AND pass on the
    // original.
    const verify = await loadVerifier();
    expect(verify(CAPTURE_GENUINE).ok).toBe(true);
  });

  test("WRONG-SUBJECT vacuity: /deliver's own SKILL.md does NOT satisfy the clause", async () => {
    // skills/deliver/SKILL.md carries a well-formed ```deliver-stage-result
    // EXAMPLE with the eight sections in the right order — a naive banner/order
    // predicate scores it as a passing worker report. It is a template, not a
    // capture: `milestone: M<N>` is a placeholder and the scalar lines carry
    // `#` alternation comments.
    const skill = deliver();
    expect(skill).toContain(FENCE_BANNER);
    expect(skill).toMatch(/^milestone: M<N>[ \t]*$/m);

    const verify = await loadVerifier();
    const verdict = verify(DELIVER_SKILL);
    expect(verdict.ok).toBe(false);
    expect(verdict.reasons.length).toBeGreaterThan(0);
    expect(verdict.reasons.join(" | ")).toMatch(/milestone|stage|placeholder|template/i);
  });

  test("the fixture group documents the wrong-subject exclusion, so nobody re-points it at the SKILL", () => {
    const block = section(smoke(), /^#### Fixture group 14 — STE-492.*$/m);
    expect(block).toMatch(/own prose|own SKILL|SKILL text|SKILL prose|template/i);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-492.6 — the SKILL-grep is no longer the SOLE evidence
// ---------------------------------------------------------------------------

describe("AC-STE-492.6 — a second, non-prose evidence path exists for the contract", () => {
  test("the shipped STE-464 SKILL-grep is still there — 'no longer sole' means ADDED to, not deleted", () => {
    const m123 = mustRead(join(import.meta.dir, "m123-ste-464-deliver-skill.test.ts"));
    expect(m123).toContain(M123_SKILL_GREP);
  });

  test("the roster now carries a group whose SUT is STE-492 — evidence outside the SKILL grep", () => {
    const suts = CANONICAL_FIXTURE_GROUPS.map((s) => s.sut);
    expect(suts).toContain("STE-492");
  });

  test("the predicate module exists and is exercised against captures, not against a SKILL", async () => {
    const verify = await loadVerifier();
    // The evidence path is capture-shaped end to end: it accepts a worker
    // artifact and refuses the orchestrator's prose.
    expect(verify(CAPTURE_GENUINE).ok).toBe(true);
    expect(verify(DELIVER_SKILL).ok).toBe(false);
  });
});

// Meta-meta pins — a roster registration flips the count in every shipped
// count-pin suite (M116: "a new probe costs ~26 pinned sites"). Naming the
// files makes the re-key a requirement rather than an accident discovered by a
// red gate.
describe("AC-STE-492.4 — shipped roster-count suites re-key from 14 to 15", () => {
  const src = (name: string): string => mustRead(join(import.meta.dir, name));

  const REKEYS: ReadonlyArray<{ file: string; expected: string }> = [
    { file: "m117-ste-425-falsifiable-coverage.test.ts", expected: "toHaveLength(15)" },
    { file: "m121-ste-451-fixture-group-10.test.ts", expected: "toHaveLength(15)" },
    { file: "m123-ste-464-deliver-skill.test.ts", expected: "toHaveLength(15)" },
    { file: "m124-ste-467-implement-lens.test.ts", expected: "toHaveLength(15)" },
    { file: "m125-ste-469-setup-template.test.ts", expected: "CANONICAL_FIXTURE_GROUPS.length).toBe(15)" },
  ];

  for (const { file, expected } of REKEYS) {
    test(`${file} carries the 15-group form`, () => {
      expect({ file, rekeyed: src(file).includes(expected) }).toEqual({
        file,
        rekeyed: true,
      });
    });
  }

  test("m121-ste-445-derivation-falsifiability.test.ts widens its per-leg coverage lists to include 15", () => {
    const file = "m121-ste-445-derivation-falsifiability.test.ts";
    const body = src(file).replace(/\s+/g, "");
    // Boolean-wrapped: a bare toContain on a 40 KB source dumps the whole file
    // into the failure message and buries every other red in the run.
    expect({ file, widened: body.includes("14,15]") }).toEqual({ file, widened: true });
  });
});

// ---------------------------------------------------------------------------
// AC-STE-492.4/.5 — the predicate's milestone grammar is the SHARED union.
//
// Caught by the STE-492 AUDIT. The predicate originally hand-rolled `^M\d+$`.
// Fixture group 14 is rostered on ALL_LEGS, and the three mint paths emit three
// different shapes — Linear `M<N>`, Jira `M_<epic-key>`, tracker-less
// `M_<short-ULID>` — so the private copy would have graded a perfectly healthy
// capture from the jira and tracker-less legs `ok:false`: a group false-REDding
// on two of its three legs while looking green on the one it was developed
// against. This is the private-`M\d+`-copy failure STE-376 centralized the
// grammar to end, and it must not silently return.
// ---------------------------------------------------------------------------

describe("AC-STE-492.5 — milestone recognition rides milestone_token, not a private copy", () => {
  const capture = (milestone: string): string =>
    [
      `/implement ${milestone} — worker stage report`,
      "",
      "Chain stage 1 of 3, spawned by /deliver as a fresh visible worker; the",
      "kickoff task text carried the effort keyword, the milestone, the chain,",
      "and the stage hand-off contract.",
      "",
      FENCE_BANNER,
      "stage: implement",
      `milestone: ${milestone}`,
      "status: ok",
      "summary:",
      "  - did the work",
      "gate:",
      "  - (none found)",
      // STE-510 inserted `drive` and `e2e` between `gate` and `follow_ups`.
      // A capture omitting them is now genuinely malformed, so this builder
      // moves with the contract rather than pinning the retired shape.
      "drive:",
      "  - (none found)",
      "e2e:",
      "  - (none found)",
      "follow_ups:",
      "  - (none found)",
      "```",
      "",
    ].join("\n");

  const verdictFor = async (milestone: string) => {
    const verify = await loadVerifier();
    const path = join(
      tmpdir(),
      `ste492-grammar-${milestone.replace(/[^A-Za-z0-9]/g, "_")}-${process.pid}.txt`,
    );
    writeFileSync(path, capture(milestone), "utf-8");
    try {
      return verify(path);
    } finally {
      rmSync(path, { force: true });
    }
  };

  // All three MINTED shapes are accepted — one per mint path.
  for (const { milestone, mintPath } of [
    { milestone: "M129", mintPath: "Linear / sequential" },
    { milestone: "M_PROJ-500", mintPath: "Jira Epic key (hyphenated)" },
    { milestone: "M_PROJ_500", mintPath: "Jira Epic key (label-safe mirror)" },
    { milestone: "M_01JABCD", mintPath: "tracker-less minted short-ULID" },
  ]) {
    test(`accepts a genuine capture from the ${mintPath} mint path (${milestone})`, async () => {
      const verdict = await verdictFor(milestone);
      expect({ milestone, ok: verdict.ok, reasons: verdict.reasons }).toEqual({
        milestone,
        ok: true,
        reasons: [],
      });
    });
  }

  // ISOLATION — the widening must not swallow the placeholder it exists to
  // reject. Without this leg, "accepts everything" would pass the four above.
  test("still REJECTS the SKILL's `M<N>` placeholder — the widening is not a blanket accept", async () => {
    const verdict = await verdictFor("M<N>");
    expect(verdict.ok).toBe(false);
    expect(verdict.reasons.some((r) => /milestone/i.test(r))).toBe(true);
  });

  test("still REJECTS a bare `M` and an empty epic key — the union has real edges", async () => {
    for (const malformed of ["M", "M_", "Mx"]) {
      expect({ malformed, ok: (await verdictFor(malformed)).ok }).toEqual({
        malformed,
        ok: false,
      });
    }
  });

  // The consumer-audit pin: the module must REFERENCE the shared grammar, so a
  // future edit cannot quietly reintroduce a private pattern and stay green.
  test("deliver_stage_capture.ts imports the shared grammar and keeps no private `M\\d+`", () => {
    const src = readFileSync(
      join(PLUGIN_ROOT, "adapters/_shared/src/deliver_stage_capture.ts"),
      "utf-8",
    );
    expect(src).toContain("milestone_token");
    expect(src).toContain("MILESTONE_TOKEN_SOURCE");
    // The private copy, by its two literal spellings.
    expect(src.includes("/^M\\d+$/")).toBe(false);
  });
});
