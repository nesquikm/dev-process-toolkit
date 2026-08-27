// M136 STE-527 — the skip baseline belongs to a TRUNK COMMIT, measured in THIS
// checkout.
//
// WHAT THIS FILE PINS, and why each leg is shaped the way it is.
//
//   AC.1  The store is a versioned ENVELOPE (`version` / `checkoutId` /
//         `baselines`), and the absence of `version` is the v1 branch-keyed
//         shape. The sharpest leg here is deliberately adversarial: a v1-shaped
//         file whose single key IS the repository's real trunk sha, holding a
//         count of 99. A reader that indexes the raw map — today's reader —
//         serves that 99 as a sha-keyed baseline. Nothing else reproduces the
//         silent reinterpretation the AC is about.
//
//   AC.2  Capture refuses on BOTH preconditions, exercised against genuinely
//         dirty trees rather than a stubbed status: a modified tracked file
//         alone refuses, an UNTRACKED file alone refuses (the case this
//         repository's own flow produces at exactly the old capture moment),
//         and a six-offender tree names exactly three. A CONTROL leg captures
//         on a clean tree at the right sha, so "refuses always" cannot score.
//         Every refusal is asserted to have written NOTHING.
//
//   AC.3  Two REAL project roots. The store written in one is copied into a
//         `git clone` of it — same trunk sha, different checkout — and the read
//         there must refuse rather than subtract. Two further legs: the ids are
//         asserted DIFFERENT by construction (a clone carries none of its own),
//         and a store whose ENVELOPE id matches while a RECORD id does not must
//         also refuse, so "every record carries a checkoutId" is load-bearing
//         rather than decorative.
//
//   AC.4  Trunk resolution is driven off the SHIPPED `PROTECTED_TRUNKS`, and
//         the ordering leg is what makes that non-cosmetic: a repository
//         carrying BOTH trunks at DIFFERENT commits must resolve to the first
//         member, and the expected sha is computed by running `git merge-base`
//         here rather than retyped. A repository with neither trunk resolves to
//         `null`. Plus a source-level leg: no `"main"` / `"master"` literal in
//         this module's code.
//
//   AC.5  The AC-STE-509.4 write-once guard, carried over verbatim in
//         substance: a second capture for the same sha returns the standing
//         record with `written: false` and the file's RAW BYTES are unchanged,
//         so a rewrite that re-derives the same number is still caught by the
//         moved `capturedAt`.
//
//   AC.6  The three v1 records measured on `.dpt/skip-baseline.json` at 9b420ec
//         are embedded byte-for-byte and asserted DROPPED AND NAMED. Their
//         counts (15 / 27 / 15) are asserted absent from the migrated store, so
//         a re-key that installs known-wrong numbers behind sha-shaped keys
//         dies here. A non-vacuity leg migrates a healthy v2 store and asserts
//         it drops nothing and loses nothing.
//
//   AC.7  Asserted in the SAME test as AC.3, through `git check-ignore` against
//         the shipped `DPT_GITIGNORE_BODY` — the real matcher, not a substring
//         search — for the store AND for the checkout-id file. The second half
//         matters twice over: an id file that is NOT ignored dirties the tree,
//         and a capture that mints one would then refuse on its own artifact.
//
//   AC.8  Two EXECUTED mutations, each asserted to have APPLIED (the clause it
//         changed is named in the failure message, and `mutateInRegion` aborts
//         loudly when its anchor is absent or ambiguous — M121 § 0k(m)):
//           * the clean-tree clause stubbed to always-clean, which turns AC.2's
//             dirty-tree assertion red;
//           * the checkout-comparison clause inverted, which turns AC.3's
//             foreign-store assertion red.
//         A CONTROL leg runs the same two probes against the shipped module.
//
//   AC.9  The envelope read path is non-vacuous in BOTH directions: an absent
//         file is no baselines and no crash, a KNOWN version reads back `ok`,
//         and an UNKNOWN version is `incomparable` rather than empty — carrying
//         its OWN cause and its OWN remedy rather than falling onto the
//         renderer's `default:` arm.
//
// CROSS-FR INVARIANTS (STE-530) RE-ASSERTED HERE. AC-STE-530.8's discovery
// helpers stop testing what they claim if either invariant is broken by this
// FR's widening, and they fail SILENTLY when that happens — so both are pinned
// again in this file:
//   * `SkipVerdict` carries EXACTLY ONE field beyond outcome/baseline/current/
//     delta (the cause discriminator);
//   * `skip_baseline.ts` exports EXACTLY ONE string array besides
//     `SKIP_OUTCOMES` (the cause vocabulary), which now has at least THREE
//     members. A member is added; a second array is not.
// The third cause is bound the same way the first two are: every cause renders
// its own line, and their commands are pairwise distinct. AC-STE-530.8's phrase
// "the two conditions do not share one line" is read here as "each condition",
// because the re-measure remedy that its `default:` arm hands out is wrong for
// an unknown store version.
//
// CONTRACTS THIS FILE DEFINES FOR THE IMPLEMENTER. The cause SPELLINGS are
// discovered at run time, so the implementer names them; the entry points are
// named here because the module's shape genuinely changes:
//
//   captureSkipBaseline(projectRoot, sha, skipped) -> { written, record }
//       Second argument is now the TRUNK SHA, not a branch. Refuses by THROWING
//       an Error whose message is the NFR-10 canonical block; writes nothing on
//       every refusing path.
//   readSkipBaseline(projectRoot) -> { status: "ok", record }
//                                  | { status: "absent" }
//                                  | { status: "incomparable", cause }
//       Branch is no longer a parameter: the trunk sha is resolved from git.
//       `absent` and `incomparable` are different states and must not collapse.
//   evaluateSkipDelta(projectRoot, current) -> SkipVerdict
//   resolveTrunkSha(projectRoot) -> string | null
//   readCheckoutId(projectRoot) -> string          (mints once, then stable)
//   migrateSkipBaselineStore(projectRoot) -> { dropped: readonly string[] }
//   dpt_paths.checkoutIdPath(projectRoot) -> string   (sole composer, AC.4)
//
//   MUTATION ANCHORS (AC.8), each a top-level `function` declaration occurring
//   exactly once in the file:
//       function offendingPaths(   — the porcelain lines, empty when clean
//       function sameCheckout(     — the checkout-id comparison
//
// KNOWN COUPLINGS THIS FR PAYS FOR — the identity the store is keyed by
// changed, so the consumers of the old identity change with it. Named here so
// they are budgeted rather than discovered:
//   * `adapters/_shared/src/capture_skip_baseline.ts` passes a BRANCH to
//     `captureSkipBaseline`; it must pass a resolved trunk sha instead.
//   * `adapters/_shared/src/deliver_stage_evidence.ts` calls
//     `evaluateSkipDelta(root, branch, skip)`; the branch argument is gone.
//   * `tests/m132-ste-509-skip-baseline.test.ts` captures on non-git temp roots
//     and keys by branch throughout — every leg of it is on the old contract.
//   * `tests/m136-ste-530-executable-remedy.test.ts` grafts stubs declaring
//     `evaluateSkipDelta(projectRoot, branch, current)`.
//   * If the checkout-id file needs a new `DPT_GITIGNORE_BODY` rule, this
//     repository's own committed `.dpt/.gitignore` moves with the constant
//     (the M104 dogfood pin couples them deliberately).

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
import { join, relative } from "node:path";

import { PROTECTED_TRUNKS } from "../adapters/_shared/src/branch_proposal";
import { dptRoot } from "../adapters/_shared/src/dpt_paths";
import { DPT_GITIGNORE_BODY } from "../adapters/_shared/src/setup/dpt_gitignore";
import { mutateInRegion } from "./_sited-mutation";
import { discoverCauseField, discoverCauses } from "./_skip_verdict_discovery";
import {
  cutBranch as sharedCutBranch,
  makeTrunkRepo as sharedMakeTrunkRepo,
} from "./_skip_baseline_fixture";

