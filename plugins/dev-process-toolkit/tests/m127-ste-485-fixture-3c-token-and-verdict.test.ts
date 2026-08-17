// M127 STE-485 — fixture 3c must assert the probe-#37 identifier and the
// verdict the /gate-check runtime ACTUALLY emits.
//
// ===========================================================================
// READ THIS FIRST: TWO OF THIS FR's FIVE ACs ARE FACTUALLY WRONG AS WRITTEN,
// AND THIS FILE PINS THE MEASUREMENT, NOT THE CLAIM.
// ===========================================================================
//
// THE EVIDENCE. Fixture 3c stages a stale leaf and captures
// `claude -p /dev-process-toolkit:gate-check` into
// `/tmp/dpt-smoke-<tracker>-ste222-probe.log`. All three of those captures from
// the 2026-08-16 conformance run were preserved on disk (mtimes 20:46–20:51),
// and probe #37 GENUINELY FIRED on all three — each capture carries the planted
// `staleref-fixture-3c` leaf and a #37 row. They are the real subject of this
// FR, and they are shipped here as reduced slices.
//
// Scored the way fixture 3c actually scores — `capability_row_assert`'s
// assistant-text projection, not raw bytes — those three captures read:
//
//     token / phrase                      linear   jira   none
//     ---------------------------------------------------------
//     cross-cutting-spec-stale-file-refs      1       1      0
//     cross_cutting_spec_stale_file_refs      0       0      2
//     GATE PASSED WITH NOTES                  0       1      0
//     ADVISORY                                1       0      0
//     NOTES                                   1       1      1
//     GATE FAILED                             3       3      2
//     #37                                     4       4      2
//
// WHAT THAT REFUTES, item by item:
//
//  1. AC.3's premise — "the underscored occurrences in the repository come from
//     the module path … a filename, not an emission" — is FALSE TWICE OVER.
//     (a) At the MODULE layer the probe's own `buildMessage`
//         (`adapters/_shared/src/cross_cutting_spec_stale_file_refs.ts:242,244`)
//         emits the underscored token as message TEXT, twice per violation:
//         `cross_cutting_spec_stale_file_refs: ${reason}` and
//         `Context: … probe=cross_cutting_spec_stale_file_refs, severity=warning`.
//     (b) At the CAPTURE layer the underscored form reaches the `none` leg's
//         capture, assistant-scoped, twice — the runtime rendered
//         "**⚠ #37 `cross_cutting_spec_stale_file_refs` — severity: warning
//         (NOTES)**" and repeated it in the JSON verdict block's summary.
//     So "filename, not an emission" is not a correction; it is the THIRD
//     wrong account of this one fixture. This file pins the accurate one and
//     pins the ABSENCE of the refuted sentence.
//
//  2. AC.1's "the hyphenated … the runtime emits" holds on linear and jira and
//     FAILS on none. AC.2's "GATE PASSED WITH NOTES, the phrase the runtime
//     renders, not the literal ADVISORY it does not" is inverted on the linear
//     leg, where ADVISORY is rendered and GATE PASSED WITH NOTES is not.
//
//  3. The bullet's parenthetical "(NOT `GATE FAILED` — STE-215 AC.5 specifies
//     ADVISORY)" is false as the fixture STAGES it: the uncommitted stale leaf
//     also trips probe #22 (`toolkit_bootstrap_committed`, severity error), so
//     every one of the three genuine captures ends GATE FAILED.
//
// THE ACTUAL DEFECT, stated once. `/gate-check` is an LLM-rendered surface. It
// is handed a probe id and renders a verdict table in prose of its own choosing,
// so the SPELLING of the id and the WORDING of the notes verdict are both
// run-dependent. Fixture 3c has now drifted three times because each repair
// picked whichever single literal one leg happened to render and wrote it down
// as the runtime's contract. The repair that holds is a clause that asserts the
// SET the runtime is measured to render — `any-of` — with the AC's named
// spelling and phrase inside it, plus the per-leg measurement recorded so the
// next reader cannot re-derive a single literal from one leg.
//
// THE `CAP_ASSERT` SCORING TRAP, which the harness must be taught. Fixture 3c's
// clauses run `bun "${CAP_ASSERT}" …`, which prints a VERDICT LINE
// (`present: ok key=present(assistant=1,…)`) and signals through its exit code.
// `runAssertion`'s count parser sees no bare integer and falls back to counting
// non-empty output LINES — which is 1 whether the expectation was met or not.
// Scored on counts, every CAP_ASSERT clause is 1-vs-1 and therefore VACUOUS.
// The harness needs an exit-code scoring mode, and STE-485's registry row is
// the first user of it.
//
// ===========================================================================
// THE SHAPE THE IMPLEMENTER MUST BUILD
// ===========================================================================
//
//  A. FIXTURES — the three genuine probe-#37-firing captures, shipped as
//     reduced slices next to STE-484's:
//       tests/fixtures/m127-falsifiability/gate-check-probe37-{linear,jira,none}.ndjson
//     Originals: /tmp/dpt-smoke-<leg>-ste222-probe.log, 2026-08-16 legs. The
//     reduction must preserve every assistant-scoped count in the table above
//     byte-exactly; the tests below re-measure all of them.
//
//  B. falsifiability_harness.ts — four additions, all small:
//       probeCapturePathFor(leg): string      → gate-check-probe37-<leg>.ndjson
//       RepairEntry.capture?: string          fixture BASENAME override, so a
//                                             row can name a capture that is
//                                             not `implement-<leg>.ndjson`
//       resolveCapturePath(entry): string     the row's capture, either way
//       ScoreMode = "stdout-count" | "exit-code"
//       scoreRun(run, mode): number           exit-code mode ⇒ 1 on exit 0,
//                                             0 otherwise
//       RepairEntry.scoreBy? / FalsifiabilityCheck.scoreBy?   default
//                                             "stdout-count" (STE-484 unchanged)
//       RepairClause { site, subject, threshold, scoreBy?, label }
//       RepairEntry.clauses?: readonly RepairClause[]   extra clauses of the
//                                             SAME repair
//       checkRepairClauses(entry, skillBody): readonly FalsifiabilityResult[]
//                                             primary row first, then each
//                                             extra clause, each id'd
//                                             `<entry.id>/<label>`
//     `checkRepairEntry` keeps its exact signature and remains the primary
//     clause's scorer — no `shell` parameter ever appears.
//
//  C. adapters/_shared/src/asserted_token_source.ts — NEW, AC.5's generalisation:
//       ASSERTION_LAYERS = ["capture", "module"] as const; type AssertionLayer
//       interface TokenSource { path; text; layer }
//       countTokenEmissions(source, token): number
//           occurrences that are NOT filename/path-shaped. A hit inside a path
//           ending in a source extension, or a hit contributed by the source's
//           OWN path, is a filename mention and never an emission.
//       countTokenFilenameMentions(source, token): number
//       checkAssertedToken({ token, layer }, sources): AssertedTokenEvidence
//           { token, layer, emitted, emissions, emittingSources, filenameOnlySources }
//           Only sources whose `layer` matches the claim's layer participate.
//       assertedTokensIn(shell): readonly string[]
//           the key arguments of a `capability_row_assert` invocation — the
//           tokens after the expectation and the capture path.
//       defaultTokenSources(repoRoot): readonly TokenSource[]
//           capture-layer sources are the shipped probe captures, projected
//           through `extractAssistantText` (a token that only ever appears in
//           a capture's injected synthetic body is NOT emitted); module-layer
//           sources are the probe modules under adapters/_shared/src.
//
//  D. .claude/skills/smoke-test/SKILL.md § Sub-fixture 3c — the two live
//     clauses become `any-of` CAP_ASSERT invocations, the bold UNDERSCORED
//     instruction is retired, and the Notes record the accurate account.
//
// `.claude/skills/smoke-test/SKILL.md` lives OUTSIDE `plugins/dev-process-toolkit`
// and therefore carries no line cap and no STE-N token ceiling; ticket ids may
// be cited freely there and here.

