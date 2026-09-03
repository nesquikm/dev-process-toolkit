import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseTestOutput,
  renderClosingLine,
  type TestCount,
  type TestCountParseResult,
} from "../adapters/_shared/src/test_count_parser";

// STE-508 (M132) — the test-count parser reports skipped tests.
//
// The parser models `{ total, failures, errors }`. Without a `skipped`
// counter every downstream consumer is structurally unable to tell a suite
// that passed from a suite that mostly did not run. This file pins the
// fourth field, its per-stack extraction, its anchoring, the zero-vs-
// unparseable distinction, and the two compatibility clauses.
//
// Runner shapes used below are REAL:
//   bun     — ` 4 skip` (captured from `bun test v1.3.14` on a two-file run
//             with four `test.skip` cases; `Ran N tests` INCLUDES the skips)
//   pytest  — `3 skipped` in the terminal summary line
//   flutter — `~N` in the `+P ~S -F` progress line

const pluginRoot = join(import.meta.dir, "..");
const parserSource = readFileSync(
  join(pluginRoot, "adapters", "_shared", "src", "test_count_parser.ts"),
  "utf8",
);
const shipMilestoneSkill = readFileSync(
  join(pluginRoot, "skills", "ship-milestone", "SKILL.md"),
  "utf8",
);

function assertOk(result: TestCountParseResult): TestCount {
  if (!result.ok) throw new Error(`expected ok but got: ${result.reason}`);
  return result.count;
}

// The shipped three-field consumer: /ship-milestone's CHANGELOG closing line,
// documented in skills/ship-milestone/SKILL.md as
//   `Total test count at release: <N> tests, <F> failures, <E> errors.`
// Reads exactly three fields — never `skipped`. AC-STE-508.6 pins that the
// fourth field does not change one byte of what this renders.
//
// STE-545 (M141): this renderer used to be DECLARED here, as a local copy of a
// sentence the release ceremony types by hand. It is now imported from
// `test_count_parser.ts`, which already owned the parse half — render and parse
// sit together, and the two can no longer drift apart.

// ---------------------------------------------------------------------------
// Real-shape fixtures
// ---------------------------------------------------------------------------

// Captured verbatim from `bun test` (v1.3.14) over two files, four skips.
const BUN_WITH_SKIPS = [
  "bun test v1.3.14 (d1632b29)",
  "",
  " 3 pass",
  " 4 skip",
  " 0 fail",
  " 3 expect() calls",
  "Ran 7 tests across 2 files. [7.00ms]",
].join("\n");

// Real bun tail with NO skipped tests at all.
const BUN_NO_SKIPS = [
  " 279 pass",
  " 0 fail",
  " 592 expect() calls",
  "Ran 279 tests across 19 files. [6.39s]",
].join("\n");

// STE-323's documented multi-file shape: per-file counters are emitted BEFORE
// the summary block, so a first-match (`.exec()`) extractor captures a per-file
// number instead of the total. The per-file `1 skip` / `2 skip` here shadow the
// summary's ` 11 skip` under first-match — that is the mutation this fixture kills.
const BUN_PER_FILE_SKIPS_BEFORE_SUMMARY = [
  "plugins/.../file1.test.ts:",
  "  ✓ test 1",
  "  » test 2",
  "4 pass",
  "1 skip",
  "0 fail",
  "",
  "plugins/.../file2.test.ts:",
  "4 pass",
  "2 skip",
  "0 fail",
  "",
  " 2891 pass",
  " 11 skip",
  " 0 fail",
  " 6340 expect() calls",
  "Ran 2902 tests across 257 files. [28.45s]",
].join("\n");

const PYTEST_WITH_SKIPS =
  "=================== 6 passed, 3 skipped in 0.41s ===================";

const PYTEST_NO_SKIPS = "============== 47 passed in 1.23s ==============";

// A single gate command that runs pytest twice (`pytest tests/unit && pytest
// tests/integration`) lands two summary lines in one captured buffer. The
// earlier `2 skipped` must not shadow the final `5 skipped`.
const PYTEST_TWO_SUMMARIES = [
  "=================== 12 passed, 2 skipped in 0.31s ===================",
  "",
  "=================== 40 passed, 5 skipped in 1.02s ===================",
].join("\n");

// flutter prints one cumulative progress line PER TEST; only the last line
// carries the run totals. `~N` appears as soon as the first test is skipped.
const FLUTTER_WITH_SKIPS = "00:03 +5 ~2 -0: All tests passed!";

