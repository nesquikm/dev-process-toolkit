// M128 STE-491 — one documented fixture-roster spelling, on every leg.
//
// ===========================================================================
// THE DEFECT
// ===========================================================================
//
// On the 2026-08-16 /conformance-loop iter-1 the linear and none legs reported
// their fixture roster one line per group, in the spelling the harness
// documents. The jira leg compacted the whole roster onto ONE line:
//
//     STE-226 PASS · STE-214 N/A · STE-215 PASS · …
//
// A human reads both. A search for the documented `runtime check:` spelling
// finds thirteen matches on two legs and ZERO on the third — and zero is
// byte-indistinguishable from a leg that never reported the roster at all.
// That is the silent-skip shape `smoke_fixture_groups.ts` exists to remove,
// re-created one layer up in how the run is WRITTEN DOWN.
//
// MEASURED, BEFORE THIS TEST WAS WRITTEN. The authority module already renders
// the canonical form on every leg:
//
//     bun adapters/_shared/src/smoke_fixture_groups.ts render \
//         --leg <leg> --passed "" --failed ""
//
// prints one `STE-<sut> runtime check: <LABEL>` line per rostered group for
// linear, jira and none alike. So the compact form was never a module output —
// it is what HAND-TALLYING produces when a leg does not run the module. The
// repair is therefore documentary, and it has two halves:
//
//   (1) the spelling is stated ONCE, as the single accepted form, at the point
//       a leg reads before writing its findings file — § Phase 3 — Capture —
//       naming the module as the producer and naming the compact form as
//       REJECTED rather than merely unmentioned;
//   (2) fixture group 12's footer, which restates the general rule in its own
//       words, CITES that one statement instead. Two statements of one rule is
//       the STE-486 drift shape, and this repair must not plant a third.
//
// ===========================================================================
// WHAT IS PRESERVATION AND WHAT IS NEW — stated up front, per the brief
// ===========================================================================
//
// PRESERVATION (green on the current tree; these must not regress):
//   - every module-side assertion in AC-STE-491.2 — the renderer and its CLI
//     already emit one canonical line per group on all three legs;
//   - group 12 still naming its own `STE-467 runtime check: PASS` / `… FAIL`
//     lines (hazard pin — m124-ste-467-implement-lens.test.ts:513-517 and
//     m117-ste-425-falsifiable-coverage.test.ts:1109-1114 both read them);
//   - the FR Notes already recording that no automated consumer depended on
//     the spelling.
//
// RED on the current tree (the work this FR buys):
//   - AC.1 — § Phase 3 — Capture carries no roster-spelling statement at all;
//     the only site that qualifies today is § Phase 2.X summary line, and it
//     names no compact form to reject;
//   - AC.3 — group 12's footer restates the general rule ("… rather than
//     nothing at all") and cites nothing;
//   - AC.4 — the Notes frame the finding at CAPTURE time and never contrast
//     preventive with corrective, nor name the spelling the claim is about.
//
// FALSIFIABILITY. The module-side count is largely preservation, so it is
// paired with siblings that MUST fail it: the compact rendering the jira leg
// actually emitted, a compact rendering that mentions `runtime check:` exactly
// once, and a roster short by one group. A count that cannot fail is not a
// check. `/gate-check` output and findings files are LLM-rendered and no
// findings file is ever committed, so nothing here pins a transcript — the
// subject is the renderer and the SKILL's own normative prose.

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  CANONICAL_FIXTURE_GROUPS,
  FIXTURE_GROUP_OUTCOMES,
  reconcileFixtureGroups,
  renderFixtureGroupLine,
  renderFixtureGroupSummary,
  SMOKE_LEGS,
  type FixtureGroupOutcome,
  type FixtureGroupRecord,
} from "../adapters/_shared/src/smoke_fixture_groups";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");
const SMOKE_SKILL = join(REPO_ROOT, ".claude", "skills", "smoke-test", "SKILL.md");
const SKILL_BODY = readFileSync(SMOKE_SKILL, "utf8");
const GROUPS_MODULE = join(PLUGIN_ROOT, "adapters", "_shared", "src", "smoke_fixture_groups.ts");

/** The module's own filename, as the SKILL must name it. Derived, not retyped. */
const GROUPS_MODULE_BASENAME = "smoke_fixture_groups.ts";

/** The middle dot the compacting leg joined its roster with (U+00B7). */
const COMPACT_JOINER = "·";

/** How many groups the roster carries. NEVER a literal — the roster is the authority. */
const ROSTER_SIZE = CANONICAL_FIXTURE_GROUPS.length;

