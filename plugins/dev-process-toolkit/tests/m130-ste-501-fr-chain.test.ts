// M130 STE-501 — the FR-scoped chain auto-extends to the ship ceremony only
// when the FR closes its milestone.
//
// WHAT IS BROKEN, measured on this tree at authoring time (2026-08-24, v2.68.0):
//
//   * `grep -c "spec-archive" adapters/_shared/src/resume_classifier.ts` → 0.
//     `ResumeSkill` is `/spec-write | /implement | /ship-milestone | /pr | /work`.
//     There is no archive step in the vocabulary, so no chain can emit one.
//   * `resumeChain` takes a `ResumeClassification` and nothing else. Handed
//     STE-500's `FrResumeClassification` it reaches `for (const fr of
//     c.frsAwaitingReview)` on a field that does not exist there and throws —
//     which is why the FR-scoped chain legs below are RED by exception rather
//     than by a wrong value.
//   * `renderResumePlan` renders one heading line plus the numbered step list
//     and nothing else. It carries no remaining-FR count and no branch reason,
//     so AC.4 has no subject at all yet.
//   * `RunResumeInput` has no `fr` field and `ResumeTrackerSink` has no
//     `claimFr`. `runResume` classifies the MILESTONE unconditionally.
//   * STE-500 HAS shipped in this same module and is re-verified by a tripwire
//     below: `classifyResume(root, {scope:"fr",...})`, `FrResumeClassification`
//     with `lastActiveFr` / `remainingActiveFrIds` / `needsTechnicalReview`, and
//     `FR_RESUME_STATES`. So every RED here is a missing CHAIN, not a missing
//     classification.
//
// TEST STRATEGY, and why no half of it is a tautology.
//
//   * THE BOUNDARY IS DRIVEN FROM REAL TREES, IN BOTH DIRECTIONS. Every chain
//     leg classifies an on-disk fixture through the REAL shipped
//     `classifyResume` and feeds THAT object to `resumeChain`. A hand-built
//     classification would let an off-by-one in the predicate hide behind a
//     hand-set flag. One fixture where the FR is the last active one, one where
//     exactly one sibling remains, and the classification's own
//     `remainingActiveFrIds` is asserted against `milestoneFrBinding` on the
//     same tree so neither side can drift alone.
//   * AC.2'S ORDER IS A PIN, NOT A SET. The four-step chain is asserted as an
//     EXACT ORDERED SEQUENCE, and `indexOf("/spec-archive") <
//     indexOf("/ship-milestone")` is asserted separately. A chain carrying the
//     right four skills in the wrong order fails both.
//   * AC.4 IS THE VACUITY TRAP THE FR ITSELF NAMES. A render that shows only
//     the step list passes a naive `toContain("/implement")`. So every AC.4
//     assertion runs against `reasonText()` — the rendered text with the
//     numbered step lines REMOVED. Two fixtures with 3 and 7 remaining siblings
//     cross-exclude each other's digit (3 never collides with a step index
//     because the siblings-remaining chain has two steps), the two branches'
//     reason texts are asserted to DIFFER, and the count is asserted equal to
//     the real `remainingActiveFrIds.length`.
//   * AC.6 IS MUTATION-VERIFIED WITH INJECTED SINKS **AND** A BYTE SNAPSHOT.
//     Exploding spawn / inline / tracker sinks make "nothing spawned, nothing
//     claimed" OBSERVED rather than inferred, and a whole-tree byte-and-listing
//     snapshot with three falsifiability controls (rewrite / create / delete)
//     makes "not one byte changed" genuinely able to fail.
//   * AC.5 IS ASSERTED FROM BOTH SIDES. The operator's chain is asserted to
//     REACH the sinks, and the proposed chain's distinctive steps (`/implement`
//     targeting the FR, `/spec-archive`) are asserted to have reached NOTHING.
//     An implementation that runs the proposed chain anyway fails the second
//     half even though it passes nothing of the first.
//   * AC.7 IS ASSERTED ON BOTH BRANCHES AND AGAINST A SWEEP. The flagged
//     siblings fixture has a SECOND flagged FR bound to the same milestone; a
//     chain that swept the milestone's flagged FRs would emit two `/spec-write`
//     steps and fail the exact-sequence assertion.
//   * THE MILESTONE SCOPE IS PINNED BYTE-FOR-BYTE. `resumeChain`,
//     `renderResumePlan` (full `rendered` string, exactly) and `runResume` are
//     asserted against their SHIPPED output on milestone fixtures, so the
//     FR-scoped overloads cannot be bought by changing the milestone answer.
//   * FIXTURES ARE REAL TREES. Every leg runs against a `mkdtemp` `specs/` tree
//     of genuine plan + FR files with genuine frontmatter, driven through the
//     REAL shipped helpers. Nothing here stubs a helper and nothing here
//     touches the toolkit repo.
//
// DELIBERATE OMISSIONS.
//   * NO `/gate-check` probe-count pin. This FR registers no probe.
//   * NO SKILL.md line-cap or roster pin. This FR ships no prose surface;
//     STE-502 documents the finished behaviour.
//   * NO merge-routing assertion. The FR's Notes put merging explicitly out of
//     scope: the chain ends at `/pr` on both branches.
//   * NO type-level assertion that `ResumeSkill` gained `"/spec-archive"` — a
//     union member is erased at runtime. It is pinned BEHAVIOURALLY instead, by
//     the emitted step's `skill` string.

import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

// The shipped enumeration the last-active predicate must agree with. Called
// DIRECTLY below so the boundary is pinned to the shipped binding, not to a
// number this file made up.
import { milestoneFrBinding } from "../adapters/_shared/src/active_plan_ship_ready";

// ===========================================================================
// Paths.
// ===========================================================================

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");
const SHARED_SRC = join(PLUGIN_ROOT, "adapters", "_shared", "src");

const read = (p: string): string => readFileSync(p, "utf-8");

const RESUME_MODULE = "../adapters/_shared/src/resume_classifier";
const RESUME_MODULE_FILE = join(SHARED_SRC, "resume_classifier.ts");

/**
 * The FR under test, resolved with the ARCHIVE FALLBACK. `/implement` Phase 4
 * `git mv`s the FR into `specs/frs/archive/` at milestone close; a meta-test
 * that only knows the active path goes red at the archive commit.
 */
function frPath(): string {
  const active = join(REPO_ROOT, "specs", "frs", "STE-501.md");
  if (existsSync(active)) return active;
  const archived = join(REPO_ROOT, "specs", "frs", "archive", "STE-501.md");
  if (existsSync(archived)) return archived;
  throw new Error("STE-501.md found in neither specs/frs/ nor specs/frs/archive/");
}

// ===========================================================================
// The module under test, imported LAZILY and typed against the INTENDED shape.
//
// `resume_classifier.ts` ships, but `resumeChain` / `renderResumePlan` /
// `runResume` know nothing of FR scope. Declaring the intended overloads here
// keeps the file loadable so the reds below are per-AC rather than one
// collapsed type/load error.
// ===========================================================================

type ResumeState =
  | "needs_technical_review"
  | "ready_to_implement"
  | "partly_implemented"
  | "ship_ready"
  | "shipped"
  | "parked";

type FrResumeState = "needs_technical_review" | "ready_to_implement";

/** `"/spec-archive"` is the member this FR adds. */
type ResumeSkill =
  | "/spec-write"
  | "/implement"
  | "/spec-archive"
  | "/ship-milestone"
  | "/pr"
  | "/work";

type StepPlacement = "inline" | "worker";

type ResumeRoute = "invoking" | "cross_repo_toolkit" | "reduced";

interface ResumeChainStep {
  readonly skill: ResumeSkill;
  readonly placement: StepPlacement;
  readonly target: string;
}

interface ResumeClassification {
  readonly milestone: string;
  readonly state: ResumeState;
  readonly frsAwaitingReview: readonly string[];
}

interface FrResumeClassification {
  readonly scope: "fr";
  readonly fr: string;
  readonly milestone: string;
  readonly state: FrResumeState;
  readonly lastActiveFr: boolean;
  readonly remainingActiveFrIds: readonly string[];
  readonly needsTechnicalReview: boolean;
  readonly reviewConsistencyViolations: readonly string[];
}

