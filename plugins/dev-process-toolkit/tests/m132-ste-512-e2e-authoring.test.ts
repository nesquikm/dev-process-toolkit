// M132 / STE-512 — "/implement adds or edits the e2e tests its change needs".
//
// THE DEFECT THIS SUITE EXISTS TO KILL, stated first because every shaping
// decision below follows from it.
//
// The prior FRs of this milestone made the evidence rows machine-read: the
// counts a stage reports now come from bytes a runner really emitted. But
// nothing in the loop ever ADDS an end-to-end test. `/tdd` writes tests per AC
// through a test-writer that is deliberately blind to the running system —
// correct for unit tests, exactly wrong for end-to-end ones — so the end-to-end
// suite drifts away from the product one change at a time, and the evidence
// rows end up faithfully reporting green counts for a suite that stopped
// covering anything. The numbers get more trustworthy while what they measure
// gets less relevant.
//
// THE ONE WAY THIS FR GETS QUIETLY UNDER-DELIVERED — the FR names it itself.
//
// AC.3 is the quiet half. Most changes to a config parser or a token map
// genuinely HAVE no end-to-end observable surface, so "none needed" is the
// answer that is right often enough to become reflexive. And a silent skip and
// a considered decision PRODUCE IDENTICAL TREES: no new test file either way,
// no diff either way, nothing to grep for either way. Only one of them is a
// decision. "No e2e test was needed" is always available and never obviously
// wrong, which is precisely why a test that merely ALLOWS the none-needed path
// to exist satisfies the letter of AC.3 and defeats its entire point.
//
// So the AC.3 legs below never ask "can a none-needed run pass?". They put the
// considered decision and the silent skip SIDE BY SIDE from the same declared
// config and demand the two produce DIFFERENT outcomes — different `ok`,
// different authoring decision, different capability token — and they demand
// the recorded reason be READ BACK OUT, because a decision you cannot retrieve
// is not recorded. A blank reason is asserted to be a silent skip wearing a
// hat, and a none-needed record that contradicts an actually-authored test is
// asserted to refuse. If any one of those legs can pass while the
// implementation merely tolerates silence, AC.3 has been under-delivered in the
// exact shape the FR predicted.
//
// THE OTHER THREE RISKS, AND HOW EACH IS ANSWERED
//
//   AC.2 — A SECOND RENDERER. The counts must reach the evidence rows through
//   the SHIPPED renderer, not through a lookalike that agrees today. So the
//   rows are compared BYTE-FOR-BYTE against `renderStageEvidence`'s output from
//   the same capture, the numbers are compared against counts derived
//   INDEPENDENTLY by the shipped parser (never against a fixture restating
//   them), a SENSITIVITY leg makes changed bytes move every number, and a live
//   MUTATION of the shared renderer in a throwaway copy of the source tree must
//   surface in this module's rows — which is the only leg that can tell real
//   runtime routing from a copy-paste that happens to match.
//
//   AC.4 — ABSENT COLLAPSING INTO `none`. `e2e_cmd` has THREE states and only
//   two of them are commonly implemented: an absent key (null — answers
//   nothing), the literal `none` (an ANSWER: there is no e2e suite), and a real
//   command. A hand-inlined `=== "none"` or a bare truthiness check folds two of
//   those together, which is the exact defect the shipped `isRunCmdNone` /
//   `isRunCmdAnswered` predicates were extracted to make impossible. "Vacuous"
//   is asserted as BYTE-IDENTICAL behaviour — the absent-key outcome is proven
//   invariant under a matrix of wildly perturbed sibling inputs, so nothing
//   else can perturb it — and never as "does not crash".
//
//   AC.5 — ONE TOKEN COVERING TWO PATHS. Four tokens that are merely REGISTERED
//   prove nothing. Each is asserted to fire on its OWN path, the four are
//   asserted pairwise distinct, every scenario is asserted to emit EXACTLY ONE
//   of them, and the precedence between suite-red and the authoring tokens is
//   pinned explicitly rather than left to whichever branch happens to run
//   first.
//
// The surface legs (SKILL.md's Phase 4 hook, its sibling reference doc,
// /spec-write § 7's static map) are DRIFT GUARDS ONLY — M131 recorded
// surface-parity drift three times in a single milestone — and are not allowed
// to substitute for the legs whose subject is a real capture artifact. The
// milestone that introduced the fence shipped eighteen ACs that were all
// prose-greps of a skill's own SKILL.md, "which is precisely why a fence with
// no producer passed every one of them".
//
// MODULE LOADING is dynamic and per-test on purpose: a static `import` of a
// not-yet-written module fails the WHOLE file at resolution time, collapsing
// five ACs into one opaque red. Every test touches the new module, so every one
// of them is RED before the implementation exists — including the structural
// sweeps, which would otherwise pass vacuously today.

import { afterAll, describe, expect, test } from "bun:test";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import {
  CANONICAL_CAPABILITY_KEYS,
  runClosingSummaryCapabilityKeysProbe,
} from "../adapters/_shared/src/closing_summary_capability_keys";
import { parseTestOutput } from "../adapters/_shared/src/test_count_parser";
import { readVerificationConfig } from "../adapters/_shared/src/verification_config";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");
const SHARED_SRC = join(PLUGIN_ROOT, "adapters", "_shared", "src");

/** The module this FR adds — the e2e-authoring decision's ONE entry point. */
const E2E_MODULE = join(SHARED_SRC, "e2e_authoring.ts");
/** The ONE evidence renderer. AC.2's counts must reach the rows through it. */
const EVIDENCE_MODULE = join(SHARED_SRC, "deliver_stage_evidence.ts");

const IMPLEMENT_SKILL = join(PLUGIN_ROOT, "skills", "implement", "SKILL.md");
const IMPLEMENT_REFERENCE = join(PLUGIN_ROOT, "docs", "implement-reference.md");
const SPEC_WRITE_SKILL = join(PLUGIN_ROOT, "skills", "spec-write", "SKILL.md");

/**
 * The four capability tokens, RESTATED here rather than imported — a suite that
 * imports its own subject cannot notice a rename, and these literals are the
 * contract `/gate-check`'s registry probe greps for byte-for-byte.
 *
 * NO DIGITS, deliberately. The registry probe's reverse orphan-scan leg matches
 * `MUST emit \`([a-z_]+)\``; a key spelled `e2e_…` would slip straight past it
 * and the bidirectional const↔directive invariant would go one-way for exactly
 * these four keys. Asserted below rather than merely intended.
 */
const TOKEN_AUTHORED = "end_to_end_tests_authored";
const TOKEN_EDITED = "end_to_end_tests_edited";
const TOKEN_NONE_NEEDED = "end_to_end_none_needed";
const TOKEN_SUITE_RED = "end_to_end_suite_red";
const ALL_TOKENS = [
  TOKEN_AUTHORED,
  TOKEN_EDITED,
  TOKEN_NONE_NEEDED,
  TOKEN_SUITE_RED,
] as const;

/**
 * The registry length after this FR registers its four keys. The number lives
 * in THREE places that must move together — the title and the assertion in
 * `tests/m84-ste-320-code-reviewer-scope-registry.test.ts`, plus that file's
 * discovered-count pin — and a cross-pin in the M126 allow-list suite already
 * holds those three to the live length. This leg holds the LIVE LENGTH to the
 * number this FR owes, which is the half no existing pin can supply.
 *
 * Conscious bump 42 → 43 (M139/STE-541 `linear_milestone_scheme_adopted`, the
 * once-per-project Linear scheme-changeover notice). The pin is absolute by
 * design, so every later registration moves it here as well; what it forbids
 * is a SILENT move, not a declared one.
 */
const REGISTRY_LENGTH_AFTER_THIS_FR = 43;

/** The NFR line cap on `/implement`'s SKILL.md. Zero-ish headroom by design. */
const IMPLEMENT_SKILL_LINE_CAP = 358;

// ---------------------------------------------------------------------------
// Shapes. Declared locally so this file compiles before the module exists.
// ---------------------------------------------------------------------------

type Stack = "bun" | "pytest" | "flutter" | "unknown";
type EvidenceSection = "gate" | "drive" | "e2e";

interface EvidenceCounts {
  pass: number;
  fail: number;
  skip: number;
  baseline: number | null;
  delta: number | null;
}

interface CapturedRun {
  command: string;
  output: string;
  stack: Stack;
}

interface StageEvidenceInput {
  gate?: CapturedRun | null;
  drive?: CapturedRun | null;
  e2e?: CapturedRun | null;
  required?: readonly EvidenceSection[];
  projectRoot?: string;
  branch?: string;
}

/**
 * The authoring DECISION, recorded independently of which token gets emitted.
 *
 * Kept separate from `capabilityToken` on purpose: when the suite is red the
 * emitted token is the suite-red one, and if the decision lived only in the
 * token then a red run would ERASE the record that a none-needed call was
 * consciously made. AC.3 says the decision is recorded; it does not say the
 * record may be overwritten by an unrelated outcome.
 */
type AuthoringDecision =
  | "authored"
  | "edited"
  | "none_needed"
  | "unrecorded"
  | "contradictory"
  | "not_applicable";

