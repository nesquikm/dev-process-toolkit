// M136 STE-530 — an unmeasurable skip baseline names the command that measures it.
//
// WHAT THIS FILE PINS, and why each leg is shaped the way it is.
//
//   AC.1  `SKIP_OUTCOMES` is FOUR-valued, and `isCleanPass` is asserted against
//         EVERY member of it rather than against the new one. The failure this
//         guards is a predicate widened by accident, and that failure is
//         invisible to a test that only asks about `incomparable`. The
//         enumeration is driven off `SKIP_OUTCOMES` itself, so a fifth outcome
//         added later is asserted the moment it is declared.
//
//   AC.2  Every REFUSAL rendering carries a copy-pasteable command, not a prose
//         instruction. Measured today by running the shipped module: the
//         unmeasured branch ends with the words "capture a baseline at the
//         branch point" and carries no command at all.
//
//   AC.3  `unmeasured` and `incomparable` are DISTINCT sentences with distinct
//         remedies, and neither is assembled from `measuredAgainstBaseline`.
//         The second half is asserted behaviourally: both refusals are rendered
//         from verdicts carrying deliberately misleading `baseline`/`delta`
//         numbers, and the numbers must not appear. A refusal built from the
//         same parts as a pass is a relabelled pass (AC-STE-509.3).
//         Measured today: `incomparable` falls through the renderer's `default:`
//         and comes out as `skips: pass — 5 now vs null at the branch point
//         (delta 0)`. It is not merely unhandled; it renders as a PASS.
//
//   AC.4  The step-14 consumer treats `incomparable` as a refusal ground with
//         its OWN reason line. Driven through the REAL `renderStageEvidence`
//         (a copy of the shipped file, re-wired to a stubbed verdict source),
//         asserted through the refusal set — `ok === false` plus a `gate` reason
//         that is not any of the unmeasured reasons. A CONTROL leg runs the same
//         copy against a stub returning a measured `pass` and asserts `ok`, so
//         "the copy always refuses" cannot score as "incomparable was routed".
//         Measured today: the gate section has exactly two reason branches,
//         `unmeasured` and `fail`, so a fourth outcome renders a passing block.
//
//   AC.5  The remedy is asserted EXECUTABLE, not present. The command is
//         extracted from the rendered line with NO editing between extraction
//         and execution, run in a throwaway git-initialised fixture project,
//         and a baseline record is asserted to exist ON DISK afterwards at the
//         path `dpt_paths.skipBaselinePath` composes. A wrong flag, a wrong
//         path, or a flag that does not exist reads identically to a correct
//         command under a substring match.
//
//   AC.6  AC.5 is mutation-verified with TWO executed mutations of the remedy
//         clause, each asserted to have APPLIED by naming the clause it changed
//         (`mutateInRegion` aborts loudly when the anchor is absent, so a
//         mutation that never landed cannot score as a pass — M121 § 0k(m)):
//           * command → prose, which is exactly today's shipped wording;
//           * command → same command with a wrong path, where the leg ALSO
//             asserts that a naive substring match still passes on the mutant.
//             That is the whole difference between "present" and "executable".
//
//   AC.7  The two shipped MEASURED renderings are pinned byte-wise. The literals
//         below were captured by RUNNING the shipped module at the time this
//         file was written, not retyped from the FR, so the pin cannot record a
//         typo as the contract.
//
//   AC.8  The two incomparable conditions do not share one line: the rendered
//         lines differ, one names the CHECKOUT condition and one names the
//         NAMES condition, and their extracted commands differ (re-measure here
//         versus re-run the gate so it names its skips). A shared remedy is
//         wrong on one of the two causes.
//
// CONTRACTS THIS FILE DEFINES FOR THE IMPLEMENTER. None of these names is
// guessed from the FR — each is DISCOVERED at run time, so the implementer
// picks the spelling and this file follows it:
//
//   * The `SkipVerdict` interface gains EXACTLY ONE field beyond `outcome`,
//     `baseline`, `current` and `delta`. That field is the incomparable cause
//     discriminator; its name is read out of the interface, never assumed.
//   * The module exports EXACTLY ONE string array besides `SKIP_OUTCOMES`, and
//     it is the cause vocabulary, with at least two members. Same house shape
//     as `SKIP_OUTCOMES`, discovered the same way.
//   * A refusal line carries EXACTLY ONE backtick-delimited span, and that span
//     is the command. Ambiguity here would put a manual editing step between
//     extraction and execution, which is the one thing the FR's Testing section
//     forbids.
//
// A NOTE ON AC.2 vs AC.7, because they read as if they collide. AC.2 says every
// non-pass rendering carries a command; AC.7 pins the `fail` line to its exact
// current wording, which carries none. The FR's own Requirement sentence
// resolves it — "each carries a copy-pasteable command that produces the
// MISSING MEASUREMENT" — and nothing is missing from a measured `fail`. So the
// command legs below are scoped to the two REFUSALS, and one further leg holds
// the general line for every rendering including `fail`: no rendering may issue
// an imperative without a command to carry it out.

import { describe, expect, test } from "bun:test";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { skipBaselinePath } from "../adapters/_shared/src/dpt_paths";
import { mutateInRegion } from "./_sited-mutation";
import { discoverCauseField, discoverCauses } from "./_skip_verdict_discovery";

// ===========================================================================
// Paths and module handles.
// ===========================================================================

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");
const SHARED_SRC = join(PLUGIN_ROOT, "adapters", "_shared", "src");

const SKIP_BASELINE_FILE = join(SHARED_SRC, "skip_baseline.ts");
const EVIDENCE_FILE = join(SHARED_SRC, "deliver_stage_evidence.ts");
const TEST_COUNT_PARSER_FILE = join(SHARED_SRC, "test_count_parser.ts");
const REPO_CLAUDE_MD = join(REPO_ROOT, "CLAUDE.md");

const read = (p: string): string => readFileSync(p, "utf-8");

interface SkipVerdictShape {
  readonly outcome: string;
  readonly baseline: number | null;
  readonly current: number;
  readonly delta: number | null;
  readonly [extra: string]: unknown;
}

interface SkipBaselineModule {
  readonly SKIP_OUTCOMES: readonly string[];
  classifySkipDelta(baseline: number | null, current: number): SkipVerdictShape;
  isCleanPass(verdict: SkipVerdictShape): boolean;
  renderSkipVerdict(verdict: SkipVerdictShape): string;
}

interface EvidenceCountsShape {
  readonly pass: number;
  readonly fail: number;
  readonly skip: number;
  readonly baseline: number | null;
  readonly delta: number | null;
}

interface EvidenceModule {
  renderStageEvidence(input: Record<string, unknown>): {
    readonly ok: boolean;
    readonly lines: readonly string[];
    readonly counts: Readonly<Record<string, EvidenceCountsShape | null>>;
    readonly reasons: readonly string[];
  };
}

async function loadSkipBaseline(): Promise<SkipBaselineModule> {
  return (await import("../adapters/_shared/src/skip_baseline")) as unknown as SkipBaselineModule;
}

