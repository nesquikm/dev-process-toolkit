// M127 STE-487 — Phase 9 artifacts must carry the tracker segment and stay out
// of the toolkit repo.
//
// ===========================================================================
// THE MEASURED EVIDENCE — an A/B control INSIDE ONE RUN
// ===========================================================================
//
// The 2026-08-16 conformance run fired all three legs concurrently (the
// documented-safe parallel mode). Its preserved teardown listing shows:
//
//   tests/fixtures/nested-spawn/     ← group 8a, path carries <tracker>
//       8a-none-2026-08-16.log     20:26
//       8a-jira-2026-08-16.log     20:38
//       8a-linear-2026-08-16.log   21:37     ⇒ ALL THREE RUNS SURVIVED
//
//   tests/fixtures/capability-rows/  ← Phase 9, path carries NO <tracker>
//       branch-off-trunk-2026-08-16.log   22:21
//       branch-on-main-2026-08-16.log     22:21
//       draft-commit-2026-08-16.log       22:21
//       research-fresh-2026-08-16.log     22:21
//       research-seeded-2026-08-16.log    22:21 ⇒ ONE SET. 22:21 is the
//                                                 finishing time of whichever
//                                                 leg wrote LAST. Two legs'
//                                                 evidence was destroyed.
//
// The only difference between the surviving three and the destroyed two is the
// `<tracker>` segment. This is measurement, not inference.
//
// TWO FURTHER FACTS FROM THE SAME LISTING:
//
//   * The convention already EXISTED and Phase 9 regressed from it — the same
//     directory's committed files from the previous run are
//     `spec-write-jira-2026-07-27.log` / `spec-write-linear-2026-07-27.log`.
//   * The write target is the TOOLKIT repo, not the guarded test project.
//     Eight artifacts landed untracked with `git check-ignore` returning no
//     match — ~2 MB of committable junk that would trip the NEXT run's own
//     pre-flight #4 (*Uncommitted changes in the toolkit repo*).
//
// ===========================================================================
// WHY STE-423's EXISTING SCAN DID NOT CATCH THIS
// ===========================================================================
//
// `m116-ste-423-tracker-scoped-artifacts.test.ts` scans for the literal prefix
// `dpt-smoke-` and requires a tracker segment on each hit. Phase 9's persist
// path is `tests/fixtures/capability-rows/<fixture-name>-<YYYY-MM-DD>.log` —
// it carries no `dpt-smoke-` prefix at all, so the scan never looked at it.
// STE-423's CLAIM was "every path a leg writes, globs, or reaps carries the
// segment". The claim was asserted, not enforced, and Phase 9 falsified it.
//
// AC-STE-487.3 therefore demands ENFORCEMENT, not restatement: an enumerator
// over BOTH harness SKILLs that finds the repo-fixture path classes too, and a
// mutation proving it goes red when a segment is taken away.
//
// ===========================================================================
// THE SHAPE THE IMPLEMENTER MUST BUILD
// ===========================================================================
//
//  A. adapters/_shared/src/harness_artifact_paths.ts — NEW. Exports:
//
//       HARNESS_SKILL_RELATIVE_PATHS: readonly string[]
//           exactly the two harness SKILLs, repo-root-relative:
//           `.claude/skills/smoke-test/SKILL.md` and
//           `.claude/skills/conformance-loop/SKILL.md`.
//
//       PHASE9_FIXTURE_NAMES: readonly string[]
//           the five Phase 9 lenient-assertion fixtures, exactly:
//           draft-commit, branch-on-main, branch-off-trunk,
//           research-seeded, research-fresh.
//
//       PHASE9_ARTIFACT_DIR: string
//           ABSOLUTE directory the Phase 9 captures land in.
//
//       phase9ArtifactPath(fixture, tracker, date): string
//           ABSOLUTE path for one capture. MUST carry the resolved tracker as
//           its own `/`- or `-`-delimited segment.
//
//       interface ArtifactPathRef { path: string; line: number; scoped: boolean }
//       enumeratePerRunArtifactPaths(skillBody: string): readonly ArtifactPathRef[]
//           every per-run ARTIFACT FILE path literal in a harness SKILL body.
//           A bare directory pathspec (trailing `/`, no filename) is NOT a
//           per-run artifact path and is not enumerated.
//
//       unscopedArtifactPaths(skillBody: string): readonly ArtifactPathRef[]
//           the offenders — enumerated paths with no tracker/leg segment,
//           minus GLOBAL_ARTIFACT_ALLOWLIST.
//
//       GLOBAL_ARTIFACT_ALLOWLIST: readonly string[]
//           genuinely-global literals (the singleton loop driver's own
//           aggregate report, the audit-trail preserve directives, …). Every
//           entry is a HOLE in the invariant, so the list is capped and every
//           entry must still be live in one of the two SKILLs.
//
//     …plus a CLI. No args ⇒ scan both harness SKILLs; one or more path args ⇒
//     scan exactly those files. One verdict line on stdout:
//         artifact-paths: ok scanned=<N> unscoped=0
//         artifact-paths: FAIL scanned=<N> unscoped=<M>
//     Exit 0 iff unscoped=0. It signals through its EXIT CODE — the verdict
//     line reads as one line either way, which is why AC-STE-487.5's harness
//     clause must score `exit-code` (the STE-485 lesson).
//
//  B. `.claude/skills/smoke-test/SKILL.md` § Phase 9 — the persist path gains
//     the `<tracker>` segment, and the write target stops dirtying the toolkit
//     tree (outside the repo, or a committed ignore rule that does NOT swallow
//     the six committed fixtures).
//
//  C. `adapters/_shared/src/falsifiability_harness.ts` — an `STE-487` row in
//     `M127_REPAIRS`, every clause `scoreBy: "exit-code"`.
//
// *** THE SIX COMMITTED FIXTURES ARE UNTOUCHABLE (AC-STE-487.4). *** They are
// read from git at HEAD below rather than hard-coded, and the count is pinned
// at 6 so a silent addition cannot pass either.

