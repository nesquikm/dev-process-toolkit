// M129 STE-495 — a milestone declares the repo it targets, and `/deliver`
// routes on it.
//
// WHAT IS BROKEN, measured on this tree at authoring time (2026-08-17, v2.67.1):
//
//   * `grep -rn "target_repo\|target repo" skills/deliver/SKILL.md
//     docs/deliver-reference.md` → ZERO hits for either token. The pipeline has
//     no vocabulary at all for a milestone that belongs to a different repo.
//   * `ls adapters/_shared/src/target_repo*` → no matches. The module this file
//     specifies does not exist.
//   * `skills/deliver/SKILL.md:34` — "Phases 1–2 run **inline in the invoking
//     session**" is unconditional. Every milestone's spec-writing binds to the
//     invoking session's tracker and its specs tree, with no way to say
//     otherwise.
//   * `skills/deliver/SKILL.md:53-55` — the worker's chain is the fixed three
//     stages `/implement` → `/ship-milestone` → `/pr`, with no reduced form for
//     a tree that has no ceremony to run.
//
// TEST STRATEGY, and why no half of it is a tautology.
//
//   * BEHAVIOUR FIRST, PROSE SECOND. This repo has a documented history of
//     prose-grep ACs reading green while the behaviour is absent — STE-492 is
//     exactly that defect and it ships in THIS milestone. So the declaration
//     reader, the three-way routing classifier, the reduced-chain stage
//     requirement and the unlocatable-target refusal all live in
//     `adapters/_shared/src/target_repo.ts` and are exercised as CODE.
//   * EVERY PROSE PIN IS ANCHORED ON A TOKEN THAT DOES NOT EXIST TODAY. The
//     literal `target_repo` appears in neither `/deliver` surface at authoring
//     time, so each `nearby(...)` pin below is genuinely RED now and genuinely
//     about this FR's subject — rather than a phrase the shipped prose already
//     happens to satisfy. (Checked: an unanchored "spec-write near worker" pin
//     over `docs/deliver-reference.md` passes TODAY, off the Phase-2 table row.
//     That pin is deliberately not written.)
//   * AC.1 IS THE BACKWARD-COMPATIBILITY SPINE, AND IT IS NOT A GREP. The
//     absent-declaration default is asserted against the REAL plan corpus on
//     disk — `specs/plan/M129.md` plus all of `specs/plan/archive/` — every one
//     of which must read as undeclared AND route to the invoking repo with the
//     shipped three-stage chain. The corpus size is asserted first so the loop
//     cannot pass over zero files, and the probe handed in THROWS if it is
//     consulted at all, so "undeclared never even looks for another repo" is a
//     real assertion rather than an inference.
//   * THE THREE ROUTES ARE PROVEN DISTINGUISHABLE. `invoking`,
//     `cross_repo_toolkit` and `reduced` are asserted to differ from each other
//     in the fields that matter — where spec-writing runs, and which stages the
//     chain carries — so no pair of them can collapse into one and still pass.
//   * TOOLKIT PRESENCE IS DETECTED ON REAL DISK, VIA THE SHIPPED PREDICATE.
//     `isToolkitManaged` (STE-432) is already the one implementation of "does
//     the toolkit own this tree?". The default probe is asserted to answer TRUE
//     for this repo root and FALSE for a temp tree whose `CLAUDE.md` carries no
//     managed signal, and the module source is pinned to IMPORT that predicate
//     rather than grow a second copy (the STE-485 retyped-literal lesson).
//   * AC.5 IS CONSISTENT WITH THE SHIPPED STE-492 CLAUSE, NOT A CONTRADICTION
//     OF IT. Both `/deliver` surfaces already state that a reduced chain emits
//     the SAME six sections in the SAME fixed order, `gate` carrying the literal
//     `- (none found)`. So AC.5 is tested as a STAGE-EXISTENCE exemption, not a
//     fence exemption: `fenceSectionsFor` must return exactly
//     `DELIVER_STAGE_SECTIONS` (imported statically from the shipped module, not
//     retyped) for every route, while `missingRequiredStages` must return
//     nothing for a reduced chain that never ran `/implement` or
//     `/ship-milestone` — and must still name them for a full chain that
//     skipped them. Both shipped paragraphs are pinned verbatim so the
//     implementer cannot "fix" AC.5 by deleting the clause it must agree with.
//   * AC.7 IS MUTATION-VERIFIED IN BOTH DIRECTIONS. The unlocatable case must
//     THROW and must return nothing — a routing object coming back at all is
//     scored as the silent fallback this AC exists to forbid. Its isolation leg
//     is that a LOCATABLE target genuinely resolves, on both the toolkit and the
//     toolkit-less branch, so "always refuses" cannot pass.
//
// DELIBERATE OMISSIONS.
//   * NO aggregate `/gate-check` probe-count assertion. This FR is Tier 2 and
//     registers NO probe; the count is 79 after STE-493 (#78) and STE-494 (#79)
//     land in this same milestone, and a count pin here would be someone else's
//     pin, reddening on their schedule rather than on this FR's behaviour.
//   * NO new skill and NO new agent. The tripwires pin 27 / 8 so a "fix" that
//     adds a `/deliver-cross-repo` skill fails here rather than in review.
//   * NO pin on `templates/spec-templates/plan.md.template`. The declaration is
//     optional and additive; whether the template advertises it is the
//     implementer's call, and a placeholder value in a template is not a
//     declaration this module should have to reason about.
//
// HARD BUDGETS, measured at authoring time:
//   * `skills/` tree: 246 / 246 STE-N tokens — ZERO headroom. New `/deliver`
//     prose must cite by mechanism, never by ticket id — which is why not one
//     prose pin below demands a ticket id.
//   * `skills/deliver/SKILL.md`: 119 lines of a 358 cap.
// This file lives under `tests/`, which carries neither budget.

import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DELIVER_STAGE_SECTIONS } from "../adapters/_shared/src/deliver_stage_capture";
import { parseFrontmatter } from "../adapters/_shared/src/frontmatter";

// ===========================================================================
// Paths.
// ===========================================================================

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");
const SKILLS_DIR = join(PLUGIN_ROOT, "skills");
const AGENTS_DIR = join(PLUGIN_ROOT, "agents");
const DOCS_DIR = join(PLUGIN_ROOT, "docs");
const SHARED_SRC = join(PLUGIN_ROOT, "adapters", "_shared", "src");

const read = (p: string): string => readFileSync(p, "utf-8");
const skillPath = (name: string): string => join(SKILLS_DIR, name, "SKILL.md");
const skillBody = (name: string): string => read(skillPath(name));

const DELIVER_SKILL = (): string => skillBody("deliver");
const DELIVER_REFERENCE_FILE = join(DOCS_DIR, "deliver-reference.md");
const DELIVER_REFERENCE = (): string => read(DELIVER_REFERENCE_FILE);
/** Both `/deliver` surfaces as one body — either may host a given clause. */
const DELIVER_SURFACES = (): string =>
  `${DELIVER_SKILL()}\n\n${DELIVER_REFERENCE()}`;

/**
 * The FR under test, resolved with the ARCHIVE FALLBACK. `/implement` Phase 4
 * `git mv`s the FR into `specs/frs/archive/` at milestone close, and a
 * meta-test that only knows the active path goes red at the archive commit —
 * the recurring failure recorded in the M100/M126 notes.
 */
