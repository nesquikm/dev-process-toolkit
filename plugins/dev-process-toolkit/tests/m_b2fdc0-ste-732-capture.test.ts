// STE-732 (M_b2fdc0) — the capture front doors read Vitest, Cargo and
// Playwright, a Cargo project gets `cargo test`, and a Vitest project never
// gets bun's command.
//
// AC-STE-732.5 (stack_layout: Cargo.toml → cargo test; a vitest package.json
// gets no table gate and both front doors refuse naming
// `verification.test_commands`; a plain package.json keeps bun), .6 (fake
// vitest / cargo / playwright runners on a private PATH, run as declared
// commands, summed; a Vitest output declared as pytest refuses), .8 (front-door
// half: bun / pytest / flutter projects with no new stack are byte-identical to
// the real v3.3.0 code, extracted with `git archive`).
//
// Front doors run as subprocesses against temp projects; see
// tests/_m_b2fdc0_ste730_fixture.ts for the fake-runner pattern.
//
// All names are synthetic.

import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

import {
  BUN_SUMMARY,
  CARGO_GREEN,
  CARGO_MIXED,
  NEW_STACK_SUM,
  PKG_PLAIN,
  PKG_VITEST_DEV,
  PLUGIN_ROOT,
  SHIPPED_SRC,
  STORE_REL,
  baselineRecord,
  cleanupTemps,
  makeBin,
  makeProject,
  newStackWorld,
  runBaselineCapture,
  runGateCapture,
  runLeg,
  settingsYaml,
  show,
  tempDir,
  totalsLines,
  type DoorRun,
  type FakeBin,
} from "./_m_b2fdc0_ste732_fixture";

setDefaultTimeout(180_000);

afterAll(() => cleanupTemps());

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const L: any = await import(join(SHIPPED_SRC, "stack_layout.ts"));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const B: any = await import(join(SHIPPED_SRC, "capture_skip_baseline.ts"));

async function leg(name: string): Promise<void> {
  expect(await runLeg(name, SHIPPED_SRC)).toBeNull();
}

// ===========================================================================
// AC-STE-732.5 — the marker table
// ===========================================================================

describe("AC-STE-732.5 — a root Cargo.toml maps to cargo test", () => {
  test("stack_layout: the Cargo.toml entry's gate is { stack: cargo, command: [cargo, test] }, and detectGate agrees", () => {
    const root = makeProject("cargo-marker", { marker: "Cargo.toml", settings: null });
    const entry = L.detectStackLayout(root);
    expect(entry).not.toBeNull();
    expect(entry.marker).toBe("Cargo.toml");
    expect(entry.id).toBe("cargo");
    expect(entry.gate).toEqual({ stack: "cargo", command: ["cargo", "test"] });
    expect(B.detectGate(root)).toEqual({ stack: "cargo", command: ["cargo", "test"] });
  });

  test("gate_capture on a Cargo.toml project runs `cargo test` and sums every test result line", () => {
    const bin = makeBin("cargo-gate", [{ name: "cargo", out: CARGO_MIXED, exitCode: 101 }]);
    const root = makeProject("cargo-gate", { marker: "Cargo.toml", settings: settingsYaml() });
    const r = runGateCapture(SHIPPED_SRC, root, bin);
    expect(bin.calls().map((c) => ({ name: c.name, args: c.args })), show(r)).toEqual([{ name: "cargo", args: ["test"] }]);
    expect(totalsLines(r), show(r)).toContain("gate_capture: pass 6, fail 1, skip 1");
  });

  test("capture_skip_baseline on a Cargo.toml project records the summed ignored count", () => {
    const bin = makeBin("cargo-base", [{ name: "cargo", out: CARGO_GREEN }]);
    const root = makeProject("cargo-base", { marker: "Cargo.toml", settings: settingsYaml(), git: true });
    const r = runBaselineCapture(SHIPPED_SRC, root, bin);
    expect(r.exitCode, show(r)).toBe(0);
    expect(bin.calls().map((c) => c.name), show(r)).toEqual(["cargo"]);
    expect(baselineRecord(root)?.skipped, show(r)).toBe(1);
  });
});

