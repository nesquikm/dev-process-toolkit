// STE-662 — the gate-capture front door prints its totals.
//
// AC-STE-662.6, AC-STE-662.7. `bun run gate_capture.ts [projectRoot]` already
// makes ONE gate run and prints the skip names it got back. It now also prints
// ONE totals line read by `parseTestOutput` from that same run's output —
//
//   gate_capture: pass <P>, fail <F>, skip <S>
//
// before the skip names, or `gate_capture: totals unreadable — <reason>` when
// the output yields no count. The exit codes keep their meaning.
//
// THE FRONT DOOR IS DRIVEN AS A SUBPROCESS, the way a reader runs it. The gate
// is DETECTED from stack markers, so each fixture is a project whose marker
// picks the runner:
//
//   * real `bun test` projects (marker `package.json`) for the honest path;
//   * a SHIM `bun` / `python3` on PATH for outputs a real runner will not
//     produce on demand — no readable count, a missing report, an unreadable
//     report, a runner with no report at all. The front door runs the identity
//     invocation through `/bin/sh -c "bun test ..."`, so a `bun` first on the
//     child's PATH is the runner it meets. The front door itself is launched by
//     `process.execPath`, an absolute path, so the shim never runs IT.
//
// The bun fixtures always span TWO test files: the parser's canonical anchor is
// `Ran N tests across M files`, and a one-file run prints `1 file`, which only
// the fallback reads.
//
// `STE662_SRC_ROOT` overrides the module root for the mutation battery
// (AC-STE-662.10).

import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { parseTestOutput } from "../adapters/_shared/src/test_count_parser";

const SRC_ROOT = process.env.STE662_SRC_ROOT ?? resolve(import.meta.dir, "../adapters/_shared/src");
const FRONT_DOOR = join(SRC_ROOT, "gate_capture.ts");

const TOTALS_RE = /^gate_capture: pass (\d+), fail (\d+), skip (\d+)$/;
const UNREADABLE_PREFIX = "gate_capture: totals unreadable — ";

// ===========================================================================
// Throwaway trees.
// ===========================================================================

const TEMP_DIRS: string[] = [];

function tempDir(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `ste662-gc-${label}-`));
  TEMP_DIRS.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of TEMP_DIRS.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A bun project with two test files carrying the given tests. */
function bunProject(label: string, files: Record<string, string[]>): string {
  const root = tempDir(`bun-${label}`);
  writeFileSync(join(root, "package.json"), `${JSON.stringify({ name: `ste662-${label}`, private: true })}\n`);
  mkdirSync(join(root, "tests"), { recursive: true });
  for (const [file, cases] of Object.entries(files)) {
    writeFileSync(
      join(root, "tests", file),
      ['import { expect, test } from "bun:test";', "", ...cases, ""].join("\n"),
    );
  }
  return root;
}

const PASS = (name: string) => `test(${JSON.stringify(name)}, () => { expect(1 + 1).toBe(2); });`;
const FAIL = (name: string) => `test(${JSON.stringify(name)}, () => { expect(1 + 1).toBe(3); });`;
// The fixture's skip call is assembled from parts so this line is not itself a
// skip call site: AC-STE-616.16 pins the suite's skip sites by name, and a
// string written into a temp project is not one of them.
const SKIP_CALL = ["test", "skip"].join(".");
const SKIP = (name: string) => `${SKIP_CALL}(${JSON.stringify(name)}, () => { expect(1).toBe(1); });`;

/** A project whose only marker is `marker`, with no real runner behind it. */
function markerProject(label: string, marker: string, contents = ""): string {
  const root = tempDir(`marker-${label}`);
  writeFileSync(join(root, marker), contents);
  return root;
}

const VALID_REPORT =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<testsuites name="shim" tests="2" skipped="1">' +
  '<testsuite name="tests/a.test.ts" file="tests/a.test.ts" tests="2" skipped="1">' +
  '<testcase name="runs" classname="a"></testcase>' +
  '<testcase name="is skipped" classname="a"><skipped /></testcase>' +
  "</testsuite></testsuites>\n";

const UNREADABLE_REPORT = '<testsuites name="shim"><testsuite name="cut off mid-write"';

interface ShimSpec {
  /** Executable name the shim stands in for (`bun`, `python3`). */
  readonly name: string;
  /** Lines printed to stdout. `$n` expands to this invocation's 1-based number. */
  readonly stdout: readonly string[];
  /** What to write at `--reporter-outfile=`, or `null` to write nothing. */
  readonly report: string | null;
  readonly exitCode: number;
}

interface Shim {
  readonly bin: string;
  /** How many times the shim was invoked. */
  invocations(): number;
}