function frPath(): string {
  const active = join(REPO_ROOT, "specs", "frs", "STE-495.md");
  if (existsSync(active)) return active;
  const archived = join(REPO_ROOT, "specs", "frs", "archive", "STE-495.md");
  if (existsSync(archived)) return archived;
  throw new Error(
    "STE-495.md found in neither specs/frs/ nor specs/frs/archive/",
  );
}

/** Every REAL milestone plan on disk: the active one plus the whole archive. */
function allPlanFiles(): string[] {
  const out: string[] = [];
  const planDir = join(REPO_ROOT, "specs", "plan");
  const archiveDir = join(planDir, "archive");
  for (const dir of [planDir, archiveDir]) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (!name.endsWith(".md")) continue;
      if (statSync(p).isDirectory()) continue;
      out.push(p);
    }
  }
  return out.sort();
}

// ===========================================================================
// The module under test, imported LAZILY.
//
// A top-level static import of a not-yet-written module aborts the whole file,
// which would collapse seven independent reds into one load error and hide
// which ACs are actually unmet. `frontmatter` and `deliver_stage_capture` ARE
// imported statically above — they are shipped.
// ===========================================================================

const TARGET_REPO_MODULE = "../adapters/_shared/src/target_repo";
const TARGET_REPO_MODULE_FILE = join(SHARED_SRC, "target_repo.ts");

/** The three topologies a milestone can be routed to. */
type MilestoneRoute = "invoking" | "cross_repo_toolkit" | "reduced";

/** Where Phase 2 runs for a given milestone. */
type SpecWriteLocation = "inline" | "worker";

/** Stage identities a milestone's worker chain can carry. */
type StageId = "spec-write" | "implement" | "ship-milestone" | "pr" | "work";

interface TargetRepoDeclaration {
  /** The plan carried a real `target_repo:` value. */
  readonly declared: boolean;
  /** The declared value verbatim, or `null` when undeclared. */
  readonly value: string | null;
}

/** How a declared target repo is turned into a real tree. Injectable. */
interface RepoProbe {
  /** Absolute path of the declared repo, or `null` when it cannot be located. */
  locate(declared: string): string | null;
  /** True when that tree has the toolkit installed. */
  hasToolkit(repoPath: string): boolean;
}

interface RouteInput {
  /** The milestone plan's full text. */
  readonly planBody: string;
  /** Absolute path of the repo the `/deliver` session was invoked in. */
  readonly invokingRepo: string;
  readonly probe?: RepoProbe;
}

interface MilestoneRouting {
  readonly route: MilestoneRoute;
  /** Absolute path of the repo this milestone's work lands in. */
  readonly repo: string;
  readonly declared: boolean;
  readonly specWrite: SpecWriteLocation;
  readonly chain: readonly StageId[];
  /** True when the target tree runs the toolkit ceremony at all. */
  readonly ceremony: boolean;
  /** Workers this milestone gets. Always 1 — the serial invariant. */
  readonly workers: number;
  /** Workers that may run at once. Always 1. */
  readonly concurrency: number;
}

interface TargetRepoModule {
  TARGET_REPO_KEY: string;
  MILESTONE_ROUTES: readonly MilestoneRoute[];
  FULL_CHAIN_STAGES: readonly StageId[];
  CROSS_REPO_CHAIN_STAGES: readonly StageId[];
  REDUCED_CHAIN_STAGES: readonly StageId[];
  MAX_CONCURRENT_WORKERS: number;
  EMPTY_SECTION_FALLBACK: string;
  readTargetRepoDeclaration(planBody: string): TargetRepoDeclaration;
  defaultRepoProbe(invokingRepo?: string): RepoProbe;
  routeMilestone(input: RouteInput): MilestoneRouting;
  stagesRequiredFor(route: MilestoneRoute): readonly StageId[];
  haltsForMissingStage(route: MilestoneRoute, stage: StageId): boolean;
  missingRequiredStages(
    route: MilestoneRoute,
    emitted: readonly StageId[],
  ): readonly StageId[];
  fenceSectionsFor(route: MilestoneRoute): readonly string[];
}

async function targetRepo(): Promise<TargetRepoModule> {
  return (await import(TARGET_REPO_MODULE)) as unknown as TargetRepoModule;
}

// ===========================================================================
// Fixtures + helpers.
// ===========================================================================

const INVOKING = "/abs/invoking-repo";
const OTHER_TOOLKIT_REPO = "/abs/other-toolkit-repo";
const TOOLKIT_LESS_REPO = "/abs/docs-only-repo";

const ALL_ROUTES: MilestoneRoute[] = [
  "invoking",
  "cross_repo_toolkit",
  "reduced",
];

const EXPECTED_FULL_CHAIN: StageId[] = ["implement", "ship-milestone", "pr"];
const EXPECTED_CROSS_REPO_CHAIN: StageId[] = [
  "spec-write",
  "implement",
  "ship-milestone",
  "pr",
];
const EXPECTED_REDUCED_CHAIN: StageId[] = ["work", "pr"];

/** A minimal but realistic milestone plan body. */
function planBody(frontmatterExtra: string[] = []): string {
  const lines = [
    "---",
    "milestone: M900",
    "status: active",
    "archived_at: null",
    "kickoff_branch: null",
    "frozen_at: null",
    "migration: none",
    ...frontmatterExtra,
    "---",
    "",
    "# Implementation Plan",
    "",
    "## M900 — a milestone {#M900}",
    "",
  ];
  return lines.join("\n");
}

/** A probe that resolves exactly the two fixture repos and nothing else. */
function fixtureProbe(): RepoProbe {
  return {
    locate(declared: string): string | null {
      if (declared === OTHER_TOOLKIT_REPO) return OTHER_TOOLKIT_REPO;
      if (declared === TOOLKIT_LESS_REPO) return TOOLKIT_LESS_REPO;
      if (declared === INVOKING || declared === ".") return INVOKING;
      return null;
    },
    hasToolkit(repoPath: string): boolean {
      return repoPath !== TOOLKIT_LESS_REPO;
    },
  };
}

/** A probe that FAILS LOUDLY if consulted — for the undeclared path. */
function neverConsultedProbe(): RepoProbe {
  return {
    locate(): string | null {
      throw new Error(
        "probe.locate was consulted for a plan that declares NO target repo",
      );
    },
    hasToolkit(): boolean {
      throw new Error(
        "probe.hasToolkit was consulted for a plan that declares NO target repo",
      );
    },
  };
}

/** True when every needle appears in `body`, in the given order. */
function containsInOrder(body: string, needles: readonly string[]): boolean {
  let cursor = 0;
  for (const needle of needles) {
    const at = body.indexOf(needle, cursor);
    if (at === -1) return false;
    cursor = at + needle.length;
  }
  return true;
}

/**
 * True when `a` and `b` both occur in `body` within `window` characters of each
 * other, in either order. Prose pins use this instead of a whole-sentence
 * literal so the implementer keeps freedom of phrasing, while the two anchors
 * still have to appear as one thought rather than in unrelated sections.
 */
/**
 * The routing prose THIS FR added, and nothing else.
 *
 * Found by the STE-495 audit: the four `nearby(TARGET_REPO_KEY, …)` pins were
 * run against the whole concatenated surfaces. The new `## Target repo` section
 * was inserted directly beneath `docs/deliver-reference.md`'s pre-existing Phase
 * table, whose rows already read "Inline, invoking session" and "One fresh
 * spawned visible worker per milestone" — so the 900-char window reached back
 * into HEAD text and two of the four pins passed off prose that predates this
 * FR entirely. `nearby` only guarantees the ANCHOR is new; the needle half is
 * free to match anything in range.
 *
 * Slicing to the SECTIONS that actually mention the key closes that: a pin can
 * now only be satisfied by text written for this FR.
 */
