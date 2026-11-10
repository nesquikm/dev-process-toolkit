// STE-732 (M_b2fdc0) — shared fixture for the Vitest / Cargo / Playwright suites.
//
// Not a test file (no `.test.ts` suffix): the parser suite, the capture suite
// and the mutation battery (`m_b2fdc0-ste-732-*.test.ts`) all drive the LEGS
// below — the suites against the shipped `adapters/_shared/src`, the battery
// against a mutated copy. One definition, so the battery cannot grade a leg the
// suites do not run.
//
// The recorded outputs are the runners' own summary shapes (Vitest's
// `Test Files` + `Tests` block, Cargo's one `test result:` line per test
// binary, Playwright's list-reporter footer). Front-door legs reuse STE-730's
// fake-runner-on-PATH fixture: fake scripts in a private bin directory print
// the recorded output, and the front doors run as subprocesses.
//
// All names are synthetic.

import { existsSync } from "node:fs";
import { join } from "node:path";

import {
  STORE_REL,
  makeBin,
  makeProject,
  runBaselineCapture,
  runGateCapture,
  settingsYaml,
  show,
  totalsLines,
  type DoorRun,
  type TestCommandEntry,
} from "./_m_b2fdc0_ste730_fixture";

export {
  PLUGIN_ROOT,
  SHIPPED_SRC,
  STORE_REL,
  baselineRecord,
  cleanupTemps,
  makeBin,
  makeProject,
  runBaselineCapture,
  runGateCapture,
  settingsYaml,
  show,
  tempDir,
  totalsLines,
} from "./_m_b2fdc0_ste730_fixture";
export type { DoorRun, FakeBin, TestCommandEntry } from "./_m_b2fdc0_ste730_fixture";

const text = (lines: readonly string[]): string => lines.map((l) => `${l}\n`).join("");

// ------------------------------------------------------------------ recorded outputs

/** `vitest run`, all green: 2 files, 5 tests. A parser reading `Test Files` says 2. */
export const VITEST_GREEN: readonly string[] = [
  "",
  " RUN  v2.1.8 /work/demo",
  "",
  " ✓ src/math.test.ts (3 tests) 4ms",
  " ✓ src/strings.test.ts (2 tests) 2ms",
  "",
  " Test Files  2 passed (2)",
  "      Tests  5 passed (5)",
  "   Start at  12:00:00",
  "   Duration  412ms (transform 40ms, setup 0ms, collect 51ms, tests 6ms, environment 0ms, prepare 120ms)",
  "",
];
/** `vitest run`, mixed: Tests 1 failed | 6 passed | 2 skipped | 1 todo (10). Test Files says 1 failed | 2 passed. */
export const VITEST_MIXED: readonly string[] = [
  "",
  " RUN  v2.1.8 /work/demo",
  "",
  " ✓ src/math.test.ts (3 tests) 4ms",
  " ❯ src/cart.test.ts (5 tests | 1 failed | 2 skipped) 9ms",
  "   × cart > totals the order 3ms",
  "     → expected 41 to be 42 // Object.is equality",
  " ✓ src/strings.test.ts (2 tests | 1 todo) 2ms",
  "",
  "⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯",
  "",
  " FAIL  src/cart.test.ts > cart > totals the order",
  "AssertionError: expected 41 to be 42 // Object.is equality",
  "",
  " Test Files  1 failed | 2 passed (3)",
  "      Tests  1 failed | 6 passed | 2 skipped | 1 todo (10)",
  "   Start at  12:00:00",
  "   Duration  530ms",
  "",
];
/** A truncated Vitest run: the `Test Files` line is there, the `Tests` line is not. */
export const VITEST_NO_TESTS_LINE: readonly string[] = [
  " ✓ src/math.test.ts (3 tests) 4ms",
  " ✓ src/strings.test.ts (2 tests) 2ms",
  "",
  " Test Files  2 passed (2)",
  "   Duration  412ms",
];

/** `cargo test`, green: two binaries — 2 passed + 1 ignored, then doc-tests 2 passed. */
export const CARGO_GREEN: readonly string[] = [
  "   Compiling demo v0.1.0 (/work/demo)",
  "    Finished `test` profile [unoptimized + debuginfo] target(s) in 0.52s",
  "     Running unittests src/lib.rs (target/debug/deps/demo-0a1b2c3d4e5f6a7b)",
  "",
  "running 3 tests",
  "test tests::adds ... ok",
  "test tests::slow_path ... ignored",
  "test tests::subtracts ... ok",
  "",
  "test result: ok. 2 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out; finished in 0.00s",
  "",
  "   Doc-tests demo",
  "",
  "running 2 tests",
  "test src/lib.rs - add (line 3) ... ok",
  "test src/lib.rs - sub (line 9) ... ok",
  "",
  "test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.21s",
  "",
];
/** `cargo test`, three binaries: (2 passed, 1 ignored) + (3 passed) + (1 passed, 1 failed) → 6 / 1 / 1. */
export const CARGO_MIXED: readonly string[] = [
  "    Finished `test` profile [unoptimized + debuginfo] target(s) in 0.31s",
  "     Running unittests src/lib.rs (target/debug/deps/demo-0a1b2c3d4e5f6a7b)",
  "",
  "running 3 tests",
  "test tests::adds ... ok",
  "test tests::slow_path ... ignored",
  "test tests::subtracts ... ok",
  "",
  "test result: ok. 2 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out; finished in 0.00s",
  "",
  "     Running tests/api.rs (target/debug/deps/api-1b2c3d4e5f6a7b8c)",
  "",
  "running 3 tests",
  "test lists ... ok",
  "test creates ... ok",
  "test deletes ... ok",
  "",
  "test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s",
  "",
  "     Running tests/worker.rs (target/debug/deps/worker-2c3d4e5f6a7b8c9d)",
  "",
  "running 2 tests",
  "test drains ... ok",
  "test retries ... FAILED",
  "",
  "failures:",
  "",
  "---- retries stdout ----",
  "thread 'retries' panicked at tests/worker.rs:12:5:",
  "assertion `left == right` failed",
  "  left: 2",
  " right: 3",
  "",
  "failures:",
  "    retries",
  "",
  "test result: FAILED. 1 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s",
  "",
  "error: test failed, to rerun pass `--test worker`",
];
/** A compile failure: no `test result:` line at all. */
export const CARGO_COMPILE_ERROR: readonly string[] = [
  "   Compiling demo v0.1.0 (/work/demo)",
  "error[E0425]: cannot find value `totl` in this scope",
  " --> src/lib.rs:4:5",
  "  |",
  "4 |     totl",
  "  |     ^^^^ help: a local variable with a similar name exists: `total`",
  "",
  "error: could not compile `demo` (lib test) due to 1 previous error",
];