describe("AC-STE-732.5 — a package.json listing vitest gets no table gate; both front doors refuse", () => {
  test("gate_capture, vitest in devDependencies: NFR-10 refusal naming verification.test_commands + vitest; bun never runs", () =>
    leg("TABLE vitest gate — devDependencies vitest: gate_capture refuses naming verification.test_commands, bun never runs"));
  test("gate_capture, vitest in dependencies (no settings file): the same refusal", () => leg("TABLE vitest gate — dependencies vitest: gate_capture refuses too"));
  test("capture_skip_baseline, vitest in devDependencies: the same refusal, no baseline written", () =>
    leg("TABLE vitest baseline — capture_skip_baseline refuses naming verification.test_commands, writes no baseline, bun never runs"));
  test("a package.json without vitest keeps today's bun entry (gate_capture runs bun test)", () => leg("PERMIT gate — a package.json without vitest keeps the table's bun test"));
  test("a package.json without vitest keeps today's bun entry (detectGate)", () => {
    const root = makeProject("plain-pkg", { marker: "package.json", settings: null, files: { "package.json": PKG_PLAIN } });
    expect(B.detectGate(root)).toEqual({ stack: "bun", command: ["bun", "test"] });
  });
  test("a vitest project that declares its command runs it, with no table refusal", () => {
    const bin = makeBin("vt-declared", [
      { name: "npx", byArg: { vitest: ["", " Test Files  2 passed (2)", "      Tests  5 passed (5)", ""] } },
      { name: "bun", out: BUN_SUMMARY },
    ]);
    const root = makeProject("vt-declared", {
      marker: "package.json",
      settings: settingsYaml([{ stack: "vitest", command: ["npx", "vitest", "run"] }]),
      files: { "package.json": PKG_VITEST_DEV },
    });
    const r = runGateCapture(SHIPPED_SRC, root, bin);
    expect(bin.calls().map((c) => ({ name: c.name, args: c.args })), show(r)).toEqual([{ name: "npx", args: ["vitest", "run"] }]);
    expect(totalsLines(r), show(r)).toContain("gate_capture: pass 5, fail 0, skip 0");
    expect(r.exitCode, show(r)).toBe(0);
  });
});

// A repository carrying BOTH package.json and Cargo.toml: the table keeps
// `package.json` ahead of `Cargo.toml`, so the pair behaves as at v3.3.0 (bun
// test, AC-STE-732.8), and a Vitest package.json beside a Cargo.toml reaches the
// Vitest refusal (AC-STE-732.5) rather than `cargo test`.
function vitestRefusalProblems(r: DoorRun): string[] {
  const both = `${r.stdout}\n${r.stderr}`;
  const remedy = both.split("\n").find((l) => /Remedy:/.test(l)) ?? "";
  return [
    r.exitCode === 0 ? "the front door exited 0 — a refusal must exit non-zero" : null,
    remedy === "" ? "no `Remedy:` line (NFR-10 shape)" : null,
    /Context:/.test(both) ? null : "no `Context:` line (NFR-10 shape)",
    remedy.includes("verification.test_commands") ? null : "the Remedy line does not name `verification.test_commands`",
    /\bvitest\b/.test(remedy) ? null : "the Remedy line does not name stack `vitest`",
  ].filter((p): p is string => p !== null);
}

const CARGO_TOML = "[package]\nname = \"ste732\"\nversion = \"0.1.0\"\n";

