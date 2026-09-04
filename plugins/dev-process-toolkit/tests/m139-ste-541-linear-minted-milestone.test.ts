// M139 STE-541 — route the Linear branch through the minter and retarget the
// sequential scan.
//
// AC map:
//   AC-STE-541.1 — the dispatcher's `linear` branch delegates to
//                  `mintMilestoneLinear` and returns a milestone id with NO
//                  `id:` key, which probe #73 requires of every tracker-mode
//                  plan.
//   AC-STE-541.2 — `nextFreeMilestoneNumber` keeps a production caller in the
//                  explicitly-typed-identity validation path, and probe #81
//                  reports zero references that are both ordered and
//                  unreachable for that module.
//   AC-STE-541.3 — every shipped instruction ordering the five-way scan for a
//                  NEW Linear milestone is removed or retargeted; the grep
//                  asserting this runs a positive control in the same test so
//                  a zero-hit result is a claim about the search.
//   AC-STE-541.4 — no migration-registry entry ships; /spec-write's Linear
//                  branch emits `linear_milestone_scheme_adopted` at the first
//                  identifier-derived mint in a project still holding
//                  sequential plans.
//   AC-STE-541.5 — the M139 plan declares `migration: none`.
//   AC-STE-541.6 — STE-417 AC.5's "Linear unchanged" regression pin is retired
//                  by name in the M139 plan, and every test asserting Linear
//                  stays on the sequential scan is updated or removed.
//
// WHAT IS NOT RE-TESTED HERE. `mintMilestoneLinear` itself
// (`tests/m139-ste-539-mint-milestone-linear.test.ts`) and the match-by-key
// binding (`tests/m139-ste-540-linear-uuid-binding.test.ts`) shipped green
// under the two preceding FRs. This file asserts the WIRING onto them, the
// retargeting of the allocator they displace, and the surfaces that still
// order the displaced scan.
//
// MEASURED BEFORE A LINE WAS WRITTEN, against the tree this file was authored
// on — every number below is a measurement, not a prediction:
//   - probe #81 reports orderedUnreachable = 131 = ORDERED_UNREACHABLE_PIN,
//     ok: true.
//   - `next_free_milestone_number.ts` has EXACTLY ONE reference on a shipped
//     surface: `skills/spec-write/SKILL.md:177`, refClass `ordered`,
//     reachable `false`. That single ref is the whole of AC.2's subject.
//   - `hasEntryPoint("adapters/_shared/src/resolve_milestone_identity.ts")` is
//     false; `hasEntryPoint(".../mint_milestone_epic.ts")` is true. Those two
//     are the discriminating controls for the entry-point assertions.
//   - the plugin's `skills/` + `docs/` markdown holds EXACTLY FOUR lines
//     matching `(five-way|5-way)` AND `Linear`:
//       skills/spec-write/SKILL.md:177, docs/workflow-overview.md:33, :49, :237.
//   - the digit spelling is load-bearing: `five-way` + Linear matches ONE of
//     those four; `5-way` + Linear matches the other three, and
//     `docs/workflow-overview.md` contains ZERO occurrences of `five-way`. A
//     `five-way`-only predicate is blind to all three docs surfaces.
//
// SWEEP HAZARD, recorded so it cannot be reintroduced: `.claude/worktrees/`
// is gitignored but holds SIX FULL REPO COPIES, each with its own
// `plugins/dev-process-toolkit/skills/` and `docs/`. A sweep globbed `**/*.md`
// from the REPO root picks them up and inflates every count, so the control
// passes for the wrong reason. Every sweep below is rooted at the PLUGIN
// directory, and the scanned file list is asserted to hold no such path.

import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CANONICAL_CAPABILITY_KEYS,
  runClosingSummaryCapabilityKeysProbe,
} from "../adapters/_shared/src/closing_summary_capability_keys";
import { milestoneIdFromLinearMilestone } from "../adapters/_shared/src/milestone_token";
import {
  ORDERED_UNREACHABLE_PIN,
  buildModuleGraph,
  runModuleReachabilityProbe,
} from "../adapters/_shared/src/module_reachability";
import { MIGRATIONS } from "../adapters/_shared/src/migrations";
import {
  assertMigrationDeclared,
  runMigrationCoverageProbe,
} from "../adapters/_shared/src/migrations/coverage";
import { nextFreeMilestoneNumber } from "../adapters/_shared/src/next_free_milestone_number";
import { runPlanIdentityModeConditionalProbe } from "../adapters/_shared/src/plan_identity_mode_conditional";
import { resolveMilestoneIdentity } from "../adapters/_shared/src/resolve_milestone_identity";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");
const SHARED_SRC = join(PLUGIN_ROOT, "adapters", "_shared", "src");

const read = (path: string): string => readFileSync(path, "utf-8");

const specWriteSkillPath = join(PLUGIN_ROOT, "skills", "spec-write", "SKILL.md");
const workflowOverviewPath = join(PLUGIN_ROOT, "docs", "workflow-overview.md");
const upgradeReferencePath = join(PLUGIN_ROOT, "docs", "upgrade-reference.md");
const planIdentityModulePath = join(SHARED_SRC, "plan_identity_mode_conditional.ts");
const migrationsIndexPath = join(SHARED_SRC, "migrations", "index.ts");
/**
 * M139's own plan, live path first and `specs/plan/archive/` as the fallback.
 *
 * A meta-test pinned to the ACTIVE path passes for exactly as long as the
 * milestone is open and reds the moment `/implement`'s close moves the plan —
 * i.e. the moment the work it verifies is complete. Every assertion below is
 * about what the plan DECLARES, which survives the move, so resolve the plan
 * rather than the path. Same idiom as `resolveM119Plan` in
 * `tests/m119-ste-442-mode-none-sequential-milestone.test.ts` and the
 * archive-fallback read in `tests/m108-ste-393-docs-pins.test.ts`.
 */
function resolveM139Plan(): string {
  const live = join(REPO_ROOT, "specs", "plan", "M139.md");
  const archived = join(REPO_ROOT, "specs", "plan", "archive", "M139.md");
  return existsSync(live) ? live : archived;
}
const m139PlanPath = resolveM139Plan();