/** `playwright test`, list reporter: 1 failed, 1 flaky, 2 skipped, 3 passed → pass 4 (flaky counts), fail 1, skip 2. */
export const PLAYWRIGHT_MIXED: readonly string[] = [
  "",
  "Running 7 tests using 2 workers",
  "",
  "  ✓  1 [chromium] › tests/home.spec.ts:3:5 › shows the title (410ms)",
  "  ✓  2 [chromium] › tests/cart.spec.ts:8:5 › lists 9 passed orders (380ms)",
  "  -  3 [chromium] › tests/cart.spec.ts:20:10 › exports a csv",
  "  -  4 [chromium] › tests/cart.spec.ts:28:10 › prints a receipt",
  "  ✘  5 [chromium] › tests/login.spec.ts:5:5 › signs in (1.2s)",
  "  ✘  6 [chromium] › tests/search.spec.ts:4:5 › finds a product (900ms)",
  "  ✓  7 [chromium] › tests/search.spec.ts:4:5 › finds a product (retry #1) (600ms)",
  "  ✓  8 [chromium] › tests/home.spec.ts:9:5 › shows the footer (300ms)",
  "",
  "  1) [chromium] › tests/login.spec.ts:5:5 › signs in ──────────────────────────",
  "",
  "    Error: expect(received).toBe(expected)",
  "",
  "    Expected: 2",
  "    Received: 1",
  "",
  "  1 failed",
  "    [chromium] › tests/login.spec.ts:5:5 › signs in ───────────────────────────",
  "  1 flaky",
  "    [chromium] › tests/search.spec.ts:4:5 › finds a product ───────────────────",
  "  2 skipped",
  "  3 passed (4.2s)",
];
/** `playwright test`, green: 4 passed. */
export const PLAYWRIGHT_GREEN: readonly string[] = [
  "",
  "Running 4 tests using 2 workers",
  "",
  "  ✓  1 [chromium] › tests/home.spec.ts:3:5 › shows the title (410ms)",
  "  ✓  2 [chromium] › tests/home.spec.ts:9:5 › shows the footer (300ms)",
  "  ✓  3 [chromium] › tests/cart.spec.ts:8:5 › lists orders (380ms)",
  "  ✓  4 [chromium] › tests/search.spec.ts:4:5 › finds a product (600ms)",
  "",
  "  4 passed (2.1s)",
];
/** Playwright found nothing to run: no summary footer. */
export const PLAYWRIGHT_NO_TESTS: readonly string[] = [
  "Error: No tests found.",
  "Make sure that arguments are regular expressions matching test files.",
  "You may need to escape symbols like \"$\" or \"*\" and quote the arguments.",
];

/** Exact derived counts per recorded output (`deriveRunCounts` shape). */
export const EXPECTED = {
  VITEST_GREEN: { pass: 5, fail: 0, skip: 0 },
  VITEST_MIXED: { pass: 6, fail: 1, skip: 3 },
  CARGO_GREEN: { pass: 4, fail: 0, skip: 1 },
  CARGO_MIXED: { pass: 6, fail: 1, skip: 1 },
  PLAYWRIGHT_MIXED: { pass: 4, fail: 1, skip: 2 },
  PLAYWRIGHT_GREEN: { pass: 4, fail: 0, skip: 0 },
} as const;

/**
 * The v3.3.0 corpus: bun / pytest / flutter recorded outputs with the counts
 * v3.3.0's `deriveRunCounts` derives from them (measured against that release).
 * AC-STE-732.4 / .8: every one stays exactly as it was.
 */
export const LEGACY_CORPUS: ReadonlyArray<{ label: string; stack: "bun" | "pytest" | "flutter"; output: string; expected: { pass: number; fail: number; skip: number } }> = [
  { label: "bun summary", stack: "bun", output: text([" 4 pass", " 1 skip", " 1 fail", "Ran 6 tests across 2 files."]), expected: { pass: 4, fail: 1, skip: 1 } },
  {
    label: "bun multi-file",
    stack: "bun",
    output: text(["tests/a.test.ts:", " 2 pass", " 0 fail", "tests/b.test.ts:", " 3 pass", " 1 skip", " 1 fail", "", " 5 pass", " 1 skip", " 1 fail", "Ran 7 tests across 2 files. [120ms]"]),
    expected: { pass: 5, fail: 1, skip: 1 },
  },
  { label: "bun fallback (no Ran line)", stack: "bun", output: text([" 3 pass", " 0 fail"]), expected: { pass: 3, fail: 0, skip: 0 } },
  { label: "pytest mixed", stack: "pytest", output: text(["============ 1 failed, 3 passed, 2 skipped in 0.10s ============"]), expected: { pass: 3, fail: 1, skip: 2 } },
  { label: "pytest skip", stack: "pytest", output: text(["============ 4 passed, 1 skipped in 0.10s ============"]), expected: { pass: 4, fail: 0, skip: 1 } },
  { label: "pytest error", stack: "pytest", output: text(["============ 2 passed, 1 error in 0.20s ============"]), expected: { pass: 2, fail: 1, skip: 0 } },
  { label: "flutter green", stack: "flutter", output: text(["00:01 +5 ~1: All tests passed!"]), expected: { pass: 5, fail: 0, skip: 1 } },
  { label: "flutter red", stack: "flutter", output: text(["00:02 +3 -1: Some tests failed."]), expected: { pass: 3, fail: 1, skip: 0 } },
];

export const out = text;

// ------------------------------------------------------------------ coloured recordings (FORCE_COLOR)
//
// Phase 3 review: the same three runs as above, recorded with FORCE_COLOR=1.
// Each runner wraps its summary in SGR sequences — Vitest dims the padded
// label so the line STARTS with ESC, Cargo colours only the `ok` / `FAILED`
// word inside the `test result:` line, and Playwright wraps the whole footer
// line (leading spaces included) in its colour. Each must parse to exactly the
// plain recording's counts.

