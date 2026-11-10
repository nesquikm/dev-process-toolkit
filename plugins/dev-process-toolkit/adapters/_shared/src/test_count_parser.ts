// STE-73 AC-STE-73.12 — parse test-gate output into a `{ total, failures,
// errors }` triple for the CHANGELOG closing line:
//
//     Total test count at release: <N> tests, <F> failures, <E> errors.
//
// Stack dispatch table — bun / pytest / flutter are the three stacks
// /ship-milestone targets explicitly (AC-STE-73.12 enumerates these);
// `unknown` is the NFR-10 fallback that surfaces a "could not determine
// test count" refusal asking the user to specify or skip the line. New
// stacks should land via a new FR updating AC-STE-73.12 — adding them
// here without AC coverage is undocumented scope creep.

// STE-508: `skipped` is the fourth counter. It is reported ALONGSIDE the
// legacy three, never folded into `total` — the /ship-milestone CHANGELOG
// closing line reads exactly `total`/`failures`/`errors` and must render
// byte-identically for a skip-bearing run.
export interface TestCount {
  total: number;
  failures: number;
  errors: number;
  skipped: number;
}

/**
 * The three counters the CHANGELOG closing line states — `skipped` deliberately
 * excluded, per {@link renderClosingLine}'s note.
 *
 * Named once here because it is a CROSS-MODULE shape: the renderer takes it,
 * and `release_config`'s `BumpOptions.testCount` / `bumpChangelog` forward it
 * unchanged. Three separate spellings of the same `Pick<>` is how a fourth
 * counter gets folded into one of them and not the others.
 */
export type ClosingLineCount = Pick<TestCount, "total" | "failures" | "errors">;

export type TestCountParseResult =
  | { ok: true; count: TestCount }
  | { ok: false; reason: string };

export type Stack = "bun" | "pytest" | "flutter" | "vitest" | "cargo" | "playwright" | "unknown";

// STE-323: Bun emits per-file `N pass` / `N fail` counters BEFORE the summary
// block in multi-file runs, so a `.exec()` first-match captures the first
// per-file count rather than the total. Use last-match (`matchAll` + take
// final group) for both counters. Hoisted so the pass-fallback and the
// fail-extractor share one implementation.
function lastCountedMatch(output: string, regex: RegExp): number | undefined {
  const matches = Array.from(output.matchAll(regex));
  if (matches.length === 0) return undefined;
  return Number(matches[matches.length - 1][1]);
}

// STE-508: skip counters must be last-match anchored on every stack — per-file
// `N skip` blocks precede bun's summary, a gate command running pytest twice
// lands two summary lines, and flutter prints a cumulative `~N` progress line
// per test — so an earlier counter would otherwise shadow the run total. Each
// stack's pattern lives here as a module-level `/g` constant handed to the
// hoisted `lastCountedMatch` helper: grouping the three side by side is what
// makes the per-runner spellings (`N skip` / `N skipped` / `~N`) comparable,
// and it is also required for pytest and flutter, whose function bodies
// STE-323 AC-323.5 audits for the absence of `matchAll` and inline `/g`
// literals. `matchAll` never mutates the shared `lastIndex`, so these
// constants are safe to reuse across calls.
const BUN_SKIPPED_RE = /(\d+)\s+skip\b/g;
const PYTEST_SKIPPED_RE = /(\d+)\s+skipped/g;
// M132: last-match alone is only half the guard for flutter. Gate commands run
// `flutter test 2>&1`, so a buffered stderr failure block flushes AFTER the
// final stdout progress line — and flutter's expanded reporter prints tildes
// inside expected/actual values and colon-laden stack frames. A bare `~(\d+)`
// sweep therefore lets a LATER non-counter shadow the real total, the mirror of
// the earlier-counter shadowing AC-STE-508.3 closed. Anchor on the counter's
// own shape instead: `~N` is a counter only inside a `+P ~S[ -F]:` progress
// line, i.e. immediately preceded by the pass counter and followed by the
// optional fail counter and the line's colon. Both flutter progress shapes
// (with and without `-N`) still match; prose tildes no longer can.
const FLUTTER_SKIPPED_RE = /\+\d+\s+~(\d+)(?=\s*(?:-\d+)?\s*:)/g;