const FLUTTER_NO_SKIPS = "00:02 +30 -0: All tests passed!";

const FLUTTER_PROGRESS_LOG = [
  "00:00 +0: loading test/widget_test.dart",
  "00:01 +1: counter increments",
  "00:02 +1 ~1: platform-only test (skipped)",
  "00:02 +2 ~1: renders header",
  "00:03 +2 ~3: golden tests (skipped)",
  "00:03 +7 ~3: All tests passed!",
].join("\n");

// ---------------------------------------------------------------------------
// AC-STE-508.1 — `TestCount` gains a `skipped` field.
// ---------------------------------------------------------------------------

describe("AC-STE-508.1 — TestCount gains a `skipped` field", () => {
  test("a successful parse exposes a numeric `skipped` alongside the legacy three", () => {
    const count = assertOk(parseTestOutput(BUN_WITH_SKIPS, "bun"));
    expect(typeof count.skipped).toBe("number");
    expect(count.skipped).toBe(4);
  });

  test("the parsed shape is exactly four numeric fields — nothing more, nothing less", () => {
    const count = assertOk(parseTestOutput(BUN_WITH_SKIPS, "bun"));
    expect(Object.keys(count).sort()).toEqual([
      "errors",
      "failures",
      "skipped",
      "total",
    ]);
  });

  test("the `TestCount` interface declares `skipped: number`", () => {
    const block = /export interface TestCount \{[\s\S]*?\n\}/.exec(parserSource);
    if (!block) throw new Error("TestCount interface not found in source");
    expect(block[0]).toMatch(/skipped\s*:\s*number/);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-508.2 — each stack branch parses its own skip counter.
// ---------------------------------------------------------------------------

describe("AC-STE-508.2 — per-stack skip counters", () => {
  test("bun `N skip` — 3 pass / 4 skip / 0 fail, Ran 7", () => {
    const count = assertOk(parseTestOutput(BUN_WITH_SKIPS, "bun"));
    expect(count.skipped).toBe(4);
    // Legacy fields keep their STE-73/STE-323 semantics: `Ran N` is the total
    // and it already includes the skips.
    expect(count.total).toBe(7);
    expect(count.failures).toBe(0);
    expect(count.errors).toBe(0);
  });

  test("pytest `N skipped` — 6 passed, 3 skipped", () => {
    const count = assertOk(parseTestOutput(PYTEST_WITH_SKIPS, "pytest"));
    expect(count.skipped).toBe(3);
    // pytest's total stays passed + failed + errors — skips are NOT folded in,
    // or the CHANGELOG closing line would silently change value (AC-STE-508.6).
    expect(count.total).toBe(6);
    expect(count.failures).toBe(0);
    expect(count.errors).toBe(0);
  });

  test("flutter `~N` in the +P ~S -F progress line — +5 ~2 -0", () => {
    const count = assertOk(parseTestOutput(FLUTTER_WITH_SKIPS, "flutter"));
    expect(count.skipped).toBe(2);
    expect(count.total).toBe(5);
    expect(count.failures).toBe(0);
    expect(count.errors).toBe(0);
  });

  test("every non-fallback stack reports a skip count for its own real output", () => {
    const perStack: Array<[string, string, number]> = [
      ["bun", BUN_WITH_SKIPS, 4],
      ["pytest", PYTEST_WITH_SKIPS, 3],
      ["flutter", FLUTTER_WITH_SKIPS, 2],
    ];
    for (const [stack, output, expected] of perStack) {
      const count = assertOk(parseTestOutput(output, stack as "bun"));
      expect({ stack, skipped: count.skipped }).toEqual({
        stack,
        skipped: expected,
      });
    }
  });
});

// ---------------------------------------------------------------------------
// AC-STE-508.3 — last-match anchoring; per-file counters cannot shadow the total.
// ---------------------------------------------------------------------------

describe("AC-STE-508.3 — skip parsing anchors on the LAST match", () => {
  // Mutation this kills: `/(\d+)\s+skip\b/.exec(output)` returns 1 here.
  test("bun: per-file `1 skip` / `2 skip` before the summary do NOT shadow ` 11 skip`", () => {
    const count = assertOk(
      parseTestOutput(BUN_PER_FILE_SKIPS_BEFORE_SUMMARY, "bun"),
    );
    expect(count.skipped).toBe(11);
    expect(count.skipped).not.toBe(1); // first per-file counter
    expect(count.skipped).not.toBe(2); // second per-file counter
    // The legacy anchoring stays intact on the same fixture.
    expect(count.total).toBe(2902);
    expect(count.failures).toBe(0);
  });

  // Mutation this kills: `/(\d+)\s+skipped/.exec(output)` returns 2 here.
  test("pytest: an earlier summary's `2 skipped` does NOT shadow the final `5 skipped`", () => {
    const count = assertOk(parseTestOutput(PYTEST_TWO_SUMMARIES, "pytest"));
    expect(count.skipped).toBe(5);
    expect(count.skipped).not.toBe(2);
  });

  // Mutation this kills: `/~(\d+)/.exec(output)` returns 1 here. flutter's
  // cumulative progress lines make first-match unambiguously wrong.
  test("flutter: an early `~1` progress line does NOT shadow the final `~3`", () => {
    const count = assertOk(parseTestOutput(FLUTTER_PROGRESS_LOG, "flutter"));
    expect(count.skipped).toBe(3);
    expect(count.skipped).not.toBe(1);
    // NOTE: `total`/`failures` are deliberately not asserted on this fixture.
    // STE-323 AC-323.5 audited flutter's +N/-F extraction as first-match and
    // pinned it that way; re-anchoring those counters is out of STE-508's scope.
  });

  // STE-323's shipped audit pins that parsePytest/parseFlutter bodies contain
  // no `matchAll` and no `/g` literal (scope-creep guard for the pass/fail
  // counters). Last-match skip extraction must therefore reach those branches
  // without violating that guard — e.g. a module-level global regex constant
  // handed to the hoisted `lastCountedMatch` helper.
  test("last-match skip parsing does not break the STE-323 scope-creep audit", () => {
    const pytestBlock = /function parsePytest\([\s\S]*?\n\}/.exec(parserSource);
    const flutterBlock = /function parseFlutter\([\s\S]*?\n\}/.exec(parserSource);
    if (!pytestBlock) throw new Error("parsePytest not found in source");
    if (!flutterBlock) throw new Error("parseFlutter not found in source");
    expect(pytestBlock[0]).not.toMatch(/matchAll/);
    expect(pytestBlock[0]).not.toMatch(/\/g\b/);
    expect(flutterBlock[0]).not.toMatch(/matchAll/);
    expect(flutterBlock[0]).not.toMatch(/\/g\b/);
    // …and the behaviour above still holds, so the guard is not satisfied by
    // simply declining to implement last-match.
    expect(assertOk(parseTestOutput(PYTEST_TWO_SUMMARIES, "pytest")).skipped).toBe(5);
    expect(assertOk(parseTestOutput(FLUTTER_PROGRESS_LOG, "flutter")).skipped).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-508.4 — zero skipped is reported as zero and is distinguishable
// from a parse failure.
// ---------------------------------------------------------------------------

describe("AC-STE-508.4 — no skip counter means zero, not a parse failure", () => {
  test("bun output with no `N skip` line parses ok with skipped 0", () => {
    const result = parseTestOutput(BUN_NO_SKIPS, "bun");
    expect(result.ok).toBe(true);
    const count = assertOk(result);
    expect(count.skipped).toBe(0);
    expect(count.total).toBe(279);
  });

  test("pytest output with no `N skipped` parses ok with skipped 0", () => {
    const count = assertOk(parseTestOutput(PYTEST_NO_SKIPS, "pytest"));
    expect(count.skipped).toBe(0);
    expect(count.total).toBe(47);
  });

  test("flutter output with no `~N` parses ok with skipped 0", () => {
    const count = assertOk(parseTestOutput(FLUTTER_NO_SKIPS, "flutter"));
    expect(count.skipped).toBe(0);
    expect(count.total).toBe(30);
  });

  test("unparseable output yields `{ ok: false, reason }` — never a zero count", () => {
    const unparseable: Array<[string, string]> = [
      ["bun", "bun test v1.3.14 (d1632b29)\nsome chatter without counters\n"],
      ["pytest", "some random output\nno counters here"],
      ["flutter", "Error running tests"],
    ];
    for (const [stack, output] of unparseable) {
      const result = parseTestOutput(output, stack as "bun");
      expect({ stack, ok: result.ok }).toEqual({ stack, ok: false });
      // The failure shape must not route around itself by reporting zeroes.
      expect(Object.hasOwn(result, "count")).toBe(false);
      if (!result.ok) expect(result.reason.length).toBeGreaterThan(0);
    }
  });

  test("zero-skipped and could-not-parse are structurally distinguishable", () => {
    const zero = parseTestOutput(BUN_NO_SKIPS, "bun");
    const broken = parseTestOutput("no counters at all", "bun");
    expect(zero.ok).toBe(true);
    expect(broken.ok).toBe(false);
    expect(assertOk(zero).skipped).toBe(0);
    // A consumer reading `.skipped` off the failure shape gets nothing at all,
    // not the same 0 the healthy run reports.
    expect((broken as { count?: TestCount }).count).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// AC-STE-508.5 — the unknown-stack fallback is unchanged.
// ---------------------------------------------------------------------------

describe("AC-STE-508.5 — unknown-stack fallback unchanged", () => {
  test("unknown stack still refuses with the byte-exact NFR-10 reason", () => {
    const result = parseTestOutput(BUN_WITH_SKIPS, "unknown");
    expect(result).toEqual({
      ok: false,
      reason: "unknown stack — cannot parse test output",
    });
  });

  test("the fallback does not gain a skip-bearing count while its siblings do", () => {
    // The contrast is the assertion: skip-capable known stacks vs an unknown
    // stack that stays a refusal even on identical, fully parseable output.
    expect(assertOk(parseTestOutput(BUN_WITH_SKIPS, "bun")).skipped).toBe(4);
    const fallback = parseTestOutput(BUN_WITH_SKIPS, "unknown");
    expect(fallback.ok).toBe(false);
    expect(Object.hasOwn(fallback, "count")).toBe(false);
    expect(Object.hasOwn(fallback, "skipped")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-508.6 — existing three-field consumers are unaffected.
// ---------------------------------------------------------------------------

describe("AC-STE-508.6 — three-field consumers unaffected", () => {
  test("the CHANGELOG closing line renders byte-identically for a skip-bearing run", () => {
    const count = assertOk(parseTestOutput(BUN_WITH_SKIPS, "bun"));
    // The fourth field exists…
    expect(count.skipped).toBe(4);
    // …and the shipped three-field consumer renders exactly what it always did.
    expect(renderClosingLine(count)).toBe(
      "Total test count at release: 7 tests, 0 failures, 0 errors.",
    );
    expect(renderClosingLine(count)).not.toMatch(/skip/i);
  });

  test("adding `skipped` does not shift total/failures/errors on any stack", () => {
    const cases: Array<[string, string, number, number, number]> = [
      // stack, output, total, failures, errors
      ["bun", BUN_WITH_SKIPS, 7, 0, 0],
      ["bun", BUN_NO_SKIPS, 279, 0, 0],
      ["pytest", PYTEST_WITH_SKIPS, 6, 0, 0],
      ["pytest", "======== 47 passed, 3 failed in 2.45s ========", 50, 3, 0],
      ["flutter", FLUTTER_WITH_SKIPS, 5, 0, 0],
      ["flutter", "00:04 +30 -2: Some tests failed.", 32, 2, 0],
    ];
    for (const [stack, output, total, failures, errors] of cases) {
      const count = assertOk(parseTestOutput(output, stack as "bun"));
      expect({ stack, total: count.total, failures: count.failures, errors: count.errors })
        .toEqual({ stack, total, failures, errors });
    }
  });

  test("/ship-milestone still documents the three-field closing-line template", () => {
    expect(shipMilestoneSkill).toContain(
      "Total test count at release: <N> tests, <F> failures, <E> errors.",
    );
  });

  test("the closing-line sentence in SKILL.md gains no skipped field", () => {
    const line = shipMilestoneSkill
      .split("\n")
      .find((l) => l.includes("Total test count at release:"));
    if (!line) throw new Error("closing-line template not found in SKILL.md");
    expect(line).not.toMatch(/<S>\s*skipped|skipped>/i);
  });
});

// ---------------------------------------------------------------------------
// M132 hardening — AC-STE-508.3, displaced one layer out.
//
// `FLUTTER_SKIPPED_RE = /~(\d+)/g` is not anchored to flutter's progress
// line. Handed to `lastCountedMatch`, the LAST `~<digits>` ANYWHERE in the
// captured output wins — including text that is not a progress line at all.
//
// AC-STE-508.3 fixed "an EARLIER counter shadows the total" (that is what
// FLUTTER_PROGRESS_LOG above pins). It left the mirror case open: "a LATER
// non-counter shadows the total". Last-match anchoring alone is only half of
// the guard; the pattern must also be anchored to the counter's own shape.
//
// Real capture shape: gate commands run `flutter test 2>&1`, so a buffered
// stderr failure block flushes AFTER the final stdout progress line. Flutter's
// expanded reporter legitimately prints tildes inside expected/actual values
// (approximate-count labels) and its stack frames are full of colons — so a
// bare `~(\d+)` sweep over the whole capture reads a value out of prose.
// ---------------------------------------------------------------------------

// Genuine run totals: 5 passed, 2 SKIPPED, 1 failed. The trailing stderr block
// contains `~3` inside a quoted expected/actual value and a `1:~3` fragment in
// the frame line — neither is a counter.
const FLUTTER_TRAILING_TILDE_NOISE = [
  "00:00 +0: loading test/pricing_label_test.dart",
  "00:01 +1: formats an exact count",
  "00:02 +1 ~1: platform-only rendering (skipped)",
  "00:03 +3 ~1: renders the summary row",
  "00:04 +3 ~2: golden comparison (skipped)",
  "00:05 +5 ~2 -1: Some tests failed.",
  "",
  "The following TestFailure was thrown running a test:",
  "Expected: '~2 items'",
  "  Actual: '~3 items'",
  "   Which: is different at offset 1:~3",
  "",
  "When the exception was thrown, this was the stack:",
  "#0      main.<anonymous closure> (test/pricing_label_test.dart:41:~3)",
].join("\n");

describe("M132 hardening — flutter `~N` must be anchored to the progress line", () => {
  test("a trailing `~3` in stderr failure prose does NOT shadow the real `~2`", () => {
    const count = assertOk(parseTestOutput(FLUTTER_TRAILING_TILDE_NOISE, "flutter"));
    // The run genuinely skipped 2. `~3` occurs only inside failure prose.
    expect(count.skipped).toBe(2);
  });

  test("the trailing-noise fixture is only decidable if `~3` really is last", () => {
    // Falsifiability: if the fixture's last `~N` were already `~2`, the
    // assertion above would pass against the unanchored regex and prove
    // nothing. Pin that the noise genuinely comes last.
    const all = Array.from(FLUTTER_TRAILING_TILDE_NOISE.matchAll(/~(\d+)/g));
    expect(all[all.length - 1][1]).toBe("3");
    // ...and that the real counters it must not be confused with are `~2`.
    expect(FLUTTER_TRAILING_TILDE_NOISE).toContain("+5 ~2 -1:");
  });

  test("over-anchoring is not a fix — plain progress lines still report their `~N`", () => {
    // A pattern narrowed until it stops matching real progress lines would
    // pass the assertion above by reporting 0. These three shapes are all
    // real: with `-N`, without `-N`, and multi-line cumulative.
    expect(assertOk(parseTestOutput(FLUTTER_WITH_SKIPS, "flutter")).skipped).toBe(2);
    expect(assertOk(parseTestOutput("00:02 +1 ~1: platform-only", "flutter")).skipped).toBe(1);
    expect(assertOk(parseTestOutput(FLUTTER_PROGRESS_LOG, "flutter")).skipped).toBe(3);
  });

  test("a run with no `~` at all still reports zero skipped, not a parse failure", () => {
    const result = parseTestOutput(FLUTTER_NO_SKIPS, "flutter");
    expect(result.ok).toBe(true);
    expect(assertOk(result).skipped).toBe(0);
  });

  test("anchoring the skip counter leaves the fail counter alone", () => {
    // Scope guard: flutter's `+N`/`-N` extraction is deliberately first-match
    // (STE-323 AC-323.5 audits parseFlutter for exactly that), so this asserts
    // only that the skip fix does not reach into the fail counter. The `-1` in
    // the final progress line is the run's real failure count; the trailing
    // stack frame carries no `-N` to be confused with it.
    const count = assertOk(parseTestOutput(FLUTTER_TRAILING_TILDE_NOISE, "flutter"));
    expect({ failures: count.failures, errors: count.errors })
      .toEqual({ failures: 1, errors: 0 });
  });
});