// ===========================================================================
// Paths and module handles.
// ===========================================================================

const PLUGIN_ROOT = join(import.meta.dir, "..");
const SHARED_SRC = join(PLUGIN_ROOT, "adapters", "_shared", "src");
const SKIP_BASELINE_FILE = join(SHARED_SRC, "skip_baseline.ts");

const read = (p: string): string => readFileSync(p, "utf-8");

interface SkipVerdictShape {
  readonly outcome: string;
  readonly baseline: number | null;
  readonly current: number;
  readonly delta: number | null;
  readonly [extra: string]: unknown;
}

interface SkipBaselineRecordShape {
  readonly sha: string;
  readonly skipped: number;
  readonly capturedAt: string;
  readonly checkoutId: string;
}

interface CaptureResultShape {
  readonly written: boolean;
  readonly record: SkipBaselineRecordShape;
}

interface SkipBaselineReadShape {
  readonly status: string;
  readonly record?: SkipBaselineRecordShape;
  readonly cause?: string;
}

interface MigrationShape {
  readonly dropped: readonly string[];
}

interface SkipBaselineModule {
  readonly SKIP_OUTCOMES: readonly string[];
  captureSkipBaseline(projectRoot: string, sha: string, skipped: number): CaptureResultShape;
  readSkipBaseline(projectRoot: string): SkipBaselineReadShape;
  evaluateSkipDelta(projectRoot: string, current: number): SkipVerdictShape;
  resolveTrunkSha(projectRoot: string): string | null;
  readCheckoutId(projectRoot: string): string;
  migrateSkipBaselineStore(projectRoot: string): MigrationShape;
  isCleanPass(verdict: SkipVerdictShape): boolean;
  renderSkipVerdict(verdict: SkipVerdictShape): string;
}

interface DptPathsModule {
  skipBaselinePath(projectRoot: string): string;
  checkoutIdPath(projectRoot: string): string;
}

async function loadSkipBaseline(): Promise<SkipBaselineModule> {
  return (await import(
    "../adapters/_shared/src/skip_baseline"
  )) as unknown as SkipBaselineModule;
}

async function loadDptPaths(): Promise<DptPathsModule> {
  const mod = (await import("../adapters/_shared/src/dpt_paths")) as unknown as DptPathsModule;
  expect(
    typeof mod.checkoutIdPath,
    "dpt_paths must be the SOLE composer of the checkout-id path (AC-STE-527.4's " +
      "single-composer rule); skip_baseline may hold no layout literal of its own",
  ).toBe("function");
  return mod;
}

// ===========================================================================
// Throwaway git projects. Nothing here touches the toolkit repo.
// ===========================================================================

const TEMP_DIRS: string[] = [];

function tempDir(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `ste527-${label}-`));
  TEMP_DIRS.push(dir);
  return dir;
}