// ===========================================================================
// Throwaway trees. Nothing here touches the toolkit repo.
// ===========================================================================

const TEMP_DIRS: string[] = [];

function tempDir(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `ste530-${label}-`));
  TEMP_DIRS.push(dir);
  return dir;
}

function gitIn(cwd: string, args: string[]): { exitCode: number; stdout: string } {
  const proc = Bun.spawnSync(
    ["git", "-c", "user.email=t@t.test", "-c", "user.name=t", ...args],
    { cwd, stdout: "pipe", stderr: "pipe" },
  );
  return { exitCode: proc.exitCode, stdout: proc.stdout.toString() };
}

/**
 * A throwaway PROJECT the remedy can be run in: a real git repository standing
 * on `main` with a clean tree, one genuinely runnable test file, and this
 * repository's own `CLAUDE.md` copied in rather than hand-written.
 *
 * Copied, not authored: the capture this milestone ships reads real project
 * configuration, and a hand-written fixture is free to differ from the real
 * block for the wrong reason (the shape STE-528's AC.8 names).
 */
function makeFixtureProject(label: string): string {
  const root = tempDir(`fixture-${label}`);

  writeFileSync(
    join(root, "package.json"),
    `${JSON.stringify({ name: "ste530-fixture", private: true }, null, 2)}\n`,
  );
  mkdirSync(join(root, "tests"), { recursive: true });
  writeFileSync(
    join(root, "tests", "trivial.test.ts"),
    [
      'import { expect, test } from "bun:test";',
      "",
      'test("the fixture suite carries one real assertion", () => {',
      "  expect(1 + 1).toBe(2);",
      "});",
      "",
    ].join("\n"),
  );
  copyFileSync(REPO_CLAUDE_MD, join(root, "CLAUDE.md"));

  gitIn(root, ["init", "-q", "-b", "main"]);
  gitIn(root, ["add", "-A"]);
  gitIn(root, ["commit", "-q", "-m", "chore: fixture"]);

  return root;
}

function cleanupTempDirs(): void {
  for (const dir of TEMP_DIRS.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ===========================================================================
// Discovery — the implementer picks the names, this file reads them.
// ===========================================================================

const KNOWN_VERDICT_FIELDS = ["outcome", "baseline", "current", "delta"];


interface IncomparableCase {
  readonly cause: string;
  readonly verdict: SkipVerdictShape;
  readonly line: string;
}

function incomparableCases(mod: SkipBaselineModule, current = 5): IncomparableCase[] {
  const field = discoverCauseField(SKIP_BASELINE_FILE);
  return discoverCauses(mod).map((cause) => {
    const verdict = {
      outcome: "incomparable",
      baseline: null,
      current,
      delta: null,
      [field]: cause,
    } as SkipVerdictShape;
    return { cause, verdict, line: mod.renderSkipVerdict(verdict) };
  });
}

// ===========================================================================
// Command extraction — no editing between extraction and execution.
// ===========================================================================

interface CommandSpan {
  readonly start: number;
  readonly end: number;
  readonly command: string;
}

function commandSpans(line: string): CommandSpan[] {
  const spans: CommandSpan[] = [];
  const pattern = /`([^`\n]+)`/g;
  let hit = pattern.exec(line);
  while (hit !== null) {
    spans.push({ start: hit.index, end: hit.index + hit[0].length, command: hit[1] as string });
    hit = pattern.exec(line);
  }
  return spans;
}

/** The one command in a refusal line. Exactly one span, or this is not one. */
function extractCommand(line: string): CommandSpan | null {
  const spans = commandSpans(line);
  return spans.length === 1 ? (spans[0] as CommandSpan) : null;
}

interface RemedyOutcome {
  readonly ok: boolean;
  readonly why: string;
}

/**
 * Run the remedy in a fixture project and report whether a BASELINE RECORD
 * landed on disk. The record — not the exit code, and not the command's text —
 * is the assertion, because a capture that reports success while writing
 * nothing is the failure mode this milestone exists to detect.
 */
function runRemedy(line: string, label: string): RemedyOutcome {
  const span = extractCommand(line);
  if (span === null) {
    return {
      ok: false,
      why: `the ${label} line carries no single backticked command: ${JSON.stringify(line)}`,
    };
  }

  const root = makeFixtureProject(label);
  const proc = Bun.spawnSync(["/bin/sh", "-c", span.command], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = proc.exitCode;
  const noise = `${proc.stdout.toString()}\n${proc.stderr.toString()}`.trim().slice(0, 800);

  const store = skipBaselinePath(root);
  if (!existsSync(store)) {
    return {
      ok: false,
      why:
        `[${label}] \`${span.command}\` exited ${exitCode} and wrote NO baseline record ` +
        `at ${store}\n${noise}`,
    };
  }

  const raw = read(store);
  if (!/"skipped"\s*:\s*\d+/.test(raw)) {
    return {
      ok: false,
      why: `[${label}] the store at ${store} holds no skip count: ${raw.slice(0, 400)}`,
    };
  }
  if (exitCode !== 0) {
    return { ok: false, why: `[${label}] \`${span.command}\` exited ${exitCode}\n${noise}` };
  }

  return { ok: true, why: `[${label}] a baseline record exists at ${store}` };
}

// ===========================================================================
// AC-STE-530.1 — the vocabulary is four-valued and `isCleanPass` stays narrow.
// ===========================================================================

describe("AC-STE-530.1 — SKIP_OUTCOMES gains `incomparable`", () => {
  test("the vocabulary is exactly four-valued", async () => {
    const mod = await loadSkipBaseline();

    expect([...mod.SKIP_OUTCOMES].sort()).toEqual([
      "fail",
      "incomparable",
      "pass",
      "unmeasured",
    ]);
    expect(new Set(mod.SKIP_OUTCOMES).size).toBe(4);
  });

  test("isCleanPass is asserted against ALL members, not against the new one", async () => {
    const mod = await loadSkipBaseline();

    // Driven off the shipped list, so a FIFTH outcome added later is asserted
    // the moment it is declared rather than being silently admitted as clean.
    for (const outcome of mod.SKIP_OUTCOMES) {
      const verdict = {
        outcome,
        baseline: outcome === "pass" || outcome === "fail" ? 3 : null,
        current: 3,
        delta: outcome === "pass" || outcome === "fail" ? 0 : null,
      } as SkipVerdictShape;

      expect(mod.isCleanPass(verdict), `isCleanPass(${outcome})`).toBe(outcome === "pass");
    }

    // And the enumeration really covered four things — a `SKIP_OUTCOMES` that
    // shrank would otherwise make the loop above vacuously true.
    expect(mod.SKIP_OUTCOMES.length).toBe(4);
  });
});

// ===========================================================================
// AC-STE-530.2 — every refusal carries a copy-pasteable command.
// ===========================================================================

