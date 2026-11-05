import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseTestOutput, type TestCountParseResult } from "./test_count_parser";

// STE-73 AC-STE-73.12 — parse test-gate output into the three counters
// the CHANGELOG closing line needs: `<N> tests, <F> failures, <E> errors`.
//
// Stack dispatch: bun / pytest / flutter are the stacks AC-STE-73.12
// enumerates; anything else (npm, jest, mocha, cargo, go test, …) falls
// back to `{ ok: false, reason: <...> }` so /ship-milestone can surface
// an NFR-10 asking the user to specify or skip the line.

function assertOk(result: TestCountParseResult) {
  if (!result.ok) throw new Error(`expected ok but got: ${result.reason}`);
  return result.count;
}

describe("parseTestOutput — bun", () => {
  test("bun 'N pass / F fail' format — all green", () => {
    const output = " 279 pass\n 0 fail\n 592 expect() calls\nRan 279 tests across 19 files. [6.39s]";
    const count = assertOk(parseTestOutput(output, "bun"));
    expect(count.total).toBe(279);
    expect(count.failures).toBe(0);
    expect(count.errors).toBe(0);
  });

  test("bun output with failures sums total = pass + fail", () => {
    const output = " 40 pass\n 2 fail\n 80 expect() calls\nRan 42 tests across 3 files.";
    const count = assertOk(parseTestOutput(output, "bun"));
    expect(count.total).toBe(42);
    expect(count.failures).toBe(2);
    expect(count.errors).toBe(0);
  });

  test("bun output with neither counter is unrecognized", () => {
    const result = parseTestOutput("bun test v1.3.11 (af24e281)\n", "bun");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/could not|unrecognized|no test counters/i);
  });
});

describe("parseTestOutput — pytest", () => {
  test("pytest 'N passed, F failed in TIME' — all green", () => {
    const output = "============== 47 passed in 1.23s ==============";
    const count = assertOk(parseTestOutput(output, "pytest"));
    expect(count.total).toBe(47);
    expect(count.failures).toBe(0);
    expect(count.errors).toBe(0);
  });

  test("pytest 'N passed, F failed' — mixed", () => {
    const output = "======== 47 passed, 3 failed in 2.45s ========";
    const count = assertOk(parseTestOutput(output, "pytest"));
    expect(count.total).toBe(50);
    expect(count.failures).toBe(3);
    expect(count.errors).toBe(0);
  });

  test("pytest with errors distinct from failures", () => {
    const output = "======== 45 passed, 2 failed, 1 error in 3.00s ========";
    const count = assertOk(parseTestOutput(output, "pytest"));
    expect(count.total).toBe(48);
    expect(count.failures).toBe(2);
    expect(count.errors).toBe(1);
  });
});

describe("parseTestOutput — flutter", () => {
  test("flutter 'All tests passed' — green", () => {
    const output = "00:04 +32: All tests passed!";
    const count = assertOk(parseTestOutput(output, "flutter"));
    expect(count.total).toBe(32);
    expect(count.failures).toBe(0);
    expect(count.errors).toBe(0);
  });

  test("flutter 'Some tests failed' — mixed", () => {
    const output = "00:04 +30 -2: Some tests failed.";
    const count = assertOk(parseTestOutput(output, "flutter"));
    expect(count.total).toBe(32);
    expect(count.failures).toBe(2);
    expect(count.errors).toBe(0);
  });
});

