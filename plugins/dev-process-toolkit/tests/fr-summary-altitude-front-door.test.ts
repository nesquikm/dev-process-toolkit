// PR #76 adversarial review, finding C5 — THE TWO HALVES OF PROBE #67 SIT ON
// OPPOSITE SIDES OF A RULE THIS REPOSITORY ENFORCES.
//
// MEASURED against 895bc7b, by this file rather than quoted from the review:
//
//   scan_fr_summary_altitude.ts       `import.meta.main` occurrences: 0
//                                     probe #81: ordered / UNREACHABLE
//   scan_plan_narrative_altitude.ts   `import.meta.main` occurrences: 3
//                                     probe #81: ordered / reachable
//
// Same probe (#67), same milestone (M137), written days apart. `/gate-check`'s
// probe-#67 registration is ONE line ordering a reader to call BOTH scanners;
// probe #81 classifies that line `ordered` and then grades each named module's
// reachability independently. The module carrying the entire new grandfathering
// layer — `FR_WORD_CAP_EPOCH`, `classifyFrProvenance`,
// `runFrSummaryAltitudeProbe` — is the half nobody can run.
//
// THE RESOLUTION IS THE SANCTIONED ONE. `skills/gate-check/SKILL.md` names two
// and rules a third out: give the module an `import.meta.main` entry, or word
// the registration so it orders nothing. Raising `ORDERED_UNREACHABLE_PIN` to
// admit one more order nobody can carry out is the drift the pin exists to
// catch. This is the first resolution, and because the reference is one of the
// 137 the pin counts, it LOWERS the pin — the sanctioned direction.
//
// RED-state until:
//   1. `adapters/_shared/src/scan_fr_summary_altitude.ts` gains an
//      `if (import.meta.main)` front door in its sibling's exact shape, and
//   2. `ORDERED_UNREACHABLE_PIN` in `adapters/_shared/src/module_reachability.ts`
//      is RE-MEASURED and moved to whatever the probe now reports, and
//   3. every shipped surface stating the pinned count states the new one
//      (pinned by `tests/m136-ste-531-order-fires.test.ts`, not duplicated here).
//
// THE VACUITY THIS FILE EXISTS TO CATCH: a front door that satisfies probe #81
// and prints NOTHING. A `console.log` loop over an empty array is reachable,
// runnable, and worthless. So the CLI is executed against BOTH a clean fixture
// and a violating one, and the violating leg asserts stdout reproduces the raw
// scanner's own verdict row for row — derived on both sides, never a literal.
//
// AND THE SHARPER TRAP, specific to THIS module: its runtime entry point
// `runFrSummaryAltitudeProbe` GRANDFATHERS `word_cap` on a tree that is not a
// git repository — every temp fixture in this suite is exactly such a tree. A
// front door wired to the graded probe would therefore print nothing on a
// violating fixture and look correct. The `NOT SILENCED BY PROVENANCE` block
// below establishes that silence as the control and then refuses it.

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ORDERED_UNREACHABLE_PIN,
  runModuleReachabilityProbe,
} from "../adapters/_shared/src/module_reachability";
import {
  SUMMARY_WORD_CAP,
  runFrSummaryAltitudeProbe,
  scanFrSummaryAltitude,
  type FrSummaryAltitudeViolation,
} from "../adapters/_shared/src/scan_fr_summary_altitude";
import { scanPlanNarrativeAltitude } from "../adapters/_shared/src/scan_plan_narrative_altitude";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");
const SHARED_SRC = join(PLUGIN_ROOT, "adapters", "_shared", "src");
const FR_SCANNER = join(SHARED_SRC, "scan_fr_summary_altitude.ts");
const PLAN_SCANNER = join(SHARED_SRC, "scan_plan_narrative_altitude.ts");

/** Repo-relative module keys exactly as probe #81 records them. */
const FR_SCANNER_KEY = "adapters/_shared/src/scan_fr_summary_altitude.ts";
const PLAN_SCANNER_KEY = "adapters/_shared/src/scan_plan_narrative_altitude.ts";

/**
 * `ORDERED_UNREACHABLE_PIN` as it stood at 895bc7b — BEFORE the front door.
 *
 * A bare literal on purpose: the whole claim is that the pin MOVED, and a
 * "before" read from the same module the "after" comes from could never
 * disagree with it. The direction is asserted (strictly down), never the
 * destination — the new value is re-measured from the probe, per the remedy
 * the check itself prints.
 */
const PIN_BEFORE_THE_FRONT_DOOR = 137;

const read = (path: string): string => readFileSync(path, "utf-8");