function makeShim(label: string, spec: ShimSpec): Shim {
  const bin = tempDir(`shim-${label}`);
  const counter = join(bin, ".invocations");
  const reportFile = join(bin, ".report");
  if (spec.report !== null) writeFileSync(reportFile, spec.report);

  const script = [
    "#!/bin/sh",
    'out=""',
    'for a in "$@"; do',
    '  case "$a" in',
    '    --reporter-outfile=*) out="${a#--reporter-outfile=}" ;;',
    "  esac",
    "done",
    `n=$(cat '${counter}' 2>/dev/null || echo 0)`,
    "n=$((n + 1))",
    `echo "$n" > '${counter}'`,
    ...spec.stdout.map((line) => `echo "${line.replace(/"/g, '\\"')}"`),
    spec.report === null ? ":" : `if [ -n "$out" ]; then cp '${reportFile}' "$out"; fi`,
    `exit ${spec.exitCode}`,
    "",
  ].join("\n");
  const path = join(bin, spec.name);
  writeFileSync(path, script);
  chmodSync(path, 0o755);

  return {
    bin,
    invocations: () => (existsSync(counter) ? Number(readFileSync(counter, "utf-8").trim()) : 0),
  };
}

interface FrontDoorRun {
  readonly exitCode: number;
  readonly lines: string[];
  readonly stderr: string;
}

function runFrontDoor(projectRoot: string, shim?: Shim): FrontDoorRun {
  const env = { ...process.env };
  if (shim !== undefined) env.PATH = `${shim.bin}:${process.env.PATH ?? ""}`;
  const proc = Bun.spawnSync([process.execPath, FRONT_DOOR, projectRoot], {
    cwd: projectRoot,
    env,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 120_000,
  });
  return {
    exitCode: proc.exitCode ?? -1,
    lines: proc.stdout.toString().split("\n").filter((line) => line.length > 0),
    stderr: proc.stderr.toString(),
  };
}

function totalsLines(run: FrontDoorRun): string[] {
  return run.lines.filter((line) => line.startsWith("gate_capture: pass ") || line.startsWith("gate_capture: totals"));
}

function describeRun(run: FrontDoorRun): string {
  return `exit ${run.exitCode}\nstdout:\n${run.lines.join("\n")}\nstderr:\n${run.stderr}`;
}

// ===========================================================================
// AC-STE-662.6 — one totals line, from the same run, before the names.
// ===========================================================================

describe("AC-STE-662.6 — the front door prints one totals line from its own run", () => {
  test("a real green bun run with a skip prints `pass 3, fail 0, skip 1` once, before the names", () => {
    const root = bunProject("green", {
      "a.test.ts": [PASS("a one"), PASS("a two"), SKIP("a skipped")],
      "b.test.ts": [PASS("b one")],
    });
    const run = runFrontDoor(root);

    const totals = totalsLines(run);
    expect(totals, describeRun(run)).toEqual(["gate_capture: pass 3, fail 0, skip 1"]);

    const totalsAt = run.lines.indexOf("gate_capture: pass 3, fail 0, skip 1");
    const firstName = run.lines.findIndex((line) => line.startsWith("  "));
    expect(firstName, `the skip name is printed\n${describeRun(run)}`).toBeGreaterThan(-1);
    expect(run.lines[firstName]).toContain("a skipped");
    expect(totalsAt, "the totals line precedes the skip names").toBeLessThan(firstName);
  }, 120_000);

  test("a real red bun run prints its failure in the totals line", () => {
    const root = bunProject("red", {
      "a.test.ts": [PASS("a one"), FAIL("a broken"), SKIP("a skipped")],
      "b.test.ts": [PASS("b one")],
    });
    const run = runFrontDoor(root);
    expect(totalsLines(run), describeRun(run)).toEqual(["gate_capture: pass 2, fail 1, skip 1"]);
  }, 120_000);

  test("the numbers come from parseTestOutput on the SAME run's output — one run, not two", () => {
    // The shim prints different counters on every invocation. A front door
    // that ran the gate twice, or read a second run, would show run 2's
    // numbers or a count of 2 invocations.
    const shim = makeShim("same-run", {
      name: "bun",
      stdout: [" $n pass", " 2 skip", " 1 fail", "Ran $((n + 3)) tests across 2 files."],
      report: VALID_REPORT,
      exitCode: 1,
    });
    // Note: `$((n + 3))` is arithmetic in the shim's echo; run 1 prints 4.
    const root = markerProject("same-run", "package.json", '{"name":"shim","private":true}\n');
    const run = runFrontDoor(root, shim);

    expect(shim.invocations(), "the gate is run exactly once").toBe(1);

    const runOneOutput = " 1 pass\n 2 skip\n 1 fail\nRan 4 tests across 2 files.\n";
    const parsed = parseTestOutput(runOneOutput, "bun");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.count).toEqual({ total: 4, failures: 1, errors: 0, skipped: 2 });

    expect(totalsLines(run), describeRun(run)).toEqual(["gate_capture: pass 1, fail 1, skip 2"]);
  }, 120_000);

  test("output with no readable count prints the unreadable line with the parser's reason, and no number", () => {
    const garbage = "the runner said nothing countable";
    const shim = makeShim("unreadable-totals", {
      name: "bun",
      stdout: [garbage],
      report: VALID_REPORT,
      exitCode: 0,
    });
    const root = markerProject("unreadable-totals", "package.json", '{"name":"shim","private":true}\n');
    const run = runFrontDoor(root, shim);

    const parsed = parseTestOutput(`${garbage}\n`, "bun");
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;

    const totals = totalsLines(run);
    expect(totals, describeRun(run)).toEqual([`${UNREADABLE_PREFIX}${parsed.reason}`]);
    expect(run.lines.some((line) => TOTALS_RE.test(line)), "never a guessed number").toBe(false);
  }, 120_000);

  test("a runner with no report still prints its totals (pytest stack, fail and skip from the output)", () => {
    const shim = makeShim("pytest", {
      name: "python3",
      stdout: ["============ 1 failed, 3 passed, 2 skipped in 0.01s ============"],
      report: null,
      exitCode: 1,
    });
    const root = markerProject("pytest", "pytest.ini", "[pytest]\n");
    const run = runFrontDoor(root, shim);

    const totals = totalsLines(run);
    expect(totals.length, describeRun(run)).toBe(1);
    const match = TOTALS_RE.exec(totals[0] as string);
    expect(match, `totals line shape\n${describeRun(run)}`).not.toBeNull();
    if (match === null) return;
    expect(Number(match[2]), "fail").toBe(1);
    expect(Number(match[3]), "skip").toBe(2);
  }, 120_000);
});