const NEXT_FREE_MODULE = join(SHARED_SRC, "next_free_milestone_number.ts");
const MINT_LINEAR_MODULE = join(SHARED_SRC, "mint_milestone_linear.ts");

/** Plugin-relative module keys, exactly as probe #81 and the graph record them. */
const NEXT_FREE_KEY = "adapters/_shared/src/next_free_milestone_number.ts";
const MINT_LINEAR_KEY = "adapters/_shared/src/mint_milestone_linear.ts";
const MINT_EPIC_KEY = "adapters/_shared/src/mint_milestone_epic.ts";
const DISPATCHER_KEY = "adapters/_shared/src/resolve_milestone_identity.ts";

/**
 * `ORDERED_UNREACHABLE_PIN` as measured BEFORE this FR's front doors.
 *
 * A bare literal on purpose (the `fr-summary-altitude-front-door.test.ts`
 * idiom): the claim is that the pin MOVED, and a "before" read from the same
 * module the "after" comes from could never disagree with it. The DIRECTION is
 * asserted, never the destination — the landing value is re-measured from the
 * probe itself, per the remedy the check prints.
 */
const PIN_BEFORE_THE_FRONT_DOORS = 131;

/** A stable Linear milestone identifier + the id the shipped derivation gives it. */
const FIXED_UUID = "550e8400-e29b-41d4-a716-446655440000";
const SECOND_UUID = "9f1c2d3e-4b5a-6c7d-8e9f-0a1b2c3d4e5f";

const tmpDirs: string[] = [];
function makeTmpRoot(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}
function cleanupTmpRoots(): void {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
}

/** The single blank-line-delimited paragraph carrying `marker`. */
function paragraphWith(body: string, marker: string): string {
  const hits = body.split(/\n\s*\n/).filter((p) => p.includes(marker));
  expect(hits.length).toBe(1);
  return hits[0]!;
}

/** A source file's prose with `//` comment markers and line wrapping collapsed. */
function collapsedProse(source: string): string {
  return source
    .split("\n")
    .map((l) => l.replace(/^\s*\/\/ ?/, ""))
    .join(" ")
    .replace(/\s+/g, " ");
}

interface Run {
  readonly stdout: string;
  readonly stderr: string;
  readonly combined: string;
  readonly exitCode: number;
}

