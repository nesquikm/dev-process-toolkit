// M116 STE-422 — pass `projectRoot` to the Phase 8 assert runner.
//
// WHAT IS BROKEN. `adapters/_shared/src/socratic_first_turn_assert.ts` takes an
// OPTIONAL third CLI argument — the project root — and documents it in its own
// usage string. When supplied, `assertFirstTurnShape` skips scaffold writes that
// land OUTSIDE that root (STE-399 AC-STE-399.3/.4). When omitted it is
// deliberately conservative: ANY early Write/Edit/NotebookEdit is a violation.
//
// `.claude/skills/smoke-test/SKILL.md`'s Phase 8 reference snippet calls the
// runner with TWO arguments. Because a Phase 8 violation is specified to
// hard-fail the whole smoke run, the documented command manufactures run-killing
// false alarms against skills that behaved correctly — the operator's global
// instructions mandate an out-of-project write at the top of nearly every
// response, so the miss fires on nearly every child (see STE-427).
//
// THE TEST STRATEGY, and why it is not a tautology. Every verdict assertion below
// replays a recorded transcript through the arguments THE SKILL ACTUALLY
// DOCUMENTS, parsed out of `.claude/skills/smoke-test/SKILL.md` at test time.
// That is the literal wording of AC-STE-422.2/.3 ("under the documented
// invocation" / "under the same invocation") and it is what makes those tests
// RED today: the documented invocation supplies no project root at all, so
// `/brainstorm` scores `violation` where the contract wants `ok-refused`.
// Asserting `verdictFor(..., { projectRoot })` directly would have been green
// before and after the fix — it would test the helper, which is not broken,
// instead of the snippet, which is.
//
// FIXTURE POLICY. The source captures
// `tests/fixtures/socratic-first-turn/<skill>-2026-07-27.json` are
// multi-hundred-KB run artifacts and are deliberately NOT committed. What is
// committed is a minimal DERIVED reproducer per skill under `regression/`:
// the prefix of assistant events up to and including the decisive entry, with
// text bodies truncated and tool inputs stripped to the scaffold `file_path`
// the projectRoot scope check reads. `describe("fixture equivalence")` below
// pins the derivation forever — whenever the untracked full capture IS present
// it must produce a byte-identical verdict line and exit code to the derived
// fixture, both with and without the project root (four combinations per skill).
// Those tests skip, loudly named, when the capture is absent.
//
// `.claude/skills/smoke-test/SKILL.md` lives OUTSIDE `plugins/dev-process-toolkit`
// and therefore carries no line cap and no STE-N token ceiling; ticket ids may be
// cited freely there and here.

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import {
  type AssertVerdict,
  verdictFor,
} from "../adapters/_shared/src/socratic_first_turn_assert";
import { parseStreamJsonTranscript } from "../adapters/_shared/src/socratic_first_turn_stream";
import type { TranscriptEntry } from "../adapters/_shared/src/socratic_first_turn";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");

// Repo-root-relative: a sweep scoped to PLUGIN_ROOT cannot see `.claude/skills/`.
const SMOKE_SKILL_PATH = join(
  REPO_ROOT,
  ".claude",
  "skills",
  "smoke-test",
  "SKILL.md",
);

const CAPTURE_DIR = join(
  PLUGIN_ROOT,
  "tests",
  "fixtures",
  "socratic-first-turn",
);
const REGRESSION_DIR = join(CAPTURE_DIR, "regression");

const CAPTURE_DATE = "2026-07-27";

const derivedFixture = (skill: string) =>
  join(REGRESSION_DIR, `${skill}-${CAPTURE_DATE}.json`);
const fullCapture = (skill: string) =>
  join(CAPTURE_DIR, `${skill}-${CAPTURE_DATE}.json`);

function transcriptOf(path: string): TranscriptEntry[] {
  return parseStreamJsonTranscript(readFileSync(path, "utf-8"));
}

// ===========================================================================
// The recorded project root — derived from committed bytes, never from disk.
// ===========================================================================

/**
 * The 2026-07-27 conformance run's Linear leg scaffolded into
 * `../dpt-test-project-linear`. This constant is NOT hard-coded to the
 * capturing operator's machine and never touches the live filesystem: the
 * `/setup` transcript's decisive in-project scaffold is `<root>/CLAUDE.md`, so
 * the root is that entry's `dirname`, read out of the committed fixture.
 */
