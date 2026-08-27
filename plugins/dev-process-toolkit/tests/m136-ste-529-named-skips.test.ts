// M136 STE-529 — the skip ratchet compares named skips and says which
// comparison it made.
//
// WHAT THIS FILE PINS, and why each leg is shaped the way it is.
//
//   AC.1  A baseline record MAY carry `names`. The identity source for the bun
//         stack is `bun test --reporter=junit --reporter-outfile=<path>`, and
//         the leg proves the "one run, both signals" claim by RUNNING it once
//         over a real fixture suite and reading BOTH the junit report (which
//         names the skips) and the stdout summary (which the shipped
//         `parseTestOutput` turns into the count). A hand-authored xml document
//         would test the parser against the author's belief about the format;
//         the FR's Testing section forbids exactly that.
//
//   AC.2  Both sides named ⇒ the verdict is computed from the SET. The newly
//         skipping tests are `current \ baseline`, the outcome is `fail` if and
//         only if that set is non-empty, and the rendered line NAMES them —
//         capped, with the total stated when capped. The cap is DISCOVERED
//         behaviourally (render two, render twenty-five, compare how many were
//         named) so this file holds no copy of a number the implementer picks.
//
//   AC.3  Neither side named ⇒ today's scalar arithmetic, byte for byte, plus a
//         label saying the comparison was count-only. Asserted BOTH ways: the
//         count-only rendering carries the label and the SET rendering does
//         not. A label on every line is not a label.
//
//   AC.4  A named baseline meeting an unnamed run is `incomparable`, cause
//         `unnamed-run` — never `pass`, and never a delta, INCLUDING a delta of
//         zero. The pair is built with EQUAL counts on purpose: that is the
//         "cannot compare collapsing into measured zero" shape, and a leg built
//         from unequal counts would pass on a module that merely subtracted.
//         These legs are also the production constructor STE-530's AC.4 was
//         left waiting on — `unnamed-run` has been in the vocabulary with
//         nothing that raises it.
//
//   AC.5  The OTHER direction — a count-only baseline meeting a named run — is
//         a comparison, just a weak one. Asserted as NOT incomparable, in the
//         same test as AC.4's shape, because the pin that matters is that the
//         two directions are deliberately not symmetric.
//
//   AC.6  The discriminating case, both halves in one test: one skip removed,
//         a different one added, counts equal. The scalar returns `pass` with
//         delta 0 — asserted, as the behaviour being replaced — and the set
//         returns `fail` naming the added identity.
//
//   AC.7  Extraction is non-vacuous in BOTH directions and the two absences are
//         distinguishable: a report parsed with zero skips is `named` with an
//         EMPTY set; an absent, unreadable or unparseable report is
//         `unavailable`. Asserted with distinct expected values in one test,
//         since the whole point is that they must not compare equal. A parse
//         failure read as an empty set is the fail-open shape AC-STE-508.4
//         already closed once for counts.
//
//   AC.8  `namesSource` is written into the record, so "this stack cannot name
//         its skips" and "the writer forgot" do not read the same. Three record
//         states are asserted PAIRWISE DISTINCT: named, degraded-with-a-source,
//         and silent.
//
//   AC.9  Two executed mutations, each asserted to have APPLIED, each naming
//         the clause it changed:
//           * `newlySkipping` inverted (it computes the REMOVED tests) ⇒ AC.2's
//             assertion goes red;
//           * the count-only label deleted ⇒ AC.3's assertion goes red.
//         Both run a real mutated COPY of the module, so the mutation is
//         executed rather than grepped, and `mutateInRegion` aborts loudly when
//         an anchor is absent (M121 § 0k(m)).
//
//   AC.10 Extraction takes the report path FROM THE CALLER and composes none of
//         its own. Asserted behaviourally (a report at an arbitrary path is
//         read) and structurally (the module imports no path composer and holds
//         no artifact-location literal). A second composer of that path agrees
//         with the caller right up until the caller moves it.
//
// CONTRACTS THIS FILE DEFINES FOR THE IMPLEMENTER.
//
//   * A NEW module `adapters/_shared/src/skip_identities.ts` exporting:
//       - `extractSkipIdentities(reportPath: string): SkipIdentities`, where
//         `SkipIdentities` is `{ status: "named"; names: readonly string[] }`
//         or `{ status: "unavailable" }`. Arity ONE: no default path.
//       - `skipIdentityCommand(stack: string, reportPath: string): string | null`
//         — the runner invocation that writes a machine-readable report at the
//         caller's path, or `null` for a stack with no identity source.
//       - `skipNamesSource(stack: string): string` — the value a record
//         captured on that stack carries in `namesSource`.
//     `skip_baseline.ts` must NOT import it: the extraction reads a file, the
//     verdict is pure, and folding one into the other makes the pure one impure
//     for every existing caller (the FR's Technical Design).
//
//   * `skip_baseline.ts` gains a set-aware SIBLING, leaving `classifySkipDelta`
//     byte-identical (AC-STE-530.7 pins its renderings):
//       - `SkipObservation = { count: number; names: readonly string[] | null }`
//         — `null` names is "not named", which is NOT an empty set.
//       - `classifySkipSetDelta(baseline: SkipObservation | null,
//                               current: SkipObservation): SkipVerdict`
//       - `SkipVerdict` gains a comparison discriminator (an INLINE union,
//         NOT a second exported vocabulary). The implementer chose the
//         spelling `countOnly?: true`; this line described the shape this
//         file ASKED for, and was left standing after the module answered
//         with a different one.
//         deliberately not a fourth exported vocabulary — `SKIP_OUTCOMES` and
//         `SKIP_INCOMPARABLE_CAUSES` stay the module's only two array-shaped
//         exports, which is what STE-530's `discoverCauses` discovers) and
//         `newSkips?: readonly string[]`.
//       - `SkipBaselineRecord` gains `names?: readonly string[]` and
//         `namesSource?: string`, both OMITTED when nothing was supplied, so a
//         record captured the old way is byte-identical.
//       - `captureSkipBaseline` gains an optional FOURTH parameter,
//         `{ names?: readonly string[]; namesSource?: string }`.
//       - `function newlySkipping(baseline, current): readonly string[]` is a
//         TOP-LEVEL function declaration called by BARE NAME from the set path.
//         AC.9's first mutation renames it and appends a replacement, so an
//         arrow const, an inlined difference, or a call routed through an
//         object property leaves the mutation with nothing to bind to and the
//         leg proves nothing. Same anchor discipline as STE-527's mutants.
//       - The count-only label lives in exactly ONE string literal matching
//         /count[-\s]only/i, so AC.9's second mutation has a determined site.

import { afterAll, describe, expect, test } from "bun:test";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { parseTestOutput } from "../adapters/_shared/src/test_count_parser";
import { makeTrunkRepo as sharedMakeTrunkRepo } from "./_skip_baseline_fixture";
import { mutateInRegion } from "./_sited-mutation";

// ===========================================================================
// Paths, handles, throwaway trees.
// ===========================================================================

const PLUGIN_ROOT = join(import.meta.dir, "..");
const SHARED_SRC = join(PLUGIN_ROOT, "adapters", "_shared", "src");
const SKIP_BASELINE_FILE = join(SHARED_SRC, "skip_baseline.ts");
const SKIP_IDENTITIES_FILE = join(SHARED_SRC, "skip_identities.ts");

const read = (p: string): string => readFileSync(p, "utf-8");

/** The label a count-only comparison must write into its own row (AC.3). */
const COUNT_ONLY_LABEL = /count[-\s]only/i;

interface SkipVerdictShape {
  readonly outcome: string;
  readonly baseline: number | null;
  readonly current: number;
  readonly delta: number | null;
  readonly [extra: string]: unknown;
}

interface SkipObservationShape {
  readonly count: number;
  readonly names: readonly string[] | null;
}

interface SkipBaselineModule {
  readonly SKIP_INCOMPARABLE_CAUSES: readonly string[];
  classifySkipDelta(baseline: number | null, current: number): SkipVerdictShape;
  classifySkipSetDelta(
    baseline: SkipObservationShape | null,
    current: SkipObservationShape,
  ): SkipVerdictShape;
  renderSkipVerdict(verdict: SkipVerdictShape): string;
  captureSkipBaseline(
    projectRoot: string,
    sha: string,
    skipped: number,
    identity?: { readonly names?: readonly string[]; readonly namesSource?: string },
  ): { written: boolean; record: Record<string, unknown> };
  readSkipBaseline(projectRoot: string): {
    status: string;
    record?: Record<string, unknown>;
  };
}

type SkipIdentitiesShape =
  | { readonly status: "named"; readonly names: readonly string[] }
  | { readonly status: "unavailable" };

interface SkipIdentitiesModule {
  extractSkipIdentities(reportPath: string): SkipIdentitiesShape;
  skipIdentityCommand(stack: string, reportPath: string): string | null;
  skipNamesSource(stack: string): string;
}

async function loadSkipBaseline(): Promise<SkipBaselineModule> {
  return (await import("../adapters/_shared/src/skip_baseline")) as unknown as SkipBaselineModule;
}

async function loadIdentities(): Promise<SkipIdentitiesModule> {
  return (await import(
    "../adapters/_shared/src/skip_identities"
  )) as unknown as SkipIdentitiesModule;
}

const TEMP_DIRS: string[] = [];

function tempDir(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `ste529-${label}-`));
  TEMP_DIRS.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of TEMP_DIRS.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/**
 * The shared git fixture, with its root registered for cleanup. The shared
 * helper mints its own directory and leaves disposal to the caller, so a file
 * that forgets leaves a repository per capture behind.
 */
function makeTrunkRepo(label: string): { readonly root: string; readonly trunkSha: string } {
  const repo = sharedMakeTrunkRepo(label);
  TEMP_DIRS.push(repo.root);
  return repo;
}

// ===========================================================================
// A real runner over a real tiny suite. Not a hand-authored xml document.
// ===========================================================================