function parseBun(output: string): TestCountParseResult {
  // STE-323: anchor on Bun's trailing summary line, not the first match.
  // Bun emits per-file `N pass` / `N fail` counters before the summary in
  // multi-file runs, so the legacy `.exec()` first-match path captured the
  // first per-file count, not the total. Fix: use last-match for both
  // counters, and prefer the canonical `Ran N tests across M files` line
  // for the total.
  const failures = lastCountedMatch(output, /(\d+)\s+fail\b/g) ?? 0;
  // STE-508: same last-match anchoring as `fail` — per-file `N skip` counters
  // precede the summary block in multi-file runs.
  const skipped = lastCountedMatch(output, BUN_SKIPPED_RE) ?? 0;
  // Bun does not emit a distinct "error" line; errors are folded into fail.
  const errors = 0;

  // Primary anchor: Bun's "Ran N tests across M files" summary line.
  const summaryMatch = /Ran (\d+) tests across \d+ files/.exec(output);
  if (summaryMatch) {
    return { ok: true, count: { total: Number(summaryMatch[1]), failures, errors, skipped } };
  }
  // Fallback: last `N pass` line (older Bun versions or truncated output).
  // STE-683: `total` carries the `Ran N tests` meaning (pass + fail + skip),
  // so downstream `total - fail - skip` recovers the pass counter.
  const lastPass = lastCountedMatch(output, /(\d+)\s+pass\b/g);
  if (lastPass !== undefined) {
    return { ok: true, count: { total: lastPass + failures + skipped, failures, errors, skipped } };
  }
  return {
    ok: false,
    reason: "could not determine test count — Bun output lacks both `Ran N tests` summary and `N pass` summary line",
  };
}

function parsePytest(output: string): TestCountParseResult {
  const passedMatch = /(\d+)\s+passed/.exec(output);
  const failedMatch = /(\d+)\s+failed/.exec(output);
  const errorsMatch = /(\d+)\s+errors?\b/.exec(output);
  if (!passedMatch && !failedMatch) {
    return { ok: false, reason: "could not determine test count — no test counters in pytest output" };
  }
  const passed = passedMatch ? Number(passedMatch[1]) : 0;
  const failed = failedMatch ? Number(failedMatch[1]) : 0;
  const errors = errorsMatch ? Number(errorsMatch[1]) : 0;
  const skipped = lastCountedMatch(output, PYTEST_SKIPPED_RE) ?? 0;
  return { ok: true, count: { total: passed + failed + errors, failures: failed, errors, skipped } };
}

function parseFlutter(output: string): TestCountParseResult {
  const passMatch = /\+(\d+)/.exec(output);
  const failMatch = /-(\d+)/.exec(output);
  if (!passMatch && !failMatch) {
    return { ok: false, reason: "could not determine test count — no +N/-N counters in flutter output" };
  }
  const pass = passMatch ? Number(passMatch[1]) : 0;
  const fail = failMatch ? Number(failMatch[1]) : 0;
  const skipped = lastCountedMatch(output, FLUTTER_SKIPPED_RE) ?? 0;
  return { ok: true, count: { total: pass + fail, failures: fail, errors: 0, skipped } };
}

// STE-732: the three non-bun stacks below share pytest's `total` meaning —
// pass + fail, skips reported alongside and never folded in — so
// `deriveRunCounts`'s `total - fail` recovers the pass counter.