function runCli(modulePath: string, args: string[]): Run {
  const proc = Bun.spawnSync(["bun", "run", modulePath, ...args], {
    cwd: REPO_ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = proc.stdout.toString();
  const stderr = proc.stderr.toString();
  return { stdout, stderr, combined: `${stdout}\n${stderr}`, exitCode: proc.exitCode ?? -1 };
}

/**
 * A specs tree whose visible history answers `M102` to a sequential scan:
 * active `M101`, archived `M99`, a CHANGELOG naming `M100`. The
 * `epic_first_allocation.test.ts:322` fixture idiom.
 */
function makeSpecsFixture(): { root: string; specs: string; changelog: string } {
  const root = makeTmpRoot("ste541-specs-");
  const specs = join(root, "specs");
  mkdirSync(join(specs, "plan", "archive"), { recursive: true });
  writeFileSync(join(specs, "plan", "M101.md"), "# M101 — Sequential milestone\n");
  writeFileSync(join(specs, "plan", "archive", "M99.md"), "# M99 — Archived milestone\n");
  const changelog = join(root, "CHANGELOG.md");
  writeFileSync(changelog, "## [2.0.0] — 2026-01-01 — \"Fixture\"\n\nShips M100.\n");
  return { root, specs, changelog };
}

/** A milestone provider double whose create allocates `uuid`. */
function makeMintingProvider(uuid: string): {
  provider: {
    createMilestone: (project: string, opts: { name: string }) => Promise<{ id: string }>;
    listMilestones: (project?: string) => Promise<{ name: string; id?: string }[]>;
  };
  creates: { project: string; name: string }[];
  listCalls: number;
} {
  const creates: { project: string; name: string }[] = [];
  const state = { listCalls: 0 };
  const provider = {
    createMilestone: async (project: string, opts: { name: string }) => {
      creates.push({ project, name: opts.name });
      return { id: uuid };
    },
    listMilestones: async (_project?: string) => {
      state.listCalls++;
      return [] as { name: string; id?: string }[];
    },
  };
  return {
    provider,
    creates,
    get listCalls() {
      return state.listCalls;
    },
  };
}

// ===========================================================================
// AC-STE-541.1 — the dispatcher's linear branch mints, and emits no `id:` key
// ===========================================================================

describe("AC-STE-541.1 — the linear branch delegates to mintMilestoneLinear", () => {
  test("the returned milestoneId is the mint's own derivation of the allocated identifier", async () => {
    const fx = makeSpecsFixture();
    const p = makeMintingProvider(FIXED_UUID);
    try {
      const identity = await resolveMilestoneIdentity({
        specsDir: fx.specs,
        mode: "linear",
        project: "DPT — Dev Process Toolkit",
        title: "Tracker-First Linear Milestones",
        provider: p.provider,
      });
      expect(identity.milestoneId).toBe(milestoneIdFromLinearMilestone(FIXED_UUID));
      // The create carried the HUMAN TITLE alone — never the canonical
      // `M_<id> — <Title>` name, which is not knowable until it returns.
      expect(p.creates.length).toBe(1);
      expect(p.creates[0]!.name).toBe("Tracker-First Linear Milestones");

      // Discriminating sibling: a DIFFERENT allocation gives a DIFFERENT id,
      // so the equality above is about the tracker's answer and not a constant.
      const q = makeMintingProvider(SECOND_UUID);
      const second = await resolveMilestoneIdentity({
        specsDir: fx.specs,
        mode: "linear",
        project: "DPT — Dev Process Toolkit",
        title: "Tracker-First Linear Milestones",
        provider: q.provider,
      });
      expect(second.milestoneId).toBe(milestoneIdFromLinearMilestone(SECOND_UUID));
      expect(second.milestoneId).not.toBe(identity.milestoneId);
    } finally {
      cleanupTmpRoots();
    }
  });

  test("the five-way scan is not run — a CALL COUNT on a double, proven able to increment", async () => {
    const fx = makeSpecsFixture();
    const p = makeMintingProvider(FIXED_UUID);
    let calls = 0;
    const branchScanner = {
      listBranchMilestones: async () => {
        calls++;
        return [7];
      },
    };
    try {
      await resolveMilestoneIdentity({
        specsDir: fx.specs,
        mode: "linear",
        project: "DPT",
        title: "Tracker-First Linear Milestones",
        provider: p.provider,
        changelogPath: fx.changelog,
        branchScanner,
      });
      expect(calls).toBe(0);

      // POSITIVE CONTROL, in the same test: the SAME double handed to the
      // allocator itself increments. `0` above is therefore a measurement of
      // the linear branch, not a counter that can never move.
      await nextFreeMilestoneNumber(fx.specs, fx.changelog, undefined, branchScanner);
      expect(calls).toBe(1);
    } finally {
      cleanupTmpRoots();
    }
  });

  test("second control: the answer is not the sequential fall-through's answer", async () => {
    const fx = makeSpecsFixture();
    const p = makeMintingProvider(FIXED_UUID);
    try {
      // Computed in-test rather than hard-coded, so the control tracks the
      // fixture instead of restating it.
      const fallThrough = `M${(await nextFreeMilestoneNumber(fx.specs, fx.changelog)).next}`;
      expect(fallThrough).toBe("M102"); // the fixture is doing what it claims

      const identity = await resolveMilestoneIdentity({
        specsDir: fx.specs,
        mode: "linear",
        project: "DPT",
        title: "Tracker-First Linear Milestones",
        provider: p.provider,
        changelogPath: fx.changelog,
      });
      expect(identity.milestoneId).not.toBe(fallThrough);
      expect(identity.milestoneId).not.toMatch(/^M\d+$/);
    } finally {
      cleanupTmpRoots();
    }
  });

  test("no `id:` KEY at all — with a mode-none control proving the key listing discriminates", async () => {
    const fx = makeSpecsFixture();
    const p = makeMintingProvider(FIXED_UUID);
    try {
      const identity = await resolveMilestoneIdentity({
        specsDir: fx.specs,
        mode: "linear",
        project: "DPT",
        title: "Tracker-First Linear Milestones",
        provider: p.provider,
      });
      expect(Object.keys(identity)).toEqual(["milestoneId"]);
      expect("id" in identity).toBe(false);

      // CONTROL: the `mode: none` branch, in the same file, DOES carry the
      // key — so the assertion above discriminates rather than always reading
      // one key off whatever it is handed.
      const minted = await resolveMilestoneIdentity({ specsDir: fx.specs, mode: "none" });
      expect(Object.keys(minted).sort()).toEqual(["id", "milestoneId"]);
    } finally {
      cleanupTmpRoots();
    }
  });

  test("end to end on the plan surface: probe #73 passes the minted linear plan, and fires on an `id:`", async () => {
    const fx = makeSpecsFixture();
    const p = makeMintingProvider(FIXED_UUID);
    try {
      const identity = await resolveMilestoneIdentity({
        specsDir: fx.specs,
        mode: "linear",
        project: "DPT",
        title: "Tracker-First Linear Milestones",
        provider: p.provider,
      });
      writeFileSync(
        join(fx.root, "CLAUDE.md"),
        "# Linear fixture\n\n## Task Tracking\n\nmode: linear\nmcp_server: linear\n",
      );
      writeFileSync(
        join(fx.specs, "plan", `${identity.milestoneId}.md`),
        `---\nmilestone: ${identity.milestoneId}\nstatus: active\narchived_at: null\nmigration: none\n---\n\n# Implementation Plan\n`,
      );
      const clean = await runPlanIdentityModeConditionalProbe(fx.root);
      expect(clean.violations).toEqual([]);

      // CONTROL: the same probe on a sibling plan that DOES carry `id:`
      // reports at least one row — linear's ONLY plan rule is id-absence, so
      // a probe that reported nothing here would be reporting nothing at all.
      writeFileSync(
        join(fx.specs, "plan", "M_ABC123.md"),
        "---\nmilestone: M_ABC123\nstatus: active\narchived_at: null\nid: fr_01K9ZQ8XJ4VDTAF4VDTAF4VDTA\n---\n\n# Implementation Plan\n",
      );
      const dirty = await runPlanIdentityModeConditionalProbe(fx.root);
      expect(dirty.violations.length).toBeGreaterThanOrEqual(1);
    } finally {
      cleanupTmpRoots();
    }
  });

  test("the mode-none co-presence pass cannot misfire because of SCOPE, not because of a regex", () => {
    // The superseded whole-uuid design let this line claim a 36-char key
    // could never land in the minted-tail shape. Under the SHIPPED six-hex
    // derivation a leading hex run that is all digits DOES match that shape,
    // so the regex argument is false. What actually holds is scope: the
    // co-presence pass is `mode: none` ONLY, and the linear arm never runs it.
    const prose = collapsedProse(read(planIdentityModulePath));
    expect(prose).toContain("`mode: none` only.");
    const allDigitHead = "123456" + FIXED_UUID.slice(6);
    expect(/^[0-9A-HJKMNP-TV-Z]{6}$/.test(allDigitHead.slice(0, 6))).toBe(true);
  });

  // Found by the AUDIT stage, owned by no AC, and an outward WRITE rather than
  // a bad read — which is why it is pinned here rather than noted.
  //
  // The branch defaulted a missing `project`/`title` to `""` and handed them
  // to the mint, on the stated grounds that this was "the same
  // one-refusal-not-two shape the jira branch uses". It is not. On the jira
  // branch `milestoneIdFromEpicKey("")` THROWS before anything happens; on
  // this branch the mint CREATES first and derives afterwards, so the same
  // defaulting silently allocated a real tracker milestone named "" in a
  // project named "" and returned a perfectly well-formed id derived from it.
  // Executed against the pre-fix tree it produced: create args
  // [{"project":"","opts":{"name":""}}], identity {"milestoneId":"M_550e84"}.
  //
  // A default that is harmless in front of a sanitizer is a write in front of
  // a mint. The module's own CLI front door had always refused this argv; the
  // in-process route was the weaker of the two.
  describe("a missing project or title REFUSES before any create", () => {
    function recordingProvider(): {
      creates: { project: string; name: string }[];
      provider: Record<string, unknown>;
    } {
      const creates: { project: string; name: string }[] = [];
      return {
        creates,
        provider: {
          createMilestone: async (p: string, o: { name: string }) => {
            creates.push({ project: p, name: o.name });
            return { id: FIXED_UUID };
          },
        },
      };
    }

    for (const missing of ["project", "title"] as const) {
      test(`no ${missing} ⇒ throws, and NOTHING is created`, async () => {
        const r = recordingProvider();
        const input: Record<string, unknown> = {
          specsDir: "specs",
          mode: "linear",
          provider: r.provider,
          project: "DPT",
          title: "Tracker-First Linear Milestones",
        };
        delete input[missing];

        await expect(
          resolveMilestoneIdentity(input as Parameters<typeof resolveMilestoneIdentity>[0]),
        ).rejects.toThrow(/refusing to mint a Linear milestone/);

        // The ABSENCE is a count on the recorder, not an impression: the
        // refusal has to land BEFORE the create, or the milestone exists.
        expect(r.creates).toEqual([]);
      });
    }

    test("an EMPTY-STRING project or title refuses too — not just an absent key", async () => {
      // The defaulting bug produced `""`, so a guard keyed only on `undefined`
      // would leave the reported defect exactly as it was.
      for (const bad of [
        { project: "", title: "T" },
        { project: "P", title: "" },
      ]) {
        const r = recordingProvider();
        await expect(
          resolveMilestoneIdentity({ specsDir: "specs", mode: "linear", provider: r.provider, ...bad }),
        ).rejects.toThrow(/refusing to mint a Linear milestone/);
        expect(r.creates).toEqual([]);
      }
    });

    test("CONTROL: with both supplied, the same provider mints exactly once", async () => {
      // Without this the refusals above could be satisfied by a branch that
      // never mints at all.
      const r = recordingProvider();
      const identity = await resolveMilestoneIdentity({
        specsDir: "specs",
        mode: "linear",
        provider: r.provider,
        project: "DPT",
        title: "Tracker-First Linear Milestones",
      });
      expect(r.creates).toEqual([{ project: "DPT", name: "Tracker-First Linear Milestones" }]);
      expect(identity.milestoneId).toBe(milestoneIdFromLinearMilestone(FIXED_UUID));
    });
  });
});

// ===========================================================================
// AC-STE-541.2 — the allocator keeps a production caller, through its OWN door
// ===========================================================================

describe("AC-STE-541.2 — reachability comes from the front door, not from an importer", () => {
  test("the allocator carries a command-line entry point and is reachable through it", () => {
    const graph = buildModuleGraph(REPO_ROOT);
    expect(graph.hasEntryPoint(NEXT_FREE_KEY)).toBe(true);
    expect(graph.reachable(NEXT_FREE_KEY)).toBe(true);

    // DISCRIMINATING CONTROL (measured false on the authoring tree): a graph
    // that answered `true` for everything could not pass this pair.
    expect(graph.hasEntryPoint(DISPATCHER_KEY)).toBe(false);

    // This FR removes the allocator's SOLE importer. Pinning the empty list
    // records that the front door — not an import — is what carries it.
    expect(graph.nonTestImporters(NEXT_FREE_KEY)).toEqual([]);
  });

  test("the minter carries its own front door too, in the shipped precedent's shape", () => {
    const graph = buildModuleGraph(REPO_ROOT);
    expect(graph.hasEntryPoint(MINT_EPIC_KEY)).toBe(true); // the shape precedent
    expect(graph.hasEntryPoint(MINT_LINEAR_KEY)).toBe(true);
    expect(read(MINT_LINEAR_MODULE)).toContain("if (import.meta.main)");
    // Without this door the NEW ordered reference the guard gains on
    // `skills/spec-write/SKILL.md` would cancel the lowering below.
  });

  test("the allocator's door builds the explicit-`M<N>` collision refusal, both directions", () => {
    const fx = makeSpecsFixture();
    try {
      // Leg 1 — a typed identity the tree ALREADY holds refuses, in NFR-10
      // canonical shape, naming all five sources it consulted.
      const refused = runCli(NEXT_FREE_MODULE, [fx.specs, "M101"]);
      expect(refused.exitCode).not.toBe(0);
      expect(refused.combined).toMatch(/^Refusing: /m);
      expect(refused.combined).toMatch(/^Remedy: /m);
      expect(refused.combined).toMatch(/^Context: /m);
      for (const label of ["active", "archived", "changelog", "tracker", "branches"]) {
        expect(refused.combined).toContain(label);
      }

      // Leg 2 — a typed identity NOTHING holds resolves. Neither leg is
      // vacuous, because the other goes the opposite way on the same tree.
      const ok = runCli(NEXT_FREE_MODULE, [fx.specs, "M999"]);
      expect(ok.exitCode).toBe(0);
      expect(ok.combined).not.toMatch(/^Refusing: /m);
      expect(ok.combined).toContain("M999");

      // THE FREE PATH'S OWN OUTPUT, pinned. The REFACTOR hoisted the
      // five-source breakdown into one `renderMilestoneSourceBreakdown` whose
      // stated contract is "one renderer, so neither path can go quiet alone"
      // — but only the REFUSAL path was asserted. Deleting the free path's
      // renderer loop was a GREEN mutation, which is precisely the quiet-half
      // defect that comment claims to prevent. The refused leg proves the
      // renderer works; this proves the free leg actually calls it.
      expect(ok.combined).toContain("verdict=free");
      expect(ok.combined).toContain("typed=M999");
      expect(ok.combined).toContain(`next-free=M${102}`);
      for (const label of ["active", "archived", "changelog", "tracker", "branches"]) {
        expect(ok.combined).toContain(`${label}:`);
      }
      // The two paths agree about what the scan saw: the free verdict reports
      // the SAME active-plan holding that the refusal above reported.
      expect(ok.combined).toContain("active: 101");
    } finally {
      cleanupTmpRoots();
    }
  });

  test("the minter's door refuses an incomplete argv and derives the id from a complete one", () => {
    const bare = runCli(MINT_LINEAR_MODULE, []);
    expect(bare.exitCode).not.toBe(0);
    expect(bare.combined).toMatch(/^Refusing: /m);
    expect(bare.combined).toMatch(/^Remedy: /m);
    expect(bare.combined).toMatch(/^Context: /m);

    const shown = runCli(MINT_LINEAR_MODULE, ["DPT", "Tracker-First Linear Milestones", FIXED_UUID]);
    expect(shown.exitCode).toBe(0);
    expect(shown.combined).toContain(milestoneIdFromLinearMilestone(FIXED_UUID));
    expect(shown.combined).toContain(FIXED_UUID);
  });

  test("probe #81 reports zero ordered-and-unreachable refs for the allocator, and the pin FELL", async () => {
    const report = await runModuleReachabilityProbe(REPO_ROOT);
    const refs = report.records.filter((r) => r.module.endsWith("next_free_milestone_number.ts"));

    // FIRST: the module is still named on a shipped surface. Without this an
    // EMPTY record set would satisfy the next assertion silently.
    expect(refs.length).toBeGreaterThan(0);
    expect(refs.filter((r) => r.refClass === "ordered" && !r.reachable)).toEqual([]);

    // The pin moves in the same commit, re-measured rather than predicted.
    // Direction only — the landing value comes from the probe.
    expect(report.ok).toBe(true);
    expect(ORDERED_UNREACHABLE_PIN).toBeLessThan(PIN_BEFORE_THE_FRONT_DOORS);
    expect(report.orderedUnreachable).toBe(ORDERED_UNREACHABLE_PIN);
  });
});

// ===========================================================================
// AC-STE-541.3 — no shipped surface still orders the five-way scan for Linear
// ===========================================================================

describe("AC-STE-541.3 — the allocation guard no longer orders the scan for a new Linear milestone", () => {
  const guard = (): string =>
    paragraphWith(read(specWriteSkillPath), "**Milestone-number allocation guard.**");

  test("positive control FIRST: the extractor returns a real paragraph", () => {
    const p = guard();
    expect(p.length).toBeGreaterThan(200);
    // A literal that SURVIVES this FR. A mis-scoped extractor returning `""`
    // would otherwise satisfy every `not.toContain` below.
    expect(p).toContain("resolveMilestoneIdentity");
  });

  test("the order is gone and the guard names the minter instead", () => {
    const p = guard();
    expect(p).not.toContain("It runs a **five-way scan**");
    expect(p).not.toContain("Linear keeps the sequential five-way scan unchanged");
    expect(p).toContain("mintMilestoneLinear");
  });

  test("the guard still names the allocator for the explicit-`M<N>` check", () => {
    // The module reference SURVIVES — retargeted, not deleted. This is what
    // keeps probe #81's record set non-empty above.
    expect(guard()).toContain("adapters/_shared/src/next_free_milestone_number.ts");
  });

  test("the guard adds no tracker-ID tokens (the skills/ STE ceiling has zero headroom)", () => {
    expect(guard()).not.toMatch(/\bSTE-\d+/);
  });

  test("docs/workflow-overview.md: all THREE surfaces retargeted", () => {
    const body = read(workflowOverviewPath);
    // CONTROL on a line NO edit here touches, proving the read is non-empty
    // and the search can match. NOT `key-derived (jira, none)` — that occurs
    // only on the mermaid line being edited.
    expect(body).toContain("Post-write FR self-checks");

    expect(body).not.toContain("the 5-way number scan on Linear");
    expect(body).not.toContain("5-way scan (Linear)");
    expect(body).not.toContain("dispatcher's **Linear only** branch");
  });

  test("repo-wide sweep: no shipped markdown line carries both spellings' scan AND Linear", () => {
    const bothRe = (line: string): boolean =>
      /(five-way|5-way)/.test(line) && /Linear/.test(line);

    // POSITIVE CONTROL 1 — the predicate itself, both spellings, plus a
    // negative so it is not a tautology.
    expect(bothRe("It runs a five-way scan on Linear")).toBe(true);
    expect(bothRe("the 5-way number scan on Linear")).toBe(true);
    expect(bothRe("It runs a five-way scan")).toBe(false);
    expect(bothRe("the dispatcher's Linear branch")).toBe(false);

    // POSITIVE CONTROL 2 — the four lines this FR retires, frozen verbatim
    // enough to carry both tokens. The predicate SEES the real shapes, not
    // only a synthetic string. Frozen inline rather than read from git so the
    // control survives the implementation commit.
    const MEASURED_PRE_CHANGE_LINES = [
      "**Linear sequential branch.** It delegates to `nextFreeMilestoneNumber` ... It runs a **five-way scan** ...",
      "guard the write — the 5-way number scan on Linear, key-derived ids on Jira and in `mode: none`.",
      '    gMs{"milestone identity: 5-way scan (Linear) | key-derived (jira, none) (NFR-10)"}:::gate',
      "| ├ nextFreeMilestoneNumber 5-way scan | dispatcher's **Linear only** branch | ... |",
    ];
    expect(MEASURED_PRE_CHANGE_LINES.filter(bothRe).length).toBe(4);
    // And the digit spelling is load-bearing: a `five-way`-only predicate is
    // blind to three of the four.
    expect(
      MEASURED_PRE_CHANGE_LINES.filter((l) => /five-way/.test(l) && /Linear/.test(l)).length,
    ).toBe(1);

    // THE SWEEP — rooted at the PLUGIN directory, never the repo root.
    const files: string[] = [];
    for (const tree of ["skills", "docs"]) {
      const dir = join(PLUGIN_ROOT, tree);
      if (!existsSync(dir)) continue;
      for (const rel of new Bun.Glob("**/*.md").scanSync({ cwd: dir, onlyFiles: true })) {
        files.push(join(dir, rel));
      }
    }

    // The sweep looked at something, and it did NOT look at the six gitignored
    // repo copies under `.claude/worktrees/`.
    expect(files.length).toBeGreaterThan(20);
    expect(files.some((f) => f.includes(".claude/worktrees"))).toBe(false);
    expect(files).toContain(specWriteSkillPath);
    expect(files).toContain(workflowOverviewPath);
    // The corpus still contains `Linear` lines, so a zero conjunction below is
    // a statement about the conjunction and not about an empty read.
    const allLines = files.flatMap((f) =>
      read(f)
        .split("\n")
        .map((line, i) => ({ file: f, line: i + 1, text: line })),
    );
    expect(allLines.filter((l) => /Linear/.test(l.text)).length).toBeGreaterThan(0);

    const hits = allLines.filter((l) => bothRe(l.text)).map((l) => `${l.file}:${l.line}`);
    expect(hits).toEqual([]);
  });

  test("the same sweep over SOURCE comments: no .ts claims Linear still runs the scan", () => {
    // The markdown sweep above is scoped to `skills/**/*.md` + `docs/**/*.md`,
    // and that scope is a hole rather than a boundary. Phase 3's spec-compliance
    // review found `setup_scaffold_plan_identity.ts` still asserting that the
    // dispatcher's "`linear` branch runs the five-way availability scan" — false
    // since this FR, and STRUCTURALLY invisible to a markdown-only predicate.
    // Fixing that one line without widening the search would leave the next such
    // comment to the next reviewer who happens to look.
    //
    // The distinction this leg must draw is PRESENT vs PAST tense. Three source
    // comments legitimately mention the scan while describing its REMOVAL
    // ("used to run", "no longer calls", "took the five-way scan off"); a
    // predicate that flagged those would be unusable and would be silenced.
    // So the subject is a present-tense CLAIM that the branch still scans.
    // Applied to a SENTENCE of collapsed prose, never to a physical line. The
    // guarded file wraps at ~80 columns, so a claim split across a wrap would
    // put no single line in possession of all three tokens and would evade a
    // line-scoped predicate entirely — the same wrap-blindness `collapsedProse`
    // exists elsewhere in this file to defeat.
    //
    // The verb set is deliberately WIDE. A narrow allowlist is evaded by an
    // ordinary reword ("executes", "performs", "still does"), and the cost of
    // breadth here is low because the past-tense exclusion below carries the
    // real discrimination.
    const claimsStillScans = (text: string): boolean =>
      /(five-way|5-way)/.test(text) &&
      /\blinear\b/i.test(text) &&
      /\b(run|runs|use|uses|call|calls|delegate|delegates|consult|consults|execute|executes|perform|performs|invoke|invokes|do|does|rely|relies|go|goes)\b/i.test(
        text,
      ) &&
      // The exclusions are TIGHT on purpose. Each names a construction that
      // actually ships in this tree (verified below), and nothing broader:
      // blanket words like `not`, `since` or `until` would suppress a genuine
      // stale claim that merely happened to contain one.
      !/\b(used to|no longer|stopped|took .* off|before that|previously|retired|replaced)\b/i.test(
        text,
      );

    // CONTROLS — the predicate discriminates in both directions.
    expect(claimsStillScans("its `linear` branch runs the five-way availability scan")).toBe(true);
    expect(claimsStillScans("the linear branch uses the 5-way scan")).toBe(true);
    // …and does NOT fire on the three truthful past-tense mentions that ship.
    expect(
      claimsStillScans("// five-way scan the dispatcher's Linear branch used to run — that branch"),
    ).toBe(false);
    expect(
      claimsStillScans("// TYPE-ONLY on purpose. The linear branch no longer calls the five-way scan,"),
    ).toBe(false);
    expect(
      claimsStillScans("* branch alone since STE-541 took the five-way scan off the `linear` branch;"),
    ).toBe(false);

    // THE SWEEP — production source only; test files carry retired literals on
    // purpose and are the subject of AC.6, not of this leg.
    const srcDir = join(PLUGIN_ROOT, "adapters");
    const srcFiles: string[] = [];
    for (const rel of new Bun.Glob("**/*.ts").scanSync({ cwd: srcDir, onlyFiles: true })) {
      if (rel.endsWith(".test.ts")) continue;
      srcFiles.push(join(srcDir, rel));
    }
    expect(srcFiles.length).toBeGreaterThan(50);
    expect(srcFiles.some((f) => f.includes(".claude/worktrees"))).toBe(false);

    // Collapse each file's comment prose FIRST, then split into sentences, so
    // a wrapped claim is judged as the one sentence it actually is.
    const srcSentences = srcFiles.flatMap((f) =>
      collapsedProse(read(f))
        .split(/(?<=[.;])\s+/)
        .map((text) => ({ file: f, text })),
    );
    // The corpus really does discuss the scan, so a zero below is about the
    // CLAIM and not about a search that found nothing to read.
    expect(srcSentences.filter((s) => /(five-way|5-way)/.test(s.text)).length).toBeGreaterThan(0);

    const stale = srcSentences
      .filter((s) => claimsStillScans(s.text))
      .map((s) => `${s.file}: ${s.text.slice(0, 120)}`);
    expect(stale).toEqual([]);
  });

  test("probe #73's own header prose no longer states the retired rationale", () => {
    const prose = collapsedProse(read(planIdentityModulePath));
    // READ-PROVEN CONTROL: a literal on a line this edit does not touch.
    expect(prose).toContain("`mode: none` only.");

    // The two places the module states sequential numbering as linear's
    // correct shape. Both are line-wrapped in the source, so the comparison
    // runs against collapsed prose — a raw `toContain` would pass vacuously.
    expect(prose).not.toContain("sequential numbering being its correct shape");
    expect(prose).not.toContain(
      "sequential numbering is the CORRECT shape under `mode: linear`",
    );
  });
});

// ===========================================================================
// AC-STE-541.4 — the capability row, no registry entry, no state
// ===========================================================================

describe("AC-STE-541.4 — the adoption notice is registered and owned by /spec-write", () => {
  test("the key is canonical and routes to spec-write", async () => {
    expect(CANONICAL_CAPABILITY_KEYS).toContain("linear_milestone_scheme_adopted");

    // `KEY_OWNER_SKILL` is module-private today; this FR EXPORTS it so an AC
    // can assert on it. Imported dynamically ON PURPOSE — a missing named
    // export on a static import aborts the WHOLE file at load and would hide
    // every other AC's verdict behind one error.
    const mod = (await import(
      "../adapters/_shared/src/closing_summary_capability_keys"
    )) as Record<string, unknown>;
    const owners = mod.KEY_OWNER_SKILL as Record<string, string> | undefined;
    expect(owners).toBeDefined();
    expect(owners!.linear_milestone_scheme_adopted).toBe("spec-write");
    // CONTROL: an existing row, proving the import resolved to the real map
    // rather than to an empty object that answers `undefined` for everything.
    expect(owners!.milestone_allocation_default_applied).toBe("spec-write");
  });

  test("the probe is green on the shipped tree, and BOTH its legs still fire", async () => {
    const clean = await runClosingSummaryCapabilityKeysProbe(REPO_ROOT);
    expect(clean.violations).toEqual([]);

    const shipped = read(specWriteSkillPath);

    // FORWARD LEG — delete the new directive from a copy: exactly one
    // violation, naming the key.
    const fwdRoot = makeTmpRoot("ste541-cap-fwd-");
    const fwdDir = join(fwdRoot, "plugins", "dev-process-toolkit", "skills", "spec-write");
    mkdirSync(fwdDir, { recursive: true });
    writeFileSync(
      join(fwdDir, "SKILL.md"),
      shipped.replaceAll("MUST emit `linear_milestone_scheme_adopted`", "emits the adoption row"),
    );
    const fwd = await runClosingSummaryCapabilityKeysProbe(fwdRoot);
    expect(fwd.violations.length).toBe(1);
    expect(fwd.violations[0]!.missingKey).toBe("linear_milestone_scheme_adopted");

    // REVERSE LEG — an unregistered directive is an orphan.
    const revRoot = makeTmpRoot("ste541-cap-rev-");
    const revDir = join(revRoot, "plugins", "dev-process-toolkit", "skills", "spec-write");
    mkdirSync(revDir, { recursive: true });
    writeFileSync(
      join(revDir, "SKILL.md"),
      `${shipped}\n\nMUST emit \`linear_milestone_scheme_unregistered\` at the documented site.\n`,
    );
    const rev = await runClosingSummaryCapabilityKeysProbe(revRoot);
    expect(rev.violations.map((v) => v.missingKey)).toContain(
      "linear_milestone_scheme_unregistered",
    );

    cleanupTmpRoots();
  });

  test("NO registry entry ships — an equality on the whole list, falsifiable both ways", () => {
    // A `not.toContain` would pass on an emptied registry. The equality reds
    // on an addition AND on a deletion.
    expect(MIGRATIONS.map((e) => e.id)).toEqual([
      "monolith-split",
      "v1-orphans",
      "permission-shapes",
      "stale-hook-entries",
      "m104-legacy-state",
      "mode-none-sequential-milestone",
      "verification-run-keys",
    ]);
  });

  test("no state to clear — an absence with a proven search, in the same test", () => {
    const body = read(specWriteSkillPath);
    const guard = paragraphWith(body, "**Milestone-number allocation guard.**");
    const dptRe = /\.dpt\//;

    expect(dptRe.test(guard)).toBe(false);
    // THE SAME regex DOES match elsewhere in THIS file — the § 7 Token Stats
    // item names the ledger — so the absence above is a measurement.
    expect(dptRe.test(body)).toBe(true);
    expect(body).toContain(".dpt/ledger/token-ledger.jsonl");
  });

  test("the directive states BOTH conjuncts of the emission condition", () => {
    const body = read(specWriteSkillPath);

    // SCOPED TO THE DIRECTIVE SENTENCE, not to the paragraph containing it.
    // The earlier form asserted against `paragraphWith(...)`, which returns
    // the WHOLE ~9.4k-char allocation guard — so `/\bfirst\b/i` was satisfied
    // by the unrelated `Epic-first` and `toContain("M<N>")` by dozens of
    // unrelated hits. Mutation-tested by the audit: deleting the entire
    // scheme-adoption block left the old assertions GREEN. Only the `.dpt/`
    // absence could still fail, and absence was never the subject.
    const paragraph = paragraphWith(body, "MUST emit `linear_milestone_scheme_adopted`");
    const start = paragraph.indexOf("**Scheme-adoption notice");
    const after = paragraph.indexOf("**Explicitly-typed", start + 1);
    // Prove the SLICE ITSELF is real before asserting anything about it — a
    // failed extraction returning "" would satisfy every `not.toContain`.
    expect(start).toBeGreaterThanOrEqual(0);
    expect(after).toBeGreaterThan(start);
    const directive = paragraph.slice(start, after);
    expect(directive.length).toBeGreaterThan(200);

    // Conjunct 1 — the FIRST such mint. Asserted on the verbatim literal, so
    // no other sentence's "first" can stand in for it.
    expect(directive).toContain("The FIRST time this branch mints an identifier-derived milestone");
    // Conjunct 2 — and the project STILL holds sequential plans.
    expect(directive).toContain("still holds sequential `M<N>` plans");
    // The conjunction is STATED, not left to inference.
    expect(directive).toContain("BOTH conjuncts are required");
    // Once-per-event is stated too, with the reason it needs no state file.
    expect(directive).toContain("does not fire again");
    // And it carries no residue of a state file that does not exist.
    expect(directive).not.toContain(".dpt/");

    // ISOLATION: the slice must NOT have swallowed the neighbouring block —
    // that is what made the old form vacuous, and it is the failure this leg
    // is now specifically able to catch.
    expect(directive).not.toContain("Explicitly-typed");
    expect(directive).not.toContain("Epic-first");
  });
});

// ===========================================================================
// AC-STE-541.5 — `migration: none`
// ===========================================================================

describe("AC-STE-541.5 — the M139 plan declares migration: none", () => {
  /** The plan's own Release target, read rather than restated. */
  const releaseTarget = (): string => {
    const m = read(m139PlanPath).match(/\*\*Release target:\*\*\s*v?(\d+\.\d+\.\d+)/);
    expect(m).not.toBeNull();
    return m![1]!;
  };

  test("the ship pre-flight resolves for M139 — a short-circuit, not a version match", async () => {
    await expect(
      assertMigrationDeclared(m139PlanPath, MIGRATIONS, releaseTarget()),
    ).resolves.toBeUndefined();
    expect(read(m139PlanPath)).toContain("migration: none");
  });

  test("CONTROL — the helper CAN refuse, exercising the branch M139 short-circuits past", async () => {
    const root = makeTmpRoot("ste541-migration-");
    const planDir = join(root, "specs", "plan");
    mkdirSync(planDir, { recursive: true });
    const planPath = join(planDir, "M900.md");
    writeFileSync(
      planPath,
      "---\nmilestone: M900\nstatus: active\narchived_at: null\nmigration: verification-run-keys\n---\n\n# Implementation Plan\n",
    );
    try {
      // `verification-run-keys` is introduced_in 2.70.0; shipping something
      // else must be refused at the `introduced_in` / `shipping` comparison.
      let caught: Error | null = null;
      try {
        await assertMigrationDeclared(planPath, MIGRATIONS, "2.71.0");
      } catch (e) {
        caught = e as Error;
      }
      expect(caught).not.toBeNull();
      expect(caught!.message).toMatch(/^Refusing: /m);
      expect(caught!.message).toMatch(/^Context: .*introduced_in=/m);
      expect(caught!.message).toContain("shipping=");
    } finally {
      cleanupTmpRoots();
    }
  });

  test("probe #68 raises nothing against M139, and the walk is demonstrably populated", async () => {
    const report = await runMigrationCoverageProbe(REPO_ROOT);
    expect(report.warnings.filter((w) => w.file === "specs/plan/M139.md")).toEqual([]);
    expect(report.violations.filter((v) => v.file === "specs/plan/M139.md")).toEqual([]);

    // CONTROL — an ACTIVE plan omitting `migration:` yields exactly one
    // advisory warning, so the empty result above is a measurement rather
    // than an unpopulated walk. (The active-plan leg is advisory-only.)
    const root = makeTmpRoot("ste541-coverage-");
    mkdirSync(join(root, "specs", "plan"), { recursive: true });
    writeFileSync(
      join(root, "specs", "plan", "M901.md"),
      "---\nmilestone: M901\nstatus: active\narchived_at: null\n---\n\n# Implementation Plan\n",
    );
    try {
      const bare = await runMigrationCoverageProbe(root);
      expect(bare.warnings.length).toBe(1);
      expect(bare.warnings[0]!.file).toBe("specs/plan/M901.md");
    } finally {
      cleanupTmpRoots();
    }
  });

  test("the introduced_in divergence stays documented where it already lives", () => {
    // Not re-recorded in M139: two shipped surfaces already say the enforced
    // rule is the SHIPPING version and that it wins where the two diverge.
    expect(read(migrationsIndexPath)).toContain("wins where the two diverge");
    expect(read(upgradeReferencePath)).toContain(
      "**The enforced rule is narrower than that description, and it wins.**",
    );
  });
});

// ===========================================================================
// AC-STE-541.6 — the "Linear unchanged" pin retired BY NAME
// ===========================================================================

describe("AC-STE-541.6 — STE-417 AC.5's Linear-unchanged pin is retired by name", () => {
  test("the M139 plan names both retired pins in ONE paragraph that says so", () => {
    const plan = read(m139PlanPath);
    // Scoped to the paragraph, not the whole file: a whole-file `toContain`
    // survives deletion of the very sentence it protects.
    const retirement = plan
      .split(/\n\s*\n/)
      .filter((p) => p.includes("retired") && p.includes("AC-STE-417.5"));
    expect(retirement.length).toBeGreaterThanOrEqual(1);
    const p = retirement[0]!;
    expect(p).toContain("AC-STE-417.5");
    expect(p).toContain("AC-STE-377.4");
  });

  test("the AC-STE-377.4 Linear-unchanged suite is gone, and the file was demonstrably read", () => {
    const body = read(join(SHARED_SRC, "epic_first_allocation.test.ts"));
    // POSITIVE CONTROL: the sibling heading survives, proving the read landed
    // and this exact search shape can match.
    expect(body).toContain("AC-STE-417.5 — mode: none DIVERGES");
    expect(body).not.toContain("AC-STE-377.4 — Linear milestone allocation is byte-unchanged");
  });

  test("every remaining test asserting Linear stays on the sequential scan is retargeted", () => {
    const docsPins = read(join(PLUGIN_ROOT, "tests", "m115-ste-417-docs-pins.test.ts"));
    expect(docsPins).toContain("AC-STE-417.2"); // read-proven control
    expect(docsPins).not.toContain('expect(p).toContain("It runs a **five-way scan**")');
    expect(docsPins).not.toContain(
      'expect(p).toContain("Linear keeps the sequential five-way scan unchanged")',
    );

    const jiraPins = read(join(PLUGIN_ROOT, "tests", "spec-write-jira-epic-first-allocation.test.ts"));
    expect(jiraPins).toContain("AC-STE-377.1"); // read-proven control
    expect(jiraPins).not.toContain('expect(skill).toContain("five-way scan")');

    const dispatcher = read(
      join(PLUGIN_ROOT, "tests", "m119-ste-440-milestone-identity-dispatcher.test.ts"),
    );
    expect(dispatcher).toContain("AC-STE-440.4"); // read-proven control
    expect(dispatcher).not.toContain(
      "AC-STE-440.3 — the linear branch equals the five-way scan's own answer",
    );
  });
});