interface SuiteFile {
  /** Path relative to the fixture root, e.g. `tests/a.test.ts`. */
  readonly path: string;
  /** Test names that RUN. */
  readonly kept: readonly string[];
  /** Test names that are SKIPPED. */
  readonly skipped: readonly string[];
}

/** Write a runnable bun suite whose skipped tests are known by construction. */
function makeSuite(label: string, files: readonly SuiteFile[]): string {
  const root = tempDir(`suite-${label}`);
  for (const file of files) {
    const target = join(root, file.path);
    mkdirSync(dirname(target), { recursive: true });
    const body = [
      'import { expect, test } from "bun:test";',
      "",
      ...file.kept.map((name) =>
        `test(${JSON.stringify(name)}, () => { expect(1 + 1).toBe(2); });`,
      ),
      ...file.skipped.map((name) =>
        `test.skip(${JSON.stringify(name)}, () => { expect(1).toBe(2); });`,
      ),
      "",
    ].join("\n");
    writeFileSync(target, body);
  }
  return root;
}

interface RunnerResult {
  readonly stdout: string;
  readonly reportPath: string;
  readonly exitCode: number;
}

/**
 * Run the identity command the MODULE composes — not a command retyped here —
 * in `root`, writing its report at `reportPath`. Both halves of AC.1's "one
 * run, both signals" claim come out of this single spawn.
 */
function runIdentityCommand(
  identities: SkipIdentitiesModule,
  root: string,
  reportPath: string,
): RunnerResult {
  const command = identities.skipIdentityCommand("bun", reportPath);
  expect(command, "the bun stack must have an identity command (AC-STE-529.1)").not.toBeNull();

  const proc = Bun.spawnSync(["/bin/sh", "-c", command as string], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    stdout: `${proc.stdout.toString()}\n${proc.stderr.toString()}`,
    reportPath,
    exitCode: proc.exitCode,
  };
}

// ===========================================================================
// AC-STE-529.1 — a record MAY carry names, extracted from the runner's own
// machine-readable report, at no extra run.
// ===========================================================================

describe("AC-STE-529.1 — one run, both signals, and the record may carry the names", () => {
  test("the bun identity command names every skip while the same run still reports the count", async () => {
    const identities = await loadIdentities();

    const root = makeSuite("both-signals", [
      { path: "tests/a.test.ts", kept: ["kept alpha"], skipped: ["skipped alpha"] },
      {
        path: "tests/b.test.ts",
        kept: ["kept beta", "kept gamma"],
        skipped: ["skipped beta", "skipped gamma"],
      },
    ]);
    const reportPath = join(tempDir("report-both"), "junit.xml");

    const run = runIdentityCommand(identities, root, reportPath);

    // SIGNAL ONE — the stdout summary, read by the SHIPPED count parser. If the
    // identity command suppressed it, identities would cost a second run and
    // the FR's premise would be false.
    const counted = parseTestOutput(run.stdout, "bun");
    expect(counted.ok, `the count parser could not read the run: ${run.stdout.slice(0, 400)}`).toBe(
      true,
    );
    expect((counted as { ok: true; count: { skipped: number } }).count.skipped).toBe(3);

    // SIGNAL TWO — the report, from the SAME run, naming each skip.
    expect(existsSync(reportPath), `no report was written at ${reportPath}`).toBe(true);
    const extracted = identities.extractSkipIdentities(reportPath);
    expect(extracted.status).toBe("named");
    const names = (extracted as { names: readonly string[] }).names;

    expect(names).toHaveLength(3);
    for (const skipped of ["skipped alpha", "skipped beta", "skipped gamma"]) {
      expect(
        names.some((name) => name.includes(skipped)),
        `the extracted identities do not name ${JSON.stringify(skipped)}: ${names.join(" | ")}`,
      ).toBe(true);
    }
    // And they name ONLY the skips. A parser that returned every testcase would
    // satisfy the loop above and make the whole ratchet meaningless.
    for (const kept of ["kept alpha", "kept beta", "kept gamma"]) {
      expect(
        names.some((name) => name.includes(kept)),
        `a test that RAN was reported as skipped: ${kept}`,
      ).toBe(false);
    }
  });

  test("an identity carries more than the bare test name, so two files do not collide", async () => {
    const identities = await loadIdentities();

    // The same test name, skipped in two different files. If the identity is
    // the bare name, the set holds ONE member and every cross-file comparison
    // silently loses a skip.
    const root = makeSuite("collide", [
      { path: "tests/one.test.ts", kept: [], skipped: ["the shared name"] },
      { path: "tests/two.test.ts", kept: [], skipped: ["the shared name"] },
    ]);
    const reportPath = join(tempDir("report-collide"), "junit.xml");
    runIdentityCommand(identities, root, reportPath);

    const extracted = identities.extractSkipIdentities(reportPath);
    expect(extracted.status).toBe("named");
    const names = (extracted as { names: readonly string[] }).names;

    expect(
      new Set(names).size,
      `two skips with the same name in different files collapsed to one identity: ${names.join(" | ")}`,
    ).toBe(2);
    expect(names.some((name) => name.includes("one.test.ts"))).toBe(true);
    expect(names.some((name) => name.includes("two.test.ts"))).toBe(true);
  });

  test("a captured baseline record carries the names it was given, and omits the key when it was not", async () => {
    const mod = await loadSkipBaseline();

    const namedRepo = makeTrunkRepo("ste529-record-named");
    const captured = mod.captureSkipBaseline(namedRepo.root, namedRepo.trunkSha, 2, {
      names: ["tests/a.test.ts > skipped alpha", "tests/b.test.ts > skipped beta"],
      namesSource: "bun-junit",
    });
    expect(captured.written).toBe(true);

    const back = mod.readSkipBaseline(namedRepo.root);
    expect(back.status).toBe("ok");
    const record = back.record as Record<string, unknown>;
    expect(record.skipped).toBe(2);
    expect(record.names).toEqual([
      "tests/a.test.ts > skipped alpha",
      "tests/b.test.ts > skipped beta",
    ]);

    // MAY carry, not MUST. A capture given nothing writes no `names` key at
    // all — an empty array here would read as "named, and none", which is a
    // different fact (AC.7) and would make every later run fail.
    const silent = makeTrunkRepo("ste529-record-silent");
    mod.captureSkipBaseline(silent.root, silent.trunkSha, 2);
    const silentRecord = (mod.readSkipBaseline(silent.root).record ?? {}) as Record<
      string,
      unknown
    >;
    expect(Object.keys(silentRecord)).not.toContain("names");
  });
});

// ===========================================================================
// AC-STE-529.2 — both sides named: the verdict is a SET difference, and the
// line names its members.
// ===========================================================================

/** An observation that is NAMED: the count is derived from the names it holds. */
function named(names: readonly string[]): SkipObservationShape {
  return { count: names.length, names };
}

/** An observation that is NOT named: a bare count. `null`, never `[]`. */
function counted(count: number): SkipObservationShape {
  return { count, names: null };
}

describe("AC-STE-529.2 — both sides named, the verdict comes from the set", () => {
  test("the outcome is fail if and ONLY if a test is skipping now that was not at baseline", async () => {
    const mod = await loadSkipBaseline();

    // An added identity: fail, even though the count is what decides today.
    const added = mod.classifySkipSetDelta(named(["a", "b"]), named(["a", "b", "c"]));
    expect(added.outcome).toBe("fail");
    expect(added.newSkips).toEqual(["c"]);

    // Removals only: pass. Nothing this change did put a skip on the board.
    const removed = mod.classifySkipSetDelta(named(["a", "b", "c"]), named(["a"]));
    expect(removed.outcome).toBe("pass");
    expect(removed.newSkips).toEqual([]);

    // Identical sets: pass, empty difference.
    const same = mod.classifySkipSetDelta(named(["a", "b"]), named(["b", "a"]));
    expect(same.outcome).toBe("pass");
    expect(same.newSkips).toEqual([]);

    // THE ONLY-IF HALF. The count went DOWN — the scalar path calls this a pass
    // — and a new identity is still on the board, so the set path fails.
    const fewerButNew = mod.classifySkipSetDelta(named(["a", "b", "c", "d"]), named(["a", "b", "e"]));
    expect(mod.classifySkipDelta(4, 3).outcome, "the scalar path's verdict on the same pair").toBe(
      "pass",
    );
    expect(fewerButNew.outcome).toBe("fail");
    expect(fewerButNew.newSkips).toEqual(["e"]);
  });

  test("the rendered fail line NAMES the newly skipping tests", async () => {
    const mod = await loadSkipBaseline();

    const verdict = mod.classifySkipSetDelta(
      named(["kept::one", "kept::two"]),
      named(["kept::one", "kept::two", "zz-new-001", "zz-new-002"]),
    );
    const line = mod.renderSkipVerdict(verdict);

    expect(line).toStartWith("skips: ");
    expect(line).toContain("FAIL");
    expect(line, `the line does not name zz-new-001: ${line}`).toContain("zz-new-001");
    expect(line, `the line does not name zz-new-002: ${line}`).toContain("zz-new-002");
    // Only the NEW ones. A line that pasted the whole current set would satisfy
    // the two assertions above while telling the reader nothing.
    expect(line).not.toContain("kept::one");
  });

  test("the naming is CAPPED, and the total is stated when it caps", async () => {
    const mod = await loadSkipBaseline();

    const many = Array.from({ length: 25 }, (_, i) => `zz-new-${String(i + 1).padStart(3, "0")}`);
    const line = mod.renderSkipVerdict(mod.classifySkipSetDelta(named([]), named(many)));
    const namedInLine = many.filter((name) => line.includes(name));

    // The cap itself is the implementer's to pick — this file holds no copy of
    // it. What is pinned is that a cap EXISTS and that it hides nothing.
    expect(
      namedInLine.length,
      `25 new skips were all named; a report that scrolls is a report nobody reads: ${line}`,
    ).toBeLessThan(many.length);
    expect(namedInLine.length, "a capped line must still name somebody").toBeGreaterThan(0);
    expect(
      line,
      `the cap hid the magnitude — the total 25 is not stated: ${line}`,
    ).toContain("25");

    // And a SMALL set is not capped: the cap is a ceiling, not a default.
    const few = ["zz-new-001", "zz-new-002"];
    const smallLine = mod.renderSkipVerdict(mod.classifySkipSetDelta(named([]), named(few)));
    expect(few.every((name) => smallLine.includes(name))).toBe(true);
  });
});