function capturedProjectRoot(): string {
  const entry = transcriptOf(derivedFixture("setup")).find(
    (e) =>
      e.type === "tool_use" &&
      typeof e.path === "string" &&
      basename(e.path) === "CLAUDE.md",
  );
  if (!entry?.path) {
    throw new Error(
      "STE-422: cannot derive the captured project root — the committed " +
        "`regression/setup-2026-07-27.json` fixture no longer carries an " +
        "in-project `<root>/CLAUDE.md` scaffold entry.",
    );
  }
  return dirname(entry.path);
}

const CAPTURED_PROJECT_ROOT = capturedProjectRoot();

// ===========================================================================
// Reading the documented invocation out of the smoke SKILL.
// ===========================================================================

/** Collapse `\`-continued shell lines so the parse is whitespace-robust. */
function joinContinuations(text: string): string {
  return text.replace(/\\\r?\n[ \t]*/g, " ");
}

/** Split a shell argument list, honoring single and double quotes. */
function shellArgs(rest: string): string[] {
  const out: string[] = [];
  const re = /"(?:[^"\\]|\\.)*"|'[^']*'|[^\s]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rest)) !== null) {
    if (m[0].startsWith("#")) break; // trailing comment, not an argument
    out.push(m[0]);
  }
  return out;
}

interface RunnerInvocation {
  raw: string;
  args: string[];
}

/**
 * Every `bun <ASSERT_RUNNER> …` call site in `text`, with its argument list.
 * Tolerant of `"${ASSERT_RUNNER}"` / `"$ASSERT_RUNNER"` / bare `$ASSERT_RUNNER`
 * and of arbitrary horizontal whitespace; strict about what follows.
 */
function findRunnerInvocations(text: string): RunnerInvocation[] {
  const re = /\bbun\s+"?\$\{?ASSERT_RUNNER\}?"?([^\n]*)/g;
  const out: RunnerInvocation[] = [];
  let m: RegExpExecArray | null;
  const joined = joinContinuations(text);
  while ((m = re.exec(joined)) !== null) {
    out.push({ raw: m[0].trim(), args: shellArgs(m[1] ?? "") });
  }
  return out;
}