import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

// The new module is imported through a guarded dynamic import ON PURPOSE. A
// bare `import` of a file that does not exist yet takes the WHOLE suite down
// with one module-resolution error, and a single error is not a per-AC RED —
// it says nothing about which assertions hold. This way every test below fails
// on its own terms, and the implementer reads a list of ACs rather than a
// stack trace.
interface ArtifactPathRef {
  readonly path: string;
  readonly line: number;
  readonly scoped: boolean;
}

interface HarnessArtifactPaths {
  readonly GLOBAL_ARTIFACT_ALLOWLIST: readonly string[];
  readonly HARNESS_SKILL_RELATIVE_PATHS: readonly string[];
  readonly PHASE9_ARTIFACT_DIR: string;
  readonly PHASE9_FIXTURE_NAMES: readonly string[];
  enumeratePerRunArtifactPaths(skillBody: string): readonly ArtifactPathRef[];
  phase9ArtifactPath(fixture: string, tracker: string, date: string): string;
  unscopedArtifactPaths(skillBody: string): readonly ArtifactPathRef[];
}

const HAP_MODULE = "../adapters/_shared/src/harness_artifact_paths";

let loaded: HarnessArtifactPaths | null = null;
let loadError: unknown = null;
try {
  loaded = (await import(HAP_MODULE)) as unknown as HarnessArtifactPaths;
} catch (err) {
  loadError = err;
}

/** The module under test, or a loud failure naming what is missing. */
function hap(): HarnessArtifactPaths {
  if (loaded === null) {
    throw new Error(
      `AC-STE-487.3: ${HAP_MODULE} does not load — ${String(loadError)}`,
    );
  }
  return loaded;
}

const GLOBAL_ARTIFACT_ALLOWLIST = () => hap().GLOBAL_ARTIFACT_ALLOWLIST;
const HARNESS_SKILL_RELATIVE_PATHS = () => hap().HARNESS_SKILL_RELATIVE_PATHS;
const PHASE9_ARTIFACT_DIR = () => hap().PHASE9_ARTIFACT_DIR;
const PHASE9_FIXTURE_NAMES = () => hap().PHASE9_FIXTURE_NAMES;
const enumeratePerRunArtifactPaths = (b: string) => hap().enumeratePerRunArtifactPaths(b);
const phase9ArtifactPath = (f: string, t: string, d: string) =>
  hap().phase9ArtifactPath(f, t, d);
const unscopedArtifactPaths = (b: string) => hap().unscopedArtifactPaths(b);

import {
  M127_REPAIRS,
  M127_REPAIR_ROSTER,
  SMOKE_SKILL_RELATIVE_PATH,
  checkRepairClauses,
  harnessOutcomeFor,
  resolveCapturePath,
  uncoveredRepairs,
  type RepairEntry,
} from "../adapters/_shared/src/falsifiability_harness";

// ───────────────────────────── fixed anchors ──────────────────────────────