const E = "\x1b";

/** VITEST_GREEN with FORCE_COLOR=1. */
export const VITEST_GREEN_ANSI: readonly string[] = [
  "",
  ` ${E}[46m RUN ${E}[49m ${E}[36mv2.1.8 ${E}[39m${E}[90m/work/demo${E}[39m`,
  "",
  ` ${E}[32m✓${E}[39m src/math.test.ts ${E}[2m(${E}[22m${E}[2m3 tests${E}[22m${E}[2m)${E}[22m${E}[90m 4${E}[2mms${E}[22m${E}[39m`,
  ` ${E}[32m✓${E}[39m src/strings.test.ts ${E}[2m(${E}[22m${E}[2m2 tests${E}[22m${E}[2m)${E}[22m${E}[90m 2${E}[2mms${E}[22m${E}[39m`,
  "",
  `${E}[2m Test Files ${E}[22m ${E}[1m${E}[32m2 passed${E}[39m${E}[22m${E}[90m (2)${E}[39m`,
  `${E}[2m      Tests ${E}[22m ${E}[1m${E}[32m5 passed${E}[39m${E}[22m${E}[90m (5)${E}[39m`,
  `${E}[2m   Start at ${E}[22m 12:00:00`,
  `${E}[2m   Duration ${E}[22m 412ms${E}[2m (transform 40ms, setup 0ms, collect 51ms, tests 6ms, environment 0ms, prepare 120ms)${E}[22m`,
  "",
];
/** VITEST_MIXED with FORCE_COLOR=1: Tests 1 failed | 6 passed | 2 skipped | 1 todo (10). */
export const VITEST_MIXED_ANSI: readonly string[] = [
  "",
  ` ${E}[46m RUN ${E}[49m ${E}[36mv2.1.8 ${E}[39m${E}[90m/work/demo${E}[39m`,
  "",
  ` ${E}[32m✓${E}[39m src/math.test.ts ${E}[2m(${E}[22m${E}[2m3 tests${E}[22m${E}[2m)${E}[22m${E}[90m 4${E}[2mms${E}[22m${E}[39m`,
  ` ${E}[33m❯${E}[39m src/cart.test.ts ${E}[2m(${E}[22m${E}[2m5 tests${E}[22m${E}[2m | ${E}[22m${E}[31m1 failed${E}[39m${E}[2m | ${E}[22m${E}[33m2 skipped${E}[39m${E}[2m)${E}[22m${E}[90m 9${E}[2mms${E}[22m${E}[39m`,
  `   ${E}[31m×${E}[39m cart > totals the order${E}[90m 3${E}[2mms${E}[22m${E}[39m`,
  `     ${E}[31m→ expected 41 to be 42 // Object.is equality${E}[39m`,
  ` ${E}[32m✓${E}[39m src/strings.test.ts ${E}[2m(${E}[22m${E}[2m2 tests${E}[22m${E}[2m | ${E}[22m${E}[90m1 todo${E}[39m${E}[2m)${E}[22m${E}[90m 2${E}[2mms${E}[22m${E}[39m`,
  "",
  `${E}[31m⎯⎯⎯⎯⎯⎯⎯${E}[39m${E}[1m${E}[41m Failed Tests 1 ${E}[49m${E}[22m${E}[31m⎯⎯⎯⎯⎯⎯⎯${E}[39m`,
  "",
  `${E}[41m${E}[1m FAIL ${E}[22m${E}[49m src/cart.test.ts${E}[2m > ${E}[22mcart${E}[2m > ${E}[22mtotals the order`,
  `${E}[31m${E}[1mAssertionError${E}[22m: expected 41 to be 42 // Object.is equality${E}[39m`,
  "",
  `${E}[2m Test Files ${E}[22m ${E}[1m${E}[31m1 failed${E}[39m${E}[22m${E}[2m | ${E}[22m${E}[1m${E}[32m2 passed${E}[39m${E}[22m${E}[90m (3)${E}[39m`,
  `${E}[2m      Tests ${E}[22m ${E}[1m${E}[31m1 failed${E}[39m${E}[22m${E}[2m | ${E}[22m${E}[1m${E}[32m6 passed${E}[39m${E}[22m${E}[2m | ${E}[22m${E}[33m2 skipped${E}[39m${E}[2m | ${E}[22m${E}[90m1 todo${E}[39m${E}[90m (10)${E}[39m`,
  `${E}[2m   Start at ${E}[22m 12:00:00`,
  `${E}[2m   Duration ${E}[22m 530ms`,
  "",
];