interface FrScopeInput {
  readonly scope: "fr";
  readonly fr: string;
  readonly milestone: string;
}

interface ResumePlan {
  readonly milestone: string;
  readonly chain: readonly ResumeChainStep[];
  readonly rendered: string;
}

type ResumeGateDecision = "confirm" | "edit" | "abort";

interface ResumeGateAnswer {
  readonly decision: ResumeGateDecision;
  readonly chain?: readonly ResumeChainStep[];
}

interface ResumeOperatorGate {
  present(plan: ResumePlan): ResumeGateAnswer;
}

interface ResumeSpawn {
  readonly milestone: string;
  readonly chain: readonly ResumeChainStep[];
}

interface ResumeSpawnSink {
  spawnWorker(spawn: ResumeSpawn): void;
}

interface ResumeInlineSink {
  runInline(step: ResumeChainStep): void;
}

/** `claimFr` is the OPTIONAL addition; `claimMilestone` is the shipped field. */
interface ResumeTrackerSink {
  claimMilestone(milestone: string): void;
  claimFr?(fr: string): void;
}

interface RunResumeInput {
  readonly projectRoot: string;
  readonly milestone: string;
  /** OPTIONAL, and its presence is what selects FR scope. */
  readonly fr?: string;
  readonly gate: ResumeOperatorGate;
  readonly spawn: ResumeSpawnSink;
  readonly inline: ResumeInlineSink;
  readonly tracker: ResumeTrackerSink;
}

interface ResumeRunOutcome {
  readonly decision: ResumeGateDecision;
  readonly milestone: string;
  readonly plan: ResumePlan;
  readonly chain: readonly ResumeChainStep[];
  readonly milestones: number;
  readonly concurrency: number;
}

interface ResumeClassifierModule {
  classifyResume(projectRoot: string, milestone: string): Promise<ResumeClassification>;
  classifyResume(
    projectRoot: string,
    input: FrScopeInput,
  ): Promise<FrResumeClassification>;
  resumeChain(
    c: ResumeClassification,
    route?: ResumeRoute,
  ): readonly ResumeChainStep[];
  resumeChain(
    c: FrResumeClassification,
    route?: ResumeRoute,
  ): readonly ResumeChainStep[];
  renderResumePlan(c: ResumeClassification): ResumePlan;
  renderResumePlan(c: FrResumeClassification): ResumePlan;
  runResume(input: RunResumeInput): Promise<ResumeRunOutcome>;
}

async function resumeMod(): Promise<ResumeClassifierModule> {
  return (await import(RESUME_MODULE)) as unknown as ResumeClassifierModule;
}

/** Classify at FR scope through the SHIPPED STE-500 entry point. */
async function classifyFr(
  root: string,
  fr: string,
  milestone: string,
): Promise<FrResumeClassification> {
  const { classifyResume } = await resumeMod();
  return classifyResume(root, { scope: "fr", fr, milestone });
}

/** Classify at FR scope and build its chain — the one call shape most legs use. */
async function frChain(
  root: string,
  fr: string,
  milestone: string,
  route?: ResumeRoute,
): Promise<readonly ResumeChainStep[]> {
  const { resumeChain } = await resumeMod();
  const c = await classifyFr(root, fr, milestone);
  return route === undefined ? resumeChain(c) : resumeChain(c, route);
}

// ===========================================================================
// On-disk fixture trees — real plans, real FRs, real frontmatter.
// ===========================================================================

const MILESTONE = "M700";
const OTHER_MILESTONE = "M701";

interface FrSpec {
  readonly id: string;
  readonly milestone: string;
  readonly needsReview?: boolean;
  readonly archived?: boolean;
}

interface PlanSpec {
  readonly milestone: string;
  readonly archived?: boolean;
  readonly shippedIn?: string;
  readonly totalTasks?: number;
  readonly checkedTasks?: number;
}

interface TreeSpec {
  readonly plans: readonly PlanSpec[];
  readonly frs: readonly FrSpec[];
}

const REVIEW_PLACEHOLDER =
  "[needs technical review — run /spec-write <FR-id> to complete]";

function frBody(spec: FrSpec): string {
  // The consistency invariant the shipped probe polices: flag ⇒ placeholder
  // body, no flag ⇒ real body. Every fixture here honours it, so no leg is
  // perturbed by an unrelated NFR-10 violation.
  const flagged = spec.needsReview === true;
  const body = flagged ? REVIEW_PLACEHOLDER : "Real content, written.";
  const fm = ["---", `title: ${spec.id}`, `milestone: ${spec.milestone}`];
  fm.push(spec.archived === true ? "status: archived" : "status: active");
  fm.push(spec.archived === true ? "archived_at: 2026-08-24" : "archived_at: null");
  if (flagged) fm.push("needs_technical_review: true");
  fm.push("---");
  return [
    ...fm,
    "",
    `# ${spec.id}`,
    "",
    "## Requirement",
    "",
    "Something.",
    "",
    "## Acceptance Criteria",
    "",
    `- AC-${spec.id}.1: something.`,
    "",
    "## Technical Design",
    "",
    body,
    "",
    "## Testing",
    "",
    body,
    "",
    "## Notes",
    "",
    "None.",
    "",
  ].join("\n");
}

function planBody(spec: PlanSpec): string {
  const fm = ["---", `milestone: ${spec.milestone}`];
  fm.push(spec.archived === true ? "status: archived" : "status: active");
  fm.push(`shipped_in: ${spec.shippedIn ?? "null"}`);
  fm.push("---");
  const total = spec.totalTasks ?? 0;
  const checked = spec.checkedTasks ?? 0;
  const tasks: string[] = [];
  for (let i = 0; i < total; i++) {
    tasks.push(`- [${i < checked ? "x" : " "}] task ${i + 1}`);
  }
  return [...fm, "", `# ${spec.milestone}`, "", "## Tasks", "", ...tasks, ""].join(
    "\n",
  );
}