interface E2eAuthoringInput {
  /** Straight off `readVerificationConfig`. Three states, never two. */
  e2eCmd: string | null;
  /** End-to-end test files this change ADDED. */
  addedTests?: readonly string[];
  /** End-to-end test files this change EDITED. */
  editedTests?: readonly string[];
  /** The EXPLICIT none-needed record. Absent ⇒ silence, which is not a record. */
  noneNeeded?: { reason: string } | null;
  /** The captured end-to-end suite run — the bytes every count traces back to. */
  run?: CapturedRun | null;
}

interface E2eAuthoringOutcome {
  /** DERIVED from `reasons`, never asserted by a caller. */
  ok: boolean;
  /** Did the project ANSWER "how is the e2e suite invoked?" */
  declared: boolean;
  authoring: AuthoringDecision;
  suiteRed: boolean;
  /** Exactly one of the four tokens, or null when no token is owed. */
  capabilityToken: string | null;
  /** The recorded none-needed rationale, READ BACK OUT. Null when not recorded. */
  noneNeededReason: string | null;
  /** The evidence rows, from the shared renderer. Empty when no suite exists. */
  evidenceRows: readonly string[];
  counts: EvidenceCounts | null;
  /** One line per refusal ground; empty iff `ok`. */
  reasons: readonly string[];
}

interface E2eModule {
  E2E_CAPABILITY_TOKENS: Record<
    "authored" | "edited" | "none_needed" | "suite_red",
    string
  >;
  resolveE2eAuthoring(input: E2eAuthoringInput): E2eAuthoringOutcome;
}

interface EvidenceModule {
  renderStageEvidence(input: StageEvidenceInput): {
    ok: boolean;
    lines: readonly string[];
    counts: Record<EvidenceSection, EvidenceCounts | null>;
    reasons: readonly string[];
  };
  parseEvidenceLines(
    lines: readonly string[],
  ): Record<EvidenceSection, EvidenceCounts | null>;
}

async function loadE2e(path: string = E2E_MODULE): Promise<E2eModule> {
  return (await import(path)) as unknown as E2eModule;
}

async function loadEvidence(path: string = EVIDENCE_MODULE): Promise<EvidenceModule> {
  return (await import(path)) as unknown as EvidenceModule;
}

function read(path: string): string {
  return readFileSync(path, "utf-8");
}

// ---------------------------------------------------------------------------
// CAPTURES — bytes a runner really emitted. Every count asserted anywhere below
// traces back to one of these, and each is written to a real file and read back
// before it reaches the module, so the subject is an ARTIFACT rather than a
// string literal the test smuggled in through an argument.
// ---------------------------------------------------------------------------

/** A clean end-to-end run: 14 pass, 2 skip, 0 fail, 16 total. */
const E2E_GREEN = [
  "bun test v1.1.29",
  "",
  " 14 pass",
  " 2 skip",
  " 0 fail",
  "Ran 16 tests across 4 files. [12.40s]",
].join("\n");

/** A DIFFERENT clean run — the sensitivity leg needs every number to move. */
const E2E_GREEN_SHIFTED = [
  "bun test v1.1.29",
  "",
  " 31 pass",
  " 5 skip",
  " 0 fail",
  "Ran 36 tests across 9 files. [27.10s]",
].join("\n");

/** A red end-to-end run: three real failures. */
const E2E_RED = [
  "bun test v1.1.29",
  "",
  " 11 pass",
  " 2 skip",
  " 3 fail",
  "Ran 16 tests across 4 files. [12.90s]",
].join("\n");

/** pytest: `N passed` EXCLUDES skips, unlike bun's `Ran N tests`. */
const E2E_PYTEST = [
  "============================= test session starts =============================",
  "collected 20 items",
  "",
  "======================== 17 passed, 3 skipped in 2.41s ========================",
].join("\n");

/** Bytes no runner emitted — unparseable, so no count can be derived. */
const E2E_GARBAGE = "the runner printed a stack trace and nothing resembling a summary";

/** A real command, as a project would declare it. */
const REAL_CMD = "bun test tests/e2e";

const TEMP_ROOTS: string[] = [];

afterAll(() => {
  for (const dir of TEMP_ROOTS) rmSync(dir, { recursive: true, force: true });
});

function tempDir(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `ste512-${label}-`));
  TEMP_ROOTS.push(dir);
  return dir;
}

/** Write captured output to a real file and read it BACK before using it. */
function capturedRun(
  label: string,
  output: string,
  stack: Stack = "bun",
  command: string = REAL_CMD,
): CapturedRun {
  const file = join(tempDir(`capture-${label}`), `${label}.txt`);
  writeFileSync(file, output, "utf-8");
  return { command, output: read(file), stack };
}

/**
 * Counts derived INDEPENDENTLY of anything under test, through the shipped
 * parser. The round-trip legs compare the module's numbers against these — not
 * against a fixture that merely restates them.
 */
function independentCounts(
  output: string,
  stack: Stack,
): { pass: number; fail: number; skip: number } {
  const parsed = parseTestOutput(output, stack);
  if (!parsed.ok) throw new Error(`fixture capture is unparseable: ${parsed.reason}`);
  const { total, failures, errors, skipped } = parsed.count;
  const fail = failures + errors;
  // bun's `Ran N tests` counts skipped tests; pytest's `N passed` does not.
  const pass = stack === "bun" ? total - fail - skipped : total - fail;
  return { pass, fail, skip: skipped };
}

/**
 * A real CLAUDE.md on disk carrying (or omitting) `e2e_cmd`, parsed by the
 * SHIPPED reader. The three-state legs take their `e2eCmd` from here rather
 * than from a literal, so the states under test are the ones a project's file
 * actually produces.
 */
function declaredE2eCmd(label: string, line: string | null): string | null {
  const root = tempDir(`claudemd-${label}`);
  const body = [
    "# Fixture Project",
    "",
    "## Verification",
    "",
    "verify_skill: smoke-test",
    "verify_mode: manual",
    "run_cmd: none",
    ...(line === null ? [] : [line]),
    "",
    "## Docs",
    "",
    "user_facing_mode: false",
    "",
  ].join("\n");
  const path = join(root, "CLAUDE.md");
  writeFileSync(path, body, "utf-8");
  return readVerificationConfig(path).e2eCmd;
}

/** Every non-test TypeScript source under `adapters/` — the sweep's universe. */
function adapterSources(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === "__tests__") continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.endsWith(".ts") || entry.endsWith(".test.ts")) continue;
      out.push(full);
    }
  };
  walk(join(PLUGIN_ROOT, "adapters"));
  return out;
}

/** Sources containing `needle`, as plugin-root-relative paths, sorted. */
function sourcesContaining(needle: string): string[] {
  return adapterSources()
    .filter((file) => read(file).includes(needle))
    .map((file) => relative(PLUGIN_ROOT, file))
    .sort();
}

/**
 * The `/implement` SKILL.md line that IS the Phase 4 e2e-authoring hook.
 *
 * Found by MECHANISM — the module's filename — never by a ticket id: the
 * `skills/` tree's STE-token ceiling sits at zero headroom, so this FR is
 * forbidden from adding one there, and a pin that grepped for one would demand
 * the very thing the ceiling forbids.
 */
function e2eHookLine(): { line: string; index: number } {
  const lines = read(IMPLEMENT_SKILL).split("\n");
  const index = lines.findIndex((line) => line.includes("e2e_authoring"));
  if (index < 0) {
    throw new Error("skills/implement/SKILL.md carries no e2e_authoring hook line");
  }
  return { line: lines[index]!, index };
}

function lineIndexMatching(path: string, re: RegExp): number {
  const index = read(path)
    .split("\n")
    .findIndex((line) => re.test(line));
  if (index < 0) throw new Error(`${path} has no line matching ${re}`);
  return index;
}

// ===========================================================================
// AC-STE-512.1 — when `e2e_cmd` is declared, `/implement` adds or edits
// end-to-end tests covering the change BEFORE the gate is declared green.
//
// "Before the gate is declared green" is asserted in its behavioural form: a
// declared project whose change authored nothing and recorded nothing REFUSES
// (`ok: false`), so the green declaration is not available to it. The surface
// leg pins the hook's POSITION as the second half of the same claim.
// ===========================================================================