// ---------------------------------------------------------------------------
// The documented spelling, DERIVED from the renderer rather than transcribed
// ---------------------------------------------------------------------------

/**
 * The four operator-visible labels, read out of the renderer itself by asking
 * it to render one record per outcome. Transcribing them here would make this
 * whole file a second copy of the vocabulary — the exact failure class the FR
 * is about, committed in the test that polices it.
 */
const OUTCOME_LABELS: readonly string[] = FIXTURE_GROUP_OUTCOMES.map((outcome) => {
  const line = renderFixtureGroupLine({ group: 1, sut: "STE-000", outcome });
  const label = line.split("runtime check: ")[1];
  if (label === undefined || label.length === 0) {
    throw new Error(`could not read the label for outcome ${outcome} out of ${JSON.stringify(line)}`);
  }
  return label;
});

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

/** One documented roster line: `STE-<N> runtime check: <one of the four labels>`. */
const SPELLING_RE = new RegExp(
  `^STE-\\d+ runtime check: (?:${OUTCOME_LABELS.map(escapeRe).join("|")})$`,
);

/** How many lines of `text` are the documented spelling. THE search under test. */
function countDocumentedLines(text: string): number {
  return text.split("\n").filter((line) => SPELLING_RE.test(line.trim())).length;
}

/** Records for a leg on which the run reported nothing — shape only, not a verdict. */
function recordsFor(leg: string): readonly FixtureGroupRecord[] {
  return reconcileFixtureGroups([], leg);
}

/** The compact rendering the jira leg actually emitted, rebuilt from real records. */
function compactRendering(records: readonly FixtureGroupRecord[]): string {
  return records
    .map((record) => {
      const label = renderFixtureGroupLine(record).split("runtime check: ")[1] as string;
      return `${record.sut} ${label}`;
    })
    .join(` ${COMPACT_JOINER} `);
}

// ---------------------------------------------------------------------------
// SKILL.md section slicing — fence-aware, and in two flavours
// ---------------------------------------------------------------------------

interface HeadingRef {
  readonly index: number;
  readonly depth: number;
  readonly line: string;
}

/**
 * Every heading OUTSIDE a fenced block, plus each line's byte offset.
 *
 * Fence-awareness is load-bearing here for the same reason it is in
 * `shared_carve_out.ts`: this SKILL's shell fences open with `# …` comments,
 * and a naive scan reads them as headings and truncates the very section it
 * was asked to read — which would report a rule ABSENT and pass a
 * "not restated" assertion for entirely the wrong reason.
 */
function headings(body: string): { offsets: number[]; refs: HeadingRef[] } {
  const lines = body.split("\n");
  const offsets: number[] = [];
  let at = 0;
  for (const line of lines) {
    offsets.push(at);
    at += line.length + 1;
  }
  const refs: HeadingRef[] = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] as string;
    if (/^[ \t]*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const hit = /^(#{1,6})[ \t]+(.*)$/.exec(line);
    if (hit) refs.push({ index: i, depth: (hit[1] as string).length, line });
  }
  return { offsets, refs };
}

const HEADINGS = headings(SKILL_BODY);

function headingContaining(needle: string): HeadingRef {
  const hits = HEADINGS.refs.filter((ref) => ref.line.includes(needle));
  if (hits.length !== 1) {
    throw new Error(`expected exactly one heading containing "${needle}", found ${hits.length}`);
  }
  return hits[0] as HeadingRef;
}

/**
 * A section's OWN prose: its heading to the next heading of ANY depth.
 *
 * Own-body rather than whole-subtree is what makes "the rule is stated once"
 * countable: `### Phase 2.X` encloses every fixture group, so a subtree slice
 * would inherit thirteen footers' worth of runtime-check lines and every
 * enclosing section would look like a statement of the rule.
 */
function ownBody(heading: HeadingRef): string {
  const next = HEADINGS.refs.find((ref) => ref.index > heading.index);
  const start = HEADINGS.offsets[heading.index] as number;
  return next
    ? SKILL_BODY.slice(start, HEADINGS.offsets[next.index] as number)
    : SKILL_BODY.slice(start);
}

/** A section INCLUDING its sub-sections: heading to the next same-or-shallower heading. */
function subtree(heading: HeadingRef): string {
  const next = HEADINGS.refs.find(
    (ref) => ref.index > heading.index && ref.depth <= heading.depth,
  );
  const start = HEADINGS.offsets[heading.index] as number;
  return next
    ? SKILL_BODY.slice(start, HEADINGS.offsets[next.index] as number)
    : SKILL_BODY.slice(start);
}