import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { scoreCapabilityKey } from "../adapters/_shared/src/capability_row_assert";
import {
  ASSERTION_LAYERS,
  assertedTokensIn,
  checkAssertedToken,
  countTokenEmissions,
  countTokenFilenameMentions,
  defaultTokenSources,
  type AssertionLayer,
  type TokenSource,
} from "../adapters/_shared/src/asserted_token_source";
import {
  bindCapture,
  checkRepairClauses,
  checkRepairEntry,
  extractAssertionShell,
  M127_REPAIRS,
  M127_REPAIR_ROSTER,
  probeCapturePathFor,
  resolveCapturePath,
  runAssertion,
  scoreRun,
  SMOKE_SKILL_RELATIVE_PATH,
  uncoveredRepairs,
  type FalsifiabilityLeg,
  type RepairClause,
  type RepairEntry,
} from "../adapters/_shared/src/falsifiability_harness";
import { extractAssistantText } from "../adapters/_shared/src/smoke_child_capture";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");
const SMOKE_SKILL = join(REPO_ROOT, SMOKE_SKILL_RELATIVE_PATH);
const SKILL_BODY = readFileSync(SMOKE_SKILL, "utf8");

// The SKILL's § Phase 2.X preamble fence declares both of these before any
// CAP_ASSERT span runs; the harness executes extracted bytes through `bash -c`
// with this process's environment, so they have to be in scope here too.
process.env.PLUGIN_DIR = PLUGIN_ROOT;
process.env.CAP_ASSERT = join(PLUGIN_ROOT, "adapters/_shared/src/capability_row_assert.ts");

const LEGS: readonly FalsifiabilityLeg[] = ["linear", "jira", "none"];

/** The two spellings of probe #37's identifier. Both are real emissions. */
const HYPHENATED = "cross-cutting-spec-stale-file-refs";
const UNDERSCORED = "cross_cutting_spec_stale_file_refs";

/** The probe module that builds the underscored form at the MODULE layer. */
const PROBE_MODULE_RELATIVE = "adapters/_shared/src/cross_cutting_spec_stale_file_refs.ts";

