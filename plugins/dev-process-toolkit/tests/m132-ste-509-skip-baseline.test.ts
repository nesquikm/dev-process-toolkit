// M132 STE-509 — newly introduced skips are red; pre-existing skips are not.
//
// WHAT THIS FILE PINS, and why each leg is shaped the way it is.
//
//   AC.1  The baseline path is COMPOSED THROUGH `dpt_paths.ts`, not merely
//         `.dpt`-shaped. Two legs: the writer's real on-disk location is
//         asserted EQUAL to `skipBaselinePath()` from the shared path module,
//         and `skip_baseline.ts` is asserted to carry no `.dpt` literal of its
//         own while importing the path module. Either leg alone is passable by
//         a private literal that happens to agree today (M104 / STE-382 AC.1).
//
//   AC.2  Positive, zero AND negative deltas, each asserted to its verdict.
//         Plus one end-to-end leg through the SHIPPED `parseTestOutput` whose
//         fixture has `total` (14) far from `skipped` (2), so an implementation
//         fed `total` instead of `skipped` returns the WRONG verdict and dies
//         here. The design constraint names that trap explicitly.
//
//   AC.3  `unmeasured` is a THIRD value, not a boolean, and the half that
//         matters — "never rendered as a clean pass" — is asserted DIRECTLY
//         via `isCleanPass` and via the rendered surface, not inferred from the
//         outcome token. Both tempting wrong readings of an absent baseline are
//         killed by name: read-as-zero (loud but wrong) and read-as-equal-to-
//         current (quiet and worse).
//
//   AC.4  Asserted by capturing TWICE inside one run with DIFFERENT counts and
//         comparing the file's raw bytes. A baseline that refreshes mid-run
//         always reports a zero delta — a guard that cannot fail (M127's six
//         vacuities). The `capturedAt` field in the record is what makes the
//         byte comparison a real discriminator: a rewrite moves it.
//
//   AC.5  Two REAL EXECUTED mutations, each asserted RED. A mutated copy of
//         `skip_baseline.ts` is written beside a copy of `dpt_paths.ts` in a
//         throwaway directory and dynamically imported, so the mutant is
//         genuinely executed rather than grepped. A control leg proves the same
//         harness passes on the shipped module, which is what separates "the
//         mutation killed it" from "the harness always throws".
//
// CONTRACT NOTES FOR THE IMPLEMENTER (the mutations depend on these shapes):
//   * `readSkipBaseline` and `classifySkipDelta` are declared as
//     `export function <name>(` — the mutation anchors. An arrow-const form has
//     no anchor and this file will go red, loudly, rather than silently
//     scoring a mutation that never applied.
//   * `evaluateSkipDelta` calls `readSkipBaseline(` and `classifySkipDelta(`
//     by bare name, so an override of either is genuinely wired through. That
//     is asserted at source level below, not assumed.

import { describe, expect, test } from "bun:test";
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
import { basename, join, relative } from "node:path";

import { dptRoot, ledgerPath, locksDir } from "../adapters/_shared/src/dpt_paths";
import { DPT_GITIGNORE_BODY } from "../adapters/_shared/src/setup/dpt_gitignore";
import { parseTestOutput } from "../adapters/_shared/src/test_count_parser";
import { mutateInRegion } from "./_sited-mutation";

// ===========================================================================
// Paths + the module contract under test.
// ===========================================================================

const PLUGIN_ROOT = join(import.meta.dir, "..");
const SHARED_SRC = join(PLUGIN_ROOT, "adapters", "_shared", "src");

const SKIP_BASELINE_FILE = join(SHARED_SRC, "skip_baseline.ts");
const DPT_PATHS_FILE = join(SHARED_SRC, "dpt_paths.ts");

const SKIP_BASELINE_MODULE = "../adapters/_shared/src/skip_baseline";
const DPT_PATHS_MODULE = "../adapters/_shared/src/dpt_paths";

const read = (p: string): string => readFileSync(p, "utf-8");

/** The three-valued outcome. Deliberately NOT a boolean — see AC.3. */
type SkipOutcome = "pass" | "fail" | "unmeasured";

interface SkipVerdict {
  readonly outcome: SkipOutcome;
  readonly baseline: number | null;
  readonly current: number;
  readonly delta: number | null;
}

interface SkipBaselineRecord {
  readonly branch: string;
  readonly skipped: number;
  readonly capturedAt: string;
}