const PHASE3 = "Phase 3 — Capture";
const PHASE2X_SUMMARY = "Phase 2.X summary line";
const GROUP12 = "Fixture group 12";

function phase3Body(): string {
  return ownBody(headingContaining(PHASE3));
}

function group12Section(): string {
  return subtree(headingContaining(GROUP12));
}

/**
 * The paragraph of § Phase 3 — Capture that states the spelling — the one
 * carrying the `runtime check:` token. Scoping the substance assertions to it
 * is what keeps them from being satisfied by unrelated section prose.
 */
function normativeParagraph(): string {
  const chunks = phase3Body()
    .split(/\n{2,}/)
    .filter((chunk) => chunk.includes("runtime check:"));
  expect(chunks.length).toBeGreaterThan(0);
  return chunks.join("\n\n");
}

/**
 * Does this prose STATE the roster spelling normatively, rather than merely
 * emit one line of it?
 *
 * Three conjuncts, and each one carries weight:
 *   - the literal `runtime check:` token — the spelling itself;
 *   - all four labels — the complete alternation, not a two-outcome subset;
 *   - the authority module by name — the statement says who PRODUCES the block.
 *
 * A fixture group's footer names its own line and the labels but never the
 * module, so the thirteen footers are not statements of the rule. That is the
 * distinction the predicate exists to draw.
 */
function statesRosterSpelling(body: string): boolean {
  return (
    body.includes("runtime check:") &&
    OUTCOME_LABELS.every((label) => body.includes(label)) &&
    body.includes(GROUPS_MODULE_BASENAME)
  );
}

/** Every section whose OWN prose states the rule, by heading line. */
function sectionsStatingTheRule(): string[] {
  return HEADINGS.refs.filter((ref) => statesRosterSpelling(ownBody(ref))).map((ref) => ref.line);
}

// ---------------------------------------------------------------------------
// AC-STE-491.1 — the spelling is stated ONCE, where a leg reads it.
//
// RED today: § Phase 3 — Capture carries no roster-spelling statement, and the
// one section that does (§ Phase 2.X summary line) names no compact form to
// reject. Pinned on substance — the token shape, the module as producer, the
// compact form named and refused — never on one run's wording.
// ---------------------------------------------------------------------------

describe("AC-STE-491.1 — one normative statement, at the point a leg reads before capture", () => {
  test("§ Phase 3 — Capture states the roster spelling", () => {
    expect(statesRosterSpelling(phase3Body())).toBe(true);
  });

  test("exactly ONE section states it, and it is § Phase 3 — Capture", () => {
    const sites = sectionsStatingTheRule();
    expect(sites).toHaveLength(1);
    expect(sites[0]).toContain(PHASE3);
  });

  test("the statement carries the canonical token shape, all four labels included", () => {
    const body = phase3Body();
    expect(body).toContain("runtime check:");
    for (const label of OUTCOME_LABELS) {
      expect(body).toContain(label);
    }
    // The shape is per-GROUP and the SUT token is a variable, not one group's id.
    expect(body).toMatch(/STE-(<[^>]+>|N|\d+) runtime check:/);
  });

  test("the statement names the module as the PRODUCER, with a runnable invocation", () => {
    const body = phase3Body();
    expect(body).toContain(GROUPS_MODULE_BASENAME);
    expect(body).toMatch(/render[\s\S]{0,200}--leg/);
  });

  test("one line per ROSTERED group, with the count read from the roster not restated", () => {
    // Scoped to the paragraph that actually states the spelling. Asserting
    // "/every/ appears in § Phase 3" would be satisfied by "After every skill
    // completes" in the section's opening line — a green clause about the wrong
    // subject, which proves nothing at all.
    const statement = normativeParagraph();
    expect(statement).toMatch(/\b(every|each|one .* per)\b/i);
    expect(statement).toMatch(/group/i);
    // A count written down here is a second copy of the roster that goes stale
    // the next time a group is added — the lesson § Phase 2.X already records.
    const restatedCount = new RegExp(String.raw`\b${ROSTER_SIZE}\b[^\n]{0,40}(line|group)`, "i");
    expect(phase3Body()).not.toMatch(restatedCount);
  });

  test("the compact form is NAMED and REJECTED, not merely left unmentioned", () => {
    const body = phase3Body();
    expect(body).toContain(COMPACT_JOINER);
    const paragraph = body
      .split(/\n{2,}/)
      .find((chunk) => chunk.includes(COMPACT_JOINER));
    expect(paragraph).toBeDefined();
    expect(paragraph as string).toMatch(
      /not an accepted|not acceptable|never acceptable|is not a substitute|must not|never appear|rejected/i,
    );
  });

  test("PRESERVATION — § Phase 3 — Capture is where a leg reads before it writes findings", () => {
    // Anchoring, not decoration: the AC's site is defined by what happens
    // there, and the findings path is what makes it that site.
    expect(phase3Body()).toContain("/tmp/dpt-smoke-findings-");
  });
});