// ===========================================================================
// AC-STE-529.3 — neither side named: today's arithmetic, plus a label.
// ===========================================================================

describe("AC-STE-529.3 — the count-only comparison says it is count-only", () => {
  test("the arithmetic is byte-for-byte the scalar path's", async () => {
    const mod = await loadSkipBaseline();

    for (const [baseline, current] of [
      [2, 5],
      [4, 4],
      [6, 1],
      [0, 1],
    ] as const) {
      const scalar = mod.classifySkipDelta(baseline, current);
      const setAware = mod.classifySkipSetDelta(counted(baseline), counted(current));

      expect(setAware.outcome, `outcome for ${baseline} → ${current}`).toBe(scalar.outcome);
      expect(setAware.baseline).toBe(scalar.baseline);
      expect(setAware.current).toBe(scalar.current);
      expect(setAware.delta).toBe(scalar.delta);
      // No set was compared, so there is no set to report.
      expect(setAware.newSkips).toBeUndefined();
    }
  });

  test("the rendered row labels itself count-only, and the set row does NOT", async () => {
    const mod = await loadSkipBaseline();

    const countOnly = mod.renderSkipVerdict(mod.classifySkipSetDelta(counted(2), counted(5)));
    expect(
      countOnly,
      `a comparison that silently got weaker is indistinguishable from one that did not: ${countOnly}`,
    ).toMatch(COUNT_ONLY_LABEL);

    // ISOLATION. A label that appears on every row is not a label. The set
    // comparison is the strong one and must not wear the weak one's badge.
    const setLine = mod.renderSkipVerdict(
      mod.classifySkipSetDelta(named(["a"]), named(["a", "b"])),
    );
    expect(setLine, `the SET comparison called itself count-only: ${setLine}`).not.toMatch(
      COUNT_ONLY_LABEL,
    );

    // And the legacy scalar surface is untouched: AC-STE-530.7 pins those
    // renderings byte-wise, and a label appended there would turn them red.
    expect(mod.renderSkipVerdict(mod.classifySkipDelta(2, 5))).toBe(
      "skips: FAIL — 5 now vs 2 at the branch point (delta +3)",
    );
  });
});

// ===========================================================================
// AC-STE-529.4 and AC-STE-529.5 — the two mixed directions, deliberately not
// symmetric.
// ===========================================================================

describe("AC-STE-529.4 — a named baseline meeting an unnamed run refuses", () => {
  test("equal counts do not collapse into a measured zero", async () => {
    const mod = await loadSkipBaseline();

    // EQUAL COUNTS on purpose: this is the exact shape that "cannot compare"
    // turns into "measured zero" under a module that merely subtracts.
    const verdict = mod.classifySkipSetDelta(named(["a", "b", "c"]), counted(3));

    expect(verdict.outcome).toBe("incomparable");
    expect(verdict.outcome).not.toBe("pass");
    expect(verdict.delta, "a refusal reported a delta — including zero is still reporting").toBe(
      null,
    );

    // The cause is the vocabulary member STE-530 shipped with no producer; this
    // is its production constructor.
    expect(mod.SKIP_INCOMPARABLE_CAUSES).toContain("unnamed-run");
    expect(verdict.cause).toBe("unnamed-run");

    const line = mod.renderSkipVerdict(verdict);
    expect(line.toLowerCase()).toContain("incomparable");
    expect(line.toLowerCase(), `a refusal rendered as a pass: ${line}`).not.toContain("pass");
    expect(line, `a refusal rendered a delta: ${line}`).not.toContain("delta");
    expect(line).not.toContain(" now vs ");
  });

  test("an ABSENT baseline is still unmeasured, not incomparable", async () => {
    const mod = await loadSkipBaseline();

    // Nothing was ever captured — a different fact with a different remedy.
    // Folding it into the refusal above would lose that distinction.
    expect(mod.classifySkipSetDelta(null, named(["a"])).outcome).toBe("unmeasured");
    expect(mod.classifySkipSetDelta(null, counted(4)).outcome).toBe("unmeasured");
  });
});

describe("AC-STE-529.5 — a count-only baseline meeting a named run degrades", () => {
  test("this direction IS a comparison, and it is not the refusal AC.4 makes", async () => {
    const mod = await loadSkipBaseline();

    const degraded = mod.classifySkipSetDelta(counted(3), named(["a", "b", "c", "d"]));

    expect(degraded.outcome, "the baseline number was still measured on this checkout").not.toBe(
      "incomparable",
    );
    expect(degraded.outcome).toBe(mod.classifySkipDelta(3, 4).outcome);
    expect(degraded.baseline).toBe(3);
    expect(degraded.current).toBe(4);
    expect(degraded.delta).toBe(1);
    expect(degraded.newSkips, "no set comparison happened here").toBeUndefined();

    // It says so.
    expect(mod.renderSkipVerdict(degraded)).toMatch(COUNT_ONLY_LABEL);
  });

  test("the two mixed directions do not answer the same way", async () => {
    const mod = await loadSkipBaseline();

    // Same counts, mirrored naming. If these agreed, one of the two ACs would
    // be describing behaviour nothing implements.
    const namedBaseline = mod.classifySkipSetDelta(named(["a", "b", "c"]), counted(3));
    const namedCurrent = mod.classifySkipSetDelta(counted(3), named(["a", "b", "c"]));

    expect(namedBaseline.outcome).toBe("incomparable");
    expect(namedCurrent.outcome).toBe("pass");
    expect(namedBaseline.outcome).not.toBe(namedCurrent.outcome);
  });
});

// ===========================================================================
// AC-STE-529.6 — the discriminating case, both halves in one test.
// ===========================================================================

describe("AC-STE-529.6 — one skip removed, a different one added, counts equal", () => {
  test("the scalar says pass with delta zero and the set says fail, naming the addition", async () => {
    const mod = await loadSkipBaseline();

    const before = ["tests/a.test.ts > flaky login", "tests/b.test.ts > slow upload"];
    const after = ["tests/a.test.ts > flaky login", "tests/c.test.ts > brand new skip"];

    // Equal CARDINALITY, different MEMBERSHIP — stated explicitly rather than
    // produced by mutating a real suite, so the test says what it distinguishes.
    expect(before.length).toBe(after.length);
    expect(new Set(before)).not.toEqual(new Set(after));

    // HALF ONE — the behaviour being replaced, asserted rather than described.
    const scalar = mod.classifySkipDelta(before.length, after.length);
    expect(scalar.outcome).toBe("pass");
    expect(scalar.delta).toBe(0);

    // HALF TWO — the behaviour replacing it.
    const set = mod.classifySkipSetDelta(named(before), named(after));
    expect(set.outcome).toBe("fail");
    expect(set.delta, "the counts really were equal").toBe(0);
    expect(set.newSkips).toEqual(["tests/c.test.ts > brand new skip"]);

    // The disagreement IS the pin.
    expect(set.outcome).not.toBe(scalar.outcome);
    expect(mod.renderSkipVerdict(set)).toContain("tests/c.test.ts > brand new skip");
  });
});

// ===========================================================================
// AC-STE-529.7 — extraction is non-vacuous in both directions, and the two
// absences are distinguishable.
// ===========================================================================

describe("AC-STE-529.7 — `named and none` is not `not named`", () => {
  test("a parsed report with zero skips and an unreadable report have DISTINCT values", async () => {
    const identities = await loadIdentities();

    // A real run over a real suite that skips nothing.
    const root = makeSuite("zero-skips", [
      { path: "tests/a.test.ts", kept: ["one", "two"], skipped: [] },
    ]);
    const zeroPath = join(tempDir("report-zero"), "junit.xml");
    runIdentityCommand(identities, root, zeroPath);
    expect(existsSync(zeroPath)).toBe(true);
    const parsedEmpty = identities.extractSkipIdentities(zeroPath);

    // Three ways to have no report at all.
    const holder = tempDir("absences");
    const absent = identities.extractSkipIdentities(join(holder, "nothing-here.xml"));

    const garbagePath = join(holder, "garbage.xml");
    writeFileSync(garbagePath, "<testsuites><this is not xml at all\u0000\n");
    const unparseable = identities.extractSkipIdentities(garbagePath);

    const dirPath = join(holder, "a-directory.xml");
    mkdirSync(dirPath, { recursive: true });
    const unreadable = identities.extractSkipIdentities(dirPath);

    // NAMED, AND NONE.
    expect(parsedEmpty).toEqual({ status: "named", names: [] });

    // NOT NAMED — all three of them.
    expect(absent).toEqual({ status: "unavailable" });
    expect(unparseable).toEqual({ status: "unavailable" });
    expect(unreadable).toEqual({ status: "unavailable" });

    // The whole point, asserted in the same test as the FR's Testing section
    // requires: these must not compare equal. A parse failure read as an empty
    // set is the fail-open shape AC-STE-508.4 already closed once for counts.
    expect(parsedEmpty).not.toEqual(absent);
    expect(parsedEmpty.status).not.toBe(absent.status);
  });

  test("the two absences reach the verdict as different verdicts", async () => {
    const mod = await loadSkipBaseline();

    // `named and none` compared against a named run is a real comparison.
    const namedNone = mod.classifySkipSetDelta(named([]), named(["a"]));
    expect(namedNone.outcome).toBe("fail");
    expect(namedNone.newSkips).toEqual(["a"]);

    // `not named` in the same position is not.
    const notNamed = mod.classifySkipSetDelta(counted(0), named(["a"]));
    expect(notNamed.outcome).toBe("fail");
    expect(notNamed.newSkips, "a count-only baseline cannot name what was added").toBeUndefined();
    expect(mod.renderSkipVerdict(notNamed)).toMatch(COUNT_ONLY_LABEL);
    expect(mod.renderSkipVerdict(namedNone)).not.toMatch(COUNT_ONLY_LABEL);
  });
});