function routingProse(): string {
  const sectionsMentioning = (body: string): string[] => {
    const lines = body.split("\n");
    const out: string[] = [];
    let cur: string[] = [];
    const flush = (): void => {
      // The literal, not the lazily-imported TARGET_REPO_KEY: this helper runs
      // at module scope inside pins that import the module per-test.
      if (cur.some((l) => l.includes("target_repo"))) out.push(cur.join("\n"));
      cur = [];
    };
    for (const line of lines) {
      if (/^#{2,4} /.test(line)) {
        flush();
      }
      cur.push(line);
    }
    flush();
    return out;
  };
  return [DELIVER_SKILL(), DELIVER_REFERENCE()]
    .flatMap(sectionsMentioning)
    .join("\n\n");
}

function nearby(body: string, a: string, b: string, window: number): boolean {
  const hay = body.toLowerCase();
  const needleA = a.toLowerCase();
  const needleB = b.toLowerCase();
  for (let i = hay.indexOf(needleA); i !== -1; i = hay.indexOf(needleA, i + 1)) {
    const lo = Math.max(0, i - window);
    const hi = Math.min(hay.length, i + needleA.length + window);
    if (hay.slice(lo, hi).includes(needleB)) return true;
  }
  return false;
}

/** Assert an NFR-10 canonical refusal, and hand the message back for more pins. */
function expectNfr10Refusal(fn: () => unknown, label: string): string {
  let raised: unknown = null;
  try {
    fn();
  } catch (e) {
    raised = e;
  }
  expect(raised, `${label}: nothing was refused`).not.toBeNull();
  const msg = String((raised as Error).message);
  expect(msg, `${label}: no Refusing: line`).toContain("Refusing:");
  expect(msg, `${label}: no Remedy: line`).toContain("Remedy:");
  expect(msg, `${label}: no Context: line`).toContain("Context:");
  return msg;
}