// ---------------------------------------------------------------------------
// AC-STE-491.2 — the documented spelling returns one match per rostered group
// on EVERY leg, jira included.
//
// PRESERVATION on the module side: the renderer and its CLI already do this,
// and this FR must not regress them. The clauses that genuinely discriminate
// are the three siblings below, each of which MUST fail the same check.
// ---------------------------------------------------------------------------

describe("AC-STE-491.2 — one documented line per rostered group, on every leg", () => {
  test("the roster is the authority for the expected count", () => {
    expect(ROSTER_SIZE).toBeGreaterThan(0);
    expect(new Set(CANONICAL_FIXTURE_GROUPS.map((spec) => spec.group)).size).toBe(ROSTER_SIZE);
  });

  test.each([...SMOKE_LEGS])("PRESERVATION — leg %s renders one documented line per group", (leg) => {
    const rendered = renderFixtureGroupSummary(recordsFor(leg));
    expect(countDocumentedLines(rendered)).toBe(ROSTER_SIZE);
  });

  test("PRESERVATION — the jira leg, which compacted, is not a special case", () => {
    expect(SMOKE_LEGS).toContain("jira");
    const rendered = renderFixtureGroupSummary(recordsFor("jira"));
    expect(countDocumentedLines(rendered)).toBe(ROSTER_SIZE);
    // Same count as its siblings — the leg is where the drift happened, not the
    // renderer, so all three must agree exactly.
    for (const leg of SMOKE_LEGS) {
      expect(countDocumentedLines(renderFixtureGroupSummary(recordsFor(leg)))).toBe(ROSTER_SIZE);
    }
  });

  test.each([...SMOKE_LEGS])("PRESERVATION — the CLI itself emits the block on leg %s", (leg) => {
    const run = spawnSync(
      "bun",
      [GROUPS_MODULE, "render", "--leg", leg, "--passed", "", "--failed", ""],
      { encoding: "utf8" },
    );
    // rc is the fixture-group verdict (nothing reported ⇒ fail); the SHAPE is
    // what this AC is about, so read stdout, never the exit status.
    expect(countDocumentedLines(run.stdout ?? "")).toBe(ROSTER_SIZE);
  });

  test("DISCRIMINATOR — the compact form the jira leg emitted yields ZERO matches", () => {
    for (const leg of SMOKE_LEGS) {
      const compact = compactRendering(recordsFor(leg));
      // It is one line, it is readable, and it names every group…
      expect(compact.split("\n")).toHaveLength(1);
      expect(compact.split(COMPACT_JOINER)).toHaveLength(ROSTER_SIZE);
      // …and the documented search finds nothing at all in it. Zero is exactly
      // what a leg that never reported the roster would produce.
      expect(countDocumentedLines(compact)).toBe(0);
      expect(countDocumentedLines(compact)).not.toBe(ROSTER_SIZE);
    }
  });

  test("DISCRIMINATOR — a compact line that DOES say `runtime check:` still fails", () => {
    // Kills a check that merely greps for the token: this shape contains it,
    // once, and is still not the documented block.
    const records = recordsFor("jira");
    const disguised = `runtime check: ${compactRendering(records)}`;
    expect(disguised).toContain("runtime check:");
    expect(countDocumentedLines(disguised)).not.toBe(ROSTER_SIZE);
  });

  test("DISCRIMINATOR — a roster short by one group fails the count", () => {
    const records = recordsFor("linear");
    const truncated = renderFixtureGroupSummary(records.slice(0, records.length - 1));
    expect(countDocumentedLines(truncated)).toBe(ROSTER_SIZE - 1);
    expect(countDocumentedLines(truncated)).not.toBe(ROSTER_SIZE);
  });

  test("DISCRIMINATOR — an unrecognized label is not the documented spelling", () => {
    const bogus: FixtureGroupRecord = {
      group: 1,
      sut: "STE-226",
      outcome: "skipped" as FixtureGroupOutcome,
    };
    expect(countDocumentedLines(`${bogus.sut} runtime check: SKIPPED`)).toBe(0);
    // And the renderer refuses to produce such a line in the first place.
    expect(() => renderFixtureGroupLine(bogus)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// AC-STE-491.3 — group 12 CITES the one rule instead of restating it.
//
// RED today: its footer carries the general rule's operative wording
// ("… rather than nothing at all") and points at nothing. The hazard pins
// below are PRESERVATION — two shipped tests read group 12's own PASS/FAIL
// literals, and a repair that deletes them reds files this FR does not own.
// ---------------------------------------------------------------------------

describe("AC-STE-491.3 — group 12's contract is reconciled with the general rule", () => {
  test("group 12 CITES the section that carries the rule", () => {
    expect(group12Section()).toMatch(/§\s*Phase 3/);
  });

  test("the citation resolves — the cited section really is the defining one", () => {
    const sites = sectionsStatingTheRule();
    expect(sites).toHaveLength(1);
    expect(sites[0]).toContain(PHASE3);
    // A citation naming a section that states nothing is a dangling reference,
    // which is worse than the restatement it replaced.
    expect(statesRosterSpelling(phase3Body())).toBe(true);
  });

  test("group 12 no longer RESTATES the general rule's operative wording", () => {
    const restated = "rather than nothing at all";
    expect(SKILL_BODY).toContain(restated); // still stated somewhere — see below
    expect(group12Section()).not.toContain(restated);
  });

  test("GUARD — group 12 does not state the rule independently", () => {
    // The predicate that identifies a statement of the rule must not match it:
    // one statement, not two.
    expect(statesRosterSpelling(group12Section())).toBe(false);
  });

  test("PRESERVATION — group 12 still names its own runtime-check line", () => {
    // m124-ste-467-implement-lens.test.ts:513-517 and
    // m117-ste-425-falsifiable-coverage.test.ts:1109-1114 both read these.
    const spec = CANONICAL_FIXTURE_GROUPS.find((entry) => entry.group === 12);
    expect(spec).toBeDefined();
    const sut = (spec as { sut: string }).sut;
    const section = group12Section();
    expect(section).toContain(`${sut} runtime check: PASS`);
    expect(section).toContain(`${sut} runtime check: FAIL`);
  });

  test("PRESERVATION — group 12 is reconciled, not deleted", () => {
    const section = group12Section();
    expect(section.length).toBeGreaterThan(800);
    expect(section).toContain("extractAssistantText");
  });
});

// ---------------------------------------------------------------------------
// AC-STE-491.4 — the Notes record the preventive framing.
//
// Half preservation, half RED. The Notes already say no automated consumer
// depends on the spelling; they never contrast preventive with CORRECTIVE, and
// they never name the spelling the claim is about — so "nothing read it" is
// currently an unfalsifiable assertion about an unnamed subject.
// ---------------------------------------------------------------------------

describe("AC-STE-491.4 — the Notes frame the change as preventive", () => {
  const FR_PATHS = [
    join(REPO_ROOT, "specs", "frs", "STE-491.md"),
    join(REPO_ROOT, "specs", "frs", "archive", "STE-491.md"),
  ];

  function frBody(): string {
    // Union of active and archived — the archive-fallback lesson: a test that
    // reads only the active path goes red the moment the FR is archived.
    const found = FR_PATHS.filter((path) => existsSync(path));
    expect(found.length).toBeGreaterThan(0);
    return found.map((path) => readFileSync(path, "utf8")).join("\n");
  }

  function notes(): string {
    const body = frBody();
    const at = body.indexOf("## Notes");
    expect(at).toBeGreaterThan(-1);
    const next = body.indexOf("\n## ", at + 1);
    return next === -1 ? body.slice(at) : body.slice(at, next);
  }

  test("PRESERVATION — the Notes record that no automated consumer depended on it", () => {
    expect(notes()).toMatch(/no automated consumer/i);
  });

  test("the Notes name the SUBJECT the claim is about", () => {
    // "nothing read it" is only checkable once "it" is named.
    expect(notes()).toContain("runtime check:");
  });

  test("the Notes say preventive rather than corrective — both halves", () => {
    const body = notes();
    expect(body).toMatch(/preventive/i);
    expect(body).toMatch(/correct(ive|ion)/i);
  });

  test("the framing is tied to the time of the FIX, not only to capture time", () => {
    expect(notes()).toMatch(/at the time of the fix|when the fix (landed|shipped)/i);
  });
});