// ===========================================================================
// AC-STE-529.8 — the degrade is a fact in the record, not an inference from a
// missing key.
// ===========================================================================

describe("AC-STE-529.8 — namesSource names the stack that cannot name its skips", () => {
  test("a stack with no identity source is named by its own namesSource", async () => {
    const identities = await loadIdentities();

    for (const stack of ["bun", "pytest", "flutter", "unknown"]) {
      const source = identities.skipNamesSource(stack);
      expect(typeof source, `skipNamesSource(${stack})`).toBe("string");
      expect(source.length, `skipNamesSource(${stack}) is empty`).toBeGreaterThan(0);

      if (identities.skipIdentityCommand(stack, "/tmp/report.xml") === null) {
        // The degrade written down: the record says WHICH stack could not name
        // its skips, so it never reads as "the writer forgot".
        expect(
          source.toLowerCase(),
          `${stack} has no identity source, so its namesSource must name it: ${source}`,
        ).toContain(stack);
      }
    }

    // Flutter's machine format is deliberately left to the degrade path here.
    expect(identities.skipIdentityCommand("flutter", "/tmp/report.xml")).toBeNull();
    expect(identities.skipNamesSource("flutter")).not.toBe(identities.skipNamesSource("bun"));
    expect(identities.skipNamesSource("bun").toLowerCase()).toContain("junit");
  });

  test("named, degraded and silent are three distinguishable records", async () => {
    const mod = await loadSkipBaseline();
    const identities = await loadIdentities();

    const namedRepo = makeTrunkRepo("ste529-source-named");
    mod.captureSkipBaseline(namedRepo.root, namedRepo.trunkSha, 1, {
      names: ["tests/a.test.ts > skipped alpha"],
      namesSource: identities.skipNamesSource("bun"),
    });
    const namedRecord = mod.readSkipBaseline(namedRepo.root).record as Record<string, unknown>;

    const degradedRepo = makeTrunkRepo("ste529-source-degraded");
    mod.captureSkipBaseline(degradedRepo.root, degradedRepo.trunkSha, 1, {
      namesSource: identities.skipNamesSource("flutter"),
    });
    const degradedRecord = mod.readSkipBaseline(degradedRepo.root).record as Record<
      string,
      unknown
    >;

    const silentRepo = makeTrunkRepo("ste529-source-silent");
    mod.captureSkipBaseline(silentRepo.root, silentRepo.trunkSha, 1);
    const silentRecord = mod.readSkipBaseline(silentRepo.root).record as Record<string, unknown>;

    expect(namedRecord.names).toEqual(["tests/a.test.ts > skipped alpha"]);
    expect(namedRecord.namesSource).toBe(identities.skipNamesSource("bun"));

    // The degrade: no names, but a namesSource saying why.
    expect(degradedRecord.names).toBeUndefined();
    expect(String(degradedRecord.namesSource).toLowerCase()).toContain("flutter");

    // The silence: neither. This is the "writer forgot" state, and it must not
    // read like the degrade above.
    expect(silentRecord.names).toBeUndefined();
    expect(silentRecord.namesSource).toBeUndefined();
    expect(degradedRecord.namesSource).not.toBe(silentRecord.namesSource);
  });
});

// ===========================================================================
// AC-STE-529.9 — the set comparison is mutation-verified, and each mutation is
// asserted to have applied. Each leg NAMES the clause it changed.
// ===========================================================================

/**
 * Copy `skip_baseline.ts`'s transitive local import closure beside a mutant.
 *
 * DERIVED, not listed: a new sibling import added later is copied for free. A
 * mutant whose import resolved to nothing would still load under a stale hand
 * list and report GREEN, having proved nothing (M136's `MUTANT_DEPS` note).
 */
function copyLocalClosure(dir: string, entry: string): void {
  const queue = [entry];
  const seen = new Set<string>();

  while (queue.length > 0) {
    const file = queue.shift() as string;
    if (seen.has(file)) continue;
    seen.add(file);

    const source = read(file);
    for (const hit of source.matchAll(/from "(\.\/[\w.\-/]+)"/g)) {
      const relative = (hit[1] as string).slice(2);
      const from = join(SHARED_SRC, `${relative}.ts`);
      expect(existsSync(from), `the import closure names a module that is not there: ${from}`).toBe(
        true,
      );
      const to = join(dir, `${relative}.ts`);
      mkdirSync(dirname(to), { recursive: true });
      copyFileSync(from, to);
      queue.push(from);
    }
  }
}

/** Import a mutated copy of `skip_baseline.ts` from a throwaway directory. */
async function loadMutant(label: string, mutated: string): Promise<SkipBaselineModule> {
  const dir = tempDir(`mutant-${label}`);
  copyLocalClosure(dir, SKIP_BASELINE_FILE);
  const file = join(dir, "skip_baseline.ts");
  writeFileSync(file, mutated);
  return (await import(file)) as unknown as SkipBaselineModule;
}