// Vitest prints `Test Files` (file counts) and `Tests` (test counts); only the
// latter is the run's count. Anchored on the line's own label at line start.
// STE-732: the three new parsers read FORCE_COLOR output too — Vitest dims the
// padded label so its line starts with ESC, Cargo colours the `ok` / `FAILED`
// word, Playwright wraps the whole footer line. SGR sequences are stripped
// before matching; bun / pytest / flutter keep reading raw output as v3.3.0 did.
const SGR_RE = /\x1b\[[0-9;]*m/g;
const stripSgr = (output: string): string => output.replace(SGR_RE, "");

function parseVitest(raw: string): TestCountParseResult {
  const output = stripSgr(raw);
  const lines = Array.from(output.matchAll(/^\s*Tests\s+(.+)$/gm));
  if (lines.length === 0) {
    return { ok: false, reason: "could not determine test count — Vitest output lacks the `Tests` summary line" };
  }
  const line = lines[lines.length - 1][1];
  const n = (word: string): number => Number(new RegExp(`(\\d+)\\s+${word}\\b`).exec(line)?.[1] ?? 0);
  const passed = n("passed");
  // A test file that throws on import fails under `Test Files` yet adds nothing
  // to `Tests`, so a `Tests` line alone reads green. Every file failing on its
  // own tests already counts at least one failed test, so the larger of the two
  // counters is folded in — a mixed run is not counted twice.
  const fileLines = Array.from(output.matchAll(/^\s*Test Files\s+(.+)$/gm));
  const failedFiles = fileLines.length === 0 ? 0 : Number(/(\d+)\s+failed\b/.exec(fileLines[fileLines.length - 1][1])?.[1] ?? 0);
  const failed = Math.max(n("failed"), failedFiles);
  const skipped = n("skipped") + n("todo");
  // Unhandled errors (`Errors  N errors` under `Tests`) fail the run even when
  // every test passed; `total` folds them in as pytest's does.
  const errors = lastCountedMatch(output, /^\s*Errors\s+(\d+)\s+errors?\b/gm) ?? 0;
  return { ok: true, count: { total: passed + failed + errors, failures: failed, errors, skipped } };
}

// Cargo prints one `test result:` line per test binary (and one for doc-tests);
// the run's count is their sum.
const CARGO_TEST_FAILED_RE = /^error: test failed\b/m;
const CARGO_PROCESS_FAILED_RE = /process didn't exit successfully/;
function parseCargo(raw: string): TestCountParseResult {
  const output = stripSgr(raw);
  const results = Array.from(
    output.matchAll(/^test result: \w+\. (\d+) passed; (\d+) failed; (\d+) ignored;/gm),
  );
  if (results.length === 0) {
    return { ok: false, reason: "could not determine test count — Cargo output has no `test result:` line" };
  }
  let passed = 0;
  let failed = 0;
  let ignored = 0;
  for (const r of results) {
    passed += Number(r[1]);
    failed += Number(r[2]);
    ignored += Number(r[3]);
  }
  // A binary that crashes (stack overflow, SIGABRT) prints no `test result:`
  // line, so the other binaries' lines sum to fail 0. Cargo still reports the
  // run as failed; either signature line makes the run carry one error.
  const testFailed = CARGO_TEST_FAILED_RE.test(output);
  const processFailed = CARGO_PROCESS_FAILED_RE.test(output);
  const errors = failed === 0 && (testFailed || processFailed) ? 1 : 0;
  return { ok: true, count: { total: passed + failed + errors, failures: failed, errors, skipped: ignored } };
}

// Playwright's footer is one `N <outcome>` line per outcome; a flaky test
// passed on retry and counts as passed. Anchored on the whole footer line so a
// test title containing `9 passed` cannot be read as a counter.
function parsePlaywright(raw: string): TestCountParseResult {
  const output = stripSgr(raw);
  const footer = (word: string): number | undefined =>
    lastCountedMatch(output, new RegExp(`^\\s*(\\d+) ${word}(?: \\([^)]*\\))?\\s*$`, "gm"));
  const passed = footer("passed");
  const failed = footer("failed");
  const flaky = footer("flaky");
  const skipped = footer("skipped");
  // A global timeout stops the run: the test it stopped is `interrupted`, the
  // ones it never started `did not run`. Both are failures.
  const interrupted = footer("interrupted");
  const didNotRun = footer("did not run");
  const counters = [passed, failed, flaky, skipped, interrupted, didNotRun];
  if (counters.every((c) => c === undefined)) {
    return { ok: false, reason: "could not determine test count — Playwright output lacks the summary footer" };
  }
  const pass = (passed ?? 0) + (flaky ?? 0);
  const fail = (failed ?? 0) + (interrupted ?? 0) + (didNotRun ?? 0);
  return { ok: true, count: { total: pass + fail, failures: fail, errors: 0, skipped: skipped ?? 0 } };
}

// STE-732 AC-STE-732.4: the bun and pytest counters are loose enough to read a
// Vitest `Test Files  2 passed` or a Cargo `2 passed;` as a run, so a mislabelled
// stack refuses instead, naming the runner whose summary the output carries.
// Only the runner's whole summary shape counts — a Vitest `Test Files` line
// followed by its `Tests` line, a Cargo `test result:` line with its
// `N failed; N ignored;` tail — so a bun / pytest test that merely prints one
// such line keeps its v3.3.0 count. Detection reads through colour.
function detectForeignRunner(raw: string): "vitest" | "cargo" | undefined {
  const output = stripSgr(raw);
  if (/^\s*Test Files\s+\d+\s+\w+.*$[\s\S]*?^\s*Tests\s+\d+\s+\w+/m.test(output)) return "vitest";
  if (/^test result: \w+\. \d+ passed; \d+ failed; \d+ ignored;/m.test(output)) return "cargo";
  return undefined;
}

function refuseForeign(output: string, stack: "bun" | "pytest"): TestCountParseResult | undefined {
  const runner = detectForeignRunner(output);
  if (runner === undefined) return undefined;
  return {
    ok: false,
    reason: `could not determine test count — the output declared as ${stack} carries a ${runner} summary; declare stack \`${runner}\` for this command`,
  };
}

export function parseTestOutput(output: string, stack: Stack): TestCountParseResult {
  switch (stack) {
    case "bun":
      return refuseForeign(output, "bun") ?? parseBun(output);
    case "pytest":
      return refuseForeign(output, "pytest") ?? parsePytest(output);
    case "flutter":
      return parseFlutter(output);
    case "vitest":
      return parseVitest(output);
    case "cargo":
      return parseCargo(output);
    case "playwright":
      return parsePlaywright(output);
    case "unknown":
    default:
      return { ok: false, reason: "unknown stack — cannot parse test output" };
  }
}

// STE-545 AC-STE-545.5: the CHANGELOG closing line has exactly ONE renderer,
// and it lives here — beside the parser that produces the numbers it states.
// A second copy (M132 kept one inside its own suite) is how the rendered
// sentence and the asserted sentence drift apart without a single test going
// red. It reads exactly three fields: `skipped` is reported alongside the
// legacy three by `TestCount`, never folded in and never rendered here —
// AC-STE-508.6 pins the byte-identical three-field output for a skip-bearing
// run, so the parameter type deliberately excludes `skipped` rather than
// merely ignoring it.
export function renderClosingLine(count: ClosingLineCount): string {
  return `Total test count at release: ${count.total} tests, ${count.failures} failures, ${count.errors} errors.`;
}

// ---------------------------------------------------------------------------
// Command-line front door
// ---------------------------------------------------------------------------

// M137 (PR #76 review finding C6). This module is the PRODUCER of the number
// the CHANGELOG's closing line states, and `/ship-milestone`'s write-boundary
// check makes it load-bearing for a release-blocking refusal — while it sat in
// exactly the ordered-and-unreachable shape that made C5 a finding: zero
// `import.meta.main` occurrences, against three in each altitude scanner.
//
// Usage — `<stack>` is one of bun | pytest | flutter | vitest | cargo | playwright | unknown:
//
//     bun run test_count_parser.ts <stack> [path-to-captured-output]
//
// With a path it reads that file; with no path it reads stdin, so a gate run
// can be piped straight in. It EXECUTES AND MEASURES: the four counters it
// prints are `parseTestOutput`'s own, on whatever output it was handed, so two
// different runs print two different totals. Unparseable input exits non-zero
// carrying the parser's OWN reason — a second wording here could drift from
// the one every other consumer surfaces, and a front door that reports success
// on garbage is worse than no front door at all.
//
// Imported by /ship-milestone's callers and by the suite, where
// `import.meta.main` is false and this block never runs: the module stays
// side-effect-free at import.
if (import.meta.main) {
  const stack = (process.argv[2] ?? "unknown") as Stack;
  const path = process.argv[3];
  const output =
    path === undefined ? await Bun.stdin.text() : await Bun.file(path).text();
  const result = parseTestOutput(output, stack);
  if (!result.ok) {
    process.stderr.write(`test_count_parser: ${result.reason}\n`);
    process.exit(1);
  }
  const { total, failures, errors, skipped } = result.count;
  console.log(`total=${total}`);
  console.log(`failures=${failures}`);
  console.log(`errors=${errors}`);
  console.log(`skipped=${skipped}`);
}