/** CARGO_GREEN with `--color always`: green `ok`, bold-green `Running`. */
export const CARGO_GREEN_ANSI: readonly string[] = [
  `${E}[1m${E}[32m   Compiling${E}[0m demo v0.1.0 (/work/demo)`,
  `${E}[1m${E}[32m    Finished${E}[0m \`test\` profile [unoptimized + debuginfo] target(s) in 0.52s`,
  `${E}[1m${E}[32m     Running${E}[0m unittests src/lib.rs (target/debug/deps/demo-0a1b2c3d4e5f6a7b)`,
  "",
  "running 3 tests",
  `test tests::adds ... ${E}[32mok${E}[0m`,
  `test tests::slow_path ... ${E}[33mignored${E}[0m`,
  `test tests::subtracts ... ${E}[32mok${E}[0m`,
  "",
  `test result: ${E}[32mok${E}[0m. 2 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out; finished in 0.00s`,
  "",
  `${E}[1m${E}[32m   Doc-tests${E}[0m demo`,
  "",
  "running 2 tests",
  `test src/lib.rs - add (line 3) ... ${E}[32mok${E}[0m`,
  `test src/lib.rs - sub (line 9) ... ${E}[32mok${E}[0m`,
  "",
  `test result: ${E}[32mok${E}[0m. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.21s`,
  "",
];
/** CARGO_MIXED with `--color always`: the failing binary's `FAILED` is red. */
export const CARGO_MIXED_ANSI: readonly string[] = [
  `${E}[1m${E}[32m    Finished${E}[0m \`test\` profile [unoptimized + debuginfo] target(s) in 0.31s`,
  `${E}[1m${E}[32m     Running${E}[0m unittests src/lib.rs (target/debug/deps/demo-0a1b2c3d4e5f6a7b)`,
  "",
  "running 3 tests",
  `test tests::adds ... ${E}[32mok${E}[0m`,
  `test tests::slow_path ... ${E}[33mignored${E}[0m`,
  `test tests::subtracts ... ${E}[32mok${E}[0m`,
  "",
  `test result: ${E}[32mok${E}[0m. 2 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out; finished in 0.00s`,
  "",
  `${E}[1m${E}[32m     Running${E}[0m tests/api.rs (target/debug/deps/api-1b2c3d4e5f6a7b8c)`,
  "",
  "running 3 tests",
  `test lists ... ${E}[32mok${E}[0m`,
  `test creates ... ${E}[32mok${E}[0m`,
  `test deletes ... ${E}[32mok${E}[0m`,
  "",
  `test result: ${E}[32mok${E}[0m. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s`,
  "",
  `${E}[1m${E}[32m     Running${E}[0m tests/worker.rs (target/debug/deps/worker-2c3d4e5f6a7b8c9d)`,
  "",
  "running 2 tests",
  `test drains ... ${E}[32mok${E}[0m`,
  `test retries ... ${E}[31mFAILED${E}[0m`,
  "",
  "failures:",
  "",
  "---- retries stdout ----",
  "thread 'retries' panicked at tests/worker.rs:12:5:",
  "assertion `left == right` failed",
  "  left: 2",
  " right: 3",
  "",
  "failures:",
  "    retries",
  "",
  `test result: ${E}[31mFAILED${E}[0m. 1 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s`,
  "",
  `${E}[1m${E}[31merror${E}[0m${E}[1m: test failed, to rerun pass \`--test worker\`${E}[0m`,
];

/** PLAYWRIGHT_MIXED with FORCE_COLOR=1: each footer line is wrapped whole, leading spaces inside the colour. */
export const PLAYWRIGHT_MIXED_ANSI: readonly string[] = [
  "",
  `Running 7 tests using 2 workers`,
  "",
  `  ${E}[32m✓${E}[39m  ${E}[2m1 [chromium] › tests/home.spec.ts:3:5 › shows the title${E}[22m${E}[2m (410ms)${E}[22m`,
  `  ${E}[32m✓${E}[39m  ${E}[2m2 [chromium] › tests/cart.spec.ts:8:5 › lists 9 passed orders${E}[22m${E}[2m (380ms)${E}[22m`,
  `  ${E}[33m-${E}[39m  ${E}[2m3 [chromium] › tests/cart.spec.ts:20:10 › exports a csv${E}[22m`,
  `  ${E}[33m-${E}[39m  ${E}[2m4 [chromium] › tests/cart.spec.ts:28:10 › prints a receipt${E}[22m`,
  `  ${E}[31m✘${E}[39m  ${E}[2m5 [chromium] › tests/login.spec.ts:5:5 › signs in${E}[22m${E}[2m (1.2s)${E}[22m`,
  `  ${E}[31m✘${E}[39m  ${E}[2m6 [chromium] › tests/search.spec.ts:4:5 › finds a product${E}[22m${E}[2m (900ms)${E}[22m`,
  `  ${E}[32m✓${E}[39m  ${E}[2m7 [chromium] › tests/search.spec.ts:4:5 › finds a product (retry #1)${E}[22m${E}[2m (600ms)${E}[22m`,
  `  ${E}[32m✓${E}[39m  ${E}[2m8 [chromium] › tests/home.spec.ts:9:5 › shows the footer${E}[22m${E}[2m (300ms)${E}[22m`,
  "",
  `${E}[31m  1) [chromium] › tests/login.spec.ts:5:5 › signs in ──────────────────────────${E}[39m`,
  "",
  `    Error: ${E}[2mexpect(${E}[22m${E}[31mreceived${E}[39m${E}[2m).${E}[22mtoBe${E}[2m(${E}[22m${E}[32mexpected${E}[39m${E}[2m)${E}[22m`,
  "",
  `    Expected: ${E}[32m2${E}[39m`,
  `    Received: ${E}[31m1${E}[39m`,
  "",
  `${E}[31m  1 failed${E}[39m`,
  `    [chromium] › tests/login.spec.ts:5:5 › signs in ───────────────────────────`,
  `${E}[33m  1 flaky${E}[39m`,
  `    [chromium] › tests/search.spec.ts:4:5 › finds a product ───────────────────`,
  `${E}[33m  2 skipped${E}[39m`,
  `${E}[32m  3 passed${E}[39m${E}[2m (4.2s)${E}[22m`,
];
/** PLAYWRIGHT_GREEN with FORCE_COLOR=1. */
export const PLAYWRIGHT_GREEN_ANSI: readonly string[] = [
  "",
  `Running 4 tests using 2 workers`,
  "",
  `  ${E}[32m✓${E}[39m  ${E}[2m1 [chromium] › tests/home.spec.ts:3:5 › shows the title${E}[22m${E}[2m (410ms)${E}[22m`,
  `  ${E}[32m✓${E}[39m  ${E}[2m2 [chromium] › tests/home.spec.ts:9:5 › shows the footer${E}[22m${E}[2m (300ms)${E}[22m`,
  `  ${E}[32m✓${E}[39m  ${E}[2m3 [chromium] › tests/cart.spec.ts:8:5 › lists orders${E}[22m${E}[2m (380ms)${E}[22m`,
  `  ${E}[32m✓${E}[39m  ${E}[2m4 [chromium] › tests/search.spec.ts:4:5 › finds a product${E}[22m${E}[2m (600ms)${E}[22m`,
  "",
  `${E}[32m  4 passed${E}[39m${E}[2m (2.1s)${E}[22m`,
];

// ------------------------------------------------------------------ Vitest unhandled errors

/**
 * `vitest run` where every test passed but 2 unhandled errors were caught
 * (Vitest exits 1 and prints an `Errors` line under `Tests`). A run that
 * passes this through as green is a false pass.
 */
