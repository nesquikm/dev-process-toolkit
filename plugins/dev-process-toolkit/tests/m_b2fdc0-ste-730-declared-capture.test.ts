// STE-730 (M_b2fdc0) — the test capture runs the commands a project declares.
//
// AC-STE-730.2 (front-door half), .3, .4, .5, .6, .7, .8. Both front doors —
// `gate_capture.ts` and `capture_skip_baseline.ts` — are run as subprocesses
// against temp projects whose runners are fake scripts on a private PATH (see
// tests/_m_b2fdc0_ste730_fixture.ts). The legs that the mutation battery
// (AC-STE-730.9) grades are defined once in the fixture and run here by name.
//
// AC-STE-730.7 (key absent → byte-identical to v3.3.0) is graded against the
// REAL v3.3.0 code: the fixed v3.3.0 commit's adapters/, templates/ and manifest
// are extracted with `git archive` to a temp directory, and the same fixture is
// run through both trees with the same fake runners. stdout, stderr, exit code,
// the runner argv and the baseline record (minus its capture instant) must
// agree byte for byte.
//
// AC-STE-730.10 (the full-suite run) is the milestone's single gate run, done
// by the orchestrator — no test here runs the suite.
//
// All names are synthetic.

import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import {
  LEG_BY_NAME,
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
  type DoorRun,
  type FakeBin,
} from "./_m_b2fdc0_ste730_fixture";

setDefaultTimeout(180_000);

afterAll(() => cleanupTemps());

function leg(name: string): void {
  const l = LEG_BY_NAME.get(name);
  if (l === undefined) throw new Error(`unknown leg ${name}`);
  expect(l.check(SHIPPED_SRC)).toBeNull();
}

// ===========================================================================
// AC-STE-730.3 / .8 — the declared command runs, the table's does not
// ===========================================================================

describe("AC-STE-730.3 / .8 — a declared command replaces the table's", () => {
  test("gate_capture: a fake fvm wrapper on PATH runs (`fvm flutter test`, from the project root) and bare flutter does not", () => {
    leg("gate DECLARED — the fvm wrapper runs and bare flutter does not");
  });

  test("capture_skip_baseline: the fvm wrapper runs and bare flutter does not", () => {
    leg("baseline DECLARED — the fvm wrapper runs and bare flutter does not");
  });

  test("the declared entries run in list order, from the project root, and the table's python3 never runs", () => {
    leg("gate SUM — two make entries run in order and their counts add up");
  });
});

// ===========================================================================
// AC-STE-730.4 / .8 — counts are summed
// ===========================================================================

describe("AC-STE-730.4 / .8 — pass, fail and skip are the sums of every entry", () => {
  test("gate_capture prints ONE totals line: pass 3+4, fail 1+0, skip 2+1", () => {
    leg("gate SUM — two make entries run in order and their counts add up");
  });

  test("gate_capture parses each entry with its own stack's parser before summing (bun + pytest)", () => {
    leg("gate SUM — mixed stacks: each entry is parsed by its own stack, then summed");
  });

  test("capture_skip_baseline records skip 2+1 and names every declared command in order", () => {
    leg("baseline SUM — the record's skip count is the sum and it names both commands in order");
  });
});

// ===========================================================================
// AC-STE-730.5 / .8 — fail closed
// ===========================================================================

describe("AC-STE-730.5 / .8 — an entry without a count, or killed on its bound, refuses the whole capture", () => {
  test("gate_capture: the second entry prints no count → NFR-10 refusal naming it, exit non-zero, no totals", () => {
    leg("gate CLOSED — an entry with no readable count refuses, and no partial sum stands");
  });

  test("capture_skip_baseline: the second entry prints no count → NFR-10 refusal naming it, no baseline written", () => {
    leg("baseline CLOSED — an entry with no readable count refuses and writes no baseline");
  });

  test("gate_capture: an entry killed on its bound refuses even though it printed a readable count", () => {
    leg("gate CLOSED — an entry killed on its bound refuses, even though it printed a count");
  });

  test("capture_skip_baseline: an entry killed on its bound refuses and writes no baseline", () => {
    leg("baseline CLOSED — an entry killed on its bound refuses and writes no baseline");
  });
});