describe("AC-STE-529.9 — the set comparison is mutation-verified", () => {
  test("CONTROL: the shipped module fails an added skip and labels a count-only row", async () => {
    const mod = await loadSkipBaseline();

    expect(mod.classifySkipSetDelta(named(["a", "b"]), named(["a", "b", "c"])).outcome).toBe(
      "fail",
    );
    expect(mod.renderSkipVerdict(mod.classifySkipSetDelta(counted(2), counted(5)))).toMatch(
      COUNT_ONLY_LABEL,
    );
  });

  test("MUTATION 1: `newlySkipping` inverted to the REMOVED tests turns AC.2 RED", async () => {
    const original = read(SKIP_BASELINE_FILE);

    // The clause changed, named: the top-level `newlySkipping` declaration, the
    // one place the set difference is computed. Renamed and superseded, so the
    // module's own bare-name call sites rebind to the inverted replacement.
    // `mutateInRegion` aborts when the anchor is absent, which is what stops a
    // mutation that never applied from scoring as a pass.
    const renamed = mutateInRegion(
      original,
      0,
      original.length,
      "function newlySkipping(",
      "function unmutatedNewlySkipping(",
      { label: "the newlySkipping set-difference declaration in skip_baseline.ts" },
    );
    const mutated = [
      renamed,
      "",
      "// AC-STE-529.9 MUTATION 1 — the difference computed the other way round.",
      "function newlySkipping(baselineNames: readonly string[], currentNames: readonly string[]) {",
      "  return unmutatedNewlySkipping(currentNames, baselineNames);",
      "}",
      "",
    ].join("\n");

    // APPLIED — measured, not assumed.
    expect(mutated, "the newlySkipping mutation changed nothing").not.toBe(original);
    expect(mutated, "the newlySkipping declaration was not renamed").toContain(
      "function unmutatedNewlySkipping(",
    );

    const mutant = await loadMutant("inverted-difference", mutated);

    // AC.2's assertion, run against the mutant. Under the inversion the added
    // test is invisible and the REMOVED one is reported instead, so the outcome
    // flips from fail to pass.
    const verdict = mutant.classifySkipSetDelta(named(["a", "b"]), named(["a", "b", "c"]));
    expect(
      verdict.outcome,
      "inverting the set difference left AC.2's assertion GREEN — the pin cannot fail",
    ).not.toBe("fail");
    expect(verdict.newSkips, "the inverted difference still reported the added test").not.toEqual([
      "c",
    ]);
  });

  test("MUTATION 2: deleting the count-only label turns AC.3 RED", async () => {
    const original = read(SKIP_BASELINE_FILE);

    // The clause changed, named: the single string literal holding the
    // count-only label. Discovered rather than assumed, so the implementer
    // picks the wording; required to be ONE literal so the site is determined.
    const literals = [
      ...new Set(
        [...original.matchAll(/(["'`])((?:(?!\1)[^\n])*count[-\s]only(?:(?!\1)[^\n])*)\1/gi)].map(
          (hit) => hit[0] as string,
        ),
      ),
    ];
    expect(
      literals,
      "the count-only label must live in exactly ONE string literal in skip_baseline.ts, " +
        "or AC-STE-529.9's second mutation has no determined site",
    ).toHaveLength(1);

    const mutated = mutateInRegion(
      original,
      0,
      original.length,
      literals[0] as string,
      '""',
      { label: "the count-only label literal in skip_baseline.ts" },
    );

    // APPLIED — measured, not assumed.
    expect(mutated, "the count-only label mutation changed nothing").not.toBe(original);
    expect(mutated, "the label literal survived the mutation").not.toContain(literals[0] as string);

    const mutant = await loadMutant("no-count-only-label", mutated);

    // AC.3's assertion, run against the mutant.
    const line = mutant.renderSkipVerdict(mutant.classifySkipSetDelta(counted(2), counted(5)));
    expect(
      line,
      "deleting the count-only label left AC.3's assertion GREEN — the pin cannot fail",
    ).not.toMatch(COUNT_ONLY_LABEL);
  });
});

// ===========================================================================
// AC-STE-529.10 — the report path is the caller's, and the extractor composes
// none of its own.
// ===========================================================================

describe("AC-STE-529.10 — extraction holds no knowledge of where artifacts live", () => {
  test("the report is read from whatever path the caller supplies", async () => {
    const identities = await loadIdentities();

    const root = makeSuite("caller-path", [
      { path: "tests/a.test.ts", kept: ["kept"], skipped: ["skipped one"] },
    ]);
    // A deliberately arbitrary location, nested and oddly named: nothing about
    // it could be guessed by a second composer.
    const odd = join(tempDir("odd"), "some", "where", "else", "report-42.junit");
    mkdirSync(dirname(odd), { recursive: true });

    const command = identities.skipIdentityCommand("bun", odd);
    expect(command, "the bun identity command is missing").not.toBeNull();
    expect(
      command as string,
      "the command did not carry the caller's path — a second composer would drift",
    ).toContain(odd);

    runIdentityCommand(identities, root, odd);
    expect(existsSync(odd), `the command wrote no report at the caller's path ${odd}`).toBe(true);

    const extracted = identities.extractSkipIdentities(odd);
    expect(extracted.status).toBe("named");
    expect((extracted as { names: readonly string[] }).names).toHaveLength(1);
  });

  test("the module composes no path of its own and imports no composer", async () => {
    const identities = await loadIdentities();
    expect(existsSync(SKIP_IDENTITIES_FILE), `${SKIP_IDENTITIES_FILE} does not exist`).toBe(true);
    const source = read(SKIP_IDENTITIES_FILE);

    // No default: the path is REQUIRED, so there is no fallback location that
    // could disagree with the caller.
    expect(identities.extractSkipIdentities.length, "extractSkipIdentities takes one argument").toBe(
      1,
    );

    // The single composer of toolkit-owned paths is `dpt_paths` (M104 /
    // AC-STE-382.1). This module must not reach for it, nor for the tree it
    // composes: a second composer agrees with the caller until the caller moves.
    expect(source, "skip_identities.ts must not import the path composer").not.toContain(
      "dpt_paths",
    );
    expect(source, "skip_identities.ts holds a toolkit-tree literal").not.toContain(".dpt");

    // The two assertions above name LITERALS, and a fallback can avoid both:
    // measured, a mutant composing `join(process.cwd(), "build", …)` via
    // `node:path` kept this whole leg green while doing exactly what the AC
    // forbids. So assert the PROPERTY instead — the module's import list. A
    // module that cannot reach a path-joining primitive cannot compose a path,
    // wherever it might have pointed.
    const imports = [...source.matchAll(/^import\s[^;]*?from\s+"([^"]+)";/gms)].map(
      (hit) => hit[1] as string,
    );
    expect(
      imports.length,
      "skip_identities.ts imports nothing at all — the sweep below would be vacuous",
    ).toBeGreaterThan(0);
    expect(
      imports.filter((from) => from === "node:path" || from.includes("path")),
      "skip_identities.ts imports a path module, so it CAN compose a location of its own",
    ).toEqual([]);

    // And the verdict module must not pull the file reader into itself: the
    // count parser is pure over a string, and folding a file read into it makes
    // it impure for every existing caller (the FR's Technical Design).
    expect(
      read(SKIP_BASELINE_FILE),
      "skip_baseline.ts must not import skip_identities",
    ).not.toContain("skip_identities");
  });
});

// ===========================================================================
// THE WIRING — AC-STE-529.1 / .2 / .3 asserted through SHIPPED ENTRY POINTS.
//
// WHY THIS SECTION EXISTS. Everything above proves that the PARTS work. It
// proves nothing about whether anything calls them. Measured with a repo-wide
// grep on the day this section was written: `classifySkipSetDelta` and every
// export of `skip_identities.ts` had ZERO callers outside their own
// declarations and this file. A milestone opened over `captureSkipBaseline`
// shipping with no callers had reproduced that exact defect inside the FR meant
// to fix it, and AC-STE-529.2's sentence — "when both the baseline and the
// current run carry names, the verdict is computed from the SET" — named a
// state no production path could reach.
//
// So these legs never touch `classifySkipSetDelta`, `extractSkipIdentities` or
// `skipNamesSource` by name. They drive the two front doors an operator and
// `/deliver` actually use:
//
//   WRITE — `adapters/_shared/src/capture_skip_baseline.ts`, run as the real
//           CLI in a real git project, its record read back off disk.
//   READ  — `evaluateSkipDelta`, the entry point `deliver_stage_evidence.ts`
//           calls, observed by its VERDICT rather than by reading its source.
//
// A leg here going green means a name travelled the whole way: out of the
// runner's report, onto disk, back off disk, and into a verdict that disagrees
// with the arithmetic. That is the claim; nothing weaker is worth pinning.
// ===========================================================================

/** The shipped WRITE front door, run as a command rather than imported. */
const CAPTURE_CLI = join(SHARED_SRC, "capture_skip_baseline.ts");

interface EvaluateModule {
  /**
   * The production READ entry point.
   *
   * The third parameter is ADDITIVE and OPTIONAL — `deliver_stage_evidence.ts`
   * and four test files call the two-argument form, and a breaking change here
   * buys the wiring by shattering everything already wired. `null` is "this run
   * could not name its skips", which is NOT the empty array: the empty array is
   * the claim that every skip was named and there were none.
   */
  evaluateSkipDelta(
    projectRoot: string,
    current: number,
    currentNames?: readonly string[] | null,
  ): SkipVerdictShape;
  renderSkipVerdict(verdict: SkipVerdictShape): string;
  captureSkipBaseline(
    projectRoot: string,
    sha: string,
    skipped: number,
    identity?: { readonly names?: readonly string[]; readonly namesSource?: string },
  ): { written: boolean; record: Record<string, unknown> };
}

async function loadEvaluate(): Promise<EvaluateModule> {
  return (await import("../adapters/_shared/src/skip_baseline")) as unknown as EvaluateModule;
}

/** The single composer of toolkit-owned paths — the store's location. */
async function storePath(root: string): Promise<string> {
  const paths = (await import("../adapters/_shared/src/dpt_paths")) as unknown as {
    skipBaselinePath(projectRoot: string): string;
  };
  return paths.skipBaselinePath(root);
}

function gitHere(cwd: string, args: readonly string[]): void {
  const proc = Bun.spawnSync(
    ["git", "-c", "user.email=t@t.test", "-c", "user.name=t", "-C", cwd, ...args],
    { stdout: "pipe", stderr: "pipe" },
  );
  if (proc.exitCode !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed in ${cwd}: ${proc.stderr.toString().slice(0, 400)}`,
    );
  }
}

/**
 * A real bun project the WRITE front door can be run in: a git checkout
 * standing on the protected trunk with a CLEAN tree, a `package.json` marker
 * for `detectGate`, and a genuinely runnable suite whose skips are known by
 * construction.
 *
 * Built on the shared trunk fixture rather than beside it, so it carries the
 * committed `.dpt/.gitignore` a `/setup` project carries — without it the
 * capture's own artifact dirties the tree and capture refuses on itself.
 */
function makeCapturableBunProject(
  label: string,
  skipped: readonly string[],
): { readonly root: string; readonly trunkSha: string } {
  const repo = makeTrunkRepo(label);

  writeFileSync(
    join(repo.root, "package.json"),
    `${JSON.stringify({ name: `ste529-${label}`, private: true }, null, 2)}\n`,
  );
  mkdirSync(join(repo.root, "tests"), { recursive: true });
  writeFileSync(
    join(repo.root, "tests", "wired.test.ts"),
    [
      'import { expect, test } from "bun:test";',
      "",
      'test("a test that really runs", () => { expect(1 + 1).toBe(2); });',
      ...skipped.map((name) => `test.skip(${JSON.stringify(name)}, () => { expect(1).toBe(2); });`),
      "",
    ].join("\n"),
  );

  gitHere(repo.root, ["add", "-A"]);
  gitHere(repo.root, ["commit", "-q", "-m", "chore: suite"]);

  const proc = Bun.spawnSync(["git", "-C", repo.root, "rev-parse", "HEAD"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  return { root: repo.root, trunkSha: proc.stdout.toString().trim() };
}

describe("AC-STE-529.1 wiring — the shipped capture front door records NAMES, not just a count", () => {
  test("running the real CLI in a git project lands a record carrying names and namesSource", async () => {
    const project = makeCapturableBunProject("cli-names", [
      "the alpha case is parked",
      "the beta case is parked",
    ]);

    // The FRONT DOOR, executed. Not `runCapture` imported and not
    // `captureSkipBaseline` handed a hand-built identity object: a capture that
    // names its skips only when a test supplies the names is a capture that
    // never names them in production.
    const proc = Bun.spawnSync(["bun", "run", CAPTURE_CLI, project.root], {
      cwd: project.root,
      stdout: "pipe",
      stderr: "pipe",
    });
    const noise = `${proc.stdout.toString()}\n${proc.stderr.toString()}`.trim().slice(0, 1200);

    const store = await storePath(project.root);
    expect(
      existsSync(store),
      `the capture CLI exited ${proc.exitCode} and wrote no record at ${store}\n${noise}`,
    ).toBe(true);
    expect(proc.exitCode, `the capture CLI exited non-zero\n${noise}`).toBe(0);

    const parsed = JSON.parse(read(store)) as {
      baselines: Record<string, Record<string, unknown>>;
    };
    const record = parsed.baselines[project.trunkSha];
    expect(
      record,
      `the store holds no record for HEAD ${project.trunkSha}: ${Object.keys(parsed.baselines ?? {}).join(", ")}`,
    ).toBeDefined();

    // The count still travels — "one run, both signals" is a claim about the
    // FRONT DOOR, and a wiring that bought the names by losing the count would
    // satisfy every names assertion below.
    expect((record as Record<string, unknown>).skipped, `record: ${JSON.stringify(record)}`).toBe(2);

    // THE GAP THIS LEG EXISTS FOR. Today the record is a count alone: nothing
    // in production extracts an identity, so `names` is absent and the SET
    // comparison AC-STE-529.2 specifies can never be reached from a real
    // capture.
    const names = (record as Record<string, unknown>).names;
    expect(
      Array.isArray(names),
      `the captured record carries no \`names\` array — the capture front door ` +
        `stored a count alone: ${JSON.stringify(record)}`,
    ).toBe(true);
    const named = names as readonly string[];
    expect(named).toHaveLength(2);
    for (const skip of ["the alpha case is parked", "the beta case is parked"]) {
      expect(
        named.some((name) => name.includes(skip)),
        `the record's names do not mention ${JSON.stringify(skip)}: ${named.join(" | ")}`,
      ).toBe(true);
    }
    // A test that RAN must not appear: a wiring that stored every testcase
    // would satisfy the loop above and make the ratchet meaningless.
    expect(
      named.some((name) => name.includes("a test that really runs")),
      `a test that ran was recorded as skipped: ${named.join(" | ")}`,
    ).toBe(false);

    // AC-STE-529.8 — the degrade is a FACT in the record, so the source is
    // written whether or not names were obtainable.
    const source = (record as Record<string, unknown>).namesSource;
    expect(
      typeof source === "string" && source.length > 0,
      `the captured record carries no \`namesSource\`: ${JSON.stringify(record)}`,
    ).toBe(true);
  }, 60_000);
});