const dirs: string[] = [];
function makeRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "fr-front-door-"));
  dirs.push(dir);
  mkdirSync(join(dir, "specs", "frs"), { recursive: true });
  return dir;
}
function cleanup(): void {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
}

/** A `## Summary` well inside every cap: short, no backtick, no AC-ID, no path. */
const CLEAN_FR = [
  "# STE-000: a clean fixture",
  "",
  "## Summary",
  "",
  "The gate refuses a release whose stated count is not the count it measures.",
  "",
  "## Requirement",
  "",
  "It has to hold.",
  "",
].join("\n");

/**
 * A `## Summary` that breaks TWO rules of two different classes: `word_cap`
 * (accumulating) and `backtick` (a per-line predicate). One rule alone could
 * be printed by a front door wired to half the scanner.
 */
function violatingFr(): string {
  const long = new Array(SUMMARY_WORD_CAP + 40).fill("altitude").join(" ");
  return [
    "# STE-001: a violating fixture",
    "",
    "## Summary",
    "",
    "This line carries a `backtick` and is therefore a per-line violation.",
    long,
    "",
  ].join("\n");
}

/** The sibling's shipped output shape, reproduced from a violation row. */
const renderRow = (v: FrSummaryAltitudeViolation): string =>
  `${v.file}:${v.line} — ${v.rule} — ${v.section}`;

interface Run {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly lines: string[];
}

