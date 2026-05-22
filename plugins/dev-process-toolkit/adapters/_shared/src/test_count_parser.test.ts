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
    // Legacy first-match would yield 4; spec requires 2891.
    expect(result.count.total).toBe(2891);
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
  // AC-STE-323.5: pytest emits a SINGLE summary line; first-match is safe.
  // Confirm existing pytest behavior is unchanged.
  test("AC-STE-323.5: pytest first-match harmless — single summary line in real output", () => {
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

  // AC-STE-323.5: flutter emits a SINGLE `+N -F` line; first-match is safe.
  test("AC-STE-323.5: flutter first-match harmless — single +N/-F line in real output", () => {
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