export const VITEST_UNHANDLED_ERRORS: readonly string[] = [
  "",
  " RUN  v2.1.8 /work/demo",
  "",
  " ✓ src/math.test.ts (3 tests) 4ms",
  " ✓ src/strings.test.ts (2 tests) 2ms",
  "",
  "⎯⎯⎯⎯⎯⎯ Unhandled Errors ⎯⎯⎯⎯⎯⎯",
  "",
  "Vitest caught 2 unhandled errors during the test run.",
  "This might cause false positive tests. Resolve unhandled errors to make sure your tests are not affected.",
  "",
  "⎯⎯⎯⎯ Unhandled Rejection ⎯⎯⎯⎯⎯",
  "Error: socket hang up",
  " ❯ src/net.ts:14:11",
  "",
  "⎯⎯⎯⎯ Unhandled Rejection ⎯⎯⎯⎯⎯",
  "Error: timer fired after teardown",
  " ❯ src/clock.ts:8:3",
  "",
  " Test Files  2 passed (2)",
  "      Tests  5 passed (5)",
  "     Errors  2 errors",
  "   Start at  12:00:00",
  "   Duration  450ms",
  "",
];

// ------------------------------------------------------------------ bun / pytest runs that merely print a foreign-looking line
//
// Phase 3 review: a test fixture (or a test's own stdout) can print a line that
// LOOKS like another runner's summary. Without the rest of that runner's
// summary shape — a Vitest `Tests` line after `Test Files`, Cargo's
// `N failed; N ignored;` tail — it is not that runner's output, and the
// declared parser must read the run exactly as v3.3.0 did.

/** A bun run whose test prints a bare `Test Files` line (no Vitest `Tests` line follows). */
export const BUN_PRINTS_TEST_FILES: readonly string[] = [
  "bun test v1.3.0",
  "",
  "tests/report.test.ts:",
  " Test Files  2 passed (2)",
  "(pass) report > renders a vitest-style header [1.20ms]",
  "(pass) report > renders an empty header [0.30ms]",
  "",
  " 2 pass",
  " 0 fail",
  "Ran 2 tests across 1 files. [40.00ms]",
];
/** A bun run whose test prints a bare `test result: ok. 3 passed;` (no Cargo tail). */
export const BUN_PRINTS_CARGO_HEAD: readonly string[] = [
  "bun test v1.3.0",
  "",
  "tests/cargo_log.test.ts:",
  "test result: ok. 3 passed;",
  "(pass) cargo log > echoes the head of a result line [0.90ms]",
  "(fail) cargo log > parses an empty log [0.40ms]",
  "(skip) cargo log > parses a colour log",
  "",
  " 1 pass",
  " 1 skip",
  " 1 fail",
  "Ran 3 tests across 1 files. [35.00ms]",
];
/** A pytest -s run whose test prints a bare `Test Files` line. */
export const PYTEST_PRINTS_TEST_FILES: readonly string[] = [
  "============================= test session starts ==============================",
  "collected 4 items",
  "",
  "tests/test_report.py ",
  " Test Files  2 passed (2)",
  "....",
  "",
  "============================== 4 passed in 0.12s ===============================",
];
/** A pytest -s run whose test prints a bare `test result: ok. 3 passed;`. */
export const PYTEST_PRINTS_CARGO_HEAD: readonly string[] = [
  "============================= test session starts ==============================",
  "collected 3 items",
  "",
  "tests/test_cargo_log.py ",
  "test result: ok. 3 passed;",
  "..F",
  "",
  "=========================== short test summary info ============================",
  "FAILED tests/test_cargo_log.py::test_empty - AssertionError",
  "========================= 1 failed, 2 passed in 0.20s ==========================",
];

// ------------------------------------------------------------------ package.json bodies

export const PKG_VITEST_DEV = `${JSON.stringify({ name: "ste732", private: true, devDependencies: { typescript: "^5.6.0", vitest: "^2.1.8" } }, null, 2)}\n`;
export const PKG_VITEST_DEP = `${JSON.stringify({ name: "ste732", private: true, dependencies: { vitest: "^2.1.8" } }, null, 2)}\n`;
export const PKG_PLAIN = `${JSON.stringify({ name: "ste732", private: true, devDependencies: { typescript: "^5.6.0", "@types/bun": "^1.1.0" } }, null, 2)}\n`;

/** A green bun run the table's `bun test` would print — present on PATH so a wrongly-chosen bun run shows. */
export const BUN_SUMMARY: readonly string[] = [" 7 pass", " 0 skip", " 0 fail", "Ran 7 tests across 3 files."];

// ------------------------------------------------------------------ legs

/** One assertion bundle; resolves null when it holds, else why not. */
export interface Leg {
  readonly name: string;
  /** A permit leg grades behaviour that must hold on every mutant (v3.3.0 behaviour). */
  readonly permit: boolean;
  readonly check: (srcRoot: string) => Promise<string | null>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Mod = any;

async function derive(src: string): Promise<(run: { output: string; stack: string }) => Mod> {
  const m: Mod = await import(join(src, "deliver_stage_evidence.ts"));
  return m.deriveRunCounts;
}

async function parse(src: string): Promise<(output: string, stack: string) => Mod> {
  const m: Mod = await import(join(src, "test_count_parser.ts"));
  return m.parseTestOutput;
}

function eq(label: string, actual: unknown, expected: unknown): string | null {
  return JSON.stringify(actual) === JSON.stringify(expected) ? null : `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
}

function all(list: Array<string | null>, extra = ""): string | null {
  const bad = list.filter((p): p is string => p !== null);
  return bad.length === 0 ? null : `${bad.join("\n")}${extra ? `\n${extra}` : ""}`;
}

function countLeg(name: string, stack: string, lines: readonly string[], expected: { pass: number; fail: number; skip: number }): Leg {
  return {
    name,
    permit: false,
    check: async (src) => {
      const d = await derive(src);
      return eq(`deriveRunCounts(${stack})`, d({ output: text(lines), stack }), { ok: true, ...expected });
    },
  };
}

function refuseLeg(name: string, stack: string, lines: readonly string[]): Leg {
  return {
    name,
    permit: false,
    check: async (src) => {
      const p = await parse(src);
      const r = p(text(lines), stack);
      if (r?.ok !== false) return `parseTestOutput(${stack}) did not refuse: ${JSON.stringify(r)}`;
      if (typeof r.reason !== "string" || r.reason.length === 0) return `parseTestOutput(${stack}) refused without a reason: ${JSON.stringify(r)}`;
      return null;
    },
  };
}

function mislabelLeg(name: string, stack: "bun" | "pytest", lines: readonly string[], runner: RegExp): Leg {
  return {
    name,
    permit: false,
    check: async (src) => {
      const p = await parse(src);
      const r = p(text(lines), stack);
      if (r?.ok !== false) return `parseTestOutput(${stack}) read another runner's output instead of refusing: ${JSON.stringify(r)}`;
      if (!runner.test(String(r.reason))) return `the ${stack} refusal does not name the detected runner (${runner}): ${JSON.stringify(r.reason)}`;
      return null;
    },
  };
}