describe("AC-STE-732.5 / .8 — package.json stays ahead of Cargo.toml in the marker table", () => {
  test("package.json (no vitest) + Cargo.toml: detectGate returns the bun entry, not cargo", () => {
    const root = makeProject("pkg-plus-cargo", {
      marker: "package.json",
      settings: null,
      files: { "package.json": PKG_PLAIN, "Cargo.toml": CARGO_TOML },
    });
    expect(B.detectGate(root)).toEqual({ stack: "bun", command: ["bun", "test"] });
    const entry = L.detectStackLayout(root);
    expect(entry).not.toBeNull();
    expect(entry.marker).toBe("package.json");
    expect(entry.id).toBe("bun");
  });

  const vitestCargoBin = (label: string): FakeBin =>
    makeBin(label, [
      { name: "bun", out: BUN_SUMMARY },
      { name: "npx", out: [" Test Files  1 passed (1)", "      Tests  1 passed (1)"] },
      { name: "cargo", out: CARGO_GREEN },
    ]);

  test("package.json listing vitest + Cargo.toml: gate_capture refuses with the Vitest remedy and never runs cargo", () => {
    const bin = vitestCargoBin("vt-cargo-gate");
    const root = makeProject("vt-cargo-gate", {
      marker: "package.json",
      settings: settingsYaml(),
      files: { "package.json": PKG_VITEST_DEV, "Cargo.toml": CARGO_TOML },
    });
    const r = runGateCapture(SHIPPED_SRC, root, bin);
    expect(bin.calls().map((c) => c.name), show(r)).toEqual([]);
    expect(vitestRefusalProblems(r), show(r)).toEqual([]);
    expect(totalsLines(r).some((l) => /pass \d+/.test(l)), show(r)).toBe(false);
  });

  test("package.json listing vitest + Cargo.toml: capture_skip_baseline refuses with the Vitest remedy, never runs cargo, writes no baseline", () => {
    const bin = vitestCargoBin("vt-cargo-base");
    const root = makeProject("vt-cargo-base", {
      marker: "package.json",
      settings: settingsYaml(),
      files: { "package.json": PKG_VITEST_DEV, "Cargo.toml": CARGO_TOML },
      git: true,
    });
    const r = runBaselineCapture(SHIPPED_SRC, root, bin);
    expect(bin.calls().map((c) => c.name), show(r)).toEqual([]);
    expect(vitestRefusalProblems(r), show(r)).toEqual([]);
    expect(existsSync(join(root, STORE_REL)), show(r)).toBe(false);
  });
});

// ===========================================================================
// AC-STE-732.6 — fake runners on a private PATH, run as declared commands
// ===========================================================================

describe("AC-STE-732.6 — vitest, cargo and playwright run as declared commands and sum correctly", () => {
  const SUM_LINE = `gate_capture: pass ${NEW_STACK_SUM.pass}, fail ${NEW_STACK_SUM.fail}, skip ${NEW_STACK_SUM.skip}`;

  test(`gate_capture: the three entries run in order from the project root and print ONE totals line (${SUM_LINE})`, () => {
    const { bin, root } = newStackWorld("ns-gate", false);
    const r = runGateCapture(SHIPPED_SRC, root, bin);
    expect(bin.calls(), show(r)).toEqual([
      { name: "npx", args: ["vitest", "run"], cwd: root },
      { name: "cargo", args: ["test", "--manifest-path", "service/Cargo.toml"], cwd: root },
      { name: "npx", args: ["playwright", "test"], cwd: root },
    ]);
    expect(totalsLines(r).filter((l) => /^gate_capture: pass /.test(l)), show(r)).toEqual([SUM_LINE]);
    expect(r.exitCode, show(r)).toBe(0);
  });

  test("capture_skip_baseline: the record's skip count is the sum of the three", () => {
    const { bin, root } = newStackWorld("ns-base", true);
    const r = runBaselineCapture(SHIPPED_SRC, root, bin);
    expect(r.exitCode, show(r)).toBe(0);
    expect(bin.calls().map((c) => c.name), show(r)).toEqual(["npx", "cargo", "npx"]);
    expect(baselineRecord(root)?.skipped, show(r)).toBe(NEW_STACK_SUM.skip);
  });

  test("gate_capture: a Vitest output declared as pytest refuses (naming vitest), no partial sum", () => leg("MISLABEL gate — a Vitest output declared as pytest refuses at gate_capture"));
  test("capture_skip_baseline: a Vitest output declared as pytest refuses, no baseline", () => leg("MISLABEL baseline — a Vitest output declared as pytest refuses and writes no baseline"));

  test("control: the same Vitest output declared as vitest sums cleanly", () => {
    const bin = makeBin("ml-control", [{ name: "npx", byArg: { vitest: ["", " Test Files  2 passed (2)", "      Tests  5 passed (5)", ""] } }]);
    const root = makeProject("ml-control", {
      marker: "package.json",
      settings: settingsYaml([{ stack: "vitest", command: ["npx", "vitest", "run"] }]),
      files: { "package.json": PKG_VITEST_DEV },
    });
    const r = runGateCapture(SHIPPED_SRC, root, bin);
    expect(totalsLines(r), show(r)).toContain("gate_capture: pass 5, fail 0, skip 0");
  });
});