describe("parseTestOutput — bun summary-line anchoring (STE-323)", () => {
  // AC-STE-323.1 + AC-STE-323.3(a): per-file pass counts precede summary;
  // parser must return total from `Ran N tests across M files`, not the
  // first per-file `4 pass`. Legacy first-match parser returns 4 here.
  test("AC-STE-323.3(a): per-file pass counts before summary — uses `Ran N` summary", () => {
    const output = [
      "plugins/.../file1.test.ts:",
      "  ✓ test 1",
      "  ✓ test 2",
      "  ✓ test 3",
      "  ✓ test 4",
      "4 pass",
      "0 fail",
      "",
      "plugins/.../file2.test.ts:",
      "  ✓ test 5",
      "  ✓ test 6",
      "  ✓ test 7",
      "  ✓ test 8",
      "4 pass",
      "0 fail",
      "",
      "plugins/.../file3.test.ts:",
      "4 pass",
      "0 fail",
      "",
      "plugins/.../file4.test.ts:",
      "4 pass",
      "0 fail",
      "",
      "plugins/.../file5.test.ts:",
      "4 pass",
      "0 fail",
      "",
      " 2891 pass",
      " 11 skip",
      " 0 fail",
      " 6340 expect() calls",
      "Ran 2902 tests across 257 files. [28.45s]",
    ].join("\n");
    const result = parseTestOutput(output, "bun");
    if (!result.ok) throw new Error(`expected ok but got: ${result.reason}`);
    // Primary anchor is `Ran 2902 tests across 257 files`, so total = 2902.
    expect(result.count.total).toBe(2902);
    expect(result.count.failures).toBe(0);
    expect(result.count.errors).toBe(0);
  });

  // AC-STE-323.3(b): isolated summary-line fixture per spec sketch.
  test("AC-STE-323.3(b): `Ran 2902 tests across 257 files` summary line — returns 2902", () => {
    const output = [
      "4 pass",
      "0 fail",
      "",
      "2 pass",
      "0 fail",
      "",
      "Ran 2902 tests across 257 files. [12.00s]",
    ].join("\n");
    const result = parseTestOutput(output, "bun");
    if (!result.ok) throw new Error(`expected ok but got: ${result.reason}`);
    expect(result.count.total).toBe(2902);
  });

  // AC-STE-323.1(b): when `Ran N tests` summary absent (older Bun or
  // truncated), fall back to LAST `\d+ pass` match — not the first.
  test("AC-STE-323.1(b): no `Ran N` line — falls back to LAST `N pass`", () => {
    const output = [
      "4 pass",
      "0 fail",
      "",
      "2891 pass",
      "11 skip",
      "0 fail",
    ].join("\n");
    const result = parseTestOutput(output, "bun");
    if (!result.ok) throw new Error(`expected ok but got: ${result.reason}`);
    // Legacy first-match would yield 4; spec requires the LAST pass counter,
    // 2891, which since AC-STE-683.2 counts skips too: 2891 + 0 + 11.
    expect(result.count.total).toBe(2902);
  });

  // AC-STE-323.1 fall-through: neither summary nor `N pass` present.
  test("AC-STE-323.1: neither summary nor `N pass` — NFR-10 canonical fallback", () => {
    const output = "bun test v1.3.11 (af24e281)\nsome chatter without counters\n";
    const result = parseTestOutput(output, "bun");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Spec voice: mention both anchors so user knows what was looked for.
      expect(result.reason).toMatch(/Ran N tests/);
      expect(result.reason).toMatch(/pass/);
    }
  });

  // AC-STE-323.2: output shape stable; for runs with skipped tests, the
  // new total (Ran N) is strictly ≥ legacy pass-only count.
  test("AC-STE-323.2: shape stable + total reflects `Ran N` (includes skip) for skipped runs", () => {
    const output = [
      " 2891 pass",
      " 11 skip",
      " 0 fail",
      "Ran 2902 tests across 257 files.",
    ].join("\n");
    const result = parseTestOutput(output, "bun");
    if (!result.ok) throw new Error(`expected ok but got: ${result.reason}`);
    // Shape stability — three numeric fields, nothing more, nothing less.
    expect(typeof result.count.total).toBe("number");
    expect(typeof result.count.failures).toBe("number");
    expect(typeof result.count.errors).toBe("number");
    // Semantic: total = 2902 (includes 11 skip), strictly > 2891 pass-only.
    expect(result.count.total).toBe(2902);
    expect(result.count.total).toBeGreaterThan(2891);
  });

  // AC-STE-323.2: zero-skip case — new total equals legacy pass-only count.
  test("AC-STE-323.2: zero-skip run — total equals pass count (no regression)", () => {
    const output = " 279 pass\n 0 fail\n 592 expect() calls\nRan 279 tests across 19 files. [6.39s]";
    const result = parseTestOutput(output, "bun");
    if (!result.ok) throw new Error(`expected ok but got: ${result.reason}`);
    expect(result.count.total).toBe(279);
    expect(result.count.failures).toBe(0);
  });

  // AC-STE-323.1: per-file `N fail` lines before summary — last-match for fail too.
  test("AC-STE-323.1: per-file `N fail` lines — last-match used for failures", () => {
    const output = [
      "file1.test.ts:",
      "1 pass",
      "0 fail",
      "",
      "file2.test.ts:",
      "0 pass",
      "0 fail",
      "",
      "2891 pass",
      "5 fail",
      "Ran 2896 tests across 257 files.",
    ].join("\n");
    const result = parseTestOutput(output, "bun");
    if (!result.ok) throw new Error(`expected ok but got: ${result.reason}`);
    expect(result.count.total).toBe(2896);
    expect(result.count.failures).toBe(5);
  });
});