function refusalProblems(r: DoorRun): Array<string | null> {
  const both = `${r.stdout}\n${r.stderr}`;
  const remedy = both.split("\n").find((l) => /Remedy:/.test(l)) ?? "";
  return [
    r.exitCode === 0 ? "the front door exited 0 — a refusal must exit non-zero" : null,
    remedy === "" ? "no `Remedy:` line (NFR-10 shape)" : null,
    /Context:/.test(both) ? null : "no `Context:` line (NFR-10 shape)",
    remedy.includes("verification.test_commands") ? null : "the Remedy line does not name `verification.test_commands`",
    /\bvitest\b/.test(remedy) ? null : "the Remedy line does not name stack `vitest`",
  ];
}

export const VITEST_TABLE_BIN = () => [
  { name: "bun", out: BUN_SUMMARY },
  { name: "npx", out: VITEST_GREEN },
  { name: "vitest", out: VITEST_GREEN },
];

/** Three declared entries, one per new stack, all through fake runners. */
export const NEW_STACK_ENTRIES: TestCommandEntry[] = [
  { stack: "vitest", command: ["npx", "vitest", "run"] },
  { stack: "cargo", command: ["cargo", "test", "--manifest-path", "service/Cargo.toml"] },
  { stack: "playwright", command: ["npx", "playwright", "test"] },
];
/** VITEST_MIXED + CARGO_GREEN + PLAYWRIGHT_MIXED. */
export const NEW_STACK_SUM = { pass: 6 + 4 + 4, fail: 1 + 0 + 1, skip: 3 + 1 + 2 };

export function newStackWorld(label: string, git: boolean) {
  const bin = makeBin(label, [
    { name: "npx", byArg: { vitest: VITEST_MIXED, playwright: PLAYWRIGHT_MIXED }, exitCode: 1 },
    { name: "cargo", out: CARGO_GREEN },
    { name: "bun", out: BUN_SUMMARY },
  ]);
  const root = makeProject(label, { marker: "package.json", settings: settingsYaml(NEW_STACK_ENTRIES), files: { "package.json": PKG_VITEST_DEV }, git });
  return { bin, root };
}

export function mislabelWorld(label: string, git: boolean) {
  const bin = makeBin(label, [
    { name: "npx", byArg: { vitest: VITEST_GREEN } },
    { name: "bun", out: BUN_SUMMARY },
  ]);
  const entries: TestCommandEntry[] = [{ stack: "pytest", command: ["npx", "vitest", "run"] }];
  const root = makeProject(label, { marker: "package.json", settings: settingsYaml(entries), files: { "package.json": PKG_VITEST_DEV }, git });
  return { bin, root };
}