function runCli(modulePath: string, projectRoot: string): Run {
  const proc = Bun.spawnSync(["bun", "run", modulePath, projectRoot], {
    cwd: REPO_ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = proc.stdout.toString();
  return {
    stdout,
    stderr: proc.stderr.toString(),
    exitCode: proc.exitCode ?? -1,
    lines: stdout.split("\n").filter((l) => l.trim() !== ""),
  };
}

// ===========================================================================
// The asymmetry itself
// ===========================================================================

describe("C5 — both halves of probe #67 carry a command-line front door", () => {
  test("the sibling has one (the control that proves the shape exists)", () => {
    expect(read(PLAN_SCANNER)).toContain("if (import.meta.main)");
  });

  test("the FR scanner has one too — the half carrying the grandfathering layer", () => {
    const source = read(FR_SCANNER);
    expect(
      source.includes("if (import.meta.main)"),
      `${FR_SCANNER_KEY} carries no \`import.meta.main\` guard, so probe #67's own ` +
        `registration orders a reader to run a module that cannot be run. Its sibling ` +
        `${PLAN_SCANNER_KEY} has carried one since it landed.`,
    ).toBe(true);
  });

  test("importing it stays side-effect-free — the guard is what gates the run", () => {
    const proc = Bun.spawnSync(
      ["bun", "-e", `await import(${JSON.stringify(FR_SCANNER)});`],
      { cwd: REPO_ROOT, stdout: "pipe", stderr: "pipe" },
    );
    expect(proc.exitCode).toBe(0);
    expect(proc.stdout.toString().trim()).toBe("");
  });
});

// ===========================================================================
// It EXECUTES AND MEASURES — the vacuity leg
// ===========================================================================

describe("C5 — the front door runs, and what it prints is a measurement", () => {
  test("clean tree: exit 0 and not one line of output", () => {
    const root = makeRoot();
    writeFileSync(join(root, "specs", "frs", "STE-000.md"), CLEAN_FR);
    expect(scanFrSummaryAltitude(root)).toEqual([]);

    const run = runCli(FR_SCANNER, root);
    expect(run.exitCode, run.stderr).toBe(0);
    expect(run.stdout.trim()).toBe("");
    cleanup();
  });

  test("absent `specs/frs/` is a verdict, not a crash", () => {
    const dir = mkdtempSync(join(tmpdir(), "fr-front-door-bare-"));
    dirs.push(dir);
    const run = runCli(FR_SCANNER, dir);
    expect(run.exitCode, run.stderr).toBe(0);
    expect(run.stdout.trim()).toBe("");
    cleanup();
  });

  test("violating tree: stdout reproduces the scanner's verdict ROW FOR ROW", () => {
    const root = makeRoot();
    writeFileSync(join(root, "specs", "frs", "STE-001.md"), violatingFr());

    // Both sides derived. The expectation is computed from the same scanner
    // the front door is supposed to be a door onto — never a typed literal —
    // so a front door printing a fixed string cannot satisfy it.
    const expected = scanFrSummaryAltitude(root).map(renderRow);
    expect(
      expected.length,
      "the fixture must actually violate, or the leg below is vacuous",
    ).toBeGreaterThan(0);

    const run = runCli(FR_SCANNER, root);
    expect(run.exitCode, run.stderr).toBe(0);
    expect(
      run.lines,
      `the front door printed ${run.lines.length} line(s) where the scanner ` +
        `returns ${expected.length} violation(s)\nstdout:\n${run.stdout}`,
    ).toEqual(expected);
    cleanup();
  });

  test("it names BOTH rule classes — accumulating and per-line", () => {
    const root = makeRoot();
    writeFileSync(join(root, "specs", "frs", "STE-001.md"), violatingFr());
    const run = runCli(FR_SCANNER, root);
    expect(run.stdout).toContain("word_cap");
    expect(run.stdout).toContain("backtick");
    expect(run.stdout).toContain("Summary");
    cleanup();
  });

  test("NOT SILENCED BY PROVENANCE — the trap this module carries and its sibling does not", () => {
    const root = makeRoot();
    writeFileSync(join(root, "specs", "frs", "STE-001.md"), violatingFr());

    // THE CONTROL. A temp directory is not a git tree, so the graded runtime
    // entry point classifies the file `legacy` and drops every `word_cap` row
    // into `grandfathered`. A front door wired to THAT would print nothing here
    // and read as a clean pass on a file that breaks two caps.
    const graded = runFrSummaryAltitudeProbe(root);
    expect(graded.grandfatheredRows).toBeGreaterThan(0);
    expect(graded.violations.filter((v) => v.rule === "word_cap")).toEqual([]);

    // THE REFUSAL. The front door speaks for the raw scanner, so the row the
    // grandfathering arm spared is still printed.
    const run = runCli(FR_SCANNER, root);
    expect(
      run.stdout,
      "the front door went silent on a violating fixture because the tree is not " +
        "a git repository — that is the vacuity, not a pass",
    ).toContain("word_cap");
    cleanup();
  });

  test("the sibling still behaves identically — no regression on the half that worked", () => {
    const root = mkdtempSync(join(tmpdir(), "fr-front-door-plan-"));
    dirs.push(root);
    mkdirSync(join(root, "specs", "plan"), { recursive: true });
    writeFileSync(
      join(root, "specs", "plan", "M999.md"),
      ["# Plan", "", "## M999", "", "### Notes", "", new Array(200).fill("narrative").join(" "), ""].join("\n"),
    );
    const expected = scanPlanNarrativeAltitude(root).map(renderRow);
    expect(expected.length).toBeGreaterThan(0);
    expect(runCli(PLAN_SCANNER, root).lines).toEqual(expected);
    cleanup();
  });
});

// ===========================================================================
// The pin, re-measured rather than assumed
// ===========================================================================

describe("C5 — probe #81 after the front door", () => {
  test("no reference to the FR scanner is ordered-and-unreachable any more", async () => {
    const report = await runModuleReachabilityProbe(REPO_ROOT);
    const refs = report.records.filter((r) => r.module === FR_SCANNER_KEY);
    expect(refs.length, "the module is referenced by at least one shipped surface")
      .toBeGreaterThan(0);
    const stranded = refs.filter((r) => r.refClass === "ordered" && !r.reachable);
    expect(
      stranded.map((r) => `${r.surface}:${r.line}`),
      "an order naming this module that nobody can carry out",
    ).toEqual([]);
  }, 120_000);

  test("the two halves of probe #67 now agree — both reachable everywhere", async () => {
    const report = await runModuleReachabilityProbe(REPO_ROOT);
    for (const key of [FR_SCANNER_KEY, PLAN_SCANNER_KEY]) {
      const refs = report.records.filter((r) => r.module === key);
      expect(refs.length, `${key} is referenced`).toBeGreaterThan(0);
      for (const ref of refs) {
        expect(ref.reachable, `${key} at ${ref.surface}:${ref.line}`).toBe(true);
      }
    }
  }, 120_000);

  test("the pin equals the count the probe MEASURES, and the run is clean", async () => {
    const report = await runModuleReachabilityProbe(REPO_ROOT);
    expect(
      report.orderedUnreachable,
      `measured ${report.orderedUnreachable} against pin ${ORDERED_UNREACHABLE_PIN} — ` +
        `re-measure and move the pin per the probe's own remedy; never raise it`,
    ).toBe(ORDERED_UNREACHABLE_PIN);
    expect(report.ok).toBe(true);
  }, 120_000);

  test("the move was a LOWERING — giving an order a front door, not admitting one more", () => {
    expect(
      ORDERED_UNREACHABLE_PIN,
      `the pin still stands at ${PIN_BEFORE_THE_FRONT_DOOR}; a front door on ` +
        `${FR_SCANNER_KEY} makes one catalogued order runnable, so the count must fall`,
    ).toBeLessThan(PIN_BEFORE_THE_FRONT_DOOR);
  });
});