describe("parseTestOutput — manual verification on real bun output (STE-323 AC-323.4)", () => {
  // AC-STE-323.4: simulate "real bun output" tail — exercises the parser on
  // a representative slice of `bun test 2>&1 | tail -50`. Confirms parser
  // count matches the trailing `Ran N` summary, not any per-file count.
  test("AC-STE-323.4: realistic bun tail-50 yields summary total, not per-file count", () => {
    // This is the shape of `bun test | tail -50` — many per-file pass counts
    // followed by aggregate summary. The legacy parser returns the first
    // per-file `\d+ pass` it sees; the new parser must return the summary total.
    const realisticTail = [
      "(pass) parseTestOutput — bun > bun 'N pass / F fail' format — all green",
      "(pass) parseTestOutput — pytest > pytest 'N passed, F failed in TIME' — all green",
      "✓ adapters/_shared/src/test_count_parser.test.ts (12 pass)",
      "✓ adapters/_shared/src/foo.test.ts (8 pass)",
      "12 pass",
      "0 fail",
      "8 pass",
      "0 fail",
      "",
      " 2891 pass",
      " 11 skip",
      " 0 fail",
      " 6340 expect() calls",
      "Ran 2902 tests across 257 files. [28.45s]",
    ].join("\n");
    const result = parseTestOutput(realisticTail, "bun");
    if (!result.ok) throw new Error(`expected ok but got: ${result.reason}`);
    // Critical: NOT 12 (first per-file count); MUST be 2902 (summary).
    expect(result.count.total).toBe(2902);
    expect(result.count.total).not.toBe(12);
    expect(result.count.total).not.toBe(8);
  });
});

describe("parseTestOutput — pytest/flutter audit (STE-323 AC-323.5)", () => {
  // AC-STE-323.5 assumed pytest emits a SINGLE summary line. A command can
  // print two (see the shadowing suite below), so the counters are last-match
  // now — through module-level `/g` constants, keeping this body audit.
  test("AC-STE-323.5: pytest body stays free of matchAll and inline /g — a single summary line parses", () => {
    const source = readFileSync(
      join(import.meta.dir, "test_count_parser.ts"),
      "utf8",
    );
    // Audit: parsePytest body unchanged from STE-73 baseline — no .matchAll
    // or `g` flag introduced by the STE-323 fix (would indicate scope creep).
    const pytestBlock = /function parsePytest\([\s\S]*?\n\}/.exec(source);
    if (!pytestBlock) throw new Error("parsePytest function not found in source");
    expect(pytestBlock[0]).not.toMatch(/matchAll/);
    expect(pytestBlock[0]).not.toMatch(/\/g\b/);
    // Behavior contract: standard pytest summary still parses correctly.
    const output = "======== 47 passed, 3 failed in 2.45s ========";
    const result = parseTestOutput(output, "pytest");
    if (!result.ok) throw new Error(`expected ok but got: ${result.reason}`);
    expect(result.count.total).toBe(50);
    expect(result.count.failures).toBe(3);
  });

  // AC-STE-323.5 assumed flutter emits a SINGLE `+N -F` line. A real capture
  // prints one cumulative progress line per test, so `+N`/`-F` are last-match
  // now too — through module-level `/g` constants, keeping this body audit.
  test("AC-STE-323.5: flutter body stays free of matchAll and inline /g — a single +N/-F line parses", () => {
    const source = readFileSync(
      join(import.meta.dir, "test_count_parser.ts"),
      "utf8",
    );
    const flutterBlock = /function parseFlutter\([\s\S]*?\n\}/.exec(source);
    if (!flutterBlock) throw new Error("parseFlutter function not found in source");
    expect(flutterBlock[0]).not.toMatch(/matchAll/);
    expect(flutterBlock[0]).not.toMatch(/\/g\b/);
    // Behavior contract: standard flutter line still parses correctly.
    const output = "00:04 +30 -2: Some tests failed.";
    const result = parseTestOutput(output, "flutter");
    if (!result.ok) throw new Error(`expected ok but got: ${result.reason}`);
    expect(result.count.total).toBe(32);
    expect(result.count.failures).toBe(2);
  });
});