/**
 * Assistant-scoped occurrences in the three GENUINE probe-#37-firing captures
 * (2026-08-16 legs). Every figure here was measured, not assumed, and the
 * shipped reduced slices must reproduce all of them.
 */
const ASSISTANT_HITS: Record<string, Record<FalsifiabilityLeg, number>> = {
  [HYPHENATED]: { linear: 1, jira: 1, none: 0 },
  [UNDERSCORED]: { linear: 0, jira: 0, none: 2 },
  "GATE PASSED WITH NOTES": { linear: 0, jira: 1, none: 0 },
  ADVISORY: { linear: 1, jira: 0, none: 0 },
  NOTES: { linear: 1, jira: 1, none: 1 },
  "GATE FAILED": { linear: 3, jira: 3, none: 2 },
  "#37": { linear: 4, jira: 4, none: 2 },
};

const TMP = mkdtempSync(join(tmpdir(), "dpt-ste485-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

function probeCapture(leg: FalsifiabilityLeg): string {
  return readFileSync(probeCapturePathFor(leg), "utf8");
}

function assistantHits(leg: FalsifiabilityLeg, token: string): number {
  return scoreCapabilityKey(probeCapture(leg), token).assistantHits;
}

function tempCapture(name: string, body: string): string {
  const path = join(TMP, name);
  writeFileSync(path, body, "utf8");
  return path;
}

/** The § Sub-fixture 3c section body, heading to next same-or-shallower heading. */
function section3c(): string {
  const start = SKILL_BODY.indexOf("##### Sub-fixture 3c");
  expect(start).toBeGreaterThan(-1);
  const rest = SKILL_BODY.slice(start + 1);
  const next = rest.search(/\n#{1,5} /);
  return next === -1 ? SKILL_BODY.slice(start) : SKILL_BODY.slice(start, start + 1 + next);
}

/** The registry row this FR adds. */
function repairEntry(): RepairEntry {
  const entry = M127_REPAIRS.find((row) => row.id === "STE-485");
  expect(entry).toBeDefined();
  return entry as RepairEntry;
}

/** The extra clause carried on that row — the verdict half. */
function verdictClause(): RepairClause {
  const clauses = repairEntry().clauses ?? [];
  expect(clauses.length).toBeGreaterThanOrEqual(1);
  return clauses[0] as RepairClause;
}

/** The SKILL's own bytes for the probe-identifier clause. */
function tokenShell(): string {
  return extractAssertionShell(SKILL_BODY, repairEntry().site).shell;
}

/** The SKILL's own bytes for the verdict clause. */
function verdictShell(): string {
  return extractAssertionShell(SKILL_BODY, verdictClause().site).shell;
}

/**
 * The same capture with probe #37's firing taken away and NOTHING else
 * reworded: both spellings of the identifier deleted, and the notes verdict
 * downgraded to a clean pass. This is what "probe #37 did not fire" looks like,
 * and it is the absent-subject half both clauses have to go red on.
 */
function probeDidNotFire(leg: FalsifiabilityLeg): string {
  return probeCapture(leg)
    .split(HYPHENATED)
    .join("some-other-probe")
    .split(UNDERSCORED)
    .join("some_other_probe")
    .split("GATE PASSED WITH NOTES")
    .join("GATE PASSED")
    .split("NOTES")
    .join("CLEAN")
    .split("ADVISORY")
    .join("CLEAN");
}

// ---------------------------------------------------------------------------
// AC-STE-485.1 — the probe-identifier clause asserts the hyphenated spelling
// the runtime emits, AND a capture from a genuine probe firing satisfies it.
//
// Those are TWO requirements, and the measurement says no single literal meets
// both: the hyphenated form is absent from the `none` leg's genuine firing.
// Both halves are pinned separately so the only clause that passes this
// describe is one that NAMES the hyphenated spelling and is SATISFIED by every
// genuine firing — i.e. an `any-of` over the spellings actually rendered.
// ---------------------------------------------------------------------------

describe("AC-STE-485.1 — the identifier clause names the hyphenated form and passes a real firing", () => {
  test("the three shipped captures are genuine probe-#37 firings", () => {
    for (const leg of LEGS) {
      expect(existsSync(probeCapturePathFor(leg))).toBe(true);
      const raw = probeCapture(leg);
      // The planted leaf, and a #37 row keyed on it. Without both, the capture
      // is not evidence of a firing and nothing below means anything.
      expect(raw).toContain("staleref-fixture-3c");
      expect(assistantHits(leg, "#37")).toBe(ASSISTANT_HITS["#37"]![leg]);
      // Exactly one of the two spellings surfaces on each leg — never neither.
      const hy = assistantHits(leg, HYPHENATED);
      const un = assistantHits(leg, UNDERSCORED);
      expect(hy + un).toBeGreaterThan(0);
    }
  });

  test("the clause carries the hyphenated spelling the AC names", () => {
    const shell = tokenShell();
    expect(shell).toContain(HYPHENATED);
    expect(shell).toContain("CAP_ASSERT");
    expect(shell).toContain("/tmp/dpt-smoke-<tracker>-ste222-probe.log");
    // Verbatim SKILL bytes — never a remembered copy.
    expect(SKILL_BODY).toContain(shell);
  });

  test("a genuine probe firing satisfies the clause on EVERY leg", () => {
    const shell = tokenShell();
    for (const leg of LEGS) {
      const run = runAssertion(bindCapture(shell, probeCapturePathFor(leg)));
      expect(run.exitCode).toBe(0);
    }
  });

  test("the runtime renders BOTH spellings, leg-dependent — measured", () => {
    for (const leg of LEGS) {
      expect(assistantHits(leg, HYPHENATED)).toBe(ASSISTANT_HITS[HYPHENATED]![leg]);
      expect(assistantHits(leg, UNDERSCORED)).toBe(ASSISTANT_HITS[UNDERSCORED]![leg]);
    }
    // Neither spelling is universal. That is the whole finding.
    expect(assistantHits("none", HYPHENATED)).toBe(0);
    expect(assistantHits("linear", UNDERSCORED)).toBe(0);
  });

  test("a hyphenated-ONLY `present` clause is red on a healthy `none` firing", () => {
    // The refutation of the naive repair, executed rather than argued: this is
    // the clause AC.1 reads as if it prescribes, and it scores a correct probe
    // run as broken on one leg in three — the exact failure STE-421 AC.4
    // produced in the other direction.
    const naive = `bun "\${CAP_ASSERT}" present /tmp/dpt-smoke-<tracker>-ste222-probe.log ${HYPHENATED}`;
    expect(runAssertion(bindCapture(naive, probeCapturePathFor("linear"))).exitCode).toBe(0);
    expect(runAssertion(bindCapture(naive, probeCapturePathFor("none"))).exitCode).not.toBe(0);

    // …while the shipped clause is green on the same `none` capture.
    expect(runAssertion(bindCapture(tokenShell(), probeCapturePathFor("none"))).exitCode).toBe(0);
  });

  test("the section records the per-leg spelling measurement, not one leg's rendering", () => {
    const section = section3c();
    expect(section).toContain(HYPHENATED);
    expect(section).toContain(UNDERSCORED);
    expect(section).toContain("2026-08-16");
    expect(section).toContain("STE-485");
    // The runtime is LLM-rendered, and the section has to say so — that is the
    // reason a single literal can never be the contract.
    expect(section).toMatch(/leg-dependent|run-dependent|renders?/i);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-485.2 — the verdict clause asserts `GATE PASSED WITH NOTES`.
//
// Same two-sided pin: the phrase must be NAMED, and the clause must pass every
// genuine firing. `GATE PASSED WITH NOTES` is rendered on jira only; `ADVISORY`
// on linear only; `NOTES` on all three.
// ---------------------------------------------------------------------------

describe("AC-STE-485.2 — the verdict clause names GATE PASSED WITH NOTES and passes a real firing", () => {
  test("the clause carries the phrase the AC names", () => {
    const shell = verdictShell();
    expect(shell).toContain("GATE PASSED WITH NOTES");
    expect(shell).toContain("CAP_ASSERT");
    expect(SKILL_BODY).toContain(shell);
    // A distinct span from the identifier clause — two clauses, not one.
    expect(shell).not.toBe(tokenShell());
  });

  test("a genuine probe firing satisfies the verdict clause on EVERY leg", () => {
    const shell = verdictShell();
    for (const leg of LEGS) {
      expect(runAssertion(bindCapture(shell, probeCapturePathFor(leg))).exitCode).toBe(0);
    }
  });

  test("neither `GATE PASSED WITH NOTES` nor `ADVISORY` is universal — measured", () => {
    for (const leg of LEGS) {
      expect(assistantHits(leg, "GATE PASSED WITH NOTES")).toBe(
        ASSISTANT_HITS["GATE PASSED WITH NOTES"]![leg],
      );
      expect(assistantHits(leg, "ADVISORY")).toBe(ASSISTANT_HITS.ADVISORY![leg]);
      expect(assistantHits(leg, "NOTES")).toBe(ASSISTANT_HITS.NOTES![leg]);
    }
    // AC.2 says the runtime does not render ADVISORY. It rendered it on linear.
    expect(assistantHits("linear", "ADVISORY")).toBeGreaterThan(0);
    // And it did NOT render GATE PASSED WITH NOTES on linear or none.
    expect(assistantHits("linear", "GATE PASSED WITH NOTES")).toBe(0);
    expect(assistantHits("none", "GATE PASSED WITH NOTES")).toBe(0);
  });

  test("a GATE-PASSED-WITH-NOTES-only `present` clause is red on two legs in three", () => {
    const naive =
      'bun "${CAP_ASSERT}" present /tmp/dpt-smoke-<tracker>-ste222-probe.log "GATE PASSED WITH NOTES"';
    expect(runAssertion(bindCapture(naive, probeCapturePathFor("jira"))).exitCode).toBe(0);
    expect(runAssertion(bindCapture(naive, probeCapturePathFor("linear"))).exitCode).not.toBe(0);
    expect(runAssertion(bindCapture(naive, probeCapturePathFor("none"))).exitCode).not.toBe(0);
  });

  test("the bullet no longer claims the run ends anything but GATE FAILED", () => {
    const section = section3c();
    // As STAGED, the uncommitted stale leaf also trips probe #22 (error), so
    // every genuine capture ends GATE FAILED. The old parenthetical asserted
    // the opposite; the section must record the measurement instead.
    for (const leg of LEGS) {
      expect(assistantHits(leg, "GATE FAILED")).toBe(ASSISTANT_HITS["GATE FAILED"]![leg]);
    }
    expect(section).toContain("GATE FAILED");
    expect(section).toMatch(/#22|toolkit[-_]bootstrap[-_]committed/);
    expect(section).not.toContain("NOT `GATE FAILED`");
  });

  test("the retired ADVISORY-only instruction is gone from the live clause", () => {
    expect(verdictShell()).not.toMatch(/\bpresent\b[^|]*\bADVISORY\b/);
    // But the history stays written down — a silently deleted sentence leaves
    // the next reader free to re-derive it.
    expect(section3c()).toContain("ADVISORY");
  });
});

// ---------------------------------------------------------------------------
// AC-STE-485.3 — the Notes record how the correction went wrong.
//
// THE AC's OWN ACCOUNT IS THE THING BEING CORRECTED. It says the underscored
// occurrences are "a filename, not an emission". Measured: the probe module
// EMITS that spelling twice per violation, and the `none` leg's capture carries
// it assistant-scoped. Writing the AC's sentence down would be drift #3 on this
// fixture, so these tests pin the accurate account and pin the refuted sentence
// ABSENT. The conflict is recorded in the plan rather than resolved silently.
// ---------------------------------------------------------------------------

describe("AC-STE-485.3 — the notes record the accurate account, not the refuted one", () => {
  test("the underscored form is a REAL module emission, measured at the source", () => {
    const module = readFileSync(join(PLUGIN_ROOT, PROBE_MODULE_RELATIVE), "utf8");
    const source: TokenSource = { path: PROBE_MODULE_RELATIVE, text: module, layer: "module" };
    // Two emissions inside buildMessage's returned message lines.
    expect(countTokenEmissions(source, UNDERSCORED)).toBeGreaterThanOrEqual(2);
    expect(module).toContain(`\`${UNDERSCORED}: \${reason}\``.slice(1, -1));
    expect(module).toContain(`probe=${UNDERSCORED}, severity=warning`);
  });

  test("the underscored form also REACHES a capture — it is not filename-only", () => {
    const assistant = extractAssistantText(probeCapture("none"));
    expect(assistant).toContain(UNDERSCORED);
    expect(assistantHits("none", UNDERSCORED)).toBe(2);
  });

  test("the notes name the module path and its buildMessage emission", () => {
    const section = section3c();
    expect(section).toContain(PROBE_MODULE_RELATIVE);
    expect(section).toMatch(/buildMessage/);
    expect(section).toMatch(/emit/i);
  });

  test("the notes do NOT carry the refuted 'filename, not an emission' claim", () => {
    const section = section3c();
    expect(section).not.toMatch(/filename,\s*not an emission/i);
    expect(section).not.toMatch(/never appear in a capture/i);
    expect(section).not.toMatch(/can never be emitted/i);
  });

  test("the notes name the reasoning error and count the drifts", () => {
    const section = section3c();
    // The real error: taking one leg's rendering of an LLM-rendered surface as
    // the runtime's contract, twice in the same place.
    expect(section).toMatch(/single literal|one leg|LLM-rendered|leg-dependent/i);
    expect(section).toContain("STE-421");
    expect(section).toContain("STE-485");
    expect(section).toMatch(/third|3rd/i);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-485.4 — STE-483's harness proves BOTH clauses fail when probe #37
// does not fire, running the SKILL's own bytes with no paraphrase anywhere.
// ---------------------------------------------------------------------------

describe("AC-STE-485.4 — falsifiability through the harness, both clauses", () => {
  test("STE-485 is registered, names SITES, and carries no shell", () => {
    expect(uncoveredRepairs(M127_REPAIRS, M127_REPAIR_ROSTER)).not.toContain("STE-485");
    const entry = repairEntry();
    expect(Object.keys(entry)).not.toContain("shell");
    expect(Object.keys(entry)).not.toContain("command");
    expect(entry.site.section).toContain("Sub-fixture 3c");
    expect(verdictClause().site.section).toContain("Sub-fixture 3c");
    // A CAP_ASSERT clause signals through its exit code, never a bare count.
    expect(entry.scoreBy).toBe("exit-code");
    expect(verdictClause().scoreBy).toBe("exit-code");
  });

  test("the row resolves to a probe-firing capture, not an /implement one", () => {
    const entry = repairEntry();
    const path = resolveCapturePath(entry);
    expect(path).toBe(probeCapturePathFor(entry.leg));
    expect(path).toContain("gate-check-probe37");
    expect(existsSync(path)).toBe(true);
  });

  test("checkRepairEntry scores the identifier clause FALSIFIABLE", () => {
    const result = checkRepairEntry(repairEntry(), SKILL_BODY);
    expect(result.id).toBe("STE-485");
    expect(result.presentCount).toBeGreaterThanOrEqual(repairEntry().threshold);
    expect(result.absentCount).toBeLessThan(repairEntry().threshold);
    expect(result.removed).toBeGreaterThan(0);
    expect(result.verdict).toBe("falsifiable");
  });

  test("checkRepairClauses scores BOTH clauses FALSIFIABLE", () => {
    const results = checkRepairClauses(repairEntry(), SKILL_BODY);
    expect(results.length).toBeGreaterThanOrEqual(2);
    for (const result of results) {
      expect(result.id.startsWith("STE-485")).toBe(true);
      expect(result.verdict).toBe("falsifiable");
    }
    // The primary row first, then the labelled extra clause.
    expect(results[0]!.id).toBe("STE-485");
    expect(results[1]!.id).toContain("/");
  });

  test("both clauses go RED on a capture where probe #37 did not fire", () => {
    const token = tokenShell();
    const verdict = verdictShell();
    for (const leg of LEGS) {
      const path = tempCapture(`no-probe37-${leg}.ndjson`, probeDidNotFire(leg));
      expect(runAssertion(bindCapture(token, path)).exitCode).not.toBe(0);
      expect(runAssertion(bindCapture(verdict, path)).exitCode).not.toBe(0);
      // …while both are green on the untouched capture, same bytes, same moment.
      expect(runAssertion(bindCapture(token, probeCapturePathFor(leg))).exitCode).toBe(0);
      expect(runAssertion(bindCapture(verdict, probeCapturePathFor(leg))).exitCode).toBe(0);
    }
  });

  test("exit-code scoring is what makes a CAP_ASSERT clause scorable at all", () => {
    const shell = tokenShell();
    const green = runAssertion(bindCapture(shell, probeCapturePathFor("linear")));
    const red = runAssertion(
      bindCapture(shell, tempCapture("score-red.ndjson", probeDidNotFire("linear"))),
    );

    // The trap: CAP_ASSERT prints a verdict LINE, so the count parser reads 1
    // in BOTH directions and count-scoring is vacuous.
    expect(green.stdout.trim()).not.toMatch(/^\d+$/);
    expect(scoreRun(green, "stdout-count")).toBe(scoreRun(red, "stdout-count"));

    // Exit-code scoring separates them.
    expect(scoreRun(green, "exit-code")).toBe(1);
    expect(scoreRun(red, "exit-code")).toBe(0);

    // And STE-484's row keeps the default, unchanged.
    const ste484 = M127_REPAIRS.find((row) => row.id === "STE-484") as RepairEntry;
    expect(ste484.scoreBy ?? "stdout-count").toBe("stdout-count");
  });

  test("a drifted SKILL throws rather than falling back to a remembered form", () => {
    const entry = repairEntry();
    const drifted = SKILL_BODY.split(entry.site.select).join("no-such-token");
    expect(() => checkRepairEntry(entry, drifted)).toThrow();
    const driftedVerdict = SKILL_BODY.split(verdictClause().site.select).join("no-such-token");
    expect(() => checkRepairClauses(entry, driftedVerdict)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// AC-STE-485.5 — a token-versus-source check, so a fixture cannot assert a
// token no shipped code emits AT THE LAYER IT IS ASSERTING.
//
// The layer split is the whole point. "Emitted" is not "grep-able somewhere in
// the repo": a capture-layer assertion is satisfied by what the RUNTIME renders
// into a capture, a module-layer assertion by what a MODULE builds. A check
// that only greps the repo would bless a filename.
// ---------------------------------------------------------------------------

describe("AC-STE-485.5 — asserted tokens are checked against their emitting source", () => {
  const FILENAME_ONLY = "dpt-fixture-only-token";
  const filenameSource: TokenSource = {
    path: `adapters/_shared/src/${FILENAME_ONLY}.ts`,
    text: [
      "// a module whose NAME carries the token and whose body never emits it",
      `import { thing } from "./${FILENAME_ONLY}";`,
      "export const message = 'nothing to see here';",
    ].join("\n"),
    layer: "module",
  };

  test("the two layers are the only two, and they are named", () => {
    expect([...ASSERTION_LAYERS].sort()).toEqual(["capture", "module"]);
  });

  test("a filename-only token is NOT emitted, at either layer", () => {
    expect(countTokenEmissions(filenameSource, FILENAME_ONLY)).toBe(0);
    expect(countTokenFilenameMentions(filenameSource, FILENAME_ONLY)).toBeGreaterThan(0);

    for (const layer of ASSERTION_LAYERS) {
      const evidence = checkAssertedToken(
        { token: FILENAME_ONLY, layer: layer as AssertionLayer },
        [filenameSource, { ...filenameSource, layer: "capture" }],
      );
      expect(evidence.emitted).toBe(false);
      expect(evidence.emissions).toBe(0);
      expect(evidence.emittingSources).toEqual([]);
      expect(evidence.filenameOnlySources).toContain(filenameSource.path);
    }
  });

  test("a module emission does not license a CAPTURE-layer claim", () => {
    // The layer rule, on a token that is genuinely built by a module and
    // genuinely never reaches a capture.
    const token = "dpt-module-only-token";
    const sources: readonly TokenSource[] = [
      {
        path: "adapters/_shared/src/thing.ts",
        text: `return \`${token}: \${reason}\`;`,
        layer: "module",
      },
      { path: "tests/fixtures/x.ndjson", text: "no such token here", layer: "capture" },
    ];
    expect(checkAssertedToken({ token, layer: "module" }, sources).emitted).toBe(true);
    expect(checkAssertedToken({ token, layer: "capture" }, sources).emitted).toBe(false);
  });

  test("a token that only ever appears in a capture's injected body is not emitted", () => {
    const token = "dpt-synthetic-only-token";
    const ndjson = [
      JSON.stringify({ type: "system", subtype: "init" }),
      JSON.stringify({
        type: "user",
        isSynthetic: true,
        message: { content: [{ type: "text", text: `docs mention ${token} here` }] },
      }),
      JSON.stringify({ type: "result", subtype: "success" }),
    ].join("\n");
    const path = tempCapture("synthetic-only.ndjson", ndjson);
    const sources = defaultTokenSources(REPO_ROOT).concat([
      { path, text: extractAssistantText(ndjson), layer: "capture" },
    ]);
    expect(ndjson).toContain(token);
    expect(checkAssertedToken({ token, layer: "capture" }, sources).emitted).toBe(false);
  });

  test("both spellings are real emissions — the underscored one at BOTH layers", () => {
    const sources = defaultTokenSources(REPO_ROOT);
    // Hyphenated: rendered into captures, never built by the probe module.
    expect(checkAssertedToken({ token: HYPHENATED, layer: "capture" }, sources).emitted).toBe(true);
    expect(checkAssertedToken({ token: HYPHENATED, layer: "module" }, sources).emitted).toBe(false);
    // Underscored: built by the module AND rendered into the `none` capture.
    const moduleEvidence = checkAssertedToken({ token: UNDERSCORED, layer: "module" }, sources);
    expect(moduleEvidence.emitted).toBe(true);
    expect(moduleEvidence.emittingSources.some((p) => p.includes(PROBE_MODULE_RELATIVE))).toBe(true);
    expect(checkAssertedToken({ token: UNDERSCORED, layer: "capture" }, sources).emitted).toBe(true);
  });

  test("assertedTokensIn lifts the key arguments out of a CAP_ASSERT invocation", () => {
    const tokens = assertedTokensIn(tokenShell());
    expect(tokens).toContain(HYPHENATED);
    expect(tokens).not.toContain("any-of");
    expect(tokens.some((t) => t.includes("/tmp/dpt-smoke"))).toBe(false);
    expect(assertedTokensIn(verdictShell())).toContain("GATE PASSED WITH NOTES");
  });

  test("every token fixture 3c asserts is emitted at the capture layer", () => {
    // The recurrence guard, closed end to end: extract the live clauses → lift
    // their asserted tokens → resolve each against the shipped emitting sources.
    const sources = defaultTokenSources(REPO_ROOT);
    const tokens = [...assertedTokensIn(tokenShell()), ...assertedTokensIn(verdictShell())];
    expect(tokens.length).toBeGreaterThanOrEqual(3);
    for (const token of tokens) {
      const evidence = checkAssertedToken({ token, layer: "capture" }, sources);
      expect(evidence.emitted).toBe(true);
      expect(evidence.emittingSources.length).toBeGreaterThan(0);
    }
  });

  test("the guard rejects a clause that asserts a filename-only token", () => {
    const bogus = `bun "\${CAP_ASSERT}" present /tmp/dpt-smoke-x-ste222-probe.log ${FILENAME_ONLY}`;
    const sources = defaultTokenSources(REPO_ROOT).concat([filenameSource]);
    for (const token of assertedTokensIn(bogus)) {
      expect(checkAssertedToken({ token, layer: "capture" }, sources).emitted).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// AC-STE-485.5, second half — `defaultTokenSources`' OWN capture projection.
//
// WHY THIS EXISTS AS A SEPARATE DESCRIBE. Mutation testing found the module's
// STE-421 defence unpinned: swapping `extractAssistantText(readFileSync(...))`
// for the raw bytes inside `defaultTokenSources` left every test above green.
// The describe above covers the PRINCIPLE, but it builds its own `TokenSource`
// with `extractAssistantText` already applied and concatenates it, so
// `defaultTokenSources`' internal projection never decides anything. And the
// three shipped probe captures cannot decide it either: on all three legs the
// raw and assistant-scoped counts of both spellings are identical, so raw bytes
// and the assistant projection agree and the two implementations are
// indistinguishable. That equality is asserted below rather than assumed.
//
// Distinguishing them needs a capture where they DISAGREE — one whose probe
// token reaches only the synthetic `user` event `claude -p` injects for the
// invoked SKILL.md body, with no assistant event emitting it. No preserved
// capture in this directory has that shape, so the fixture is CONSTRUCTED and
// says so in its own first line. It is a test instrument, never evidence of a
// run, and must never be cited as one — a fixture that poses as a real capture
// is the exact defect class this milestone exists to remove.
// ---------------------------------------------------------------------------

/** SYNTHETIC — hand-built, not an archived run. See the file's own note line. */
const SYNTHETIC_CAPTURE_RELATIVE =
  "tests/fixtures/m127-falsifiability/synthetic-injected-body-only.ndjson";

/** Named ONLY by the injected synthetic skill body. No assistant event emits it. */
const INJECTED_ONLY_TOKEN = "dpt-synthetic-injected-only-probe-token";

/** Emitted by an assistant event, exactly as a real probe row would be. */
const ASSISTANT_EMITTED_TOKEN = "dpt-synthetic-assistant-emitted-token";

function syntheticCaptureBytes(): string {
  return readFileSync(join(PLUGIN_ROOT, SYNTHETIC_CAPTURE_RELATIVE), "utf8");
}

/**
 * A throwaway repo root carrying ONLY the synthetic capture, written under the
 * leg filename `defaultTokenSources` looks for. The projection under test is
 * the one the SHIPPED function performs on bytes it reads itself — nothing here
 * pre-projects anything.
 */
function syntheticRepoRoot(): string {
  const root = join(TMP, "synthetic-root");
  const fixtures = join(root, "tests", "fixtures", "m127-falsifiability");
  mkdirSync(fixtures, { recursive: true });
  writeFileSync(join(fixtures, "gate-check-probe37-linear.ndjson"), syntheticCaptureBytes(), "utf8");
  return root;
}

describe("AC-STE-485.5 — defaultTokenSources scopes captures to assistant text, not raw bytes", () => {
  test("the fixture declares itself SYNTHETIC in its own bytes", () => {
    const raw = syntheticCaptureBytes();
    const note = JSON.parse(raw.split("\n")[0] as string) as Record<string, unknown>;
    expect(note.synthetic).toBe(true);
    expect(String(note.note)).toMatch(/NOT an archived run capture/i);
    expect(String(note.ac)).toBe("AC-STE-485.5");
  });

  test("no REAL capture can tell the two implementations apart — measured", () => {
    // The reason a constructed fixture is necessary at all. If any shipped
    // capture disagreed raw-vs-assistant on either spelling, it would be the
    // honest subject and this whole describe would be unnecessary.
    for (const leg of LEGS) {
      const raw = probeCapture(leg);
      const assistant = extractAssistantText(raw);
      for (const token of [HYPHENATED, UNDERSCORED]) {
        expect(raw.split(token).length - 1).toBe(assistant.split(token).length - 1);
      }
    }
  });

  test("the synthetic capture DOES disagree — raw carries the token, assistant does not", () => {
    const raw = syntheticCaptureBytes();
    expect(raw).toContain(INJECTED_ONLY_TOKEN);
    const assistant = extractAssistantText(raw);
    expect(assistant).not.toContain(INJECTED_ONLY_TOKEN);
    // …and the projection is not merely empty: a real emission survives it.
    expect(assistant).toContain(ASSISTANT_EMITTED_TOKEN);
  });

  test("the capture source defaultTokenSources builds IS the assistant projection", () => {
    const captures = defaultTokenSources(syntheticRepoRoot()).filter((s) => s.layer === "capture");
    expect(captures.length).toBe(1);
    const capture = captures[0] as TokenSource;
    // The tightest form of the pin: byte equality with the projection, which a
    // raw-bytes read fails and an empty/broken projection fails too.
    expect(capture.text).toBe(extractAssistantText(syntheticCaptureBytes()));
    expect(capture.text).toContain(ASSISTANT_EMITTED_TOKEN);
    expect(capture.text).not.toContain(INJECTED_ONLY_TOKEN);
  });

  test("an injected-body-only token is NOT emitted at the capture layer", () => {
    const sources = defaultTokenSources(syntheticRepoRoot());
    expect(checkAssertedToken({ token: INJECTED_ONLY_TOKEN, layer: "capture" }, sources).emitted).toBe(
      false,
    );
    // The control: the token the runtime really rendered resolves as emitted,
    // so "not emitted" above is the projection deciding, not the plumbing.
    const emitted = checkAssertedToken({ token: ASSISTANT_EMITTED_TOKEN, layer: "capture" }, sources);
    expect(emitted.emitted).toBe(true);
    expect(emitted.emittingSources.length).toBe(1);
  });

  test("a raw-bytes projection would call the injected-only token emitted", () => {
    // The counterfactual, executed rather than argued: this is precisely what
    // `defaultTokenSources` would report if its `extractAssistantText` call
    // were replaced by the file's bytes.
    const rawSource: TokenSource = {
      path: SYNTHETIC_CAPTURE_RELATIVE,
      text: syntheticCaptureBytes(),
      layer: "capture",
    };
    expect(checkAssertedToken({ token: INJECTED_ONLY_TOKEN, layer: "capture" }, [rawSource]).emitted).toBe(
      true,
    );
  });
});