describe("AC-STE-529.2 wiring — the production READ entry point routes through the SET", () => {
  test("equal counts, different membership: the entry point fails and names the added identity", async () => {
    const mod = await loadEvaluate();
    const repo = makeTrunkRepo("wired-set-fail");

    const ALPHA = "tests/a.test.ts > alpha is parked";
    const BETA = "tests/a.test.ts > beta is parked";
    const GAMMA = "tests/b.test.ts > gamma is parked";

    const captured = mod.captureSkipBaseline(repo.root, repo.trunkSha, 2, {
      names: [ALPHA, BETA],
      namesSource: "bun test --reporter=junit",
    });
    expect(captured.written, "the fixture baseline was not written — the leg would be vacuous").toBe(
      true,
    );

    // EQUAL CARDINALITY, DIFFERENT MEMBERSHIP. One skip removed (BETA), a
    // different one added (GAMMA). The arithmetic is 2 - 2 = 0, so the scalar
    // path returns `pass` with delta 0 — which is exactly what this entry point
    // returns today, because it calls the scalar classifier and discards the
    // names on both sides.
    const verdict = mod.evaluateSkipDelta(repo.root, 2, [ALPHA, GAMMA]);

    expect(
      verdict.outcome,
      `the read entry point graded a swapped skip as ${verdict.outcome} ` +
        `(delta ${String(verdict.delta)}) — it is not routing through the set ` +
        `comparison: ${JSON.stringify(verdict)}`,
    ).toBe("fail");
    expect(
      (verdict as { newSkips?: readonly string[] }).newSkips,
      "the verdict names no newly skipping test",
    ).toEqual([GAMMA]);

    // And the rendered row NAMES the member, since a verdict nobody can read
    // the reason out of is a verdict nobody acts on.
    const line = mod.renderSkipVerdict(verdict);
    expect(line, `the rendered line does not name the added skip: ${line}`).toContain(GAMMA);
  });

  test("both sides named and agreeing is a measured PASS, not an accident of the count", async () => {
    const mod = await loadEvaluate();
    const repo = makeTrunkRepo("wired-set-pass");

    const ALPHA = "tests/a.test.ts > alpha is parked";
    const BETA = "tests/a.test.ts > beta is parked";

    mod.captureSkipBaseline(repo.root, repo.trunkSha, 2, {
      names: [ALPHA, BETA],
      namesSource: "bun test --reporter=junit",
    });

    // Same membership, and one skip legitimately removed: strictly an
    // improvement, and the set is empty.
    const same = mod.evaluateSkipDelta(repo.root, 2, [BETA, ALPHA]);
    expect(same.outcome, JSON.stringify(same)).toBe("pass");
    expect((same as { newSkips?: readonly string[] }).newSkips).toEqual([]);

    const fewer = mod.evaluateSkipDelta(repo.root, 1, [ALPHA]);
    expect(fewer.outcome, JSON.stringify(fewer)).toBe("pass");
    expect((fewer as { newSkips?: readonly string[] }).newSkips).toEqual([]);
  });

  test("a NAMED baseline met by a run that says it cannot name its skips is refused, never passed", async () => {
    const mod = await loadEvaluate();
    const repo = makeTrunkRepo("wired-unnamed-run");

    mod.captureSkipBaseline(repo.root, repo.trunkSha, 2, {
      names: ["tests/a.test.ts > alpha is parked", "tests/a.test.ts > beta is parked"],
      namesSource: "bun test --reporter=junit",
    });

    // EXPLICIT `null` — this run states that it could not name its skips. Equal
    // counts on purpose: this is "cannot compare" collapsing into "measured
    // zero", and a leg built from unequal counts would pass on an entry point
    // that merely subtracted (AC-STE-529.4).
    const verdict = mod.evaluateSkipDelta(repo.root, 2, null);

    expect(
      verdict.outcome,
      `a named baseline met by an unnamed run graded ${verdict.outcome}: ${JSON.stringify(verdict)}`,
    ).toBe("incomparable");
    expect(verdict.outcome).not.toBe("pass");
    expect(verdict.delta, "a refusal rendered a delta — including a delta of zero").toBeNull();
    expect((verdict as { cause?: string }).cause).toBe("unnamed-run");
  });
});

describe("AC-STE-529.3 wiring — the count path is unchanged when the baseline was never named", () => {
  test("an unnamed baseline still grades by arithmetic, in both directions", async () => {
    const mod = await loadEvaluate();
    const repo = makeTrunkRepo("wired-scalar");

    // Captured the way every record on disk today was captured: a count, and
    // nothing else.
    const captured = mod.captureSkipBaseline(repo.root, repo.trunkSha, 3);
    expect(captured.written).toBe(true);
    expect(Object.keys(captured.record)).not.toContain("names");

    const worse = mod.evaluateSkipDelta(repo.root, 5);
    expect(worse.outcome, JSON.stringify(worse)).toBe("fail");
    expect(worse.baseline).toBe(3);
    expect(worse.current).toBe(5);
    expect(worse.delta).toBe(2);
    expect(
      (worse as { newSkips?: readonly string[] }).newSkips,
      "a count-only comparison claimed to name its new skips",
    ).toBeUndefined();

    const unchanged = mod.evaluateSkipDelta(repo.root, 3);
    expect(unchanged.outcome, JSON.stringify(unchanged)).toBe("pass");
    expect(unchanged.delta).toBe(0);

    const better = mod.evaluateSkipDelta(repo.root, 1);
    expect(better.outcome, JSON.stringify(better)).toBe("pass");
    expect(better.delta).toBe(-2);
  });

  test("AC-STE-529.5 — a count-only baseline met by a NAMED run degrades to the scalar, and is not refused", async () => {
    const mod = await loadEvaluate();
    const repo = makeTrunkRepo("wired-scalar-named-run");

    mod.captureSkipBaseline(repo.root, repo.trunkSha, 3);

    // This direction IS a comparison — the baseline number was measured on the
    // same checkout — just a weak one, and it is deliberately NOT treated like
    // the mirrored pair above.
    const verdict = mod.evaluateSkipDelta(repo.root, 5, [
      "tests/a.test.ts > one",
      "tests/a.test.ts > two",
      "tests/a.test.ts > three",
      "tests/a.test.ts > four",
      "tests/a.test.ts > five",
    ]);

    expect(verdict.outcome, JSON.stringify(verdict)).toBe("fail");
    expect(verdict.outcome).not.toBe("incomparable");
    expect(verdict.baseline).toBe(3);
    expect(verdict.delta).toBe(2);
    expect(
      (verdict as { newSkips?: readonly string[] }).newSkips,
      "a comparison with an unnamed baseline claimed a set difference it could not compute",
    ).toBeUndefined();
  });

  test("an absent baseline is still unmeasured, whether or not this run can name its skips", async () => {
    const mod = await loadEvaluate();
    const repo = makeTrunkRepo("wired-unmeasured");

    const bare = mod.evaluateSkipDelta(repo.root, 4);
    expect(bare.outcome, JSON.stringify(bare)).toBe("unmeasured");
    expect(bare.baseline).toBeNull();
    expect(bare.delta).toBeNull();

    const named = mod.evaluateSkipDelta(repo.root, 4, ["tests/a.test.ts > one"]);
    expect(
      named.outcome,
      `naming this run's skips turned an absent baseline into ${named.outcome}`,
    ).toBe("unmeasured");
    expect(named.delta).toBeNull();
  });
});

// ===========================================================================
// SECOND AUDIT RETRY — four defects MEASURED against the shipped modules.
//
// Everything above this line passes. That is the problem the audit reported:
// the legs above prove the PARTS behave, and four of the claims the FR makes
// are false on the shipped surfaces anyway. Each leg below was written from an
// executed probe, never from a reading of the source.
//
//   GAP 1 (AC.2). The set path has NO PRODUCTION CALLER.
//         `deliver_stage_evidence.ts` calls the TWO-argument `evaluateSkipDelta`
//         and `skip_baseline.ts` returns the scalar when `currentNames` is
//         `undefined`. Measured end to end on a real store: a named baseline
//         plus the exact AC.6 swap grades `ok: true`, `baseline 2, delta 0`,
//         zero reasons — while the three-argument form on the SAME store
//         returns `fail` naming the added identity. The wiring legs above pin
//         `evaluateSkipDelta`, which nothing in production reaches with names.
//
//   GAP 2 (AC.3 + AC.5). The count-only label reaches NO READER.
//         `renderSkipVerdict` runs in production only from `remedyClause`, and
//         only for `unmeasured` / `incomparable` — neither ever carries
//         `countOnly`. The row a reader actually meets is `countsLine`, which
//         renders `baseline N, delta D` and no label at all. So the label is
//         dead on every shipped path, and AC.3's "the rendered row labels
//         itself" is true only of a row nobody renders.
//
//   GAP 3 (AC.2). The capped-total pin above is VACUOUS.
//         It asserts `line.toContain("25")` — and `measuredAgainstBaseline`
//         already renders "25 now vs 0 at the branch point (delta +25)".
//         Measured: deleting the ENTIRE `(+N more, M total)` clause leaves
//         every assertion in that leg green. The replacement below isolates the
//         clause from the numbers, names nothing with a digit in it, and is
//         mutation-verified with the mutation asserted to have applied.
//
//   GAP 4 (AC.7). The parse guard FAILS OPEN on a truncated report.
//         The root-closes regex is `/<(testsuites?)\b…<\/\1\s*>/`, whose
//         `testsuites?` alternation backtracks onto an INNER `<testsuite>` when
//         the root never closes. Measured on a report cut mid-write: `named`,
//         with only the suites before the cut — silently dropping every skip
//         after it. As a CURRENT set that hides a real new skip and the ratchet
//         passes. The module's own comment claims it checks the root closes.
// ===========================================================================