export const LEGS: Leg[] = [
  // ---- permit legs: v3.3.0 behaviour that no mutation here may disturb
  {
    name: "PERMIT parsers — every bun / pytest / flutter corpus output derives its v3.3.0 counts",
    permit: true,
    check: async (src) => {
      const d = await derive(src);
      return all(LEGACY_CORPUS.map((c) => eq(c.label, d({ output: c.output, stack: c.stack }), { ok: true, ...c.expected })));
    },
  },
  {
    name: "PERMIT gate — a package.json without vitest keeps the table's bun test",
    permit: true,
    check: async (src) => {
      const bin = makeBin("p732-gate", [{ name: "bun", out: BUN_SUMMARY }]);
      const root = makeProject("p732-gate", { marker: "package.json", settings: settingsYaml(), files: { "package.json": PKG_PLAIN } });
      const r = runGateCapture(src, root, bin);
      return all(
        [
          eq("calls", bin.calls().map((c) => c.name), ["bun"]),
          eq("totals", totalsLines(r), ["gate_capture: pass 7, fail 0, skip 0"]),
        ],
        show(r),
      );
    },
  },

  // ---- per-parser legs (summary-line requirement)
  countLeg("PARSER vitest COUNT — reads the Tests line, not the Test Files line (green)", "vitest", VITEST_GREEN, EXPECTED.VITEST_GREEN),
  countLeg("PARSER vitest COUNT — failed, passed, skipped + todo from the Tests line (mixed)", "vitest", VITEST_MIXED, EXPECTED.VITEST_MIXED),
  refuseLeg("PARSER vitest REFUSE — no Tests line, only Test Files", "vitest", VITEST_NO_TESTS_LINE),
  refuseLeg("PARSER vitest REFUSE — a Cargo run is not a Vitest run", "vitest", CARGO_GREEN),
  countLeg("PARSER cargo COUNT — sums every test result line (green)", "cargo", CARGO_GREEN, EXPECTED.CARGO_GREEN),
  countLeg("PARSER cargo COUNT — sums every test result line (three binaries, one failing)", "cargo", CARGO_MIXED, EXPECTED.CARGO_MIXED),
  refuseLeg("PARSER cargo REFUSE — a compile error prints no test result line", "cargo", CARGO_COMPILE_ERROR),
  refuseLeg("PARSER cargo REFUSE — a Vitest run is not a Cargo run", "cargo", VITEST_MIXED),
  countLeg("PARSER playwright COUNT — failed, flaky (as passed), skipped, passed", "playwright", PLAYWRIGHT_MIXED, EXPECTED.PLAYWRIGHT_MIXED),
  countLeg("PARSER playwright COUNT — green", "playwright", PLAYWRIGHT_GREEN, EXPECTED.PLAYWRIGHT_GREEN),
  refuseLeg("PARSER playwright REFUSE — no tests found prints no summary", "playwright", PLAYWRIGHT_NO_TESTS),
  refuseLeg("PARSER playwright REFUSE — a Cargo run is not a Playwright run", "playwright", CARGO_MIXED),

  // ---- mislabel legs
  mislabelLeg("MISLABEL pytest — Vitest output refuses, naming vitest", "pytest", VITEST_GREEN, /vitest/i),
  mislabelLeg("MISLABEL pytest — Cargo output refuses, naming cargo", "pytest", CARGO_GREEN, /cargo/i),
  mislabelLeg("MISLABEL bun — Vitest output refuses, naming vitest", "bun", VITEST_MIXED, /vitest/i),
  mislabelLeg("MISLABEL bun — Cargo output refuses, naming cargo", "bun", CARGO_MIXED, /cargo/i),
  {
    name: "MISLABEL gate — a Vitest output declared as pytest refuses at gate_capture",
    permit: false,
    check: async (src) => {
      const { bin, root } = mislabelWorld("ml-gate", false);
      const r = runGateCapture(src, root, bin);
      const both = `${r.stdout}\n${r.stderr}`;
      return all(
        [
          r.exitCode === 0 ? "gate_capture exited 0 on a mislabelled entry" : null,
          /Remedy:/.test(both) ? null : "no `Remedy:` line (NFR-10 shape)",
          /vitest/i.test(r.stderr) ? null : "the refusal does not name the detected runner vitest",
          totalsLines(r).some((l) => /pass \d+/.test(l)) ? "a totals line with numbers was printed" : null,
        ],
        show(r),
      );
    },
  },
  {
    name: "MISLABEL baseline — a Vitest output declared as pytest refuses and writes no baseline",
    permit: false,
    check: async (src) => {
      const { bin, root } = mislabelWorld("ml-base", true);
      const r = runBaselineCapture(src, root, bin);
      return all(
        [
          r.exitCode === 0 ? "capture_skip_baseline exited 0 on a mislabelled entry" : null,
          /vitest/i.test(`${r.stdout}\n${r.stderr}`) ? null : "the refusal does not name the detected runner vitest",
          existsSync(join(root, STORE_REL)) ? "a baseline store was written" : null,
        ],
        show(r),
      );
    },
  },

  // ---- Phase 3 review: coloured output (FORCE_COLOR) reads the same counts as plain
  countLeg("ANSI vitest COUNT — coloured green run reads the Tests line", "vitest", VITEST_GREEN_ANSI, EXPECTED.VITEST_GREEN),
  countLeg("ANSI vitest COUNT — coloured mixed run reads the Tests line", "vitest", VITEST_MIXED_ANSI, EXPECTED.VITEST_MIXED),
  countLeg("ANSI cargo COUNT — coloured green run sums every test result line", "cargo", CARGO_GREEN_ANSI, EXPECTED.CARGO_GREEN),
  countLeg("ANSI cargo COUNT — coloured three-binary run sums every test result line", "cargo", CARGO_MIXED_ANSI, EXPECTED.CARGO_MIXED),
  countLeg("ANSI playwright COUNT — coloured green footer", "playwright", PLAYWRIGHT_GREEN_ANSI, EXPECTED.PLAYWRIGHT_GREEN),
  countLeg("ANSI playwright COUNT — coloured mixed footer (flaky as passed)", "playwright", PLAYWRIGHT_MIXED_ANSI, EXPECTED.PLAYWRIGHT_MIXED),
  mislabelLeg("ANSI MISLABEL pytest — coloured Vitest output refuses, naming vitest", "pytest", VITEST_GREEN_ANSI, /vitest/i),
  mislabelLeg("ANSI MISLABEL bun — coloured Vitest output refuses, naming vitest", "bun", VITEST_MIXED_ANSI, /vitest/i),
  mislabelLeg("ANSI MISLABEL pytest — coloured Cargo output refuses, naming cargo", "pytest", CARGO_GREEN_ANSI, /cargo/i),
  mislabelLeg("ANSI MISLABEL bun — coloured Cargo output refuses, naming cargo", "bun", CARGO_MIXED_ANSI, /cargo/i),
  {
    name: "PERMIT parsers — coloured bun / pytest / flutter outputs derive exactly their v3.3.0 counts",
    permit: true,
    check: async (src) => {
      const d = await derive(src);
      return all(LEGACY_ANSI_CORPUS.map((c) => eq(c.label, d({ output: c.output, stack: c.stack }), { ok: true, ...LEGACY_ANSI_EXPECTED[c.label] })));
    },
  },

  // ---- Phase 3 review: a foreign-LOOKING line is not a foreign run
  {
    name: "PERMIT mislabel — a bun / pytest run that merely prints a bare `Test Files` or `test result: ok. N passed;` line keeps its v3.3.0 counts",
    permit: true,
    check: async (src) => {
      const d = await derive(src);
      return all(
        FOREIGN_LOOKING_RUNS.map((c) => eq(c.label, d({ output: text(c.lines), stack: c.stack }), { ok: true, ...c.expected })),
      );
    },
  },

  // ---- Phase 3 review: Vitest unhandled errors fail the run
  {
    name: "PARSER vitest ERRORS — `Errors  2 errors` reports errors 2 and fails the run",
    permit: false,
    check: async (src) => {
      const p = await parse(src);
      const d = await derive(src);
      const r = p(text(VITEST_UNHANDLED_ERRORS), "vitest");
      return all([
        r?.ok === true ? null : `parseTestOutput(vitest) refused: ${JSON.stringify(r)}`,
        eq("parseTestOutput(vitest).count.errors", r?.count?.errors, 2),
        eq("deriveRunCounts(vitest)", d({ output: text(VITEST_UNHANDLED_ERRORS), stack: "vitest" }), { ok: true, pass: 5, fail: 2, skip: 0 }),
      ]);
    },
  },

  // ---- the Vitest table refusal
  {
    name: "TABLE vitest gate — devDependencies vitest: gate_capture refuses naming verification.test_commands, bun never runs",
    permit: false,
    check: async (src) => {
      const bin = makeBin("tv-gate", VITEST_TABLE_BIN());
      const root = makeProject("tv-gate", { marker: "package.json", settings: settingsYaml(), files: { "package.json": PKG_VITEST_DEV } });
      const r = runGateCapture(src, root, bin);
      return all(
        [
          eq("calls", bin.calls().map((c) => c.name), []),
          ...refusalProblems(r),
          totalsLines(r).some((l) => /pass \d+/.test(l)) ? "a totals line with numbers was printed" : null,
        ],
        show(r),
      );
    },
  },
  {
    name: "TABLE vitest gate — dependencies vitest: gate_capture refuses too",
    permit: false,
    check: async (src) => {
      const bin = makeBin("tv-gate-dep", VITEST_TABLE_BIN());
      const root = makeProject("tv-gate-dep", { marker: "package.json", settings: null, files: { "package.json": PKG_VITEST_DEP } });
      const r = runGateCapture(src, root, bin);
      return all([eq("calls", bin.calls().map((c) => c.name), []), ...refusalProblems(r)], show(r));
    },
  },
  {
    name: "TABLE vitest baseline — capture_skip_baseline refuses naming verification.test_commands, writes no baseline, bun never runs",
    permit: false,
    check: async (src) => {
      const bin = makeBin("tv-base", VITEST_TABLE_BIN());
      const root = makeProject("tv-base", { marker: "package.json", settings: settingsYaml(), files: { "package.json": PKG_VITEST_DEV }, git: true });
      const r = runBaselineCapture(src, root, bin);
      return all(
        [
          eq("calls", bin.calls().map((c) => c.name), []),
          ...refusalProblems(r),
          existsSync(join(root, STORE_REL)) ? "a baseline store was written" : null,
        ],
        show(r),
      );
    },
  },
];