describe("AC-STE-530.2 — a command, not a prose instruction", () => {
  test("the unmeasured line carries exactly one backticked command", async () => {
    const mod = await loadSkipBaseline();
    const line = mod.renderSkipVerdict(mod.classifySkipDelta(null, 5));

    // Measured today: the line ENDS on this prose and names no command at all.
    expect(line).not.toMatch(/capture a baseline at the branch point\s*$/);

    const span = extractCommand(line);
    expect(span, `no single backticked command in ${JSON.stringify(line)}`).not.toBeNull();
    expect((span as CommandSpan).command.trim().length).toBeGreaterThan(0);
    expect((span as CommandSpan).command).not.toContain("\n");
  });

  test("every incomparable line carries exactly one backticked command", async () => {
    const mod = await loadSkipBaseline();
    const cases = incomparableCases(mod);

    for (const one of cases) {
      const span = extractCommand(one.line);
      expect(span, `cause ${one.cause}: ${JSON.stringify(one.line)}`).not.toBeNull();
      expect((span as CommandSpan).command.trim().length).toBeGreaterThan(0);
    }
  });

  test("no rendering issues an imperative it gives no command for", async () => {
    const mod = await loadSkipBaseline();

    const rendered = [
      mod.renderSkipVerdict(mod.classifySkipDelta(2, 5)),
      mod.renderSkipVerdict(mod.classifySkipDelta(4, 4)),
      mod.renderSkipVerdict(mod.classifySkipDelta(null, 5)),
      ...incomparableCases(mod).map((one) => one.line),
    ];

    // The general line, held for `fail` and `pass` too: a rendering that tells
    // the reader to DO something must hand them the thing to run. This is what
    // produced a hand-typed number the first time.
    for (const line of rendered) {
      if (!/\b(capture|re-?run|measure|record)\b/i.test(line)) continue;
      expect(extractCommand(line), `imperative without a command: ${line}`).not.toBeNull();
    }
  });
});

// ===========================================================================
// AC-STE-530.3 — two distinct refusals, neither built from the pass's parts.
// ===========================================================================

describe("AC-STE-530.3 — the refusals are distinct sentences, not relabelled passes", () => {
  test("`incomparable` does not render as a pass", async () => {
    const mod = await loadSkipBaseline();

    // Measured today: `incomparable` falls through the renderer's `default:`
    // and comes out as `skips: pass — 5 now vs null at the branch point`.
    for (const one of incomparableCases(mod)) {
      expect(one.line.toLowerCase(), `cause ${one.cause}`).not.toContain("pass");
      expect(one.line.toLowerCase()).toContain("incomparable");
    }
  });

  test("unmeasured and incomparable are different sentences with different remedies", async () => {
    const mod = await loadSkipBaseline();

    const unmeasured = mod.renderSkipVerdict(mod.classifySkipDelta(null, 5));
    for (const one of incomparableCases(mod)) {
      expect(one.line, `cause ${one.cause}`).not.toBe(unmeasured);
      expect(extractCommand(one.line)?.command).not.toBe(undefined);
    }
  });

  test("neither refusal is assembled from measuredAgainstBaseline", async () => {
    const mod = await loadSkipBaseline();
    const field = discoverCauseField(SKIP_BASELINE_FILE);

    // Deliberately misleading numbers on a verdict that has no comparison to
    // report. A refusal built out of the measured clause leaks them.
    const misleading = { baseline: 42, current: 5, delta: 77 };
    const lines = [
      mod.renderSkipVerdict({ outcome: "unmeasured", ...misleading } as SkipVerdictShape),
      ...discoverCauses(mod).map((cause) =>
        mod.renderSkipVerdict({
          outcome: "incomparable",
          ...misleading,
          [field]: cause,
        } as SkipVerdictShape),
      ),
    ];

    for (const line of lines) {
      // The exact shape `measuredAgainstBaseline` produces.
      expect(line).not.toContain(" now vs ");
      expect(line).not.toContain("at the branch point (delta ");
      // And the numbers it would have carried.
      expect(line).not.toContain("42");
      expect(line).not.toContain("77");
    }

    // The helper still exists and is still the thing the measured lines use —
    // otherwise the assertions above are about a function nobody calls.
    const source = read(SKIP_BASELINE_FILE);
    expect(source).toContain("function measuredAgainstBaseline");
    expect(mod.renderSkipVerdict(mod.classifySkipDelta(2, 5))).toContain(
      "at the branch point (delta ",
    );
  });
});

// ===========================================================================
// AC-STE-530.4 — the step-14 consumer refuses on `incomparable`.
//
// The REAL renderer is driven: a copy of the shipped `deliver_stage_evidence.ts`
// is re-wired to a stubbed verdict source and imported, so the code under test
// is the shipped file's own body. `mutateInRegion` aborts if either import
// anchor is absent, so a re-wiring that silently missed cannot score.
// ===========================================================================

/** A real-shaped bun run: 14 tests, 12 passing, 2 skipped, 0 failing. */
const BUN_GATE_OUTPUT = [
  "tests/a.test.ts:",
  "  8 pass",
  "  1 skip",
  "tests/b.test.ts:",
  "  4 pass",
  "  1 skip",
  " 12 pass",
  "  2 skip",
  "  0 fail",
  "Ran 14 tests across 3 files. [412.00ms]",
].join("\n");

function gateInput(projectRoot: string): Record<string, unknown> {
  return {
    gate: { command: "bun test", output: BUN_GATE_OUTPUT, stack: "bun" },
    required: ["gate"],
    projectRoot,
    branch: "feat/m136-executable-remedy",
  };
}

/**
 * A copy of the shipped evidence renderer whose ONE verdict collaborator is
 * replaced by `verdictSource`. Everything else — the reason set, the counts,
 * the `ok` derivation — is the shipped body.
 */
async function loadEvidenceWithVerdict(
  label: string,
  verdictSource: string,
): Promise<EvidenceModule> {
  const dir = tempDir(`evidence-${label}`);

  const original = read(EVIDENCE_FILE);
  const step1 = mutateInRegion(
    original,
    0,
    original.length,
    'from "./skip_baseline"',
    'from "./stub_skip_baseline"',
    { label: "the skip_baseline import of deliver_stage_evidence.ts" },
  );
  const step2 = mutateInRegion(
    step1,
    0,
    step1.length,
    'from "./test_count_parser"',
    `from ${JSON.stringify(TEST_COUNT_PARSER_FILE)}`,
    { label: "the test_count_parser import of deliver_stage_evidence.ts" },
  );

  // The stub supersedes the VERDICT SOURCE and nothing else. It re-exports the
  // shipped renderer and its type verbatim, so the consumer's named import
  // links exactly as it does in production.
  //
  // This re-export is load-bearing, not tidiness. Without it the consumer had
  // to guard `renderSkipVerdict` as possibly-undefined, and that guard was a
  // fail-open branch living in production solely so THIS stub could load: it
  // turned a link-time failure into a silently missing remedy, and it made
  // these AC.4 legs structurally unable to notice an AC-STE-530.2 regression,
  // because the remedy they rendered was always the empty string.
  writeFileSync(
    join(dir, "stub_skip_baseline.ts"),
    `${verdictSource}\n` +
      `export { renderSkipVerdict, COUNT_ONLY_NOTE } from ${JSON.stringify(SKIP_BASELINE_FILE)};\n` +
      `export type { SkipVerdict } from ${JSON.stringify(SKIP_BASELINE_FILE)};\n`,
  );
  const file = join(dir, "deliver_stage_evidence.ts");
  writeFileSync(file, step2);

  return (await import(file)) as unknown as EvidenceModule;
}