function cleanupTempDirs(): void {
  for (const dir of TEMP_DIRS.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

interface GitResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

function gitIn(cwd: string, args: string[]): GitResult {
  const proc = Bun.spawnSync(
    ["git", "-c", "user.email=t@t.test", "-c", "user.name=t", "-C", cwd, ...args],
    { stdout: "pipe", stderr: "pipe" },
  );
  return {
    exitCode: proc.exitCode,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
  };
}

/** Run git and demand success — a fixture that half-built is not a fixture. */
function git(cwd: string, args: string[]): string {
  const result = gitIn(cwd, args);
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} in ${cwd} failed: ${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

/** `git check-ignore -q <path>` → exit 0 means IGNORED, exit 1 means TRACKED. */
function isIgnoredIn(repo: string, relPath: string): boolean {
  return gitIn(repo, ["check-ignore", "-q", relPath]).exitCode === 0;
}

/** The first and second members of the shipped constant — never retyped. */
const FIRST_TRUNK = PROTECTED_TRUNKS[0] as string;
const SECOND_TRUNK = PROTECTED_TRUNKS[1] as string;

interface TrunkRepo {
  readonly root: string;
  /** The commit the trunk stands on when the fixture is handed back. */
  readonly trunkSha: string;
}

/**
 * A git project standing on the first protected trunk with a CLEAN tree.
 *
 * The shipped `.dpt/.gitignore` body is written and COMMITTED, exactly as a
 * `/setup`-bootstrapped project carries it. That is load-bearing rather than
 * scene-setting: an ignore policy that does not cover what capture writes makes
 * the tree dirty the moment capture mints anything, and capture would then
 * refuse on its own artifact.
 */
function makeTrunkRepo(label: string): TrunkRepo {
  return sharedMakeTrunkRepo(label);
}

/** Cut a feature branch and put one commit on it, so HEAD leaves the trunk. */
function cutBranch(root: string, name: string): void {
  sharedCutBranch(root, name);
}

// ===========================================================================
// Refusals — NFR-10 canonical shape, and capture that writes nothing.
// ===========================================================================

/**
 * Call `fn` and return the refusal message. A call that did NOT refuse fails
 * the leg by name rather than by an opaque throw somewhere downstream.
 */
function refusalFrom(label: string, fn: () => unknown): string {
  let message: string | null = null;
  try {
    fn();
  } catch (error) {
    message = (error as Error).message;
  }
  expect(message, `${label}: capture must REFUSE, and it returned instead`).not.toBeNull();
  return message as string;
}

/**
 * The NFR-10 canonical shape: a verdict, then `Remedy:`, then `Context:` with
 * mode / ticket / skill. Asserted structurally so a reworded verdict stays
 * free while the shape does not.
 */
function expectNfr10(message: string, label: string): void {
  const lines = message
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  expect(lines.length, `${label}: NFR-10 is a verdict plus Remedy plus Context`).toBeGreaterThan(
    2,
  );
  expect(
    lines[lines.length - 2] as string,
    `${label}: the second-to-last line must be the NFR-10 remedy`,
  ).toStartWith("Remedy: ");

  const context = lines[lines.length - 1] as string;
  expect(context, `${label}: the last line must be the NFR-10 context`).toStartWith("Context: ");
  for (const key of ["mode=", "ticket=", "skill="]) {
    expect(context, `${label}: NFR-10 context must carry ${key}`).toContain(key);
  }
}

// ===========================================================================
// AC-STE-527.1 — the store is a versioned envelope, and a v1 file is v1.
// ===========================================================================

describe("AC-STE-527.1 — the store is a versioned envelope", () => {
  test("a written store carries version, checkoutId and a sha-keyed baselines map", async () => {
    const mod = await loadSkipBaseline();
    const paths = await loadDptPaths();
    const { root, trunkSha } = makeTrunkRepo("envelope");

    mod.captureSkipBaseline(root, trunkSha, 4);

    const raw = JSON.parse(read(paths.skipBaselinePath(root))) as Record<string, unknown>;

    expect(raw.version, "the envelope declares its version explicitly").toBeDefined();
    expect(raw.version).not.toBeNull();
    expect(typeof raw.checkoutId, "the envelope records which checkout wrote it").toBe("string");

    const baselines = raw.baselines as Record<string, unknown>;
    expect(baselines, "records live under `baselines`, never at the top level").toBeDefined();
    expect(Object.keys(baselines), "keyed by the trunk commit sha").toEqual([trunkSha]);

    // The top level is the ENVELOPE, not the map: a branch name at the top
    // level is exactly the v1 shape this key exists to distinguish from.
    expect(Object.keys(raw).sort()).toEqual(["baselines", "checkoutId", "version"]);
  });

  test("a v1 file — no `version` key — is never read as a sha-keyed record", async () => {
    const mod = await loadSkipBaseline();
    const paths = await loadDptPaths();
    const { root, trunkSha } = makeTrunkRepo("v1-collision");

    // The adversarial case, and the only one that reproduces the defect: a v1
    // record whose branch-shaped KEY happens to be the real trunk sha. Today's
    // reader indexes the raw map, so it hands back 99 and calls it measured.
    mkdirSync(dptRoot(root), { recursive: true });
    writeFileSync(
      paths.skipBaselinePath(root),
      `${JSON.stringify(
        { [trunkSha]: { branch: trunkSha, skipped: 99, capturedAt: "2026-08-25T07:41:33.065Z" } },
        null,
        2,
      )}\n`,
    );

    cutBranch(root, "feat/m136-trunk-baseline");

    const back = mod.readSkipBaseline(root);
    expect(back.status, "a v1 entry is not a usable v2 record").not.toBe("ok");
    expect(back.record?.skipped, "the v1 count must not be served").not.toBe(99);

    const verdict = mod.evaluateSkipDelta(root, 3);
    expect(verdict.baseline, "no v1 number reaches the verdict").not.toBe(99);
    expect(verdict.delta).not.toBe(-96);
    expect(mod.isCleanPass(verdict), "a v1 store never grades a run").toBe(false);
  });
});

// ===========================================================================
// AC-STE-527.2 — capture refuses on a wrong HEAD and on a dirty tree.
// ===========================================================================

describe("AC-STE-527.2 — capture refuses unless HEAD matches and the tree is clean", () => {
  test("CONTROL: a clean tree standing on the sha CAPTURES", async () => {
    const mod = await loadSkipBaseline();
    const paths = await loadDptPaths();
    const { root, trunkSha } = makeTrunkRepo("capture-control");

    const result = mod.captureSkipBaseline(root, trunkSha, 6);

    expect(result.written, "a clean tree at the right sha is the capturing case").toBe(true);
    expect(result.record.sha).toBe(trunkSha);
    expect(result.record.skipped).toBe(6);
    expect(existsSync(paths.skipBaselinePath(root))).toBe(true);

    // The capture minted a checkout id and still saw a clean tree — the id file
    // is covered by the ignore policy, or this leg dies here (AC.7's second
    // half, met from the capture side).
    expect(git(root, ["status", "--porcelain"]), "capture dirtied its own tree").toBe("");
  });

  test("a HEAD that is not the requested sha refuses, naming both", async () => {
    const mod = await loadSkipBaseline();
    const paths = await loadDptPaths();
    const { root, trunkSha } = makeTrunkRepo("wrong-head");

    cutBranch(root, "feat/elsewhere");
    const head = git(root, ["rev-parse", "HEAD"]);
    expect(head).not.toBe(trunkSha);

    const message = refusalFrom("wrong HEAD", () =>
      mod.captureSkipBaseline(root, trunkSha, 5),
    );

    expect(message, "the refusal names the OBSERVED head").toContain(head);
    expect(message, "the refusal names the REQUESTED sha").toContain(trunkSha);
    expectNfr10(message, "wrong HEAD");

    expect(existsSync(paths.skipBaselinePath(root)), "a refusal writes nothing").toBe(false);
  });

  test("a modified TRACKED file refuses, naming the path", async () => {
    const mod = await loadSkipBaseline();
    const paths = await loadDptPaths();
    const { root, trunkSha } = makeTrunkRepo("dirty-tracked");

    writeFileSync(join(root, "README.md"), "# fixture, edited\n");
    expect(git(root, ["status", "--porcelain"])).not.toBe("");

    const message = refusalFrom("modified tracked file", () =>
      mod.captureSkipBaseline(root, trunkSha, 5),
    );

    expect(message, "the refusal names the offending path").toContain("README.md");
    expect(message, "the refusal names the observed HEAD").toContain(trunkSha);
    expectNfr10(message, "modified tracked file");
    expect(existsSync(paths.skipBaselinePath(root)), "a refusal writes nothing").toBe(false);
  });

  test("an UNTRACKED file alone refuses — the case this repo's flow produces", async () => {
    const mod = await loadSkipBaseline();
    const paths = await loadDptPaths();
    const { root, trunkSha } = makeTrunkRepo("dirty-untracked");

    // Nothing tracked has moved. `git status --porcelain` reports this only
    // because untracked files are included by default; a status call carrying
    // `--untracked-files=no` sees a clean tree and captures a number measured
    // against files that are not in the commit. Cutting a branch with untracked
    // FR files present is this repository's own flow.
    writeFileSync(join(root, "specs-fr-draft.md"), "draft\n");
    expect(git(root, ["diff", "--stat"]), "no TRACKED file moved").toBe("");
    expect(git(root, ["status", "--porcelain"])).not.toBe("");

    const message = refusalFrom("untracked file", () =>
      mod.captureSkipBaseline(root, trunkSha, 5),
    );

    expect(message, "the refusal names the untracked path").toContain("specs-fr-draft.md");
    expectNfr10(message, "untracked file");
    expect(existsSync(paths.skipBaselinePath(root)), "a refusal writes nothing").toBe(false);
  });

  test("a six-offender tree names exactly THREE of them", async () => {
    const mod = await loadSkipBaseline();
    const { root, trunkSha } = makeTrunkRepo("dirty-many");

    writeFileSync(join(root, "README.md"), "# fixture, edited\n");
    const untracked = ["a", "b", "c", "d", "e"].map((letter) => `dirty-${letter}.txt`);
    for (const name of untracked) writeFileSync(join(root, name), `${name}\n`);

    const offenders = ["README.md", ...untracked];
    expect(git(root, ["status", "--porcelain"]).split("\n")).toHaveLength(offenders.length);

    const message = refusalFrom("six offenders", () =>
      mod.captureSkipBaseline(root, trunkSha, 5),
    );

    const named = offenders.filter((path) => message.includes(path));
    // Exactly three: "names none" and "names all six" are both excluded, and
    // neither is asserted by an ordering this leg would have to hard-code.
    expect(
      named.length,
      `the refusal must name the first THREE offending paths, named: ${named.join(", ")}`,
    ).toBe(3);
    expectNfr10(message, "six offenders");
  });
});

// ===========================================================================
// AC-STE-527.3 + AC-STE-527.7 — one fact, asserted in one place: a store that
// cannot prove it is looking at its own checkout refuses, and the store never
// travels between checkouts in the first place.
// ===========================================================================

interface ForeignPair {
  readonly home: string;
  readonly foreign: string;
  readonly trunkSha: string;
}

/**
 * A written store and a SECOND REAL ROOT holding a copy of it.
 *
 * The second root is a `git clone` of the first, so the trunk sha resolves
 * identically there — which is what makes the refusal about the CHECKOUT and
 * not about a lookup miss. The clone carries the committed `.dpt/.gitignore`
 * and nothing else from `.dpt/`, because the store is ignored: it has no id of
 * its own until it mints one.
 */
async function makeForeignPair(label: string, skipped: number): Promise<ForeignPair> {
  const mod = await loadSkipBaseline();
  const paths = await loadDptPaths();
  const { root: home, trunkSha } = makeTrunkRepo(`home-${label}`);

  mod.captureSkipBaseline(home, trunkSha, skipped);

  const parent = tempDir(`clone-${label}`);
  const foreign = join(parent, "clone");
  git(parent, ["clone", "-q", home, foreign]);

  expect(git(foreign, ["rev-parse", "HEAD"]), "the clone stands on the same commit").toBe(
    trunkSha,
  );
  expect(existsSync(paths.skipBaselinePath(foreign)), "the store did not travel by git").toBe(
    false,
  );

  copyFileSync(paths.skipBaselinePath(home), paths.skipBaselinePath(foreign));

  return { home, foreign, trunkSha };
}

describe("AC-STE-527.3 + AC-STE-527.7 — a foreign store refuses, and never travels", () => {
  test("a store copied into a second checkout is incomparable, and the store is git-ignored", async () => {
    const mod = await loadSkipBaseline();
    const paths = await loadDptPaths();
    const { home, foreign } = await makeForeignPair("refuse", 4);

    // The ids differ BY CONSTRUCTION — a clone inherits none.
    const homeId = mod.readCheckoutId(home);
    const foreignId = mod.readCheckoutId(foreign);
    expect(homeId.length, "a checkout id is a real value").toBeGreaterThan(0);
    expect(foreignId, "a clone must mint its own id, not inherit one").not.toBe(homeId);

    // Home still compares — without this, "always incomparable" would score.
    const atHome = mod.evaluateSkipDelta(home, 4);
    expect(atHome.outcome, "the capturing checkout still measures its own store").toBe("pass");

    const there = mod.evaluateSkipDelta(foreign, 9);
    expect(there.outcome, "a foreign store must never grade this run").toBe("incomparable");
    expect(there.outcome).not.toBe("pass");
    expect(there.delta, "no delta is computed across checkouts").toBeNull();
    expect(there.baseline, "and no baseline number is surfaced either").toBeNull();
    expect(mod.isCleanPass(there)).toBe(false);

    const readBack = mod.readSkipBaseline(foreign);
    expect(readBack.status).toBe("incomparable");
    expect(typeof readBack.cause, "the refusal names WHY it cannot compare").toBe("string");

    // AC.7, here rather than elsewhere: a store that starts travelling between
    // clones re-opens exactly the comparison the legs above refuse, so the two
    // are one fact. `git check-ignore` is the real matcher.
    expect(
      isIgnoredIn(home, relative(home, paths.skipBaselinePath(home))),
      "the store must stay untracked",
    ).toBe(true);
    expect(
      isIgnoredIn(home, relative(home, paths.checkoutIdPath(home))),
      "the checkout id must stay untracked — it is the thing that must not travel",
    ).toBe(true);

    // Not a directory-wide sweep: the ignore file itself stays tracked.
    expect(
      isIgnoredIn(home, relative(home, join(dptRoot(home), ".gitignore"))),
      "the cheap fix (ignore everything) is refused",
    ).toBe(false);
  });

  test("a matching ENVELOPE id does not excuse a foreign RECORD id", async () => {
    const mod = await loadSkipBaseline();
    const paths = await loadDptPaths();
    const { root, trunkSha } = makeTrunkRepo("record-id");

    mod.captureSkipBaseline(root, trunkSha, 4);

    const file = paths.skipBaselinePath(root);
    const store = JSON.parse(read(file)) as {
      checkoutId: string;
      baselines: Record<string, Record<string, unknown>>;
    };
    const record = store.baselines[trunkSha] as Record<string, unknown>;
    expect(typeof record.checkoutId, "every record carries a checkoutId").toBe("string");
    expect(record.checkoutId, "and it is this checkout's").toBe(mod.readCheckoutId(root));

    // Envelope untouched, record re-stamped by another checkout.
    record.checkoutId = `${store.checkoutId}-somewhere-else`;
    writeFileSync(file, `${JSON.stringify(store, null, 2)}\n`);

    const verdict = mod.evaluateSkipDelta(root, 4);
    expect(verdict.outcome, "a record from elsewhere is not comparable here").toBe(
      "incomparable",
    );
    expect(verdict.delta).toBeNull();
  });
});

// ===========================================================================
// AC-STE-527.4 — the trunk comes from the shipped constant, in its order.
// ===========================================================================

describe("AC-STE-527.4 — trunk resolution reads PROTECTED_TRUNKS", () => {
  test("the trunk sha is git merge-base HEAD <first trunk>", async () => {
    const mod = await loadSkipBaseline();
    const { root, trunkSha } = makeTrunkRepo("merge-base");

    cutBranch(root, "feat/m136-work");
    expect(git(root, ["rev-parse", "HEAD"])).not.toBe(trunkSha);

    const expected = git(root, ["merge-base", "HEAD", FIRST_TRUNK]);
    expect(expected).toBe(trunkSha);
    expect(mod.resolveTrunkSha(root)).toBe(expected);
  });

  test("it is the FORK POINT, not the trunk tip — the trunk moves after the cut", async () => {
    // Every other leg in this block cuts a branch and leaves the trunk where it
    // was, so `merge-base HEAD <trunk>` and `rev-parse <trunk>` return the same
    // sha and the two are indistinguishable. Measured: a mutant swapping
    // ["merge-base","HEAD",trunk] for ["rev-parse",trunk] SURVIVED all five of
    // those legs. Diverging the trunk is what separates them, and it is also
    // the real case — trunk advances while a branch is in flight.
    const mod = await loadSkipBaseline();
    const { root, trunkSha } = makeTrunkRepo("diverged");

    cutBranch(root, "feat/m136-diverged");
    const forkPoint = git(root, ["merge-base", "HEAD", FIRST_TRUNK]);
    expect(forkPoint).toBe(trunkSha);

    // Advance the trunk WITHOUT merging it into the feature branch.
    const feature = git(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
    git(root, ["checkout", "-q", FIRST_TRUNK]);
    writeFileSync(join(root, "trunk-moved.md"), "later\n");
    git(root, ["add", "-A"]);
    git(root, ["commit", "-q", "-m", "chore: trunk advances"]);
    const trunkTip = git(root, ["rev-parse", FIRST_TRUNK]);
    git(root, ["checkout", "-q", feature]);

    // The premise of the leg: the two candidate answers are now different.
    expect(trunkTip).not.toBe(forkPoint);

    expect(mod.resolveTrunkSha(root)).toBe(forkPoint);
    expect(
      mod.resolveTrunkSha(root),
      "resolved the trunk TIP — that is `rev-parse <trunk>`, not `merge-base HEAD <trunk>`",
    ).not.toBe(trunkTip);
  });

  test("the SECOND member is used when the first has no local ref", async () => {
    const mod = await loadSkipBaseline();
    const root = tempDir("second-trunk");

    writeFileSync(join(root, "README.md"), "# fixture\n");
    git(root, ["init", "-q", "-b", SECOND_TRUNK]);
    git(root, ["add", "-A"]);
    git(root, ["commit", "-q", "-m", "chore: fixture"]);
    cutBranch(root, "feat/on-second");

    expect(gitIn(root, ["rev-parse", "--verify", "-q", FIRST_TRUNK]).exitCode).not.toBe(0);
    expect(mod.resolveTrunkSha(root)).toBe(git(root, ["merge-base", "HEAD", SECOND_TRUNK]));
  });

  test("with BOTH trunks present at different commits, the FIRST member wins", async () => {
    const mod = await loadSkipBaseline();
    const root = tempDir("both-trunks");

    writeFileSync(join(root, "README.md"), "# fixture\n");
    git(root, ["init", "-q", "-b", FIRST_TRUNK]);
    git(root, ["add", "-A"]);
    git(root, ["commit", "-q", "-m", "chore: base"]);

    // `master` forks here and moves on; `main` then moves on separately, so the
    // two merge-bases are DIFFERENT commits and the ordering is observable.
    git(root, ["checkout", "-q", "-b", SECOND_TRUNK]);
    writeFileSync(join(root, "second.md"), "second\n");
    git(root, ["add", "-A"]);
    git(root, ["commit", "-q", "-m", "chore: second trunk"]);

    git(root, ["checkout", "-q", FIRST_TRUNK]);
    writeFileSync(join(root, "first.md"), "first\n");
    git(root, ["add", "-A"]);
    git(root, ["commit", "-q", "-m", "chore: first trunk"]);
    cutBranch(root, "feat/off-first");

    const viaFirst = git(root, ["merge-base", "HEAD", FIRST_TRUNK]);
    const viaSecond = git(root, ["merge-base", "HEAD", SECOND_TRUNK]);
    expect(viaFirst, "the fixture must make the two orders distinguishable").not.toBe(viaSecond);

    expect(mod.resolveTrunkSha(root)).toBe(viaFirst);
  });

  test("a repository carrying neither trunk resolves to null, and does not crash", async () => {
    const mod = await loadSkipBaseline();
    const root = tempDir("no-trunk");

    writeFileSync(join(root, "README.md"), "# fixture\n");
    git(root, ["init", "-q", "-b", "feat/orphan"]);
    git(root, ["add", "-A"]);
    git(root, ["commit", "-q", "-m", "chore: fixture"]);

    expect(mod.resolveTrunkSha(root)).toBeNull();
    expect(() => mod.evaluateSkipDelta(root, 3)).not.toThrow();
  });

  test("skip_baseline.ts composes no trunk literal of its own", () => {
    const source = read(SKIP_BASELINE_FILE);

    // Comments may name the trunks; code may not. Same rule, same strip, as the
    // `.dpt` single-composer leg in the STE-509 file.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");

    for (const trunk of PROTECTED_TRUNKS) {
      expect(code, `a second spelling of "${trunk}" agrees until a project uses the other`).not
        .toContain(`"${trunk}"`);
    }
    expect(source, "the shipped constant is the one source").toContain("PROTECTED_TRUNKS");
    expect(source, "imported from the module that declares it").toContain("branch_proposal");
  });
});

// ===========================================================================
// AC-STE-527.5 — REGRESSION, carried over from AC-STE-509.4: write-once.
// ===========================================================================

describe("AC-STE-527.5 — write-once per trunk sha survives the re-key", () => {
  test("a second capture for the same sha returns the standing record, bytes untouched", async () => {
    const mod = await loadSkipBaseline();
    const paths = await loadDptPaths();
    const { root, trunkSha } = makeTrunkRepo("write-once");
    const file = paths.skipBaselinePath(root);

    const first = mod.captureSkipBaseline(root, trunkSha, 2);
    expect(first.written).toBe(true);
    const bytesAfterFirst = read(file);
    const capturedAt = first.record.capturedAt;

    // A second capture with a DIFFERENT count — the mid-run refresh that makes
    // the ratchet report a zero delta forever.
    const second = mod.captureSkipBaseline(root, trunkSha, 9);
    expect(second.written).toBe(false);
    expect(second.record.skipped).toBe(2);
    expect(second.record.capturedAt, "capturedAt must not move").toBe(capturedAt);

    // Raw bytes: a rewrite that re-derives the same number still moves the
    // instant, and this is what sees it.
    expect(read(file)).toBe(bytesAfterFirst);

    cutBranch(root, "feat/after-capture");
    const verdict = mod.evaluateSkipDelta(root, 9);
    expect(verdict.outcome, "the delta is still the real one, not zero").toBe("fail");
    expect(verdict.baseline).toBe(2);
    expect(verdict.delta).toBe(7);
  });
});

// ===========================================================================
// AC-STE-527.6 — the v1 records are DROPPED and NAMED, never migrated.
// ===========================================================================

/**
 * `.dpt/skip-baseline.json` as measured at 9b420ec — the real bytes, not a
 * synthetic stand-in, so this test states what was actually on disk.
 */
const V1_STORE_ON_DISK = {
  "feat/m133-executable-delivery-decisions": {
    branch: "feat/m133-executable-delivery-decisions",
    skipped: 15,
    capturedAt: "2026-08-25T07:41:33.065Z",
  },
  "feat/m134-reachable-workers": {
    branch: "feat/m134-reachable-workers",
    skipped: 27,
    capturedAt: "2026-08-25T14:57:09.989Z",
  },
  "fix/m135-epic-binding-convergence": {
    branch: "fix/m135-epic-binding-convergence",
    skipped: 15,
    capturedAt: "2026-08-26T13:00:05.338Z",
  },
} as const;

const V1_KEYS = Object.keys(V1_STORE_ON_DISK);
const V1_COUNTS = [15, 27, 15];

describe("AC-STE-527.6 — the v1 records on disk are dropped and named", () => {
  test("every key is reported by name and no count survives", async () => {
    const mod = await loadSkipBaseline();
    const paths = await loadDptPaths();
    const { root, trunkSha } = makeTrunkRepo("v1-drop");

    mkdirSync(dptRoot(root), { recursive: true });
    writeFileSync(
      paths.skipBaselinePath(root),
      `${JSON.stringify(V1_STORE_ON_DISK, null, 2)}\n`,
    );

    const migration = mod.migrateSkipBaselineStore(root);

    expect(
      [...migration.dropped].sort(),
      "each dropped key is reported BY NAME — a silent drop is the same defect " +
        "as a silent re-key",
    ).toEqual([...V1_KEYS].sort());

    const after = read(paths.skipBaselinePath(root));
    for (const key of V1_KEYS) {
      expect(after, `${key} must not survive the migration in any form`).not.toContain(key);
    }

    const store = JSON.parse(after) as Record<string, unknown>;
    expect(store.version, "what is left is a v2 envelope").toBeDefined();
    expect(store.checkoutId).toBe(mod.readCheckoutId(root));
    expect(
      Object.keys(store.baselines as Record<string, unknown>),
      "re-keying to merge-base shas would install known-wrong numbers behind " +
        "keys that look measured",
    ).toEqual([]);

    // And none of the three numbers reappears behind the trunk sha.
    const verdict = mod.evaluateSkipDelta(root, 4);
    expect(verdict.outcome).toBe("unmeasured");
    for (const count of V1_COUNTS) {
      expect(verdict.baseline, `${count} must not be re-keyed to ${trunkSha}`).not.toBe(count);
    }
  });

  test("a healthy v2 store is left alone — nothing dropped, nothing lost", async () => {
    const mod = await loadSkipBaseline();
    const { root, trunkSha } = makeTrunkRepo("v2-untouched");

    mod.captureSkipBaseline(root, trunkSha, 3);

    const migration = mod.migrateSkipBaselineStore(root);
    expect(migration.dropped, "a v2 store has nothing to drop").toEqual([]);

    const back = mod.readSkipBaseline(root);
    expect(back.status, "and nothing to lose").toBe("ok");
    expect(back.record?.skipped).toBe(3);
  });
});

// ===========================================================================
// AC-STE-527.8 — both new preconditions are mutation-verified, and each
// mutation is asserted to have APPLIED before its effect is read.
// ===========================================================================

/** The transitive local imports a mutant copy of `skip_baseline.ts` needs. */
const MUTANT_DEPS = ["dpt_paths.ts", "branch_proposal.ts", "milestone_token.ts", "ulid.ts"];

/**
 * Write a mutated copy of `skip_baseline.ts` into a throwaway directory beside
 * copies of its local dependencies, and import it. The copy — not a paraphrase
 * — is what runs, so the mutation is genuinely EXECUTED rather than grepped.
 *
 * The declaration is renamed and a replacement appended: the module's internal
 * call sites still spell the bare name, so they rebind. `mutateInRegion` aborts
 * when the anchor is absent or ambiguous, which is what keeps a mutation that
 * never applied from scoring as a pass (M121 § 0k(m)).
 */
async function loadMutant(
  label: string,
  clause: string,
  anchor: string,
  replacement: readonly string[],
): Promise<SkipBaselineModule> {
  const dir = tempDir(`mutant-${label}`);
  for (const dep of MUTANT_DEPS) copyFileSync(join(SHARED_SRC, dep), join(dir, dep));

  const original = read(SKIP_BASELINE_FILE);
  const renamed = mutateInRegion(
    original,
    0,
    original.length,
    anchor,
    anchor.replace("function ", "function __orig_"),
    { label: `the ${clause} in skip_baseline.ts` },
  );
  const mutated = `${renamed}\n\n${replacement.join("\n")}\n`;

  // APPLIED — measured, not assumed, and the changed clause is NAMED so a
  // mutation that silently failed to apply is distinguishable from a pin that
  // works.
  expect(mutated, `the mutation of ${clause} changed nothing`).not.toBe(original);
  expect(mutated, `the mutation of ${clause} did not rename its declaration`).toContain(
    `function __orig_${anchor.replace("function ", "")}`,
  );

  // Every local import the mutant reaches for is present beside it, so an
  // import that silently resolved to nothing cannot masquerade as a mutation.
  for (const hit of mutated.matchAll(/from "\.\/([\w.-]+)"/g)) {
    const dep = `${hit[1] as string}.ts`;
    expect(
      existsSync(join(dir, dep)),
      `the mutant harness has no copy of ${dep}; add it to MUTANT_DEPS`,
    ).toBe(true);
  }

  const file = join(dir, "skip_baseline.ts");
  writeFileSync(file, mutated);
  return (await import(file)) as unknown as SkipBaselineModule;
}

/** AC.2's assertion, as one callable: a dirty tree must refuse. */
function dirtyTreeRefuses(mod: SkipBaselineModule, label: string): boolean {
  const { root, trunkSha } = makeTrunkRepo(`mutation-${label}`);
  writeFileSync(join(root, "untracked-fr.md"), "draft\n");
  try {
    mod.captureSkipBaseline(root, trunkSha, 5);
    return false;
  } catch {
    return true;
  }
}

describe("AC-STE-527.8 — the two new preconditions are mutation-verified", () => {
  test("CONTROL: the shipped module refuses a dirty tree and a foreign store", async () => {
    const mod = await loadSkipBaseline();

    expect(dirtyTreeRefuses(mod, "control"), "shipped: a dirty tree refuses").toBe(true);

    const { foreign } = await makeForeignPair("control", 4);
    expect(
      mod.evaluateSkipDelta(foreign, 9).outcome,
      "shipped: a foreign store refuses",
    ).toBe("incomparable");
  });

  test("MUTATION 1: the clean-tree clause stubbed to always-clean turns AC.2 RED", async () => {
    const mutant = await loadMutant(
      "always-clean",
      "clean-tree clause (`offendingPaths`)",
      "function offendingPaths(",
      [
        "function offendingPaths(projectRoot: string): readonly string[] {",
        "  void projectRoot;",
        "  return [];",
        "}",
      ],
    );

    // The clause that changed is named in the message, so a green here reads as
    // "the pin does not depend on the clean-tree check" rather than as noise.
    expect(
      dirtyTreeRefuses(mutant, "always-clean"),
      "with the clean-tree clause (`offendingPaths`) stubbed to always-clean, " +
        "capture accepts a dirty tree — AC-STE-527.2's assertion must go RED here",
    ).toBe(false);
  });

  test("MUTATION 2: the inverted checkout comparison turns AC.3 RED", async () => {
    const mutant = await loadMutant(
      "inverted-checkout",
      "checkout-id comparison (`sameCheckout`)",
      "function sameCheckout(",
      [
        "function sameCheckout(a: string, b: string): boolean {",
        "  return a !== b;",
        "}",
      ],
    );

    const { home, foreign } = await makeForeignPair("inverted", 4);

    expect(
      mutant.evaluateSkipDelta(foreign, 9).outcome,
      "with the checkout-id comparison (`sameCheckout`) inverted, a FOREIGN store " +
        "grades this run — AC-STE-527.3's assertion must go RED here",
    ).not.toBe("incomparable");

    // The same inversion refuses the store this checkout wrote itself, which is
    // the other half of the same clause.
    expect(
      mutant.evaluateSkipDelta(home, 4).outcome,
      "and the checkout's OWN store stops comparing",
    ).toBe("incomparable");
  });
});

// ===========================================================================
// AC-STE-527.9 — the envelope read path is non-vacuous in both directions.
// ===========================================================================

/** A version this build cannot know, derived from the one it just wrote. */
function unknownVersionFrom(known: unknown): unknown {
  if (typeof known === "number") return known + 1000;
  return `${String(known)}-from-the-future`;
}

interface UnknownVersionFixture {
  readonly root: string;
  readonly restore: () => void;
}

async function writeUnknownVersion(label: string): Promise<UnknownVersionFixture> {
  const mod = await loadSkipBaseline();
  const paths = await loadDptPaths();
  const { root, trunkSha } = makeTrunkRepo(`unknown-${label}`);

  mod.captureSkipBaseline(root, trunkSha, 4);

  const file = paths.skipBaselinePath(root);
  const known = read(file);
  const store = JSON.parse(known) as Record<string, unknown>;
  store.version = unknownVersionFrom(store.version);
  writeFileSync(file, `${JSON.stringify(store, null, 2)}\n`);

  return { root, restore: () => writeFileSync(file, known) };
}

describe("AC-STE-527.9 — absent is empty, unknown is incomparable", () => {
  test("an absent file yields no baselines and no crash", async () => {
    const mod = await loadSkipBaseline();
    const paths = await loadDptPaths();
    const { root } = makeTrunkRepo("absent");

    expect(existsSync(paths.skipBaselinePath(root))).toBe(false);

    expect(() => mod.readSkipBaseline(root)).not.toThrow();
    expect(mod.readSkipBaseline(root).status).toBe("absent");

    const verdict = mod.evaluateSkipDelta(root, 5);
    expect(verdict.outcome).toBe("unmeasured");
    expect(verdict.baseline).toBeNull();
    expect(verdict.delta).toBeNull();
  });

  test("a KNOWN version reads back — the other direction, so the leg is not vacuous", async () => {
    const mod = await loadSkipBaseline();
    const fixture = await writeUnknownVersion("both-ways");

    expect(mod.readSkipBaseline(fixture.root).status).toBe("incomparable");

    fixture.restore();
    const back = mod.readSkipBaseline(fixture.root);
    expect(back.status, "the version this build wrote is the version it reads").toBe("ok");
    expect(back.record?.skipped).toBe(4);
    expect(mod.evaluateSkipDelta(fixture.root, 4).outcome).toBe("pass");
  });

  test("an unknown version is incomparable, never a silently empty store", async () => {
    const mod = await loadSkipBaseline();
    const fixture = await writeUnknownVersion("refuse");

    const verdict = mod.evaluateSkipDelta(fixture.root, 7);
    expect(
      verdict.outcome,
      "reading a newer store as `no baseline` silently downgrades a stricter one",
    ).toBe("incomparable");
    expect(verdict.outcome).not.toBe("unmeasured");
    expect(verdict.delta).toBeNull();
    expect(mod.isCleanPass(verdict)).toBe(false);
  });
});

// ===========================================================================
// The cause vocabulary — STE-530's invariants, and the THIRD cause bound the
// same way the first two are.
//
// The spellings are DISCOVERED, never assumed: the unknown-version cause is
// read off a verdict the module itself produced, and the foreign-checkout cause
// off another. The FR picks the words; this file reads them.
// ===========================================================================

const KNOWN_VERDICT_FIELDS = ["outcome", "baseline", "current", "delta"];


/** The one backticked command in a refusal line, or `null`. */
function extractCommand(line: string): string | null {
  const spans = [...line.matchAll(/`([^`\n]+)`/g)].map((hit) => hit[1] as string);
  return spans.length === 1 ? (spans[0] as string) : null;
}

function renderCause(mod: SkipBaselineModule, field: string, cause: string | null): string {
  const verdict = {
    outcome: "incomparable",
    baseline: null,
    current: 5,
    delta: null,
    ...(cause === null ? {} : { [field]: cause }),
  } as unknown as SkipVerdictShape;
  return mod.renderSkipVerdict(verdict);
}

describe("the third incomparable cause is bound, not inherited", () => {
  test("the unknown-version verdict carries its own cause, from the shipped vocabulary", async () => {
    const mod = await loadSkipBaseline();
    const field = discoverCauseField(SKIP_BASELINE_FILE);
    const causes = discoverCauses(mod);

    const unknown = await writeUnknownVersion("cause");
    const unknownCause = mod.evaluateSkipDelta(unknown.root, 7)[field];
    expect(typeof unknownCause, "an unknown store version names WHY it cannot compare").toBe(
      "string",
    );
    expect(causes, "and the cause is a declared member, not an ad-hoc string").toContain(
      unknownCause as string,
    );

    const { foreign } = await makeForeignPair("cause", 4);
    const foreignCause = mod.evaluateSkipDelta(foreign, 9)[field];
    expect(causes).toContain(foreignCause as string);

    expect(
      unknownCause,
      "an unknown version is a THIRD ground, not the foreign-checkout one",
    ).not.toBe(foreignCause);
  });

  test("every cause renders its own line — none falls onto the default arm", async () => {
    const mod = await loadSkipBaseline();
    const field = discoverCauseField(SKIP_BASELINE_FILE);
    const causes = discoverCauses(mod);

    // A verdict carrying NO cause is what the `default:` arm renders. A cause
    // that renders identically to it has inherited a remedy rather than been
    // given one — for the unknown-version cause, the inherited "re-measure
    // here" is actively wrong.
    const fallback = renderCause(mod, field, null);
    const lines = causes.map((cause) => renderCause(mod, field, cause));

    for (const [index, line] of lines.entries()) {
      expect(
        line,
        `the cause "${causes[index] as string}" renders the unstated-reason line — ` +
          "it fell through to the renderer's default arm",
      ).not.toBe(fallback);
    }

    expect(
      new Set(lines).size,
      `causes collapsed onto one line: ${lines.join(" | ")}`,
    ).toBe(lines.length);
  });

  test("the causes carry pairwise distinct commands — one remedy cannot serve three", async () => {
    const mod = await loadSkipBaseline();
    const field = discoverCauseField(SKIP_BASELINE_FILE);
    const causes = discoverCauses(mod);

    const commands = causes.map((cause) => {
      const line = renderCause(mod, field, cause);
      const command = extractCommand(line);
      expect(
        command,
        `the "${cause}" line carries no single backticked command: ${JSON.stringify(line)}`,
      ).not.toBeNull();
      return command as string;
    });

    expect(
      new Set(commands).size,
      `a shared remedy is right about one cause and wrong about the others: ` +
        `${commands.join(" | ")}`,
    ).toBe(commands.length);
  });
});

// ===========================================================================
// AC-STE-527.9 (audit) — the unknown-version remedy is EXECUTABLE, not merely
// present.
//
// WHAT THE REFACTOR PASS FOUND. AC.9's third cause ends on a command naming
// `adapters/_shared/src/migrate_skip_baseline.ts`, and that module was
// referenced by NO test anywhere in the repository — it had neither an
// execution leg nor an "it exists" leg. Its sibling `capture_skip_baseline.ts`
// has both. So the milestone whose whole purpose is to stop shipping refusals
// that end on unverified commands was itself shipping one.
//
// HOW IT IS CLOSED HERE. The command is EXTRACTED from the line the reader
// really meets and RUN with nothing between extraction and execution, against a
// project holding the real v1 store, and the verdict is read back OFF DISK —
// never off the exit code, because a migration that reports success while
// writing nothing is exactly the failure this milestone is about. A third leg
// kills the WRONG-PATH class: a mutant whose module path is corrupted still
// satisfies a naive substring match on the shipped module name, and must still
// fail execution and leave the store untouched.
// ===========================================================================

/** A trunk project whose store is the real v1 file measured at 9b420ec. */
async function makeV1Project(label: string): Promise<{ root: string; storePath: string }> {
  const paths = await loadDptPaths();
  const { root } = makeTrunkRepo(`v1-remedy-${label}`);

  mkdirSync(dptRoot(root), { recursive: true });
  const storePath = paths.skipBaselinePath(root);
  writeFileSync(storePath, `${JSON.stringify(V1_STORE_ON_DISK, null, 2)}\n`);

  return { root, storePath };
}

/**
 * The line a reader standing in `root` really meets — produced by the shipped
 * classifier from a real store on disk, not composed here from a cause literal.
 */
async function unknownVersionLine(root: string, current: number): Promise<string> {
  const mod = await loadSkipBaseline();
  const field = discoverCauseField(SKIP_BASELINE_FILE);

  const verdict = mod.evaluateSkipDelta(root, current);
  expect(
    verdict.outcome,
    "fixture check: a v1 store standing on disk is INCOMPARABLE, not unmeasured",
  ).toBe("incomparable");
  expect(
    discoverCauses(mod),
    "fixture check: the cause is a declared member of the vocabulary",
  ).toContain(verdict[field] as string);

  return mod.renderSkipVerdict(verdict);
}

/**
 * The quoted MODULE path inside a remedy command.
 *
 * Selected by being the `.ts` operand, not by being the only quoted span. It
 * used to be the only one — because the project root was interpolated bare,
 * which was a real defect: a root containing a space produced a remedy that
 * broke both for a human pasting it and for the harnesses that execute it.
 * Quoting the root fixed that and gave the command a second quoted span, so a
 * helper that meant "the module" while asserting "the only one" started
 * failing. It now says what it means.
 */
function moduleOf(command: string): string {
  const quoted = [...command.matchAll(/"([^"\n]+)"/g)].map((hit) => hit[1] as string);
  const modules = quoted.filter((span) => span.endsWith(".ts"));
  expect(
    modules,
    `the remedy command names no single quoted module path: ${JSON.stringify(command)}`,
  ).toHaveLength(1);
  return modules[0] as string;
}

describe("AC-STE-527.9 (audit) — the migrate remedy is executable", () => {
  test("running the unknown-version line's command migrates the store on disk", async () => {
    const { root, storePath } = await makeV1Project("run");
    const line = await unknownVersionLine(root, 7);

    const command = extractCommand(line);
    expect(
      command,
      `the unknown-version line carries no single backticked command: ${JSON.stringify(line)}`,
    ).not.toBeNull();

    // NOTHING between extraction and execution. The bytes the reader would
    // paste are the bytes that run.
    const proc = Bun.spawnSync(["/bin/sh", "-c", command as string], {
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = proc.stdout.toString();
    const noise = `${stdout}\n${proc.stderr.toString()}`.trim().slice(0, 800);

    // THE EFFECT ON DISK, read back. An exit code is a claim; the file is the
    // fact.
    const after = read(storePath);
    for (const key of V1_KEYS) {
      expect(
        after,
        `${key} survived the migration the remedy ordered\n${noise}`,
      ).not.toContain(key);
    }

    const store = JSON.parse(after) as Record<string, unknown>;
    expect(store.version, `the remedy left no v2 envelope behind\n${noise}`).toBeDefined();
    expect(typeof store.checkoutId, "the migrated envelope names its checkout").toBe("string");
    expect(
      Object.keys(store.baselines as Record<string, unknown>),
      "the v1 counts must not be re-keyed behind sha-shaped keys",
    ).toEqual([]);

    expect(proc.exitCode, `the remedy exited ${proc.exitCode}\n${noise}`).toBe(0);

    // It NAMES what it dropped — a silent drop is the defect AC.6 refuses, and
    // the reason the remedy is a migration rather than a re-capture.
    for (const key of V1_KEYS) {
      expect(stdout, `${key} was dropped without being named\n${noise}`).toContain(key);
    }

    // And the refusal that ordered the remedy is actually cleared by it.
    const mod = await loadSkipBaseline();
    expect(
      mod.evaluateSkipDelta(root, 7).outcome,
      "the remedy ran and the store still cannot be read",
    ).not.toBe("incomparable");
  });

  test("the migration entry point the remedy names really exists", async () => {
    // Named separately so a failure says WHICH half is missing: the remedy has
    // no command, or the command points at nothing.
    const { root } = await makeV1Project("exists");
    const line = await unknownVersionLine(root, 3);

    const command = extractCommand(line);
    expect(command, `no command in ${JSON.stringify(line)}`).not.toBeNull();

    const entry = moduleOf(command as string);
    expect(existsSync(entry), `${entry} is what the remedy runs, and it is not there`).toBe(true);
    expect(read(entry), `${entry} carries no command-line front door`).toContain(
      "import.meta.main",
    );
  });

  test("MUTATION: a corrupted module path passes a substring match and fails execution", async () => {
    const { root, storePath } = await makeV1Project("wrong-path");
    const line = await unknownVersionLine(root, 3);

    const command = extractCommand(line);
    expect(command, `no command in ${JSON.stringify(line)}`).not.toBeNull();

    const entry = moduleOf(command as string);
    const wrong = `${entry}-nope-does-not-exist`;

    const start = line.indexOf(`\`${command as string}\``);
    expect(start, "the extracted command is not sited in the line it came from").toBeGreaterThan(
      -1,
    );
    const mutantLine = mutateInRegion(
      line,
      start,
      start + (command as string).length + 2,
      entry,
      wrong,
      { label: "the module path of the unknown-version remedy" },
    );

    // THE MUTATION APPLIED — the clause it changed is named, and a mutation
    // that silently missed is distinguishable from a pin that works.
    expect(mutantLine).not.toBe(line);
    const mutant = extractCommand(mutantLine);
    expect(mutant, `the mutant line lost its single command: ${mutantLine}`).not.toBeNull();
    expect(mutant as string, "the mutation did not land on the module path").toContain(wrong);

    // THE WHOLE POINT: a naive substring match cannot tell the two apart — the
    // corrupted path still CONTAINS the shipped module path in full.
    expect(
      mutant as string,
      "a substring match on the shipped module path still passes on the mutant",
    ).toContain(entry);

    const before = read(storePath);
    const proc = Bun.spawnSync(["/bin/sh", "-c", mutant as string], {
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
    });
    const noise = `${proc.stdout.toString()}\n${proc.stderr.toString()}`.trim().slice(0, 400);

    expect(proc.exitCode, `the wrong-path mutant was accepted\n${noise}`).not.toBe(0);
    expect(read(storePath), `the wrong-path mutant moved the store\n${noise}`).toBe(before);
  });
});

