import { describe, expect, test } from "bun:test";
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