describe("AC-STE-530.4 — `incomparable` is a refusal ground in the fence consumer", () => {
  test("CONTROL: the same copy reports ok on a measured pass", async () => {
    const mod = await loadEvidenceWithVerdict(
      "control",
      [
        // TWO arguments — the shipped arity since M136 / STE-527 re-keyed the
        // store to the trunk commit. A three-parameter stub still LOADS, but
        // the consumer calls it with two, so `current` binds to nothing and the
        // verdict carries `baseline: undefined, current: undefined`. Both legs
        // here would stay green on that shape while certifying a verdict
        // neither of them describes.
        "export function evaluateSkipDelta(projectRoot: string, current: number) {",
        "  void projectRoot;",
        '  return { outcome: "pass", baseline: current, current, delta: 0 };',
        "}",
      ].join("\n"),
    );

    const result = mod.renderStageEvidence(gateInput(tempDir("control-root")));

    // The stub's ARITY reached the consumer. A stub declaring one parameter too
    // many still loads, but `current` then binds to nothing and every derived
    // number comes out `undefined` — and the two assertions below, which look
    // only at `reasons` and `ok`, would not notice. Asserting the number here is
    // what makes this leg sensitive to the shape it is supposed to be modelling.
    const gateCounts = result.counts.gate as EvidenceCountsShape | null;
    expect(gateCounts, "the gate section produced no counts at all").not.toBeNull();
    const counts = gateCounts as EvidenceCountsShape;
    // The stub returns `baseline: current`, and the consumer passes it the skip
    // count it derived from the capture — so a correctly-arity'd stub makes
    // `baseline` equal `skip`. Under a stub with one parameter too many the
    // argument binds to nothing and `baseline` arrives `undefined`.
    expect(typeof counts.baseline, "the verdict's baseline never arrived").toBe("number");
    expect(counts.baseline).toBe(counts.skip);

    // Without this leg, "the copy refuses" and "incomparable was routed" are
    // the same observation.
    expect(result.reasons).toEqual([]);
    expect(result.ok).toBe(true);
  });

  test("an incomparable verdict refuses the block with its OWN reason line", async () => {
    const skip = await loadSkipBaseline();
    const field = discoverCauseField(SKIP_BASELINE_FILE);
    const cause = discoverCauses(skip)[0] as string;

    // The unmeasured reason set, produced by the SHIPPED module against a
    // project root that has no baseline at all.
    const shipped = (await import(
      "../adapters/_shared/src/deliver_stage_evidence"
    )) as unknown as EvidenceModule;
    const unmeasured = shipped.renderStageEvidence(gateInput(tempDir("unmeasured-root")));
    expect(unmeasured.ok).toBe(false);
    expect(unmeasured.reasons.length).toBeGreaterThan(0);

    const mod = await loadEvidenceWithVerdict(
      "incomparable",
      [
        "export function evaluateSkipDelta(projectRoot: string, current: number) {",
        "  void projectRoot;",
        "  return {",
        '    outcome: "incomparable",',
        "    baseline: null,",
        "    current,",
        "    delta: null,",
        `    ${field}: ${JSON.stringify(cause)},`,
        "  };",
        "}",
      ].join("\n"),
    );

    const result = mod.renderStageEvidence(gateInput(tempDir("incomparable-root")));

    // Refused through the refusal SET, not asserted on a string in isolation:
    // a reason produced but never reaching `reasons` is the fail-open half.
    expect(result.ok).toBe(false);
    const gateReasons = result.reasons.filter((reason) => reason.startsWith("`gate`"));
    expect(gateReasons.length).toBeGreaterThan(0);

    // ITS OWN line — distinct from the unmeasured one, which is the branch it
    // would otherwise be folded into.
    for (const reason of gateReasons) {
      expect(unmeasured.reasons).not.toContain(reason);
    }
    expect(gateReasons.some((reason) => /incomparable/i.test(reason))).toBe(true);

    // Same arity guard as the CONTROL leg, from the other side: a stub with one
    // parameter too many renders "the undefined skip(s) seen here", and every
    // assertion above still passes. A refusal that reports `undefined` where a
    // count belongs has not been certified by anything.
    for (const reason of gateReasons) {
      expect(reason, "a count came through as `undefined`").not.toContain("undefined");
    }
  });
});

// ===========================================================================
// AC-STE-530.5 — the remedy is EXECUTED, and a record lands on disk.
// ===========================================================================

describe("AC-STE-530.5 — the remedy is executable, not merely present", () => {
  test("running the unmeasured line's command writes a baseline record", async () => {
    const mod = await loadSkipBaseline();
    const line = mod.renderSkipVerdict(mod.classifySkipDelta(null, 5));

    const outcome = runRemedy(line, "unmeasured");
    expect(outcome.ok, outcome.why).toBe(true);
  });

  test("the capture entry point the remedy names really exists", () => {
    // Named separately so a failure says WHICH half is missing: the remedy has
    // no command, or the command points at nothing.
    const entry = join(SHARED_SRC, "capture_skip_baseline.ts");
    expect(existsSync(entry), `${entry} is what the remedy runs`).toBe(true);
    expect(read(entry)).toContain("import.meta.main");
  });
});

// ===========================================================================
// AC-STE-530.6 — AC.5 is mutation-verified, twice, with the clause named.
// ===========================================================================

describe("AC-STE-530.6 — the executable assertion is falsifiable", () => {
  test("MUTATION 1: the command replaced by prose turns AC.5 red", async () => {
    const mod = await loadSkipBaseline();
    const line = mod.renderSkipVerdict(mod.classifySkipDelta(null, 5));

    const span = extractCommand(line);
    expect(span, `no command to mutate in ${JSON.stringify(line)}`).not.toBeNull();
    const { start, end, command } = span as CommandSpan;

    // Today's shipped wording, put back where the command now stands.
    const PROSE = "capture a baseline at the branch point";
    const mutant = mutateInRegion(line, start, end, `\`${command}\``, PROSE, {
      label: "the remedy clause of the unmeasured line",
    });

    // THE MUTATION APPLIED — named by the clause it changed, measured not assumed.
    expect(mutant).not.toBe(line);
    expect(mutant).toContain(PROSE);
    expect(mutant, `the command clause \`${command}\` survived the mutation`).not.toContain(
      command,
    );

    const outcome = runRemedy(mutant, "prose-mutant");
    expect(outcome.ok, `the prose mutant was accepted: ${outcome.why}`).toBe(false);
  });

  test("MUTATION 2: a wrong path passes a substring match and fails execution", async () => {
    const mod = await loadSkipBaseline();
    const line = mod.renderSkipVerdict(mod.classifySkipDelta(null, 5));

    const span = extractCommand(line);
    expect(span, `no command to mutate in ${JSON.stringify(line)}`).not.toBeNull();
    const { start, end, command } = span as CommandSpan;

    const tokens = command.trim().split(/\s+/);
    const target = tokens[tokens.length - 1] as string;
    const wrong = `${target}-nope-does-not-exist`;
    const mutated = `${tokens.slice(0, -1).join(" ")} ${wrong}`.trim();

    const mutant = mutateInRegion(line, start, end, `\`${command}\``, `\`${mutated}\``, {
      label: "the remedy command's last token in the unmeasured line",
    });

    // THE MUTATION APPLIED, and the clause it changed is named.
    expect(mutant).not.toBe(line);
    expect(mutant, `the mutated token ${wrong} did not land`).toContain(wrong);

    // THE WHOLE POINT: a substring match cannot tell the two apart. The
    // wrong-path mutant still CONTAINS the correct command's every token.
    for (const token of tokens) {
      expect(mutant, `substring match on ${token} still passes on the mutant`).toContain(token);
    }

    const outcome = runRemedy(mutant, "wrong-path-mutant");
    expect(outcome.ok, `the wrong-path mutant was accepted: ${outcome.why}`).toBe(false);
  });
});