// ===========================================================================
// AC-STE-662.7 — exit codes unchanged.
// ===========================================================================

describe("AC-STE-662.7 — the front door's exit codes keep their meaning", () => {
  test("skips named on a green run → exit 0", () => {
    const root = bunProject("exit-green", {
      "a.test.ts": [PASS("a one"), SKIP("a skipped")],
      "b.test.ts": [PASS("b one")],
    });
    const run = runFrontDoor(root);
    expect(run.exitCode, describeRun(run)).toBe(0);
    expect(run.lines.some((line) => /skip\(s\) named by/.test(line)), describeRun(run)).toBe(true);
  }, 120_000);

  test("a red gate alone does not change the exit code — skips named on a red run → exit 0", () => {
    const root = bunProject("exit-red", {
      "a.test.ts": [PASS("a one"), FAIL("a broken")],
      "b.test.ts": [PASS("b one")],
    });
    const run = runFrontDoor(root);
    expect(run.exitCode, describeRun(run)).toBe(0);
  }, 120_000);

  test("a runner that writes no report → exit 0, even when the gate is red", () => {
    const shim = makeShim("exit-no-report", {
      name: "python3",
      stdout: ["============ 1 failed, 1 passed in 0.01s ============"],
      report: null,
      exitCode: 1,
    });
    const root = markerProject("exit-no-report", "pytest.ini", "[pytest]\n");
    const run = runFrontDoor(root, shim);
    expect(run.exitCode, describeRun(run)).toBe(0);
    expect(run.lines.some((line) => /names no skips/.test(line)), describeRun(run)).toBe(true);
  }, 120_000);

  test("a report that is missing → exit 1", () => {
    const shim = makeShim("exit-missing", {
      name: "bun",
      stdout: [" 1 pass", " 0 fail", "Ran 1 tests across 2 files."],
      report: null,
      exitCode: 0,
    });
    const root = markerProject("exit-missing", "package.json", '{"name":"shim","private":true}\n');
    const run = runFrontDoor(root, shim);
    expect(run.exitCode, describeRun(run)).toBe(1);
    expect(run.lines.some((line) => /could not name its skips/.test(line)), describeRun(run)).toBe(true);
    // The totals line is still printed: the count and the names are separate facts.
    expect(totalsLines(run), describeRun(run)).toEqual(["gate_capture: pass 1, fail 0, skip 0"]);
  }, 120_000);

  test("a report that is unreadable → exit 1", () => {
    const shim = makeShim("exit-unreadable", {
      name: "bun",
      stdout: [" 1 pass", " 0 fail", "Ran 1 tests across 2 files."],
      report: UNREADABLE_REPORT,
      exitCode: 0,
    });
    const root = markerProject("exit-unreadable", "package.json", '{"name":"shim","private":true}\n');
    const run = runFrontDoor(root, shim);
    expect(run.exitCode, describeRun(run)).toBe(1);
    expect(run.lines.some((line) => /could not name its skips/.test(line)), describeRun(run)).toBe(true);
  }, 120_000);
});