export const LEG_BY_NAME = new Map(LEGS.map((l) => [l.name, l]));

/** Run one leg by name against `src`; null when it holds. */
export async function runLeg(name: string, src: string): Promise<string | null> {
  const l = LEG_BY_NAME.get(name);
  if (l === undefined) throw new Error(`unknown leg ${name}`);
  return l.check(src);
}


// ------------------------------------------------------------------ coloured bun / pytest / flutter (AC-STE-732.8)
//
// The ANSI fix for the three new parsers must not reach these: each derives
// exactly what v3.3.0 derives from the same coloured bytes (measured against
// the v3.3.0 parser), whether or not that release stripped colour.

export const LEGACY_ANSI_CORPUS: ReadonlyArray<{ label: string; stack: "bun" | "pytest" | "flutter"; output: string }> = [
  {
    label: "bun coloured summary",
    stack: "bun",
    output: text([
      "tests/a.test.ts:",
      "\x1b[0m\x1b[32m(pass)\x1b[0m a > adds \x1b[0m\x1b[2m[0.20ms]\x1b[0m",
      "",
      "\x1b[0m\x1b[32m 4 pass\x1b[0m",
      "\x1b[0m\x1b[33m 1 skip\x1b[0m",
      "\x1b[0m\x1b[31m 1 fail\x1b[0m",
      "Ran 6 tests across 2 files. \x1b[0m\x1b[2m[120.00ms]\x1b[0m",
    ]),
  },
  {
    label: "bun coloured fallback (no Ran line)",
    stack: "bun",
    output: text(["\x1b[0m\x1b[32m 3 pass\x1b[0m", "\x1b[0m\x1b[2m 0 fail\x1b[0m"]),
  },
  {
    label: "pytest coloured mixed",
    stack: "pytest",
    output: text(["\x1b[31m============ \x1b[31m\x1b[1m1 failed\x1b[0m, \x1b[32m3 passed\x1b[0m, \x1b[33m2 skipped\x1b[0m\x1b[31m in 0.10s\x1b[0m\x1b[31m ============\x1b[0m"]),
  },
  {
    label: "pytest coloured error",
    stack: "pytest",
    output: text(["\x1b[31m============ \x1b[32m2 passed\x1b[0m, \x1b[31m\x1b[1m1 error\x1b[0m\x1b[31m in 0.20s\x1b[0m\x1b[31m ============\x1b[0m"]),
  },
  { label: "flutter coloured green", stack: "flutter", output: text(["00:01 \x1b[32m+5\x1b[0m \x1b[33m~1\x1b[0m: All tests passed!"]) },
  { label: "flutter coloured red", stack: "flutter", output: text(["00:02 \x1b[32m+3\x1b[0m \x1b[31m-1\x1b[0m: \x1b[31mSome tests failed.\x1b[0m"]) },
];

/** What v3.3.0's `deriveRunCounts` derives from each coloured corpus entry (measured at e9d6c655). */
export const LEGACY_ANSI_EXPECTED: Record<string, { pass: number; fail: number; skip: number }> = {
  "bun coloured summary": { pass: 4, fail: 1, skip: 1 },
  "bun coloured fallback (no Ran line)": { pass: 3, fail: 0, skip: 0 },
  "pytest coloured mixed": { pass: 3, fail: 1, skip: 2 },
  "pytest coloured error": { pass: 2, fail: 1, skip: 0 },
  // v3.3.0's flutter skip anchor does not see through colour; that stays as shipped.
  "flutter coloured green": { pass: 5, fail: 0, skip: 0 },
  "flutter coloured red": { pass: 3, fail: 1, skip: 0 },
};

/**
 * bun / pytest runs that merely PRINT a foreign-looking line, with the counts
 * v3.3.0's `deriveRunCounts` derives from them (measured at e9d6c655). The
 * pytest parser's first-match `N passed` reads the printed line — that is
 * v3.3.0's count, kept as shipped.
 */
export const FOREIGN_LOOKING_RUNS: ReadonlyArray<{ label: string; stack: "bun" | "pytest"; lines: readonly string[]; expected: { pass: number; fail: number; skip: number } }> = [
  { label: "bun prints a bare Test Files line", stack: "bun", lines: BUN_PRINTS_TEST_FILES, expected: { pass: 2, fail: 0, skip: 0 } },
  { label: "bun prints a bare cargo result head", stack: "bun", lines: BUN_PRINTS_CARGO_HEAD, expected: { pass: 1, fail: 1, skip: 1 } },
  { label: "pytest prints a bare Test Files line", stack: "pytest", lines: PYTEST_PRINTS_TEST_FILES, expected: { pass: 2, fail: 0, skip: 0 } },
  { label: "pytest prints a bare cargo result head", stack: "pytest", lines: PYTEST_PRINTS_CARGO_HEAD, expected: { pass: 3, fail: 1, skip: 0 } },
];