describe("AC-STE-512.1 — a declared e2e_cmd requires tests added or edited", () => {
  test("an ADDED end-to-end test satisfies the requirement", async () => {
    const outcome = (await loadE2e()).resolveE2eAuthoring({
      e2eCmd: REAL_CMD,
      addedTests: ["tests/e2e/checkout_flow.e2e.test.ts"],
      run: capturedRun("ac1-added", E2E_GREEN),
    });

    expect(outcome.declared).toBe(true);
    expect(outcome.authoring).toBe("authored");
    expect(outcome.ok).toBe(true);
    expect(outcome.reasons).toEqual([]);
  });

  test("an EDITED end-to-end test satisfies the requirement", async () => {
    const outcome = (await loadE2e()).resolveE2eAuthoring({
      e2eCmd: REAL_CMD,
      editedTests: ["tests/e2e/checkout_flow.e2e.test.ts"],
      run: capturedRun("ac1-edited", E2E_GREEN),
    });

    expect(outcome.authoring).toBe("edited");
    expect(outcome.ok).toBe(true);
    expect(outcome.reasons).toEqual([]);
  });

  test("adding DOMINATES editing, so exactly one decision is ever reported", async () => {
    // A change that both adds a file and edits another must not report two
    // decisions or oscillate between them: the function is total and the
    // precedence is pinned, not left to whichever branch runs first.
    const outcome = (await loadE2e()).resolveE2eAuthoring({
      e2eCmd: REAL_CMD,
      addedTests: ["tests/e2e/new_flow.e2e.test.ts"],
      editedTests: ["tests/e2e/old_flow.e2e.test.ts"],
      run: capturedRun("ac1-both", E2E_GREEN),
    });

    expect(outcome.authoring).toBe("authored");
    expect(outcome.capabilityToken).toBe(TOKEN_AUTHORED);
  });

  test("THE GATE CANNOT BE DECLARED GREEN when nothing was authored and nothing recorded", async () => {
    // The load-bearing leg of AC.1. A declared project, a perfectly green
    // suite, and a change that touched no end-to-end test and made no
    // none-needed call: this is the drift the FR exists to stop, and it must
    // REFUSE rather than sail through on the strength of a green suite.
    const outcome = (await loadE2e()).resolveE2eAuthoring({
      e2eCmd: REAL_CMD,
      run: capturedRun("ac1-nothing", E2E_GREEN),
    });

    expect(outcome.declared).toBe(true);
    expect(outcome.authoring).toBe("unrecorded");
    expect(outcome.ok).toBe(false);
    expect(outcome.reasons.length).toBeGreaterThan(0);
  });

  test("the refusal NAMES both remedies rather than merely failing", async () => {
    const outcome = (await loadE2e()).resolveE2eAuthoring({
      e2eCmd: REAL_CMD,
      run: capturedRun("ac1-remedy", E2E_GREEN),
    });
    const text = outcome.reasons.join("\n").toLowerCase();

    // An operator reading this must learn BOTH ways out: author/edit a test,
    // or record the none-needed decision. A bare "refused" teaches neither.
    expect(text).toContain("e2e_cmd");
    expect(text).toMatch(/add|author|edit/);
    expect(text).toMatch(/none[ -]needed|no end-to-end/);
  });

  test("empty file LISTS are silence, not authoring", async () => {
    // `addedTests: []` is what a caller passes when the diff touched no e2e
    // test at all. Treating an empty array as "the caller thought about it"
    // would reopen the silent-skip hole through the back door.
    const outcome = (await loadE2e()).resolveE2eAuthoring({
      e2eCmd: REAL_CMD,
      addedTests: [],
      editedTests: [],
      run: capturedRun("ac1-empty-lists", E2E_GREEN),
    });

    expect(outcome.authoring).toBe("unrecorded");
    expect(outcome.ok).toBe(false);
  });

  test("SURFACE: the Phase 4 hook sits after the Phase 4 heading and BEFORE step 14", async () => {
    await loadE2e();
    const { line, index } = e2eHookLine();

    const phase4 = lineIndexMatching(IMPLEMENT_SKILL, /^## Phase 4:/);
    const stepFourteen = lineIndexMatching(IMPLEMENT_SKILL, /^14\.\s+\*\*Report\*\*/);

    // Position IS the claim: the authoring hook runs among the other Phase 4
    // hooks, before the report that declares the work green.
    expect(index).toBeGreaterThan(phase4);
    expect(index).toBeLessThan(stepFourteen);
    expect(line).toContain("e2e_cmd");
  });

  test("SURFACE: the hook cites by MECHANISM and adds no tracker id under skills/", async () => {
    await loadE2e();
    const { line } = e2eHookLine();

    // The `skills/` STE-token ceiling has zero headroom; a hook line carrying a
    // ticket id would breach it. Cite the module, not the ticket.
    expect(line).toContain("e2e_authoring");
    expect(line).not.toMatch(/STE-\d+/);
  });

  test("SURFACE: `/implement` SKILL.md stays within its NFR line cap", async () => {
    await loadE2e();
    const lineCount = read(IMPLEMENT_SKILL).split("\n").length;
    expect(lineCount).toBeLessThanOrEqual(IMPLEMENT_SKILL_LINE_CAP);
  });

  test("SURFACE: the sibling reference doc carries the same hook", async () => {
    await loadE2e();
    const reference = read(IMPLEMENT_REFERENCE);

    // Drift guard only. Surface parity between a SKILL.md and its reference doc
    // broke three times in one milestone with no guard on the class.
    expect(reference).toContain("e2e_authoring");
    expect(reference).toContain("e2e_cmd");
  });
});

// ===========================================================================
// AC-STE-512.2 — the end-to-end suite is RUN and its counts reach the evidence
// rows THROUGH the shipped renderer.
//
// No leg here compares the module's output to its own fixture: a second
// renderer that agrees today passes that test forever and only stops passing
// on the day the two drift, which is the day nobody is looking.
// ===========================================================================

describe("AC-STE-512.2 — the suite is run and its counts reach the evidence rows", () => {
  test("the rows are BYTE-IDENTICAL to the shared renderer's, from the same capture", async () => {
    const run = capturedRun("ac2-identical", E2E_GREEN);
    const outcome = (await loadE2e()).resolveE2eAuthoring({
      e2eCmd: REAL_CMD,
      addedTests: ["tests/e2e/a.e2e.test.ts"],
      run,
    });
    const rendered = (await loadEvidence()).renderStageEvidence({
      e2e: run,
      required: ["e2e"],
    });

    expect([...outcome.evidenceRows]).toEqual([...rendered.lines]);
  });

  test("the reported counts equal counts derived INDEPENDENTLY by the shipped parser", async () => {
    const outcome = (await loadE2e()).resolveE2eAuthoring({
      e2eCmd: REAL_CMD,
      addedTests: ["tests/e2e/a.e2e.test.ts"],
      run: capturedRun("ac2-counts", E2E_GREEN),
    });
    const expected = independentCounts(E2E_GREEN, "bun");

    expect(outcome.counts).not.toBeNull();
    expect(outcome.counts!.pass).toBe(expected.pass);
    expect(outcome.counts!.fail).toBe(expected.fail);
    expect(outcome.counts!.skip).toBe(expected.skip);
  });

  test("the counts READ BACK OUT of the rendered rows through the shipped parser", async () => {
    const outcome = (await loadE2e()).resolveE2eAuthoring({
      e2eCmd: REAL_CMD,
      addedTests: ["tests/e2e/a.e2e.test.ts"],
      run: capturedRun("ac2-readback", E2E_GREEN),
    });
    const readBack = (await loadEvidence()).parseEvidenceLines(outcome.evidenceRows);
    const expected = independentCounts(E2E_GREEN, "bun");

    // The round trip a worker-authored constant cannot survive: the numbers
    // must still be there after being written into a row and parsed back out.
    expect(readBack.e2e).not.toBeNull();
    expect(readBack.e2e!.pass).toBe(expected.pass);
    expect(readBack.e2e!.skip).toBe(expected.skip);
    expect(readBack.e2e!.fail).toBe(expected.fail);
  });

  test("SENSITIVITY: different captured bytes move EVERY reported number", async () => {
    const mod = await loadE2e();
    const first = mod.resolveE2eAuthoring({
      e2eCmd: REAL_CMD,
      addedTests: ["tests/e2e/a.e2e.test.ts"],
      run: capturedRun("ac2-sens-a", E2E_GREEN),
    });
    const second = mod.resolveE2eAuthoring({
      e2eCmd: REAL_CMD,
      addedTests: ["tests/e2e/a.e2e.test.ts"],
      run: capturedRun("ac2-sens-b", E2E_GREEN_SHIFTED),
    });

    // A hard-coded row survives every equality leg above and dies here.
    expect(second.counts!.pass).not.toBe(first.counts!.pass);
    expect(second.counts!.skip).not.toBe(first.counts!.skip);
    expect(second.counts!.pass).toBe(independentCounts(E2E_GREEN_SHIFTED, "bun").pass);
    expect([...second.evidenceRows]).not.toEqual([...first.evidenceRows]);
  });

  test("STACK CORRECTNESS carries through: pytest's `N passed` excludes skips", async () => {
    const outcome = (await loadE2e()).resolveE2eAuthoring({
      e2eCmd: "pytest tests/e2e",
      addedTests: ["tests/e2e/test_checkout.py"],
      run: capturedRun("ac2-pytest", E2E_PYTEST, "pytest", "pytest tests/e2e"),
    });
    const expected = independentCounts(E2E_PYTEST, "pytest");

    expect(outcome.counts!.pass).toBe(expected.pass);
    expect(outcome.counts!.skip).toBe(expected.skip);
    // 17, not 20-3-… — a single-stack formula silently mis-derives this.
    expect(outcome.counts!.pass).toBe(17);
  });

  test("FAIL-CLOSED: a declared suite with NO captured run refuses, and says so", async () => {
    const mod = await loadE2e();
    const outcome = mod.resolveE2eAuthoring({
      e2eCmd: REAL_CMD,
      addedTests: ["tests/e2e/a.e2e.test.ts"],
      run: null,
    });
    const rendered = (await loadEvidence()).renderStageEvidence({
      e2e: null,
      required: ["e2e"],
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.counts).toBeNull();
    // Sections never vanish: the refusal still renders the `e2e:` row, and the
    // refusal ground comes from the SHARED renderer rather than a local string.
    expect([...outcome.evidenceRows]).toEqual([...rendered.lines]);
    expect(outcome.evidenceRows.some((line) => line.includes("(none found)"))).toBe(true);
    expect(outcome.reasons.join("\n")).toContain("e2e");
  });

  test("FAIL-CLOSED: unparseable capture yields NO counts and a named refusal", async () => {
    const outcome = (await loadE2e()).resolveE2eAuthoring({
      e2eCmd: REAL_CMD,
      addedTests: ["tests/e2e/a.e2e.test.ts"],
      run: capturedRun("ac2-garbage", E2E_GARBAGE),
    });

    // A confident zero is the worst possible answer here.
    expect(outcome.ok).toBe(false);
    expect(outcome.counts).toBeNull();
    expect(outcome.reasons.join("\n").toLowerCase()).toContain("pars");
  });

  test("MUTATION: rewriting the SHARED renderer's row literal changes THESE rows", async () => {
    // The only leg that can tell genuine runtime routing from a copy-paste that
    // happens to agree today. The mutation lands in ONE file; the module under
    // test must reproduce it because it really calls that code.
    const copyRoot = tempDir("mutation");
    const copySrc = join(copyRoot, "src");
    cpSync(SHARED_SRC, copySrc, { recursive: true });

    const evidencePath = join(copySrc, "deliver_stage_evidence.ts");
    const original = read(evidencePath);
    const anchor = "  - pass ${counts.pass}";
    const marker = "MUT512";

    // A mutation that never applied reads as a pass. Assert the anchor exists
    // exactly once BEFORE relying on the rewrite.
    expect(original.split(anchor).length - 1).toBe(1);
    writeFileSync(
      evidencePath,
      original.replace(anchor, `  - ${marker} pass \${counts.pass}`),
      "utf-8",
    );

    const run = capturedRun("ac2-mutation", E2E_GREEN);
    const input: E2eAuthoringInput = {
      e2eCmd: REAL_CMD,
      addedTests: ["tests/e2e/a.e2e.test.ts"],
      run,
    };

    // The mutation is LIVE: the renderer out of the copy carries it.
    const mutatedRenderer = await loadEvidence(evidencePath);
    expect(
      mutatedRenderer.renderStageEvidence({ e2e: run, required: ["e2e"] }).lines.join("\n"),
    ).toContain(marker);

    // And so does this module out of the same copy — the claim under test.
    const mutated = await loadE2e(join(copySrc, "e2e_authoring.ts"));
    expect(mutated.resolveE2eAuthoring(input).evidenceRows.join("\n")).toContain(marker);

    // The real tree is untouched — the marker is the copy's alone.
    expect(read(EVIDENCE_MODULE)).not.toContain(marker);
    expect(
      (await loadE2e()).resolveE2eAuthoring(input).evidenceRows.join("\n"),
    ).not.toContain(marker);
  });

  test("STRUCTURAL: still exactly ONE source in the tree builds a counts row", async () => {
    // Loading the new module first is deliberate: without it this sweep would
    // pass vacuously before the FR is implemented at all.
    await loadE2e();

    expect(sourcesContaining("  - pass ${")).toEqual([
      "adapters/_shared/src/deliver_stage_evidence.ts",
    ]);
  });

  test("STRUCTURAL: the module DELEGATES — it re-derives nothing of its own", async () => {
    await loadE2e();
    const source = read(E2E_MODULE);

    expect(source).toContain('from "./deliver_stage_evidence"');
    // Called by BARE NAME, so an override is genuinely wired through — the
    // house idiom the mutation leg above depends on.
    expect(source).toContain("renderStageEvidence(");

    // No second derivation and no second row shape anywhere in this module.
    expect(source).not.toContain("parseTestOutput(");
    expect(source).not.toContain("evaluateSkipDelta(");
    expect(source).not.toContain("  - pass ${");
  });
});

// ===========================================================================
// AC-STE-512.3 — THE QUIET HALF.
//
// A change with no end-to-end observable surface RECORDS that explicitly,
// rather than silently adding nothing. Every leg here is built so that an
// implementation which merely TOLERATES silence fails it.
// ===========================================================================

describe("AC-STE-512.3 — none-needed is a recorded decision, never a silent skip", () => {
  const REASON =
    "the change rewrites a config parser's closed key set; no surface a user or " +
    "a driven browser can observe changes";

  test("SIDE BY SIDE: the considered decision and the silent skip DIFFER", async () => {
    // The whole FR in one leg. Same declared config, same green suite, same
    // absence of an authored test — the ONLY difference is whether a decision
    // was recorded, and the two outcomes must not be interchangeable.
    const mod = await loadE2e();
    const base = { e2eCmd: REAL_CMD } as const;

    const considered = mod.resolveE2eAuthoring({
      ...base,
      noneNeeded: { reason: REASON },
      run: capturedRun("ac3-considered", E2E_GREEN),
    });
    const silent = mod.resolveE2eAuthoring({
      ...base,
      run: capturedRun("ac3-silent", E2E_GREEN),
    });

    expect(considered.ok).toBe(true);
    expect(silent.ok).toBe(false);

    expect(considered.authoring).toBe("none_needed");
    expect(silent.authoring).toBe("unrecorded");

    expect(considered.capabilityToken).toBe(TOKEN_NONE_NEEDED);
    expect(silent.capabilityToken).toBeNull();

    // And nothing about them is accidentally equal.
    expect(considered.authoring).not.toBe(silent.authoring);
    expect(considered.capabilityToken).not.toBe(silent.capabilityToken);
  });

  test("the RECORD IS RETRIEVABLE — the reason reads back out verbatim", async () => {
    // A decision you cannot retrieve is not recorded. `ok: true` alone would be
    // indistinguishable from a rubber stamp.
    const outcome = (await loadE2e()).resolveE2eAuthoring({
      e2eCmd: REAL_CMD,
      noneNeeded: { reason: REASON },
      run: capturedRun("ac3-retrievable", E2E_GREEN),
    });

    expect(outcome.noneNeededReason).toBe(REASON);
  });

  test("a silent skip records NO reason — the field is null, never an empty pass", async () => {
    const outcome = (await loadE2e()).resolveE2eAuthoring({
      e2eCmd: REAL_CMD,
      run: capturedRun("ac3-null-reason", E2E_GREEN),
    });

    expect(outcome.noneNeededReason).toBeNull();
  });

  const BLANK_REASONS: ReadonlyArray<[string, string]> = [
    ["empty string", ""],
    ["spaces", "   "],
    ["tab and newline", "\t\n "],
  ];

  for (const [label, reason] of BLANK_REASONS) {
    test(`a BLANK reason (${label}) is a silent skip wearing a hat, and refuses`, async () => {
      // The cheapest way to defeat AC.3 is `noneNeeded: { reason: "" }` — the
      // shape of a record with none of the substance. It must land on exactly
      // the same refusal as saying nothing at all.
      const mod = await loadE2e();
      const blank = mod.resolveE2eAuthoring({
        e2eCmd: REAL_CMD,
        noneNeeded: { reason },
        run: capturedRun(`ac3-blank-${label.replace(/\W+/g, "")}`, E2E_GREEN),
      });
      const silent = mod.resolveE2eAuthoring({
        e2eCmd: REAL_CMD,
        run: capturedRun(`ac3-blank-ctl-${label.replace(/\W+/g, "")}`, E2E_GREEN),
      });

      expect(blank.ok).toBe(false);
      expect(blank.authoring).toBe("unrecorded");
      expect(blank.capabilityToken).toBeNull();
      expect(blank.noneNeededReason).toBeNull();
      expect(blank.authoring).toBe(silent.authoring);
    });
  }

  test("an explicit `null` record is silence too", async () => {
    const outcome = (await loadE2e()).resolveE2eAuthoring({
      e2eCmd: REAL_CMD,
      noneNeeded: null,
      run: capturedRun("ac3-explicit-null", E2E_GREEN),
    });

    expect(outcome.authoring).toBe("unrecorded");
    expect(outcome.ok).toBe(false);
  });

  test("CONTRADICTION: claiming none-needed while authoring a test REFUSES", async () => {
    // "None needed" and a freshly authored end-to-end test cannot both be true.
    // Silently preferring one would let a reflexive none-needed record ride
    // along on real work and look like a decision.
    const outcome = (await loadE2e()).resolveE2eAuthoring({
      e2eCmd: REAL_CMD,
      addedTests: ["tests/e2e/a.e2e.test.ts"],
      noneNeeded: { reason: REASON },
      run: capturedRun("ac3-contradiction", E2E_GREEN),
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.authoring).toBe("contradictory");
    expect(outcome.capabilityToken).toBeNull();
    expect(outcome.reasons.join("\n").toLowerCase()).toMatch(/contradict|both/);
  });

  test("CONTRADICTION covers the edited half too", async () => {
    const outcome = (await loadE2e()).resolveE2eAuthoring({
      e2eCmd: REAL_CMD,
      editedTests: ["tests/e2e/a.e2e.test.ts"],
      noneNeeded: { reason: REASON },
      run: capturedRun("ac3-contradiction-edit", E2E_GREEN),
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.authoring).toBe("contradictory");
  });

  test("none-needed does NOT excuse running the suite", async () => {
    // "This change needs no new e2e test" is not "the e2e suite need not run".
    // Conflating the two is how a declared suite quietly stops being executed.
    const outcome = (await loadE2e()).resolveE2eAuthoring({
      e2eCmd: REAL_CMD,
      noneNeeded: { reason: REASON },
      run: null,
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.reasons.join("\n")).toContain("e2e");
  });

  test("the RECORD SURVIVES a red suite — an unrelated failure must not erase it", async () => {
    // If the decision lived only in the emitted token, a red suite would
    // overwrite it and the audit trail would vanish exactly when it matters.
    const outcome = (await loadE2e()).resolveE2eAuthoring({
      e2eCmd: REAL_CMD,
      noneNeeded: { reason: REASON },
      run: capturedRun("ac3-survives-red", E2E_RED),
    });

    expect(outcome.suiteRed).toBe(true);
    expect(outcome.capabilityToken).toBe(TOKEN_SUITE_RED);
    expect(outcome.authoring).toBe("none_needed");
    expect(outcome.noneNeededReason).toBe(REASON);
  });

  test("SURFACE: the none-needed obligation is written down, not merely implemented", async () => {
    await loadE2e();
    const { line } = e2eHookLine();
    const reference = read(IMPLEMENT_REFERENCE).toLowerCase();

    // Drift guard for the quiet half specifically: the prose must state that
    // the no-surface case is RECORDED, so a future reader cannot mistake the
    // step for one that may legitimately produce nothing.
    expect(line).toContain(TOKEN_NONE_NEEDED);
    expect(reference).toContain(TOKEN_NONE_NEEDED);
    expect(reference).toMatch(/silent skip|silently/);
  });
});

// ===========================================================================
// AC-STE-512.4 — `e2e_cmd` ABSENT is vacuous and byte-identical to today.
//
// Asserted as invariance under perturbation, never as "does not crash". And
// the three states — absent (null), the literal `none` (an ANSWER), and a real
// command — are asserted NOT to collapse into two.
// ===========================================================================

describe("AC-STE-512.4 — an absent e2e_cmd is vacuous, and never the same as `none`", () => {
  /** The shape an absent key must always produce. */
  function expectVacuous(outcome: E2eAuthoringOutcome): void {
    expect(outcome.ok).toBe(true);
    expect(outcome.declared).toBe(false);
    expect(outcome.authoring).toBe("not_applicable");
    expect(outcome.suiteRed).toBe(false);
    expect(outcome.capabilityToken).toBeNull();
    expect(outcome.noneNeededReason).toBeNull();
    expect([...outcome.evidenceRows]).toEqual([]);
    expect(outcome.counts).toBeNull();
    expect([...outcome.reasons]).toEqual([]);
  }

  test("an absent key produces the vacuous outcome", async () => {
    expectVacuous((await loadE2e()).resolveE2eAuthoring({ e2eCmd: null }));
  });

  test("BYTE-IDENTICAL: nothing else in the input can perturb the absent-key path", async () => {
    // This is the real content of "vacuous". Every sibling field is driven to a
    // value that WOULD change the outcome on a declared project — a red suite,
    // authored tests, a contradictory record — and the absent-key outcome must
    // be deep-equal across all of them. An implementation that lets any of
    // these leak through has changed today's behaviour for projects that never
    // opted in.
    const mod = await loadE2e();
    const baseline = mod.resolveE2eAuthoring({ e2eCmd: null });

    const perturbations: ReadonlyArray<[string, E2eAuthoringInput]> = [
      ["authored tests", { e2eCmd: null, addedTests: ["tests/e2e/a.e2e.test.ts"] }],
      ["edited tests", { e2eCmd: null, editedTests: ["tests/e2e/b.e2e.test.ts"] }],
      ["a none-needed record", { e2eCmd: null, noneNeeded: { reason: "no surface" } }],
      ["a green capture", { e2eCmd: null, run: capturedRun("ac4-p-green", E2E_GREEN) }],
      ["a RED capture", { e2eCmd: null, run: capturedRun("ac4-p-red", E2E_RED) }],
      ["unparseable bytes", { e2eCmd: null, run: capturedRun("ac4-p-garbage", E2E_GARBAGE) }],
      [
        "everything at once, contradictions included",
        {
          e2eCmd: null,
          addedTests: ["tests/e2e/a.e2e.test.ts"],
          editedTests: ["tests/e2e/b.e2e.test.ts"],
          noneNeeded: { reason: "no surface" },
          run: capturedRun("ac4-p-all", E2E_RED),
        },
      ],
    ];

    for (const [label, input] of perturbations) {
      const outcome = mod.resolveE2eAuthoring(input);
      expectVacuous(outcome);
      expect(`${label}: ${JSON.stringify(outcome)}`).toBe(
        `${label}: ${JSON.stringify(baseline)}`,
      );
    }
  });

  test("a BARE `e2e_cmd:` is an omission that merely looks like an answer", async () => {
    // The shipped predicates already say a bare key is not an answer. A local
    // truthiness check would agree here by accident and disagree elsewhere.
    const mod = await loadE2e();
    const bare = mod.resolveE2eAuthoring({ e2eCmd: "" });
    const whitespace = mod.resolveE2eAuthoring({ e2eCmd: "   " });

    expectVacuous(bare);
    expectVacuous(whitespace);
    expect(JSON.stringify(bare)).toBe(
      JSON.stringify(mod.resolveE2eAuthoring({ e2eCmd: null })),
    );
  });

  test("ABSENT AND `none` DO NOT COLLAPSE — they are different answers", async () => {
    // The distinction the whole key exists for: an absent key answers nothing,
    // while `none` answers "there is no e2e suite". Folding them together makes
    // a project that consciously declared it has no suite indistinguishable
    // from one that never heard the question.
    const mod = await loadE2e();
    const absent = mod.resolveE2eAuthoring({ e2eCmd: null });
    const none = mod.resolveE2eAuthoring({ e2eCmd: "none" });

    expect(absent.declared).toBe(false);
    expect(none.declared).toBe(true);

    expect(absent.capabilityToken).toBeNull();
    expect(none.capabilityToken).toBe(TOKEN_NONE_NEEDED);

    expect(absent.authoring).toBe("not_applicable");
    expect(none.authoring).toBe("none_needed");

    expect(JSON.stringify(absent)).not.toBe(JSON.stringify(none));
  });

  test("`none` is an ANSWER: it needs no authored test and no suite run", async () => {
    const outcome = (await loadE2e()).resolveE2eAuthoring({ e2eCmd: "none" });

    expect(outcome.ok).toBe(true);
    expect([...outcome.reasons]).toEqual([]);
    // There is no suite, so there are no counts to render — and rendering an
    // `(none found)` row here would imply a capture went missing.
    expect([...outcome.evidenceRows]).toEqual([]);
    expect(outcome.counts).toBeNull();
  });

  test("`none` is recognised CASE-INSENSITIVELY, exactly as the shipped predicate does", async () => {
    const mod = await loadE2e();
    for (const spelling of ["none", "None", "NONE", "  nOnE  "]) {
      const outcome = mod.resolveE2eAuthoring({ e2eCmd: spelling });
      expect(outcome.declared).toBe(true);
      expect(outcome.capabilityToken).toBe(TOKEN_NONE_NEEDED);
    }
  });

  test("ALL THREE STATES from a REAL CLAUDE.md, parsed by the shipped reader", async () => {
    const mod = await loadE2e();

    const absent = declaredE2eCmd("absent", null);
    const noneAnswer = declaredE2eCmd("none", "e2e_cmd: none");
    const realCmd = declaredE2eCmd("real", `e2e_cmd: ${REAL_CMD}`);

    // The parse itself distinguishes the three; the module must not re-fold them.
    expect(absent).toBeNull();
    expect(noneAnswer).toBe("none");
    expect(realCmd).toBe(REAL_CMD);

    const fromAbsent = mod.resolveE2eAuthoring({ e2eCmd: absent });
    const fromNone = mod.resolveE2eAuthoring({ e2eCmd: noneAnswer });
    const fromReal = mod.resolveE2eAuthoring({
      e2eCmd: realCmd,
      addedTests: ["tests/e2e/a.e2e.test.ts"],
      run: capturedRun("ac4-real", E2E_GREEN),
    });

    const shapes = [
      JSON.stringify({ d: fromAbsent.declared, t: fromAbsent.capabilityToken }),
      JSON.stringify({ d: fromNone.declared, t: fromNone.capabilityToken }),
      JSON.stringify({ d: fromReal.declared, t: fromReal.capabilityToken }),
    ];
    expect(new Set(shapes).size).toBe(3);
  });

  test("STRUCTURAL: the module asks the SHIPPED predicates, never a hand-inlined compare", async () => {
    await loadE2e();
    const source = read(E2E_MODULE);

    // Two layers reading the same four bytes with two hand-written comparisons
    // is the documented defect these predicates were extracted to prevent.
    expect(source).toContain('from "./verification_config"');
    expect(source).toContain("isRunCmdNone(");
    expect(source).toContain("isRunCmdAnswered(");
    expect(source).not.toMatch(/===\s*["']none["']/);
    expect(source).not.toMatch(/["']none["']\s*===/);
  });
});

// ===========================================================================
// AC-STE-512.5 — four capability tokens, each firing on its OWN path.
//
// A token that is merely registered proves nothing; a single token satisfying
// two paths is the defect. So the legs here are about DISTINCTNESS and
// EXCLUSIVITY, and the precedence between them is pinned rather than inferred.
// ===========================================================================

describe("AC-STE-512.5 — the four tokens distinguish authored, edited, none-needed and suite-red", () => {
  /** One scenario per token — each on the path that token is FOR. */
  function scenarios(): ReadonlyArray<[string, string, E2eAuthoringInput]> {
    return [
      [
        "authored",
        TOKEN_AUTHORED,
        {
          e2eCmd: REAL_CMD,
          addedTests: ["tests/e2e/new_flow.e2e.test.ts"],
          run: capturedRun("ac5-authored", E2E_GREEN),
        },
      ],
      [
        "edited",
        TOKEN_EDITED,
        {
          e2eCmd: REAL_CMD,
          editedTests: ["tests/e2e/old_flow.e2e.test.ts"],
          run: capturedRun("ac5-edited", E2E_GREEN),
        },
      ],
      [
        "none-needed",
        TOKEN_NONE_NEEDED,
        {
          e2eCmd: REAL_CMD,
          noneNeeded: { reason: "config-only change; nothing observable end to end" },
          run: capturedRun("ac5-none", E2E_GREEN),
        },
      ],
      [
        "suite-red",
        TOKEN_SUITE_RED,
        {
          e2eCmd: REAL_CMD,
          addedTests: ["tests/e2e/new_flow.e2e.test.ts"],
          run: capturedRun("ac5-red", E2E_RED),
        },
      ],
    ];
  }

  for (const [label, token, input] of scenarios()) {
    test(`the ${label} path emits \`${token}\` and nothing else`, async () => {
      const outcome = (await loadE2e()).resolveE2eAuthoring(input);

      expect(outcome.capabilityToken).toBe(token);
      // EXACTLY ONE. A `capabilityToken` that matched two of the four would
      // make the "distinguish" claim vacuous.
      const matched = ALL_TOKENS.filter((t) => t === outcome.capabilityToken);
      expect(matched).toEqual([token]);
    });
  }

  test("the four scenarios emit FOUR DIFFERENT tokens", async () => {
    const mod = await loadE2e();
    const emitted = scenarios().map(
      ([, , input]) => mod.resolveE2eAuthoring(input).capabilityToken,
    );

    expect(new Set(emitted).size).toBe(4);
    expect([...emitted].sort()).toEqual([...ALL_TOKENS].sort());
  });

  test("the four token LITERALS are themselves distinct", async () => {
    await loadE2e();
    expect(new Set(ALL_TOKENS).size).toBe(4);
  });

  test("PRECEDENCE: a red suite outranks every authoring token, on all three paths", async () => {
    // Pinned, not inferred. Without this, whichever branch happened to run
    // first would define the behaviour and a later reorder would silently
    // change which token an operator sees.
    const mod = await loadE2e();
    const authoringVariants: ReadonlyArray<[string, Partial<E2eAuthoringInput>]> = [
      ["authored", { addedTests: ["tests/e2e/a.e2e.test.ts"] }],
      ["edited", { editedTests: ["tests/e2e/a.e2e.test.ts"] }],
      ["none-needed", { noneNeeded: { reason: "nothing observable end to end" } }],
    ];

    for (const [label, variant] of authoringVariants) {
      const outcome = mod.resolveE2eAuthoring({
        e2eCmd: REAL_CMD,
        ...variant,
        run: capturedRun(`ac5-prec-${label.replace(/\W+/g, "")}`, E2E_RED),
      });
      expect(outcome.suiteRed).toBe(true);
      expect(outcome.capabilityToken).toBe(TOKEN_SUITE_RED);
      expect(outcome.ok).toBe(false);
    }
  });

  test("a GREEN suite never emits the suite-red token", async () => {
    const mod = await loadE2e();
    for (const [, , input] of scenarios().slice(0, 3)) {
      const outcome = mod.resolveE2eAuthoring(input);
      expect(outcome.suiteRed).toBe(false);
      expect(outcome.capabilityToken).not.toBe(TOKEN_SUITE_RED);
    }
  });

  test("the exported token map agrees with the literals this suite pins", async () => {
    // The suite restates the literals rather than importing them, so this is
    // the one leg that ties the restatement to the shipped constant.
    const mod = await loadE2e();
    expect(mod.E2E_CAPABILITY_TOKENS).toEqual({
      authored: TOKEN_AUTHORED,
      edited: TOKEN_EDITED,
      none_needed: TOKEN_NONE_NEEDED,
      suite_red: TOKEN_SUITE_RED,
    });
  });

  test("all four are REGISTERED in the canonical capability-key set", async () => {
    await loadE2e();
    const registered = new Set<string>(CANONICAL_CAPABILITY_KEYS);
    for (const token of ALL_TOKENS) {
      expect(registered.has(token)).toBe(true);
    }
  });

  test("the registry LENGTH moves by exactly four", async () => {
    await loadE2e();
    // The three sibling pins (m84's title, its assertion, its discovered count)
    // are already held to the live length by the M126 cross-pin; this holds the
    // live length itself, which is the half no existing pin supplies.
    expect(CANONICAL_CAPABILITY_KEYS.length).toBe(REGISTRY_LENGTH_AFTER_THIS_FR);
    expect(new Set<string>(CANONICAL_CAPABILITY_KEYS).size).toBe(
      CANONICAL_CAPABILITY_KEYS.length,
    );
  });

  test("no token carries a DIGIT, so the registry's reverse orphan scan can see it", async () => {
    await loadE2e();
    // The probe's reverse leg matches ``MUST emit `([a-z_]+)` ``. An `e2e_…`
    // spelling would slip past it and the bidirectional const↔directive
    // invariant would go one-way for exactly these four keys — a coverage hole
    // in a guard, which is the quietest kind of defect there is.
    for (const token of ALL_TOKENS) {
      expect(token).toMatch(/^[a-z_]+$/);
    }
  });

  test("/spec-write § 7 carries a literal MUST-emit directive for each token", async () => {
    await loadE2e();
    const specWrite = read(SPEC_WRITE_SKILL);
    for (const token of ALL_TOKENS) {
      expect(specWrite).toContain(`MUST emit \`${token}\``);
    }
  });

  test("the registry PROBE reports no violation for any of the four", async () => {
    // The end-to-end registration check: not "is the key in the array" but
    // "does the shipped probe pass on the real tree with the key registered".
    await loadE2e();
    const report = await runClosingSummaryCapabilityKeysProbe(REPO_ROOT);
    const offending = report.violations
      .filter((v) => (ALL_TOKENS as readonly string[]).includes(v.missingKey))
      .map((v) => v.note);

    expect(offending).toEqual([]);
  });

  test("SURFACE: the Phase 4 hook names all four tokens as MUST-emit literals", async () => {
    await loadE2e();
    const { line } = e2eHookLine();

    for (const token of ALL_TOKENS) {
      expect(line).toContain(`MUST emit \`${token}\``);
    }
  });
});

// ===========================================================================
// HARDENING — post-audit, scoped. Nothing below relaxes, replaces or restates
// a leg above; these are the four gaps an independent audit found once all
// fifty-five AC legs were green.
//
//   GAP 1 (HIGH) — A CROSS-FR SEAM THAT PRINTS A CONFIDENT FALSEHOOD.
//   `resolveE2eAuthoring` calls the shared renderer with `required: ["e2e"]`,
//   and that renderer emits all three sections unconditionally — so
//   `evidenceRows` is always six lines: `gate:` / `  - (none found)` /
//   `drive:` / `  - (none found)` / `e2e:` / the real counts. The sibling FR
//   has step 14 render its own `## Verification evidence` block through
//   `renderImplementReportEvidence`, and NOTHING on either surface says how the
//   two relate. As shipped, an operator either sees TWO evidence blocks, or one
//   whose gate and drive rows read `(none found)` on a run that captured both.
//   A row saying `(none found)` about a capture that exists is exactly the
//   confident falsehood this milestone's fail-closed grading exists to prevent,
//   reappearing at the seam between two of its own FRs. The resolution is a
//   choice — thread the hook's capture into the step-14 call so one block
//   carries three real sections, or say the hook's rows are internal and never
//   printed — so the legs demand a CLASSIFIABLE statement on each surface and
//   that the two surfaces AGREE, which is the half a single-surface pin misses.
//
//   GAP 2 (MED) — THREE SURFACES STATE A RULE THE CODE DOES NOT FOLLOW. The
//   `none` sentinel emits `end_to_end_none_needed` with a NULL reason, and it
//   is right to: a project with no suite has nothing to explain away. But
//   /spec-write § 7 (the canonical rendering template), the /implement hook
//   line, and the registry comment all say the token fires only on a real
//   `e2e_cmd` and only when a non-blank reason was recorded. § 7 would render a
//   bullet claiming a reason was recorded and read back out when none exists.
//   The behaviour is right and the prose is wrong on all three.
//
//   GAP 3 (MED) — A TWO-BRANCH DISTINCTION PINNED IN ONE DIRECTION ONLY. The
//   recorded branch is pinned to read its reason back out; no leg asserts the
//   sentinel branch's reason is NULL. A change that synthesised a placeholder
//   string there would pass every leg above while collapsing the very
//   distinction the module's own field doc spells out. The mutation leg is what
//   proves the new pin can fail: it synthesises exactly that placeholder in a
//   throwaway copy and demands the difference show up.
//
//   GAP 4 (MED) — THE THIRD SURFACE, UNGUARDED. `docs/verification-skills.md`
//   owns the canonical closed `## Verification` key table, and its `e2e_cmd`
//   row describes the key purely as a declaration. Declaring it now creates an
//   OBLIGATION on `/implement`. Its sibling `run_cmd` gets the mandatory-drive
//   consequences spelled out at length in that same document; `e2e_cmd` gets
//   nothing, and no test pins it — the FR's surface legs reach only
//   `skills/implement/SKILL.md` and `docs/implement-reference.md`. This is the
//   milestone's own recurring defect class (surface-parity drift, three times
//   in one milestone, still no guard on the class) with a third surface.
// ===========================================================================

const REGISTRY_MODULE = join(SHARED_SRC, "closing_summary_capability_keys.ts");
const VERIFICATION_SKILLS_DOC = join(PLUGIN_ROOT, "docs", "verification-skills.md");

/**
 * Lines of `path` matching EVERY regex given.
 *
 * Line granularity, not paragraph, and deliberately: `skills/implement/SKILL.md`
 * and `docs/implement-reference.md` both write one paragraph per line, so a
 * line IS a statement — while a paragraph split on blank lines would happily
 * span the Phase 4 hook and the step-14 report bullet and call their accidental
 * co-residence a relationship.
 */
function linesMatchingAll(path: string, ...res: readonly RegExp[]): string[] {
  return read(path)
    .split("\n")
    .filter((line) => res.every((re) => re.test(line)));
}

/** Blank-line-separated paragraphs, whitespace-normalised — for hard-wrapped docs. */
function paragraphs(path: string): string[] {
  return read(path)
    .split(/\n\s*\n/)
    .map((para) => para.replace(/\s+/g, " ").trim())
    .filter((para) => para.length > 0);
}

function matchIndices(text: string, re: RegExp): number[] {
  const global = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
  const out: number[] = [];
  for (let m = global.exec(text); m !== null; m = global.exec(text)) {
    out.push(m.index);
    if (global.lastIndex === m.index) global.lastIndex += 1;
  }
  return out;
}

/** Do a match of `a` and a match of `b` sit within `window` characters of each other? */
function pairWithin(text: string, a: RegExp, b: RegExp, window: number): boolean {
  const left = matchIndices(text, a);
  const right = matchIndices(text, b);
  return left.some((i) => right.some((j) => Math.abs(i - j) <= window));
}

// --- GAP 1 anchors ---------------------------------------------------------

const HOOK_ANCHOR = /e2e_authoring|resolveE2eAuthoring/;
const REPORT_ANCHOR = /renderImplementReportEvidence/;
/** "the hook's rows are internal / never printed." */
const STANCE_INTERNAL =
  /\binternal\b|\bnever (?:printed|rendered|shown|surfaced|reaches|reach)\b|\bnot printed\b/i;
/** "the hook's e2e capture is threaded into the one step-14 call." */
const STANCE_THREADED =
  /\bthread(?:s|ed|ing)?\b|\bfeeds?\b|\bfed\b|\bpass(?:es|ed)?\s+(?:in|into|through|to)\b|\bsupplie[sd]\b|\bhand(?:s|ed)?\s+(?:in|to|off)\b/i;
/** The falsehood itself: the statement has to say what becomes of gate and drive. */
const SIBLING_ROWS = /\bgate\b|\bdrive\b|\(none found\)/i;

/**
 * The RELATIONSHIP statement on one surface, plus its stance.
 *
 * A bare `toContain("renderImplementReportEvidence")` passes on both surfaces
 * TODAY — each names it in an unrelated section — so co-occurrence with the
 * hook anchor ON ONE LINE is the load-bearing part of this pin.
 */
function evidenceRelationship(path: string): { text: string; stance: string } {
  const text = linesMatchingAll(path, HOOK_ANCHOR, REPORT_ANCHOR).join("\n");
  const stance = [
    STANCE_INTERNAL.test(text) ? "internal" : "",
    STANCE_THREADED.test(text) ? "threaded" : "",
  ]
    .filter((part) => part !== "")
    .join("+");
  return { text, stance };
}

// --- GAP 2 anchors ---------------------------------------------------------

/** The `none` ANSWER, named as a value rather than as the English word. */
const SENTINEL_MENTION = /`none`|literal\s+none|e2e_cmd:\s*none|"none"/i;
/**
 * "no reason / a null reason", tight enough that the SILENT-SKIP prose already
 * on all three surfaces ("has no end-to-end observable surface and RECORDED
 * that decision with a non-blank reason") cannot satisfy it: twenty-four
 * characters of slack between the two words, not eighty.
 */
const REASONLESS =
  /\b(?:no|null|without(?:\s+an?)?|nothing|never)\b[^\n]{0,24}?\breason\b|\breason\b[^\n]{0,24}?\b(?:null|absent|reasonless)\b/i;
/** Sentinel and reasonless clause have to be in the same breath, not the same file. */
const SENTINEL_WINDOW = 140;

/** The comment block that documents the four tokens, immediately above them. */
function registryTokenComment(): string {
  const lines = read(REGISTRY_MODULE).split("\n");
  const anchor = lines.findIndex((line) => line.includes(`"${TOKEN_AUTHORED}"`));
  if (anchor < 0) throw new Error("the registry does not carry the authored token");
  const out: string[] = [];
  for (let i = anchor - 1; i >= 0 && lines[i]!.trim().startsWith("//"); i -= 1) {
    out.unshift(lines[i]!);
  }
  return out.join("\n");
}

describe("HARDENING GAP 1 — the hook's rows vs. the step-14 evidence block", () => {
  test("WITNESS: the hook's own rows claim `(none found)` for gate AND drive", async () => {
    // Not a complaint about the renderer — this is the fact that makes the
    // missing statement matter, asserted so the two legs below have a named
    // subject rather than a vibe. Six lines, two of them about captures this
    // module was never given and cannot speak for.
    const outcome = (await loadE2e()).resolveE2eAuthoring({
      e2eCmd: REAL_CMD,
      addedTests: ["tests/e2e/a.e2e.test.ts"],
      run: capturedRun("gap1-witness", E2E_GREEN),
    });

    expect(outcome.evidenceRows.length).toBe(6);
    expect([...outcome.evidenceRows].slice(0, 4)).toEqual([
      "gate:",
      "  - (none found)",
      "drive:",
      "  - (none found)",
    ]);
  });

  test("`docs/implement-reference.md` STATES how the hook's rows relate to step 14", async () => {
    await loadE2e();
    const { text, stance } = evidenceRelationship(IMPLEMENT_REFERENCE);

    // The statement must exist AS a statement: one line naming both the hook
    // and the step-14 renderer. Naming them in two unrelated sections — which
    // is the shipped state — leaves the operator to guess.
    expect(text).not.toBe("");
    // And it must RESOLVE the seam one way or the other, rather than merely
    // mentioning both: either the capture is threaded into the one step-14
    // call, or the hook's rows are internal and never printed.
    expect(stance).not.toBe("");
    // Whichever way it resolves, it has to say what becomes of the gate and
    // drive rows — those two are the confident falsehood.
    expect(text).toMatch(SIBLING_ROWS);
  });

  test("`skills/implement/SKILL.md` states the SAME relationship", async () => {
    await loadE2e();
    const { text, stance } = evidenceRelationship(IMPLEMENT_SKILL);

    expect(text).not.toBe("");
    expect(stance).not.toBe("");
    expect(text).toMatch(SIBLING_ROWS);
  });

  test("PARITY: the two surfaces resolve the seam the SAME WAY", async () => {
    await loadE2e();
    const reference = evidenceRelationship(IMPLEMENT_REFERENCE);
    const skill = evidenceRelationship(IMPLEMENT_SKILL);

    // Guarded before compared: two absent statements are both `""` and would
    // otherwise pass this leg by agreeing about nothing. Surface-parity drift
    // recurred three times in one milestone and the class still has no guard —
    // this is that guard, for this seam.
    expect(reference.stance).not.toBe("");
    expect(skill.stance).not.toBe("");
    expect(skill.stance).toBe(reference.stance);
  });
});

describe("HARDENING GAP 2 — the `none` sentinel branch, on all three surfaces", () => {
  test("BEHAVIOUR the prose has to match: `none` emits the token with NO reason", async () => {
    // The subject of all three legs below, stated once as executable fact so
    // the prose pins cannot drift onto some other claim.
    const outcome = (await loadE2e()).resolveE2eAuthoring({ e2eCmd: "none" });

    expect(outcome.capabilityToken).toBe(TOKEN_NONE_NEEDED);
    expect(outcome.noneNeededReason).toBeNull();
  });

  test("/spec-write § 7 — the canonical rendering template covers the sentinel", async () => {
    await loadE2e();
    const segment = read(SPEC_WRITE_SKILL)
      .split("\n")
      .filter((line) => line.includes(TOKEN_NONE_NEEDED))
      .join("\n");

    // § 7 is the map a report is RENDERED from. As shipped it says the token
    // fires "only when a non-blank reason was recorded", so rendering the
    // sentinel run from it produces a bullet claiming a reason exists and is
    // read back out — about a run that recorded none.
    expect(segment).not.toBe("");
    expect(pairWithin(segment, SENTINEL_MENTION, REASONLESS, SENTINEL_WINDOW)).toBe(true);
  });

  test("the /implement Phase 4 hook line covers the sentinel", async () => {
    await loadE2e();
    const { line } = e2eHookLine();

    expect(line).toContain(TOKEN_NONE_NEEDED);
    expect(pairWithin(line, SENTINEL_MENTION, REASONLESS, SENTINEL_WINDOW)).toBe(true);
  });

  test("the registry comment covers the sentinel", async () => {
    await loadE2e();
    const comment = registryTokenComment();

    // The comment block is the registry's own account of when each key fires.
    // Assert it EXISTS before asserting about it — an empty string satisfies
    // nothing and would read as a pass on the wrong side of the check.
    expect(comment.split("\n").length).toBeGreaterThan(2);
    expect(comment).toContain(TOKEN_NONE_NEEDED);
    expect(pairWithin(comment, SENTINEL_MENTION, REASONLESS, SENTINEL_WINDOW)).toBe(true);
  });
});

describe("HARDENING GAP 3 — the sentinel branch's reason is NULL, in both directions", () => {
  const RECORDED_REASON =
    "the change rewrites a config parser's closed key set; no surface a user or " +
    "a driven browser can observe changes";

  test("SIDE BY SIDE: both branches reach none_needed, only ONE carries a reason", async () => {
    // `authoring: "none_needed"` is reachable two ways, and the module's own
    // field doc says so: a RECORDED reason, and the `none` ANSWER (nothing to
    // explain away, so nothing recorded). The recorded direction was pinned;
    // the null direction was not, so a synthesised placeholder on the sentinel
    // path would have passed every leg in this file.
    const mod = await loadE2e();

    const sentinel = mod.resolveE2eAuthoring({ e2eCmd: "none" });
    const recorded = mod.resolveE2eAuthoring({
      e2eCmd: REAL_CMD,
      noneNeeded: { reason: RECORDED_REASON },
      run: capturedRun("gap3-recorded", E2E_GREEN),
    });

    expect(sentinel.authoring).toBe("none_needed");
    expect(recorded.authoring).toBe("none_needed");
    expect(sentinel.capabilityToken).toBe(TOKEN_NONE_NEEDED);
    expect(recorded.capabilityToken).toBe(TOKEN_NONE_NEEDED);

    // The one field that tells them apart.
    expect(sentinel.noneNeededReason).toBeNull();
    expect(recorded.noneNeededReason).toBe(RECORDED_REASON);
  });

  test("the sentinel reason stays null under every sibling input", async () => {
    // A project that declared `none` has no suite, so nothing a caller passes
    // about tests or captures can conjure a rationale into existence.
    const mod = await loadE2e();
    const inputs: ReadonlyArray<[string, E2eAuthoringInput]> = [
      ["a green capture", { e2eCmd: "none", run: capturedRun("gap3-green", E2E_GREEN) }],
      ["a red capture", { e2eCmd: "none", run: capturedRun("gap3-red", E2E_RED) }],
      ["authored tests", { e2eCmd: "none", addedTests: ["tests/e2e/a.e2e.test.ts"] }],
      [
        "a recorded reason it does not need",
        { e2eCmd: "none", noneNeeded: { reason: RECORDED_REASON } },
      ],
    ];

    for (const [label, input] of inputs) {
      const outcome = mod.resolveE2eAuthoring(input);
      expect(`${label}: ${outcome.noneNeededReason}`).toBe(`${label}: null`);
    }
  });

  test("MUTATION: a synthesised placeholder reason on the sentinel branch is CAUGHT", async () => {
    // Falsifiability for a pin on already-correct behaviour: build the exact
    // regression the audit named — a placeholder string on the sentinel branch
    // — in a throwaway copy, and show the assertion above goes red on it.
    const copyRoot = tempDir("gap3-mutation");
    const copySrc = join(copyRoot, "src");
    cpSync(SHARED_SRC, copySrc, { recursive: true });

    const modulePath = join(copySrc, "e2e_authoring.ts");
    const original = read(modulePath);
    const branchAnchor = `capabilityToken: E2E_CAPABILITY_TOKENS.none_needed,`;
    const fieldAnchor = `noneNeededReason: null,`;
    const placeholder = "no end-to-end suite is declared";

    // A mutation that never applied reads as a pass. The sentinel RETURN is the
    // only place the token is set as an object property (the authoring paths
    // assign it), so this anchor is unique — asserted, not assumed.
    expect(original.split(branchAnchor).length - 1).toBe(1);
    const branchAt = original.indexOf(branchAnchor);
    const fieldAt = original.indexOf(fieldAnchor, branchAt);
    expect(fieldAt).toBeGreaterThan(branchAt);

    writeFileSync(
      modulePath,
      original.slice(0, fieldAt) +
        `noneNeededReason: ${JSON.stringify(placeholder)},` +
        original.slice(fieldAt + fieldAnchor.length),
      "utf-8",
    );

    const mutated = await loadE2e(modulePath);
    const mutatedSentinel = mutated.resolveE2eAuthoring({ e2eCmd: "none" });

    // The mutant still reaches the same decision and the same token — which is
    // precisely why nothing else in this file notices it.
    expect(mutatedSentinel.authoring).toBe("none_needed");
    expect(mutatedSentinel.capabilityToken).toBe(TOKEN_NONE_NEEDED);
    // And the new pin is the one thing that does.
    expect(mutatedSentinel.noneNeededReason).toBe(placeholder);

    // The real tree is untouched: the placeholder is the copy's alone.
    expect(read(E2E_MODULE)).not.toContain(placeholder);
    expect((await loadE2e()).resolveE2eAuthoring({ e2eCmd: "none" }).noneNeededReason).toBeNull();
  });
});

describe("HARDENING GAP 4 — docs/verification-skills.md owns the closed key table", () => {
  /** The obligation a declared `e2e_cmd` creates, in three parts. */
  const OBLIGATION_AUTHORING =
    /\b(?:add|adds|added|author|authors|authored|edit|edits|edited)\b/i;
  const OBLIGATION_RECORD = /none[- ]needed|end_to_end_none_needed/i;
  const OBLIGATION_REFUSAL =
    /\brefus\w*|\bnot available\b|\bblock\w*|\bis a failure\b|\bfails?\b|\bowes?\b/i;

  test("CONTROL: the sibling `run_cmd` gets its consequences spelled out", async () => {
    // The shape this doc already uses for the other declaration-with-teeth
    // key. Present today — which is what makes its absence for `e2e_cmd` a
    // parity gap rather than a house style.
    await loadE2e();
    const spelled = paragraphs(VERIFICATION_SKILLS_DOC).filter(
      (para) => /run_cmd/.test(para) && /mandatory/i.test(para) && OBLIGATION_REFUSAL.test(para),
    );

    expect(spelled.length).toBeGreaterThan(0);
  });

  test("the doc states the OBLIGATION a real `e2e_cmd` creates on /implement", async () => {
    await loadE2e();
    // Paragraph granularity, not line: unlike the two /implement surfaces this
    // document is hard-wrapped, so a statement spans several lines.
    const stated = paragraphs(VERIFICATION_SKILLS_DOC).filter(
      (para) =>
        /e2e_cmd/.test(para) &&
        OBLIGATION_AUTHORING.test(para) &&
        OBLIGATION_RECORD.test(para) &&
        OBLIGATION_REFUSAL.test(para),
    );

    // All three parts in ONE paragraph: author or edit an end-to-end test, or
    // record the none-needed decision, else the green declaration is refused.
    // A green declaration that the doc never warned could be refused is how a
    // project opts into a gate it does not know it has.
    expect(stated.length).toBeGreaterThan(0);
  });

  test("the doc ties the obligation to the SHIPPED mechanism, not to prose alone", async () => {
    await loadE2e();
    const doc = read(VERIFICATION_SKILLS_DOC);

    // Named so a rename has somewhere to land: the doc that owns the key table
    // is a consumer of this module like any other surface.
    expect(doc).toMatch(/resolveE2eAuthoring|e2e_authoring/);
    expect(doc).toContain(TOKEN_NONE_NEEDED);
  });

  test("the `e2e_cmd` table ROW is no longer purely a declaration", async () => {
    await loadE2e();
    const row = read(VERIFICATION_SKILLS_DOC)
      .split("\n")
      .find((line) => /^\|\s*`e2e_cmd`/.test(line));

    // The row is where a reader looks first, and today it stops at "declares
    // how the suite is invoked" — true, and half the story. `end-to-end suite`
    // is already in it, so the anchor here is the obligation vocabulary, never
    // a bare mention of end-to-end anything.
    expect(row).toBeDefined();
    expect(row!).toMatch(/\/implement|\bowes?\b|obligation|end-to-end test|none[- ]needed/i);
  });

  test("the key set stays CLOSED — this doc gains no fifth key", async () => {
    await loadE2e();
    const doc = read(VERIFICATION_SKILLS_DOC);

    // The obligation is a consequence of `e2e_cmd`, not a new key. Stated so
    // the fix above cannot be delivered by inventing configuration.
    expect(doc).toContain("The key set is **closed**");
    const rows = doc.split("\n").filter((line) => /^\|\s*`[a-z0-9_]+`\s*\|/.test(line));
    expect(rows.length).toBe(4);
  });
});