/** A throwaway tree with a `CLAUDE.md` of the caller's choosing. */
function withTempRepo(claudeMd: string | null, fn: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "ste495-"));
  try {
    if (claudeMd !== null) writeFileSync(join(root, "CLAUDE.md"), claudeMd);
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// The reduced-chain clause STE-492 already shipped, on BOTH surfaces. AC.5 must
// AGREE with it, so the implementer must not "exempt" the reduced chain by
// deleting the paragraph that says it emits the same six sections.
const SHIPPED_REDUCED_CHAIN_CLAUSES = [
  "**Reduced chains — a milestone targeting a repo with no toolkit ceremony.**",
  "The one section that omits real content there is `gate`",
  "`gate` keeps its heading and carries the literal `- (none found)` fallback",
] as const;

// The Phase 1–2 inline guarantee AC.2 must leave untouched.
const SHIPPED_INLINE_PHASE_CLAUSES = [
  "## Phases 1–2 — design and spec-writing, inline",
  "Phases 1–2 run **inline in the invoking session**",
] as const;

// The serial invariant AC.6 must leave untouched.
const SHIPPED_SERIAL_CLAUSES_SKILL = [
  "run the ceremony **strictly serially**",
  "spawn **one fresh visible worker per milestone**",
  "Never run two milestone workers concurrently",
  "Serial execution is the invariant, not an optimization.",
] as const;

const SHIPPED_SERIAL_CLAUSES_REFERENCE = [
  "### Serial one-worker-per-milestone invariant",
  "**One fresh worker per milestone.**",
  "**Strictly serial.**",
] as const;

/** Phrasings that would GRANT concurrency. None may appear. */
const CONCURRENCY_ALLOWANCES = [
  /run (?:the )?(?:milestone )?workers in parallel/i,
  /(?:may|can|should) (?:be )?run(?:ning)? [^.\n]{0,40}in parallel/i,
  /concurrent(?:ly)? [^.\n]{0,30}(?:is|are) (?:fine|allowed|permitted|safe)/i,
  /spawn (?:two|several|multiple|all) [^.\n]{0,30}workers at once/i,
];

// ===========================================================================
// TRIPWIRES — written first; they are what stops a bad "fix".
// ===========================================================================

describe("TRIPWIRE — the surfaces and budgets this FR's edits ride against", () => {
  const SKILL_LINE_CAP = 358;
  const SKILLS_STE_TOKEN_CEILING = 246;

  test("the FR still names all SEVEN ACs this file is written against", () => {
    const fr = read(frPath());
    for (let n = 1; n <= 7; n++) {
      expect(fr, `AC-STE-495.${n} missing from the FR`).toContain(
        `AC-STE-495.${n}:`,
      );
    }
  });

  test(`skills/deliver/SKILL.md stays within the NFR-1 line cap (${SKILL_LINE_CAP})`, () => {
    // 119 / 358 at authoring time — ample room for the routing prose.
    expect(DELIVER_SKILL().split("\n").length).toBeLessThanOrEqual(
      SKILL_LINE_CAP,
    );
  });

  test("skills/deliver/SKILL.md keeps a VALID frontmatter block", () => {
    const fm = parseFrontmatter(DELIVER_SKILL());
    expect(fm.name).toBe("deliver");
    expect(String(fm.description)).toContain("pipeline");
  });

  test(`the skills/ STE-token ceiling (${SKILLS_STE_TOKEN_CEILING}) is not breached`, () => {
    let count = 0;
    const walk = (d: string): void => {
      for (const name of readdirSync(d)) {
        const p = join(d, name);
        if (statSync(p).isDirectory()) {
          walk(p);
          continue;
        }
        if (!name.endsWith(".md")) continue;
        count += (read(p).match(/\b(STE|AC-STE)-\d+(?:\.\d+)?\b/g) ?? []).length;
      }
    };
    walk(SKILLS_DIR);
    expect(count).toBeLessThanOrEqual(SKILLS_STE_TOKEN_CEILING);
  });

  test("the roster is unchanged — 27 skills, 8 agents", () => {
    // Target-repo routing is a `/deliver` capability, not a new surface.
    expect(readdirSync(SKILLS_DIR).length).toBe(27);
    expect(readdirSync(AGENTS_DIR).length).toBe(8);
  });

  test("the `/deliver` reference is still the pointed-at companion document", () => {
    expect(existsSync(DELIVER_REFERENCE_FILE)).toBe(true);
    expect(DELIVER_SKILL()).toContain("docs/deliver-reference.md");
  });

  test("containsInOrder REJECTS a mutated body — the order helper is not vacuous", () => {
    const body = "alpha\nbeta\ngamma\n";
    expect(containsInOrder(body, ["alpha", "beta", "gamma"])).toBe(true);
    expect(containsInOrder(body, ["gamma", "alpha"])).toBe(false);
    expect(containsInOrder(body, ["alpha", "delta"])).toBe(false);
  });

  test("nearby REJECTS anchors that are far apart or absent", () => {
    // Without this every prose pin below could be passing because the helper
    // says yes to anything.
    const body = `alpha${" ".repeat(500)}beta`;
    expect(nearby(body, "alpha", "beta", 600)).toBe(true);
    expect(nearby(body, "beta", "alpha", 600)).toBe(true);
    expect(nearby(body, "alpha", "beta", 100)).toBe(false);
    expect(nearby(body, "alpha", "gamma", 10_000)).toBe(false);
  });

  test("neverConsultedProbe really throws — the undeclared pins are not vacuous", () => {
    const probe = neverConsultedProbe();
    expect(() => probe.locate("x")).toThrow();
    expect(() => probe.hasToolkit("x")).toThrow();
  });

  test("the real plan corpus is large enough for the AC.1 sweep to mean something", () => {
    // A loop over zero files passes trivially.
    expect(allPlanFiles().length).toBeGreaterThanOrEqual(100);
  });
});

// ===========================================================================
// AC-STE-495.1 — a plan can declare a target repo; absent means the invoking
// repo, and every existing single-repo plan is unchanged.
//
// The backward-compatibility spine. Every leg here goes RED if an absent
// declaration stops meaning the invoking repo.
// ===========================================================================

describe("AC-STE-495.1 — the declaration, and the absent-declaration default", () => {
  test("the module exists at its pinned path under adapters/_shared/src", () => {
    expect(existsSync(TARGET_REPO_MODULE_FILE)).toBe(true);
  });

  test("the declaration key is the plan-frontmatter key `target_repo`", async () => {
    const { TARGET_REPO_KEY } = await targetRepo();
    expect(TARGET_REPO_KEY).toBe("target_repo");
  });

  test("a plan that DECLARES a target repo reads as declared, value verbatim", async () => {
    const { readTargetRepoDeclaration } = await targetRepo();
    for (const value of [
      OTHER_TOOLKIT_REPO,
      TOOLKIT_LESS_REPO,
      "../sibling-repo",
      "~/workspace/docs-site",
    ]) {
      const decl = readTargetRepoDeclaration(planBody([`target_repo: ${value}`]));
      expect(decl.declared, value).toBe(true);
      expect(decl.value, value).toBe(value);
    }
  });

  test("a plan with NO key, and the `null` sentinel, both read as undeclared", async () => {
    // `shipped_in: null` is the house sentinel idiom; `target_repo: null` must
    // mean the same as omitting the key, not a repo literally named "null".
    const { readTargetRepoDeclaration } = await targetRepo();
    for (const body of [planBody(), planBody(["target_repo: null"])]) {
      const decl = readTargetRepoDeclaration(body);
      expect(decl.declared).toBe(false);
      expect(decl.value).toBeNull();
    }
  });

  test("the reader tolerates CRLF and a BOM, and never throws on a bodiless file", async () => {
    // Every frontmatter reader in this repo folds CRLF/lone-CR and strips a
    // BOM; a hand-rolled parser that anchors on `---\n` reads a Windows-authored
    // plan as having no frontmatter at all, silently.
    const { readTargetRepoDeclaration } = await targetRepo();
    const declared = planBody([`target_repo: ${OTHER_TOOLKIT_REPO}`]);
    for (const [label, body] of [
      ["CRLF", declared.replace(/\n/g, "\r\n")],
      ["lone CR", declared.replace(/\n/g, "\r")],
      ["BOM", `﻿${declared}`],
      ["BOM + CRLF", `﻿${declared.replace(/\n/g, "\r\n")}`],
    ] as const) {
      const decl = readTargetRepoDeclaration(body);
      expect(decl.declared, label).toBe(true);
      expect(decl.value, label).toBe(OTHER_TOOLKIT_REPO);
    }
    // Lenient: a document with no frontmatter is undeclared, not a crash.
    expect(readTargetRepoDeclaration("# just a heading\n").declared).toBe(false);
  });

  test("the module READS frontmatter through the shared helper, not by hand", async () => {
    // The CRLF/BOM behaviour above must come from `frontmatter.ts`, the one
    // place that owns it — a private regex would drift the moment that module's
    // normalization changes.
    await targetRepo();
    expect(read(TARGET_REPO_MODULE_FILE)).toContain('from "./frontmatter"');
  });

  test("an undeclared plan routes to the INVOKING repo, with the shipped chain", async () => {
    const { routeMilestone, FULL_CHAIN_STAGES } = await targetRepo();
    const routing = routeMilestone({
      planBody: planBody(),
      invokingRepo: INVOKING,
      probe: neverConsultedProbe(),
    });
    expect(routing.route).toBe("invoking");
    expect(routing.repo).toBe(INVOKING);
    expect(routing.declared).toBe(false);
    expect(routing.specWrite).toBe("inline");
    expect(routing.ceremony).toBe(true);
    expect([...routing.chain]).toEqual([...FULL_CHAIN_STAGES]);
  });

  test("the three chain constants are the stages this file expects", async () => {
    const { FULL_CHAIN_STAGES, CROSS_REPO_CHAIN_STAGES, REDUCED_CHAIN_STAGES } =
      await targetRepo();
    expect([...FULL_CHAIN_STAGES]).toEqual(EXPECTED_FULL_CHAIN);
    expect([...CROSS_REPO_CHAIN_STAGES]).toEqual(EXPECTED_CROSS_REPO_CHAIN);
    expect([...REDUCED_CHAIN_STAGES]).toEqual(EXPECTED_REDUCED_CHAIN);
  });

  test("the shipped chain constant still matches the chain the SKILL states", () => {
    // The module's `FULL_CHAIN_STAGES` and `/deliver`'s own prose have to name
    // the same three stages in the same order, or one of them is lying.
    expect(
      containsInOrder(DELIVER_SKILL(), [
        "`/implement M<N>`",
        "`/ship-milestone M<N>`",
        "`/pr`",
      ]),
      "the shipped three-stage chain line changed",
    ).toBe(true);
  });

  test("NON-REGRESSION SWEEP: every real plan on disk still routes to the invoking repo", async () => {
    // The spine. `specs/plan/M129.md` plus the whole archive — none of them
    // declares a target repo, and every one must behave exactly as it does
    // today. The probe THROWS if consulted, so this also proves the undeclared
    // path never goes looking for another tree.
    const { routeMilestone, readTargetRepoDeclaration, FULL_CHAIN_STAGES } =
      await targetRepo();
    const plans = allPlanFiles();
    let checked = 0;
    for (const p of plans) {
      const body = read(p);
      const decl = readTargetRepoDeclaration(body);
      expect(decl.declared, `${p} unexpectedly declares a target repo`).toBe(
        false,
      );
      const routing = routeMilestone({
        planBody: body,
        invokingRepo: INVOKING,
        probe: neverConsultedProbe(),
      });
      expect(routing.route, p).toBe("invoking");
      expect(routing.repo, p).toBe(INVOKING);
      expect(routing.specWrite, p).toBe("inline");
      expect([...routing.chain], p).toEqual([...FULL_CHAIN_STAGES]);
      checked += 1;
    }
    expect(checked).toBe(plans.length);
    expect(checked).toBeGreaterThanOrEqual(100);
  });

  test("NON-VACUITY: the same reader DOES see a declaration when one is present", async () => {
    // Without this, "every plan on disk is undeclared" would be satisfied by a
    // reader that can never report a declaration at all.
    const { readTargetRepoDeclaration } = await targetRepo();
    const sample = read(allPlanFiles()[0]!);
    expect(readTargetRepoDeclaration(sample).declared).toBe(false);
    const mutated = sample.replace(
      /^status:/m,
      `target_repo: ${OTHER_TOOLKIT_REPO}\nstatus:`,
    );
    expect(mutated, "the mutation did not apply").not.toBe(sample);
    const decl = readTargetRepoDeclaration(mutated);
    expect(decl.declared).toBe(true);
    expect(decl.value).toBe(OTHER_TOOLKIT_REPO);
  });

  test("the routing vocabulary is exactly three routes", async () => {
    const { MILESTONE_ROUTES } = await targetRepo();
    expect([...MILESTONE_ROUTES]).toEqual(ALL_ROUTES);
  });

  test("PROSE: the `/deliver` surfaces name the key and its invoking-repo default", async () => {
    const { TARGET_REPO_KEY } = await targetRepo();
    const surfaces = DELIVER_SURFACES();
    expect(surfaces, "`target_repo` is documented nowhere").toContain(
      TARGET_REPO_KEY,
    );
    expect(
      nearby(routingProse(), TARGET_REPO_KEY, "invoking", 700),
      "the surfaces never tie the declaration to the invoking-repo default",
    ).toBe(true);
  });
});

// ===========================================================================
// AC-STE-495.2 — a milestone targeting the invoking repo keeps Phases 1–2
// inline, unchanged.
// ===========================================================================

describe("AC-STE-495.2 — the invoking-repo route keeps design and spec-writing inline", () => {
  test("an EXPLICIT declaration of the invoking repo is still the inline route", async () => {
    // Declaring your own repo must be a no-op, not a second code path.
    const { routeMilestone, FULL_CHAIN_STAGES } = await targetRepo();
    for (const value of [INVOKING, "."]) {
      const routing = routeMilestone({
        planBody: planBody([`target_repo: ${value}`]),
        invokingRepo: INVOKING,
        probe: fixtureProbe(),
      });
      expect(routing.route, value).toBe("invoking");
      expect(routing.repo, value).toBe(INVOKING);
      expect(routing.specWrite, value).toBe("inline");
      expect([...routing.chain], value).toEqual([...FULL_CHAIN_STAGES]);
    }
  });

  test("the inline route is byte-identical whether the declaration is present or absent", async () => {
    const { routeMilestone } = await targetRepo();
    const implicit = routeMilestone({
      planBody: planBody(),
      invokingRepo: INVOKING,
      probe: fixtureProbe(),
    });
    const explicit = routeMilestone({
      planBody: planBody([`target_repo: ${INVOKING}`]),
      invokingRepo: INVOKING,
      probe: fixtureProbe(),
    });
    // `declared` is the one field allowed to differ — it records what the plan
    // said, not where the work goes.
    expect({ ...implicit, declared: true }).toEqual({ ...explicit });
  });

  test("ISOLATION: the SAME router moves spec-writing off inline for another repo", async () => {
    // Without this, "the invoking route is inline" would be satisfied by a
    // router that puts every milestone inline.
    const { routeMilestone } = await targetRepo();
    const elsewhere = routeMilestone({
      planBody: planBody([`target_repo: ${OTHER_TOOLKIT_REPO}`]),
      invokingRepo: INVOKING,
      probe: fixtureProbe(),
    });
    expect(elsewhere.specWrite).toBe("worker");
    expect(elsewhere.route).not.toBe("invoking");
  });

  test("the shipped inline-phases guarantee survives verbatim, in order", () => {
    const body = DELIVER_SKILL();
    for (const clause of SHIPPED_INLINE_PHASE_CLAUSES) {
      expect(body, `shipped inline-phase clause lost: ${clause}`).toContain(
        clause,
      );
    }
    expect(containsInOrder(body, SHIPPED_INLINE_PHASE_CLAUSES)).toBe(true);
  });

  test("the shipped Socratic no-proxy guarantee is untouched", () => {
    // Phases 1–2 "unchanged" includes the contract that makes them worth
    // running inline in the first place.
    const body = DELIVER_SKILL();
    expect(body).toContain("never proxies");
    expect(body).toContain(
      "Each question reaches the operator exactly as the phase skill asks it, in order, one at a time.",
    );
  });
});

// ===========================================================================
// AC-STE-495.3 — a cross-repo milestone with the toolkit runs spec-writing
// INSIDE its own worker, first.
// ===========================================================================

describe("AC-STE-495.3 — a cross-tracker toolkit repo spec-writes inside its worker", () => {
  test("the route, the repo, and the location of spec-writing", async () => {
    const { routeMilestone } = await targetRepo();
    const routing = routeMilestone({
      planBody: planBody([`target_repo: ${OTHER_TOOLKIT_REPO}`]),
      invokingRepo: INVOKING,
      probe: fixtureProbe(),
    });
    expect(routing.route).toBe("cross_repo_toolkit");
    expect(routing.repo, "the work must land in the TARGET repo").toBe(
      OTHER_TOOLKIT_REPO,
    );
    expect(routing.declared).toBe(true);
    expect(routing.specWrite).toBe("worker");
    expect(routing.ceremony).toBe(true);
  });

  test("spec-write is the FIRST step of that worker's chain, then the full ceremony", async () => {
    const { routeMilestone, CROSS_REPO_CHAIN_STAGES, FULL_CHAIN_STAGES } =
      await targetRepo();
    const routing = routeMilestone({
      planBody: planBody([`target_repo: ${OTHER_TOOLKIT_REPO}`]),
      invokingRepo: INVOKING,
      probe: fixtureProbe(),
    });
    expect(routing.chain[0], "spec-write is not the first step").toBe(
      "spec-write",
    );
    expect([...routing.chain]).toEqual([...CROSS_REPO_CHAIN_STAGES]);
    // The rest of the chain is the shipped ceremony, unchanged and in order.
    expect([...routing.chain].slice(1)).toEqual([...FULL_CHAIN_STAGES]);
  });

  test("the invoking route does NOT carry spec-write in its worker chain", async () => {
    // The binding claim: spec-writing moves into the worker only for the
    // cross-repo route. If both chains carried it, "inside that worker" would
    // be saying nothing.
    const { routeMilestone } = await targetRepo();
    const inline = routeMilestone({
      planBody: planBody(),
      invokingRepo: INVOKING,
      probe: fixtureProbe(),
    });
    expect(inline.chain).not.toContain("spec-write");
    expect(inline.specWrite).toBe("inline");
  });

  test("the target repo is the one the probe located, never the invoking one", async () => {
    // The whole point of AC.3: tracker and specs bind to the target repo.
    const { routeMilestone } = await targetRepo();
    const routing = routeMilestone({
      planBody: planBody([`target_repo: ${OTHER_TOOLKIT_REPO}`]),
      invokingRepo: INVOKING,
      probe: fixtureProbe(),
    });
    expect(routing.repo).not.toBe(INVOKING);
  });

  test("PROSE: the surfaces tie the declaration to spec-writing in the worker", async () => {
    const { TARGET_REPO_KEY } = await targetRepo();
    const surfaces = DELIVER_SURFACES();
    expect(
      nearby(routingProse(), TARGET_REPO_KEY, "spec-write", 900),
      "the surfaces never connect a declared target repo to spec-writing",
    ).toBe(true);
    expect(
      nearby(routingProse(), TARGET_REPO_KEY, "worker", 900),
      "the surfaces never connect a declared target repo to the worker",
    ).toBe(true);
  });
});

// ===========================================================================
// AC-STE-495.4 — a toolkit-less target repo runs a REDUCED chain.
// ===========================================================================

describe("AC-STE-495.4 — a repo with no toolkit gets do-the-work-then-PR", () => {
  test("the route, and the two-stage chain", async () => {
    const { routeMilestone, REDUCED_CHAIN_STAGES } = await targetRepo();
    const routing = routeMilestone({
      planBody: planBody([`target_repo: ${TOOLKIT_LESS_REPO}`]),
      invokingRepo: INVOKING,
      probe: fixtureProbe(),
    });
    expect(routing.route).toBe("reduced");
    expect(routing.repo).toBe(TOOLKIT_LESS_REPO);
    expect(routing.ceremony, "a toolkit-less tree has no ceremony").toBe(false);
    expect([...routing.chain]).toEqual([...REDUCED_CHAIN_STAGES]);
  });

  test("no ceremony stage appears in the reduced chain", async () => {
    const { routeMilestone } = await targetRepo();
    const routing = routeMilestone({
      planBody: planBody([`target_repo: ${TOOLKIT_LESS_REPO}`]),
      invokingRepo: INVOKING,
      probe: fixtureProbe(),
    });
    for (const stage of ["implement", "ship-milestone", "spec-write"]) {
      expect(routing.chain, `ceremony stage ${stage} leaked in`).not.toContain(
        stage,
      );
    }
    expect(routing.chain, "the reduced chain still opens a PR").toContain("pr");
  });

  test("ISOLATION: the SAME probe shape with the toolkit present gets the full ceremony", async () => {
    // Without this, "toolkit-less is reduced" would be satisfied by a router
    // that reduces every cross-repo milestone.
    const { routeMilestone } = await targetRepo();
    const withToolkit = routeMilestone({
      planBody: planBody([`target_repo: ${OTHER_TOOLKIT_REPO}`]),
      invokingRepo: INVOKING,
      probe: fixtureProbe(),
    });
    expect(withToolkit.route).toBe("cross_repo_toolkit");
    expect(withToolkit.ceremony).toBe(true);
    expect(withToolkit.chain).toContain("implement");
    expect(withToolkit.chain).toContain("ship-milestone");
  });

  test("toolkit presence is decided by the shipped on-disk predicate, on real trees", async () => {
    // Keying on something real: the default probe answers TRUE for this repo
    // (its CLAUDE.md carries the managed headings) and FALSE for a tree whose
    // CLAUDE.md carries no managed signal at all. Both answers reachable.
    const { defaultRepoProbe } = await targetRepo();
    const probe = defaultRepoProbe(REPO_ROOT);
    expect(probe.hasToolkit(REPO_ROOT), "this repo reads as unmanaged").toBe(
      true,
    );
    withTempRepo("# Some Project\n\nNo toolkit here.\n", (root) => {
      expect(probe.hasToolkit(root), "a plain tree reads as managed").toBe(false);
    });
    withTempRepo("# Some Project\n\n## Task Tracking\n\nmode: none\n", (root) => {
      expect(
        probe.hasToolkit(root),
        "a managed heading is not recognized",
      ).toBe(true);
    });
    withTempRepo(null, (root) => {
      expect(probe.hasToolkit(root), "a CLAUDE.md-less tree reads as managed").toBe(
        false,
      );
    });
  });

  test("the module REUSES the shipped managed-tree predicate rather than copying it", async () => {
    // STE-432 made `toolkit_managed.ts` the one implementation of this
    // question; a second copy is how the four original probes drifted apart.
    await targetRepo();
    expect(read(TARGET_REPO_MODULE_FILE)).toContain('from "./toolkit_managed"');
  });

  test("PROSE: the surfaces tie the declaration to the reduced chain", async () => {
    const { TARGET_REPO_KEY } = await targetRepo();
    const surfaces = DELIVER_SURFACES();
    expect(
      nearby(routingProse(), TARGET_REPO_KEY, "reduced", 900),
      "the surfaces never connect a declared target repo to the reduced chain",
    ).toBe(true);
  });
});

// ===========================================================================
// AC-STE-495.5 — a reduced chain is not held to the FULL ceremony's hand-off
// contract; the orchestrator does not halt it for stages that do not exist.
//
// Scope note, and it is the whole point of this block: the shipped STE-492
// clause on BOTH `/deliver` surfaces already says a reduced chain emits the
// SAME six sections in the SAME fixed order, `gate` carrying `- (none found)`.
// AC.5 is therefore a STAGE-EXISTENCE exemption, not a fence exemption, and
// this file asserts exactly that — the fence stays, the missing STAGES stop
// being a halt.
// ===========================================================================

describe("AC-STE-495.5 — the reduced chain is exempt from stages it never runs", () => {
  test("stagesRequiredFor matches each route's own chain", async () => {
    const {
      stagesRequiredFor,
      FULL_CHAIN_STAGES,
      CROSS_REPO_CHAIN_STAGES,
      REDUCED_CHAIN_STAGES,
    } = await targetRepo();
    expect([...stagesRequiredFor("invoking")]).toEqual([...FULL_CHAIN_STAGES]);
    expect([...stagesRequiredFor("cross_repo_toolkit")]).toEqual([
      ...CROSS_REPO_CHAIN_STAGES,
    ]);
    expect([...stagesRequiredFor("reduced")]).toEqual([
      ...REDUCED_CHAIN_STAGES,
    ]);
  });

  test("the ceremony stages are NOT halting stages on a reduced chain", async () => {
    const { haltsForMissingStage } = await targetRepo();
    for (const stage of ["implement", "ship-milestone", "spec-write"] as StageId[]) {
      expect(
        haltsForMissingStage("reduced", stage),
        `a reduced chain halts for the absent ${stage} stage`,
      ).toBe(false);
    }
  });

  test("ISOLATION: a reduced chain STILL halts for the stages it does run", async () => {
    // "Never halts" is the vacuous reading of this AC. A reduced chain that
    // opened no PR is a failed reduced chain.
    const { haltsForMissingStage } = await targetRepo();
    expect(haltsForMissingStage("reduced", "pr")).toBe(true);
    expect(haltsForMissingStage("reduced", "work")).toBe(true);
  });

  test("ISOLATION: the FULL chain still halts for those very same stages", async () => {
    // The complement. If `implement` stopped being a halting stage everywhere,
    // AC.5 would have been "satisfied" by deleting the contract.
    const { haltsForMissingStage } = await targetRepo();
    for (const route of ["invoking", "cross_repo_toolkit"] as MilestoneRoute[]) {
      for (const stage of ["implement", "ship-milestone", "pr"] as StageId[]) {
        expect(haltsForMissingStage(route, stage), `${route}/${stage}`).toBe(
          true,
        );
      }
    }
  });

  test("END TO END: a reduced chain that ran work+PR is missing nothing", async () => {
    const { missingRequiredStages } = await targetRepo();
    expect([...missingRequiredStages("reduced", ["work", "pr"])]).toEqual([]);
  });

  test("END TO END: the same emission on a FULL chain names what it skipped", async () => {
    // Same input, different route, opposite verdict — the exemption is real and
    // it is scoped to the reduced route alone.
    const { missingRequiredStages } = await targetRepo();
    const missing = missingRequiredStages("invoking", ["work", "pr"]);
    expect(missing).toContain("implement");
    expect(missing).toContain("ship-milestone");
    expect(missing).not.toContain("pr");
  });

  test("a reduced chain that skipped its OWN stage is still named", async () => {
    const { missingRequiredStages } = await targetRepo();
    expect([...missingRequiredStages("reduced", ["work"])]).toEqual(["pr"]);
  });

  test("the FENCE contract is unchanged for every route — the six sections, in order", async () => {
    // Consistency with the shipped STE-492 clause, sourced from that module
    // rather than retyped: a second copy of the section list is how producer
    // and consumer drift apart.
    const { fenceSectionsFor } = await targetRepo();
    for (const route of ALL_ROUTES) {
      expect([...fenceSectionsFor(route)], route).toEqual([
        ...DELIVER_STAGE_SECTIONS,
      ]);
    }
  });

  test("the empty-section fallback is the shipped literal", async () => {
    const { EMPTY_SECTION_FALLBACK } = await targetRepo();
    expect(EMPTY_SECTION_FALLBACK).toBe("- (none found)");
    expect(DELIVER_SKILL()).toContain(EMPTY_SECTION_FALLBACK);
    expect(DELIVER_REFERENCE()).toContain(EMPTY_SECTION_FALLBACK);
  });

  test("the shipped reduced-chain clause survives on BOTH surfaces, verbatim", () => {
    // AC.5 must not be "achieved" by deleting the paragraph that says a reduced
    // chain emits the same six sections.
    for (const [label, body] of [
      ["skills/deliver/SKILL.md", DELIVER_SKILL()],
      ["docs/deliver-reference.md", DELIVER_REFERENCE()],
    ] as const) {
      for (const clause of SHIPPED_REDUCED_CHAIN_CLAUSES) {
        expect(body, `${label}: shipped clause lost: ${clause}`).toContain(
          clause,
        );
      }
      expect(
        body,
        `${label}: the same-six-sections guarantee was dropped`,
      ).toContain("same six sections in the same fixed order");
    }
  });

  test("the bounded-retry-then-halt contract for SHAPE violations is untouched", () => {
    // AC.5 exempts absent STAGES, never a malformed fence. If the retry budget
    // vanished, this goes red.
    const body = DELIVER_SKILL();
    expect(
      containsInOrder(body, [
        "### Shape violations — bounded retry, then halt",
        "one scoped retry",
        "deterministic halt naming the stage",
      ]),
      "the shape-violation retry/halt contract changed",
    ).toBe(true);
  });
});

// ===========================================================================
// AC-STE-495.6 — the serial one-worker-per-milestone invariant is unchanged.
// ===========================================================================

describe("AC-STE-495.6 — multi-repo routing introduces no concurrency", () => {
  test("every route gets exactly one worker, and one at a time", async () => {
    const { routeMilestone, MAX_CONCURRENT_WORKERS } = await targetRepo();
    expect(MAX_CONCURRENT_WORKERS).toBe(1);
    const bodies: Record<MilestoneRoute, string> = {
      invoking: planBody(),
      cross_repo_toolkit: planBody([`target_repo: ${OTHER_TOOLKIT_REPO}`]),
      reduced: planBody([`target_repo: ${TOOLKIT_LESS_REPO}`]),
    };
    for (const route of ALL_ROUTES) {
      const routing = routeMilestone({
        planBody: bodies[route],
        invokingRepo: INVOKING,
        probe: fixtureProbe(),
      });
      expect(routing.route, `fixture for ${route} routed elsewhere`).toBe(route);
      expect(routing.workers, route).toBe(1);
      expect(routing.concurrency, route).toBe(MAX_CONCURRENT_WORKERS);
    }
  });

  test("the shipped serial clauses survive verbatim in skills/deliver/SKILL.md", () => {
    const body = DELIVER_SKILL();
    for (const clause of SHIPPED_SERIAL_CLAUSES_SKILL) {
      expect(body, `shipped serial clause lost: ${clause}`).toContain(clause);
    }
    expect(containsInOrder(body, SHIPPED_SERIAL_CLAUSES_SKILL)).toBe(true);
  });

  test("the shipped serial section survives in docs/deliver-reference.md", () => {
    const doc = DELIVER_REFERENCE();
    for (const clause of SHIPPED_SERIAL_CLAUSES_REFERENCE) {
      expect(doc, `shipped serial clause lost: ${clause}`).toContain(clause);
    }
    expect(containsInOrder(doc, SHIPPED_SERIAL_CLAUSES_REFERENCE)).toBe(true);
    expect(doc).toContain(
      "Wait for a worker's full chain to complete before spawning the next.",
    );
  });

  test("no `/deliver` surface grants concurrency in words", () => {
    const surfaces = DELIVER_SURFACES();
    for (const re of CONCURRENCY_ALLOWANCES) {
      expect(
        re.test(surfaces),
        `a concurrency allowance appeared: ${re}`,
      ).toBe(false);
    }
  });

  test("NON-VACUITY: the allowance patterns DO match a permissive sentence", () => {
    // Without this control, "no allowance appears" would be satisfied by
    // patterns that match nothing at all.
    const permissive =
      "For multi-repo runs you may run the milestone workers in parallel.";
    expect(CONCURRENCY_ALLOWANCES.some((re) => re.test(permissive))).toBe(true);
  });
});

// ===========================================================================
// AC-STE-495.7 — an unlocatable target repo REFUSES; it never silently falls
// back to the invoking repo.
// ===========================================================================

describe("AC-STE-495.7 — an unlocatable target repo is refused, not fallen back from", () => {
  const UNLOCATABLE = [
    "/abs/repo-that-does-not-exist",
    "../gone",
    "~/nowhere/at/all",
  ] as const;

  test("PRIMARY: routeMilestone THROWS and returns NOTHING", async () => {
    // The anti-silent-fallback leg. A router that quietly returns the invoking
    // repo returns an object here and fails right at `expect(routing)`.
    const { routeMilestone } = await targetRepo();
    for (const value of UNLOCATABLE) {
      let routing: MilestoneRouting | null = null;
      let raised: unknown = null;
      try {
        routing = routeMilestone({
          planBody: planBody([`target_repo: ${value}`]),
          invokingRepo: INVOKING,
          probe: fixtureProbe(),
        });
      } catch (e) {
        raised = e;
      }
      expect(
        routing,
        `${value}: an unlocatable target SILENTLY FELL BACK to the invoking repo`,
      ).toBeNull();
      expect(raised, `${value}: nothing was said`).not.toBeNull();
    }
  });

  test("the refusal carries the NFR-10 canonical shape and names the declaration", async () => {
    const { routeMilestone, TARGET_REPO_KEY } = await targetRepo();
    for (const value of UNLOCATABLE) {
      const msg = expectNfr10Refusal(
        () =>
          routeMilestone({
            planBody: planBody([`target_repo: ${value}`]),
            invokingRepo: INVOKING,
            probe: fixtureProbe(),
          }),
        value,
      );
      expect(msg, `${value}: the refusal never quotes the declared value`).toContain(
        value,
      );
      expect(
        msg,
        `${value}: the refusal never names the declaration key`,
      ).toContain(TARGET_REPO_KEY);
    }
  });

  test("the refusal is a NAMED error, not a bare Error", async () => {
    const { routeMilestone } = await targetRepo();
    let raised: unknown = null;
    try {
      routeMilestone({
        planBody: planBody(["target_repo: /abs/repo-that-does-not-exist"]),
        invokingRepo: INVOKING,
        probe: fixtureProbe(),
      });
    } catch (e) {
      raised = e;
    }
    expect(raised).not.toBeNull();
    expect((raised as Error).name).toMatch(/TargetRepo/);
    expect((raised as Error).message).toMatch(/Context:.*target_repo=/);
  });

  test("NON-VACUITY: the same shape assertion fails on a bare Error", () => {
    const bare = new Error("nope");
    expect(bare.message).not.toContain("Refusing:");
  });

  test("ISOLATION: a LOCATABLE target genuinely resolves, on both branches", async () => {
    // Without this, "unlocatable targets are refused" would be satisfied by a
    // router that refuses every declaration it ever sees.
    const { routeMilestone } = await targetRepo();
    const toolkit = routeMilestone({
      planBody: planBody([`target_repo: ${OTHER_TOOLKIT_REPO}`]),
      invokingRepo: INVOKING,
      probe: fixtureProbe(),
    });
    expect(toolkit.repo).toBe(OTHER_TOOLKIT_REPO);
    expect(toolkit.route).toBe("cross_repo_toolkit");

    const bare = routeMilestone({
      planBody: planBody([`target_repo: ${TOOLKIT_LESS_REPO}`]),
      invokingRepo: INVOKING,
      probe: fixtureProbe(),
    });
    expect(bare.repo).toBe(TOOLKIT_LESS_REPO);
    expect(bare.route).toBe("reduced");
  });

  test("ISOLATION: an UNDECLARED plan is never refused", async () => {
    // The refusal must be scoped to a declaration that cannot be located, not
    // to the absence of one — that would break every existing plan.
    const { routeMilestone } = await targetRepo();
    expect(() =>
      routeMilestone({
        planBody: planBody(),
        invokingRepo: INVOKING,
        probe: fixtureProbe(),
      }),
    ).not.toThrow();
  });

  test("the DEFAULT probe locates real trees and only real trees", async () => {
    // The refusal has to be grounded in the filesystem, not in a fixture stub.
    const { defaultRepoProbe } = await targetRepo();
    const probe = defaultRepoProbe(REPO_ROOT);
    expect(probe.locate(REPO_ROOT)).toBe(REPO_ROOT);
    expect(probe.locate(join(REPO_ROOT, "plugins", "dev-process-toolkit"))).toBe(
      join(REPO_ROOT, "plugins", "dev-process-toolkit"),
    );
    // Relative declarations resolve against the invoking repo.
    expect(probe.locate("plugins/dev-process-toolkit")).toBe(
      join(REPO_ROOT, "plugins", "dev-process-toolkit"),
    );
    expect(
      probe.locate("/definitely/not/a/repo/ste495"),
      "a nonexistent path was located",
    ).toBeNull();
    expect(probe.locate("no/such/sibling/ste495")).toBeNull();
  });

  test("END TO END on real disk: an unlocatable declaration refuses under the default probe", async () => {
    const { routeMilestone, defaultRepoProbe } = await targetRepo();
    expectNfr10Refusal(
      () =>
        routeMilestone({
          planBody: planBody(["target_repo: /definitely/not/a/repo/ste495"]),
          invokingRepo: REPO_ROOT,
          probe: defaultRepoProbe(REPO_ROOT),
        }),
      "default probe",
    );
  });

  test("PROSE: the surfaces state the refusal rather than a fallback", async () => {
    const { TARGET_REPO_KEY } = await targetRepo();
    const surfaces = DELIVER_SURFACES();
    expect(
      nearby(routingProse(), TARGET_REPO_KEY, "Refusing:", 900),
      "the surfaces never state a refusal for an unlocatable target repo",
    ).toBe(true);
    expect(
      /never (?:silently )?falls? back|no (?:silent )?fallback|rather than (?:silently )?falling back/i.test(
        surfaces,
      ),
      "the surfaces never rule out the silent fallback",
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-495.5 — every route's stages are ACCEPTED by the fence predicate.
//
// Found by the STE-495 refactor pass. `deliver_stage_capture` validated the
// fence's `stage:` scalar against the full-ceremony triple only, while this
// module's routing adds `work` (reduced chain) and `spec-write` (cross-repo).
// A healthy reduced-chain worker emitting `stage: work` was therefore graded
// ok:false by the very predicate that grades it — fixture group 14 would have
// false-REDded a correct reduced chain. AC.5 says a reduced chain is exempt
// from stages it never RUNS, never from the fence contract itself.
//
// The two vocabularies are now one: StageId derives from DELIVER_STAGE_IDS.
// ---------------------------------------------------------------------------

describe("AC-STE-495.5 — the fence predicate accepts every route's own stages", () => {
  const capture = (stage: string): string =>
    [
      `/${stage} M129 — worker stage report`,
      "",
      "Spawned by /deliver as a fresh visible worker; the kickoff task text",
      "carried the effort keyword, the milestone, the chain and the contract.",
      "",
      "```deliver-stage-result",
      `stage: ${stage}`,
      "milestone: M129",
      "status: ok",
      "summary:",
      "  - did the work",
      "gate:",
      "  - (none found)",
      "follow_ups:",
      "  - (none found)",
      "```",
      "",
    ].join("\n");

  const verdictFor = async (stage: string) => {
    const { verifyDeliverStageCapture } = await import(
      "../adapters/_shared/src/deliver_stage_capture"
    );
    const path = join(tmpdir(), `ste495-stage-${stage}-${process.pid}.txt`);
    writeFileSync(path, capture(stage), "utf-8");
    try {
      return verifyDeliverStageCapture(path);
    } finally {
      rmSync(path, { force: true });
    }
  };

  // Every stage of every route must be accepted — the reduced chain's `work`
  // and the cross-repo chain's `spec-write` included.
  test("every stage in every route's chain is a legal fence `stage:` value", async () => {
    const mod = await import("../adapters/_shared/src/target_repo");
    const every = new Set<string>([
      ...mod.FULL_CHAIN_STAGES,
      ...mod.CROSS_REPO_CHAIN_STAGES,
      ...mod.REDUCED_CHAIN_STAGES,
    ]);
    expect(every.size, "expected more than the full-ceremony triple").toBeGreaterThan(3);
    for (const stage of every) {
      const v = await verdictFor(stage);
      expect({ stage, ok: v.ok, reasons: [...v.reasons] }).toEqual({
        stage,
        ok: true,
        reasons: [],
      });
    }
  });

  // The two vocabularies are ONE — a second private copy is what drifted.
  test("StageId derives from the fence module's DELIVER_STAGE_IDS", async () => {
    const fence = await import("../adapters/_shared/src/deliver_stage_capture");
    const routing = await import("../adapters/_shared/src/target_repo");
    const ids = new Set<string>(fence.DELIVER_STAGE_IDS);
    for (const stage of [
      ...routing.FULL_CHAIN_STAGES,
      ...routing.CROSS_REPO_CHAIN_STAGES,
      ...routing.REDUCED_CHAIN_STAGES,
    ]) {
      expect({ stage, known: ids.has(stage) }).toEqual({ stage, known: true });
    }
    const src = readFileSync(
      join(PLUGIN_ROOT, "adapters/_shared/src/target_repo.ts"),
      "utf-8",
    );
    expect(src).toContain("DELIVER_STAGE_IDS");
  });

  // ISOLATION — the widening is not a blanket accept.
  test("a stage no route runs is still REJECTED", async () => {
    for (const bogus of ["deploy", "merge", "release"]) {
      const v = await verdictFor(bogus);
      expect({ bogus, ok: v.ok }).toEqual({ bogus, ok: false });
    }
  });
});