function writeFileAt(root: string, rel: string, content: string): void {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

function buildTree(spec: TreeSpec): string {
  const root = mkdtempSync(join(tmpdir(), "ste501-"));
  mkdirSync(join(root, "specs", "plan", "archive"), { recursive: true });
  mkdirSync(join(root, "specs", "frs", "archive"), { recursive: true });
  for (const plan of spec.plans) {
    const rel =
      plan.archived === true
        ? join("specs", "plan", "archive", `${plan.milestone}.md`)
        : join("specs", "plan", `${plan.milestone}.md`);
    writeFileAt(root, rel, planBody(plan));
  }
  for (const fr of spec.frs) {
    const rel =
      fr.archived === true
        ? join("specs", "frs", "archive", `${fr.id}.md`)
        : join("specs", "frs", `${fr.id}.md`);
    writeFileAt(root, rel, frBody(fr));
  }
  writeFileAt(root, "CHANGELOG.md", ["# Changelog", ""].join("\n"));
  return root;
}

/** Build a tree, hand it to `fn`, then delete it whatever happens. */
async function withTree(
  spec: TreeSpec,
  fn: (root: string) => Promise<void>,
): Promise<void> {
  const root = buildTree(spec);
  try {
    await fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** N active sibling FRs bound to `MILESTONE`, ids `<prefix><n>`. */
function siblings(prefix: number, count: number): FrSpec[] {
  const out: FrSpec[] = [];
  for (let i = 1; i <= count; i++) {
    out.push({ id: `STE-${prefix + i}`, milestone: MILESTONE });
  }
  return out;
}

// --- The FR-scoped fixtures. Their sibling counts deliberately DIFFER. ------

/** The FR under work is the ONLY active FR bound — building it closes M700. */
const FR_LAST = "STE-700";
const TREE_LAST_ACTIVE: TreeSpec = {
  plans: [
    { milestone: MILESTONE, totalTasks: 4, checkedTasks: 1 },
    { milestone: OTHER_MILESTONE, totalTasks: 2 },
  ],
  frs: [
    { id: FR_LAST, milestone: MILESTONE },
    // Archived here, and active elsewhere: neither may count as a sibling.
    { id: "STE-701", milestone: MILESTONE, archived: true },
    { id: "STE-702", milestone: OTHER_MILESTONE },
  ],
};

/** Exactly ONE sibling still active — the off-by-one's other side. */
const FR_SIB1 = "STE-710";
const TREE_ONE_SIBLING: TreeSpec = {
  plans: [{ milestone: MILESTONE, totalTasks: 3 }],
  frs: [
    { id: FR_SIB1, milestone: MILESTONE },
    { id: "STE-711", milestone: MILESTONE },
    { id: "STE-712", milestone: OTHER_MILESTONE },
  ],
};

/** THREE siblings — AC.4's count is then neither 0 nor 1 by luck. */
const FR_SIB3 = "STE-720";
const TREE_THREE_SIBLINGS: TreeSpec = {
  plans: [{ milestone: MILESTONE, totalTasks: 7, checkedTasks: 2 }],
  frs: [
    { id: FR_SIB3, milestone: MILESTONE },
    { id: "STE-723", milestone: MILESTONE },
    { id: "STE-721", milestone: MILESTONE },
    { id: "STE-722", milestone: MILESTONE },
    { id: "STE-724", milestone: OTHER_MILESTONE },
    { id: "STE-725", milestone: MILESTONE, archived: true },
  ],
};

/** SEVEN siblings — the cross-exclusion partner for the count assertion. */
const FR_SIB7 = "STE-730";
const TREE_SEVEN_SIBLINGS: TreeSpec = {
  plans: [{ milestone: MILESTONE, totalTasks: 2 }],
  frs: [{ id: FR_SIB7, milestone: MILESTONE }, ...siblings(730, 7)],
};

/** Flagged AND last active — AC.7 on the extended branch. */
const FR_FLAG_LAST = "STE-740";
const TREE_FLAGGED_LAST: TreeSpec = {
  plans: [
    { milestone: MILESTONE, totalTasks: 2 },
    { milestone: OTHER_MILESTONE, totalTasks: 1 },
  ],
  frs: [
    { id: FR_FLAG_LAST, milestone: MILESTONE, needsReview: true },
    // Flagged, but bound elsewhere: must not reach this FR's chain.
    { id: "STE-741", milestone: OTHER_MILESTONE, needsReview: true },
    { id: "STE-742", milestone: MILESTONE, archived: true },
  ],
};

/**
 * Flagged, with siblings — AC.7 on the short branch AND the no-sweep pin: a
 * SECOND flagged FR is bound to the same milestone, so a chain that swept the
 * milestone's flagged FRs would emit two `/spec-write` steps.
 */
const FR_FLAG_SIB = "STE-750";
const FR_FLAG_SIBLING_ALSO_FLAGGED = "STE-751";
const TREE_FLAGGED_SIBLINGS: TreeSpec = {
  plans: [{ milestone: MILESTONE, totalTasks: 3 }],
  frs: [
    { id: FR_FLAG_SIB, milestone: MILESTONE, needsReview: true },
    { id: FR_FLAG_SIBLING_ALSO_FLAGGED, milestone: MILESTONE, needsReview: true },
    { id: "STE-752", milestone: MILESTONE },
  ],
};

// --- The milestone-scoped fixtures, for the "unchanged" pins. ---------------

const MS_READY_FR = "STE-760";
const TREE_MS_READY: TreeSpec = {
  plans: [{ milestone: MILESTONE, totalTasks: 3 }],
  frs: [{ id: MS_READY_FR, milestone: MILESTONE }],
};

const MS_FLAGGED_FR = "STE-770";
const TREE_MS_REVIEW: TreeSpec = {
  plans: [{ milestone: MILESTONE, totalTasks: 3 }],
  frs: [
    { id: MS_FLAGGED_FR, milestone: MILESTONE, needsReview: true },
    { id: "STE-771", milestone: MILESTONE },
  ],
};

// ===========================================================================
// Sinks — injected, so "nothing happened" is OBSERVED, not inferred.
// ===========================================================================

function recordingSpawn(): ResumeSpawnSink & { spawns: ResumeSpawn[] } {
  const spawns: ResumeSpawn[] = [];
  return {
    spawns,
    spawnWorker(spawn: ResumeSpawn): void {
      spawns.push(spawn);
    },
  };
}

function recordingInline(): ResumeInlineSink & { steps: ResumeChainStep[] } {
  const steps: ResumeChainStep[] = [];
  return {
    steps,
    runInline(step: ResumeChainStep): void {
      steps.push(step);
    },
  };
}

/** A tracker that offers BOTH channels, and records which one was used. */
function recordingTracker(): ResumeTrackerSink & {
  milestoneClaims: string[];
  frClaims: string[];
} {
  const milestoneClaims: string[] = [];
  const frClaims: string[] = [];
  return {
    milestoneClaims,
    frClaims,
    claimMilestone(milestone: string): void {
      milestoneClaims.push(milestone);
    },
    claimFr(fr: string): void {
      frClaims.push(fr);
    },
  };
}

/** A tracker with ONLY the shipped channel — the fallback leg's subject. */
function milestoneOnlyTracker(): ResumeTrackerSink & { milestoneClaims: string[] } {
  const milestoneClaims: string[] = [];
  return {
    milestoneClaims,
    claimMilestone(milestone: string): void {
      milestoneClaims.push(milestone);
    },
  };
}

function explodingSpawn(): ResumeSpawnSink {
  return {
    spawnWorker(): void {
      throw new Error("a worker was SPAWNED when none must be");
    },
  };
}

function explodingInline(): ResumeInlineSink {
  return {
    runInline(): void {
      throw new Error("an inline step RAN when none must");
    },
  };
}

function explodingTracker(): ResumeTrackerSink {
  return {
    claimMilestone(): void {
      throw new Error("a MILESTONE tracker claim was made when none must be");
    },
    claimFr(): void {
      throw new Error("an FR tracker claim was made when none must be");
    },
  };
}

function fixedGate(
  decision: ResumeGateDecision,
  chain?: readonly ResumeChainStep[],
): ResumeOperatorGate & { presented: ResumePlan[] } {
  const presented: ResumePlan[] = [];
  return {
    presented,
    present(plan: ResumePlan): ResumeGateAnswer {
      presented.push(plan);
      return chain === undefined ? { decision } : { decision, chain };
    },
  };
}

// ===========================================================================
// Snapshot machinery — AC.6's byte-level leg.
// ===========================================================================

/** Every file's bytes AND the full directory listing, as one comparable map. */
function snapshot(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string, prefix: string): void => {
    const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    for (const e of entries) {
      const rel = prefix === "" ? e.name : `${prefix}/${e.name}`;
      const abs = join(dir, e.name);
      if (statSync(abs).isDirectory()) {
        out[`dir:${rel}`] = "";
        walk(abs, rel);
      } else {
        out[`file:${rel}`] = readFileSync(abs, "utf-8");
      }
    }
  };
  walk(root, "");
  return out;
}

/** Run `fn` against a fresh tree and assert not one byte moved. */
async function assertReadOnly(
  spec: TreeSpec,
  label: string,
  fn: (root: string) => Promise<void>,
): Promise<void> {
  await withTree(spec, async (root) => {
    const before = snapshot(root);
    await fn(root);
    const after = snapshot(root);
    expect(
      Object.keys(after).sort(),
      `${label}: the directory LISTING changed — a file was created or removed`,
    ).toEqual(Object.keys(before).sort());
    expect(after, `${label}: a file's BYTES changed`).toEqual(before);
  });
}

// ===========================================================================
// Chain + render helpers.
// ===========================================================================

/** Steps as `<skill>@<placement>:<target>` — compact, ORDER-PRESERVING. */
function stepKeys(steps: readonly ResumeChainStep[]): string[] {
  return steps.map((s) => `${s.skill}@${s.placement}:${s.target}`);
}

/** Just the skills, in order — for the `indexOf` ordering pin. */
function skills(steps: readonly ResumeChainStep[]): string[] {
  return steps.map((s) => s.skill);
}

/**
 * The rendered plan MINUS its numbered step lines.
 *
 * This is AC.4's whole point and it is not fussiness: the FR names "a render
 * that shows only the step list" as the vacuity to avoid, and every count /
 * reason assertion below therefore runs against THIS, never against the raw
 * `rendered`. Stripping the step lines also removes the step INDICES, so a
 * digit found here is prose, not numbering.
 */
function reasonText(rendered: string): string {
  return rendered
    .split("\n")
    .filter((line) => !/^\s*\d+\.\s+\//.test(line))
    .join("\n");
}

/** A standalone decimal number, so `3` does not match inside `STE-723`. */
function hasCount(text: string, n: number): boolean {
  return new RegExp(`(?<![\\w-])${n}(?![\\w-])`).test(text);
}

// ===========================================================================
// TRIPWIRES — the premises every assertion below rides on.
// ===========================================================================

describe("TRIPWIRE — premises this FR's tests rest on", () => {
  test("the FR still names all SEVEN ACs this file is written against", () => {
    const fr = read(frPath());
    for (let n = 1; n <= 7; n++) {
      expect(fr, `AC-STE-501.${n} missing from the FR`).toContain(`AC-STE-501.${n}:`);
    }
  });

  test("PREMISE: STE-500's FR-scoped classification really ships", async () => {
    // Every chain leg feeds a REAL classification into `resumeChain`. If STE-500
    // regressed, those legs would fail for the wrong reason and this says so.
    const { classifyResume } = await resumeMod();
    expect(typeof classifyResume).toBe("function");
    await withTree(TREE_ONE_SIBLING, async (root) => {
      const c = await classifyFr(root, FR_SIB1, MILESTONE);
      expect(c.scope).toBe("fr");
      expect(c.fr).toBe(FR_SIB1);
      expect(c.milestone).toBe(MILESTONE);
      expect(typeof c.lastActiveFr).toBe("boolean");
      expect(Array.isArray(c.remainingActiveFrIds)).toBe(true);
    });
  });

  test("PREMISE: the fixtures really carry 0 / 1 / 3 / 7 remaining siblings", async () => {
    // If the fixture shape drifted, the boundary legs would compare two equally
    // wrong numbers and pass.
    const legs: readonly (readonly [TreeSpec, string, number])[] = [
      [TREE_LAST_ACTIVE, FR_LAST, 0],
      [TREE_ONE_SIBLING, FR_SIB1, 1],
      [TREE_THREE_SIBLINGS, FR_SIB3, 3],
      [TREE_SEVEN_SIBLINGS, FR_SIB7, 7],
    ];
    const seen = new Set<number>();
    for (const [spec, fr, expected] of legs) {
      await withTree(spec, async (root) => {
        const binding = await milestoneFrBinding(root, MILESTONE);
        const remaining = binding.activeFrIds.filter((id) => id !== fr);
        expect(
          remaining.length,
          `fixture premise: ${fr} should have ${expected} active sibling(s)`,
        ).toBe(expected);
        expect(
          binding.activeFrIds.includes(fr),
          `fixture premise: ${fr} is not bound to ${MILESTONE}`,
        ).toBe(true);
        seen.add(remaining.length);
      });
    }
    expect(seen.size, "the fixtures did not actually differ").toBe(4);
  });

  test("PREMISE: the milestone fixtures classify to the states their pins assume", async () => {
    const { classifyResume } = await resumeMod();
    await withTree(TREE_MS_READY, async (root) => {
      expect((await classifyResume(root, MILESTONE)).state).toBe("ready_to_implement");
    });
    await withTree(TREE_MS_REVIEW, async (root) => {
      const c = await classifyResume(root, MILESTONE);
      expect(c.state).toBe("needs_technical_review");
      expect([...c.frsAwaitingReview]).toEqual([MS_FLAGGED_FR]);
    });
  });

  test("PREMISE: `reasonText` really strips step lines, and `hasCount` is anchored", () => {
    // Without this, the AC.4 legs could be measuring the raw render (which
    // carries step indices) or matching a digit inside an FR id.
    const rendered = [
      "Resume STE-720 in M700 — 3 active FRs remain",
      "",
      "  1. /implement STE-720 (worker)",
      "  2. /pr M700 (worker)",
    ].join("\n");
    const reason = reasonText(rendered);
    expect(reason, "a step line survived the strip").not.toContain("/implement STE-720");
    expect(reason, "a step line survived the strip").not.toContain("/pr M700");
    expect(reason).toContain("3 active FRs remain");

    expect(hasCount("3 active FRs remain", 3)).toBe(true);
    expect(hasCount("STE-723 remains", 3), "matched a digit inside an FR id").toBe(
      false,
    );
    expect(hasCount("3 active FRs remain", 7)).toBe(false);
  });
});

// ===========================================================================
// AC-STE-501.6 — aborting at the gate leaves no side effects.
//
// Written FIRST after the tripwires because it is the AC that most easily reads
// green by accident, and its falsifiability controls come before its assertions.
// ===========================================================================

describe("AC-STE-501.6 — abort: nothing spawned, nothing claimed, not one byte", () => {
  test("CONTROL: the snapshot comparison DETECTS a rewrite, a create, and a delete", async () => {
    // Without this, every "not one byte changed" assertion below could be
    // satisfied by a snapshot that compares nothing.
    await withTree(TREE_LAST_ACTIVE, async (root) => {
      const before = snapshot(root);

      const planFile = join(root, "specs", "plan", `${MILESTONE}.md`);
      writeFileSync(planFile, `${read(planFile)}\n- [ ] injected task\n`);
      expect(snapshot(root), "a REWRITE went undetected").not.toEqual(before);
      writeFileSync(planFile, before[`file:specs/plan/${MILESTONE}.md`]!);
      expect(snapshot(root), "restoring did not restore").toEqual(before);

      writeFileSync(join(root, "specs", "frs", "STE-798.md"), "x");
      expect(snapshot(root), "a NEW FILE went undetected").not.toEqual(before);
      rmSync(join(root, "specs", "frs", "STE-798.md"));

      rmSync(join(root, "specs", "frs", `${FR_LAST}.md`));
      expect(snapshot(root), "a DELETION went undetected").not.toEqual(before);
    });
  });

  test("CONTROL: the exploding sinks really throw when touched", () => {
    // Without this, "nothing spawned" could be satisfied by sinks that are
    // silently inert rather than by an implementation that never calls them.
    expect(() => explodingSpawn().spawnWorker({ milestone: MILESTONE, chain: [] })).toThrow(
      /SPAWNED/,
    );
    expect(() =>
      explodingInline().runInline({
        skill: "/spec-write",
        placement: "inline",
        target: FR_LAST,
      }),
    ).toThrow(/inline step RAN/);
    expect(() => explodingTracker().claimMilestone(MILESTONE)).toThrow(/MILESTONE/);
    expect(() => explodingTracker().claimFr!(FR_LAST)).toThrow(/FR tracker claim/);
  });

  test("abort on the LAST-ACTIVE branch spawns nothing, claims nothing, writes nothing", async () => {
    const { runResume } = await resumeMod();
    await assertReadOnly(TREE_LAST_ACTIVE, "abort / last active", async (root) => {
      const gate = fixedGate("abort");
      const outcome = await runResume({
        projectRoot: root,
        milestone: MILESTONE,
        fr: FR_LAST,
        gate,
        spawn: explodingSpawn(),
        inline: explodingInline(),
        tracker: explodingTracker(),
      });
      expect(gate.presented.length, "the operator was never shown the plan").toBe(1);
      // Without this the leg would be satisfied by a run that ignored `fr`
      // entirely and aborted a MILESTONE-scoped plan.
      expect(
        stepKeys(gate.presented[0]!.chain),
        "the operator was shown the milestone chain — `fr` was ignored",
      ).toEqual(stepKeys(await frChain(root, FR_LAST, MILESTONE)));
      expect(outcome.decision).toBe("abort");
      expect(
        [...outcome.chain],
        "abort reported a chain — something was meant to run",
      ).toEqual([]);
    });
  });

  test("abort on the SIBLINGS-REMAINING branch does the same", async () => {
    const { runResume } = await resumeMod();
    await assertReadOnly(TREE_THREE_SIBLINGS, "abort / siblings", async (root) => {
      const gate = fixedGate("abort");
      const outcome = await runResume({
        projectRoot: root,
        milestone: MILESTONE,
        fr: FR_SIB3,
        gate,
        spawn: explodingSpawn(),
        inline: explodingInline(),
        tracker: explodingTracker(),
      });
      expect(
        stepKeys(gate.presented[0]!.chain),
        "the operator was shown the milestone chain — `fr` was ignored",
      ).toEqual(stepKeys(await frChain(root, FR_SIB3, MILESTONE)));
      expect(outcome.decision).toBe("abort");
      expect([...outcome.chain]).toEqual([]);
    });
  });

  test("abort on a FLAGGED FR does not run the inline `/spec-write` head either", async () => {
    // The flagged branch is the one with an INLINE step, so it is the branch
    // where a "run the inline steps, then ask" ordering bug would show.
    const { runResume } = await resumeMod();
    await assertReadOnly(TREE_FLAGGED_LAST, "abort / flagged", async (root) => {
      const gate = fixedGate("abort");
      const outcome = await runResume({
        projectRoot: root,
        milestone: MILESTONE,
        fr: FR_FLAG_LAST,
        gate,
        spawn: explodingSpawn(),
        inline: explodingInline(),
        tracker: explodingTracker(),
      });
      expect(
        stepKeys(gate.presented[0]!.chain),
        "the operator was shown the milestone chain — `fr` was ignored",
      ).toEqual(stepKeys(await frChain(root, FR_FLAG_LAST, MILESTONE)));
      expect(outcome.decision).toBe("abort");
      expect([...outcome.chain]).toEqual([]);
    });
  });

  test("ISOLATION: the SAME fixtures DO spawn and claim on confirm", async () => {
    // Without this, "abort spawns nothing" is satisfied by an implementation
    // that never spawns at all.
    const { runResume } = await resumeMod();
    await withTree(TREE_LAST_ACTIVE, async (root) => {
      const spawn = recordingSpawn();
      const tracker = recordingTracker();
      await runResume({
        projectRoot: root,
        milestone: MILESTONE,
        fr: FR_LAST,
        gate: fixedGate("confirm"),
        spawn,
        inline: recordingInline(),
        tracker,
      });
      expect(spawn.spawns.length, "confirm spawned nothing either").toBe(1);
      expect(
        tracker.frClaims.length + tracker.milestoneClaims.length,
        "confirm claimed nothing either",
      ).toBeGreaterThan(0);
    });
  });
});

// ===========================================================================
// AC-STE-501.1 — siblings remain ⇒ `/implement <FR-id>` then `/pr`.
// ===========================================================================

describe("AC-STE-501.1 — the short chain when other active FRs remain", () => {
  test("ONE SIBLING: the chain is exactly `/implement <FR>` then `/pr`", async () => {
    await withTree(TREE_ONE_SIBLING, async (root) => {
      const c = await classifyFr(root, FR_SIB1, MILESTONE);
      expect(c.lastActiveFr, "fixture premise: a sibling is still active").toBe(false);
      const chain = await frChain(root, FR_SIB1, MILESTONE);
      expect(stepKeys(chain)).toEqual([
        `/implement@worker:${FR_SIB1}`,
        `/pr@worker:${MILESTONE}`,
      ]);
    });
  });

  test("`/implement` targets THE FR, not the milestone", async () => {
    // A chain that implements the whole milestone would build the siblings too
    // and is the mistake this AC exists to prevent.
    await withTree(TREE_THREE_SIBLINGS, async (root) => {
      const chain = await frChain(root, FR_SIB3, MILESTONE);
      const implement = chain.find((s) => s.skill === "/implement");
      expect(implement, "no `/implement` step at all").toBeDefined();
      expect(implement!.target, "`/implement` targets the milestone, not the FR").toBe(
        FR_SIB3,
      );
    });
  });

  test("the short chain carries NO ship ceremony — neither archive nor ship", async () => {
    for (const [spec, fr] of [
      [TREE_ONE_SIBLING, FR_SIB1],
      [TREE_THREE_SIBLINGS, FR_SIB3],
      [TREE_SEVEN_SIBLINGS, FR_SIB7],
    ] as const) {
      await withTree(spec, async (root) => {
        const chain = await frChain(root, fr, MILESTONE);
        expect(
          skills(chain),
          `${fr}: a milestone with active FRs left was routed into the ceremony`,
        ).not.toContain("/ship-milestone");
        expect(skills(chain)).not.toContain("/spec-archive");
        expect(chain.length, `${fr}: the short chain is not two steps`).toBe(2);
      });
    }
  });

  test("BOUNDARY: the predicate driving the branch is the SHIPPED enumeration", async () => {
    // Both directions, and each direction's chain length is derived from the
    // shipped binding rather than from a constant this file chose.
    const legs: readonly (readonly [TreeSpec, string])[] = [
      [TREE_LAST_ACTIVE, FR_LAST],
      [TREE_ONE_SIBLING, FR_SIB1],
      [TREE_THREE_SIBLINGS, FR_SIB3],
      [TREE_SEVEN_SIBLINGS, FR_SIB7],
    ];
    const lengths = new Set<number>();
    for (const [spec, fr] of legs) {
      await withTree(spec, async (root) => {
        const binding = await milestoneFrBinding(root, MILESTONE);
        const truthRemaining = binding.activeFrIds.filter((id) => id !== fr);
        const c = await classifyFr(root, fr, MILESTONE);
        expect(
          [...c.remainingActiveFrIds],
          `${fr}: the classification disagrees with milestoneFrBinding`,
        ).toEqual(truthRemaining.slice().sort());

        const chain = await frChain(root, fr, MILESTONE);
        lengths.add(chain.length);
        expect(
          chain.length,
          `${fr}: ${truthRemaining.length} sibling(s) remain, so the chain length is wrong`,
        ).toBe(truthRemaining.length === 0 ? 4 : 2);
      });
    }
    expect(lengths, "both branches were not exercised").toEqual(new Set([2, 4]));
  });
});

// ===========================================================================
// AC-STE-501.2 + AC-STE-501.3 — the last active FR extends through archival.
// ===========================================================================

describe("AC-STE-501.2 — the extended chain when the FR closes its milestone", () => {
  test("the chain is EXACTLY implement → spec-archive → ship-milestone → pr", async () => {
    await withTree(TREE_LAST_ACTIVE, async (root) => {
      const c = await classifyFr(root, FR_LAST, MILESTONE);
      expect(c.lastActiveFr, "fixture premise: this is the last active FR").toBe(true);
      const chain = await frChain(root, FR_LAST, MILESTONE);
      expect(stepKeys(chain)).toEqual([
        `/implement@worker:${FR_LAST}`,
        `/spec-archive@worker:${MILESTONE}`,
        `/ship-milestone@worker:${MILESTONE}`,
        `/pr@worker:${MILESTONE}`,
      ]);
    });
  });

  test("ORDER IS A PIN, NOT A SET: archive comes strictly BEFORE ship", async () => {
    // A chain carrying the right four skills in the wrong order would satisfy a
    // set assertion and would archive a milestone that was already released.
    await withTree(TREE_LAST_ACTIVE, async (root) => {
      const order = skills(await frChain(root, FR_LAST, MILESTONE));
      const archiveAt = order.indexOf("/spec-archive");
      const shipAt = order.indexOf("/ship-milestone");
      const prAt = order.indexOf("/pr");
      const implementAt = order.indexOf("/implement");
      expect(archiveAt, "no `/spec-archive` step").toBeGreaterThanOrEqual(0);
      expect(shipAt, "no `/ship-milestone` step").toBeGreaterThanOrEqual(0);
      expect(
        archiveAt < shipAt,
        "`/spec-archive` does not come before `/ship-milestone`",
      ).toBe(true);
      expect(
        implementAt < archiveAt,
        "the FR is archived before it is implemented",
      ).toBe(true);
      expect(shipAt < prAt, "the PR is opened before the release commit exists").toBe(
        true,
      );
    });
  });

  test("the ceremony steps target the MILESTONE, and only `/implement` targets the FR", async () => {
    await withTree(TREE_LAST_ACTIVE, async (root) => {
      const chain = await frChain(root, FR_LAST, MILESTONE);
      for (const step of chain) {
        const expected = step.skill === "/implement" ? FR_LAST : MILESTONE;
        expect(step.target, `${step.skill} targets the wrong subject`).toBe(expected);
      }
    });
  });

  test("every extended step runs in a WORKER — none is inline", async () => {
    await withTree(TREE_LAST_ACTIVE, async (root) => {
      const chain = await frChain(root, FR_LAST, MILESTONE);
      expect(chain.map((s) => s.placement)).toEqual([
        "worker",
        "worker",
        "worker",
        "worker",
      ]);
    });
  });
});

describe("AC-STE-501.3 — `/spec-archive` is an explicit step, and the reason is written down", () => {
  test("BEHAVIOUR: the last-active chain does not jump from implement to ship", async () => {
    await withTree(TREE_LAST_ACTIVE, async (root) => {
      const order = skills(await frChain(root, FR_LAST, MILESTONE));
      const implementAt = order.indexOf("/implement");
      expect(
        order[implementAt + 1],
        "the chain goes straight from a single-FR implement to the ship ceremony — " +
          "`active_plan_ship_ready` would refuse it",
      ).toBe("/spec-archive");
    });
  });

  test("BEHAVIOUR: the archive step is absent exactly when the FR is NOT the last", async () => {
    // Isolation for the step above: an archive step emitted unconditionally
    // would bulk-archive a milestone whose siblings are still open.
    for (const [spec, fr, wantArchive] of [
      [TREE_LAST_ACTIVE, FR_LAST, true],
      [TREE_ONE_SIBLING, FR_SIB1, false],
      [TREE_THREE_SIBLINGS, FR_SIB3, false],
      [TREE_FLAGGED_LAST, FR_FLAG_LAST, true],
      [TREE_FLAGGED_SIBLINGS, FR_FLAG_SIB, false],
    ] as const) {
      await withTree(spec, async (root) => {
        const has = skills(await frChain(root, fr, MILESTONE)).includes("/spec-archive");
        expect(has, `${fr}: the archive step's presence is wrong`).toBe(wantArchive);
      });
    }
  });

  test("DISCOVERABLE: the module records WHY the archive step exists", async () => {
    // The FR puts the reason in the AC precisely because it is non-obvious: a
    // single-FR `/implement` leaves `status: active` and archives nothing. A
    // reader who deletes the step as redundant must be able to find out why it
    // is not. Neither literal exists in the shipped module today.
    await resumeMod();
    const src = read(RESUME_MODULE_FILE);
    expect(src, "the module never names the `/spec-archive` step").toContain(
      "/spec-archive",
    );
    expect(
      src,
      "the module does not record WHY the archive step is needed — the `status: active` " +
        "a single-FR `/implement` leaves behind",
    ).toContain("status: active");
  });
});

// ===========================================================================
// AC-STE-501.4 — the confirm gate renders the chain, the count and the reason.
//
// The FR names the vacuity outright: "a render that shows only the step list
// passes a naive assertion". Every assertion here therefore runs against
// `reasonText()` — the render WITHOUT its numbered step lines.
// ===========================================================================

describe("AC-STE-501.4 — the confirm gate renders count and branch reason", () => {
  test("the rendered plan still carries the numbered step list", async () => {
    const { renderResumePlan } = await resumeMod();
    await withTree(TREE_LAST_ACTIVE, async (root) => {
      const c = await classifyFr(root, FR_LAST, MILESTONE);
      const plan = renderResumePlan(c);
      expect(
        stepKeys(plan.chain),
        "the plan's chain is not the FR-scoped chain",
      ).toEqual(stepKeys(await frChain(root, FR_LAST, MILESTONE)));
      for (const step of plan.chain) {
        expect(
          plan.rendered,
          `the render omits the ${step.skill} step`,
        ).toContain(step.skill);
      }
      expect(plan.rendered).toMatch(/^\s*1\.\s+\/implement/m);
      expect(plan.milestone).toBe(MILESTONE);
    });
  });

  test("the reason text names the FR and the milestone on BOTH branches", async () => {
    const { renderResumePlan } = await resumeMod();
    for (const [spec, fr] of [
      [TREE_LAST_ACTIVE, FR_LAST],
      [TREE_THREE_SIBLINGS, FR_SIB3],
    ] as const) {
      await withTree(spec, async (root) => {
        const reason = reasonText(renderResumePlan(await classifyFr(root, fr, MILESTONE)).rendered);
        expect(
          reason.trim().length,
          `${fr}: the render is nothing but a step list — the operator is ratifying, not deciding`,
        ).toBeGreaterThan(0);
        expect(reason, `${fr}: the reason text does not name the FR`).toContain(fr);
        expect(reason, `${fr}: the reason text does not name the milestone`).toContain(
          MILESTONE,
        );
      });
    }
  });

  test("COUNT: the remaining-FR count is the REAL number, cross-excluded 3 vs 7", async () => {
    // Two fixtures whose counts are neither 0 nor 1, so no constant and no
    // accidental "0 remaining" can pass. Each render must carry ITS OWN count
    // and must NOT carry the other's — which a hard-coded number cannot do.
    const { renderResumePlan } = await resumeMod();
    const reasons: Record<number, string> = {};
    for (const [spec, fr, count] of [
      [TREE_THREE_SIBLINGS, FR_SIB3, 3],
      [TREE_SEVEN_SIBLINGS, FR_SIB7, 7],
    ] as const) {
      await withTree(spec, async (root) => {
        const c = await classifyFr(root, fr, MILESTONE);
        expect(
          c.remainingActiveFrIds.length,
          `fixture premise: ${fr} should have ${count} remaining`,
        ).toBe(count);
        const reason = reasonText(renderResumePlan(c).rendered);
        reasons[count] = reason;
        expect(
          hasCount(reason, count),
          `${fr}: the render does not state that ${count} active FRs would remain`,
        ).toBe(true);
      });
    }
    expect(
      hasCount(reasons[3]!, 7),
      "the 3-sibling render also states 7 — the count is not real",
    ).toBe(false);
    expect(
      hasCount(reasons[7]!, 3),
      "the 7-sibling render also states 3 — the count is not real",
    ).toBe(false);
  });

  test("REASON: the two branches' reason texts DIFFER, and the extended one says which", async () => {
    // This is the assertion a step-list-only render cannot survive: with the
    // step lines stripped, an implementation that renders no reason produces the
    // SAME text on both branches.
    const { renderResumePlan } = await resumeMod();
    let lastActiveReason = "";
    let siblingsReason = "";
    await withTree(TREE_LAST_ACTIVE, async (root) => {
      lastActiveReason = reasonText(
        renderResumePlan(await classifyFr(root, FR_LAST, MILESTONE)).rendered,
      );
    });
    await withTree(TREE_THREE_SIBLINGS, async (root) => {
      siblingsReason = reasonText(
        renderResumePlan(await classifyFr(root, FR_SIB3, MILESTONE)).rendered,
      );
    });

    // Normalise away the identities so the ONLY thing that can differ is the
    // branch reason itself — otherwise the differing FR ids would carry this.
    const strip = (s: string): string =>
      s.replaceAll(FR_LAST, "<FR>").replaceAll(FR_SIB3, "<FR>");
    expect(
      strip(lastActiveReason),
      "both branches render the same reason text — the operator cannot tell which chain was chosen",
    ).not.toBe(strip(siblingsReason));

    // The AC's own vocabulary: "when the FR is the last active one".
    expect(
      /last[- ]active/i.test(lastActiveReason),
      "the extended chain's render never says this is the last active FR — a miscount is uncatchable",
    ).toBe(true);
  });

  test("the gate is shown the SAME plan the run then uses", async () => {
    const { runResume, renderResumePlan } = await resumeMod();
    await withTree(TREE_THREE_SIBLINGS, async (root) => {
      const expected = renderResumePlan(await classifyFr(root, FR_SIB3, MILESTONE));
      const gate = fixedGate("confirm");
      const outcome = await runResume({
        projectRoot: root,
        milestone: MILESTONE,
        fr: FR_SIB3,
        gate,
        spawn: recordingSpawn(),
        inline: recordingInline(),
        tracker: recordingTracker(),
      });
      expect(gate.presented.length, "the operator was not asked exactly once").toBe(1);
      expect(gate.presented[0]!.rendered).toBe(expected.rendered);
      expect(stepKeys(outcome.plan.chain)).toEqual(stepKeys(expected.chain));
    });
  });
});

// ===========================================================================
// AC-STE-501.5 — on `edit`, the operator's chain is what runs.
// ===========================================================================

describe("AC-STE-501.5 — the operator's edited chain is what runs", () => {
  /** Deliberately unlike the proposed chain in every field. */
  const OPERATOR_CHAIN: readonly ResumeChainStep[] = [
    { skill: "/spec-write", placement: "inline", target: "OPERATOR-FR" },
    { skill: "/pr", placement: "worker", target: "OPERATOR-MILESTONE" },
  ];

  test("the operator's steps REACH the sinks", async () => {
    const { runResume } = await resumeMod();
    await withTree(TREE_LAST_ACTIVE, async (root) => {
      const spawn = recordingSpawn();
      const inline = recordingInline();
      const gate = fixedGate("edit", OPERATOR_CHAIN);
      const outcome = await runResume({
        projectRoot: root,
        milestone: MILESTONE,
        fr: FR_LAST,
        gate,
        spawn,
        inline,
        tracker: recordingTracker(),
      });
      // The edit must be offered against the FR-scoped plan; without this the
      // leg is satisfied by a run that ignored `fr` and edited a milestone plan.
      expect(
        stepKeys(gate.presented[0]!.chain),
        "the operator edited the milestone chain — `fr` was ignored",
      ).toEqual(stepKeys(await frChain(root, FR_LAST, MILESTONE)));
      expect(outcome.decision).toBe("edit");
      expect(stepKeys(outcome.chain)).toEqual(stepKeys(OPERATOR_CHAIN));
      expect(inline.steps.map((s) => s.target)).toEqual(["OPERATOR-FR"]);
      expect(spawn.spawns.length).toBe(1);
      expect(stepKeys(spawn.spawns[0]!.chain)).toEqual([
        "/pr@worker:OPERATOR-MILESTONE",
      ]);
    });
  });

  test("the PROPOSED chain reaches NOTHING — its distinctive steps never ran", async () => {
    // The other half, and the one that catches an implementation which honours
    // the edit in its return value while spawning the chain it proposed.
    const { runResume } = await resumeMod();
    await withTree(TREE_LAST_ACTIVE, async (root) => {
      const proposed = await frChain(root, FR_LAST, MILESTONE);
      expect(
        skills(proposed),
        "fixture premise: the proposed chain must be the distinctive extended one",
      ).toContain("/spec-archive");

      const spawn = recordingSpawn();
      const inline = recordingInline();
      await runResume({
        projectRoot: root,
        milestone: MILESTONE,
        fr: FR_LAST,
        gate: fixedGate("edit", OPERATOR_CHAIN),
        spawn,
        inline,
        tracker: recordingTracker(),
      });

      const reached = [
        ...inline.steps,
        ...spawn.spawns.flatMap((s) => [...s.chain]),
      ];
      expect(
        skills(reached),
        "the proposed chain's `/spec-archive` ran despite the edit",
      ).not.toContain("/spec-archive");
      expect(
        skills(reached),
        "the proposed chain's `/ship-milestone` ran despite the edit",
      ).not.toContain("/ship-milestone");
      expect(
        skills(reached),
        "the proposed chain's `/implement` ran despite the edit",
      ).not.toContain("/implement");
      expect(
        reached.map((s) => s.target),
        "a step still targeted the FR — the proposed chain leaked through",
      ).not.toContain(FR_LAST);
      expect(
        reached.map((s) => s.target),
        "a step still targeted the milestone — the proposed chain leaked through",
      ).not.toContain(MILESTONE);
    });
  });

  test("`edit` with NO chain falls back to the proposed chain", async () => {
    // The shipped fallback, kept: an operator who confirms by editing nothing
    // must not get an empty run.
    const { runResume } = await resumeMod();
    await withTree(TREE_ONE_SIBLING, async (root) => {
      const proposed = await frChain(root, FR_SIB1, MILESTONE);
      const spawn = recordingSpawn();
      const outcome = await runResume({
        projectRoot: root,
        milestone: MILESTONE,
        fr: FR_SIB1,
        gate: fixedGate("edit"),
        spawn,
        inline: recordingInline(),
        tracker: recordingTracker(),
      });
      expect(stepKeys(outcome.chain)).toEqual(stepKeys(proposed));
      expect(stepKeys(spawn.spawns[0]!.chain)).toEqual(stepKeys(proposed));
    });
  });
});

// ===========================================================================
// AC-STE-501.7 — a flagged FR gets ONE `/spec-write` pass at the head.
// ===========================================================================

describe("AC-STE-501.7 — the review pass heads the chain, scoped to the FR", () => {
  test("SIBLINGS BRANCH: exactly one `/spec-write` at the head, targeting the FR", async () => {
    await withTree(TREE_FLAGGED_SIBLINGS, async (root) => {
      const c = await classifyFr(root, FR_FLAG_SIB, MILESTONE);
      expect(c.needsTechnicalReview, "fixture premise: the FR is flagged").toBe(true);
      const chain = await frChain(root, FR_FLAG_SIB, MILESTONE);
      expect(stepKeys(chain)).toEqual([
        `/spec-write@inline:${FR_FLAG_SIB}`,
        `/implement@worker:${FR_FLAG_SIB}`,
        `/pr@worker:${MILESTONE}`,
      ]);
    });
  });

  test("LAST-ACTIVE BRANCH: the same head, in front of the full ceremony", async () => {
    await withTree(TREE_FLAGGED_LAST, async (root) => {
      const c = await classifyFr(root, FR_FLAG_LAST, MILESTONE);
      expect(c.needsTechnicalReview).toBe(true);
      expect(c.lastActiveFr).toBe(true);
      const chain = await frChain(root, FR_FLAG_LAST, MILESTONE);
      expect(stepKeys(chain)).toEqual([
        `/spec-write@inline:${FR_FLAG_LAST}`,
        `/implement@worker:${FR_FLAG_LAST}`,
        `/spec-archive@worker:${MILESTONE}`,
        `/ship-milestone@worker:${MILESTONE}`,
        `/pr@worker:${MILESTONE}`,
      ]);
    });
  });

  test("NOT A SWEEP: a flagged SIBLING of the same milestone gets no pass", async () => {
    // The fixture has a second flagged FR bound to M700. A chain that swept the
    // milestone's flagged FRs — the shipped MILESTONE behaviour — emits two
    // `/spec-write` steps here.
    await withTree(TREE_FLAGGED_SIBLINGS, async (root) => {
      const chain = await frChain(root, FR_FLAG_SIB, MILESTONE);
      const writes = chain.filter((s) => s.skill === "/spec-write");
      expect(writes.length, "more than one `/spec-write` — the chain swept").toBe(1);
      expect(writes[0]!.target).toBe(FR_FLAG_SIB);
      expect(
        chain.map((s) => s.target),
        "a sibling's review pass leaked into this FR's chain",
      ).not.toContain(FR_FLAG_SIBLING_ALSO_FLAGGED);
    });
  });

  test("ISOLATION: an UNFLAGGED FR gets no `/spec-write` at all", async () => {
    // Without this, "the flagged FR gets a pass" is satisfied by giving every FR
    // one.
    for (const [spec, fr] of [
      [TREE_LAST_ACTIVE, FR_LAST],
      [TREE_ONE_SIBLING, FR_SIB1],
      [TREE_THREE_SIBLINGS, FR_SIB3],
      [TREE_FLAGGED_SIBLINGS, "STE-752"],
    ] as const) {
      await withTree(spec, async (root) => {
        const chain = await frChain(root, fr, MILESTONE);
        expect(
          skills(chain),
          `${fr}: an unflagged FR was sent through a review pass`,
        ).not.toContain("/spec-write");
      });
    }
  });

  test("PLACEMENT follows the SHIPPED rule: worker for cross-repo, inline otherwise", async () => {
    await withTree(TREE_FLAGGED_LAST, async (root) => {
      const invoking = await frChain(root, FR_FLAG_LAST, MILESTONE, "invoking");
      const crossRepo = await frChain(
        root,
        FR_FLAG_LAST,
        MILESTONE,
        "cross_repo_toolkit",
      );
      expect(invoking[0]!.placement).toBe("inline");
      expect(
        crossRepo[0]!.placement,
        "a cross-repo review pass must run inside the target repo's own worker",
      ).toBe("worker");
      // Everything else about the two chains is identical: only placement moves.
      expect(skills(crossRepo)).toEqual(skills(invoking));
      expect(crossRepo.map((s) => s.target)).toEqual(invoking.map((s) => s.target));
    });
  });

  test("the review pass runs BEFORE the implement step, never after", async () => {
    for (const [spec, fr] of [
      [TREE_FLAGGED_LAST, FR_FLAG_LAST],
      [TREE_FLAGGED_SIBLINGS, FR_FLAG_SIB],
    ] as const) {
      await withTree(spec, async (root) => {
        const order = skills(await frChain(root, fr, MILESTONE));
        expect(order[0], `${fr}: `.concat("the review pass does not head the chain")).toBe(
          "/spec-write",
        );
        expect(order.indexOf("/spec-write")).toBeLessThan(order.indexOf("/implement"));
      });
    }
  });
});

// ===========================================================================
// The reduced route — the shipped chain, unchanged at FR scope.
// ===========================================================================

describe("route `reduced` — a toolkit-less target keeps the shipped two-step chain", () => {
  test("both FR branches collapse to `/work` then `/pr`, targeting the milestone", async () => {
    for (const [spec, fr] of [
      [TREE_LAST_ACTIVE, FR_LAST],
      [TREE_THREE_SIBLINGS, FR_SIB3],
    ] as const) {
      await withTree(spec, async (root) => {
        const chain = await frChain(root, fr, MILESTONE, "reduced");
        expect(
          stepKeys(chain),
          `${fr}: the reduced route emitted toolkit stages the target repo does not have`,
        ).toEqual([`/work@worker:${MILESTONE}`, `/pr@worker:${MILESTONE}`]);
      });
    }
  });

  test("a flagged FR still gets its review head under `reduced`", async () => {
    await withTree(TREE_FLAGGED_LAST, async (root) => {
      const chain = await frChain(root, FR_FLAG_LAST, MILESTONE, "reduced");
      expect(stepKeys(chain)).toEqual([
        `/spec-write@inline:${FR_FLAG_LAST}`,
        `/work@worker:${MILESTONE}`,
        `/pr@worker:${MILESTONE}`,
      ]);
    });
  });
});

// ===========================================================================
// The tracker claim on the FR path.
// ===========================================================================

describe("the FR-scoped claim: `claimFr` when offered, `claimMilestone` otherwise", () => {
  test("a sink offering `claimFr` is claimed at FR granularity", async () => {
    const { runResume } = await resumeMod();
    await withTree(TREE_THREE_SIBLINGS, async (root) => {
      const tracker = recordingTracker();
      await runResume({
        projectRoot: root,
        milestone: MILESTONE,
        fr: FR_SIB3,
        gate: fixedGate("confirm"),
        spawn: recordingSpawn(),
        inline: recordingInline(),
        tracker,
      });
      expect(tracker.frClaims, "the FR was not claimed through `claimFr`").toEqual([
        FR_SIB3,
      ]);
      expect(
        tracker.milestoneClaims,
        "the milestone was claimed as well — the FR run claimed twice",
      ).toEqual([]);
    });
  });

  test("a sink WITHOUT `claimFr` falls back to the shipped milestone claim", async () => {
    const { runResume } = await resumeMod();
    await withTree(TREE_THREE_SIBLINGS, async (root) => {
      const tracker = milestoneOnlyTracker();
      await runResume({
        projectRoot: root,
        milestone: MILESTONE,
        fr: FR_SIB3,
        gate: fixedGate("confirm"),
        spawn: recordingSpawn(),
        inline: recordingInline(),
        tracker,
      });
      expect(
        tracker.milestoneClaims,
        "neither channel was used — the FR run claimed nothing",
      ).toEqual([MILESTONE]);
    });
  });
});

// ===========================================================================
// THE MILESTONE SCOPE IS UNCHANGED.
//
// Pinned byte-for-byte so the FR-scoped overloads cannot be bought by altering
// the milestone answer.
// ===========================================================================

describe("the milestone-scoped chain, render and run are untouched", () => {
  test("`resumeChain` still emits the shipped milestone chains", async () => {
    const { classifyResume, resumeChain } = await resumeMod();
    await withTree(TREE_MS_READY, async (root) => {
      const c = await classifyResume(root, MILESTONE);
      expect(stepKeys(resumeChain(c))).toEqual([
        `/implement@worker:${MILESTONE}`,
        `/ship-milestone@worker:${MILESTONE}`,
        `/pr@worker:${MILESTONE}`,
      ]);
      expect(
        skills(resumeChain(c)),
        "the milestone chain grew an archive step it never had",
      ).not.toContain("/spec-archive");
      expect(stepKeys(resumeChain(c, "reduced"))).toEqual([
        `/work@worker:${MILESTONE}`,
        `/pr@worker:${MILESTONE}`,
      ]);
    });
    await withTree(TREE_MS_REVIEW, async (root) => {
      const c = await classifyResume(root, MILESTONE);
      expect(stepKeys(resumeChain(c))).toEqual([
        `/spec-write@inline:${MS_FLAGGED_FR}`,
        `/implement@worker:${MILESTONE}`,
        `/ship-milestone@worker:${MILESTONE}`,
        `/pr@worker:${MILESTONE}`,
      ]);
      expect(stepKeys(resumeChain(c, "cross_repo_toolkit"))).toEqual([
        `/spec-write@worker:${MS_FLAGGED_FR}`,
        `/implement@worker:${MILESTONE}`,
        `/ship-milestone@worker:${MILESTONE}`,
        `/pr@worker:${MILESTONE}`,
      ]);
    });
  });

  test("`renderResumePlan` still produces the shipped milestone text, EXACTLY", async () => {
    const { classifyResume, renderResumePlan } = await resumeMod();
    await withTree(TREE_MS_READY, async (root) => {
      const plan = renderResumePlan(await classifyResume(root, MILESTONE));
      expect(plan.rendered).toBe(
        [
          `Resume ${MILESTONE} — classified state: ready_to_implement`,
          "",
          `  1. /implement ${MILESTONE} (worker)`,
          `  2. /ship-milestone ${MILESTONE} (worker)`,
          `  3. /pr ${MILESTONE} (worker)`,
        ].join("\n"),
      );
      expect(plan.milestone).toBe(MILESTONE);
    });
    await withTree(TREE_MS_REVIEW, async (root) => {
      const plan = renderResumePlan(await classifyResume(root, MILESTONE));
      expect(plan.rendered).toBe(
        [
          `Resume ${MILESTONE} — classified state: needs_technical_review`,
          "",
          `  1. /spec-write ${MS_FLAGGED_FR} (inline)`,
          `  2. /implement ${MILESTONE} (worker)`,
          `  3. /ship-milestone ${MILESTONE} (worker)`,
          `  4. /pr ${MILESTONE} (worker)`,
        ].join("\n"),
      );
    });
  });

  test("`runResume` WITHOUT `fr` still runs the milestone path and claims the milestone", async () => {
    const { runResume } = await resumeMod();
    await withTree(TREE_MS_REVIEW, async (root) => {
      const spawn = recordingSpawn();
      const inline = recordingInline();
      const tracker = recordingTracker();
      const outcome = await runResume({
        projectRoot: root,
        milestone: MILESTONE,
        gate: fixedGate("confirm"),
        spawn,
        inline,
        tracker,
      });
      expect(outcome.decision).toBe("confirm");
      expect(outcome.milestone).toBe(MILESTONE);
      expect(outcome.milestones).toBe(1);
      expect(outcome.concurrency).toBe(1);
      expect(
        tracker.milestoneClaims,
        "the milestone path stopped claiming the milestone",
      ).toEqual([MILESTONE]);
      expect(
        tracker.frClaims,
        "the milestone path claimed an FR — `claimFr` leaked across scopes",
      ).toEqual([]);
      expect(stepKeys(inline.steps)).toEqual([`/spec-write@inline:${MS_FLAGGED_FR}`]);
      expect(stepKeys(spawn.spawns[0]!.chain)).toEqual([
        `/implement@worker:${MILESTONE}`,
        `/ship-milestone@worker:${MILESTONE}`,
        `/pr@worker:${MILESTONE}`,
      ]);
    });
  });

  test("the milestone-scoped run still writes nothing on confirm", async () => {
    const { runResume } = await resumeMod();
    await assertReadOnly(TREE_MS_READY, "milestone confirm", async (root) => {
      await runResume({
        projectRoot: root,
        milestone: MILESTONE,
        gate: fixedGate("confirm"),
        spawn: recordingSpawn(),
        inline: recordingInline(),
        tracker: recordingTracker(),
      });
    });
  });
});