// ===========================================================================
// The re-keyed lookup no longer takes a branch — and the shipped consumer's
// gate still demands one.
//
// `evaluateSkipDelta(projectRoot, current)` lost its branch parameter when this
// FR re-keyed the store to the trunk commit. `deliver_stage_evidence.ts` still
// gates the lookup on `input.projectRoot !== undefined && input.branch !==
// undefined`, so a caller that hands over a root but no branch falls onto the
// "no project root and branch were supplied" arm and never reads a store it
// could have read perfectly well. The condition outlived the parameter it was
// guarding, and the cost is a REAL baseline reported as unmeasured.
//
// NOT the same case as AC-STE-530.2's no-root leg, which omits BOTH and must
// keep reporting that arm. This one is root-present, branch-absent, and the
// CONTROL below keeps the two distinguishable from inside this file.
// ===========================================================================

/** A real-shaped bun run: 14 tests, 12 passing, 2 skipped, 0 failing. */
const BRANCHLESS_GATE_OUTPUT = [
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
  renderStageEvidence(input: Record<string, unknown>): RenderedEvidenceShape;
}

async function loadEvidence(): Promise<EvidenceModule> {
  return (await import(
    "../adapters/_shared/src/deliver_stage_evidence"
  )) as unknown as EvidenceModule;
}

