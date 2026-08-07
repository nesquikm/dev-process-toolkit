// STE-450 — fixture group 9, the tracker-less identity surfaces.
//
// TWO LABELS, never blurred (the STE-448 convention this file inherits):
//   * EXECUTED — the thing under test is RUN. The two gate probes are called
//     against a synthetic `mode: none` project tree built in a tmpdir; the
//     skip-reason renderer is called and its output inspected. Nothing here
//     infers a probe's behaviour from the sentence describing it.
//   * PROSE — the fixture group is instructional text the smoke driver executes
//     at run time, so the only mechanical check available is that the block
//     exists and states the right rule. Prose checks are marked, never dressed
//     up as executed ones.
//
// ─────────────────────────────────────────────────────────────────────────
// WHAT THIS FR FOUND, and a later reader should not have to re-derive it.
//
// AC-STE-450.4 asks the group to assert that "gate probe #26's skip text routes
// through `renderProbeSkipReason`". MEASURED: it does not, and it cannot today.
// `renderProbeSkipReason` has ZERO production callers — the only importers in
// the repository are its own unit test and this file. Probe #26's mode-none
// path (`tracker_project_milestone_attached.ts`, the `isTrackerMode` early
// return) yields an empty report and emits NO TEXT AT ALL, so there is no skip
// line for a renderer to produce. The "routes through" requirement lives in
// `skills/gate-check/SKILL.md` as a DIRECTIVE to the model, not as a wired
// call.
//
// So the honest split, and the reason AC.4 is reported Partial rather than
// Done: the FORBIDDEN-PHRASE half is fully enforced and falsifiable (below),
// the ROUTING half is enforced as far as it can be without wiring the probe —
// a derived drift pin binding the SKILL's directive to the module's own
// exported constant, so a rename or a reworded phrase cannot leave the
// directive quietly pointing at nothing. Wiring the probe is a change to a
// shipped surface no AC of this FR authorizes; recorded at
// `specs/notes/follow-ups.md` § 0g instead of absorbed.
// ─────────────────────────────────────────────────────────────────────────
//
// PIN DISCIPLINE (docs/patterns.md § Pattern 31). The prose below QUOTES the
// forbidden phrase in order to explain it, so a whole-file `not.toContain` on
// the smoke driver would fire on the paragraph documenting the ban — the
// eleventh instance of the collision this repository has hit ten times. Every
// ban here is therefore scoped to the artifact that would actually carry a
// regression (a capture, a rendered string), never to the documents that
// discuss it, and each is paired with a positive assertion so that "the bad
// string is gone" cannot be satisfied by deleting the rule.

import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  CANONICAL_FIXTURE_GROUPS,
  SMOKE_LEGS,
  groupsCoveringLeg,
  reconcileFixtureGroups,
} from "../adapters/_shared/src/smoke_fixture_groups";
import { runIdentityModeConditionalProbe } from "../adapters/_shared/src/identity_mode_conditional";
import { runPlanIdentityModeConditionalProbe } from "../adapters/_shared/src/plan_identity_mode_conditional";
import {
  FORBIDDEN_SKIP_PHRASE,
  renderProbeSkipReason,
} from "../adapters/_shared/src/tracker_probe_skip_reason";
import { milestoneIdFromUlid } from "../adapters/_shared/src/milestone_token";
import { mintId } from "../adapters/_shared/src/ulid";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");
const SMOKE_SKILL = join(REPO_ROOT, ".claude/skills/smoke-test/SKILL.md");
const GATE_SKILL = join(PLUGIN_ROOT, "skills/gate-check/SKILL.md");