// ===========================================================================
// AC-STE-730.6 — a declared entry is count-only
// ===========================================================================

describe("AC-STE-730.6 — a declared entry is count-only", () => {
  function bunWorld(label: string, git: boolean): { bin: FakeBin; root: string } {
    const bin = makeBin(label, [
      {
        name: "bun",
        out: [" 4 pass", " 1 skip", " 0 fail", "Ran 5 tests across 2 files."],
        report: '<testsuites name="shim"><testsuite name="a" tests="1"><testcase name="x" classname="a"><skipped /></testcase></testsuite></testsuites>\n',
      },
    ]);
    const root = makeProject(label, {
      marker: "package.json",
      settings: settingsYaml([{ stack: "bun", command: ["bun", "test", "tests/unit"] }]),
      git,
    });
    return { bin, root };
  }

  test("gate_capture: a declared bun entry runs with exactly its own argv — no report flag is added", () => {
    const { bin, root } = bunWorld("ro-gate", false);
    const r = runGateCapture(SHIPPED_SRC, root, bin);
    expect(bin.calls().map((c) => c.args), show(r)).toEqual([["test", "tests/unit"]]);
    expect(totalsLines(r), show(r)).toEqual(["gate_capture: pass 4, fail 0, skip 1"]);
    expect(r.exitCode, show(r)).toBe(0);
  });

  test("capture_skip_baseline: no report flag, no names, and namesSource says it was a declared command with no report", () => {
    const { bin, root } = bunWorld("ro-base", true);
    const r = runBaselineCapture(SHIPPED_SRC, root, bin);
    expect(bin.calls().map((c) => c.args), show(r)).toEqual([["test", "tests/unit"]]);
    expect(r.exitCode, show(r)).toBe(0);
    const rec = baselineRecord(root);
    expect(rec?.skipped, show(r)).toBe(1);
    expect(rec !== null && "names" in rec, `a count-only capture writes no names: ${JSON.stringify(rec)}`).toBe(false);
    const source = String(rec?.namesSource ?? "");
    expect(source, JSON.stringify(rec)).toMatch(/declared/i);
    expect(source, JSON.stringify(rec)).toMatch(/\bno\b.*report/i);
    // Not the bun stack's identity-source label: that would claim a report was read.
    expect(source).not.toContain("--reporter=junit");
  });
});

// ===========================================================================
// AC-STE-730.2 — a legacy CLAUDE.md never supplies the key
// ===========================================================================

describe("AC-STE-730.2 — a legacy tree keeps today's table", () => {
  const LEGACY_MD = [
    "# Synthetic Project",
    "",
    "## Verification",
    "",
    "verify_skill: smoke-test",
    "verify_mode: advisory",
    "run_cmd: none",
    "e2e_cmd: none",
    "",
  ].join("\n");

  test("gate_capture on a legacy CLAUDE.md project (no settings file) runs the table's flutter test, never a wrapper", () => {
    const bin = makeBin("legacy-gate", [
      { name: "fvm", out: ["00:01 +5 ~1: All tests passed!"] },
      { name: "flutter", out: ["00:01 +99: All tests passed!"] },
    ]);
    const root = makeProject("legacy-gate", { marker: "pubspec.yaml", settings: null, files: { "CLAUDE.md": LEGACY_MD } });
    const r = runGateCapture(SHIPPED_SRC, root, bin);
    expect(bin.calls().map((c) => ({ name: c.name, args: c.args })), show(r)).toEqual([{ name: "flutter", args: ["test"] }]);
    expect(totalsLines(r), show(r)).toEqual(["gate_capture: pass 99, fail 0, skip 0"]);
  });
});

