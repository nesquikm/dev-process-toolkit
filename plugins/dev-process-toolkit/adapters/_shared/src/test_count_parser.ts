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

export type Stack = "bun" | "pytest" | "flutter" | "unknown";

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
// Bun's run summary is a block: counter lines (`N pass`, `N skip`, `N todo`,
// `N fail`, `N expect() calls`, …) directly above `Ran N tests across M
// files.` — `test` and `file` in the singular when N or M is 1. A command that
// runs two suites prints two such blocks, and `skip` / `todo` lines appear only
// when non-zero, so a counter read anywhere else in the capture can come from
// the other suite, a test name (`renders 3 todo items`) or a log line. Every
// counter is therefore read from the block above the LAST `Ran` line.
const BUN_RAN_RE = /Ran (\d+) tests? across \d+ files?\b/;
const BUN_SUMMARY_COUNTER_RE = /^\s*(\d+)\s+(pass|fail|skip|todo|errors?|snapshots?|expect\(\) calls)\b/;
const PYTEST_SKIPPED_RE = /(\d+)\s+skipped/g;
// The pytest counters read the LAST summary, like `skipped` above: a gate
// command running pytest twice, or a smoke step that prints its own
// `0 passed` before the real summary, otherwise hands the first run's count to
// the second run's verdict.
const PYTEST_PASSED_RE = /(\d+)\s+passed/g;
const PYTEST_FAILED_RE = /(\d+)\s+failed/g;
const PYTEST_ERRORS_RE = /(\d+)\s+errors?\b/g;
// A coloured capture puts SGR escape codes between a counter and its colon
// (`+3\x1b[0m:`), which no counter pattern spans. They carry no count, so every
// stack reads the capture with them removed.
const ANSI_SGR_RE = /\x1b\[[0-9;]*m/g;
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
//
// The shape alone is still not enough: a test NAME can carry it. `flutter
// test` repeats every failing test's name in a `Failing tests:` block after
// the last progress line, so a test named `total +5 -0: rounding` put a later
// `+5 -0:` after the real totals and a red run read green. Every counter is
// therefore anchored to the start of a progress line too — its elapsed-time
// stamp is what no name or path repeats at the start of a line. test_core
// prints it as minutes and two-digit seconds with the minutes unbounded
// (`00:03`, and `100:03` past 100 minutes — never an hour field); an
// `H:MM:SS` stamp is accepted as well.
const FLUTTER_SKIPPED_RE = /^\s*\d+(?::\d{2}){1,2}\s+\+\d+\s+~(\d+)(?=\s*(?:-\d+)?\s*:)/gm;
// The pass and fail counters take the same anchoring. A real `flutter test`
// capture prints one cumulative progress line per test and opens with
// `00:00 +0: loading …`, so a first-match `+N` read 0 on every run and a
// first-match `-N` read the first failure (or any hyphen-digit in a path)
// rather than the run's total. Only the LAST progress line carries the totals:
// `+P` is on every progress line, and `~S` / `-F` print once non-zero and only
// grow, so each counter's last match inside the `+P[ ~S][ -F]:` shape is that
// line's value.
const FLUTTER_PASSED_RE = /^\s*\d+(?::\d{2}){1,2}\s+\+(\d+)(?=(?:\s+~\d+)?(?:\s+-\d+)?\s*:)/gm;
const FLUTTER_FAILED_RE = /^\s*\d+(?::\d{2}){1,2}\s+\+\d+(?:\s+~\d+)?\s+-(\d+)(?=\s*:)/gm;

/**
 * The last bun summary: the `N` of its `Ran N tests` line and the counter lines
 * directly above it. `undefined` when the capture has no `Ran` line.
 */
function lastBunSummary(output: string): { ran: number; counters: Map<string, number> } | undefined {
  const lines = output.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const ran = BUN_RAN_RE.exec(lines[i]);
    if (!ran) continue;
    // A summary block names each counter once. Walking up from `Ran`, a counter
    // seen a second time belongs to an earlier block that happens to touch this
    // one (per-file counters printed with no line between) — stop there.
    const counters = new Map<string, number>();
    for (let j = i - 1; j >= 0; j--) {
      const counter = BUN_SUMMARY_COUNTER_RE.exec(lines[j]);
      if (!counter || counters.has(counter[2])) break;
      counters.set(counter[2], Number(counter[1]));
    }
    return { ran: Number(ran[1]), counters };
  }
  return undefined;
}

function parseBun(output: string): TestCountParseResult {
  const summary = lastBunSummary(output);
  // The usual capture: every counter from the last summary block. A counter
  // the block does not print is zero — bun omits `skip` and `todo` at zero.
  // STE-683 defines `total` as pass + fail + skip, and `Ran N` also counts
  // todo tests, which never execute: left in, they read as passes downstream.
  if (summary !== undefined && summary.counters.size > 0) {
    const { ran, counters } = summary;
    const failures = counters.get("fail") ?? 0;
    const skipped = counters.get("skip") ?? 0;
    const todo = counters.get("todo") ?? 0;
    return { ok: true, count: { total: ran - todo, failures, errors: 0, skipped } };
  }

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

  // A `Ran` line with no counter lines directly above it (a trimmed or
  // reformatted capture): `Ran N` is the total, the counters come last-match.
  if (summary !== undefined) {
    return { ok: true, count: { total: summary.ran, failures, errors, skipped } };
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
  const passedCount = lastCountedMatch(output, PYTEST_PASSED_RE);
  const failedCount = lastCountedMatch(output, PYTEST_FAILED_RE);
  if (passedCount === undefined && failedCount === undefined) {
    return { ok: false, reason: "could not determine test count — no test counters in pytest output" };
  }
  const passed = passedCount ?? 0;
  const failed = failedCount ?? 0;
  const errors = lastCountedMatch(output, PYTEST_ERRORS_RE) ?? 0;
  const skipped = lastCountedMatch(output, PYTEST_SKIPPED_RE) ?? 0;
  return { ok: true, count: { total: passed + failed + errors, failures: failed, errors, skipped } };
}

function parseFlutter(output: string): TestCountParseResult {
  const pass = lastCountedMatch(output, FLUTTER_PASSED_RE);
  if (pass === undefined) {
    return { ok: false, reason: "could not determine test count — no `+N[ ~S][ -F]:` progress line in flutter output" };
  }
  const fail = lastCountedMatch(output, FLUTTER_FAILED_RE) ?? 0;
  const skipped = lastCountedMatch(output, FLUTTER_SKIPPED_RE) ?? 0;
  return { ok: true, count: { total: pass + fail, failures: fail, errors: 0, skipped } };
}

export function parseTestOutput(output: string, stack: Stack): TestCountParseResult {
  const plain = output.replace(ANSI_SGR_RE, "");
  switch (stack) {
    case "bun":
      return parseBun(plain);
    case "pytest":
      return parsePytest(plain);
    case "flutter":
      return parseFlutter(plain);
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
// Usage — `<stack>` is one of bun | pytest | flutter | unknown:
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