function read(path: string): string | null {
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

const smokeDoc = read(SMOKE_SKILL);
const gateDoc = read(GATE_SKILL);
const describeIfSkills =
  smokeDoc === null || gateDoc === null ? describe.skip : describe;

// THE ANCHOR AGAINST THIS FILE SILENTLY VANISHING, and it is deliberately NOT
// inside `describeIfSkills`. That guard is a repo-wide idiom, and its failure
// mode is that a wrong path turns every test below into `describe.skip` —
// which bun reports as a SKIP at rc 0, indistinguishable from a green run to
// anything reading the exit code. Both paths are repo-root-relative and
// computed from `import.meta.dir`, exactly the shape this repository has got
// wrong before. So the file asserts, unconditionally, that it found what it
// claims to be testing.
describe("STE-450 — the documents under test were actually found", () => {
  test("both SKILL paths resolve, so the suite below is not silently skipped", () => {
    expect({ smoke: smokeDoc !== null, gate: gateDoc !== null }).toEqual({
      smoke: true,
      gate: true,
    });
  });
});

const GROUP = 9;
const TRACKERLESS_LEG = "none";
/** The probe name the group's skip assertion renders for. */
const PROBE_26 = "tracker-project-milestone-attached";

/** The `#### Fixture group 9 — …` block, sliced the way STE-425's pin does. */
function group9Slice(): string {
  const re = /#### Fixture group 9 — [\s\S]*?(?=\n#### |\n### |$)/;
  return re.exec(smokeDoc!)?.[0] ?? "";
}

// ═══════════════════════ the synthetic fixture tree ════════════════════════
//
// A real `mode: none` project, built on disk rather than mocked, because the
// two probes read files: `resolveMode` parses CLAUDE.md, the walks glob
// `specs/frs/*.md` and `specs/plan/**`. A mock would test the mock.
//
// Deliberately NOT a git repository. Probe #73's git-provenance arm only
// classifies SEQUENTIAL `M<N>` plans, and every plan here is minted, so the arm
// is unreachable either way — but a non-repo tree also makes the reachable
// classification `legacy` rather than `fresh`, so a future edit that
// accidentally introduces an `M<N>.md` fails loudly on shape rather than
// silently on provenance.

interface Group9Fixture {
  root: string;
  /** Stand-in for the `/gate-check` capture 9c asserts against. */
  capture: string;
  frPath: string;
  planPath: string;
  frId: string;
}

/**
 * The canonical skip line 9c expects probe #26's silence to be replaced by,
 * RESTATED BY HAND.
 *
 * This is deliberately not `renderProbeSkipReason(...)`. The synthetic capture
 * below is built from this constant, and 9c's positive assertion is that the
 * capture contains it — so interpolating the renderer here would make that
 * assertion compare a string with itself and pass for any renderer output
 * whatsoever, including the empty string. Found by an adversarial pass AFTER
 * this file was first reported complete; the first draft did exactly that.
 *
 * The hand-restatement is what makes the pin real, and `renderer emits exactly
 * this line` below is what stops the restatement from drifting.
 */
const CANONICAL_SKIP_LINE =
  "tracker-project-milestone-attached: skipped — `mode: none` (Schema L declares no tracker)";

/** The pre-renderer paraphrase — the F9 regression 9c exists to catch. */
const PRE_RENDERER_PARAPHRASE =
  "tracker-project-milestone-attached: skipped — probes that require Linear MCP cannot run here";

function buildFixture(): Group9Fixture {
  const root = mkdtempSync(join(tmpdir(), "ste450-"));
  mkdirSync(join(root, "specs", "frs"), { recursive: true });
  mkdirSync(join(root, "specs", "plan"), { recursive: true });

  // Absence IS the canonical `mode: none` form — no `## Task Tracking` section
  // at all (AC-STE-448.5). `resolveMode` returns "none" for a missing section.
  writeFileSync(
    join(root, "CLAUDE.md"),
    "# Fixture project\n\n## Docs\n\nuser_facing_mode: false\n",
  );

  const frId = mintId();
  const tail = frId.slice(23, 29);
  const frPath = join(root, "specs", "frs", `${tail}.md`);
  writeFileSync(
    frPath,
    [
      "---",
      'title: "Group 9 fixture FR"',
      `id: ${frId}`,
      "milestone: M_" + tail,
      "status: active",
      "archived_at: null",
      "created_at: 2026-08-08T00:00:00Z",
      "---",
      "",
      "# Group 9 fixture FR",
      "",
    ].join("\n"),
  );

  const planPath = join(root, "specs", "plan", `${milestoneIdFromUlid(frId)}.md`);
  writeFileSync(
    planPath,
    [
      "---",
      `id: ${frId}`,
      "status: active",
      "archived_at: null",
      "---",
      "",
      `## ${milestoneIdFromUlid(frId)} — Group 9 fixture milestone`,
      "",
    ].join("\n"),
  );

  return {
    root,
    capture: `GATE PASSED WITH NOTES\n${CANONICAL_SKIP_LINE}\n`,
    frPath,
    planPath,
    frId,
  };
}

// ─────────────────────────── the three mutations ──────────────────────────
//
// Each is the RED-producing input for exactly one sub-fixture. Every one
// ASSERTS IT APPLIED before returning: a mutation that silently no-ops is
// indistinguishable from a fix that does nothing, and reads as evidence about
// the code when it is evidence about the probe (follow-ups § 0b).

/** 9a's input: a `tracker:` block alongside a valid minted `id:`. */
function mutateTrackerBlock(f: Group9Fixture): void {
  const before = readFileSync(f.frPath, "utf8");
  const after = before.replace(
    /^status: active$/m,
    "tracker:\n  linear: STE-450\nstatus: active",
  );
  expect(after).not.toBe(before);
  writeFileSync(f.frPath, after);
}

/** 9b's input: a stem derived from a DIFFERENT mint than the recorded id. */
function mutatePlanStem(f: Group9Fixture): string {
  let impostor = milestoneIdFromUlid(mintId());
  // Same-millisecond mints share leading chars, not tails, so a collision is
  // vanishingly unlikely — but "vanishingly" is not "never", and a collided
  // stem would make this mutation a NO-OP that reads as the probe failing to
  // fire. Loop until it genuinely differs.
  while (impostor === milestoneIdFromUlid(f.frId)) {
    impostor = milestoneIdFromUlid(mintId());
  }
  const moved = join(f.root, "specs", "plan", `${impostor}.md`);
  renameSync(f.planPath, moved);
  expect(existsSync(moved)).toBe(true);
  expect(existsSync(f.planPath)).toBe(false);
  f.planPath = moved;
  return impostor;
}

/** 9c's input: the pre-renderer paraphrase restored into the capture. */
function mutateSkipText(f: Group9Fixture): void {
  const before = f.capture;
  f.capture = before.replace(CANONICAL_SKIP_LINE, PRE_RENDERER_PARAPHRASE);
  expect(f.capture).not.toBe(before);
}

// ───────────────────────── the three assertions ───────────────────────────
//
// One predicate per sub-fixture, evaluated over the SAME fixture, so the
// independence claim in AC-STE-450 § Technical Design ("the three assertions
// are independent and should be able to fail independently") is a measurable
// property rather than a design intention.

interface Group9Verdict {
  a: boolean;
  b: boolean;
  c: boolean;
}

async function evaluate(f: Group9Fixture): Promise<Group9Verdict> {
  const identity = await runIdentityModeConditionalProbe(f.root);
  const plan = await runPlanIdentityModeConditionalProbe(f.root);
  return {
    a: identity.violations.length === 0,
    b: plan.violations.filter((v) => v.severity === "error").length === 0,
    // BOTH halves against the HAND-RESTATED line: the canonical text must be
    // PRESENT and the paraphrase ABSENT. A ban alone is satisfied by a capture
    // that says nothing, which is the shape a silently-removed skip line takes.
    //
    // What this predicate does and does NOT establish, stated because the
    // first draft overclaimed it. Its job in the matrix is to show that
    // mutating the CAPTURE leaves the two probe predicates untouched — an
    // independence claim, and a real one. It is NOT the falsifiability
    // evidence for the renderer itself: that lives in the three AC-STE-450.4
    // tests below, which run the renderer and are the ones a broken renderer
    // reddens.
    c:
      f.capture.includes(CANONICAL_SKIP_LINE) &&
      !f.capture.includes(FORBIDDEN_SKIP_PHRASE),
  };
}

function cleanup(f: Group9Fixture): void {
  rmSync(f.root, { recursive: true, force: true });
}

// ══════════════════════════════ AC-STE-450.1 ═══════════════════════════════

describeIfSkills("AC-STE-450.1 — group 9 is registered, and the SKILL agrees", () => {
  test("the roster carries group 9 scoped to the tracker-less leg alone", () => {
    const spec = CANONICAL_FIXTURE_GROUPS.find((s) => s.group === GROUP);
    expect(spec).toBeDefined();
    expect([...spec!.legs]).toEqual([TRACKERLESS_LEG]);
  });

  test("group 9 is the ONLY group rostering the tracker-less leg alone", () => {
    // The mirror of the shipped "group 2 is the only Linear-only group" pin,
    // and the reason the roster's `legs` field is now demonstrably N-way: a
    // two-state linear/both flag cannot express this row at all.
    const noneOnly = CANONICAL_FIXTURE_GROUPS.filter(
      (s) => s.legs.length === 1 && s.legs[0] === TRACKERLESS_LEG,
    ).map((s) => s.group);
    expect(noneOnly).toEqual([GROUP]);
  });

  test("EXECUTED: the tracker-less leg's coverage set gains group 9", () => {
    expect([...groupsCoveringLeg(TRACKERLESS_LEG)]).toContain(GROUP);
    for (const leg of SMOKE_LEGS) {
      if (leg === TRACKERLESS_LEG) continue;
      expect([...groupsCoveringLeg(leg)]).not.toContain(GROUP);
    }
  });

  test("EXECUTED: group 9 reconciles n/a on every tracker leg, never not-reached", () => {
    // The distinction the whole roster exists for. On a leg the group does not
    // roster, silence must cost the run nothing — but it must ALSO not be
    // confusable with a real gap.
    for (const leg of SMOKE_LEGS) {
      const record = reconcileFixtureGroups([], leg).find((r) => r.group === GROUP);
      expect(record).toBeDefined();
      expect({ leg, outcome: record!.outcome }).toEqual({
        leg,
        outcome: leg === TRACKERLESS_LEG ? "not-reached" : "not-applicable",
      });
    }
  });

  test("PROSE: the SKILL carries a `#### Fixture group 9` block in Phase 2.X", () => {
    const slice = group9Slice();
    expect(slice.length).toBeGreaterThan(500);
    // Placed inside the runtime-check phase, not appended after it.
    const phase2x = smokeDoc!.indexOf("### Phase 2.X");
    const phase2y = smokeDoc!.indexOf("### Phase 2.Y");
    const at = smokeDoc!.indexOf("#### Fixture group 9 —");
    expect(phase2x).toBeGreaterThan(-1);
    expect(at).toBeGreaterThan(phase2x);
    expect(at).toBeLessThan(phase2y);
  });

  test("PROSE: the block's runtime-check line uses the roster's own sut token", () => {
    const spec = CANONICAL_FIXTURE_GROUPS.find((s) => s.group === GROUP)!;
    // Derived from the roster, not restated: retyping the token here would
    // pass whatever the roster said.
    expect(group9Slice()).toContain(`${spec.sut} runtime check: PASS`);
    expect(group9Slice()).toContain(`${spec.sut} runtime check: FAIL`);
    expect(group9Slice()).toContain(`${spec.sut} runtime check: N/A`);
    // NOT-REACHED belongs here too, and its omission from the first draft was
    // the sharpest of the four: it is the outcome the whole roster exists to
    // make visible, and it is the one a tracker-less run emits when the driver
    // forgets this group. Pinning all four also pins the footer shape that
    // correction #23 restored.
    expect(group9Slice()).toContain(`${spec.sut} runtime check: NOT-REACHED`);
  });
});

// ══════════════════════════════ AC-STE-450.2 ═══════════════════════════════

describeIfSkills("AC-STE-450.2 — probe #13's enforcing arm under mode: none", () => {
  test("EXECUTED: a minted id with no tracker block is clean", async () => {
    const f = buildFixture();
    try {
      const report = await runIdentityModeConditionalProbe(f.root);
      expect({ mode: report.mode, violations: report.violations }).toEqual({
        mode: "none",
        violations: [],
      });
    } finally {
      cleanup(f);
    }
  });

  test("EXECUTED: a MISSING id is a violation — the `required` half", async () => {
    const f = buildFixture();
    try {
      const before = readFileSync(f.frPath, "utf8");
      const after = before.replace(/^id: .*$/m, "");
      expect(after).not.toBe(before); // the mutation applied
      writeFileSync(f.frPath, after);
      const report = await runIdentityModeConditionalProbe(f.root);
      expect(report.violations.map((v) => v.expected)).toContain("present");
      expect(report.violations.map((v) => v.message).join("\n")).toContain(
        "mode-none FR is missing its id: line",
      );
    } finally {
      cleanup(f);
    }
  });

  test("EXECUTED: a MALFORMED id is a violation — the `well-formed` half", async () => {
    const f = buildFixture();
    try {
      // Crockford excludes I/L/O/U, so a 26-char run of `I` is exactly the
      // right shape and exactly the wrong alphabet.
      writeFileSync(
        f.frPath,
        readFileSync(f.frPath, "utf8").replace(/^id: .*$/m, `id: fr_${"I".repeat(26)}`),
      );
      const report = await runIdentityModeConditionalProbe(f.root);
      expect(report.violations.map((v) => v.expected)).toContain(
        "fr_<26-char ULID>",
      );
    } finally {
      cleanup(f);
    }
  });

  test("EXECUTED: a tracker block alongside a valid id is a violation", async () => {
    // THE NAMED RED-PRODUCING INPUT (AC-STE-450.5). Recorded in the FR's
    // implementation notes and in the SKILL's sub-fixture 9a.
    const f = buildFixture();
    try {
      mutateTrackerBlock(f);
      const report = await runIdentityModeConditionalProbe(f.root);
      const rows = report.violations.filter((v) => v.expected === "absent");
      expect(rows).toHaveLength(1);
      expect(rows[0]!.message).toContain(
        "mode-none FR carries a tracker: block that should be absent",
      );
      // DERIVED from the mutated file, not from a module constant. The first
      // draft asserted `report.severity === "error"` here, which CANNOT FAIL:
      // this probe returns `IDENTITY_MODE_CONDITIONAL_SEVERITY` unconditionally,
      // so a clean tree with ZERO violations reports `severity: "error"` too
      // (measured). It read as evidence about the staged violation and was
      // evidence about a constant — a positive pin succeeding where it should
      // not, in the FR that promoted that very rider into Pattern 31. Found by
      // the end-of-FR audit. The row's LINE is the property that actually
      // depends on the input: it must point at the `tracker:` line the
      // mutation inserted, so a probe reporting the right violation against
      // the wrong location still fails.
      const trackerLine =
        readFileSync(f.frPath, "utf8")
          .split("\n")
          .findIndex((l) => l.startsWith("tracker:")) + 1;
      expect(trackerLine).toBeGreaterThan(0); // non-vacuity: the line is there
      expect(rows[0]!.line).toBe(trackerLine);
    } finally {
      cleanup(f);
    }
  });

  test("PROSE: 9a states BOTH directions and warns off the duplicate-tail trap", () => {
    const slice = group9Slice();
    expect(slice).toContain("mode-none FR carries a tracker: block that should be absent");
    // The warning is load-bearing: staging the violation by COPYING an
    // existing FR trips probe #13's cross-file duplicate-tail pass instead,
    // which is a different row and would score 9a red for the wrong reason.
    expect(slice).toMatch(/freshly minted/i);
    expect(slice).toMatch(/duplicate-tail/i);
  });
});

// ══════════════════════════════ AC-STE-450.3 ═══════════════════════════════

describeIfSkills("AC-STE-450.3 — probe #73's enforcing arm: the plan self-derives", () => {
  test("EXECUTED: a minted plan whose stem derives from its id is clean", async () => {
    const f = buildFixture();
    try {
      const report = await runPlanIdentityModeConditionalProbe(f.root);
      expect(report.violations.filter((v) => v.severity === "error")).toEqual([]);
    } finally {
      cleanup(f);
    }
  });

  test("EXECUTED: a stem that does not derive from the recorded id is a violation", async () => {
    const f = buildFixture();
    try {
      const impostor = mutatePlanStem(f);
      const report = await runPlanIdentityModeConditionalProbe(f.root);
      const rows = report.violations.filter(
        (v) => v.expected === "an id: the filename derives from",
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.severity).toBe("error");
      expect(rows[0]!.message).toContain(
        "mode-none minted plan's id: does not derive its own filename",
      );
      // The message names BOTH sides, which is what makes the row actionable.
      expect(rows[0]!.message).toContain(milestoneIdFromUlid(f.frId));
      expect(rows[0]!.message).toContain(impostor);
    } finally {
      cleanup(f);
    }
  });

  test("EXECUTED: the derivation is `M_` + id.slice(23, 29), run not read", () => {
    for (let i = 0; i < 25; i++) {
      const id = mintId();
      expect(milestoneIdFromUlid(id)).toBe(`M_${id.slice(23, 29)}`);
    }
  });

  test("EXECUTED: an id-only check CANNOT reach this — the tail is 6 of 29", async () => {
    // Why 9b is not a duplicate of 9a's id check, measured rather than argued:
    // two distinct ids share a derived stem, so a plan can carry a correct
    // `id:` under a filename derived from a different mint and every id-shape
    // check still passes. Only recomputing the stem from the id catches it.
    const f = buildFixture();
    try {
      const twin = `fr_${"0".repeat(20)}${f.frId.slice(23, 29)}`;
      expect(twin).not.toBe(f.frId);
      expect(milestoneIdFromUlid(twin)).toBe(milestoneIdFromUlid(f.frId));
      // And the id-shape arm is blind to the swap: rewriting the frontmatter
      // id to the twin keeps the plan probe green, because the stem still
      // derives.
      writeFileSync(
        f.planPath,
        readFileSync(f.planPath, "utf8").replace(/^id: .*$/m, `id: ${twin}`),
      );
      const report = await runPlanIdentityModeConditionalProbe(f.root);
      expect(report.violations.filter((v) => v.severity === "error")).toEqual([]);
    } finally {
      cleanup(f);
    }
  });

  test("PROSE: 9b names the rule and warns off the sequential-plan trap", () => {
    const slice = group9Slice();
    expect(slice).toContain(
      "mode-none minted plan's id: does not derive its own filename",
    );
    // Staging the violation as a sequential `M<N>.md` fails through probe
    // #73's provenance arm instead — a different row with a different remedy.
    expect(slice).toMatch(/sequential/i);
  });
});

// ══════════════════════════════ AC-STE-450.4 ═══════════════════════════════

describeIfSkills("AC-STE-450.4 — the cross-mode skip-reason leak check", () => {
  test("EXECUTED: no rendered cause carries the forbidden phrase", () => {
    const causes = [
      "no_fr_in_scope",
      "active_fr_no_tracker_block",
      "fr_archived",
      "mode_none",
      "mcp_unavailable",
      "plan_file_missing",
    ] as const;
    for (const cause of causes) {
      const rendered = renderProbeSkipReason({ probe: PROBE_26, cause });
      expect({ cause, leaks: rendered.includes(FORBIDDEN_SKIP_PHRASE) }).toEqual({
        cause,
        leaks: false,
      });
      // Non-vacuity: a renderer returning "" would satisfy every ban above.
      expect(rendered.length).toBeGreaterThan(20);
      expect(rendered.startsWith(`${PROBE_26}: skipped — `)).toBe(true);
    }
  });

  test("EXECUTED: the mode_none rendering names the MODE, not an MCP remedy", () => {
    const rendered = renderProbeSkipReason({ probe: PROBE_26, cause: "mode_none" });
    expect(rendered).toContain("`mode: none`");
    // The leak this pins is a tracker-shaped remedy surviving into a mode that
    // cannot act on it. `mcp_unavailable` is the cause that legitimately talks
    // about MCP; `mode_none` must not borrow its prose.
    expect(rendered).not.toContain("MCP");
    expect(
      renderProbeSkipReason({ probe: PROBE_26, cause: "mcp_unavailable" }),
    ).toContain("MCP");
  });

  test("EXECUTED: the renderer emits exactly the line this file restates by hand", () => {
    // THE PIN THAT MAKES THE HAND-RESTATEMENT SAFE. `CANONICAL_SKIP_LINE` is
    // typed out rather than interpolated so that 9c's positive assertion is
    // not a string compared with itself — but a hand copy can drift from its
    // source, and this is the assertion that stops it. Any change to the
    // renderer's `mode_none` arm reds here.
    expect(renderProbeSkipReason({ probe: PROBE_26, cause: "mode_none" })).toBe(
      CANONICAL_SKIP_LINE,
    );
    // And the paraphrase really is the regression shape, not merely a
    // different string: it carries the banned phrase and differs from canon.
    expect(PRE_RENDERER_PARAPHRASE).toContain(FORBIDDEN_SKIP_PHRASE);
    expect(PRE_RENDERER_PARAPHRASE).not.toBe(CANONICAL_SKIP_LINE);
  });

  test("the gate-check directive is bound to the module's own constant", () => {
    // THE ROUTING HALF, as far as it goes without wiring the probe. The SKILL
    // instructs the model to route probe-#26 skip text through the helper and
    // names the phrase it must never emit. DERIVED from the module's exported
    // constant rather than retyped, so changing the phrase in one place and
    // not the other is RED instead of silent drift.
    //
    // SCOPED to the directive's own line, and the honest reason — the first
    // draft's comment here claimed something false and the FR's correction
    // tally records it. MEASURED: each of these tokens occurs EXACTLY ONCE in
    // that SKILL, all three on the directive line, so a document-wide
    // `toContain` would ALSO red if the directive were deleted. The scoping
    // does not buy that case.
    //
    // What it does buy is the case a document-wide pin genuinely misses: the
    // directive deleted while any one of the tokens survives ANYWHERE else in
    // the file — a later probe mentioning the helper, a changelog note quoting
    // the phrase. A document-wide pin stays green there; this one does not.
    // That is a narrower claim than the one first written, and it is the true
    // one (Pattern 31, read from the scope end).
    const directive = gateDoc!
      .split("\n")
      .find((l) => l.includes("**Skip-reason rendering"));
    // Non-vacuity: a renamed heading makes `find` return undefined, and every
    // assertion below would then be checking nothing.
    expect(typeof directive).toBe("string");
    expect(directive!).toContain("renderProbeSkipReason");
    expect(directive!).toContain(FORBIDDEN_SKIP_PHRASE);
    expect(directive!).toContain("MUST NOT");
  });

  test("PROSE: 9c DISCLAIMS the routing half rather than claiming it", () => {
    // The measured finding, pinned so a later reader cannot take 9c's green
    // as evidence that the routing exists. If the probe is ever wired, this
    // assertion is the one that should be revisited — deliberately.
    const slice = group9Slice();
    expect(slice).toMatch(/no production caller/i);
    expect(slice).toMatch(/§ 0g/);
  });
});

// ══════════════════════════════ AC-STE-450.5 ═══════════════════════════════
//
// Falsifiability, and independence, measured together: one matrix, four rows.

describeIfSkills("AC-STE-450.5 — the three assertions fail INDEPENDENTLY", () => {
  test("EXECUTED: the clean fixture passes all three", async () => {
    const f = buildFixture();
    try {
      expect(await evaluate(f)).toEqual({ a: true, b: true, c: true });
    } finally {
      cleanup(f);
    }
  });

  test("EXECUTED: the tracker-block input turns 9a red and ONLY 9a", async () => {
    const f = buildFixture();
    try {
      mutateTrackerBlock(f);
      expect(await evaluate(f)).toEqual({ a: false, b: true, c: true });
    } finally {
      cleanup(f);
    }
  });

  test("EXECUTED: the plan-stem input turns 9b red and ONLY 9b", async () => {
    const f = buildFixture();
    try {
      mutatePlanStem(f);
      expect(await evaluate(f)).toEqual({ a: true, b: false, c: true });
    } finally {
      cleanup(f);
    }
  });

  test("EXECUTED: the skip-text input turns 9c red and ONLY 9c", async () => {
    const f = buildFixture();
    try {
      mutateSkipText(f);
      expect(await evaluate(f)).toEqual({ a: true, b: true, c: false });
    } finally {
      cleanup(f);
    }
  });

  test("EXECUTED: all three at once turns all three red", async () => {
    // The matrix's diagonal proves each mutation reaches its own assertion;
    // this row proves none of them MASKS another — a probe that returned early
    // on the first violation would pass every row above and fail here.
    const f = buildFixture();
    try {
      mutateTrackerBlock(f);
      mutatePlanStem(f);
      mutateSkipText(f);
      expect(await evaluate(f)).toEqual({ a: false, b: false, c: false });
    } finally {
      cleanup(f);
    }
  });

  test("EXECUTED: the evaluator is not stuck-true — a torn fixture fails", async () => {
    // Anchor against the way this whole matrix could go vacuous: if `evaluate`
    // silently swallowed a probe error and returned all-true, every row above
    // would still pass on the clean fixture and fail nowhere else. Delete the
    // FR outright and the identity probe legitimately reports zero violations
    // (nothing to walk) — so the anchor is the PLAN side, where an unparseable
    // frontmatter is a real row.
    const f = buildFixture();
    try {
      writeFileSync(f.planPath, "no frontmatter at all\n");
      const v = await evaluate(f);
      expect(v.b).toBe(false);
    } finally {
      cleanup(f);
    }
  });

  test("PROSE: the SKILL records the RED-producing input for the group", () => {
    const slice = group9Slice();
    expect(slice).toMatch(/populated `tracker:` block/);
    // SCOPED to the two OPERATIVE instruction bullets, not to the block.
    // MEASURED: `GATE FAILED` occurs four times in this block and two of those
    // are inside the `<…>` placeholders of the failure-diagnostic templates,
    // so a block-wide `toContain` stays green when the actual assertion is
    // deleted from the instruction — the pin would be satisfied by the
    // template describing the failure it no longer detects.
    const violationBullets = slice
      .split("\n")
      .filter((l) => l.trimStart().startsWith("- **Violation.**"));
    expect(violationBullets).toHaveLength(2);
    for (const bullet of violationBullets) {
      expect(bullet).toContain("GATE FAILED");
    }
  });
});