const repoRoot = join(import.meta.dir, "..", "..", "..");
const pluginRoot = join(import.meta.dir, "..");
const smokeSkillPath = join(repoRoot, SMOKE_SKILL_RELATIVE_PATH);
const loopSkillPath = join(repoRoot, ".claude", "skills", "conformance-loop", "SKILL.md");

/** The three registered legs. The measured collision was between all three. */
const LEGS = ["linear", "jira", "none"] as const;

/** The calendar day of the measured collision. */
const COLLISION_DATE = "2026-08-16";

/** The five Phase 9 lenient-assertion fixtures, from the SKILL's own § Phase 9. */
const EXPECTED_PHASE9_FIXTURES = [
  "draft-commit",
  "branch-on-main",
  "branch-off-trunk",
  "research-seeded",
  "research-fresh",
].sort();

/** `tests/fixtures/capability-rows/`, repo-root-relative. */
const CAPABILITY_ROWS_REL =
  "plugins/dev-process-toolkit/tests/fixtures/capability-rows";

const smokeSkill = readFileSync(smokeSkillPath, "utf8");
const loopSkill = readFileSync(loopSkillPath, "utf8");

function git(args: string[]): string {
  return execFileSync("git", ["-C", repoRoot, ...args], { encoding: "utf8" });
}

/** Markdown section from a heading matching `pred` to the next equal-or-shallower one. */
/**
 * Slice a section, SKIPPING fenced blocks.
 *
 * Fence-awareness is not a nicety here. A bash fence in these SKILLs routinely
 * opens with a `# …` comment, and a naive `^#{1,6} ` stop matches it — which
 * truncates the section at the first comment and makes every downstream
 * `includes(…)` read FALSE because the text was never reached, not because it
 * is absent. That is a test passing for a reason its assertion does not check,
 * and this milestone has now hit it twice (§ Sub-fixture 10a truncated at 351
 * bytes by `# Group 10 sampler`; § Closing artifact accounting truncated at
 * 1361 bytes by `# One pathspec per artifact class`).
 */
function sectionByHeading(body: string, pred: (line: string) => boolean): string {
  const lines = body.split("\n");
  const fence = /^\s*(```|~~~)/;
  const start = lines.findIndex((l) => /^#{1,6} /.test(l) && pred(l));
  if (start < 0) return "";
  const depth = (lines[start] as string).match(/^#+/)![0].length;
  const stop = new RegExp(`^#{1,${depth}} `);
  let inFence = false;
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i] as string;
    if (fence.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (!inFence && stop.test(line)) return lines.slice(start, i).join("\n");
  }
  return lines.slice(start).join("\n");
}