// ===========================================================================
// AC-STE-530.7 — the two MEASURED renderings, pinned byte-wise.
//
// Captured by running the shipped module while writing this file. Not retyped
// from the FR, so the pin cannot record a typo as the contract.
// ===========================================================================

const SHIPPED_MEASURED_LINES: ReadonlyArray<[number, number, string]> = [
  [2, 5, "skips: FAIL — 5 now vs 2 at the branch point (delta +3)"],
  [0, 1, "skips: FAIL — 1 now vs 0 at the branch point (delta +1)"],
  [4, 4, "skips: pass — 4 now vs 4 at the branch point (delta 0)"],
  [6, 1, "skips: pass — 1 now vs 6 at the branch point (delta -5)"],
  [9, 8, "skips: pass — 8 now vs 9 at the branch point (delta -1)"],
];

describe("AC-STE-530.7 — `pass` and `fail` keep their exact wording and arithmetic", () => {
  test("every measured rendering is byte-identical to the shipped literal", async () => {
    const mod = await loadSkipBaseline();

    for (const [baseline, current, expected] of SHIPPED_MEASURED_LINES) {
      expect(
        mod.renderSkipVerdict(mod.classifySkipDelta(baseline, current)),
        `render(${baseline} → ${current})`,
      ).toBe(expected);
    }
  });

  test("the arithmetic behind those lines is unchanged", async () => {
    const mod = await loadSkipBaseline();

    expect(mod.classifySkipDelta(2, 5)).toEqual({
      outcome: "fail",
      baseline: 2,
      current: 5,
      delta: 3,
    } as unknown as SkipVerdictShape);
    expect(mod.classifySkipDelta(4, 4).outcome).toBe("pass");
    expect(mod.classifySkipDelta(4, 4).delta).toBe(0);
    expect(mod.classifySkipDelta(6, 1).outcome).toBe("pass");
    expect(mod.classifySkipDelta(6, 1).delta).toBe(-5);
  });
});

// ===========================================================================
// AC-STE-530.8 — the two conditions do not share one line.
// ===========================================================================

describe("AC-STE-530.8 — each incomparable condition names itself", () => {
  test("the causes render as pairwise distinct lines", async () => {
    const mod = await loadSkipBaseline();
    const cases = incomparableCases(mod);

    const lines = cases.map((one) => one.line);
    expect(new Set(lines).size, `causes collapsed onto one line: ${lines.join(" | ")}`).toBe(
      lines.length,
    );
  });

  test("the checkout condition and the names condition carry different remedies", async () => {
    const mod = await loadSkipBaseline();
    const cases = incomparableCases(mod);

    // A foreign checkout: re-measure HERE.
    const checkout = cases.filter((one) => /checkout/i.test(one.line));
    // A named baseline meeting an unnamed run: re-run the gate so it NAMES its skips.
    const named = cases.filter((one) => /\bunnamed\b|\bnames?\b|\bnamed\b/i.test(one.line));

    expect(checkout.length, "no incomparable line names the checkout condition").toBeGreaterThan(
      0,
    );
    expect(named.length, "no incomparable line names the naming condition").toBeGreaterThan(0);

    const a = checkout[0] as IncomparableCase;
    const b = named.find((one) => one.line !== a.line) as IncomparableCase | undefined;
    expect(b, "the two conditions share one line").not.toBe(undefined);

    const commandA = extractCommand(a.line);
    const commandB = extractCommand((b as IncomparableCase).line);
    expect(commandA).not.toBeNull();
    expect(commandB).not.toBeNull();

    // A shared remedy would be wrong on one of the two causes.
    expect((commandA as CommandSpan).command).not.toBe((commandB as CommandSpan).command);
  });
});

// ===========================================================================
// Teardown — nothing this file created outlives the run.
// ===========================================================================

describe("housekeeping", () => {
  test("temporary trees are removed", () => {
    cleanupTempDirs();
    expect(TEMP_DIRS.length).toBe(0);
  });
});

// ===========================================================================
// AUDIT RETRY — the two gaps the milestone-level review found on this FR.
//
// GAP 1 (HIGH), against AC-STE-530.2. `renderSkipVerdict` has ZERO production
// callers: repo-wide it is referenced only from this file and from the STE-509
// suite. So every copy-pasteable command the FR added lives on a surface no
// reader reaches. The non-pass text a reader ACTUALLY meets on a shipped path
// is the `gate:` reason set of `deliver_stage_evidence.renderStageEvidence`,
// and today not one of those lines carries a command.
//
//   "EVERY non-pass rendering carries a copy-pasteable command line" is
//   therefore only half satisfied: it holds on the renderer nobody calls and
//   fails on the renderer everybody reads.
//
// The legs below assert it where the reader stands, and — this is the half that
// stops the two drifting apart — assert that the command in the reader-facing
// line is the SAME STRING the corresponding `renderSkipVerdict` line carries.
// HOW that is achieved is the implementer's choice; that they are one spelling
// is the contract, and the mutation leg further down proves the reader-facing
// line really follows `skip_baseline`'s spelling rather than agreeing with it
// by coincidence.
//
// GAP 2 (MED), against AC-STE-530.8. Both AC.8 legs above filter the rendered
// SET by keyword, so swapping the two `switch` arms of `incomparableLine`
// leaves the set byte-identical and both legs green. Nothing pins WHICH cause
// produces WHICH line. The leg below binds each cause to its own remedy BY
// NAME — the foreign-checkout cause re-measures here, the unnamed-run cause
// re-runs the gate — and the mutation leg executes the arm swap and asserts the
// pin goes red, with a CONTROL on the unmutated copy so a pin that is red for
// unrelated reasons cannot score as falsifiable.
// ===========================================================================

const DPT_PATHS_SRC = join(SHARED_SRC, "dpt_paths.ts");

/** The env key the stubbed verdict source reads its cause from. */
const STUB_CAUSE_ENV = "STE530_STUB_CAUSE";