interface CaptureResult {
  readonly written: boolean;
  readonly record: SkipBaselineRecord;
}

interface SkipBaselineModule {
  readonly SKIP_OUTCOMES: readonly SkipOutcome[];
  captureSkipBaseline(
    projectRoot: string,
    branch: string,
    skipped: number,
  ): CaptureResult;
  readSkipBaseline(projectRoot: string, branch: string): SkipBaselineRecord | null;
  classifySkipDelta(baseline: number | null, current: number): SkipVerdict;
  evaluateSkipDelta(projectRoot: string, branch: string, current: number): SkipVerdict;
  isCleanPass(verdict: SkipVerdict): boolean;
  renderSkipVerdict(verdict: SkipVerdict): string;
}

interface DptPathsModule {
  skipBaselinePath(projectRoot: string): string;
  dptRoot(projectRoot: string): string;
}

async function loadSkipBaseline(): Promise<SkipBaselineModule> {
  return (await import(SKIP_BASELINE_MODULE)) as unknown as SkipBaselineModule;
}

async function loadDptPaths(): Promise<DptPathsModule> {
  return (await import(DPT_PATHS_MODULE)) as unknown as DptPathsModule;
}

// ===========================================================================
// Throwaway project roots. Nothing here touches the toolkit repo.
// ===========================================================================

const TEMP_ROOTS: string[] = [];

function tempProjectRoot(label: string): string {
  const root = mkdtempSync(join(tmpdir(), `ste509-${label}-`));
  TEMP_ROOTS.push(root);
  return root;
}