// ===========================================================================
// AC-STE-730.7 — key absent: byte-identical to v3.3.0
// ===========================================================================

// v3.3.0 — the release STE-730 must stay byte-identical to with the key absent
const V330_SHA = "e9d6c6557688309802ed3a1aa668b647b9ac5537";

/** The fixed v3.3.0 commit — never a merge-base, which becomes HEAD itself once this branch merges. */
function trunkRef(): string {
  const p = Bun.spawnSync(["git", "-C", PLUGIN_ROOT, "cat-file", "-e", `${V330_SHA}^{commit}`], { stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) {
    throw new Error(`AC-STE-730.7: v3.3.0 commit ${V330_SHA} is unreachable in this clone (shallow or pruned?) — fetch it; this guard never skips`);
  }
  return V330_SHA;
}

let TRUNK_SRC = "";

beforeAll(() => {
  const top = Bun.spawnSync(["git", "-C", PLUGIN_ROOT, "rev-parse", "--show-toplevel"], { stdout: "pipe" }).stdout.toString().trim();
  const prefix = PLUGIN_ROOT.slice(top.length + 1);
  const dest = tempDir("trunk");
  const ref = trunkRef();
  const archive = Bun.spawnSync(
    ["/bin/sh", "-c", `git -C '${top}' archive '${ref}' '${prefix}/adapters' '${prefix}/templates' '${prefix}/.claude-plugin' | tar -x -C '${dest}'`],
    { stdout: "pipe", stderr: "pipe" },
  );
  if (archive.exitCode !== 0) throw new Error(`git archive failed: ${archive.stderr.toString()}`);
  TRUNK_SRC = join(dest, prefix, "adapters", "_shared", "src");
  if (!existsSync(join(TRUNK_SRC, "gate_capture.ts"))) throw new Error(`trunk extraction has no gate_capture.ts under ${TRUNK_SRC}`);
});

/** argv with the per-run temp report path masked — it is a fresh mkdtemp on every run. */
function argvOf(bin: FakeBin): string[][] {
  return bin.calls().map((c) => [c.name, ...c.args.map((a) => a.replace(/--reporter-outfile=.*/, "--reporter-outfile=<tmp>")), c.cwd]);
}

interface Observed {
  readonly run: DoorRun;
  readonly argv: string[][];
  readonly record: Record<string, unknown> | null;
}

function observe(door: typeof runGateCapture, src: string, root: string, bin: FakeBin): Observed {
  bin.reset();
  rmSync(join(root, STORE_REL), { force: true });
  const run = door(src, root, bin);
  const rec = baselineRecord(root);
  const record = rec === null ? null : { ...rec, capturedAt: "<instant>" };
  return { run, argv: argvOf(bin), record };
}

function expectSame(door: typeof runGateCapture, root: string, bin: FakeBin): void {
  const now = observe(door, SHIPPED_SRC, root, bin);
  const then = observe(door, TRUNK_SRC, root, bin);
  expect(now.argv, `argv\nNOW ${show(now.run)}\nv3.3.0 ${show(then.run)}`).toEqual(then.argv);
  expect(now.run.stdout).toBe(then.run.stdout);
  expect(now.run.stderr).toBe(then.run.stderr);
  expect(now.run.exitCode).toBe(then.run.exitCode);
  expect(now.record).toEqual(then.record);
}

const VALID_REPORT =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<testsuites name="shim" tests="2" skipped="1">' +
  '<testsuite name="tests/a.test.ts" file="tests/a.test.ts" tests="2" skipped="1">' +
  '<testcase name="runs" classname="a"></testcase>' +
  '<testcase name="is skipped" classname="a"><skipped /></testcase>' +
  "</testsuite></testsuites>\n";

describe("AC-STE-730.7 — with the key absent both front doors are byte-identical to v3.3.0", () => {
  test("gate_capture, settings file without the key, pytest marker", () => {
    const bin = makeBin("bi-gate-py", [{ name: "python3", out: ["============ 1 failed, 3 passed, 2 skipped in 0.01s ============"], exitCode: 1 }]);
    const root = makeProject("bi-gate-py", { marker: "pytest.ini", settings: settingsYaml() });
    expectSame(runGateCapture, root, bin);
  });

  test("gate_capture, settings file without the key, bun marker with a junit report", () => {
    const bin = makeBin("bi-gate-bun", [{ name: "bun", out: [" 1 pass", " 1 skip", " 0 fail", "Ran 2 tests across 2 files."], report: VALID_REPORT }]);
    const root = makeProject("bi-gate-bun", { marker: "package.json", settings: settingsYaml() });
    expectSame(runGateCapture, root, bin);
  });

  test("gate_capture, no settings file at all, flutter marker", () => {
    const bin = makeBin("bi-gate-fl", [{ name: "flutter", out: ["00:01 +5 ~1: All tests passed!"] }]);
    const root = makeProject("bi-gate-fl", { marker: "pubspec.yaml", settings: null });
    expectSame(runGateCapture, root, bin);
  });

  test("capture_skip_baseline, settings file without the key, flutter marker", () => {
    const bin = makeBin("bi-base-fl", [{ name: "flutter", out: ["00:01 +5 ~1: All tests passed!"] }]);
    const root = makeProject("bi-base-fl", { marker: "pubspec.yaml", settings: settingsYaml(), git: true });
    expectSame(runBaselineCapture, root, bin);
  });

  test("capture_skip_baseline, no settings file, bun marker with a junit report (names recorded)", () => {
    const bin = makeBin("bi-base-bun", [{ name: "bun", out: [" 1 pass", " 1 skip", " 0 fail", "Ran 2 tests across 2 files."], report: VALID_REPORT }]);
    const root = makeProject("bi-base-bun", { marker: "package.json", settings: null, git: true });
    mkdirSync(join(root, ".dpt"), { recursive: true });
    expectSame(runBaselineCapture, root, bin);
  });
});

// ===========================================================================
// AC-STE-730.5 — a MALFORMED declared list fails closed at both front doors
// ===========================================================================
//
// A `verification.test_commands` the loader rejects (AC-STE-730.1 shape) must
// never fall back to the stack_layout table: both front doors refuse in the
// NFR-10 shape naming the dotted path, exit non-zero, write no baseline, and
// run no runner at all — the fake table `python3` must never be called.

describe("AC-STE-730.5 — a malformed declared list refuses at both front doors and never runs the table", () => {
  const MALFORMED: ReadonlyArray<{ label: string; value: unknown; path: string }> = [
    { label: "stack-rust", value: [{ stack: "rust", command: ["cargo", "test"] }], path: "verification.test_commands[0].stack" },
    { label: "command-empty", value: [{ stack: "pytest", command: [] }], path: "verification.test_commands[0].command" },
  ];

  function malformedWorld(label: string, value: unknown, git: boolean): { bin: FakeBin; root: string } {
    const bin = makeBin(label, [
      { name: "python3", out: ["============ 50 passed in 0.01s ============"] },
      { name: "cargo", out: ["test result: ok. 9 passed; 0 failed; 0 ignored"] },
      { name: "make", out: ["============ 7 passed in 0.10s ============"] },
    ]);
    const root = makeProject(label, { marker: "pytest.ini", settings: settingsYaml(value), git });
    return { bin, root };
  }

  function expectRefusal(r: DoorRun, path: string): void {
    const all = `${r.stdout}\n${r.stderr}`;
    expect(r.exitCode, show(r)).not.toBe(0);
    expect(all, show(r)).toMatch(/Remedy:/);
    expect(all, show(r)).toMatch(/Context:/);
    expect(all, show(r)).toContain(path);
  }

  for (const m of MALFORMED) {
    test(`gate_capture: ${m.path} malformed → NFR-10 refusal naming it, exit non-zero, no totals, the table's python3 never runs`, () => {
      const { bin, root } = malformedWorld(`mf-gate-${m.label}`, m.value, false);
      const r = runGateCapture(SHIPPED_SRC, root, bin);
      expect(bin.calls().map((c) => c.name), show(r)).toEqual([]);
      expectRefusal(r, m.path);
      expect(totalsLines(r), show(r)).toEqual([]);
    });

    test(`capture_skip_baseline: ${m.path} malformed → NFR-10 refusal naming it, no baseline, the table's python3 never runs`, () => {
      const { bin, root } = malformedWorld(`mf-base-${m.label}`, m.value, true);
      const r = runBaselineCapture(SHIPPED_SRC, root, bin);
      expect(bin.calls().map((c) => c.name), show(r)).toEqual([]);
      expectRefusal(r, m.path);
      expect(existsSync(join(root, STORE_REL)), `a baseline store was written\n${show(r)}`).toBe(false);
    });
  }

  test("control: the same world with NO settings file still runs the table's python3 -m pytest", () => {
    const bin = makeBin("mf-control", [{ name: "python3", out: ["============ 1 failed, 3 passed, 2 skipped in 0.01s ============"], exitCode: 1 }]);
    const root = makeProject("mf-control", { marker: "pytest.ini", settings: null });
    const r = runGateCapture(SHIPPED_SRC, root, bin);
    expect(bin.calls().map((c) => ({ name: c.name, args: c.args })), show(r)).toEqual([{ name: "python3", args: ["-m", "pytest"] }]);
    expect(totalsLines(r), show(r)).toEqual(["gate_capture: pass 3, fail 1, skip 2"]);
    expect(r.exitCode, show(r)).toBe(0);
  });
});

// ===========================================================================
// AC-STE-730.5 / .3 — a WELL-FORMED declared list in a `verification` section
// the loader refuses over a DIFFERENT key still fails closed
// ===========================================================================
//
// The declared list is fine; `verify_mode: sometimes` is not one of the enum's
// values. The loader refuses the whole section, so the declared list cannot be
// read — and a declared-but-unreadable list must never silently fall back to
// the stack_layout table. Both front doors refuse in the NFR-10 shape naming
// the offending key (`verification.verify_mode`), exit non-zero, write no
// baseline, and run NO runner: neither the table's python3 nor the declared
// make.
//
// Control: the same invalid verify_mode with NO test_commands key keeps the
// v3.3.0 behaviour — the capture scripts never read settings then, so the
// table's python3 -m pytest runs.

describe("AC-STE-730.5 / .3 — a declared list in a section refused over another key never runs the table", () => {
  function badVerifyModeYaml(testCommands?: unknown): string {
    const verification: Record<string, unknown> = { verify_mode: "sometimes" };
    if (testCommands !== undefined) verification.test_commands = testCommands;
    return [
      "schema_version: 1",
      'min_dpt_version: "3.0.0"',
      `task_tracking: ${JSON.stringify({ mode: "none" })}`,
      `verification: ${JSON.stringify(verification)}`,
      "",
    ].join("\n");
  }

  const DECLARED = [{ stack: "pytest", command: ["make", "test-api"] }];
  const OFFENDING = "verification.verify_mode";

  function otherKeyWorld(label: string, testCommands: unknown, git: boolean): { bin: FakeBin; root: string } {
    const bin = makeBin(label, [
      { name: "python3", out: ["============ 1 failed, 3 passed, 2 skipped in 0.01s ============"], exitCode: 1 },
      { name: "make", out: ["============ 7 passed in 0.10s ============"] },
    ]);
    const root = makeProject(label, { marker: "pytest.ini", settings: badVerifyModeYaml(testCommands), git });
    return { bin, root };
  }

  function expectOtherKeyRefusal(r: DoorRun): void {
    const all = `${r.stdout}\n${r.stderr}`;
    expect(r.exitCode, show(r)).not.toBe(0);
    expect(all, show(r)).toMatch(/Remedy:/);
    expect(all, show(r)).toMatch(/Context:/);
    expect(all, show(r)).toContain(OFFENDING);
  }

  test("gate_capture: declared list + invalid verify_mode → NFR-10 refusal naming verification.verify_mode, exit non-zero, no totals, no runner runs", () => {
    const { bin, root } = otherKeyWorld("ok-gate", DECLARED, false);
    const r = runGateCapture(SHIPPED_SRC, root, bin);
    expect(bin.calls().map((c) => c.name), show(r)).toEqual([]);
    expectOtherKeyRefusal(r);
    expect(totalsLines(r), show(r)).toEqual([]);
  });

  test("capture_skip_baseline: declared list + invalid verify_mode → NFR-10 refusal naming verification.verify_mode, no baseline, no runner runs", () => {
    const { bin, root } = otherKeyWorld("ok-base", DECLARED, true);
    const r = runBaselineCapture(SHIPPED_SRC, root, bin);
    expect(bin.calls().map((c) => c.name), show(r)).toEqual([]);
    expectOtherKeyRefusal(r);
    expect(existsSync(join(root, STORE_REL)), `a baseline store was written\n${show(r)}`).toBe(false);
  });

  test("control: invalid verify_mode with NO test_commands key → gate_capture runs the table's python3 -m pytest as at v3.3.0", () => {
    const { bin, root } = otherKeyWorld("ok-control-gate", undefined, false);
    const r = runGateCapture(SHIPPED_SRC, root, bin);
    expect(bin.calls().map((c) => ({ name: c.name, args: c.args })), show(r)).toEqual([{ name: "python3", args: ["-m", "pytest"] }]);
    expect(totalsLines(r), show(r)).toEqual(["gate_capture: pass 3, fail 1, skip 2"]);
    expect(r.exitCode, show(r)).toBe(0);
  });

  test("control: invalid verify_mode with NO test_commands key → capture_skip_baseline runs the table's python3 -m pytest and records skip 2", () => {
    const { bin, root } = otherKeyWorld("ok-control-base", undefined, true);
    const r = runBaselineCapture(SHIPPED_SRC, root, bin);
    expect(bin.calls().map((c) => ({ name: c.name, args: c.args })), show(r)).toEqual([{ name: "python3", args: ["-m", "pytest"] }]);
    expect(r.exitCode, show(r)).toBe(0);
    expect(baselineRecord(root)?.skipped, show(r)).toBe(2);
  });
});

// ===========================================================================
// AC-STE-730.5 / .3 — a settings file that is NOT valid YAML, whose raw text
// still declares `test_commands` under `verification`, fails closed
// ===========================================================================
//
// The loader cannot parse the file at all, so the declared list cannot be read
// through it — and a declared-but-unreadable list must never silently fall back
// to the stack_layout table. Both front doors refuse in the NFR-10 shape, exit
// non-zero, write no baseline, and run NO runner: neither the table's python3
// nor the declared make.
//
// Control: an invalid-YAML file that never mentions `test_commands` keeps the
// v3.3.0 behaviour exactly — the table's python3 -m pytest runs.

describe("AC-STE-730.5 / .3 — an unparseable settings file that declares test_commands never runs the table", () => {
  const HEAD = ["schema_version: 1", 'min_dpt_version: "3.0.0"', "task_tracking:", "  mode: none"];

  const BROKEN: ReadonlyArray<{ label: string; text: string }> = [
    {
      label: "unclosed-flow",
      text: [...HEAD, "verification:", "  test_commands: [{stack: pytest, command: [make, test-api]}", ""].join("\n"),
    },
    {
      label: "broken-indent",
      text: [
        ...HEAD,
        "verification:",
        "    verify_mode: advisory",
        "  test_commands:",
        "    - stack: pytest",
        "      command: [make, test-api]",
        "",
      ].join("\n"),
    },
  ];

  const NO_KEY_BROKEN = [...HEAD, "verification:", "    verify_mode: advisory", "  verify_skill: smoke-test", ""].join("\n");

  function brokenWorld(label: string, text: string, git: boolean): { bin: FakeBin; root: string } {
    const bin = makeBin(label, [
      { name: "python3", out: ["============ 1 failed, 3 passed, 2 skipped in 0.01s ============"], exitCode: 1 },
      { name: "make", out: ["============ 7 passed in 0.10s ============"] },
    ]);
    const root = makeProject(label, { marker: "pytest.ini", settings: text, git });
    return { bin, root };
  }

  function expectNfr10(r: DoorRun): void {
    const all = `${r.stdout}\n${r.stderr}`;
    expect(r.exitCode, show(r)).not.toBe(0);
    expect(all, show(r)).toMatch(/Remedy:/);
    expect(all, show(r)).toMatch(/Context:/);
  }

  test("sanity: every broken fixture really is invalid YAML", () => {
    for (const b of [...BROKEN.map((x) => x.text), NO_KEY_BROKEN]) {
      expect(() => Bun.YAML.parse(b), b).toThrow();
    }
  });

  for (const b of BROKEN) {
    test(`gate_capture: invalid YAML (${b.label}) declaring test_commands → NFR-10 refusal, exit non-zero, no totals, no runner runs`, () => {
      const { bin, root } = brokenWorld(`iy-gate-${b.label}`, b.text, false);
      const r = runGateCapture(SHIPPED_SRC, root, bin);
      expect(bin.calls().map((c) => c.name), show(r)).toEqual([]);
      expectNfr10(r);
      expect(totalsLines(r), show(r)).toEqual([]);
    });

    test(`capture_skip_baseline: invalid YAML (${b.label}) declaring test_commands → NFR-10 refusal, no baseline, no runner runs`, () => {
      const { bin, root } = brokenWorld(`iy-base-${b.label}`, b.text, true);
      const r = runBaselineCapture(SHIPPED_SRC, root, bin);
      expect(bin.calls().map((c) => c.name), show(r)).toEqual([]);
      expectNfr10(r);
      expect(existsSync(join(root, STORE_REL)), `a baseline store was written\n${show(r)}`).toBe(false);
    });
  }

  test("control: invalid YAML with NO test_commands mention → gate_capture runs the table's python3 -m pytest as at v3.3.0", () => {
    const { bin, root } = brokenWorld("iy-control-gate", NO_KEY_BROKEN, false);
    const r = runGateCapture(SHIPPED_SRC, root, bin);
    expect(bin.calls().map((c) => ({ name: c.name, args: c.args })), show(r)).toEqual([{ name: "python3", args: ["-m", "pytest"] }]);
    expect(totalsLines(r), show(r)).toEqual(["gate_capture: pass 3, fail 1, skip 2"]);
    expect(r.exitCode, show(r)).toBe(0);
  });

  test("control: invalid YAML with NO test_commands mention → capture_skip_baseline runs the table's python3 -m pytest and records skip 2", () => {
    const { bin, root } = brokenWorld("iy-control-base", NO_KEY_BROKEN, true);
    const r = runBaselineCapture(SHIPPED_SRC, root, bin);
    expect(bin.calls().map((c) => ({ name: c.name, args: c.args })), show(r)).toEqual([{ name: "python3", args: ["-m", "pytest"] }]);
    expect(r.exitCode, show(r)).toBe(0);
    expect(baselineRecord(root)?.skipped, show(r)).toBe(2);
  });

  test("control: invalid YAML with NO test_commands mention is byte-identical to v3.3.0 at both front doors", () => {
    const g = brokenWorld("iy-bi-gate", NO_KEY_BROKEN, false);
    expectSame(runGateCapture, g.root, g.bin);
    const b = brokenWorld("iy-bi-base", NO_KEY_BROKEN, true);
    expectSame(runBaselineCapture, b.root, b.bin);
  });
});