/** Every backtick-delimited span of a line, as plain strings. */
function backtickedSpans(line: string): string[] {
  return commandSpans(line).map((span) => span.command);
}

/** The one command a `renderSkipVerdict` refusal line carries. */
function commandOf(line: string): string {
  const span = extractCommand(line);
  expect(span, `no single backticked command in ${JSON.stringify(line)}`).not.toBeNull();
  return (span as CommandSpan).command;
}

/**
 * The spans of a reader-facing reason line that are candidate COMMANDS — i.e.
 * everything except the fence section label the line opens on. `gate` is the
 * shipped section name, and it is already backticked in every reason.
 */
function commandSpansOfReason(reason: string): string[] {
  return backtickedSpans(reason).filter((span) => !EVIDENCE_SECTIONS_NAMES.includes(span));
}

const EVIDENCE_SECTIONS_NAMES = ["gate", "drive", "e2e"];

// ---------------------------------------------------------------------------
// GAP 1 — the reader-facing surface, driven through the SHIPPED renderer.
// ---------------------------------------------------------------------------

/** The `gate:` refusal reasons of a rendered stage-evidence result. */
function gateReasons(reasons: readonly string[]): string[] {
  return reasons.filter((reason) => reason.startsWith("`gate`"));
}

describe("AC-STE-530.2 (audit) — the command reaches the line the reader meets", () => {
  test("the unmeasured gate reason carries the same command the verdict line does", async () => {
    const skip = await loadSkipBaseline();

    // The command the FR shipped, taken from the renderer that carries it.
    const expected = commandOf(skip.renderSkipVerdict(skip.classifySkipDelta(null, 2)));
    expect(expected, "the extracted span is a command, not the fence's section label").not.toBe(
      "gate",
    );

    // A REAL unmeasured verdict: the shipped consumer, a project root with no
    // baseline at all, and the shipped `evaluateSkipDelta` in between. No stub.
    const shipped = (await import(
      "../adapters/_shared/src/deliver_stage_evidence"
    )) as unknown as EvidenceModule;
    const result = shipped.renderStageEvidence(gateInput(tempDir("audit-unmeasured-root")));

    expect(result.ok).toBe(false);
    const unmeasured = gateReasons(result.reasons).filter((reason) => /unmeasured/i.test(reason));
    expect(
      unmeasured.length,
      `expected one unmeasured gate reason, got ${JSON.stringify(result.reasons)}`,
    ).toBe(1);

    const reason = unmeasured[0] as string;
    expect(
      commandSpansOfReason(reason),
      `the reader-facing unmeasured line hands over no command: ${JSON.stringify(reason)}`,
    ).toContain(expected);
  });

  test("the NO-ROOT unmeasured gate reason carries it too", async () => {
    // The second unmeasured reason the consumer can emit: no projectRoot and no
    // branch were supplied, so there was nothing to look a baseline up with.
    // The leg above drives `gateInput(root)`, which always supplies both, so it
    // can never reach this branch — deleting `remedyClause` from here alone left
    // the whole suite green, which is why this pin exists.
    const skip = await loadSkipBaseline();
    const expected = commandOf(skip.renderSkipVerdict(skip.classifySkipDelta(null, 2)));

    const shipped = (await import(
      "../adapters/_shared/src/deliver_stage_evidence"
    )) as unknown as EvidenceModule;
    const { projectRoot: _root, branch: _branch, ...noRoot } = gateInput(tempDir("audit-no-root"));
    const result = shipped.renderStageEvidence({ ...noRoot, required: ["gate"] });

    expect(result.ok).toBe(false);
    const unmeasured = gateReasons(result.reasons).filter((reason) => /unmeasured/i.test(reason));
    expect(
      unmeasured.length,
      `expected one unmeasured gate reason, got ${JSON.stringify(result.reasons)}`,
    ).toBe(1);

    const reason = unmeasured[0] as string;
    expect(
      reason,
      "this is the no-root branch, not the looked-up one",
    ).toContain("no project root and branch were supplied");
    expect(
      commandSpansOfReason(reason),
      `the reader-facing no-root unmeasured line hands over no command: ${JSON.stringify(reason)}`,
    ).toContain(expected);
  });
});

// ---------------------------------------------------------------------------
// The incomparable reader-facing surface.
//
// Production DOES yield `incomparable` now — STE-527 added the
// foreign-checkout and unknown-store-version grounds. It is still stubbed
// here so this leg can select a cause directly rather than staging a whole
// foreign checkout, and so it keeps covering causes whose producers land
// in a later FR.
// leg above does it, and for the same reason. What is NOT stubbed is the copy
// of `skip_baseline` the stub is grafted onto: it is the shipped file, byte for
// byte, with `evaluateSkipDelta` alone superseded. Every other export is the
// real one, so whatever the evidence renderer imports from it resolves, and the
// commands compared below come from the SAME module the reason line came from.
// (They cannot be compared against the installed module: the copy composes its
// capture entry point from its own directory, so the two spellings would differ
// for a reason that has nothing to do with this AC.)
// ---------------------------------------------------------------------------

interface ReaderSurface {
  /** `renderSkipVerdict` for one incomparable cause, from the copy. */
  readonly verdictFor: (cause: string) => string;
  /** The reader-facing `gate:` refusal reason for one incomparable cause. */
  readonly reasonFor: (cause: string) => string;
  /** The copy's own capture command — the re-measure remedy, one spelling. */
  readonly captureCommand: string;
}

/**
 * A copy of `skip_baseline.ts` whose `evaluateSkipDelta` is superseded by one
 * returning an `incomparable` verdict for the cause named in the environment.
 *
 * One copy serves BOTH causes, deliberately: a per-cause directory would give
 * each cause a different capture-entry path, and the cross-cause command
 * comparison below would then be comparing directories rather than remedies.
 */
/**
 * Every local module `skip_baseline.ts` imports, transitively, in copy order.
 *
 * A copy that is missing one of these does not fail loudly — the import throws
 * `Cannot find module` inside the leg and the leg simply goes red for a reason
 * that has nothing to do with its subject. That is what happened when
 * `skip_baseline.ts` gained `./branch_proposal` mid-milestone: three legs here
 * went red while the code they test was correct. The assertion below turns the
 * next such addition into a named failure instead of a mystery.
 */
const SKIP_BASELINE_LOCAL_DEPS = [
  "dpt_paths",
  "branch_proposal",
  "milestone_token",
  "ulid",
] as const;

/** Copy the dependency closure beside a stubbed `skip_baseline`, asserting each landed. */
function copySkipBaselineDeps(dir: string): void {
  for (const name of SKIP_BASELINE_LOCAL_DEPS) {
    const from = join(SHARED_SRC, `${name}.ts`);
    expect(existsSync(from), `dependency closure names a module that is not there: ${from}`).toBe(
      true,
    );
    copyFileSync(from, join(dir, `${name}.ts`));
  }
  // The closure must actually cover the module: any `from "./x"` in
  // skip_baseline.ts that is not in the list above would dangle.
  const declared = new Set<string>(SKIP_BASELINE_LOCAL_DEPS);
  const imported = [...read(SKIP_BASELINE_FILE).matchAll(/from "\.\/([\w-]+)"/g)].map((m) => m[1]);
  for (const name of imported) {
    expect(
      declared.has(name as string),
      `skip_baseline.ts imports "./${name}" but SKIP_BASELINE_LOCAL_DEPS does not list it — ` +
        "add it there, or this stub's legs go red for the wrong reason",
    ).toBe(true);
  }
}