function cleanupTempRoots(): void {
  for (const root of TEMP_ROOTS.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
}

// ===========================================================================
// AC-STE-509.1 — captured at the branch point, stored under `.dpt/` THROUGH
// the shared path module.
// ===========================================================================

describe("AC-STE-509.1 — the baseline path is composed through dpt_paths.ts", () => {
  test("dpt_paths.ts is the module that declares skipBaselinePath", () => {
    // The path function is ADDED TO the shared path module, so the source of
    // that module — not skip_baseline's re-export of it — must declare it.
    const source = read(DPT_PATHS_FILE);
    expect(source).toContain("export function skipBaselinePath");
  });

  test("skipBaselinePath resolves under dptRoot and is a .dpt path", async () => {
    const paths = await loadDptPaths();
    const root = tempProjectRoot("path");

    const p = paths.skipBaselinePath(root);
    expect(p.startsWith(`${dptRoot(root)}/`)).toBe(true);
    // Relative to the project root, the path begins at `.dpt/`.
    expect(relative(root, p).split("/")[0]).toBe(".dpt");
  });

  test("captureSkipBaseline writes at exactly skipBaselinePath(projectRoot)", async () => {
    const mod = await loadSkipBaseline();
    const paths = await loadDptPaths();
    const root = tempProjectRoot("write");

    const result = mod.captureSkipBaseline(root, "feat/m132-evidence-ledger", 3);

    expect(result.written).toBe(true);
    expect(result.record.branch).toBe("feat/m132-evidence-ledger");
    expect(result.record.skipped).toBe(3);
    expect(result.record.capturedAt.length).toBeGreaterThan(0);

    // The composed path is where the bytes actually landed — not merely some
    // `.dpt`-shaped path somewhere under the root.
    const expected = paths.skipBaselinePath(root);
    expect(existsSync(expected)).toBe(true);
    expect(read(expected).length).toBeGreaterThan(0);
  });

  test("skip_baseline.ts composes no `.dpt` literal of its own and imports dpt_paths", () => {
    const source = read(SKIP_BASELINE_FILE);

    // M104 / STE-382 AC-STE-382.1: `dpt_paths.ts` is the SOLE composer.
    // Comments are allowed to name the layout; code is not. Strip line and
    // block comments before scanning so the rationale can still be written.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");
    expect(code).not.toContain(".dpt");

    expect(source).toContain("dpt_paths");
    expect(source).toContain("skipBaselinePath");
  });

  test("a captured baseline reads back for its own branch and not for another", async () => {
    const mod = await loadSkipBaseline();
    const root = tempProjectRoot("branchkey");

    mod.captureSkipBaseline(root, "feat/branch-a", 7);

    const same = mod.readSkipBaseline(root, "feat/branch-a");
    expect(same).not.toBeNull();
    expect(same?.skipped).toBe(7);

    // The record is keyed to the branch it was captured on. A different branch
    // has no baseline yet — which is AC.3's territory, not a silent reuse of
    // some other branch's number.
    expect(mod.readSkipBaseline(root, "feat/branch-b")).toBeNull();
  });
});

// ===========================================================================
// AC-STE-509.2 — delta is current minus baseline; positive fails, zero or
// negative passes.
// ===========================================================================

describe("AC-STE-509.2 — the delta verdict across positive, zero and negative", () => {
  test("a positive delta (skips went up) FAILS", async () => {
    const mod = await loadSkipBaseline();
    const root = tempProjectRoot("delta-pos");

    mod.captureSkipBaseline(root, "feat/x", 2);
    const verdict = mod.evaluateSkipDelta(root, "feat/x", 5);

    expect(verdict.outcome).toBe("fail");
    expect(verdict.baseline).toBe(2);
    expect(verdict.current).toBe(5);
    expect(verdict.delta).toBe(3);
    expect(mod.isCleanPass(verdict)).toBe(false);
  });

  test("a zero delta (skips unchanged) PASSES", async () => {
    const mod = await loadSkipBaseline();
    const root = tempProjectRoot("delta-zero");

    mod.captureSkipBaseline(root, "feat/x", 4);
    const verdict = mod.evaluateSkipDelta(root, "feat/x", 4);

    expect(verdict.outcome).toBe("pass");
    expect(verdict.delta).toBe(0);
    expect(mod.isCleanPass(verdict)).toBe(true);
  });

  test("a negative delta (skips went down) PASSES", async () => {
    const mod = await loadSkipBaseline();
    const root = tempProjectRoot("delta-neg");

    mod.captureSkipBaseline(root, "feat/x", 6);
    const verdict = mod.evaluateSkipDelta(root, "feat/x", 1);

    expect(verdict.outcome).toBe("pass");
    expect(verdict.delta).toBe(-5);
    expect(mod.isCleanPass(verdict)).toBe(true);
  });

  test("classifySkipDelta is pure arithmetic — current minus baseline", async () => {
    const mod = await loadSkipBaseline();

    expect(mod.classifySkipDelta(0, 1).delta).toBe(1);
    expect(mod.classifySkipDelta(0, 1).outcome).toBe("fail");
    expect(mod.classifySkipDelta(9, 9).delta).toBe(0);
    expect(mod.classifySkipDelta(9, 9).outcome).toBe("pass");
    expect(mod.classifySkipDelta(9, 8).delta).toBe(-1);
    expect(mod.classifySkipDelta(9, 8).outcome).toBe("pass");
  });

  test("the count fed in is parseTestOutput's `skipped`, never `total`", async () => {
    const mod = await loadSkipBaseline();
    const root = tempProjectRoot("skipped-not-total");

    // A real-shaped bun run: 14 tests ran, 2 of them skipped. `total` and
    // `skipped` are far apart on purpose — an implementation ratcheting on
    // `total` reads 14 against a baseline of 2 and reports FAIL.
    const output = [
      "tests/a.test.ts:",
      "  8 pass",
      "  1 skip",
      "tests/b.test.ts:",
      "  4 pass",
      "  1 skip",
      " 12 pass",
      "  2 skip",
      "  0 fail",
      "Ran 14 tests across 3 files. [412.00ms]",
    ].join("\n");

    const parsed = parseTestOutput(output, "bun");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(parsed.reason);
    expect(parsed.count.skipped).toBe(2);
    expect(parsed.count.total).toBe(14);

    mod.captureSkipBaseline(root, "feat/x", 2);
    const verdict = mod.evaluateSkipDelta(root, "feat/x", parsed.count.skipped);

    expect(verdict.outcome).toBe("pass");
    expect(verdict.current).toBe(2);
    expect(verdict.delta).toBe(0);
  });
});

// ===========================================================================
// AC-STE-509.3 — an absent baseline is `unmeasured`, surfaced, and NEVER
// rendered as a clean pass.
// ===========================================================================

describe("AC-STE-509.3 — an absent baseline yields a distinct surfaced `unmeasured`", () => {
  test("`unmeasured` is a third value, not a boolean", async () => {
    const mod = await loadSkipBaseline();

    expect([...mod.SKIP_OUTCOMES].sort()).toEqual(["fail", "pass", "unmeasured"]);
    expect(new Set(mod.SKIP_OUTCOMES).size).toBe(3);
  });

  test("an absent baseline classifies as `unmeasured` with a null delta", async () => {
    const mod = await loadSkipBaseline();
    const root = tempProjectRoot("absent");

    expect(mod.readSkipBaseline(root, "feat/x")).toBeNull();

    const verdict = mod.evaluateSkipDelta(root, "feat/x", 5);
    expect(verdict.outcome).toBe("unmeasured");
    expect(verdict.baseline).toBeNull();
    expect(verdict.delta).toBeNull();
    expect(verdict.current).toBe(5);
  });

  test("`unmeasured` is NEVER rendered as a clean pass — asserted directly", async () => {
    const mod = await loadSkipBaseline();
    const root = tempProjectRoot("not-a-pass");

    const unmeasured = mod.evaluateSkipDelta(root, "feat/x", 5);

    // The half that matters, asserted on its own rather than inferred from the
    // outcome token.
    expect(mod.isCleanPass(unmeasured)).toBe(false);

    const rendered = mod.renderSkipVerdict(unmeasured);
    expect(rendered.toLowerCase()).toContain("unmeasured");
    expect(rendered.toLowerCase()).not.toContain("pass");

    // And it is not merely the pass rendering with a different label.
    mod.captureSkipBaseline(root, "feat/x", 5);
    const clean = mod.evaluateSkipDelta(root, "feat/x", 5);
    expect(mod.isCleanPass(clean)).toBe(true);
    expect(rendered).not.toBe(mod.renderSkipVerdict(clean));
  });

  test("the read-as-ZERO wrong implementation is excluded", async () => {
    const mod = await loadSkipBaseline();
    const root = tempProjectRoot("not-zero");

    // Loud but wrong: an absent baseline read as 0 makes every pre-existing
    // skip look newly introduced, so it reports FAIL with a delta of 5.
    const verdict = mod.evaluateSkipDelta(root, "feat/x", 5);
    expect(verdict.outcome).not.toBe("fail");
    expect(verdict.baseline).not.toBe(0);
    expect(verdict.delta).not.toBe(5);
  });

  test("the read-as-EQUAL-TO-CURRENT wrong implementation is excluded", async () => {
    const mod = await loadSkipBaseline();
    const root = tempProjectRoot("not-equal");

    // Quiet and much worse: an absent baseline read as equal to current makes
    // every new skip invisible, so it reports a clean PASS with delta 0.
    const verdict = mod.evaluateSkipDelta(root, "feat/x", 5);
    expect(verdict.outcome).not.toBe("pass");
    expect(mod.isCleanPass(verdict)).toBe(false);
    expect(verdict.delta).not.toBe(0);
  });
});

// ===========================================================================
// AC-STE-509.4 — written at branch creation, never refreshed mid-run.
// ===========================================================================

describe("AC-STE-509.4 — the baseline does not move mid-run", () => {
  test("a second capture in the same run leaves the stored bytes identical", async () => {
    const mod = await loadSkipBaseline();
    const paths = await loadDptPaths();
    const root = tempProjectRoot("no-refresh");
    const file = paths.skipBaselinePath(root);

    const first = mod.captureSkipBaseline(root, "feat/x", 2);
    expect(first.written).toBe(true);
    const bytesAfterFirst = read(file);

    // Mid-run reads must not move it either.
    expect(mod.evaluateSkipDelta(root, "feat/x", 9).outcome).toBe("fail");

    // A second capture with a DIFFERENT count — the mid-run refresh that would
    // make the guard permanently report a zero delta.
    const second = mod.captureSkipBaseline(root, "feat/x", 9);
    expect(second.written).toBe(false);
    expect(second.record.skipped).toBe(2);

    // Raw bytes, so a rewrite that happens to re-derive the same number is
    // still caught by the moved `capturedAt`.
    expect(read(file)).toBe(bytesAfterFirst);
    expect(mod.readSkipBaseline(root, "feat/x")?.skipped).toBe(2);
  });

  test("the delta after a repeated capture is still the real one, not zero", async () => {
    const mod = await loadSkipBaseline();
    const root = tempProjectRoot("still-fails");

    mod.captureSkipBaseline(root, "feat/x", 2);
    mod.captureSkipBaseline(root, "feat/x", 9);

    // A refreshing baseline reports delta 0 here — a guard that cannot fail.
    const verdict = mod.evaluateSkipDelta(root, "feat/x", 9);
    expect(verdict.outcome).toBe("fail");
    expect(verdict.baseline).toBe(2);
    expect(verdict.delta).toBe(7);
  });

  test("branch creation is the write moment — a new branch seeds a new baseline", async () => {
    const mod = await loadSkipBaseline();
    const root = tempProjectRoot("new-branch");

    mod.captureSkipBaseline(root, "feat/old", 2);

    const seeded = mod.captureSkipBaseline(root, "feat/new", 6);
    expect(seeded.written).toBe(true);
    expect(seeded.record.branch).toBe("feat/new");
    expect(seeded.record.skipped).toBe(6);
    expect(mod.evaluateSkipDelta(root, "feat/new", 6).outcome).toBe("pass");
  });
});

// ===========================================================================
// AC-STE-509.5 — mutation-verified. Two named mutations, each EXECUTED.
// ===========================================================================

/**
 * Write a mutated copy of `skip_baseline.ts` beside a copy of `dpt_paths.ts`
 * and import it. The copy — not a paraphrase — is what runs, so a mutation is
 * genuinely executed rather than grepped.
 *
 * The declaration is RENAMED and a replacement appended: internal call sites
 * still spell the bare name, so they bind to the replacement. `mutateInRegion`
 * throws when the anchor is absent or ambiguous, which is why a mutation that
 * never applied cannot score as a pass (M121 § 0k(m)).
 */
async function loadMutant(
  label: string,
  anchor: string,
  replacementSource: string,
): Promise<SkipBaselineModule> {
  const dir = mkdtempSync(join(tmpdir(), `ste509-mutant-${label}-`));
  TEMP_ROOTS.push(dir);

  copyFileSync(DPT_PATHS_FILE, join(dir, "dpt_paths.ts"));

  const original = read(SKIP_BASELINE_FILE);
  const renamed = mutateInRegion(
    original,
    0,
    original.length,
    anchor,
    anchor.replace("export function ", "export function __orig_"),
    { label: `the ${label} mutation site in skip_baseline.ts` },
  );
  const mutated = `${renamed}\n\n${replacementSource}\n`;

  // The mutation LANDED — measured, not assumed.
  expect(mutated).not.toBe(original);
  expect(mutated).toContain("__orig_");

  const file = join(dir, "skip_baseline.ts");
  writeFileSync(file, mutated);

  return (await import(file)) as unknown as SkipBaselineModule;
}

/**
 * The guard, as one callable. Runs the four load-bearing scenarios against a
 * module and throws on the first divergence. The shipped module must survive
 * it; each mutant must not.
 */
function runSkipGuard(mod: SkipBaselineModule, label: string): void {
  const root = mkdtempSync(join(tmpdir(), `ste509-guard-${label}-`));
  TEMP_ROOTS.push(root);
  mkdirSync(root, { recursive: true });

  const fail = (what: string, got: unknown, want: unknown): never => {
    throw new Error(`skip guard [${label}]: ${what} — got ${String(got)}, want ${String(want)}`);
  };

  // 1. Absent baseline is `unmeasured`, and is not a clean pass.
  const absent = mod.evaluateSkipDelta(root, "feat/x", 4);
  if (absent.outcome !== "unmeasured") fail("absent baseline outcome", absent.outcome, "unmeasured");
  if (mod.isCleanPass(absent)) fail("absent baseline isCleanPass", true, false);

  mod.captureSkipBaseline(root, "feat/x", 3);

  // 2. Pre-existing skips are not this change's doing → pass.
  const unchanged = mod.evaluateSkipDelta(root, "feat/x", 3);
  if (unchanged.outcome !== "pass") fail("zero-delta outcome", unchanged.outcome, "pass");

  // 3. Newly introduced skips → fail.
  const worse = mod.evaluateSkipDelta(root, "feat/x", 6);
  if (worse.outcome !== "fail") fail("positive-delta outcome", worse.outcome, "fail");

  // 4. Skips removed → pass.
  const better = mod.evaluateSkipDelta(root, "feat/x", 1);
  if (better.outcome !== "pass") fail("negative-delta outcome", better.outcome, "pass");
}

describe("AC-STE-509.5 — the guards are mutation-verified", () => {
  test("CONTROL: the shipped module survives the guard", async () => {
    const mod = await loadSkipBaseline();
    expect(() => runSkipGuard(mod, "control")).not.toThrow();
  });

  test("MUTATION 1: a baseline reader stubbed to zero goes RED", async () => {
    const mutant = await loadMutant(
      "reader-zero",
      "export function readSkipBaseline",
      [
        "export function readSkipBaseline(projectRoot: string, branch: string) {",
        "  void projectRoot;",
        '  return { branch, skipped: 0, capturedAt: "1970-01-01T00:00:00.000Z" };',
        "}",
      ].join("\n"),
    );

    // The whole guard dies on this mutant.
    expect(() => runSkipGuard(mutant, "reader-zero")).toThrow();

    // And it dies for the RIGHT reason: an absent baseline read as zero never
    // reaches `unmeasured` at all.
    const root = tempProjectRoot("mut-reader-zero");
    const verdict = mutant.evaluateSkipDelta(root, "feat/x", 4);
    expect(verdict.outcome).not.toBe("unmeasured");
  });

  test("MUTATION 2: an inverted delta comparison goes RED", async () => {
    const mutant = await loadMutant(
      "inverted-delta",
      "export function classifySkipDelta",
      [
        "export function classifySkipDelta(baseline: number | null, current: number) {",
        "  if (baseline === null) {",
        '    return { outcome: "unmeasured", baseline: null, current, delta: null };',
        "  }",
        "  const delta = current - baseline;",
        // The inversion: skips going UP now passes, skips going DOWN now fails.
        '  return { outcome: delta < 0 ? "fail" : "pass", baseline, current, delta };',
        "}",
      ].join("\n"),
    );

    expect(() => runSkipGuard(mutant, "inverted-delta")).toThrow();

    // Named divergence: newly introduced skips are waved through.
    expect(mutant.classifySkipDelta(2, 5).outcome).toBe("pass");
    expect(mutant.classifySkipDelta(5, 2).outcome).toBe("fail");
  });

  test("the mutation wiring is real — evaluateSkipDelta calls both by bare name", () => {
    const source = read(SKIP_BASELINE_FILE);
    const at = source.indexOf("export function evaluateSkipDelta");
    expect(at).toBeGreaterThan(-1);

    // The body between `evaluateSkipDelta` and the next top-level export.
    const rest = source.slice(at);
    const end = rest.indexOf("\nexport ", 1);
    const body = end === -1 ? rest : rest.slice(0, end);

    expect(body).toContain("readSkipBaseline(");
    expect(body).toContain("classifySkipDelta(");
  });
});

// ===========================================================================
// M132 HARDENING (scoped round, post-GREEN) — the baseline artifact must be
// covered by the SHIPPED `.dpt/.gitignore` policy.
//
// WHY THIS IS A DEFECT AND NOT A PREFERENCE. The baseline records the skip
// count of THIS working tree at ITS branch point. Committed, a stale baseline
// authored on another machine or another branch rides in and silently changes
// the ratchet's verdict — the guard becomes a source of false verdicts. It is
// a local measurement, so it belongs with `ledger/`. `.dpt/locks/` is the
// deliberate counter-example: a lock is committed precisely because its whole
// purpose is cross-tree visibility (see `dpt_gitignore.ts`'s polarity note).
//
// HOW THESE LEGS ARE PINNED. Every leg derives the filename from
// `skipBaselinePath()` and evaluates it with `git check-ignore` — the real
// matcher — against the shipped `DPT_GITIGNORE_BODY`. Neither the filename nor
// the rule text is restated here, so a later rename of the path WITHOUT a
// matching change to the ignore policy goes RED rather than quietly passing
// about a file nothing writes any more. The reverse-discriminator leg keeps
// the cheap fix (`*`, or ignoring the whole toolkit root) from passing: locks
// and the ignore file itself must still resolve as TRACKED.
//
// RELATIONSHIP TO THE M104 DOGFOOD PIN. `tests/m104-ste-383-dpt-gitignore.ts`
// compares this repo's own on-disk `.dpt/.gitignore` byte-for-byte against
// `DPT_GITIGNORE_BODY`. These legs therefore go green only once BOTH the
// constant and this repo's committed copy carry the new rule — which is the
// intended coupling, not a conflict.
// ===========================================================================

function gitIn(cwd: string, args: string[]): { exitCode: number; stdout: string } {
  const proc = Bun.spawnSync(
    ["git", "-c", "user.email=t@t.test", "-c", "user.name=t", ...args],
    { cwd, stdout: "pipe", stderr: "pipe" },
  );
  return { exitCode: proc.exitCode, stdout: proc.stdout.toString() };
}

/** `git check-ignore -q <path>` → exit 0 means IGNORED, exit 1 means TRACKED. */
function isIgnoredIn(repo: string, relPath: string): boolean {
  return gitIn(repo, ["check-ignore", "-q", relPath]).exitCode === 0;
}

/**
 * A throwaway git repo whose `.dpt/` carries the SHIPPED ignore body verbatim.
 * The body is not retyped — it is the exported constant, so these legs are
 * about the shipped policy and nothing else.
 */
function tempGitRepoWithShippedIgnore(label: string): string {
  const root = tempProjectRoot(label);
  gitIn(root, ["init", "-q"]);
  mkdirSync(dptRoot(root), { recursive: true });
  writeFileSync(join(dptRoot(root), ".gitignore"), DPT_GITIGNORE_BODY);
  return root;
}

describe("M132 hardening — the skip baseline is ignored, never committable", () => {
  test("the shipped ignore body matches the basename skipBaselinePath produces", async () => {
    const paths = await loadDptPaths();
    const root = tempGitRepoWithShippedIgnore("ignore-match");
    const file = paths.skipBaselinePath(root);

    // Derived, never restated: rename the path and this leg follows it.
    expect(isIgnoredIn(root, relative(root, file))).toBe(true);

    // And the rule that catches it is genuinely about THIS basename, not an
    // incidental directory-wide sweep: the same name one level up, outside
    // `.dpt/`, must remain tracked.
    expect(isIgnoredIn(root, basename(file))).toBe(false);
  });

  test("a real captured baseline is not staged by `git add -A`", async () => {
    const skip = await loadSkipBaseline();
    const paths = await loadDptPaths();
    const root = tempGitRepoWithShippedIgnore("git-add");

    skip.captureSkipBaseline(root, "feat/m132-hardening", 7);
    const rel = relative(root, paths.skipBaselinePath(root));
    expect(existsSync(paths.skipBaselinePath(root))).toBe(true);

    gitIn(root, ["add", "-A"]);
    const staged = gitIn(root, ["diff", "--cached", "--name-only"]).stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    expect(staged).not.toContain(rel);
    // The sweep really ran — the ignore file itself IS staged. Without this
    // the leg would pass on a `git add` that silently did nothing at all.
    expect(staged).toContain(relative(root, join(dptRoot(root), ".gitignore")));
  });

  test("the cheap fix is refused — locks and the ignore file stay tracked", async () => {
    const paths = await loadDptPaths();
    const root = tempGitRepoWithShippedIgnore("polarity");

    const lock = join(locksDir(root), "STE-509.json");
    mkdirSync(locksDir(root), { recursive: true });
    writeFileSync(lock, "{}\n");

    expect(isIgnoredIn(root, relative(root, lock))).toBe(false);
    expect(isIgnoredIn(root, relative(root, join(dptRoot(root), ".gitignore")))).toBe(false);
    // Sanity anchor for the same matcher: `ledger/` has always been ignored,
    // so a harness that reported `false` for everything dies here.
    expect(isIgnoredIn(root, relative(root, ledgerPath(root)))).toBe(true);
  });

  test("dogfood — this repo's own committed policy ignores its own baseline path", async () => {
    const paths = await loadDptPaths();
    const repoRoot = join(PLUGIN_ROOT, "..", "..");
    const shipped = join(dptRoot(repoRoot), ".gitignore");

    expect(existsSync(shipped)).toBe(true);
    expect(readFileSync(shipped, "utf-8")).toBe(DPT_GITIGNORE_BODY);
    expect(
      isIgnoredIn(repoRoot, relative(repoRoot, paths.skipBaselinePath(repoRoot))),
    ).toBe(true);
  });
});

// ===========================================================================
// Teardown — nothing this file created outlives the run.
// ===========================================================================

describe("housekeeping", () => {
  test("temporary trees are removed", () => {
    cleanupTempRoots();
    expect(TEMP_ROOTS.length).toBe(0);
  });
});