// ===========================================================================
// AC-STE-732.8 — bun / pytest / flutter projects: byte-identical to v3.3.0
// ===========================================================================

const V330_SHA = "e9d6c6557688309802ed3a1aa668b647b9ac5537";
let TRUNK_SRC = "";

beforeAll(() => {
  const exists = Bun.spawnSync(["git", "-C", PLUGIN_ROOT, "cat-file", "-e", `${V330_SHA}^{commit}`], { stdout: "pipe", stderr: "pipe" });
  if (exists.exitCode !== 0) throw new Error(`v3.3.0 commit ${V330_SHA} is unreachable in this clone — fetch it; this guard never skips`);
  const top = Bun.spawnSync(["git", "-C", PLUGIN_ROOT, "rev-parse", "--show-toplevel"], { stdout: "pipe" }).stdout.toString().trim();
  const prefix = PLUGIN_ROOT.slice(top.length + 1);
  const dest = tempDir("ste732-trunk-doors");
  const archive = Bun.spawnSync(
    ["/bin/sh", "-c", `git -C '${top}' archive '${V330_SHA}' '${prefix}/adapters' '${prefix}/templates' '${prefix}/.claude-plugin' | tar -x -C '${dest}'`],
    { stdout: "pipe", stderr: "pipe" },
  );
  if (archive.exitCode !== 0) throw new Error(`git archive failed: ${archive.stderr.toString()}`);
  TRUNK_SRC = join(dest, prefix, "adapters", "_shared", "src");
  if (!existsSync(join(TRUNK_SRC, "gate_capture.ts"))) throw new Error(`trunk extraction has no gate_capture.ts under ${TRUNK_SRC}`);
});

function argvOf(bin: FakeBin): string[][] {
  return bin.calls().map((c) => [c.name, ...c.args.map((a) => a.replace(/--reporter-outfile=.*/, "--reporter-outfile=<tmp>")), c.cwd]);
}

function observe(door: typeof runGateCapture, src: string, root: string, bin: FakeBin): { run: DoorRun; argv: string[][]; record: Record<string, unknown> | null } {
  bin.reset();
  rmSync(join(root, STORE_REL), { force: true });
  const run = door(src, root, bin);
  const rec = baselineRecord(root);
  return { run, argv: argvOf(bin), record: rec === null ? null : { ...rec, capturedAt: "<instant>" } };
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

describe("AC-STE-732.8 — bun / pytest / flutter projects declaring no new stack are byte-identical to v3.3.0", () => {
  test("gate_capture, plain package.json (no vitest), table bun", () => {
    const bin = makeBin("bi732-gate-bun", [{ name: "bun", out: BUN_SUMMARY }]);
    const root = makeProject("bi732-gate-bun", { marker: "package.json", settings: settingsYaml(), files: { "package.json": PKG_PLAIN } });
    expectSame(runGateCapture, root, bin);
  });

  test("capture_skip_baseline, plain package.json (no vitest), table bun", () => {
    const bin = makeBin("bi732-base-bun", [{ name: "bun", out: BUN_SUMMARY }]);
    const root = makeProject("bi732-base-bun", { marker: "package.json", settings: settingsYaml(), files: { "package.json": PKG_PLAIN }, git: true });
    expectSame(runBaselineCapture, root, bin);
  });

  test("gate_capture, pytest.ini, table python3 -m pytest", () => {
    const bin = makeBin("bi732-gate-py", [{ name: "python3", out: ["============ 1 failed, 3 passed, 2 skipped in 0.01s ============"], exitCode: 1 }]);
    const root = makeProject("bi732-gate-py", { marker: "pytest.ini", settings: settingsYaml() });
    expectSame(runGateCapture, root, bin);
  });

  test("gate_capture, pubspec.yaml, no settings file, table flutter test", () => {
    const bin = makeBin("bi732-gate-fl", [{ name: "flutter", out: ["00:01 +5 ~1: All tests passed!"] }]);
    const root = makeProject("bi732-gate-fl", { marker: "pubspec.yaml", settings: null });
    expectSame(runGateCapture, root, bin);
  });
});