const branchlessGateCapture = (): Record<string, unknown> => ({
  gate: { command: "bun test", output: BRANCHLESS_GATE_OUTPUT, stack: "bun" },
  required: ["gate"],
});

describe("the evidence consumer reads a baseline a branch is no longer needed for", () => {
  test("a projectRoot with NO branch still reports the measured verdict", async () => {
    const mod = await loadSkipBaseline();
    const { root, trunkSha } = makeTrunkRepo("branchless-evidence");

    mod.captureSkipBaseline(root, trunkSha, 5);
    cutBranch(root, "feat/m136-branchless");

    // Fixture check, made through the shipped lookup itself: this store IS
    // readable with no branch in hand, so anything unmeasured downstream is
    // the consumer's gate, not the store.
    const direct = mod.evaluateSkipDelta(root, 2);
    expect(direct.baseline, "fixture check: the baseline resolves without a branch").toBe(5);
    expect(direct.delta).toBe(-3);
    expect(direct.outcome).toBe("pass");

    const shipped = await loadEvidence();
    const result = shipped.renderStageEvidence({
      ...branchlessGateCapture(),
      projectRoot: root,
      // No `branch` — the parameter `evaluateSkipDelta` no longer takes.
    });

    const gate = result.counts.gate as EvidenceCountsShape;
    expect(gate, "the gate section produced no counts at all").not.toBeNull();
    expect(gate.skip, "fixture check: the capture really carries two skips").toBe(2);

    expect(
      gate.baseline,
      "the branchless lookup was never made — a real baseline reported as absent",
    ).toBe(5);
    expect(gate.delta, "a measured delta, never a silent null").toBe(-3);
    expect(result.lines.join("\n"), "the rendered line says `baseline unmeasured`").toContain(
      "baseline 5, delta -3",
    );

    for (const reason of result.reasons) {
      expect(
        reason,
        "the consumer took the no-root arm with a root in hand",
      ).not.toContain("no project root and branch were supplied");
    }

    // Reword-proof: `ok` derives from `reasons`, so an empty reason set is the
    // assertion that survives any rephrasing of the arm above.
    expect(
      result.reasons,
      `a measured, falling skip count is a pass: ${JSON.stringify(result.reasons)}`,
    ).toEqual([]);
    expect(result.ok).toBe(true);
  });

  test("CONTROL: omitting the root as well still refuses as unmeasured", async () => {
    // The sibling case, kept alive from inside this file so the fix above
    // cannot be made by deleting the no-root arm outright. Matched loosely on
    // purpose — AC-STE-530.2 owns the byte-wise pin on its wording.
    const shipped = await loadEvidence();
    const result = shipped.renderStageEvidence(branchlessGateCapture());

    const gate = result.counts.gate as EvidenceCountsShape;
    expect(gate.baseline, "there was nothing to look a baseline up with").toBeNull();
    expect(gate.delta).toBeNull();
    expect(result.ok, "an unmeasured required gate is a refusal ground").toBe(false);
    expect(
      result.reasons.join("\n"),
      "the no-root refusal must still name why it could not measure",
    ).toMatch(/no project root/i);
  });
});

// ===========================================================================
// Teardown — nothing this file created outlives the run.
// ===========================================================================

describe("housekeeping", () => {
  test("temporary trees are removed", () => {
    cleanupTempDirs();
    expect(TEMP_DIRS.length).toBe(0);
  });
});