/** A real-shaped bun gate run: 14 tests, 12 pass, 2 skip, 0 fail. */
const GATE_TWO_SKIPS = [
  "bun test v1.3.14",
  "",
  " 12 pass",
  "  2 skip",
  "  0 fail",
  "Ran 14 tests across 2 files. [412.00ms]",
].join("\n");

interface EvidenceCountsShape {
  readonly pass: number;
  readonly fail: number;
  readonly skip: number;
  readonly baseline: number | null;
  readonly delta: number | null;
}

interface RenderedEvidenceShape {
  readonly ok: boolean;
  readonly lines: readonly string[];
  readonly counts: Record<string, EvidenceCountsShape | null>;
  readonly reasons: readonly string[];
}

interface EvidenceModule {
  /**
   * The input is typed loosely on purpose: `skipNames` is the field these legs
   * DEFINE, and a hand-copied interface here would type-check against this
   * file's belief about the shape rather than against the shipped one.
   */
  renderStageEvidence(input: Record<string, unknown>): RenderedEvidenceShape;
}

/** The SHIPPED evidence renderer — the surface `/deliver` and `/implement` meet. */
async function loadEvidence(): Promise<EvidenceModule> {
  return (await import(
    "../adapters/_shared/src/deliver_stage_evidence"
  )) as unknown as EvidenceModule;
}

/** The row a reader meets under `gate:` — the pass/fail line, not a verdict. */
function gateRow(lines: readonly string[]): string {
  const at = lines.indexOf("gate:");
  expect(at, `the rendered evidence has no \`gate:\` heading: ${lines.join(" / ")}`).toBeGreaterThan(
    -1,
  );
  const row = lines[at + 1];
  expect(row, "the gate section rendered no row under its heading").toBeDefined();
  return row as string;
}

// ---------------------------------------------------------------------------
// GAP 1 — AC-STE-529.2 through the SHIPPED evidence renderer.
//
// THE CONTRACT THIS LEG DEFINES. `CapturedRun` gains an optional
// `skipNames?: readonly string[] | null`, and `renderStageEvidence` hands the
// gate capture's value to `evaluateSkipDelta` as its third argument. The three
// states are the three the entry point already documents: OMITTED says nothing
// about identities and takes today's two-argument path byte for byte (the
// control leg below pins that, because every existing caller is on it); `null`
// STATES this run could not name its skips; an array names them.
//
// The names are supplied BY THE CALLER, deliberately. `deliver_stage_evidence`
// is pure over the values it is handed — it never touches the filesystem, and a
// junit read folded into it would make the pure module impure for every caller
// it already has, which is the same argument the FR's Technical Design makes
// for keeping `skip_identities` out of `skip_baseline`.
// ---------------------------------------------------------------------------