function writeIncomparableStub(dir: string, source: string, field: string): string {
  copySkipBaselineDeps(dir);

  const superseded = mutateInRegion(
    source,
    0,
    source.length,
    "export function evaluateSkipDelta(",
    "function supersededEvaluateSkipDelta(",
    { label: "the evaluateSkipDelta declaration of skip_baseline.ts" },
  );
  expect(superseded).not.toBe(source);
  expect(superseded).toContain("function supersededEvaluateSkipDelta(");

  const stub = [
    superseded,
    "",
    "export function evaluateSkipDelta(",
    "  projectRoot: string,",
    "  branch: string,",
    "  current: number,",
    "): SkipVerdict {",
    "  void projectRoot;",
    "  void branch;",
    "  void supersededEvaluateSkipDelta;",
    "  return {",
    '    outcome: "incomparable",',
    "    baseline: null,",
    "    current,",
    "    delta: null,",
    `    ${field}: process.env[${JSON.stringify(STUB_CAUSE_ENV)}],`,
    "  } as unknown as SkipVerdict;",
    "}",
    "",
  ].join("\n");

  const file = join(dir, "skip_baseline.ts");
  writeFileSync(file, stub);
  return file;
}

/**
 * A copy of the shipped evidence renderer placed BESIDE a `skip_baseline.ts`,
 * so its own `./skip_baseline` import resolves to that file. Every OTHER
 * relative import is rewritten to the installed module by absolute path, and
 * each rewrite is asserted to have applied — a copy that silently kept a
 * dangling import would fail to load, but a copy that silently kept a REAL
 * import would run the wrong collaborator and report green.
 */
function writeEvidenceCopy(dir: string): string {
  const original = read(EVIDENCE_FILE);
  const relative = [
    ...new Set(
      [...original.matchAll(/from "\.\/([A-Za-z0-9_.\-/]+)"/g)].map((hit) => hit[1] as string),
    ),
  ];
  expect(relative, "deliver_stage_evidence.ts must still import ./skip_baseline").toContain(
    "skip_baseline",
  );

  let out = original;
  for (const name of relative) {
    if (name === "skip_baseline") continue;
    const anchor = `from "./${name}"`;
    const absolute = `from ${JSON.stringify(join(SHARED_SRC, `${name}.ts`))}`;
    const before = out.split(anchor).length - 1;
    expect(before, `nothing to rewire for ${anchor}`).toBeGreaterThan(0);
    out = out.split(anchor).join(absolute);
    expect(out, `${anchor} survived the rewiring`).not.toContain(anchor);
  }

  const file = join(dir, "deliver_stage_evidence.ts");
  writeFileSync(file, out);
  return file;
}

async function readerSurface(label: string, skipBaselineSource: string): Promise<ReaderSurface> {
  const field = discoverCauseField(SKIP_BASELINE_FILE);
  const dir = tempDir(`reader-${label}`);
  const stubFile = writeIncomparableStub(dir, skipBaselineSource, field);
  const evidenceFile = writeEvidenceCopy(dir);

  const copy = (await import(stubFile)) as unknown as SkipBaselineModule;
  const evidence = (await import(evidenceFile)) as unknown as EvidenceModule;
  const root = tempDir(`reader-root-${label}`);

  return {
    captureCommand: commandOf(copy.renderSkipVerdict(copy.classifySkipDelta(null, 2))),
    verdictFor: (cause) =>
      copy.renderSkipVerdict({
        outcome: "incomparable",
        baseline: null,
        current: 2,
        delta: null,
        [field]: cause,
      } as SkipVerdictShape),
    reasonFor: (cause) => {
      process.env[STUB_CAUSE_ENV] = cause;
      const result = evidence.renderStageEvidence(gateInput(root));
      expect(result.ok, `an incomparable gate verdict did not refuse (${cause})`).toBe(false);
      const own = gateReasons(result.reasons).filter((reason) => /incomparable/i.test(reason));
      expect(
        own.length,
        `expected one incomparable gate reason for ${cause}, got ${JSON.stringify(result.reasons)}`,
      ).toBe(1);
      return own[0] as string;
    },
  };
}

describe("AC-STE-530.2 (audit) — every incomparable cause reaches the reader with a command", () => {
  test("each cause's gate reason carries that cause's own verdict-line command", async () => {
    const skip = await loadSkipBaseline();
    const causes = discoverCauses(skip);
    const surface = await readerSurface("gap1", read(SKIP_BASELINE_FILE));

    for (const cause of causes) {
      const expected = commandOf(surface.verdictFor(cause));
      const reason = surface.reasonFor(cause);

      // ONE SPELLING. Not "a command is present" — the SAME string, so a later
      // edit to either surface cannot leave the reader holding the other one's
      // remedy, and cannot leave them holding a second, drifted spelling.
      expect(
        commandSpansOfReason(reason),
        `cause ${cause}: the reader-facing line does not carry the verdict line's ` +
          `command \`${expected}\` — ${JSON.stringify(reason)}`,
      ).toContain(expected);
    }

    expect(causes.length, "the loop above must have covered both causes").toBeGreaterThanOrEqual(
      2,
    );
  });
});

// ---------------------------------------------------------------------------
// GAP 2 — WHICH cause produces WHICH line, asserted per cause.
// ---------------------------------------------------------------------------

interface CauseBinding {
  /** The cause a foreign checkout raises: the remedy is to re-measure HERE. */
  readonly checkout: string;
  /** The cause an unnamed run raises: the remedy is to re-run the gate. */
  readonly unnamedRun: string;
}

/**
 * Pick each cause BY NAME out of the discovered vocabulary, so every assertion
 * below is bound to its own cause rather than to the rendered set. Filtering
 * the set by keyword — what the two AC.8 legs above do — is satisfied by a
 * swapped pair, which is the gap this section closes.
 */
function causeBinding(causes: readonly string[]): CauseBinding {
  const checkout = causes.find((cause) => /checkout/i.test(cause));
  const unnamedRun = causes.find((cause) => cause !== checkout && /run|named/i.test(cause));

  expect(checkout, `no cause names the foreign-checkout condition: ${causes.join(", ")}`).not.toBe(
    undefined,
  );
  expect(unnamedRun, `no cause names the unnamed-run condition: ${causes.join(", ")}`).not.toBe(
    undefined,
  );

  return { checkout: checkout as string, unnamedRun: unnamedRun as string };
}

/**
 * The binding contract, as one callable, so the SAME predicate can be run
 * against the renderer, against the reader-facing line, against an unmutated
 * copy and against a mutant. Returns every violation rather than throwing on
 * the first, so a failure names all of what broke.
 *
 * `captureCommand` is the re-measure remedy AS THAT SURFACE SPELLS IT — read
 * from the same module the lines came from, never from a literal here.
 */
