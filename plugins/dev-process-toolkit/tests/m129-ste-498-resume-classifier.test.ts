// M129 STE-498 — `/deliver` enters a resumed milestone at the phase its state
// allows.
//
// WHAT IS BROKEN, measured on this tree at authoring time (2026-08-17, v2.67.1):
//
//   * `ls adapters/_shared/src/resume_classifier*` → no matches. Nothing
//     anywhere classifies a resumed milestone's state.
//   * `grep -c "resume" skills/deliver/SKILL.md` → ZERO. The operative surface
//     has no vocabulary for entering the pipeline anywhere but Phase 1.
//   * All four helpers this FR is required to ASSEMBLE already exist and were
//     re-verified before writing this file:
//         adapters/_shared/src/plan_task_state.ts
//         adapters/_shared/src/active_plan_ship_ready.ts
//         adapters/_shared/src/plan_ship_coherence.ts
//         adapters/_shared/src/needs_technical_review_consistency.ts
//     So every RED below is a missing ASSEMBLY, not missing machinery.
//
// TEST STRATEGY, and why no half of it is a tautology.
//
//   * BEHAVIOUR FIRST, PROSE SECOND. This repo has a documented history of
//     prose-grep ACs reading green while the behaviour is absent (STE-492, in
//     THIS milestone). So the classifier, the chain builder, the operator gate
//     and the refusals all live in `adapters/_shared/src/resume_classifier.ts`
//     and are exercised as CODE against REAL on-disk fixture trees driven
//     through the REAL shipped helpers. Every prose pin is the second half of a
//     pair whose first half is behavioural.
//   * AC.2 IS MUTATION-VERIFIED, NOT GREPPED. Every classification path runs
//     against a throwaway tree whose FULL byte-and-listing snapshot is compared
//     before and after. Three falsifiability controls prove the same comparison
//     detects a rewrite, a new file, and a deletion — so "nothing changed" can
//     genuinely fail. The source-level write-token grep is the SECOND leg only.
//   * AC.3 IS PINNED AS REUSE, NOT AS AGREEMENT-BY-COINCIDENCE. The
//     classification's numbers are asserted EQUAL to what the shipped helpers
//     return when called directly by this test on the same fixture, on fixtures
//     whose numbers DIFFER from each other (so a constant cannot pass), and the
//     module source is grepped for private copies of each helper's distinctive
//     predicate — the task-list regex, the archived-FR ship-ready derivation,
//     the CHANGELOG heading scan, the review placeholder substring.
//   * AC.4 IS ASSERTED WITH AN ISOLATION LEG. "The spec-writing passes run
//     inline" is satisfied vacuously by a router that runs EVERYTHING inline, so
//     the SAME invocation is asserted to place `/implement` in the spawned
//     worker while `/spec-write` never enters it.
//   * AC.7/AC.8 USE INJECTED SINKS. The spawn sink and the tracker-claim sink
//     are parameters, so "nothing was spawned / nothing was claimed" is
//     OBSERVED, not inferred. The operator gate inspects both sinks at the
//     moment it is presented — which is how "before any worker is spawned and
//     before any tracker claim" is asserted rather than assumed — and an
//     exploding pair of sinks gives the complementary reading.
//   * AC.9 REUSES THE SHIPPED AUTHORITY. `MAX_CONCURRENT_WORKERS` is IMPORTED
//     from `target_repo.ts` rather than the number being restated, and the
//     module is grepped for a retyped literal.
//
// DELIBERATE OMISSIONS.
//   * NO aggregate `/gate-check` probe-count assertion. This FR registers NO
//     probe; the count is 79 in this milestone and a count pin here would be
//     someone else's pin, reddening on their schedule.
//   * NO new skill and NO new agent. The tripwires pin 27 / 8.
//   * NO multi-milestone resume assertion beyond "the other milestone is never
//     touched" — multi-milestone resume is explicitly out of scope in the FR.
//
// HARD BUDGETS, measured at authoring time:
//   * `skills/` tree: 246 / 246 STE-N tokens — ZERO headroom. Not one prose pin
//     below demands a ticket id anywhere under `skills/`.
//   * `skills/deliver/SKILL.md`: 140 lines of a 358 cap.
//   * OPERATIVE-SURFACE RULE: every prose pin below is written against
//     `skills/deliver/SKILL.md`, NOT `docs/deliver-reference.md`, which the
//     skill marks "not required reading". This milestone has already shipped
//     this defect three times. Each pin is additionally SLICED to the resume
//     section, so pre-existing adjacent text cannot satisfy a proximity window.
// This file lives under `tests/`, which carries neither budget.

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

import { parseFrontmatter } from "../adapters/_shared/src/frontmatter";
import { readPlanTaskState } from "../adapters/_shared/src/plan_task_state";
import { shipReadyMilestones } from "../adapters/_shared/src/active_plan_ship_ready";
import { runPlanShipCoherenceProbe } from "../adapters/_shared/src/plan_ship_coherence";
import { runNeedsTechnicalReviewConsistencyProbe } from "../adapters/_shared/src/needs_technical_review_consistency";
// AC.9 — the serial invariant is a shipped number with ONE home. Importing it
// is the point: a test that retyped `1` could not detect the authority moving.
import { MAX_CONCURRENT_WORKERS } from "../adapters/_shared/src/target_repo";

// ===========================================================================
// Paths.
// ===========================================================================

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");
const SKILLS_DIR = join(PLUGIN_ROOT, "skills");
const AGENTS_DIR = join(PLUGIN_ROOT, "agents");
const SHARED_SRC = join(PLUGIN_ROOT, "adapters", "_shared", "src");

const read = (p: string): string => readFileSync(p, "utf-8");
const skillPath = (name: string): string => join(SKILLS_DIR, name, "SKILL.md");

const DELIVER_SKILL_FILE = skillPath("deliver");
const DELIVER_SKILL = (): string => read(DELIVER_SKILL_FILE);

const RESUME_MODULE = "../adapters/_shared/src/resume_classifier";
const RESUME_MODULE_FILE = join(SHARED_SRC, "resume_classifier.ts");
const REVIEW_MODULE_FILE = join(
  SHARED_SRC,
  "needs_technical_review_consistency.ts",
);

/** The four helpers AC.3 names, by absolute path. */
const REUSED_HELPER_FILES: Readonly<Record<string, string>> = {
  plan_task_state: join(SHARED_SRC, "plan_task_state.ts"),
  active_plan_ship_ready: join(SHARED_SRC, "active_plan_ship_ready.ts"),
  plan_ship_coherence: join(SHARED_SRC, "plan_ship_coherence.ts"),
  needs_technical_review_consistency: REVIEW_MODULE_FILE,
};

/**
 * The FR under test, resolved with the ARCHIVE FALLBACK. `/implement` Phase 4
 * `git mv`s the FR into `specs/frs/archive/` at milestone close, and a
 * meta-test that only knows the active path goes red at the archive commit —
 * the recurring failure recorded in the M100/M126 notes.
 */
function frPath(): string {
  const active = join(REPO_ROOT, "specs", "frs", "STE-498.md");
  if (existsSync(active)) return active;
  const archived = join(REPO_ROOT, "specs", "frs", "archive", "STE-498.md");
  if (existsSync(archived)) return archived;
  throw new Error(
    "STE-498.md found in neither specs/frs/ nor specs/frs/archive/",
  );
}

// ===========================================================================
// The module under test, imported LAZILY.
//
// A top-level static import of a not-yet-written module aborts the whole file,
// which would collapse nine independent reds into one load error and hide which
// ACs are actually unmet. The four helpers and `target_repo` ARE imported
// statically above — they are shipped.
// ===========================================================================

/** The states that change where a resumed milestone is entered. */
type ResumeState =
  | "needs_technical_review"
  | "ready_to_implement"
  | "partly_implemented"
  | "ship_ready"
  | "shipped"
  | "parked";

type PlanStatus = "active" | "archived" | "missing";

interface ResumeClassification {
  readonly milestone: string;
  readonly state: ResumeState;
  readonly planStatus: PlanStatus;
  readonly totalTasks: number;
  readonly uncheckedTasks: number;
  /** FR ids bound to THIS milestone whose specs still await technical review. */
  readonly frsAwaitingReview: readonly string[];
  /** The reason a parked milestone was parked, or `null` when none is recorded. */
  readonly parkedReason: string | null;
  /** The `shipped_in:` stamp verbatim, or `null` when unstamped. */
  readonly shippedIn: string | null;
  /** NFR-10 messages from `plan_ship_coherence` naming THIS milestone. */
  readonly shipCoherenceViolations: readonly string[];
  /** NFR-10 messages from `needs_technical_review_consistency` for its FRs. */
  readonly reviewConsistencyViolations: readonly string[];
}

type ResumeSkill = "/spec-write" | "/implement" | "/ship-milestone" | "/pr";
type StepPlacement = "inline" | "worker";

interface ResumeChainStep {
  readonly skill: ResumeSkill;
  readonly placement: StepPlacement;
  /** The FR id (for `/spec-write`) or the milestone token. */
  readonly target: string;
}

interface ResumePlan {
  readonly milestone: string;
  readonly state: ResumeState;
  readonly chain: readonly ResumeChainStep[];
  /** What the operator is shown, verbatim. */
  readonly rendered: string;
}

type ResumeGateDecision = "confirm" | "edit" | "abort";