describe("AC-STE-529.2 wiring — the SET path is reachable from the shipped evidence renderer", () => {
  test("a named baseline met by a named run refuses through renderStageEvidence and names the added identity", async () => {
    const mod = await loadEvaluate();
    const evidence = await loadEvidence();
    const repo = makeTrunkRepo("stage-set-fail");

    const ALPHA = "tests/a.test.ts > alpha is parked";
    const BETA = "tests/a.test.ts > beta is parked";
    const GAMMA = "tests/b.test.ts > gamma is parked";

    const captured = mod.captureSkipBaseline(repo.root, repo.trunkSha, 2, {
      names: [ALPHA, BETA],
      namesSource: "bun test --reporter=junit",
    });
    expect(captured.written, "the fixture baseline was not written — the leg would be vacuous").toBe(
      true,
    );

    // Fixture check, made through the SET-AWARE entry point: this pair really
    // does disagree with the arithmetic, so anything permissive downstream is
    // the renderer's own gate rather than the store's.
    const direct = mod.evaluateSkipDelta(repo.root, 2, [ALPHA, GAMMA]);
    expect(direct.outcome, "fixture check: the three-argument form refuses this pair").toBe("fail");

    const result = evidence.renderStageEvidence({
      gate: {
        command: "bun test",
        output: GATE_TWO_SKIPS,
        stack: "bun",
        // EQUAL COUNT, DIFFERENT MEMBERSHIP — the AC.6 swap, arriving at the
        // renderer as a value the caller supplies.
        skipNames: [ALPHA, GAMMA],
      },
      required: ["gate"],
      projectRoot: repo.root,
    });

    const gate = result.counts.gate;
    expect(gate, "the gate section produced no counts at all").not.toBeNull();
    expect(
      (gate as { skip: number }).skip,
      "fixture check: the capture really reports two skips",
    ).toBe(2);

    const reasons = result.reasons.join("\n");
    expect(
      result.ok,
      `the shipped renderer graded a swapped skip as ok — the set path has no ` +
        `production caller: ${JSON.stringify(result.counts.gate)} / ${JSON.stringify(result.reasons)}`,
    ).toBe(false);
    expect(
      reasons,
      `the refusal does not name the added identity, so the reader cannot act on it: ${reasons}`,
    ).toContain(GAMMA);

    // The refusal must be worded from the SET, not from the delta. The
    // arithmetic here is 2 - 2 = 0, so a delta-worded ground reads "0 newly
    // introduced skip(s)" — a refusal that contradicts itself.
    expect(
      reasons,
      `the refusal claims zero newly introduced skips while refusing: ${reasons}`,
    ).not.toMatch(/\b0 newly introduced/);

    // And only the NEW one. A ground that pasted the whole current set would
    // satisfy the assertion above while telling the reader nothing.
    expect(
      reasons,
      `a pre-existing skip was reported as newly introduced: ${reasons}`,
    ).not.toContain(ALPHA);
  });

  test("CONTROL: omitting the names field leaves the two-argument path exactly as it was", async () => {
    const mod = await loadEvaluate();
    const evidence = await loadEvidence();
    const repo = makeTrunkRepo("stage-set-omitted");

    mod.captureSkipBaseline(repo.root, repo.trunkSha, 2, {
      names: ["tests/a.test.ts > alpha is parked", "tests/a.test.ts > beta is parked"],
      namesSource: "bun test --reporter=junit",
    });

    // No `skipNames` key at all: this caller says nothing about identities, and
    // reading "said nothing" as "could not name them" would turn a named
    // baseline into a refusal for every caller that never opted in.
    const result = evidence.renderStageEvidence({
      gate: { command: "bun test", output: GATE_TWO_SKIPS, stack: "bun" },
      required: ["gate"],
      projectRoot: repo.root,
    });

    expect(
      result.reasons,
      `an opt-out caller was refused: ${JSON.stringify(result.reasons)}`,
    ).toEqual([]);
    expect(result.ok).toBe(true);
    expect((result.counts.gate as { baseline: number | null }).baseline).toBe(2);
    expect((result.counts.gate as { delta: number | null }).delta).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// GAP 2 — AC-STE-529.3 / .5 on the row a reader actually meets.
//
// The label belongs on `countsLine`, the gate's own pass/fail row, because that
// is the only skip-comparison line a passing stage ever renders. `remedyClause`
// only fires on a REFUSAL, and a degraded comparison that passes is precisely
// the case the label exists for: "a comparison that silently got weaker is
// indistinguishable from one that did not, and the reader has no other way to
// tell."
// ---------------------------------------------------------------------------

describe("AC-STE-529.3 wiring — the degraded comparison says so on the ROW, not only in a verdict object", () => {
  test("the gate row labels itself count-only when neither side named its skips", async () => {
    const mod = await loadEvaluate();
    const evidence = await loadEvidence();
    const repo = makeTrunkRepo("stage-count-only");

    // Captured the way every record on disk today was captured: a count alone.
    const captured = mod.captureSkipBaseline(repo.root, repo.trunkSha, 2);
    expect(captured.written, "the fixture baseline was not written").toBe(true);
    expect(Object.keys(captured.record)).not.toContain("names");

    const result = evidence.renderStageEvidence({
      gate: {
        command: "bun test",
        output: GATE_TWO_SKIPS,
        stack: "bun",
        // This run STATES it could not name its skips. Neither side is named,
        // so the arithmetic stands — and it must confess that it is arithmetic.
        skipNames: null,
      },
      required: ["gate"],
      projectRoot: repo.root,
    });

    // A degrade is not a refusal: the count is the only signal a runner that
    // cannot name its skips has, and refusing there would make the ratchet
    // unusable on those stacks rather than merely weaker (the FR's Notes).
    expect(
      result.reasons,
      `a count-only comparison was refused: ${JSON.stringify(result.reasons)}`,
    ).toEqual([]);
    expect(result.ok).toBe(true);

    const row = gateRow(result.lines);
    // Today's numbers survive unchanged — the label is an ADDITION to the row,
    // never a replacement for what it already carried.
    expect(row, `the row lost its numbers: ${row}`).toContain("baseline 2");
    expect(row, `the row lost its delta: ${row}`).toContain("delta 0");
    expect(
      row,
      `the row a reader meets does not say the comparison was count-only — the ` +
        `label reaches no reader on any shipped path: ${row}`,
    ).toMatch(COUNT_ONLY_LABEL);
  });

  test("ISOLATION: a fully named comparison's row carries NO such label", async () => {
    const mod = await loadEvaluate();
    const evidence = await loadEvidence();
    const repo = makeTrunkRepo("stage-named-row");

    const ALPHA = "tests/a.test.ts > alpha is parked";
    const BETA = "tests/a.test.ts > beta is parked";
    mod.captureSkipBaseline(repo.root, repo.trunkSha, 2, {
      names: [ALPHA, BETA],
      namesSource: "bun test --reporter=junit",
    });

    const result = evidence.renderStageEvidence({
      gate: {
        command: "bun test",
        output: GATE_TWO_SKIPS,
        stack: "bun",
        skipNames: [BETA, ALPHA],
      },
      required: ["gate"],
      projectRoot: repo.root,
    });

    expect(
      result.reasons,
      `a matching named pair was refused: ${JSON.stringify(result.reasons)}`,
    ).toEqual([]);

    const row = gateRow(result.lines);
    // A label that appears on every row is not a label.
    expect(
      row,
      `a SET comparison's row calls itself count-only: ${row}`,
    ).not.toMatch(COUNT_ONLY_LABEL);
  });
});

// ---------------------------------------------------------------------------
// GAP 3 — the capped clause, pinned as a property rather than by a substring
// the numbers clause already supplies.
//
// The vacuity being replaced: `renderSkipVerdict` opens a failure on
// `measuredAgainstBaseline`, which for twenty-five new skips against an empty
// baseline renders "25 now vs 0 at the branch point (delta +25)". Every "25" the
// old leg asserted was already there before the capped clause was written, and
// deleting that clause outright left the leg green — measured, not inferred.
//
// The fix is to ISOLATE the clause from the numbers by asking the SHIPPED
// renderer for the same verdict twice, once with an empty `newSkips`. The
// difference between the two strings IS the names clause, whatever the
// implementer worded it as, and every assertion below is made on that
// difference alone. The identities are deliberately digit-free, so no number
// the clause states can have come from a name either.
// ---------------------------------------------------------------------------

const LETTERS = "abcdefghijklmnopqrstuvwxyz";

/** `count` distinct identities containing NO digit, so numbers cannot hide. */
function digitFreeNames(count: number, tag: string): string[] {
  return Array.from({ length: count }, (_, i) => {
    const suffix = `${LETTERS[i % 26] as string}${LETTERS[Math.floor(i / 26)] as string}`;
    return `tests/gen.test.ts > ${tag} case ${suffix}`;
  });
}

/**
 * The names clause of a failure line, isolated: the bytes the shipped renderer
 * adds when the same verdict carries its `newSkips` rather than none.
 */
function namesClause(mod: SkipBaselineModule, verdict: SkipVerdictShape): string {
  const bare = mod.renderSkipVerdict({ ...verdict, newSkips: [] });
  const full = mod.renderSkipVerdict(verdict);
  expect(
    full.startsWith(bare),
    `the names clause is not APPENDED to the numbers line, so it cannot be ` +
      `isolated from them:\n  bare: ${bare}\n  full: ${full}`,
  ).toBe(true);
  return full.slice(bare.length);
}

/** The one capped-total segment in the module — AC.9's third mutation site. */
function cappedTotalSegment(source: string): string {
  const segments = [
    ...new Set([...source.matchAll(/\([^()`\n]*\btotal\b[^()`\n]*\)/g)].map((hit) => hit[0])),
  ];
  expect(
    segments,
    "the capped clause's total must be stated in exactly ONE parenthesised segment " +
      "of skip_baseline.ts, or the mutation below has no determined site",
  ).toHaveLength(1);
  return segments[0] as string;
}

describe("AC-STE-529.2 — the capped clause states the magnitude, and the numbers clause cannot supply it", () => {
  test("the total and the hidden count are stated in the CLAUSE, not borrowed from the delta", async () => {
    const mod = await loadSkipBaseline();

    const kept = digitFreeNames(3, "kept");
    const many = digitFreeNames(25, "new");
    // No name holds a digit, so every number the clause states was written by
    // the clause. A leg built on `zz-new-025` would read its own padding.
    expect(
      [...kept, ...many].every((name) => !/\d/.test(name)),
      "an identity carries a digit — a numeric assertion could read the NAME",
    ).toBe(true);

    const verdict = mod.classifySkipSetDelta(named(kept), named([...kept, ...many]));
    expect(verdict.outcome, "fixture check: twenty-five added identities is a failure").toBe("fail");

    const clause = namesClause(mod, verdict);
    const shown = many.filter((name) => clause.includes(name));

    expect(
      shown.length,
      `25 new skips were all named; a report that scrolls is a report nobody reads: ${clause}`,
    ).toBeLessThan(many.length);
    expect(shown.length, "a capped clause must still name somebody").toBeGreaterThan(0);

    // THE PROPERTY THE OLD LEG DID NOT HAVE. The total is asserted on the
    // CLAUSE, so `measuredAgainstBaseline`'s numbers cannot satisfy it, and
    // deleting the capped clause outright takes this assertion red.
    expect(
      clause,
      `the cap hid the magnitude — the clause never states the total ${many.length}: ${clause}`,
    ).toContain(String(many.length));
    expect(
      clause,
      `the clause never says how many identities it withheld ` +
        `(${many.length - shown.length}): ${clause}`,
    ).toContain(String(many.length - shown.length));

    // A SMALL set is not capped, and states no total it does not need: the cap
    // is a ceiling, not a default.
    const few = digitFreeNames(2, "small");
    const smallClause = namesClause(
      mod,
      mod.classifySkipSetDelta(named(kept), named([...kept, ...few])),
    );
    expect(few.every((name) => smallClause.includes(name))).toBe(true);
  });

  test("MUTATION 3: deleting the `(+N more, M total)` clause turns the capped pin RED", async () => {
    const original = read(SKIP_BASELINE_FILE);

    // The clause changed, named: the parenthesised segment of `newSkipsClause`
    // that states the withheld count and the total. Discovered rather than
    // retyped, and required to be the module's only one so the site is
    // determined; `mutateInRegion` aborts when it is not.
    const segment = cappedTotalSegment(original);
    const mutated = mutateInRegion(original, 0, original.length, segment, "", {
      label: "the capped-total segment of newSkipsClause in skip_baseline.ts",
    });

    // APPLIED — measured, not assumed.
    expect(mutated, "the capped-total mutation changed nothing").not.toBe(original);
    expect(mutated, "the capped-total segment survived the mutation").not.toContain(segment);

    const mutant = await loadMutant("no-capped-total", mutated);

    const kept = digitFreeNames(3, "kept");
    const many = digitFreeNames(25, "new");
    const clause = namesClause(
      mutant,
      mutant.classifySkipSetDelta(named(kept), named([...kept, ...many])),
    );

    // The leg above, run against the mutant. If this stays green the capped
    // pin cannot fail, which is exactly the vacuity this pair replaces.
    expect(
      clause,
      `deleting the capped clause left the total-stating pin GREEN — measured on ` +
        `the shipped module, the old leg's \`toContain("25")\` was satisfied by ` +
        `"25 now vs 0 at the branch point": ${clause}`,
    ).not.toContain(String(many.length));
  });
});

// ---------------------------------------------------------------------------
// GAP 4 — AC-STE-529.7 on a report truncated MID-WRITE.
//
// The report is a REAL one, from a real run of the real command, cut at a real
// byte boundary — not a hand-authored xml document. What a truncated write
// leaves behind is exactly this: an opening root, some number of complete inner
// suites, and nothing else. The suites after the cut are gone, and so are their
// skips; read as a CURRENT set that is a run whose new skips silently vanished
// and whose ratchet passes.
// ---------------------------------------------------------------------------

describe("AC-STE-529.7 — a report truncated mid-write is unavailable, never a partial named set", () => {
  test("a root that never closes is not a report, even with complete suites inside it", async () => {
    const identities = await loadIdentities();

    // Two files, skips in BOTH, so a cut between them loses real identities.
    const root = makeSuite("truncated", [
      { path: "tests/a.test.ts", kept: ["kept alpha"], skipped: ["skipped alpha"] },
      { path: "tests/b.test.ts", kept: ["kept beta"], skipped: ["skipped beta"] },
    ]);
    const reportPath = join(tempDir("report-truncated"), "junit.xml");
    runIdentityCommand(identities, root, reportPath);
    expect(existsSync(reportPath), `no report was written at ${reportPath}`).toBe(true);

    // NON-VACUITY, both halves. The intact report is read, and it names both
    // skips — so a rejection below is about the truncation and not about a
    // guard that rejects everything.
    const intact = read(reportPath);
    const whole = identities.extractSkipIdentities(reportPath);
    expect(whole.status, `the intact report was not read: ${intact.slice(0, 400)}`).toBe("named");
    expect((whole as { names: readonly string[] }).names).toHaveLength(2);

    // The cut: immediately after the FIRST complete inner suite, which is what
    // a writer interrupted between suites leaves on disk.
    const closer = "</testsuite>";
    const at = intact.indexOf(closer);
    expect(at, `the report holds no complete inner suite to cut after: ${intact.slice(0, 400)}`)
      .toBeGreaterThan(-1);
    const truncated = intact.slice(0, at + closer.length);

    // Fixture checks on the WRECKAGE itself, so the leg cannot pass on a cut
    // that lost nothing or on one that left the root closed.
    expect(
      truncated,
      "the truncated report still closes its root — nothing was cut",
    ).not.toContain("</testsuites>");
    expect(truncated, "the cut left no complete suite at all").toContain(closer);
    expect(
      intact.slice(at + closer.length),
      "the cut discarded no skip, so a partial read would lose nothing",
    ).toContain("<skipped");

    const cutPath = join(tempDir("report-cut"), "junit.xml");
    writeFileSync(cutPath, truncated);

    const extracted = identities.extractSkipIdentities(cutPath);
    expect(
      extracted.status,
      `a report cut mid-write was read as a report: the guard's own comment says ` +
        `it checks that the ROOT closes, and \`testsuites?\` backtracks onto an ` +
        `inner <testsuite> instead — ${JSON.stringify(extracted)}`,
    ).toBe("unavailable");

    // Said the other way round, because this is the fail-open shape and not a
    // status quibble: a PARTIAL set is the answer that must never be returned.
    expect(
      (extracted as { names?: readonly string[] }).names,
      "a truncated report yielded a partial named set — every skip after the cut " +
        "is silently absent, and as a CURRENT set that hides a new skip",
    ).toBeUndefined();
  }, 60_000);
});