function bindingViolations(
  lineFor: (cause: string) => string,
  binding: CauseBinding,
  captureCommand: string,
  label: string,
): string[] {
  const out: string[] = [];
  const checkoutLine = lineFor(binding.checkout);
  const unnamedLine = lineFor(binding.unnamedRun);
  const say = (why: string, line: string): void => {
    out.push(`[${label}] ${why}: ${JSON.stringify(line)}`);
  };

  if (checkoutLine === unnamedLine) {
    say("the two causes share ONE line", checkoutLine);
  }

  // The foreign-checkout cause: names the CHECKOUT condition, and re-measures.
  if (!/checkout/i.test(checkoutLine)) {
    say(`the ${binding.checkout} cause does not name the checkout condition`, checkoutLine);
  }
  if (!commandSpansOfReason(checkoutLine).includes(captureCommand)) {
    say(
      `the ${binding.checkout} cause does not hand over the re-measure command ` +
        `\`${captureCommand}\``,
      checkoutLine,
    );
  }

  // The unnamed-run cause: names the RUN's missing count, and re-runs the gate.
  // Re-measuring here is the wrong remedy for it — the baseline is fine.
  if (/checkout/i.test(unnamedLine)) {
    say(`the ${binding.unnamedRun} cause names the CHECKOUT condition instead`, unnamedLine);
  }
  if (!/no skip count|names its skips|unnamed/i.test(unnamedLine)) {
    say(`the ${binding.unnamedRun} cause does not name the unnamed-run condition`, unnamedLine);
  }
  if (commandSpansOfReason(unnamedLine).includes(captureCommand)) {
    say(
      `the ${binding.unnamedRun} cause hands over the RE-MEASURE command, which is ` +
        "the wrong remedy for a baseline that is not the problem",
      unnamedLine,
    );
  }
  if (commandSpansOfReason(unnamedLine).length === 0) {
    say(`the ${binding.unnamedRun} cause hands over no command at all`, unnamedLine);
  }

  return out;
}

describe("AC-STE-530.8 (audit) — each cause is bound to its OWN remedy", () => {
  test("the binding holds on the renderer AND on the line the reader meets", async () => {
    const skip = await loadSkipBaseline();
    const field = discoverCauseField(SKIP_BASELINE_FILE);
    const binding = causeBinding(discoverCauses(skip));

    // Half one — `renderSkipVerdict`, per cause, not per filtered set.
    const shippedCapture = commandOf(skip.renderSkipVerdict(skip.classifySkipDelta(null, 2)));
    const shippedLine = (cause: string): string =>
      skip.renderSkipVerdict({
        outcome: "incomparable",
        baseline: null,
        current: 2,
        delta: null,
        [field]: cause,
      } as SkipVerdictShape);

    expect(bindingViolations(shippedLine, binding, shippedCapture, "renderSkipVerdict")).toEqual(
      [],
    );

    // Half two — the same binding, on the surface a reader actually reaches.
    // A remedy bound correctly in a renderer nobody calls is bound nowhere.
    const surface = await readerSurface("gap2", read(SKIP_BASELINE_FILE));
    expect(
      bindingViolations(
        surface.reasonFor,
        binding,
        surface.captureCommand,
        "the reader-facing gate reason",
      ),
    ).toEqual([]);
  });
});

/**
 * Swap the two cause literals throughout the module — which swaps the arms of
 * whatever dispatches on them, be it a `switch`, a lookup table or an if-chain.
 * Structure-agnostic on purpose: a mutation anchored on `case "..."` stops
 * applying the moment the dispatch is refactored, and a mutation that stops
 * applying reports GREEN having proved nothing (M121 § 0k(m)).
 */
function swapCauseArms(source: string, binding: CauseBinding): string {
  const a = JSON.stringify(binding.checkout);
  const b = JSON.stringify(binding.unnamedRun);
  const parked = '"__ste530-swap-in-flight__"';

  const countA = source.split(a).length - 1;
  const countB = source.split(b).length - 1;
  expect(countA, `no ${a} literal to swap`).toBeGreaterThan(0);
  expect(countB, `no ${b} literal to swap`).toBeGreaterThan(0);
  expect(source, "the parking literal must not already occur").not.toContain(parked);

  const out = source.split(a).join(parked).split(b).join(a).split(parked).join(b);

  // THE MUTATION APPLIED — every occurrence of each literal traded places.
  expect(out).not.toBe(source);
  expect(out.split(a).length - 1, `the ${a} literals did not all move`).toBe(countB);
  expect(out.split(b).length - 1, `the ${b} literals did not all move`).toBe(countA);
  expect(out, "the parking literal survived the swap").not.toContain(parked);

  return out;
}

describe("AC-STE-530.8 (audit) — the binding pin is falsifiable", () => {
  test("MUTATION: swapping the two cause arms turns the binding red, reader-facing included", async () => {
    const skip = await loadSkipBaseline();
    const binding = causeBinding(discoverCauses(skip));
    const source = read(SKIP_BASELINE_FILE);

    // CONTROL. The unmutated copy, driven through the very same machinery,
    // satisfies the binding. Without this the mutant's redness proves only that
    // the machinery is red — which it would be for a copy that failed to load.
    const pristine = await readerSurface("pristine", source);
    expect(
      bindingViolations(
        pristine.reasonFor,
        binding,
        pristine.captureCommand,
        "the unmutated copy",
      ),
      "CONTROL failed: the binding does not hold on an unmutated copy, so the " +
        "mutant below cannot demonstrate anything",
    ).toEqual([]);

    const mutant = await readerSurface("swapped", swapCauseArms(source, binding));

    // THE MUTATION REACHED THE RENDERING — named by the clause it changed.
    // A swap that never made it out of the source file is a swap that proves
    // nothing, and it looks identical to one that did.
    expect(
      mutant.verdictFor(binding.checkout),
      `the arm swap did not change what the ${binding.checkout} cause renders`,
    ).not.toBe(pristine.verdictFor(binding.checkout));
    expect(
      mutant.reasonFor(binding.checkout),
      `the arm swap did not reach the reader-facing line for ${binding.checkout} — ` +
        "the two surfaces are not one spelling",
    ).not.toBe(pristine.reasonFor(binding.checkout));

    expect(
      bindingViolations(mutant.reasonFor, binding, mutant.captureCommand, "the arm-swapped mutant")
        .length,
      "the arm swap left the binding green — the pin cannot fail, so it pins nothing",
    ).toBeGreaterThan(0);
  });
});

// ===========================================================================
// Teardown for the appended legs. The housekeeping test above ran before any
// of them existed, so its `TEMP_DIRS.length === 0` was true when it asserted it
// and says nothing about the trees created since.
// ===========================================================================

describe("housekeeping (audit legs)", () => {
  test("the trees the audit legs created are removed too", () => {
    delete process.env[STUB_CAUSE_ENV];
    cleanupTempDirs();
    expect(TEMP_DIRS.length).toBe(0);
  });
});