const phase9Section = () =>
  sectionByHeading(smokeSkill, (l) => /^### Phase 9\b/.test(l));

/** `leg` present as its own `/`- or `-`-delimited segment of `path`. */
function carriesSegment(path: string, leg: string): boolean {
  return new RegExp(String.raw`(^|[/\-._])${leg}([/\-._]|$)`).test(path);
}

const tempDirs: string[] = [];
const leakedFiles: string[] = [];
const leakedDirs: string[] = [];

function scratch(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterAll(() => {
  // Order matters: files this suite wrote INTO the real repo go first, then
  // any directory it had to create for them, then the scratch roots.
  for (const f of leakedFiles) {
    try {
      rmSync(f, { force: true });
    } catch {
      /* best effort */
    }
  }
  for (const d of [...leakedDirs].reverse()) {
    try {
      rmSync(d, { recursive: false, force: true });
    } catch {
      /* non-empty ⇒ not ours to remove */
    }
  }
  for (const d of tempDirs) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
});

// ══════════════════════════════════════════════════════════════════════════
// AC-STE-487.1 — every Phase 9 artifact path carries the resolved <tracker>;
//                three concurrent runs on one date produce three DISJOINT
//                file sets with none overwritten.
// ══════════════════════════════════════════════════════════════════════════

describe("AC-STE-487.1 — Phase 9 artifact paths are tracker-keyed and collision-free", () => {
  test("the five Phase 9 fixture names are exported and match § Phase 9's roster", () => {
    expect([...PHASE9_FIXTURE_NAMES()].sort()).toEqual(EXPECTED_PHASE9_FIXTURES);
    const section = phase9Section();
    expect(section.length).toBeGreaterThan(500); // the anchor still resolves
    for (const name of PHASE9_FIXTURE_NAMES()) {
      expect(section).toContain(name);
    }
  });

  test("every resolved Phase 9 path carries its leg as its own path segment", () => {
    for (const leg of LEGS) {
      for (const fixture of PHASE9_FIXTURE_NAMES()) {
        const p = phase9ArtifactPath(fixture, leg, COLLISION_DATE);
        expect(carriesSegment(p, leg)).toBe(true);
        expect(p).toContain(fixture);
        expect(p).toContain(COLLISION_DATE);
      }
    }
  });

  test("three legs × five fixtures on ONE date resolve to 15 distinct paths", () => {
    const all = LEGS.flatMap((leg) =>
      PHASE9_FIXTURE_NAMES().map((f) => phase9ArtifactPath(f, leg, COLLISION_DATE)),
    );
    expect(all.length).toBe(15);
    expect(new Set(all).size).toBe(15);
  });

  test("the three legs' path SETS are pairwise disjoint", () => {
    const sets = LEGS.map(
      (leg) =>
        new Set(
          PHASE9_FIXTURE_NAMES().map((f) => phase9ArtifactPath(f, leg, COLLISION_DATE)),
        ),
    );
    for (let i = 0; i < sets.length; i += 1) {
      for (let j = i + 1; j < sets.length; j += 1) {
        const overlap = [...(sets[i] as Set<string>)].filter((p) =>
          (sets[j] as Set<string>).has(p),
        );
        expect(overlap).toEqual([]);
      }
    }
  });

  test("a real three-leg concurrent write on one date leaves all 15 files intact", () => {
    // Non-vacuity by construction: real files on a real filesystem, written
    // through the module's OWN resolved paths remapped onto a sandbox root.
    // A design that separates legs by directory passes this exactly as a
    // design that separates them by filename does.
    const root = scratch("ste487-tandem-");
    const written: Array<{ path: string; body: string }> = [];

    for (const leg of LEGS) {
      for (const fixture of PHASE9_FIXTURE_NAMES()) {
        const real = phase9ArtifactPath(fixture, leg, COLLISION_DATE);
        const rel = relative(PHASE9_ARTIFACT_DIR(), real);
        expect(rel.startsWith("..")).toBe(false); // resolver stays under its dir
        const target = join(root, rel);
        mkdirSync(dirname(target), { recursive: true });
        const body = `${leg}/${fixture}\n`;
        writeFileSync(target, body, "utf8");
        written.push({ path: target, body });
      }
    }

    expect(written.length).toBe(15);
    for (const { path, body } of written) {
      expect(existsSync(path)).toBe(true);
      // The whole point: nothing was overwritten by a later leg.
      expect(readFileSync(path, "utf8")).toBe(body);
    }
  });

  test("CONTROL — the pre-fix date-only shape destroys two legs' evidence", () => {
    // This is the measured 2026-08-16 outcome reproduced. If this control does
    // not show the loss, the test above proves nothing about the segment.
    // Deliberately module-INDEPENDENT: it uses the five fixture names spelled
    // out above, so it is GREEN today against the shipped naming and stays
    // green after the fix. A control that needed the fix to run would prove
    // nothing about the world before it.
    const root = scratch("ste487-control-");
    for (const leg of LEGS) {
      for (const fixture of EXPECTED_PHASE9_FIXTURES) {
        writeFileSync(
          join(root, `${fixture}-${COLLISION_DATE}.log`),
          `${leg}/${fixture}\n`,
          "utf8",
        );
      }
    }
    const survivors = execFileSync("bash", ["-c", `ls -1 ${root} | wc -l`], {
      encoding: "utf8",
    }).trim();
    expect(Number.parseInt(survivors, 10)).toBe(5); // five, not fifteen
    // Every survivor belongs to whichever leg wrote LAST — exactly the 22:21
    // single-timestamp set the run's teardown listing preserved.
    for (const fixture of EXPECTED_PHASE9_FIXTURES) {
      const body = readFileSync(join(root, `${fixture}-${COLLISION_DATE}.log`), "utf8");
      expect(body).toBe(`none/${fixture}\n`);
    }
  });

  test("§ Phase 9's own persist prose no longer names a segment-less capture path", () => {
    const section = phase9Section();
    // Whatever § Phase 9 persists to, the enumerator must find at least one
    // per-run path there and must find NO offender. `>= 1` is the non-vacuity
    // guard: an enumerator that matches nothing inside the section would
    // otherwise report zero offenders trivially.
    const found = enumeratePerRunArtifactPaths(section);
    expect(found.length).toBeGreaterThanOrEqual(1);
    expect(unscopedArtifactPaths(section).map((r) => r.path)).toEqual([]);

    // The exact literal the run destroyed evidence through.
    expect(section).not.toContain("capability-rows/<fixture-name>-<YYYY-MM-DD>.log");
  });
});

// ══════════════════════════════════════════════════════════════════════════
// AC-STE-487.2 — Phase 9 artifacts do not leave the toolkit working tree
//                dirty: written outside the repository, or covered by a
//                COMMITTED ignore rule.
// ══════════════════════════════════════════════════════════════════════════

describe("AC-STE-487.2 — Phase 9 leaves the toolkit working tree clean", () => {
  /** `path` is inside the toolkit repo. */
  function insideRepo(path: string): boolean {
    const rel = relative(repoRoot, resolve(path));
    return rel !== "" && !rel.startsWith("..") && !rel.startsWith(sep);
  }

  /** `git check-ignore -v --no-index <p>` → the rule's SOURCE file, or null. */
  function ignoreSource(path: string): string | null {
    try {
      const out = execFileSync(
        "git",
        ["-C", repoRoot, "check-ignore", "-v", "--no-index", path],
        { encoding: "utf8" },
      );
      const first = out.split("\n").find((l) => l.trim() !== "");
      return first ? (first.split(":")[0] as string) : null;
    } catch {
      return null; // exit 1 ⇒ no match
    }
  }

  test("every resolved Phase 9 path is outside the repo, or ignored by a TRACKED rule file", () => {
    const tracked = new Set(
      git(["ls-files"])
        .split("\n")
        .filter((l) => l.trim() !== ""),
    );
    for (const leg of LEGS) {
      for (const fixture of PHASE9_FIXTURE_NAMES()) {
        const p = phase9ArtifactPath(fixture, leg, COLLISION_DATE);
        if (!insideRepo(p)) continue;
        const source = ignoreSource(p);
        // A rule in `.git/info/exclude` is the operator's private state and
        // ships to nobody — "covered by a COMMITTED ignore rule" means the
        // rule file is itself tracked.
        expect(source).not.toBeNull();
        const relSource = relative(repoRoot, resolve(repoRoot, source as string));
        expect(tracked.has(relSource)).toBe(true);
      }
    }
  });

  test("the ignore rule does NOT swallow the six committed capability-row fixtures", () => {
    // The STE-425 lesson in the sibling directory: a `*` that crosses a `/`
    // takes the committed evidence with it.
    for (const name of headFixtureNames()) {
      const p = join(repoRoot, CAPABILITY_ROWS_REL, name);
      expect(ignoreSource(p)).toBeNull();
    }
  });

  test("writing all 15 artifacts at their REAL resolved paths adds no dirty rows", () => {
    const before = git(["status", "--porcelain", "-uall"]);

    try {
      for (const leg of LEGS) {
        for (const fixture of PHASE9_FIXTURE_NAMES()) {
          const p = phase9ArtifactPath(fixture, leg, COLLISION_DATE);
          const dir = dirname(p);
          if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
            leakedDirs.push(dir);
          }
          expect(existsSync(p)).toBe(false); // never clobber a real artifact
          writeFileSync(p, "ste487 clean-tree probe\n", "utf8");
          leakedFiles.push(p);
        }
      }

      const after = git(["status", "--porcelain", "-uall"]);
      expect(after).toBe(before);
    } finally {
      for (const f of leakedFiles.splice(0)) rmSync(f, { force: true });
      for (const d of leakedDirs.splice(0).reverse()) {
        try {
          rmSync(d, { recursive: false, force: true });
        } catch {
          /* not empty ⇒ leave it */
        }
      }
    }
  });

  test("the closing artifact accounting still enumerates one pathspec per in-repo class", () => {
    // § Closing artifact accounting is what tells the operator, out loud, what
    // this run left behind. If Phase 9 still writes into the repo, its class
    // must still be named there; if it no longer does, the pathspec is stale.
    const accounting = sectionByHeading(smokeSkill, (l) =>
      /^#{2,6} Closing artifact accounting/.test(l),
    );
    expect(accounting.length).toBeGreaterThan(200);
    // NON-VACUITY: the slice must actually REACH the pathspec fence. Before the
    // fence-aware slicer above, it stopped at the fence's first `# …` comment
    // and every assertion below read false by truncation.
    expect(accounting).toContain("git -C");

    // Phase 9 no longer writes into the repo — but the pathspec STAYS, and the
    // distinction is the whole point of this assertion. The accounting is what
    // tells the operator out loud what a run left behind, so its coverage is
    // the set of directories a run COULD dirty, not the set it happens to dirty
    // today. Dropping the `capability-rows` pathspec because Phase 9 moved would
    // retire the tripwire that catches the next regression back into the repo —
    // and `m117-ste-425` independently requires all three classes by name.
    for (const cls of ["socratic-first-turn", "capability-rows", "nested-spawn"]) {
      expect(accounting).toContain(cls);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════
// AC-STE-487.3 — a CHECK enumerates every per-run artifact path in BOTH
//                harness SKILLs and FAILS on any that omits the segment.
//                Enforcement, not restatement.
// ══════════════════════════════════════════════════════════════════════════

describe("AC-STE-487.3 — the enumerating check covers both harness SKILLs", () => {
  const cliPath = join(
    pluginRoot,
    "adapters",
    "_shared",
    "src",
    "harness_artifact_paths.ts",
  );

  function runCli(args: string[]): { code: number; stdout: string } {
    try {
      const stdout = execFileSync(process.execPath, [cliPath, ...args], {
        encoding: "utf8",
        cwd: repoRoot,
      });
      return { code: 0, stdout };
    } catch (err) {
      const e = err as { status?: number; stdout?: string };
      return { code: e.status ?? -1, stdout: e.stdout ?? "" };
    }
  }

  test("both harness SKILLs are registered, and both files exist", () => {
    expect([...HARNESS_SKILL_RELATIVE_PATHS()].sort()).toEqual(
      [
        ".claude/skills/conformance-loop/SKILL.md",
        ".claude/skills/smoke-test/SKILL.md",
      ].sort(),
    );
    for (const rel of HARNESS_SKILL_RELATIVE_PATHS()) {
      expect(existsSync(join(repoRoot, rel))).toBe(true);
    }
  });

  test("NON-VACUITY — the enumerator finds a substantial path population in each SKILL", () => {
    // An enumerator that matches nothing passes the offender check trivially.
    // These floors are the difference between a gate and a decoration.
    expect(new Set(enumeratePerRunArtifactPaths(smokeSkill).map((r) => r.path)).size)
      .toBeGreaterThanOrEqual(20);
    expect(new Set(enumeratePerRunArtifactPaths(loopSkill).map((r) => r.path)).size)
      .toBeGreaterThanOrEqual(10);
  });

  test("NON-VACUITY — the enumerator reaches the repo-fixture classes, not just /tmp", () => {
    // This is precisely the blind spot that let Phase 9 through: STE-423's scan
    // keyed on the `dpt-smoke-` prefix, and `tests/fixtures/capability-rows/…`
    // carries no such prefix. All three in-repo persist classes must be seen.
    const paths = enumeratePerRunArtifactPaths(smokeSkill).map((r) => r.path);
    expect(paths.some((p) => p.includes("socratic-first-turn"))).toBe(true);
    expect(paths.some((p) => p.includes("nested-spawn"))).toBe(true);
    expect(paths.some((p) => /capability-rows|phase9/.test(p))).toBe(true);
  });

  test("every enumerated ref carries a line number pointing into its own SKILL", () => {
    const lines = smokeSkill.split("\n");
    for (const ref of enumeratePerRunArtifactPaths(smokeSkill)) {
      expect(ref.line).toBeGreaterThan(0);
      expect(ref.line).toBeLessThanOrEqual(lines.length);
      expect(lines[ref.line - 1]).toContain(ref.path);
    }
  });

  test("ZERO unscoped per-run artifact paths survive in either harness SKILL", () => {
    expect(unscopedArtifactPaths(smokeSkill).map((r) => `${r.line}: ${r.path}`)).toEqual([]);
    expect(unscopedArtifactPaths(loopSkill).map((r) => `${r.line}: ${r.path}`)).toEqual([]);
  });

  test("the global allow-list stays small and every entry is still live", () => {
    // Every entry is a permanently-open hole in the invariant. Both halves
    // matter: the cap keeps the exemption surface honest, the liveness check
    // stops a removed path from silently licensing a future unscoped one.
    expect(GLOBAL_ARTIFACT_ALLOWLIST().length).toBeLessThanOrEqual(12);
    for (const entry of GLOBAL_ARTIFACT_ALLOWLIST()) {
      expect(smokeSkill.includes(entry) || loopSkill.includes(entry)).toBe(true);
    }
  });

  test("MUTATION — dropping the segment from a smoke fixture path turns the check red", () => {
    const from = "nested-spawn/8a-<tracker>-<YYYY-MM-DD>.log";
    const to = "nested-spawn/8a-<YYYY-MM-DD>.log";
    expect(smokeSkill).toContain(from); // the mutation genuinely applies
    const mutated = smokeSkill.split(from).join(to);
    expect(mutated).not.toBe(smokeSkill);

    const offenders = unscopedArtifactPaths(mutated).map((r) => r.path);
    expect(offenders.length).toBeGreaterThan(0);
    expect(offenders.some((p) => p.includes("8a-<YYYY-MM-DD>.log"))).toBe(true);
  });

  test("MUTATION — dropping the segment from a /tmp scratch path turns the check red", () => {
    const from = "/tmp/dpt-smoke-<tracker>-<skill>.log";
    const to = "/tmp/dpt-smoke-<skill>.log";
    expect(smokeSkill).toContain(from);
    const mutated = smokeSkill.split(from).join(to);

    const offenders = unscopedArtifactPaths(mutated).map((r) => r.path);
    expect(offenders.some((p) => p === to)).toBe(true);
  });

  test("MUTATION — dropping the leg from a conformance-loop per-leg path turns the check red", () => {
    const from = "/tmp/dpt-conformance-loop-${DATE}-iter-${ITER}-${LEG}.log";
    const to = "/tmp/dpt-conformance-loop-${DATE}-iter-${ITER}.log";
    expect(loopSkill).toContain(from);
    const mutated = loopSkill.split(from).join(to);

    const offenders = unscopedArtifactPaths(mutated).map((r) => r.path);
    expect(offenders.some((p) => p === to)).toBe(true);
  });

  test("the CLI passes on the live SKILLs and prints a countable verdict line", () => {
    const { code, stdout } = runCli([]);
    const line = stdout.split("\n").find((l) => l.startsWith("artifact-paths:"));
    expect(line).toBeDefined();
    expect(line).toMatch(/^artifact-paths: ok scanned=\d+ unscoped=0$/);
    const scanned = Number.parseInt(
      (line as string).match(/scanned=(\d+)/)![1] as string,
      10,
    );
    expect(scanned).toBeGreaterThanOrEqual(30); // both SKILLs, together
    expect(code).toBe(0);
  });

  test("MUTATION — the CLI EXITS NON-ZERO on a mutated copy of either SKILL", () => {
    const root = scratch("ste487-cli-");

    const smokeCopy = join(root, "smoke-SKILL.md");
    writeFileSync(
      smokeCopy,
      smokeSkill
        .split("nested-spawn/8a-<tracker>-<YYYY-MM-DD>.log")
        .join("nested-spawn/8a-<YYYY-MM-DD>.log"),
      "utf8",
    );
    const smokeRun = runCli([smokeCopy]);
    expect(smokeRun.code).not.toBe(0);
    expect(smokeRun.stdout).toMatch(/^artifact-paths: FAIL scanned=\d+ unscoped=[1-9]\d*$/m);

    const loopCopy = join(root, "loop-SKILL.md");
    writeFileSync(
      loopCopy,
      loopSkill
        .split("/tmp/dpt-conformance-loop-${DATE}-iter-${ITER}-${LEG}.log")
        .join("/tmp/dpt-conformance-loop-${DATE}-iter-${ITER}.log"),
      "utf8",
    );
    const loopRun = runCli([loopCopy]);
    expect(loopRun.code).not.toBe(0);
    expect(loopRun.stdout).toMatch(/^artifact-paths: FAIL scanned=\d+ unscoped=[1-9]\d*$/m);

    // …and the UNMUTATED copies of the same files still pass, so the non-zero
    // above is the mutation and not the temp location.
    const cleanSmoke = join(root, "clean-smoke-SKILL.md");
    writeFileSync(cleanSmoke, smokeSkill, "utf8");
    expect(runCli([cleanSmoke]).code).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// AC-STE-487.4 — the six committed fixtures at HEAD are UNTOUCHED.
// ══════════════════════════════════════════════════════════════════════════

/** The tracked capability-row fixture basenames, read from git at HEAD. */
function headFixtureNames(): string[] {
  return git(["ls-tree", "-r", "--name-only", "HEAD", "--", CAPABILITY_ROWS_REL])
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => basename(l))
    .sort();
}

describe("AC-STE-487.4 — the six committed capability-row fixtures are untouched", () => {
  test("HEAD tracks exactly six files there — a silent addition cannot pass", () => {
    // Read from git rather than hard-coded, and COUNT-pinned either way.
    const names = headFixtureNames();
    expect(names.length).toBe(6);
    expect(names).toEqual(
      [
        "carrier-tool-result.log",
        "emitted-then-refusal.log",
        "refusal-prose-only.log",
        "spec-write-jira-2026-07-27.log",
        "spec-write-linear-2026-07-27.log",
        "ste222-probe-jira-2026-07-27.log",
      ].sort(),
    );
  });

  test("the working tree still holds exactly those six, byte-identical to HEAD", () => {
    const diff = git(["diff", "--name-only", "HEAD", "--", CAPABILITY_ROWS_REL]).trim();
    expect(diff).toBe("");
    const untracked = git([
      "status",
      "--porcelain",
      "-uall",
      "--",
      CAPABILITY_ROWS_REL,
    ]).trim();
    expect(untracked).toBe("");
  });

  test("three of the six ALREADY carry a tracker segment — the convention predates the regression", () => {
    const segmented = headFixtureNames().filter((n) =>
      LEGS.some((leg) => carriesSegment(n, leg)),
    );
    expect(segmented.length).toBe(3);
  });

  test("no resolved Phase 9 path can ever land on one of the six", () => {
    const committed = new Set(
      headFixtureNames().map((n) => join(repoRoot, CAPABILITY_ROWS_REL, n)),
    );
    const committedNames = new Set(headFixtureNames());
    for (const leg of LEGS) {
      for (const fixture of PHASE9_FIXTURE_NAMES()) {
        const p = phase9ArtifactPath(fixture, leg, COLLISION_DATE);
        expect(committed.has(p)).toBe(false);
        expect(committedNames.has(basename(p))).toBe(false);
      }
    }
  });

  test("…and the same holds for the 2026-07-27 date the committed fixtures carry", () => {
    // The committed set is itself a previous run's output. A resolver that
    // reproduced those exact names would overwrite the committed evidence the
    // moment a run happened to fall on that date.
    const committedNames = new Set(headFixtureNames());
    for (const leg of LEGS) {
      for (const fixture of PHASE9_FIXTURE_NAMES()) {
        expect(
          committedNames.has(basename(phase9ArtifactPath(fixture, leg, "2026-07-27"))),
        ).toBe(false);
      }
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════
// AC-STE-487.5 — STE-483's harness proves the check fails when the segment is
//                removed from a path.
// ══════════════════════════════════════════════════════════════════════════

describe("AC-STE-487.5 — the falsifiability harness carries an STE-487 row", () => {
  const ste487 = () =>
    M127_REPAIRS.find((e) => e.id === "STE-487") as RepairEntry | undefined;

  test("STE-487 is registered and no longer counted as uncovered", () => {
    expect(M127_REPAIR_ROSTER).toContain("STE-487");
    expect(ste487()).toBeDefined();
    expect(uncoveredRepairs(M127_REPAIRS, M127_REPAIR_ROSTER)).not.toContain("STE-487");
  });

  test("EVERY clause of the row scores by exit code — stdout-count is provably vacuous", () => {
    // The check signals through its exit status and prints a one-line VERDICT.
    // Scored on stdout the verdict reads as 1 line whether the segment was
    // there or not, so every clause would be 1-vs-1 (the STE-485 lesson).
    const entry = ste487() as RepairEntry;
    expect(entry.scoreBy).toBe("exit-code");
    for (const clause of entry.clauses ?? []) {
      expect(clause.scoreBy).toBe("exit-code");
    }
  });

  test("the row's shipped capture exists on disk", () => {
    expect(existsSync(resolveCapturePath(ste487() as RepairEntry))).toBe(true);
  });

  test("extract → bind → run against LIVE SKILL bytes: every clause is falsifiable", () => {
    const results = checkRepairClauses(ste487() as RepairEntry, smokeSkill);
    expect(results.length).toBeGreaterThanOrEqual(1);
    for (const r of results) {
      expect(r.removed).toBeGreaterThan(0); // the mutation genuinely applied
      expect(r.verdict).toBe("falsifiable");
    }
    expect(harnessOutcomeFor(results)).toBe("harness-fails");
  });

  test("the present half really clears the bar and the absent half really does not", () => {
    const entry = ste487() as RepairEntry;
    const thresholds = [entry, ...(entry.clauses ?? [])].map((c) => c.threshold);
    const results = checkRepairClauses(entry, smokeSkill);
    expect(results.length).toBe(thresholds.length);
    results.forEach((r, i) => {
      expect(r.presentCount).toBeGreaterThanOrEqual(thresholds[i] as number);
      expect(r.absentCount).toBeLessThan(thresholds[i] as number);
    });
  });
});