/** Fenced-code-block bodies, in document order. */
function fencedBlocks(body: string): string[] {
  const out: string[] = [];
  let inBlock = false;
  let buf: string[] = [];
  for (const line of body.split("\n")) {
    if (/^\s*```/.test(line)) {
      if (inBlock) {
        out.push(buf.join("\n"));
        buf = [];
      }
      inBlock = !inBlock;
      continue;
    }
    if (inBlock) buf.push(line);
  }
  return out;
}

function unquote(token: string): string {
  return token.replace(/^["']/, "").replace(/["']$/, "");
}

/**
 * True when `token` denotes one of the run's throwaway test projects — either
 * literally, or through up to three levels of shell-variable indirection
 * resolved against `body`. This is the substance of AC-STE-422.1: a third
 * argument that names something *else* is not "the resolved test-project path".
 */
function namesTestProjectPath(
  token: string,
  body: string,
  depth = 0,
): boolean {
  if (depth > 3) return false;
  const inner = unquote(token);
  if (inner.includes("dpt-test-project")) return true;
  const varName = /^\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?$/.exec(inner)?.[1];
  if (!varName) return false;
  const assignment = new RegExp(
    `^[ \\t]*(?:export[ \\t]+)?${varName}=(.+)$`,
    "m",
  ).exec(body)?.[1];
  if (!assignment) return false;
  return namesTestProjectPath(assignment.trim(), body, depth + 1);
}

const SMOKE_SKILL_BODY = readFileSync(SMOKE_SKILL_PATH, "utf-8");

function documentedInvocation(): RunnerInvocation {
  const calls = findRunnerInvocations(SMOKE_SKILL_BODY);
  if (calls.length !== 1) {
    throw new Error(
      `STE-422: expected exactly one assert-runner invocation in ` +
        `.claude/skills/smoke-test/SKILL.md, found ${calls.length}.`,
    );
  }
  return calls[0]!;
}

/**
 * The project root the DOCUMENTED Phase 8 invocation would hand the runner, or
 * `null` when it documents none. Bound to {@link CAPTURED_PROJECT_ROOT} only
 * after confirming the documented third argument really does name a
 * `dpt-test-project` path — the recorded leg's test project IS that path, so an
 * argument naming anything else must not be silently honored.
 */
function documentedProjectRoot(): string | null {
  const { args } = documentedInvocation();
  if (args.length < 3) return null;
  if (!namesTestProjectPath(args[2]!, SMOKE_SKILL_BODY)) return null;
  return CAPTURED_PROJECT_ROOT;
}

/** Replay a fixture through exactly the arguments the smoke SKILL documents. */
function replayUnderDocumentedInvocation(
  skill: string,
  fixturePath: string,
): AssertVerdict {
  const root = documentedProjectRoot();
  return verdictFor(
    skill,
    transcriptOf(fixturePath),
    root === null ? undefined : { projectRoot: root },
  );
}

// ===========================================================================
// The measured verdict table (FR STE-422 § Requirement), Linear leg 2026-07-27.
// ===========================================================================

interface TableRow {
  skill: string;
  without: AssertVerdict;
  withRoot: AssertVerdict;
}

const VERDICT_TABLE: readonly TableRow[] = [
  {
    skill: "brainstorm",
    without: { line: "brainstorm: violation tool=Write index=9", exitCode: 1 },
    withRoot: { line: "brainstorm: ok-refused askIndex=10", exitCode: 0 },
  },
  {
    skill: "report-issue",
    without: {
      line: "report-issue: violation tool=Write index=19",
      exitCode: 1,
    },
    withRoot: { line: "report-issue: vacuous askIndex=-1", exitCode: 3 },
  },
  {
    skill: "setup",
    without: { line: "setup: violation tool=Edit index=19", exitCode: 1 },
    withRoot: { line: "setup: violation tool=Edit index=19", exitCode: 1 },
  },
  {
    skill: "spec-write",
    without: { line: "spec-write: ok-refused askIndex=13", exitCode: 0 },
    withRoot: { line: "spec-write: ok-refused askIndex=13", exitCode: 0 },
  },
];

// ===========================================================================
// AC-STE-422.1 — the snippet passes the resolved test-project path.
// ===========================================================================

describe("AC-STE-422.1 — Phase 8 snippet passes the test-project path", () => {
  test("the runner invocation's third argument names the test project", () => {
    const { raw, args } = documentedInvocation();
    expect(args.length).toBeGreaterThanOrEqual(3);
    expect(namesTestProjectPath(args[2]!, SMOKE_SKILL_BODY)).toBe(true);
    // The added argument must be ADDITIVE — skill and fixture keep their slots.
    expect(unquote(args[0]!)).toMatch(/SKILL/);
    expect(unquote(args[1]!)).toMatch(/FIXTURE/);
    expect(raw).toContain("ASSERT_RUNNER");
  });

  test("the invocation lives in the Phase 8 driver-wrapper fenced block", () => {
    const wrapperBlocks = fencedBlocks(SMOKE_SKILL_BODY).filter((b) =>
      /^[ \t]*(?:export[ \t]+)?ASSERT_RUNNER=/m.test(b),
    );
    expect(wrapperBlocks).toHaveLength(1);
    const inBlock = findRunnerInvocations(wrapperBlocks[0]!);
    expect(inBlock).toHaveLength(1);
    expect(inBlock[0]!.args).toHaveLength(3);
  });

  test("the documented invocation therefore yields a project root", () => {
    expect(documentedProjectRoot()).toBe(CAPTURED_PROJECT_ROOT);
  });
});

// ===========================================================================
// AC-STE-422.2 — /brainstorm scores ok-refused under the documented invocation.
// ===========================================================================

describe("AC-STE-422.2 — /brainstorm 2026-07-27 scores ok-refused", () => {
  const row = VERDICT_TABLE.find((r) => r.skill === "brainstorm")!;

  test("the documented invocation supplies a project root at all", () => {
    // The whole defect, isolated: without this, the assertion below cannot
    // hold no matter how correct `/brainstorm` behaved.
    expect(documentedProjectRoot()).not.toBeNull();
  });

  test("scores ok-refused, NOT violation, under the documented invocation", () => {
    const verdict = replayUnderDocumentedInvocation(
      "brainstorm",
      derivedFixture("brainstorm"),
    );
    expect(verdict.line).toBe(row.withRoot.line);
    expect(verdict.exitCode).toBe(row.withRoot.exitCode);
    expect(verdict.line).not.toContain("violation");
  });

  test("the un-scoped invocation is what produced the false alarm", () => {
    // Non-vacuity for the test above: the same transcript really does score a
    // run-killing violation when the project root is withheld. If this ever
    // goes green-by-accident (fixture emptied, helper defanged), the pass above
    // would be meaningless.
    const verdict = verdictFor(
      "brainstorm",
      transcriptOf(derivedFixture("brainstorm")),
    );
    expect(verdict.line).toBe(row.without.line);
    expect(verdict.exitCode).toBe(row.without.exitCode);
  });

  test("the out-of-project write that triggered it is the operator's global log", () => {
    const t = transcriptOf(derivedFixture("brainstorm"));
    const scaffold = t[9]!;
    expect(scaffold.type).toBe("tool_use");
    expect(scaffold.name).toBe("Write");
    expect(scaffold.path).toBeDefined();
    expect(scaffold.path!.startsWith(`${CAPTURED_PROJECT_ROOT}/`)).toBe(false);
  });
});

// ===========================================================================
// AC-STE-422.3 — /setup still scores violation under the same invocation.
// ===========================================================================

describe("AC-STE-422.3 — /setup 2026-07-27 still scores violation", () => {
  const row = VERDICT_TABLE.find((r) => r.skill === "setup")!;

  test("still scores violation under the documented invocation", () => {
    // The control row. It is what proves the third argument NARROWS scope
    // rather than blunting the contract: STE-419's in-project Edit@19 must
    // survive the change.
    expect(documentedProjectRoot()).not.toBeNull();
    const verdict = replayUnderDocumentedInvocation(
      "setup",
      derivedFixture("setup"),
    );
    expect(verdict.line).toBe(row.withRoot.line);
    expect(verdict.exitCode).toBe(row.withRoot.exitCode);
  });

  test("the violating Edit is INSIDE the recorded project root", () => {
    const scaffold = transcriptOf(derivedFixture("setup"))[19]!;
    expect(scaffold.type).toBe("tool_use");
    expect(scaffold.name).toBe("Edit");
    expect(scaffold.path).toBe(`${CAPTURED_PROJECT_ROOT}/CLAUDE.md`);
  });

  test("the verdict is invariant across the argument — that is the point", () => {
    const t = transcriptOf(derivedFixture("setup"));
    const scoped = verdictFor("setup", t, {
      projectRoot: CAPTURED_PROJECT_ROOT,
    });
    const unscoped = verdictFor("setup", t);
    expect(scoped).toEqual(row.withRoot);
    expect(unscoped).toEqual(row.without);
    expect(scoped).toEqual(unscoped);
  });
});

// ===========================================================================
// AC-STE-422.4 — the argument count is byte-pinned against silent regression.
// ===========================================================================

describe("AC-STE-422.4 — the documented invocation carries three arguments", () => {
  test("exactly one invocation, exactly three arguments", () => {
    // This defect was recorded on 2026-07-20 and lost; it then cost the
    // 2026-07-27 run as well. The count is the pin that stops a third
    // occurrence — `toBe(3)`, not `toBeGreaterThan(2)`.
    const { args } = documentedInvocation();
    expect(args).toHaveLength(3);
  });

  test("the two-argument form does NOT satisfy the pin (non-vacuity)", () => {
    // The exact bytes at SKILL.md:1196 before this FR. If the matcher below
    // ever accepts this, the pin above is decorative.
    const REGRESSED = 'bun "${ASSERT_RUNNER}" "${SKILL}" "${FIXTURE}"';
    const calls = findRunnerInvocations(REGRESSED);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.args).toHaveLength(2);
    expect(calls[0]!.args).not.toHaveLength(3);
    expect(namesTestProjectPath(calls[0]!.args[2] ?? "", REGRESSED)).toBe(false);
  });

  test("the matcher accepts the fixed form and reads its third argument", () => {
    // The mirror of the test above: a positive control proving the matcher is
    // not simply rejecting everything.
    const FIXED =
      'TEST_PATH="../dpt-test-project-${TRACKER}"\n' +
      '  bun "${ASSERT_RUNNER}" "${SKILL}" "${FIXTURE}" "${TEST_PATH}"';
    const calls = findRunnerInvocations(FIXED);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.args).toHaveLength(3);
    expect(namesTestProjectPath(calls[0]!.args[2]!, FIXED)).toBe(true);
  });

  test("a third argument that names something else is rejected", () => {
    // Guards the obvious cheat: satisfying the count with a token that is not
    // the test project (AC-STE-422.1 is about WHICH path, not just arity).
    const CHEAT =
      'FIXTURE_DIR=${PLUGIN_DIR}/tests/fixtures\n' +
      '  bun "${ASSERT_RUNNER}" "${SKILL}" "${FIXTURE}" "${FIXTURE_DIR}"';
    const calls = findRunnerInvocations(CHEAT);
    expect(calls[0]!.args).toHaveLength(3);
    expect(namesTestProjectPath(calls[0]!.args[2]!, CHEAT)).toBe(false);
  });

  test("the matcher tolerates line continuations and extra whitespace", () => {
    const WRAPPED =
      'PROJECT_DIR=/tmp/dpt-test-project-linear\n' +
      '  bun   "${ASSERT_RUNNER}" \\\n' +
      '    "${SKILL}"  "${FIXTURE}" \\\n' +
      '    "${PROJECT_DIR}"';
    const calls = findRunnerInvocations(WRAPPED);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.args).toHaveLength(3);
    expect(namesTestProjectPath(calls[0]!.args[2]!, WRAPPED)).toBe(true);
  });
});

// ===========================================================================
// Derived-fixture integrity — the committed reproducers must stay faithful.
// ===========================================================================

describe("derived fixtures reproduce the FR's measured verdict table", () => {
  for (const row of VERDICT_TABLE) {
    test(`${row.skill}: both verdicts match the recorded table`, () => {
      const t = transcriptOf(derivedFixture(row.skill));
      expect(t.length).toBeGreaterThan(0);
      expect(verdictFor(row.skill, t)).toEqual(row.without);
      expect(
        verdictFor(row.skill, t, { projectRoot: CAPTURED_PROJECT_ROOT }),
      ).toEqual(row.withRoot);
    });
  }

  test("the recorded project root is the Linear leg's test project", () => {
    expect(basename(CAPTURED_PROJECT_ROOT)).toBe("dpt-test-project-linear");
  });

  test("every derived fixture stays small enough to belong in git", () => {
    for (const row of VERDICT_TABLE) {
      const bytes = readFileSync(derivedFixture(row.skill)).length;
      expect(bytes).toBeGreaterThan(0);
      // The untracked source captures run 100 KB – 450 KB. A derived
      // reproducer that grows past 32 KB has stopped being derived.
      expect(bytes).toBeLessThan(32 * 1024);
    }
  });
});

describe("fixture equivalence — derived vs. the untracked full capture", () => {
  // Enforced forever, not just at authoring time: whenever the 2026-07-27 run
  // artifact is present on disk, the committed reproducer must score
  // identically in ALL FOUR combinations ({full, derived} x {with, without}).
  // The captures are deliberately never committed, so these skip in a clean
  // checkout — the test name says so out loud rather than passing silently.
  for (const row of VERDICT_TABLE) {
    const capture = fullCapture(row.skill);
    const present = existsSync(capture);
    test.skipIf(!present)(
      `${row.skill}: derived fixture is verdict-equivalent to the full capture` +
        (present ? "" : " [SKIPPED — untracked capture absent]"),
      () => {
        const full = transcriptOf(capture);
        const derived = transcriptOf(derivedFixture(row.skill));
        expect(full.length).toBeGreaterThan(0);

        const fullWithout = verdictFor(row.skill, full);
        const fullWith = verdictFor(row.skill, full, {
          projectRoot: CAPTURED_PROJECT_ROOT,
        });
        const derivedWithout = verdictFor(row.skill, derived);
        const derivedWith = verdictFor(row.skill, derived, {
          projectRoot: CAPTURED_PROJECT_ROOT,
        });

        expect(derivedWithout).toEqual(fullWithout);
        expect(derivedWith).toEqual(fullWith);
        // …and both legs still agree with the FR's recorded table, so a
        // capture that itself drifted cannot quietly redefine the contract.
        expect(fullWithout).toEqual(row.without);
        expect(fullWith).toEqual(row.withRoot);
      },
    );
  }
});