// A capture repeats counter-shaped text after a run's own totals: flutter's
// `Failing tests:` block repeats test names, a gate command can append a
// timestamp or run a second suite, and bun counts todo tests it never runs.
// Each verdict below would flip if a later or earlier non-total were read.
// Expected numbers are literals from the capture, never the parser's output.
describe("parseTestOutput — counters a name, a path or a second run cannot shadow", () => {
  // `flutter test && TZ=UTC date -Iseconds`: `+00:00` closes the timestamp, so
  // an unanchored pass pattern read 0 and a first- or last-match `-N` read a
  // date field as failures.
  test("flutter: a trailing ISO timestamp does not shadow the green totals", () => {
    const output = [
      "00:00 +0: loading test/a_test.dart",
      "00:01 +1: a",
      "00:02 +2: b",
      "00:02 +2: All tests passed!",
      "2026-05-14T09:51:19+00:00",
    ].join("\n");
    const count = assertOk(parseTestOutput(output, "flutter"));
    expect({ total: count.total, failures: count.failures }).toEqual({ total: 2, failures: 0 });
  });

  // `Failing tests:` repeats a failing test named `total +5 -0: rounding` after
  // the last progress line; read there, the red run is pass 5, fail 0.
  test("flutter: a failing test whose name carries `+5 -0:` keeps the run red", () => {
    const output = [
      "00:00 +0: loading test/a_test.dart",
      "00:01 +1: a",
      "00:02 +1 -1: b [E]",
      "  Expected: true",
      "    Actual: <false>",
      "00:03 +1 -2: total +5 -0: rounding [E]",
      "00:03 +1 -2: Some tests failed.",
      "",
      "Failing tests:",
      "  test/a_test.dart: b",
      "  test/a_test.dart: total +5 -0: rounding",
    ].join("\n");
    const count = assertOk(parseTestOutput(output, "flutter"));
    expect({ total: count.total, failures: count.failures }).toEqual({ total: 3, failures: 2 });
  });

  // Mutants this kills: `/\+(\d+)/g` for pass reads the name's `+12`, and
  // `/-(\d+)/g` for fail reads the path's `dir-2`.
  test("flutter: `+12` in a failing test's name and `dir-2` in its path are not counters", () => {
    const output = [
      "00:00 +0: loading test/dir-2/score_test.dart",
      "00:01 +1: test/dir-2/score_test.dart: starts at zero",
      "00:01 +2: test/dir-2/score_test.dart: keeps the high score",
      "00:02 +2 -1: test/dir-2/score_test.dart: adds +12 bonus [E]",
      "  Expected: <12>",
      "    Actual: <0>",
      "00:02 +3 -1: test/dir-2/score_test.dart: resets",
      "00:02 +3 -1: Some tests failed.",
      "",
      "Failing tests:",
      "  test/dir-2/score_test.dart: adds +12 bonus",
    ].join("\n");
    const count = assertOk(parseTestOutput(output, "flutter"));
    expect({ total: count.total, failures: count.failures }).toEqual({ total: 4, failures: 1 });
  });

  // test_core prints elapsed time as unbounded minutes and two-digit seconds,
  // so past 100 minutes a progress line opens `100:03`. A stamp pattern that
  // wants exactly two minute digits drops those lines, and the last counted
  // line becomes one from before the failure.
  test("flutter: progress lines past 100 minutes still carry the totals", () => {
    const output = [
      "99:58 +40: a",
      "100:03 +40 -1: b [E]",
      "  Expected: true",
      "    Actual: <false>",
      "100:04 +41 -1: Some tests failed.",
    ].join("\n");
    const count = assertOk(parseTestOutput(output, "flutter"));
    expect({ total: count.total, failures: count.failures }).toEqual({ total: 42, failures: 1 });
  });

  // The colour reporter wraps the counters in SGR codes, so `+2` is followed by
  // `\x1b[0m`, not the line's colon.
  test("flutter: a coloured capture parses to the same totals", () => {
    const output = [
      "00:00 \x1b[32m+0\x1b[0m: loading test/a_test.dart",
      "00:01 \x1b[32m+1\x1b[0m: a",
      "00:02 \x1b[32m+2\x1b[0m: All tests passed!",
    ].join("\n");
    const result = parseTestOutput(output, "flutter");
    // Not through assertOk: an unparsed capture must fail at this assertion.
    expect(result.ok ? { total: result.count.total, failures: result.count.failures } : result).toEqual({
      total: 2,
      failures: 0,
    });
  });

  // A command that runs two suites prints two summary blocks; `Ran` must come
  // from the same block as `fail` and `skip`, the last one.
  test("bun: two suites in one capture read the last summary block whole", () => {
    const output = [
      " 5 pass",
      " 0 fail",
      "Ran 5 tests across 2 files.",
      " 11 pass",
      " 5 skip",
      " 0 fail",
      "Ran 16 tests across 2 files.",
    ].join("\n");
    const count = assertOk(parseTestOutput(output, "bun"));
    expect({ total: count.total, failures: count.failures, skipped: count.skipped }).toEqual({
      total: 16,
      failures: 0,
      skipped: 5,
    });
  });

  // `Ran 5` counts two todo tests that never executed; left in `total`, they
  // read downstream as two passes of a run that executed nothing.
  test("bun: todo tests leave `total`, so nothing executed reads as zero passes", () => {
    const output = [" 0 pass", " 3 skip", " 2 todo", " 0 fail", "Ran 5 tests across 2 files."].join("\n");
    const count = assertOk(parseTestOutput(output, "bun"));
    expect({ total: count.total, failures: count.failures, skipped: count.skipped }).toEqual({
      total: 3,
      failures: 0,
      skipped: 3,
    });
  });

  // Bun prints `N todo` in its summary only when a run has todo tests, so the
  // counter must come from the summary block: a failing test named
  // `renders 3 todo items` is echoed in its `(fail)` line above it.
  test("bun: `N todo` in a failing test's name is not the todo counter", () => {
    const output = [
      "a.test.ts:",
      "error: expect(received).toBe(expected)",
      "(fail) renders 3 todo items [0.05ms]",
      "",
      " 3 pass",
      " 1 fail",
      " 4 expect() calls",
      "Ran 4 tests across 2 files. [3.00ms]",
    ].join("\n");
    const count = assertOk(parseTestOutput(output, "bun"));
    expect({ total: count.total, failures: count.failures }).toEqual({ total: 4, failures: 1 });
  });

  // A green run whose test logs `loaded: 4 todo items`: read as four todo tests,
  // `Ran 4` would drop to an executed total of zero.
  test("bun: `N todo` in a log line is not the todo counter", () => {
    const output = [
      "b.test.ts:",
      "loaded: 4 todo items",
      "",
      " 4 pass",
      " 0 fail",
      " 4 expect() calls",
      "Ran 4 tests across 2 files. [2.00ms]",
    ].join("\n");
    const count = assertOk(parseTestOutput(output, "bun"));
    expect(count.total).toBe(4);
  });

  // Bun writes `1 file.` in the singular, so the last summary below is the
  // single-file one; and the first suite's two todo tests belong to its own
  // summary, not to the second one's `Ran 6`.
  test("bun: a single-file last summary and an earlier suite's todos are read from their own blocks", () => {
    const output = [
      " 1 pass",
      " 2 todo",
      " 0 fail",
      "Ran 3 tests across 2 files. [1.00ms]",
      " 6 pass",
      " 0 fail",
      "Ran 6 tests across 1 file. [2.00ms]",
    ].join("\n");
    const count = assertOk(parseTestOutput(output, "bun"));
    expect({ total: count.total, failures: count.failures, skipped: count.skipped }).toEqual({
      total: 6,
      failures: 0,
      skipped: 0,
    });
  });

  // A smoke step prints its own `0 passed` before the real summary line.
  test("pytest: an earlier `0 passed` does not shadow the final summary", () => {
    const output = ["smoke: 0 passed", "======= 17 passed, 3 skipped in 2.41s ======="].join("\n");
    const count = assertOk(parseTestOutput(output, "pytest"));
    expect({ total: count.total, failures: count.failures, skipped: count.skipped }).toEqual({
      total: 17,
      failures: 0,
      skipped: 3,
    });
  });
});

describe("parseTestOutput — unknown / malformed", () => {
  test("unknown stack returns ok: false", () => {
    const result = parseTestOutput("whatever", "unknown");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/unknown stack|unrecognized/i);
  });

  test("empty output for bun returns ok: false", () => {
    const result = parseTestOutput("", "bun");
    expect(result.ok).toBe(false);
  });

  test("garbage output for pytest returns ok: false", () => {
    const result = parseTestOutput("some random output\nno counters here", "pytest");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/could not determine|no test counters/i);
  });

  test("garbage output for flutter returns ok: false", () => {
    const result = parseTestOutput("Error running tests", "flutter");
    expect(result.ok).toBe(false);
  });
});