interface ResumeGateAnswer {
  readonly decision: ResumeGateDecision;
  /** Only meaningful for `edit` — the chain the operator wants instead. */
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

interface ResumeTrackerSink {
  claimMilestone(milestone: string): void;
}

interface RunResumeInput {
  readonly projectRoot: string;
  readonly milestone: string;
  readonly gate: ResumeOperatorGate;
  readonly spawn: ResumeSpawnSink;
  readonly inline: ResumeInlineSink;
  readonly tracker: ResumeTrackerSink;
}

interface ResumeRunOutcome {
  readonly decision: ResumeGateDecision;
  readonly milestone: string;
  readonly state: ResumeState;
  readonly plan: ResumePlan;
  /** What was actually run — `[]` on abort. */
  readonly chain: readonly ResumeChainStep[];
  /** Milestones this invocation resumed. Always 1. */
  readonly milestones: number;
  /** Workers that may run at once. Always `MAX_CONCURRENT_WORKERS`. */
  readonly concurrency: number;
}

interface ResumeClassifierModule {
  RESUME_STATES: readonly ResumeState[];
  classifyResume(
    projectRoot: string,
    milestone: string,
  ): Promise<ResumeClassification>;
  resumeChain(c: ResumeClassification): readonly ResumeChainStep[];
  renderResumePlan(c: ResumeClassification): ResumePlan;
  runResume(input: RunResumeInput): Promise<ResumeRunOutcome>;
  ResumeRefusedError: new (message: string) => Error;
}

async function resumeMod(): Promise<ResumeClassifierModule> {
  return (await import(RESUME_MODULE)) as unknown as ResumeClassifierModule;
}

/** The shared flag enumerator AC.3 requires the review module to own. */
interface ReviewEnumeratorModule {
  frsAwaitingTechnicalReview(
    projectRoot: string,
  ): Promise<readonly { id: string; milestone: string | null; file: string }[]>;
}

async function reviewEnumerator(): Promise<ReviewEnumeratorModule> {
  return (await import(
    "../adapters/_shared/src/needs_technical_review_consistency"
  )) as unknown as ReviewEnumeratorModule;
}

// ===========================================================================
// On-disk fixture trees.
//
// Every classification leg runs against a REAL tree so the shipped helpers do
// real work. Nothing here touches the toolkit repo.
// ===========================================================================

const MILESTONE = "M500";
const OTHER_MILESTONE = "M501";

interface FrSpec {
  readonly id: string;
  readonly milestone: string;
  readonly needsReview?: boolean;
  /** Deliberately break the flag/placeholder invariant. */
  readonly inconsistent?: boolean;
  readonly archived?: boolean;
}

interface PlanSpec {
  readonly milestone: string;
  readonly archived?: boolean;
  readonly shippedIn?: string;
  readonly shipState?: string;
  readonly parkReason?: string;
  readonly totalTasks?: number;
  readonly checkedTasks?: number;
}

interface TreeSpec {
  readonly plans: readonly PlanSpec[];
  readonly frs: readonly FrSpec[];
  readonly changelogVersions?: readonly string[];
}

const REVIEW_PLACEHOLDER =
  "[needs technical review — run /spec-write <FR-id> to complete]";

function frBody(spec: FrSpec): string {
  const flagged = spec.needsReview === true;
  // The consistency invariant: flag ⇒ placeholder body; no flag ⇒ real body.
  // `inconsistent` deliberately violates it so the violations leg is real.
  const wantPlaceholder = spec.inconsistent === true ? !flagged : flagged;
  const body = wantPlaceholder ? REVIEW_PLACEHOLDER : "Real content, written.";
  const fm = ["---", `title: ${spec.id}`, `milestone: ${spec.milestone}`];
  fm.push(spec.archived === true ? "status: archived" : "status: active");
  fm.push(spec.archived === true ? "archived_at: 2026-08-17" : "archived_at: null");
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
  if (spec.shipState !== undefined) fm.push(`ship_state: ${spec.shipState}`);
  if (spec.parkReason !== undefined) fm.push(`park_reason: ${spec.parkReason}`);
  fm.push("---");
  const total = spec.totalTasks ?? 0;
  const checked = spec.checkedTasks ?? 0;
  const tasks: string[] = [];
  for (let i = 0; i < total; i++) {
    tasks.push(`- [${i < checked ? "x" : " "}] task ${i + 1}`);
  }
  return [
    ...fm,
    "",
    `# ${spec.milestone}`,
    "",
    "## Tasks",
    "",
    ...tasks,
    "",
  ].join("\n");
}

function writeFileAt(root: string, rel: string, content: string): void {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

function buildTree(spec: TreeSpec): string {
  const root = mkdtempSync(join(tmpdir(), "ste498-"));
  mkdirSync(join(root, "specs", "plan", "archive"), { recursive: true });
  mkdirSync(join(root, "specs", "frs", "archive"), { recursive: true });
  for (const plan of spec.plans) {
    const rel = plan.archived === true
      ? join("specs", "plan", "archive", `${plan.milestone}.md`)
      : join("specs", "plan", `${plan.milestone}.md`);
    writeFileAt(root, rel, planBody(plan));
  }
  for (const fr of spec.frs) {
    const rel = fr.archived === true
      ? join("specs", "frs", "archive", `${fr.id}.md`)
      : join("specs", "frs", `${fr.id}.md`);
    writeFileAt(root, rel, frBody(fr));
  }
  const versions = spec.changelogVersions ?? [];
  writeFileAt(
    root,
    "CHANGELOG.md",
    ["# Changelog", "", ...versions.map((v) => `## [${v}] — 2026-08-17`), ""].join(
      "\n",
    ),
  );
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

// --- The six fixtures, one per state. --------------------------------------

/** FRs still flagged for technical review — the worst and commonest resume. */
const TREE_NEEDS_REVIEW: TreeSpec = {
  plans: [{ milestone: MILESTONE, totalTasks: 4, checkedTasks: 0 }],
  frs: [
    { id: "STE-800", milestone: MILESTONE, needsReview: true },
    { id: "STE-801", milestone: MILESTONE, needsReview: true },
    { id: "STE-802", milestone: MILESTONE },
  ],
};

/** Specs complete, nothing built yet. */
const TREE_READY: TreeSpec = {
  plans: [{ milestone: MILESTONE, totalTasks: 5, checkedTasks: 0 }],
  frs: [
    { id: "STE-810", milestone: MILESTONE },
    { id: "STE-811", milestone: MILESTONE },
  ],
};

/** Half-built and abandoned: some plan tasks ticked, active FRs remain. */
const TREE_PARTLY: TreeSpec = {
  plans: [{ milestone: MILESTONE, totalTasks: 6, checkedTasks: 2 }],
  frs: [{ id: "STE-820", milestone: MILESTONE }],
};

/** Half-built the OTHER way: one FR archived, one still active, no ticks. */
const TREE_PARTLY_BY_ARCHIVE: TreeSpec = {
  plans: [{ milestone: MILESTONE, totalTasks: 3, checkedTasks: 0 }],
  frs: [
    { id: "STE-830", milestone: MILESTONE, archived: true },
    { id: "STE-831", milestone: MILESTONE },
  ],
};

/** Fully built: zero active FRs bound, ≥1 archived FR bound, unstamped. */
const TREE_SHIP_READY: TreeSpec = {
  plans: [{ milestone: MILESTONE, totalTasks: 3, checkedTasks: 3 }],
  frs: [
    { id: "STE-840", milestone: MILESTONE, archived: true },
    { id: "STE-841", milestone: MILESTONE, archived: true },
  ],
};

/** Already shipped: an archived plan carrying a real stamp the CHANGELOG has. */
const TREE_SHIPPED: TreeSpec = {
  plans: [
    {
      milestone: MILESTONE,
      archived: true,
      shippedIn: "v9.9.9",
      totalTasks: 2,
      checkedTasks: 2,
    },
  ],
  frs: [{ id: "STE-850", milestone: MILESTONE, archived: true }],
  changelogVersions: ["9.9.9"],
};

/** Deliberately parked, with a reason on the record. */
const PARK_REASON = "batched on a sibling branch until the adapter lands";
const TREE_PARKED: TreeSpec = {
  plans: [
    {
      milestone: MILESTONE,
      shipState: "parked",
      parkReason: PARK_REASON,
      totalTasks: 2,
      checkedTasks: 2,
    },
  ],
  frs: [{ id: "STE-860", milestone: MILESTONE, archived: true }],
};

/** Parked with NO reason recorded — the refusal must still be clean. */
const TREE_PARKED_NO_REASON: TreeSpec = {
  plans: [
    { milestone: MILESTONE, shipState: "parked", totalTasks: 2, checkedTasks: 2 },
  ],
  frs: [{ id: "STE-861", milestone: MILESTONE, archived: true }],
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

function recordingTracker(): ResumeTrackerSink & { claims: string[] } {
  const claims: string[] = [];
  return {
    claims,
    claimMilestone(milestone: string): void {
      claims.push(milestone);
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
      throw new Error("a tracker CLAIM was made when none must be");
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

/** A gate that FAILS LOUDLY if the operator is ever asked. */
function explodingGate(): ResumeOperatorGate {
  return {
    present(): ResumeGateAnswer {
      throw new Error("the operator gate was PRESENTED when it must not be");
    },
  };
}

// ===========================================================================
// Snapshot machinery — AC.2's real leg.
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
    expect(after, `${label}: a file's BYTES changed — the classifier wrote`).toEqual(
      before,
    );
  });
}

// ===========================================================================
// Prose helpers.
// ===========================================================================

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
 * The `##`-level section of `skills/deliver/SKILL.md` that introduces the
 * resume anchor, and NOTHING else.
 *
 * This slicing is load-bearing and it is not fussiness: this milestone has
 * already shipped two vacuous proximity pins whose window over the WHOLE file
 * was satisfied by pre-existing adjacent text. A window over this slice cannot
 * be.
 */
function resumeSection(): string {
  const lines = DELIVER_SKILL().split("\n");
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s+.*resum/i.test(lines[i]!)) {
      start = i;
      break;
    }
  }
  if (start === -1) return "";
  let end = lines.length;
  for (let j = start + 1; j < lines.length; j++) {
    if (/^##\s+/.test(lines[j]!)) {
      end = j;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

/** A distinctive sentence from a DIFFERENT section — the slice's control. */
const FOREIGN_SENTENCE = "`auto` is **strictly opt-in**";

/** Run an async `fn`, require a rejection, hand the message back. */
async function expectRefusal(
  fn: () => Promise<unknown>,
  label: string,
): Promise<string> {
  let raised: unknown = null;
  let returned: unknown = undefined;
  try {
    returned = await fn();
  } catch (e) {
    raised = e;
  }
  expect(
    returned,
    `${label}: an outcome came back instead of a refusal — the state FELL THROUGH`,
  ).toBeUndefined();
  expect(raised, `${label}: nothing was refused`).not.toBeNull();
  return String((raised as Error).message);
}

/** Assert the NFR-10 canonical three-line refusal shape. */
function expectNfr10Shape(msg: string, label: string): void {
  expect(msg, `${label}: no Refusing: line`).toMatch(/^Refusing:/m);
  expect(msg, `${label}: no Remedy: line`).toContain("Remedy:");
  expect(msg, `${label}: no Context: line`).toContain("Context:");
}

/** Steps as `<skill>@<placement>:<target>` — compact, order-preserving. */
function stepKeys(steps: readonly ResumeChainStep[]): string[] {
  return steps.map((s) => `${s.skill}@${s.placement}:${s.target}`);
}

// ===========================================================================
// TRIPWIRES — written first; they are what stops a bad "fix".
// ===========================================================================

describe("TRIPWIRE — the surfaces, budgets and premises this FR rides on", () => {
  const SKILL_LINE_CAP = 358;
  const SKILLS_STE_TOKEN_CEILING = 246;

  test("the FR still names all NINE ACs this file is written against", () => {
    const fr = read(frPath());
    for (let n = 1; n <= 9; n++) {
      expect(fr, `AC-STE-498.${n} missing from the FR`).toContain(
        `AC-STE-498.${n}:`,
      );
    }
  });

  test(`skills/deliver/SKILL.md stays within the NFR-1 line cap (${SKILL_LINE_CAP})`, () => {
    // 140 / 358 at authoring time — ample room for a resume section.
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
    // Resume is a `/deliver` capability, not a new surface.
    expect(readdirSync(SKILLS_DIR).length).toBe(27);
    expect(readdirSync(AGENTS_DIR).length).toBe(8);
  });

  test("PREMISE: all four helpers AC.3 names really are on disk", () => {
    // AC.3 says "assembly, not new machinery". If a helper vanished, the AC's
    // premise is gone and the reuse pins below would be meaningless.
    for (const [name, file] of Object.entries(REUSED_HELPER_FILES)) {
      expect(existsSync(file), `${name} is missing`).toBe(true);
    }
  });

  test("the serial invariant is imported, and it really is one", () => {
    expect(MAX_CONCURRENT_WORKERS).toBe(1);
  });

  test("containsInOrder REJECTS a mutated body — the order helper is not vacuous", () => {
    const body = "alpha\nbeta\ngamma\n";
    expect(containsInOrder(body, ["alpha", "beta", "gamma"])).toBe(true);
    expect(containsInOrder(body, ["gamma", "alpha"])).toBe(false);
    expect(containsInOrder(body, ["alpha", "delta"])).toBe(false);
  });

  test("the exploding sinks really throw — the never-touched pins are not vacuous", () => {
    expect(() => explodingSpawn().spawnWorker({ milestone: "M1", chain: [] })).toThrow();
    expect(() =>
      explodingInline().runInline({ skill: "/pr", placement: "worker", target: "M1" }),
    ).toThrow();
    expect(() => explodingTracker().claimMilestone("M1")).toThrow();
    expect(() =>
      explodingGate().present({
        milestone: "M1",
        state: "ready_to_implement",
        chain: [],
        rendered: "",
      }),
    ).toThrow();
  });
});

// ===========================================================================
// AC-STE-498.2 — the classifier reads only what is on disk and mutates NOTHING.
//
// Written SECOND, right after the tripwires, because it is the AC that most
// easily reads green by accident. Its falsifiability controls come first.
// ===========================================================================

describe("AC-STE-498.2 — read-only, mutation-verified", () => {
  test("CONTROL: the snapshot comparison DETECTS a rewrite, a create, and a delete", async () => {
    // Without this, every "nothing changed" assertion below could be satisfied
    // by a snapshot that compares nothing.
    await withTree(TREE_READY, async (root) => {
      const before = snapshot(root);

      const planFile = join(root, "specs", "plan", `${MILESTONE}.md`);
      writeFileSync(planFile, `${read(planFile)}\n- [ ] injected task\n`);
      expect(snapshot(root), "a REWRITE went undetected").not.toEqual(before);
      writeFileSync(planFile, before[`file:specs/plan/${MILESTONE}.md`]!);
      expect(snapshot(root), "restoring did not restore").toEqual(before);

      writeFileSync(join(root, "specs", "frs", "STE-999.md"), "x");
      expect(snapshot(root), "a NEW FILE went undetected").not.toEqual(before);
      rmSync(join(root, "specs", "frs", "STE-999.md"));

      rmSync(join(root, "specs", "frs", "STE-810.md"));
      expect(snapshot(root), "a DELETION went undetected").not.toEqual(before);
    });
  });

  const EVERY_STATE_TREE: readonly (readonly [string, TreeSpec])[] = [
    ["needs_technical_review", TREE_NEEDS_REVIEW],
    ["ready_to_implement", TREE_READY],
    ["partly_implemented", TREE_PARTLY],
    ["partly_implemented (by archive)", TREE_PARTLY_BY_ARCHIVE],
    ["ship_ready", TREE_SHIP_READY],
    ["shipped", TREE_SHIPPED],
    ["parked", TREE_PARKED],
  ];

  test("classifyResume writes nothing on ANY classification path", async () => {
    const { classifyResume } = await resumeMod();
    for (const [label, spec] of EVERY_STATE_TREE) {
      await assertReadOnly(spec, `classify ${label}`, async (root) => {
        await classifyResume(root, MILESTONE);
      });
    }
  });

  test("runResume writes nothing — confirm, edit, abort, and both refusals", async () => {
    const { runResume } = await resumeMod();
    for (const decision of ["confirm", "edit", "abort"] as const) {
      await assertReadOnly(TREE_READY, `runResume ${decision}`, async (root) => {
        await runResume({
          projectRoot: root,
          milestone: MILESTONE,
          gate: fixedGate(decision),
          spawn: recordingSpawn(),
          inline: recordingInline(),
          tracker: recordingTracker(),
        });
      });
    }
    for (const [label, spec] of [
      ["shipped", TREE_SHIPPED],
      ["parked", TREE_PARKED],
    ] as const) {
      await assertReadOnly(spec, `runResume ${label} refusal`, async (root) => {
        await expectRefusal(
          () =>
            runResume({
              projectRoot: root,
              milestone: MILESTONE,
              gate: explodingGate(),
              spawn: explodingSpawn(),
              inline: explodingInline(),
              tracker: explodingTracker(),
            }),
          `${label} refusal`,
        );
      });
    }
  });

  test("no TRACKER write happens anywhere in classification", async () => {
    // Classification is not the claim. The claim is AC.7's business and it is
    // gated; classifying must not touch the tracker at all.
    const { classifyResume } = await resumeMod();
    for (const [, spec] of EVERY_STATE_TREE) {
      await withTree(spec, async (root) => {
        // An exploding tracker sink is not reachable from classifyResume's
        // signature at all — which is the point. The source leg below proves
        // the module has no other channel to one.
        await classifyResume(root, MILESTONE);
      });
    }
    const src = read(RESUME_MODULE_FILE);
    for (const token of ["save_issue", "mcp__linear", "mcp__atlassian", "editJiraIssue"]) {
      expect(src, `the module reaches a tracker directly via ${token}`).not.toContain(
        token,
      );
    }
  });

  test("SECOND LEG: the module source carries no write or exec channel at all", async () => {
    await resumeMod();
    const src = read(RESUME_MODULE_FILE)
      .split("\n")
      .filter((l) => {
        const t = l.trimStart();
        return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
      })
      .join("\n");
    for (const token of [
      "writeFile",
      "appendFile",
      "mkdir",
      "rmSync",
      "unlink",
      "rename",
      "copyFile",
      "execSync",
      "spawnSync",
      "child_process",
      "Bun.write",
      "Bun.spawn",
    ]) {
      expect(src, `a write/exec channel (${token}) lives in the module`).not.toContain(
        token,
      );
    }
  });
});

// ===========================================================================
// AC-STE-498.1 — six states, and each one is reachable.
// ===========================================================================

describe("AC-STE-498.1 — the six states that change the entry point", () => {
  test("the module exists at its pinned path under adapters/_shared/src", () => {
    expect(existsSync(RESUME_MODULE_FILE)).toBe(true);
  });

  test("the vocabulary is exactly the six states the FR names", async () => {
    const { RESUME_STATES } = await resumeMod();
    expect([...RESUME_STATES].sort()).toEqual(
      [
        "needs_technical_review",
        "parked",
        "partly_implemented",
        "ready_to_implement",
        "ship_ready",
        "shipped",
      ].sort(),
    );
  });

  test("FRs awaiting technical review classify as needs_technical_review", async () => {
    const { classifyResume } = await resumeMod();
    await withTree(TREE_NEEDS_REVIEW, async (root) => {
      const c = await classifyResume(root, MILESTONE);
      expect(c.state).toBe("needs_technical_review");
      expect(c.milestone).toBe(MILESTONE);
      expect([...c.frsAwaitingReview].sort()).toEqual(["STE-800", "STE-801"]);
    });
  });

  test("specs complete and nothing built classifies as ready_to_implement", async () => {
    const { classifyResume } = await resumeMod();
    await withTree(TREE_READY, async (root) => {
      const c = await classifyResume(root, MILESTONE);
      expect(c.state).toBe("ready_to_implement");
      expect(c.frsAwaitingReview).toEqual([]);
    });
  });

  test("some plan tasks ticked classifies as partly_implemented", async () => {
    const { classifyResume } = await resumeMod();
    await withTree(TREE_PARTLY, async (root) => {
      const c = await classifyResume(root, MILESTONE);
      expect(c.state).toBe("partly_implemented");
    });
  });

  test("one FR archived while another stays active is partly_implemented", async () => {
    // The real half-abandoned shape: work landed and archived per FR, not per
    // plan checkbox. A classifier that read only the checkboxes calls this
    // ready_to_implement and re-runs finished work.
    const { classifyResume } = await resumeMod();
    await withTree(TREE_PARTLY_BY_ARCHIVE, async (root) => {
      const c = await classifyResume(root, MILESTONE);
      expect(c.state).toBe("partly_implemented");
    });
  });

  test("zero active FRs with an archived FR bound classifies as ship_ready", async () => {
    const { classifyResume } = await resumeMod();
    await withTree(TREE_SHIP_READY, async (root) => {
      const c = await classifyResume(root, MILESTONE);
      expect(c.state).toBe("ship_ready");
    });
  });

  test("a real shipped_in stamp classifies as shipped, carrying the stamp", async () => {
    const { classifyResume } = await resumeMod();
    await withTree(TREE_SHIPPED, async (root) => {
      const c = await classifyResume(root, MILESTONE);
      expect(c.state).toBe("shipped");
      expect(c.shippedIn).toBe("v9.9.9");
      expect(c.planStatus).toBe("archived");
    });
  });

  test("`ship_state: parked` classifies as parked, carrying the reason", async () => {
    const { classifyResume } = await resumeMod();
    await withTree(TREE_PARKED, async (root) => {
      const c = await classifyResume(root, MILESTONE);
      expect(c.state).toBe("parked");
      expect(c.parkedReason).toBe(PARK_REASON);
    });
  });

  test("parked with no reason recorded is still parked, reason null", async () => {
    const { classifyResume } = await resumeMod();
    await withTree(TREE_PARKED_NO_REASON, async (root) => {
      const c = await classifyResume(root, MILESTONE);
      expect(c.state).toBe("parked");
      expect(c.parkedReason).toBeNull();
    });
  });

  test("NON-VACUITY: the seven fixtures produce SIX distinct states", async () => {
    // Without this, every leg above could be satisfied by a classifier that
    // returns one constant per fixture shape by accident.
    const { classifyResume } = await resumeMod();
    const seen: string[] = [];
    for (const spec of [
      TREE_NEEDS_REVIEW,
      TREE_READY,
      TREE_PARTLY,
      TREE_SHIP_READY,
      TREE_SHIPPED,
      TREE_PARKED,
    ]) {
      await withTree(spec, async (root) => {
        seen.push((await classifyResume(root, MILESTONE)).state);
      });
    }
    expect(new Set(seen).size, `states seen: ${seen.join(", ")}`).toBe(6);
  });

  test("PRECEDENCE: shipped beats a stale review flag, parked beats ship-ready", async () => {
    // Both fixtures would classify differently on a naive first-match reading.
    const { classifyResume } = await resumeMod();
    await withTree(
      {
        plans: [
          {
            milestone: MILESTONE,
            archived: true,
            shippedIn: "v9.9.9",
            totalTasks: 2,
            checkedTasks: 0,
          },
        ],
        frs: [{ id: "STE-870", milestone: MILESTONE, needsReview: true }],
        changelogVersions: ["9.9.9"],
      },
      async (root) => {
        expect((await classifyResume(root, MILESTONE)).state).toBe("shipped");
      },
    );
    await withTree(TREE_PARKED, async (root) => {
      // TREE_PARKED is ALSO ship-ready-shaped (zero active FRs, one archived).
      expect((await classifyResume(root, MILESTONE)).state).toBe("parked");
    });
  });
});

// ===========================================================================
// AC-STE-498.3 — assembly, not a second source of truth.
// ===========================================================================

describe("AC-STE-498.3 — the four helpers are REUSED, not re-derived", () => {
  test("the module IMPORTS all four named helpers", async () => {
    await resumeMod();
    const src = read(RESUME_MODULE_FILE);
    for (const name of Object.keys(REUSED_HELPER_FILES)) {
      expect(src, `the module does not import ./${name}`).toContain(
        `from "./${name}"`,
      );
    }
  });

  test("plan task state comes from readPlanTaskState, byte for byte", async () => {
    // Asserted on fixtures whose numbers DIFFER, so a hard-coded pair cannot
    // pass all three.
    const { classifyResume } = await resumeMod();
    const numbers: string[] = [];
    for (const spec of [TREE_READY, TREE_PARTLY, TREE_SHIPPED]) {
      await withTree(spec, async (root) => {
        const c = await classifyResume(root, MILESTONE);
        const truth = await readPlanTaskState(join(root, "specs"), MILESTONE);
        expect(c.totalTasks).toBe(truth.totalTasks);
        expect(c.uncheckedTasks).toBe(truth.uncheckedTasks);
        expect(c.planStatus).toBe(truth.planStatus);
        numbers.push(`${c.totalTasks}/${c.uncheckedTasks}/${c.planStatus}`);
      });
    }
    expect(new Set(numbers).size, `numbers seen: ${numbers.join(" ")}`).toBe(3);
  });

  test("ship-readiness agrees with shipReadyMilestones, both directions", async () => {
    const { classifyResume } = await resumeMod();
    await withTree(TREE_SHIP_READY, async (root) => {
      expect(await shipReadyMilestones(root)).toContain(MILESTONE);
      expect((await classifyResume(root, MILESTONE)).state).toBe("ship_ready");
    });
    // The negative direction: the shipped predicate says no, and so must the
    // classifier — otherwise the two would drift into two answers.
    for (const spec of [TREE_READY, TREE_PARTLY, TREE_PARKED]) {
      await withTree(spec, async (root) => {
        expect(await shipReadyMilestones(root)).not.toContain(MILESTONE);
        expect((await classifyResume(root, MILESTONE)).state).not.toBe("ship_ready");
      });
    }
  });

  test("the review flag has ONE owner — the review module exports the enumerator", async () => {
    // Re-deriving "which FRs await technical review" would create the second
    // source of truth AC.3 exists to forbid, so the enumerator lives in the
    // module that already owns the flag and the classifier imports it.
    const { frsAwaitingTechnicalReview } = await reviewEnumerator();
    expect(typeof frsAwaitingTechnicalReview).toBe("function");
    expect(read(RESUME_MODULE_FILE)).toContain(
      'from "./needs_technical_review_consistency"',
    );
  });

  test("the enumerator and the classification agree, and the classification is MILESTONE-SCOPED", async () => {
    const { classifyResume } = await resumeMod();
    const { frsAwaitingTechnicalReview } = await reviewEnumerator();
    await withTree(
      {
        plans: [
          { milestone: MILESTONE, totalTasks: 2, checkedTasks: 0 },
          { milestone: OTHER_MILESTONE, totalTasks: 2, checkedTasks: 0 },
        ],
        frs: [
          { id: "STE-880", milestone: MILESTONE, needsReview: true },
          { id: "STE-881", milestone: OTHER_MILESTONE, needsReview: true },
          { id: "STE-882", milestone: MILESTONE },
        ],
      },
      async (root) => {
        const all = await frsAwaitingTechnicalReview(root);
        expect([...all].map((e) => e.id).sort()).toEqual(["STE-880", "STE-881"]);
        const c = await classifyResume(root, MILESTONE);
        // Scoped: the OTHER milestone's flagged FR must not appear here.
        expect([...c.frsAwaitingReview]).toEqual(["STE-880"]);
      },
    );
  });

  test("ISOLATION: an unflagged tree enumerates nothing", async () => {
    const { frsAwaitingTechnicalReview } = await reviewEnumerator();
    await withTree(TREE_READY, async (root) => {
      expect([...(await frsAwaitingTechnicalReview(root))]).toEqual([]);
    });
  });

  test("the coherence and consistency probes are CONSULTED, not re-implemented", async () => {
    const { classifyResume } = await resumeMod();
    // A stamp with no matching CHANGELOG heading: `plan_ship_coherence` calls
    // it a corrupt stamp, and the classifier must surface that rather than
    // quietly reading the milestone as cleanly shipped.
    await withTree(
      {
        plans: [
          { milestone: MILESTONE, archived: true, shippedIn: "v8.8.8", totalTasks: 1 },
        ],
        frs: [{ id: "STE-890", milestone: MILESTONE, archived: true }],
        changelogVersions: [],
      },
      async (root) => {
        const truth = await runPlanShipCoherenceProbe(root);
        expect(truth.violations.length, "fixture premise: no probe violation").toBe(1);
        const c = await classifyResume(root, MILESTONE);
        expect(
          c.shipCoherenceViolations.length,
          "the corrupt stamp was not surfaced",
        ).toBe(1);
        expect(c.shipCoherenceViolations[0]!).toContain("plan_ship_coherence");
      },
    );
    // A flag/placeholder mismatch: `needs_technical_review_consistency` fires,
    // and the classifier must carry it rather than swallowing it.
    await withTree(
      {
        plans: [{ milestone: MILESTONE, totalTasks: 2 }],
        frs: [
          { id: "STE-891", milestone: MILESTONE, needsReview: true, inconsistent: true },
        ],
      },
      async (root) => {
        const truth = await runNeedsTechnicalReviewConsistencyProbe(root);
        expect(truth.violations.length, "fixture premise: no probe violation").toBe(2);
        const c = await classifyResume(root, MILESTONE);
        expect(
          c.reviewConsistencyViolations.length,
          "the flag inconsistency was not surfaced",
        ).toBe(2);
      },
    );
  });

  test("ISOLATION: a coherent tree surfaces NO violations from either probe", async () => {
    // Without this, "violations are surfaced" would be satisfied by a
    // classifier that reports a violation on every tree.
    const { classifyResume } = await resumeMod();
    for (const spec of [TREE_READY, TREE_SHIP_READY, TREE_SHIPPED]) {
      await withTree(spec, async (root) => {
        const c = await classifyResume(root, MILESTONE);
        expect(c.shipCoherenceViolations).toEqual([]);
        expect(c.reviewConsistencyViolations).toEqual([]);
      });
    }
  });

  test("the module keeps NO private copy of any helper's predicate", async () => {
    // The STE-335 audit idiom: grep the consumer for a second copy so the one
    // home for each question cannot quietly grow another.
    await resumeMod();
    const src = read(RESUME_MODULE_FILE)
      .split("\n")
      .filter((l) => {
        const t = l.trimStart();
        return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
      })
      .join("\n");
    const forbidden: readonly (readonly [string, string])[] = [
      // plan_task_state's task-list grammar — its one home.
      ["a private task-list character class", "[[ x]]"],
      ["a private unchecked-task literal", "[ ]"],
      // active_plan_ship_ready's active/archived FR derivation. The classifier
      // learns FR facts from that predicate and from the review enumerator; it
      // never walks `specs/frs/` itself.
      ["a private FR-directory walk", '"frs"'],
      // plan_ship_coherence's CHANGELOG heading scan.
      ["a private CHANGELOG scan", "CHANGELOG"],
      // needs_technical_review_consistency's placeholder anchor.
      ["a private review placeholder", "needs technical review —"],
      // …and its frontmatter flag, which the enumerator now owns.
      ["a private review-flag read", "needs_technical_review:"],
    ];
    for (const [label, needle] of forbidden) {
      expect(
        src.includes(needle),
        `${label} (${JSON.stringify(needle)}) lives in the module`,
      ).toBe(false);
    }
  });
});

// ===========================================================================
// AC-STE-498.4 — the spec-writing passes run INLINE, never in a worker.
//
// A hard inherited constraint: `/spec-write` is Socratic and `/deliver` already
// forbids proxying Socratic questions.
// ===========================================================================

describe("AC-STE-498.4 — the partial spec-writing leg is inline, and only it", () => {
  test("every `/spec-write` step is placed inline, one per flagged FR, in order", async () => {
    const { classifyResume, resumeChain } = await resumeMod();
    await withTree(TREE_NEEDS_REVIEW, async (root) => {
      const chain = resumeChain(await classifyResume(root, MILESTONE));
      const writes = chain.filter((s) => s.skill === "/spec-write");
      expect(writes.length, "one `/spec-write` pass per flagged FR").toBe(2);
      expect(writes.map((s) => s.target)).toEqual(["STE-800", "STE-801"]);
      for (const s of writes) {
        expect(s.placement, `${s.target} was not placed inline`).toBe("inline");
      }
    });
  });

  test("the inline steps really run in-session, and the worker never sees them", async () => {
    const { runResume } = await resumeMod();
    await withTree(TREE_NEEDS_REVIEW, async (root) => {
      const spawn = recordingSpawn();
      const inline = recordingInline();
      await runResume({
        projectRoot: root,
        milestone: MILESTONE,
        gate: fixedGate("confirm"),
        spawn,
        inline,
        tracker: recordingTracker(),
      });
      expect(stepKeys(inline.steps)).toEqual([
        "/spec-write@inline:STE-800",
        "/spec-write@inline:STE-801",
      ]);
      expect(spawn.spawns.length, "exactly one worker for the milestone").toBe(1);
      const workerChain = spawn.spawns[0]!.chain;
      expect(
        workerChain.some((s) => s.skill === "/spec-write"),
        "a Socratic `/spec-write` pass was pushed into the spawned worker",
      ).toBe(false);
      expect(
        workerChain.some((s) => s.placement === "inline"),
        "an inline-placed step was handed to the worker",
      ).toBe(false);
    });
  });

  test("ISOLATION: the SAME invocation DOES put `/implement` in the worker", async () => {
    // Without this, "spec-write runs inline" would be satisfied by a router
    // that runs absolutely everything inline and spawns nothing.
    const { runResume } = await resumeMod();
    await withTree(TREE_NEEDS_REVIEW, async (root) => {
      const spawn = recordingSpawn();
      const inline = recordingInline();
      await runResume({
        projectRoot: root,
        milestone: MILESTONE,
        gate: fixedGate("confirm"),
        spawn,
        inline,
        tracker: recordingTracker(),
      });
      expect(stepKeys(spawn.spawns[0]!.chain)).toEqual([
        `/implement@worker:${MILESTONE}`,
        `/ship-milestone@worker:${MILESTONE}`,
        `/pr@worker:${MILESTONE}`,
      ]);
      expect(
        inline.steps.some((s) => s.skill === "/implement"),
        "`/implement` was run inline in the orchestrating session",
      ).toBe(false);
    });
  });

  test("a milestone with NO flagged FRs gets no inline step at all", async () => {
    const { runResume } = await resumeMod();
    await withTree(TREE_READY, async (root) => {
      const inline = recordingInline();
      await runResume({
        projectRoot: root,
        milestone: MILESTONE,
        gate: fixedGate("confirm"),
        spawn: recordingSpawn(),
        inline,
        tracker: recordingTracker(),
      });
      expect(inline.steps, "an inline pass ran with nothing to spec-write").toEqual(
        [],
      );
    });
  });

  // AMENDED 2026-08-17 by operator decision. This pin previously asserted the
  // unconditional "never in a spawned worker", which collided with
  // AC-STE-495.3's cross-repo route. It now asserts the SCOPED rule — which is
  // strictly stronger, because it requires BOTH branches to be stated rather
  // than one, and still requires the reason to be given.
  test("PROSE: the resume section scopes the placement by target repo, with the reason", () => {
    const section = resumeSection();
    expect(section, "no resume section exists on the operative SKILL surface").not.toBe(
      "",
    );
    expect(section.toLowerCase()).toContain("spec-write");
    // Branch 1 — the invoking repo, which is what every plan on disk means.
    expect(section.toLowerCase()).toContain("inline in the invoking session");
    // Branch 2 — a declared cross-repo toolkit target.
    expect(section).toMatch(/target repo's own worker|inside the target repo/i);
    // The reason still has to be stated, not just the rule.
    expect(
      /socratic/i.test(section),
      "the section never says WHY placement is constrained at all",
    ).toBe(true);
    // And the retired absolute must NOT come back — it is the thing that
    // contradicted a shipped AC.
    expect(section).not.toMatch(/never in a spawned worker/i);
  });
});

// ===========================================================================
// AC-STE-498.5 — a ship-ready milestone enters at `/ship-milestone`.
// ===========================================================================

describe("AC-STE-498.5 — ship-ready skips `/implement`", () => {
  test("the chain begins at `/ship-milestone` and contains no `/implement`", async () => {
    const { classifyResume, resumeChain } = await resumeMod();
    await withTree(TREE_SHIP_READY, async (root) => {
      const chain = resumeChain(await classifyResume(root, MILESTONE));
      expect(stepKeys(chain)).toEqual([
        `/ship-milestone@worker:${MILESTONE}`,
        `/pr@worker:${MILESTONE}`,
      ]);
    });
  });

  test("end to end: the spawned worker's chain never carries `/implement`", async () => {
    const { runResume } = await resumeMod();
    await withTree(TREE_SHIP_READY, async (root) => {
      const spawn = recordingSpawn();
      const outcome = await runResume({
        projectRoot: root,
        milestone: MILESTONE,
        gate: fixedGate("confirm"),
        spawn,
        inline: explodingInline(),
        tracker: recordingTracker(),
      });
      expect(outcome.state).toBe("ship_ready");
      expect(
        spawn.spawns[0]!.chain.some((s) => s.skill === "/implement"),
        "a ship-ready milestone was sent through `/implement` anyway",
      ).toBe(false);
      expect(spawn.spawns[0]!.chain[0]!.skill).toBe("/ship-milestone");
    });
  });

  test("ISOLATION: the SAME chain builder DOES emit `/implement` when it is due", async () => {
    // Without this, "ship-ready skips implement" would be satisfied by a
    // builder that never emits `/implement` for anything.
    const { classifyResume, resumeChain } = await resumeMod();
    for (const spec of [TREE_READY, TREE_PARTLY, TREE_NEEDS_REVIEW]) {
      await withTree(spec, async (root) => {
        const chain = resumeChain(await classifyResume(root, MILESTONE));
        expect(
          chain.some((s) => s.skill === "/implement" && s.placement === "worker"),
          "`/implement` vanished from a milestone that still needs it",
        ).toBe(true);
      });
    }
  });

  test("partly_implemented and ready_to_implement BOTH enter at `/implement`", async () => {
    const { classifyResume, resumeChain } = await resumeMod();
    for (const spec of [TREE_READY, TREE_PARTLY]) {
      await withTree(spec, async (root) => {
        const chain = resumeChain(await classifyResume(root, MILESTONE));
        expect(stepKeys(chain)).toEqual([
          `/implement@worker:${MILESTONE}`,
          `/ship-milestone@worker:${MILESTONE}`,
          `/pr@worker:${MILESTONE}`,
        ]);
      });
    }
  });

  test("PROSE: the resume section states the ship-ready entry point", () => {
    const section = resumeSection();
    expect(section).toContain("/ship-milestone");
    expect(section).toContain("/implement");
    expect(
      /ship-ready/i.test(section),
      "the section never names the ship-ready state",
    ).toBe(true);
    expect(
      /skip(?:ping|s)? [^.\n]{0,40}\/implement|without [^.\n]{0,30}\/implement/i.test(
        section,
      ),
      "the section never says `/implement` is skipped",
    ).toBe(true);
  });
});

// ===========================================================================
// AC-STE-498.6 — shipped and parked refuse cleanly.
// ===========================================================================

describe("AC-STE-498.6 — a shipped or parked milestone refuses", () => {
  test("the chain for a shipped or parked milestone is EMPTY", async () => {
    const { classifyResume, resumeChain } = await resumeMod();
    for (const spec of [TREE_SHIPPED, TREE_PARKED]) {
      await withTree(spec, async (root) => {
        expect(resumeChain(await classifyResume(root, MILESTONE))).toEqual([]);
      });
    }
  });

  test("a shipped milestone refuses in the NFR-10 shape, naming the stamp", async () => {
    const { runResume } = await resumeMod();
    await withTree(TREE_SHIPPED, async (root) => {
      const msg = await expectRefusal(
        () =>
          runResume({
            projectRoot: root,
            milestone: MILESTONE,
            gate: explodingGate(),
            spawn: explodingSpawn(),
            inline: explodingInline(),
            tracker: explodingTracker(),
          }),
        "shipped",
      );
      expectNfr10Shape(msg, "shipped");
      expect(msg, "the refusal never names the milestone").toContain(MILESTONE);
      expect(msg, "the refusal never names the shipped stamp").toContain("v9.9.9");
    });
  });

  test("a parked milestone's refusal SURFACES the parked reason", async () => {
    const { runResume } = await resumeMod();
    await withTree(TREE_PARKED, async (root) => {
      const msg = await expectRefusal(
        () =>
          runResume({
            projectRoot: root,
            milestone: MILESTONE,
            gate: explodingGate(),
            spawn: explodingSpawn(),
            inline: explodingInline(),
            tracker: explodingTracker(),
          }),
        "parked",
      );
      expectNfr10Shape(msg, "parked");
      expect(msg, "the parked reason was not surfaced").toContain(PARK_REASON);
    });
  });

  test("parked with NO reason still refuses CLEANLY — no null, no undefined", async () => {
    const { runResume } = await resumeMod();
    await withTree(TREE_PARKED_NO_REASON, async (root) => {
      const msg = await expectRefusal(
        () =>
          runResume({
            projectRoot: root,
            milestone: MILESTONE,
            gate: explodingGate(),
            spawn: explodingSpawn(),
            inline: explodingInline(),
            tracker: explodingTracker(),
          }),
        "parked no reason",
      );
      expectNfr10Shape(msg, "parked no reason");
      expect(msg, "a null leaked into the refusal").not.toMatch(/\bnull\b/);
      expect(msg, "an undefined leaked into the refusal").not.toMatch(/\bundefined\b/);
      expect(msg).toContain(MILESTONE);
    });
  });

  test("the refusal is a NAMED error, and nothing is spawned or claimed", async () => {
    const { runResume, ResumeRefusedError } = await resumeMod();
    for (const [label, spec] of [
      ["shipped", TREE_SHIPPED],
      ["parked", TREE_PARKED],
    ] as const) {
      await withTree(spec, async (root) => {
        const spawn = recordingSpawn();
        const tracker = recordingTracker();
        const gate = fixedGate("confirm");
        let raised: unknown = null;
        try {
          await runResume({
            projectRoot: root,
            milestone: MILESTONE,
            gate,
            spawn,
            inline: recordingInline(),
            tracker,
          });
        } catch (e) {
          raised = e;
        }
        expect(raised, `${label}: nothing was refused`).not.toBeNull();
        expect(raised).toBeInstanceOf(ResumeRefusedError);
        expect((raised as Error).name).toBe("ResumeRefusedError");
        expect(spawn.spawns, `${label}: a worker was spawned anyway`).toEqual([]);
        expect(tracker.claims, `${label}: a tracker claim was made anyway`).toEqual([]);
        expect(
          gate.presented,
          `${label}: the operator was asked to confirm a refusal`,
        ).toEqual([]);
      });
    }
  });

  test("ISOLATION: a resumable milestone is NOT refused", async () => {
    // Without this, AC.6 would be satisfied by a resumer that refuses always.
    const { runResume } = await resumeMod();
    for (const spec of [TREE_READY, TREE_PARTLY, TREE_SHIP_READY, TREE_NEEDS_REVIEW]) {
      await withTree(spec, async (root) => {
        const outcome = await runResume({
          projectRoot: root,
          milestone: MILESTONE,
          gate: fixedGate("confirm"),
          spawn: recordingSpawn(),
          inline: recordingInline(),
          tracker: recordingTracker(),
        });
        expect(outcome.decision).toBe("confirm");
      });
    }
  });

  test("PROSE: the resume section states the shipped/parked refusal and the reason", () => {
    const section = resumeSection();
    expect(section.toLowerCase()).toContain("refus");
    expect(section.toLowerCase()).toContain("parked");
    expect(section.toLowerCase()).toContain("shipped");
    expect(
      /reason/i.test(section),
      "the section never says the parked reason is surfaced",
    ).toBe(true);
  });
});

// ===========================================================================
// AC-STE-498.7 — the operator sees the verdict and the exact chain FIRST.
// ===========================================================================

describe("AC-STE-498.7 — the classified state and the chain are rendered, then confirmed", () => {
  test("the render names the state, the milestone, and EVERY step in order", async () => {
    const { classifyResume, renderResumePlan, resumeChain } = await resumeMod();
    await withTree(TREE_NEEDS_REVIEW, async (root) => {
      const c = await classifyResume(root, MILESTONE);
      const plan = renderResumePlan(c);
      expect(plan.milestone).toBe(MILESTONE);
      expect(plan.state).toBe("needs_technical_review");
      expect(plan.chain, "the rendered plan's chain is not the chain builder's").toEqual(
        resumeChain(c),
      );
      expect(plan.rendered).toContain(MILESTONE);
      expect(plan.rendered).toContain("needs_technical_review");
      // "The EXACT chain the orchestrator intends to run" — every step, in
      // order, with its placement, or the operator is confirming a summary.
      expect(
        containsInOrder(plan.rendered, [
          "/spec-write",
          "STE-800",
          "/spec-write",
          "STE-801",
          "/implement",
          "/ship-milestone",
          "/pr",
        ]),
        "the render does not carry the chain in order",
      ).toBe(true);
      expect(plan.rendered.toLowerCase()).toContain("inline");
    });
  });

  test("NON-VACUITY: a different state renders a different chain", async () => {
    const { classifyResume, renderResumePlan } = await resumeMod();
    const renders: string[] = [];
    for (const spec of [TREE_NEEDS_REVIEW, TREE_READY, TREE_SHIP_READY]) {
      await withTree(spec, async (root) => {
        renders.push(renderResumePlan(await classifyResume(root, MILESTONE)).rendered);
      });
    }
    expect(new Set(renders).size, "three states rendered the same text").toBe(3);
    expect(renders[2], "a ship-ready render still advertises `/implement`").not.toContain(
      "/implement",
    );
  });

  test("AT THE GATE both sinks are still EMPTY — nothing spawned, nothing claimed", async () => {
    // The strongest available reading of "before any worker is spawned and
    // before any tracker claim is made": the gate itself inspects the sinks at
    // the moment it is presented.
    const { runResume } = await resumeMod();
    await withTree(TREE_READY, async (root) => {
      const spawn = recordingSpawn();
      const tracker = recordingTracker();
      const inline = recordingInline();
      let observed: { spawns: number; claims: number; inline: number } | null = null;
      const gate: ResumeOperatorGate = {
        present(): ResumeGateAnswer {
          observed = {
            spawns: spawn.spawns.length,
            claims: tracker.claims.length,
            inline: inline.steps.length,
          };
          return { decision: "confirm" };
        },
      };
      await runResume({
        projectRoot: root,
        milestone: MILESTONE,
        gate,
        spawn,
        inline,
        tracker,
      });
      expect(observed, "the operator gate was never presented at all").not.toBeNull();
      expect(observed!.spawns, "a worker was spawned BEFORE the operator answered").toBe(
        0,
      );
      expect(observed!.claims, "a tracker claim was made BEFORE the gate").toBe(0);
      expect(observed!.inline, "an inline pass ran BEFORE the gate").toBe(0);
    });
  });

  test("the gate is presented exactly ONCE, with the plan that gets run", async () => {
    const { runResume } = await resumeMod();
    await withTree(TREE_READY, async (root) => {
      const gate = fixedGate("confirm");
      const spawn = recordingSpawn();
      const outcome = await runResume({
        projectRoot: root,
        milestone: MILESTONE,
        gate,
        spawn,
        inline: recordingInline(),
        tracker: recordingTracker(),
      });
      expect(gate.presented.length).toBe(1);
      expect(gate.presented[0]!.chain).toEqual(outcome.chain);
      expect(spawn.spawns[0]!.chain).toEqual(
        outcome.chain.filter((s) => s.placement === "worker"),
      );
    });
  });

  test("after confirming, the claim IS made — the gate is a gate, not a wall", async () => {
    // Without this, AC.7 would be satisfied by a resumer that never claims at
    // all, which would also make AC.8 vacuous.
    const { runResume } = await resumeMod();
    await withTree(TREE_READY, async (root) => {
      const spawn = recordingSpawn();
      const tracker = recordingTracker();
      await runResume({
        projectRoot: root,
        milestone: MILESTONE,
        gate: fixedGate("confirm"),
        spawn,
        inline: recordingInline(),
        tracker,
      });
      expect(spawn.spawns.length, "confirming spawned no worker").toBe(1);
      expect(tracker.claims, "confirming made no tracker claim").toEqual([MILESTONE]);
    });
  });

  test("EDIT runs the operator's chain, not the proposed one", async () => {
    const { runResume } = await resumeMod();
    await withTree(TREE_READY, async (root) => {
      const edited: readonly ResumeChainStep[] = [
        { skill: "/ship-milestone", placement: "worker", target: MILESTONE },
        { skill: "/pr", placement: "worker", target: MILESTONE },
      ];
      const spawn = recordingSpawn();
      const outcome = await runResume({
        projectRoot: root,
        milestone: MILESTONE,
        gate: fixedGate("edit", edited),
        spawn,
        inline: recordingInline(),
        tracker: recordingTracker(),
      });
      expect(outcome.decision).toBe("edit");
      expect(outcome.chain).toEqual(edited);
      expect(stepKeys(spawn.spawns[0]!.chain)).toEqual(stepKeys(edited));
      expect(
        spawn.spawns[0]!.chain.some((s) => s.skill === "/implement"),
        "the PROPOSED chain ran instead of the edited one",
      ).toBe(false);
    });
  });

  test("PROSE: the resume section states the confirm-before-anything contract", () => {
    const section = resumeSection();
    expect(
      /confirm/i.test(section),
      "the section never asks the operator to confirm",
    ).toBe(true);
    expect(
      /abort|cancel/i.test(section),
      "the section never offers the abort",
    ).toBe(true);
    expect(
      /edit|adjust|change/i.test(section),
      "the section never offers the edit",
    ).toBe(true);
    expect(
      /before (?:any|a) [^.\n]{0,40}spawn|before (?:any|a) worker/i.test(section),
      "the section never orders the gate BEFORE the spawn",
    ).toBe(true);
    expect(
      /tracker/i.test(section),
      "the section never mentions the tracker claim the gate precedes",
    ).toBe(true);
  });
});

// ===========================================================================
// AC-STE-498.8 — aborting is genuinely free.
// ===========================================================================

describe("AC-STE-498.8 — abort leaves no side effects", () => {
  test("aborting spawns nothing, claims nothing, and runs nothing inline", async () => {
    const { runResume } = await resumeMod();
    for (const spec of [TREE_READY, TREE_PARTLY, TREE_SHIP_READY, TREE_NEEDS_REVIEW]) {
      await withTree(spec, async (root) => {
        const spawn = recordingSpawn();
        const inline = recordingInline();
        const tracker = recordingTracker();
        const outcome = await runResume({
          projectRoot: root,
          milestone: MILESTONE,
          gate: fixedGate("abort"),
          spawn,
          inline,
          tracker,
        });
        expect(outcome.decision).toBe("abort");
        expect(outcome.chain, "an aborted run still reports a chain as RUN").toEqual([]);
        expect(spawn.spawns, "abort spawned a worker").toEqual([]);
        expect(inline.steps, "abort ran an inline pass").toEqual([]);
        expect(tracker.claims, "abort made a tracker claim").toEqual([]);
      });
    }
  });

  test("MUTATION-VERIFIED: exploding sinks are never touched on abort", async () => {
    // The complementary reading: if abort touched any sink, that sink's own
    // distinctive error would surface here instead of a clean outcome.
    const { runResume } = await resumeMod();
    await withTree(TREE_NEEDS_REVIEW, async (root) => {
      const outcome = await runResume({
        projectRoot: root,
        milestone: MILESTONE,
        gate: fixedGate("abort"),
        spawn: explodingSpawn(),
        inline: explodingInline(),
        tracker: explodingTracker(),
      });
      expect(outcome.decision).toBe("abort");
    });
  });

  test("aborting leaves the tree byte-identical, listing included", async () => {
    const { runResume } = await resumeMod();
    await assertReadOnly(TREE_NEEDS_REVIEW, "abort", async (root) => {
      await runResume({
        projectRoot: root,
        milestone: MILESTONE,
        gate: fixedGate("abort"),
        spawn: explodingSpawn(),
        inline: explodingInline(),
        tracker: explodingTracker(),
      });
    });
  });

  test("ISOLATION: confirming on the SAME fixture DOES produce effects", async () => {
    // Without this, "abort has no effects" would be satisfied by a resumer
    // that has no effects on any path.
    const { runResume } = await resumeMod();
    await withTree(TREE_NEEDS_REVIEW, async (root) => {
      const spawn = recordingSpawn();
      const inline = recordingInline();
      const tracker = recordingTracker();
      await runResume({
        projectRoot: root,
        milestone: MILESTONE,
        gate: fixedGate("confirm"),
        spawn,
        inline,
        tracker,
      });
      expect(spawn.spawns.length).toBe(1);
      expect(inline.steps.length).toBe(2);
      expect(tracker.claims).toEqual([MILESTONE]);
    });
  });

  test("PROSE: the resume section states that aborting costs nothing", () => {
    const section = resumeSection();
    expect(
      /no side effects?|nothing (?:is )?(?:spawned|claimed|happens)|leaves? nothing/i.test(
        section,
      ),
      "the section never states the abort is free",
    ).toBe(true);
  });
});

// ===========================================================================
// AC-STE-498.9 — one milestone per invocation; the serial topology is unchanged.
// ===========================================================================

describe("AC-STE-498.9 — one milestone, one worker, unchanged topology", () => {
  const TWO_MILESTONES: TreeSpec = {
    plans: [
      { milestone: MILESTONE, totalTasks: 3, checkedTasks: 0 },
      { milestone: OTHER_MILESTONE, totalTasks: 3, checkedTasks: 0 },
    ],
    frs: [
      { id: "STE-900", milestone: MILESTONE },
      { id: "STE-901", milestone: OTHER_MILESTONE },
    ],
  };

  test("the outcome reports ONE milestone and the shipped concurrency", async () => {
    const { runResume } = await resumeMod();
    await withTree(TWO_MILESTONES, async (root) => {
      const outcome = await runResume({
        projectRoot: root,
        milestone: MILESTONE,
        gate: fixedGate("confirm"),
        spawn: recordingSpawn(),
        inline: recordingInline(),
        tracker: recordingTracker(),
      });
      expect(outcome.milestones, "more than one milestone per invocation").toBe(1);
      expect(
        outcome.concurrency,
        "the serial invariant was restated rather than reused",
      ).toBe(MAX_CONCURRENT_WORKERS);
    });
  });

  test("the OTHER milestone on disk is never touched", async () => {
    const { runResume } = await resumeMod();
    await withTree(TWO_MILESTONES, async (root) => {
      const spawn = recordingSpawn();
      const tracker = recordingTracker();
      const outcome = await runResume({
        projectRoot: root,
        milestone: MILESTONE,
        gate: fixedGate("confirm"),
        spawn,
        inline: recordingInline(),
        tracker,
      });
      expect(outcome.milestone).toBe(MILESTONE);
      for (const step of outcome.chain) {
        expect(step.target, "a chain step targets the other milestone").not.toBe(
          OTHER_MILESTONE,
        );
      }
      expect(spawn.spawns.map((s) => s.milestone)).toEqual([MILESTONE]);
      expect(tracker.claims).toEqual([MILESTONE]);
    });
  });

  test("exactly ONE worker is spawned for the whole chain, never one per stage", async () => {
    // The shipped topology: the implement context is exactly what the ship and
    // PR stages need, so the chain lives in one session.
    const { runResume } = await resumeMod();
    for (const spec of [TREE_READY, TREE_PARTLY, TREE_SHIP_READY, TREE_NEEDS_REVIEW]) {
      await withTree(spec, async (root) => {
        const spawn = recordingSpawn();
        await runResume({
          projectRoot: root,
          milestone: MILESTONE,
          gate: fixedGate("confirm"),
          spawn,
          inline: recordingInline(),
          tracker: recordingTracker(),
        });
        expect(spawn.spawns.length, "the chain was split across workers").toBe(1);
      });
    }
  });

  test("the module SOURCES the serial invariant rather than retyping it", async () => {
    await resumeMod();
    const src = read(RESUME_MODULE_FILE);
    expect(src, "the module does not import ./target_repo").toContain(
      'from "./target_repo"',
    );
    expect(src, "MAX_CONCURRENT_WORKERS was not imported").toContain(
      "MAX_CONCURRENT_WORKERS",
    );
    const code = src
      .split("\n")
      .filter((l) => {
        const t = l.trimStart();
        return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
      })
      .join("\n");
    expect(
      /concurrency:\s*1\b/.test(code),
      "the concurrency literal was RETYPED instead of imported",
    ).toBe(false);
  });

  test("the shipped serial clauses survive on the SKILL, verbatim and in order", () => {
    // Resume must not weaken the topology it inherits.
    const body = DELIVER_SKILL();
    const clauses = [
      "run the ceremony **strictly serially**",
      "spawn **one fresh visible worker per milestone**",
      "Never run two milestone workers concurrently",
      "Serial execution is the invariant, not an optimization.",
    ] as const;
    for (const clause of clauses) {
      expect(body, `shipped serial clause lost: ${clause}`).toContain(clause);
    }
    expect(containsInOrder(body, clauses)).toBe(true);
  });

  test("PROSE: the resume section states one milestone per invocation", () => {
    const section = resumeSection();
    expect(
      /one milestone per invocation|a single milestone|one milestone at a time/i.test(
        section,
      ),
      "the section never bounds a resume to one milestone",
    ).toBe(true);
    expect(
      /serial|one .{0,20}worker/i.test(section),
      "the section never ties resume to the serial worker topology",
    ).toBe(true);
  });
});

// ===========================================================================
// The OPERATIVE-SURFACE pins, and the control that makes them non-vacuous.
//
// Third-and-fourth instance in this milestone of the same defect: behaviour
// implemented in code and documented ONLY in `docs/deliver-reference.md`, the
// file `skills/deliver/SKILL.md` marks "not required reading". Every pin above
// and below reads the SKILL, sliced to the resume section.
// ===========================================================================

describe("the resume contract lives on the operative SKILL surface", () => {
  test("a resume section exists on the SKILL and names the module", () => {
    const section = resumeSection();
    expect(section, "no `##` section on the SKILL mentions resuming").not.toBe("");
    expect(
      section,
      "the section never names the module that does the classifying",
    ).toContain("resume_classifier.ts");
  });

  test("the section names every state the classifier can return", async () => {
    const { RESUME_STATES } = await resumeMod();
    const section = resumeSection().toLowerCase();
    for (const state of RESUME_STATES) {
      // Underscored or spaced — the operator reads prose, not identifiers.
      const spaced = state.replace(/_/g, " ");
      expect(
        section.includes(state) || section.includes(spaced),
        `the section never names the ${state} state`,
      ).toBe(true);
    }
  });

  test("the section names the four helpers it assembles rather than re-deriving", () => {
    const section = resumeSection();
    for (const name of Object.keys(REUSED_HELPER_FILES)) {
      expect(section, `the section never names ${name}`).toContain(name);
    }
  });

  test("NON-VACUITY: the slice is a SLICE, not the whole file", () => {
    // The failure this control exists to catch shipped twice in this milestone:
    // a proximity window over the WHOLE file satisfied by pre-existing adjacent
    // text. If the slice were the whole file, every pin above would be a
    // whole-file grep.
    const section = resumeSection();
    const whole = DELIVER_SKILL();
    expect(section.length, "the slice is empty").toBeGreaterThan(0);
    expect(section.length, "the slice IS the whole file").toBeLessThan(whole.length);
    expect(
      whole,
      "the control sentence left the SKILL — pick a new foreign anchor",
    ).toContain(FOREIGN_SENTENCE);
    expect(
      section,
      "the slice swallowed a DIFFERENT section — the pins above are whole-file greps",
    ).not.toContain(FOREIGN_SENTENCE);
  });

  test("NON-VACUITY: the resume section is not merely the argument section", () => {
    // `/deliver`'s shipped argument section already says "milestone identity".
    // A resume section that is really that section renamed would satisfy some
    // pins above for free.
    const section = resumeSection();
    expect(
      section,
      "the slice is the shipped argument section, not a resume section",
    ).not.toContain("classifyDeliverArgument(...)");
  });
});

// ---------------------------------------------------------------------------
// The SCOPED spec-write placement rule must survive on the operative surface.
//
// History, because this pin was re-pointed rather than written fresh: AC.4
// originally said "inline, NEVER in a spawned worker", which collided with
// AC-STE-495.3's cross-repo route. The interim shipped behaviour named the
// collision and told the orchestrator to ask. On 2026-08-17 the operator
// amended AC.4 to scope the placement by target repo, so the clause this pin
// guards changed — but the REASON for pinning it did not: it is still the one
// clause a future editor is most likely to trim as verbose, and trimming it
// would silently return the orchestrator to guessing.
//
// Both branches must be named, or the rule collapses back to one of them.
// ---------------------------------------------------------------------------

describe("the scoped spec-write placement rule is pinned, not just written", () => {
  test("the section names BOTH branches — inline here, worker for a cross-repo target", () => {
    const s = resumeSection().toLowerCase();
    expect(s).toContain("inline in the invoking session");
    expect(s).toContain("target_repo");
    expect(s).toMatch(/target repo's own worker|inside the target repo/);
  });

  test("it keeps the Socratic guarantee on BOTH branches, as a who-answers rule", () => {
    const s = resumeSection().toLowerCase();
    expect(s).toMatch(/who answers/);
    // The four forbidden acts, which are what the guarantee actually is.
    for (const act of ["answers on the operator", "paraphrase", "pre-fill", "batch"]) {
      expect({ act, present: s.includes(act) }).toEqual({ act, present: true });
    }
  });

  test("it states why a visible worker is not a proxy — no relay hop", () => {
    const s = resumeSection().toLowerCase();
    expect(s).toMatch(/no relay hop|inserts no relay/);
    expect(s).toMatch(/visible/);
  });

  test("it names the reduced target's chain, which has no ceremony to resume into", () => {
    const s = resumeSection().toLowerCase();
    expect(s).toContain("reduced");
    expect(s).toMatch(/open a pr|opens a pr/);
  });

  // NON-VACUITY — the needles must be unique to this paragraph pair, or the
  // pins could be satisfied elsewhere and the clause could still be deleted.
  test("NON-VACUITY: each needle occurs exactly once in the whole SKILL", () => {
    const whole = DELIVER_SKILL();
    const sec = resumeSection();
    expect(sec.length).toBeGreaterThan(0);
    expect(whole.length).toBeGreaterThan(sec.length);
    for (const needle of [
      "The spec-writing passes follow the target repo",
      "inserts no relay hop",
    ]) {
      expect({ needle, inSection: sec.includes(needle) }).toEqual({
        needle,
        inSection: true,
      });
      expect({ needle, count: whole.split(needle).length - 1 }).toEqual({
        needle,
        count: 1,
      });
    }
  });
});

// ---------------------------------------------------------------------------
// AC-STE-498.4 (AMENDED 2026-08-17) — resumeChain is ROUTE-AWARE.
//
// The amendment changed shipped behaviour, so it carries its own mutation
// evidence. Before it, resumeChain took no route: /spec-write was always
// inline and the tail was always the full ceremony, which made two chains
// unreachable — a cross-repo milestone could not bind its specs to the target
// tree, and a toolkit-less target got two ceremony stages that cannot exist
// there.
//
// Each branch below must go RED if that branch is dropped.
// ---------------------------------------------------------------------------

describe("AC-STE-498.4 amended — chain placement follows the target repo", () => {
  const classified = (over: Record<string, unknown> = {}) =>
    ({
      milestone: "M129",
      state: "needs_technical_review",
      frsAwaitingReview: ["STE-492", "STE-493"],
      ...over,
    }) as never;

  const chainFor = async (route: string | undefined, over = {}) => {
    const { resumeChain } = await import("../adapters/_shared/src/resume_classifier");
    return route === undefined
      ? resumeChain(classified(over))
      : resumeChain(classified(over), route as never);
  };

  // BRANCH 1 — the shipped default. Omitting the route must behave exactly as
  // an explicit `invoking`, because every plan on disk declares no target_repo.
  test("invoking repo: /spec-write is INLINE, and omitting the route is identical", async () => {
    const explicit = await chainFor("invoking");
    const omitted = await chainFor(undefined);
    expect(omitted).toEqual(explicit);
    const writes = explicit.filter((s) => s.skill === "/spec-write");
    expect(writes.length).toBe(2);
    for (const w of writes) expect({ t: w.target, p: w.placement }).toEqual({ t: w.target, p: "inline" });
  });

  // BRANCH 2 — the amendment's new half.
  test("cross-repo toolkit: /spec-write moves INTO the worker", async () => {
    const chain = await chainFor("cross_repo_toolkit");
    const writes = chain.filter((s) => s.skill === "/spec-write");
    expect(writes.length).toBe(2);
    for (const w of writes) expect({ t: w.target, p: w.placement }).toEqual({ t: w.target, p: "worker" });
    // The ceremony tail is unchanged on this branch — only placement moved.
    expect(chain.map((s) => s.skill)).toContain("/implement");
    expect(chain.map((s) => s.skill)).toContain("/ship-milestone");
  });

  // BRANCH 3 — the second face the same decision fixed.
  test("reduced target: the chain is work + PR, with NO ceremony stages", async () => {
    const chain = await chainFor("reduced");
    const skills = chain.map((s) => s.skill);
    expect(skills).toContain("/work");
    expect(skills).toContain("/pr");
    // The two stages that cannot exist in a tree with no toolkit.
    expect(skills).not.toContain("/implement");
    expect(skills).not.toContain("/ship-milestone");
  });

  // ISOLATION — the three routes must genuinely DIFFER, or any one of the
  // assertions above could pass against a chain that ignores the route.
  test("ISOLATION: the three routes produce three different chains", async () => {
    const shape = (c: readonly { skill: string; placement: string }[]) =>
      c.map((s) => `${s.skill}:${s.placement}`).join(",");
    const inv = shape(await chainFor("invoking"));
    const cross = shape(await chainFor("cross_repo_toolkit"));
    const red = shape(await chainFor("reduced"));
    expect(new Set([inv, cross, red]).size).toBe(3);
  });

  // The amendment must not have disturbed the states that emit no chain.
  test("shipped and parked still emit an empty chain on every route", async () => {
    for (const state of ["shipped", "parked"]) {
      for (const route of ["invoking", "cross_repo_toolkit", "reduced"]) {
        expect({ state, route, len: (await chainFor(route, { state })).length }).toEqual({
          state,
          route,
          len: 0,
        });
      }
    }
  });
});
