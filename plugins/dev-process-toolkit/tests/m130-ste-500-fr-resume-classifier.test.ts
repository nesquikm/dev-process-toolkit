// M130 STE-500 — a resumed FR is classified at FR scope, including whether it
// closes its milestone.
//
// WHAT IS BROKEN, measured on this tree at authoring time (2026-08-24, v2.68.0):
//
//   * `grep -c "scope" adapters/_shared/src/resume_classifier.ts` → 0. The
//     shipped `classifyResume(projectRoot, milestone)` takes a BARE MILESTONE
//     STRING and answers a milestone question. There is no FR-scoped input, no
//     FR-scoped classification type, and no `FR_RESUME_STATES` vocabulary.
//   * `grep -c "lastActive\|FrResume" adapters/_shared/src/resume_classifier.ts`
//     → 0. Nothing anywhere answers "would building this FR leave its milestone
//     with nothing active left" — the predicate STE-501's chain hangs off.
//   * The two helpers this FR is required to ASSEMBLE both ship and were
//     re-verified before this file was written:
//         adapters/_shared/src/active_plan_ship_ready.ts   → milestoneFrBinding
//         adapters/_shared/src/needs_technical_review_consistency.ts
//                → frsAwaitingTechnicalReview + runNeedsTechnicalReviewConsistencyProbe
//     So every RED below is a missing ASSEMBLY, not missing machinery.
//
// TEST STRATEGY, and why no half of it is a tautology.
//
//   * REUSE IS AN AC, NOT A STYLE NOTE (FR Technical Design ¶1–2). The FR-scoped
//     branch must derive its FR facts from the shipped helpers. So every number
//     the classification reports is asserted EQUAL to what the shipped helper
//     returns when THIS TEST calls it directly on the SAME fixture, across
//     fixtures whose numbers DIFFER from one another (0 / 1 / 3 remaining
//     siblings; 0 / 2 / 4 probe violations) so no constant can pass — and the
//     module source is then grepped for a private re-derivation (a second
//     FR-directory walk, a second `needs_technical_review` frontmatter read).
//   * AC.2 IS ASSERTED IN BOTH DIRECTIONS on real on-disk fixtures — the
//     last-active case AND the one-sibling-remaining case — because an
//     off-by-one here silently ships an unfinished milestone or silently
//     strands a finished one (the FR's own Notes say so). A third fixture with
//     three siblings pins `remainingActiveFrIds` BY CONTENT, not by length.
//   * AC.5 IS MUTATION-VERIFIED, NOT GREPPED FIRST. Every FR-scoped path — both
//     happy branches AND both refusal branches — runs against a throwaway tree
//     whose FULL byte-and-listing snapshot is compared before and after. Three
//     falsifiability controls prove the same comparison DETECTS a rewrite, a
//     create and a delete, so "nothing changed" can genuinely fail. The
//     source-token grep for write/exec/tracker channels is the SECOND leg only.
//   * AC.6 IS ASSERTED FIELD BY FIELD against the SHIPPED milestone-scoped
//     output on a fixture in a non-trivial state, and is NOT satisfiable by a
//     classifier that returns the same object for everything: two milestone
//     fixtures in DIFFERENT states are asserted to differ, and on one shared
//     tree the FR-scoped answer is asserted to differ from the milestone-scoped
//     answer.
//   * AC.4's REFUSALS ARE DISTINGUISHED, not merely shaped. Both FR-scoped
//     refusals are asserted in the NFR-10 three-line shape, and the archived
//     one is additionally asserted to name the FR id, the word `archived` and
//     the milestone — with an isolation leg proving the NOT-BOUND refusal does
//     NOT say `archived`, so the archived token is a real discriminator.
//   * FIXTURES ARE REAL TREES. Every leg runs against a `mkdtemp` `specs/` tree
//     of genuine plan + FR files with genuine frontmatter, driven through the
//     REAL shipped helpers. Nothing here stubs a helper and nothing here
//     touches the toolkit repo.
//
// DELIBERATE OMISSIONS.
//   * NO `/gate-check` probe-count pin. This FR registers no probe.
//   * NO skill/agent roster pin and NO SKILL.md line-cap pin. This FR ships no
//     prose surface; STE-502 documents the finished behaviour.
//   * NO assertion that an FR can be `partly_implemented` — the FR explicitly
//     puts that out of scope, and one leg below asserts the opposite: an FR in
//     a milestone the SHIPPED classifier calls `partly_implemented` is still
//     `ready_to_implement` at FR scope.

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

// The shipped helpers the FR-scoped branch must ASSEMBLE. Imported statically
// and called DIRECTLY below: the classification's numbers are asserted equal to
// theirs, which is how reuse is pinned rather than assumed.
import { milestoneFrBinding } from "../adapters/_shared/src/active_plan_ship_ready";
import {
  frsAwaitingTechnicalReview,
  runNeedsTechnicalReviewConsistencyProbe,
} from "../adapters/_shared/src/needs_technical_review_consistency";
import { readPlanTaskState } from "../adapters/_shared/src/plan_task_state";

// ===========================================================================
// Paths.
// ===========================================================================

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");
const SHARED_SRC = join(PLUGIN_ROOT, "adapters", "_shared", "src");

const read = (p: string): string => readFileSync(p, "utf-8");

const RESUME_MODULE = "../adapters/_shared/src/resume_classifier";
const RESUME_MODULE_FILE = join(SHARED_SRC, "resume_classifier.ts");

/** The two helper modules AC.1/.2/.3 require this branch to reuse. */
const REUSED_HELPER_FILES: Readonly<Record<string, string>> = {
  active_plan_ship_ready: join(SHARED_SRC, "active_plan_ship_ready.ts"),
  needs_technical_review_consistency: join(
    SHARED_SRC,
    "needs_technical_review_consistency.ts",
  ),
};

/**
 * The FR under test, resolved with the ARCHIVE FALLBACK. `/implement` Phase 4
 * `git mv`s the FR into `specs/frs/archive/` at milestone close; a meta-test
 * that only knows the active path goes red at the archive commit.
 */
function frPath(): string {
  const active = join(REPO_ROOT, "specs", "frs", "STE-500.md");
  if (existsSync(active)) return active;
  const archived = join(REPO_ROOT, "specs", "frs", "archive", "STE-500.md");
  if (existsSync(archived)) return archived;
  throw new Error("STE-500.md found in neither specs/frs/ nor specs/frs/archive/");
}

// ===========================================================================
// The module under test, imported LAZILY and typed against the INTENDED shape.
//
// `resume_classifier.ts` ships, but its `classifyResume` takes a bare milestone
// string. Declaring the intended overload here keeps the file loadable so the
// reds below are per-AC rather than one collapsed type/load error.
// ===========================================================================

type ResumeState =
  | "needs_technical_review"
  | "ready_to_implement"
  | "partly_implemented"
  | "ship_ready"
  | "shipped"
  | "parked";

/** The FR-scoped vocabulary: exactly two states, and no `partly_implemented`. */
type FrResumeState = "needs_technical_review" | "ready_to_implement";

type PlanStatus = "active" | "archived" | "missing";

interface ResumeClassification {
  readonly milestone: string;
  readonly state: ResumeState;
  readonly planStatus: PlanStatus;
  readonly totalTasks: number;
  readonly uncheckedTasks: number;
  readonly frsAwaitingReview: readonly string[];
  readonly parkedReason: string | null;
  readonly shippedIn: string | null;
  readonly shipCoherenceViolations: readonly string[];
  readonly reviewConsistencyViolations: readonly string[];
}

interface FrResumeClassification {
  readonly scope: "fr";
  readonly fr: string;
  readonly milestone: string;
  readonly state: FrResumeState;
  /** True ⇔ no OTHER active FR is bound to this milestone. */
  readonly lastActiveFr: boolean;
  /** Active FRs bound to the milestone MINUS this FR, sorted. */
  readonly remainingActiveFrIds: readonly string[];
  /** This FR's own `needs_technical_review:` frontmatter flag. */
  readonly needsTechnicalReview: boolean;
  /** NFR-10 messages carried from the shipped consistency probe. */
  readonly reviewConsistencyViolations: readonly string[];
}

interface MilestoneScopeInput {
  readonly scope: "milestone";
  readonly milestone: string;
}

interface FrScopeInput {
  readonly scope: "fr";
  readonly fr: string;
  readonly milestone: string;
}

interface ResumeClassifierModule {
  RESUME_STATES: readonly ResumeState[];
  FR_RESUME_STATES: readonly FrResumeState[];
  classifyResume(projectRoot: string, milestone: string): Promise<ResumeClassification>;
  classifyResume(
    projectRoot: string,
    input: MilestoneScopeInput,
  ): Promise<ResumeClassification>;
  classifyResume(
    projectRoot: string,
    input: FrScopeInput,
  ): Promise<FrResumeClassification>;
  ResumeRefusedError: new (message: string) => Error;
}

async function resumeMod(): Promise<ResumeClassifierModule> {
  return (await import(RESUME_MODULE)) as unknown as ResumeClassifierModule;
}

/** Classify at FR scope — the one call shape every FR-scoped leg uses. */
async function classifyFr(
  root: string,
  fr: string,
  milestone: string,
): Promise<FrResumeClassification> {
  const { classifyResume } = await resumeMod();
  return classifyResume(root, { scope: "fr", fr, milestone });
}

// ===========================================================================
// On-disk fixture trees — real plans, real FRs, real frontmatter.
// ===========================================================================

const MILESTONE = "M600";
const OTHER_MILESTONE = "M601";

interface FrSpec {
  readonly id: string;
  readonly milestone: string;
  readonly needsReview?: boolean;
  /** Deliberately break the flag/placeholder invariant the probe polices. */
  readonly inconsistent?: boolean;
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
  const flagged = spec.needsReview === true;
  // The consistency invariant: flag ⇒ placeholder body; no flag ⇒ real body.
  // `inconsistent` deliberately violates it so the violations leg is real.
  const wantPlaceholder = spec.inconsistent === true ? !flagged : flagged;
  const body = wantPlaceholder ? REVIEW_PLACEHOLDER : "Real content, written.";
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
  const root = mkdtempSync(join(tmpdir(), "ste500-"));
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

// --- The fixtures. Their numbers deliberately DIFFER from one another. ------

/** The FR under work is the ONLY active FR bound — building it closes M600. */
const FR_LAST_ACTIVE = "STE-900";
const TREE_LAST_ACTIVE: TreeSpec = {
  plans: [
    { milestone: MILESTONE, totalTasks: 4, checkedTasks: 1 },
    { milestone: OTHER_MILESTONE, totalTasks: 2 },
  ],
  frs: [
    { id: FR_LAST_ACTIVE, milestone: MILESTONE },
    { id: "STE-901", milestone: MILESTONE, archived: true },
    // Bound to ANOTHER milestone: must not count as a sibling.
    { id: "STE-902", milestone: OTHER_MILESTONE },
  ],
};

/** Exactly ONE sibling still active — the off-by-one's other side. */
const FR_ONE_SIBLING = "STE-910";
const TREE_ONE_SIBLING: TreeSpec = {
  plans: [{ milestone: MILESTONE, totalTasks: 3 }],
  frs: [
    { id: FR_ONE_SIBLING, milestone: MILESTONE },
    { id: "STE-911", milestone: MILESTONE },
    { id: "STE-912", milestone: OTHER_MILESTONE },
  ],
};

/** Three siblings — so the remaining list is pinned by CONTENT, not length. */
const FR_MANY_SIBLINGS = "STE-920";
const TREE_MANY_SIBLINGS: TreeSpec = {
  plans: [{ milestone: MILESTONE, totalTasks: 7, checkedTasks: 2 }],
  frs: [
    { id: FR_MANY_SIBLINGS, milestone: MILESTONE },
    { id: "STE-923", milestone: MILESTONE },
    { id: "STE-921", milestone: MILESTONE },
    { id: "STE-922", milestone: MILESTONE },
    { id: "STE-924", milestone: OTHER_MILESTONE },
    { id: "STE-925", milestone: MILESTONE, archived: true },
  ],
};

/** One flagged FR and one unflagged FR in the SAME milestone. */
const FR_FLAGGED = "STE-930";
const FR_UNFLAGGED = "STE-931";
const TREE_REVIEW_FLAG: TreeSpec = {
  plans: [{ milestone: MILESTONE, totalTasks: 3 }],
  frs: [
    { id: FR_FLAGGED, milestone: MILESTONE, needsReview: true },
    { id: FR_UNFLAGGED, milestone: MILESTONE },
    // Flagged, but bound elsewhere: must not leak into this FR's answer.
    { id: "STE-932", milestone: OTHER_MILESTONE, needsReview: true },
  ],
};

/** The FR really sits under `specs/frs/archive/` — AC.4's first refusal. */
const FR_ARCHIVED = "STE-940";
const TREE_ARCHIVED_FR: TreeSpec = {
  plans: [{ milestone: MILESTONE, totalTasks: 2, checkedTasks: 2 }],
  frs: [
    { id: FR_ARCHIVED, milestone: MILESTONE, archived: true },
    { id: "STE-941", milestone: MILESTONE },
  ],
};

/** The FR exists but binds elsewhere — AC.4's second refusal. */
const FR_ELSEWHERE = "STE-950";
const FR_ABSENT = "STE-999";
const TREE_UNBOUND: TreeSpec = {
  plans: [
    { milestone: MILESTONE, totalTasks: 2 },
    { milestone: OTHER_MILESTONE, totalTasks: 1 },
  ],
  frs: [
    { id: FR_ELSEWHERE, milestone: OTHER_MILESTONE },
    { id: "STE-951", milestone: MILESTONE },
  ],
};

/** Two flagged-but-inconsistent FRs: 4 probe violations, 2 of them this FR's. */
const FR_VIOLATING = "STE-960";
const FR_VIOLATING_SIBLING = "STE-961";
const TREE_VIOLATIONS: TreeSpec = {
  plans: [{ milestone: MILESTONE, totalTasks: 2 }],
  frs: [
    { id: FR_VIOLATING, milestone: MILESTONE, needsReview: true, inconsistent: true },
    {
      id: FR_VIOLATING_SIBLING,
      milestone: MILESTONE,
      needsReview: true,
      inconsistent: true,
    },
  ],
};

/** AC.6's primary tree: a non-trivial milestone state (needs_technical_review). */
const FR_IN_NONTRIVIAL = "STE-971";
const TREE_MILESTONE_NONTRIVIAL: TreeSpec = {
  plans: [{ milestone: MILESTONE, totalTasks: 6, checkedTasks: 2 }],
  frs: [
    { id: "STE-970", milestone: MILESTONE, needsReview: true },
    { id: FR_IN_NONTRIVIAL, milestone: MILESTONE },
    { id: "STE-972", milestone: MILESTONE, archived: true },
    { id: "STE-973", milestone: OTHER_MILESTONE, needsReview: true },
  ],
};

/** AC.6's contrast tree: a DIFFERENT milestone state, with different numbers. */
const FR_IN_PARTLY = "STE-980";
const TREE_MILESTONE_PARTLY: TreeSpec = {
  plans: [{ milestone: MILESTONE, totalTasks: 5, checkedTasks: 3 }],
  frs: [
    { id: FR_IN_PARTLY, milestone: MILESTONE },
    { id: "STE-981", milestone: MILESTONE, archived: true },
  ],
};

// ===========================================================================
// Snapshot machinery — AC.5's real leg.
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
// Refusal helpers.
// ===========================================================================

/** Run an async `fn`, require a rejection, hand the message back. */
async function expectRefusal(
  fn: () => Promise<unknown>,
  label: string,
): Promise<Error> {
  let raised: unknown = null;
  let returned: unknown = undefined;
  try {
    returned = await fn();
  } catch (e) {
    raised = e;
  }
  expect(
    returned,
    `${label}: a classification came back instead of a refusal — the state FELL THROUGH`,
  ).toBeUndefined();
  expect(raised, `${label}: nothing was refused`).not.toBeNull();
  return raised as Error;
}

/** Assert the NFR-10 canonical three-line refusal shape. */
function expectNfr10Shape(msg: string, label: string): void {
  expect(msg, `${label}: no Refusing: line`).toMatch(/^Refusing:/m);
  expect(msg, `${label}: no Remedy: line`).toContain("Remedy:");
  expect(msg, `${label}: no Context: line`).toContain("Context:");
}

/** The module source with comment lines stripped — the grep legs' subject. */
function moduleCode(): string {
  return read(RESUME_MODULE_FILE)
    .split("\n")
    .filter((l) => {
      const t = l.trimStart();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");
}

// ===========================================================================
// TRIPWIRES — the premises every assertion below rides on.
// ===========================================================================

describe("TRIPWIRE — premises this FR's tests rest on", () => {
  test("the FR still names all SIX ACs this file is written against", () => {
    const fr = read(frPath());
    for (let n = 1; n <= 6; n++) {
      expect(fr, `AC-STE-500.${n} missing from the FR`).toContain(`AC-STE-500.${n}:`);
    }
  });

  test("PREMISE: both helpers this FR must ASSEMBLE are on disk and exported", () => {
    for (const [name, file] of Object.entries(REUSED_HELPER_FILES)) {
      expect(existsSync(file), `${name} is missing`).toBe(true);
    }
    expect(typeof milestoneFrBinding).toBe("function");
    expect(typeof frsAwaitingTechnicalReview).toBe("function");
    expect(typeof runNeedsTechnicalReviewConsistencyProbe).toBe("function");
  });

  test("PREMISE: the fixture builder really produces the bindings the legs assume", async () => {
    // If the fixture shape drifted, every reuse assertion below would compare
    // two equally-wrong numbers and pass.
    await withTree(TREE_MANY_SIBLINGS, async (root) => {
      const binding = await milestoneFrBinding(root, MILESTONE);
      expect(binding.activeFrIds).toEqual([
        "STE-920",
        "STE-921",
        "STE-922",
        "STE-923",
      ]);
      expect(binding.archivedFrIds).toEqual(["STE-925"]);
    });
    await withTree(TREE_ARCHIVED_FR, async (root) => {
      const binding = await milestoneFrBinding(root, MILESTONE);
      expect(binding.archivedFrIds).toEqual([FR_ARCHIVED]);
      expect(binding.activeFrIds).toEqual(["STE-941"]);
    });
  });
});

// ===========================================================================
// AC-STE-500.5 — read-only on every FR-scoped path, mutation-verified.
//
// Written FIRST after the tripwires because it is the AC that most easily reads
// green by accident. Its falsifiability controls come before its assertions.
// ===========================================================================

describe("AC-STE-500.5 — FR-scoped classification is read-only, mutation-verified", () => {
  test("CONTROL: the snapshot comparison DETECTS a rewrite, a create, and a delete", async () => {
    // Without this, every "nothing changed" assertion below could be satisfied
    // by a snapshot that compares nothing.
    await withTree(TREE_ONE_SIBLING, async (root) => {
      const before = snapshot(root);

      const planFile = join(root, "specs", "plan", `${MILESTONE}.md`);
      writeFileSync(planFile, `${read(planFile)}\n- [ ] injected task\n`);
      expect(snapshot(root), "a REWRITE went undetected").not.toEqual(before);
      writeFileSync(planFile, before[`file:specs/plan/${MILESTONE}.md`]!);
      expect(snapshot(root), "restoring did not restore").toEqual(before);

      writeFileSync(join(root, "specs", "frs", "STE-998.md"), "x");
      expect(snapshot(root), "a NEW FILE went undetected").not.toEqual(before);
      rmSync(join(root, "specs", "frs", "STE-998.md"));

      rmSync(join(root, "specs", "frs", `${FR_ONE_SIBLING}.md`));
      expect(snapshot(root), "a DELETION went undetected").not.toEqual(before);
    });
  });

  test("both HAPPY FR-scoped branches write nothing", async () => {
    const legs: readonly (readonly [string, TreeSpec, string])[] = [
      ["ready_to_implement / last active", TREE_LAST_ACTIVE, FR_LAST_ACTIVE],
      ["ready_to_implement / siblings remain", TREE_MANY_SIBLINGS, FR_MANY_SIBLINGS],
      ["needs_technical_review", TREE_REVIEW_FLAG, FR_FLAGGED],
      ["violations carried", TREE_VIOLATIONS, FR_VIOLATING],
    ];
    for (const [label, spec, fr] of legs) {
      await assertReadOnly(spec, `classify FR ${label}`, async (root) => {
        await classifyFr(root, fr, MILESTONE);
      });
    }
  });

  test("both REFUSAL FR-scoped branches write nothing either", async () => {
    const legs: readonly (readonly [string, TreeSpec, string])[] = [
      ["archived FR", TREE_ARCHIVED_FR, FR_ARCHIVED],
      ["FR bound elsewhere", TREE_UNBOUND, FR_ELSEWHERE],
      ["FR absent entirely", TREE_UNBOUND, FR_ABSENT],
    ];
    for (const [label, spec, fr] of legs) {
      await assertReadOnly(spec, `refusal ${label}`, async (root) => {
        await expectRefusal(() => classifyFr(root, fr, MILESTONE), label);
      });
    }
  });

  test("SECOND LEG: the module has no write, exec, commit or tracker channel", async () => {
    await resumeMod();
    const src = moduleCode();
    const forbidden: readonly (readonly [string, string])[] = [
      ["a file write", "writeFile"],
      ["a directory create", "mkdir"],
      ["a delete", "rmSync"],
      ["a rename/move", "rename"],
      ["a shell exec", "execSync"],
      ["a process spawn", "spawnSync"],
      ["a Bun shell", "Bun.$"],
      ["a child_process import", "child_process"],
      ["a git commit", "git commit"],
      ["a Linear tracker write", "save_issue"],
      ["a Linear MCP call", "mcp__linear"],
      ["a Jira MCP call", "mcp__atlassian"],
      ["a Jira issue edit", "editJiraIssue"],
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
// AC-STE-500.1 — an FR-scoped input returns a classification for THAT FR alone.
// ===========================================================================

describe("AC-STE-500.1 — FR-scoped input, FR-scoped answer", () => {
  test("the FR-scoped vocabulary is exported and is exactly the two FR states", async () => {
    const mod = await resumeMod();
    expect(
      mod.FR_RESUME_STATES,
      "FR_RESUME_STATES is not exported — there is no FR-scoped vocabulary",
    ).toBeDefined();
    expect([...mod.FR_RESUME_STATES]).toEqual([
      "needs_technical_review",
      "ready_to_implement",
    ]);
  });

  test("an FR-scoped call echoes the scope, the FR and the milestone", async () => {
    await withTree(TREE_ONE_SIBLING, async (root) => {
      const c = await classifyFr(root, FR_ONE_SIBLING, MILESTONE);
      expect(c.scope, "the classification does not declare FR scope").toBe("fr");
      expect(c.fr).toBe(FR_ONE_SIBLING);
      expect(c.milestone).toBe(MILESTONE);
      expect(
        [...(await resumeMod()).FR_RESUME_STATES],
        "the state is outside the FR vocabulary",
      ).toContain(c.state);
    });
  });

  test("two FRs in the SAME tree get DIFFERENT answers — the FR is the subject", async () => {
    // A classifier keyed on the milestone rather than the FR returns the same
    // object for both of these and fails here.
    await withTree(TREE_REVIEW_FLAG, async (root) => {
      const flagged = await classifyFr(root, FR_FLAGGED, MILESTONE);
      const unflagged = await classifyFr(root, FR_UNFLAGGED, MILESTONE);
      expect(flagged.fr).toBe(FR_FLAGGED);
      expect(unflagged.fr).toBe(FR_UNFLAGGED);
      expect(flagged.state).toBe("needs_technical_review");
      expect(unflagged.state).toBe("ready_to_implement");
      expect([...flagged.remainingActiveFrIds]).toEqual([FR_UNFLAGGED]);
      expect([...unflagged.remainingActiveFrIds]).toEqual([FR_FLAGGED]);
    });
  });

  test("`partly_implemented` is NOT reachable at FR scope, even when the milestone is", async () => {
    // The FR's Notes put "this FR is partly implemented" explicitly out of
    // scope. On a tree whose SHIPPED milestone classification is
    // `partly_implemented`, the FR-scoped answer must still be one of the two.
    const { classifyResume } = await resumeMod();
    await withTree(TREE_MILESTONE_PARTLY, async (root) => {
      const milestoneView = await classifyResume(root, MILESTONE);
      expect(
        milestoneView.state,
        "fixture premise: the milestone is not partly_implemented",
      ).toBe("partly_implemented");
      const frView = await classifyFr(root, FR_IN_PARTLY, MILESTONE);
      expect(frView.state).toBe("ready_to_implement");
      expect([...(await resumeMod()).FR_RESUME_STATES]).not.toContain(
        "partly_implemented",
      );
    });
  });
});

// ===========================================================================
// AC-STE-500.2 — is this the LAST active FR bound to its milestone?
//
// Asserted in BOTH directions on real trees, and pinned to the SHIPPED
// enumeration rather than to a private count.
// ===========================================================================

describe("AC-STE-500.2 — the last-active-FR predicate, both directions", () => {
  test("LAST ACTIVE: the only active bound FR reports true and nothing remaining", async () => {
    await withTree(TREE_LAST_ACTIVE, async (root) => {
      const c = await classifyFr(root, FR_LAST_ACTIVE, MILESTONE);
      expect(
        c.lastActiveFr,
        "the only active FR bound to the milestone was not recognised as the last",
      ).toBe(true);
      expect([...c.remainingActiveFrIds]).toEqual([]);
    });
  });

  test("ONE SIBLING REMAINING: reports false and names exactly that sibling", async () => {
    // The other side of the off-by-one. Getting this wrong strands a milestone
    // at an open PR, or releases one whose FRs are not all done.
    await withTree(TREE_ONE_SIBLING, async (root) => {
      const c = await classifyFr(root, FR_ONE_SIBLING, MILESTONE);
      expect(
        c.lastActiveFr,
        "an FR with a sibling still active was called the last one",
      ).toBe(false);
      expect([...c.remainingActiveFrIds]).toEqual(["STE-911"]);
    });
  });

  test("MANY SIBLINGS: the remaining list is pinned by CONTENT and sorted", async () => {
    await withTree(TREE_MANY_SIBLINGS, async (root) => {
      const c = await classifyFr(root, FR_MANY_SIBLINGS, MILESTONE);
      expect(c.lastActiveFr).toBe(false);
      // Content, not length: the fixture declares them out of order, includes a
      // sibling in ANOTHER milestone, and includes an ARCHIVED sibling of this
      // one — none of which may appear.
      expect([...c.remainingActiveFrIds]).toEqual([
        "STE-921",
        "STE-922",
        "STE-923",
      ]);
    });
  });

  test("REUSE: the remaining set EQUALS milestoneFrBinding's, on fixtures whose numbers DIFFER", async () => {
    // The M129 STE-498 idiom: call the shipped helper directly from the test on
    // the SAME fixture and assert the classification's numbers equal it. Three
    // fixtures with 0 / 1 / 3 remaining make a constant unable to pass.
    const legs: readonly (readonly [TreeSpec, string, number])[] = [
      [TREE_LAST_ACTIVE, FR_LAST_ACTIVE, 0],
      [TREE_ONE_SIBLING, FR_ONE_SIBLING, 1],
      [TREE_MANY_SIBLINGS, FR_MANY_SIBLINGS, 3],
    ];
    const seen = new Set<number>();
    for (const [spec, fr, expectedRemaining] of legs) {
      await withTree(spec, async (root) => {
        const binding = await milestoneFrBinding(root, MILESTONE);
        const truth = binding.activeFrIds.filter((id) => id !== fr).sort();
        expect(
          truth.length,
          `fixture premise: ${fr} should have ${expectedRemaining} sibling(s)`,
        ).toBe(expectedRemaining);
        seen.add(truth.length);

        const c = await classifyFr(root, fr, MILESTONE);
        expect(
          [...c.remainingActiveFrIds],
          `${fr}: the remaining set disagrees with milestoneFrBinding`,
        ).toEqual(truth);
        expect(
          c.lastActiveFr,
          `${fr}: lastActiveFr disagrees with the shipped enumeration`,
        ).toBe(truth.length === 0);
      });
    }
    expect(seen.size, "the fixtures did not actually differ").toBe(3);
  });

  test("REUSE: the module keeps no PRIVATE FR-directory walk", async () => {
    // The FR's Technical Design: "a count over that existing enumeration minus
    // the FR under work, not a new scan". A second walk here becomes a second
    // source of truth for the binding.
    await resumeMod();
    const src = moduleCode();
    // NOT pinned: `"archive"`. The shipped module already joins the PLAN
    // archive path for the ship stamp, so that literal is legitimate here —
    // only the FR-side walk is forbidden, and these two needles are what a
    // second FR-directory scan cannot be written without.
    for (const [label, needle] of [
      ["a private FR-directory walk", '"frs"'],
      ["a private directory read", "readdir"],
    ] as const) {
      expect(
        src.includes(needle),
        `${label} (${JSON.stringify(needle)}) lives in the module`,
      ).toBe(false);
    }
  });
});

// ===========================================================================
// AC-STE-500.3 — the FR's own review flag is read and surfaced.
// ===========================================================================

describe("AC-STE-500.3 — the FR's own needs_technical_review flag", () => {
  test("a flagged FR surfaces the flag and routes to the review state", async () => {
    await withTree(TREE_REVIEW_FLAG, async (root) => {
      const c = await classifyFr(root, FR_FLAGGED, MILESTONE);
      expect(c.needsTechnicalReview, "the flag was not surfaced").toBe(true);
      expect(
        c.state,
        "a flagged FR must route to a spec-write pass scoped to that FR",
      ).toBe("needs_technical_review");
    });
  });

  test("ISOLATION: an unflagged FR is false and ready — the flag is not a constant", async () => {
    await withTree(TREE_REVIEW_FLAG, async (root) => {
      const c = await classifyFr(root, FR_UNFLAGGED, MILESTONE);
      expect(c.needsTechnicalReview).toBe(false);
      expect(c.state).toBe("ready_to_implement");
    });
    await withTree(TREE_LAST_ACTIVE, async (root) => {
      const c = await classifyFr(root, FR_LAST_ACTIVE, MILESTONE);
      expect(c.needsTechnicalReview).toBe(false);
      expect(c.state).toBe("ready_to_implement");
    });
  });

  test("REUSE: the flag EQUALS frsAwaitingTechnicalReview's answer for THIS FR", async () => {
    const legs: readonly (readonly [TreeSpec, string])[] = [
      [TREE_REVIEW_FLAG, FR_FLAGGED],
      [TREE_REVIEW_FLAG, FR_UNFLAGGED],
      [TREE_MILESTONE_NONTRIVIAL, FR_IN_NONTRIVIAL],
      [TREE_VIOLATIONS, FR_VIOLATING],
    ];
    const answers = new Set<boolean>();
    for (const [spec, fr] of legs) {
      await withTree(spec, async (root) => {
        const awaiting = await frsAwaitingTechnicalReview(root);
        const truth = awaiting.some((e) => e.id === fr);
        answers.add(truth);
        const c = await classifyFr(root, fr, MILESTONE);
        expect(
          c.needsTechnicalReview,
          `${fr}: the flag disagrees with frsAwaitingTechnicalReview`,
        ).toBe(truth);
      });
    }
    expect(answers.size, "every leg gave the same answer — no discrimination").toBe(2);
  });

  test("SCOPE: a flagged FR in ANOTHER milestone does not leak into this answer", async () => {
    await withTree(TREE_REVIEW_FLAG, async (root) => {
      const awaiting = await frsAwaitingTechnicalReview(root);
      expect(
        awaiting.map((e) => e.id).sort(),
        "fixture premise: two flagged FRs across two milestones",
      ).toEqual([FR_FLAGGED, "STE-932"]);
      const c = await classifyFr(root, FR_UNFLAGGED, MILESTONE);
      expect(c.needsTechnicalReview).toBe(false);
    });
  });

  test("REUSE: the module keeps no PRIVATE read of the review flag or its placeholder", async () => {
    await resumeMod();
    const src = moduleCode();
    for (const [label, needle] of [
      ["a private review-flag frontmatter read", "needs_technical_review:"],
      ["a private review placeholder anchor", "needs technical review —"],
    ] as const) {
      expect(
        src.includes(needle),
        `${label} (${JSON.stringify(needle)}) lives in the module`,
      ).toBe(false);
    }
  });

  test("the consistency probe's violations are CARRIED for this FR, never swallowed", async () => {
    await withTree(TREE_VIOLATIONS, async (root) => {
      const truth = await runNeedsTechnicalReviewConsistencyProbe(root);
      expect(
        truth.violations.length,
        "fixture premise: two inconsistent FRs → four violations",
      ).toBe(4);
      const c = await classifyFr(root, FR_VIOLATING, MILESTONE);
      expect(
        c.reviewConsistencyViolations.length,
        "the FR's own consistency violations were swallowed or widened",
      ).toBe(2);
      for (const message of c.reviewConsistencyViolations) {
        expect(message).toContain(FR_VIOLATING);
        expect(
          message,
          "another FR's violation leaked into this FR-scoped answer",
        ).not.toContain(FR_VIOLATING_SIBLING);
      }
    });
  });

  test("ISOLATION: a consistent tree carries NO violations", async () => {
    // Without this, "violations are carried" would be satisfied by a classifier
    // that reports violations on every tree.
    for (const [spec, fr] of [
      [TREE_ONE_SIBLING, FR_ONE_SIBLING],
      [TREE_REVIEW_FLAG, FR_FLAGGED],
      [TREE_MANY_SIBLINGS, FR_MANY_SIBLINGS],
    ] as const) {
      await withTree(spec, async (root) => {
        const truth = await runNeedsTechnicalReviewConsistencyProbe(root);
        expect(truth.violations.length, "fixture premise: a clean tree").toBe(0);
        const c = await classifyFr(root, fr, MILESTONE);
        expect([...c.reviewConsistencyViolations]).toEqual([]);
      });
    }
  });
});

// ===========================================================================
// AC-STE-500.4 — an archived FR refuses in the NFR-10 shape, naming its state.
// ===========================================================================

describe("AC-STE-500.4 — the FR-scoped refusals", () => {
  test("an ARCHIVED FR refuses, in the NFR-10 three-line shape", async () => {
    await withTree(TREE_ARCHIVED_FR, async (root) => {
      const err = await expectRefusal(
        () => classifyFr(root, FR_ARCHIVED, MILESTONE),
        "archived FR",
      );
      const { ResumeRefusedError } = await resumeMod();
      expect(err.name, "the refusal is not a ResumeRefusedError").toBe(
        "ResumeRefusedError",
      );
      expect(err instanceof ResumeRefusedError).toBe(true);
      expectNfr10Shape(err.message, "archived FR");
    });
  });

  test("the archived refusal NAMES the archived state, the FR and the milestone", async () => {
    await withTree(TREE_ARCHIVED_FR, async (root) => {
      const err = await expectRefusal(
        () => classifyFr(root, FR_ARCHIVED, MILESTONE),
        "archived FR",
      );
      const msg = err.message;
      expect(msg, "the refusal does not name the FR").toContain(FR_ARCHIVED);
      expect(
        msg.toLowerCase(),
        "the refusal does not name the ARCHIVED state — the operator is left guessing",
      ).toContain("archived");
      expect(msg, "the refusal does not name the milestone").toContain(MILESTONE);
    });
  });

  test("an FR bound to NO SUCH milestone refuses too, and does NOT say archived", async () => {
    // The isolation leg for the token above: if every refusal said `archived`,
    // that word would discriminate nothing.
    await withTree(TREE_UNBOUND, async (root) => {
      for (const fr of [FR_ELSEWHERE, FR_ABSENT]) {
        const err = await expectRefusal(
          () => classifyFr(root, fr, MILESTONE),
          `unbound FR ${fr}`,
        );
        expect(err.name).toBe("ResumeRefusedError");
        expectNfr10Shape(err.message, `unbound FR ${fr}`);
        expect(err.message).toContain(fr);
        expect(err.message).toContain(MILESTONE);
        expect(
          err.message.toLowerCase(),
          `${fr}: the not-bound refusal claims the FR is archived`,
        ).not.toContain("archived");
      }
    });
  });

  test("ISOLATION: an ACTIVE bound FR in the same trees does NOT refuse", async () => {
    // Without this, "archived FRs refuse" is satisfied by refusing everything.
    await withTree(TREE_ARCHIVED_FR, async (root) => {
      const c = await classifyFr(root, "STE-941", MILESTONE);
      expect(c.fr).toBe("STE-941");
      expect(c.lastActiveFr).toBe(true);
    });
    await withTree(TREE_UNBOUND, async (root) => {
      const c = await classifyFr(root, "STE-951", MILESTONE);
      expect(c.fr).toBe("STE-951");
    });
  });
});

// ===========================================================================
// AC-STE-500.6 — milestone-scoped classification is unchanged.
// ===========================================================================

describe("AC-STE-500.6 — the milestone-scoped classifier is untouched", () => {
  test("the milestone vocabulary still has its six states, in order", async () => {
    const { RESUME_STATES } = await resumeMod();
    expect([...RESUME_STATES]).toEqual([
      "needs_technical_review",
      "ready_to_implement",
      "partly_implemented",
      "ship_ready",
      "shipped",
      "parked",
    ]);
  });

  test("the SHIPPED positional form still answers field by field on a non-trivial tree", async () => {
    const { classifyResume } = await resumeMod();
    await withTree(TREE_MILESTONE_NONTRIVIAL, async (root) => {
      const taskTruth = await readPlanTaskState(join(root, "specs"), MILESTONE);
      expect(
        [taskTruth.totalTasks, taskTruth.uncheckedTasks, taskTruth.planStatus],
        "fixture premise: 6 tasks, 4 unchecked, active plan",
      ).toEqual([6, 4, "active"]);

      const c = await classifyResume(root, MILESTONE);
      expect(c.milestone).toBe(MILESTONE);
      expect(c.state).toBe("needs_technical_review");
      expect(c.planStatus).toBe("active");
      expect(c.totalTasks).toBe(6);
      expect(c.uncheckedTasks).toBe(4);
      expect([...c.frsAwaitingReview]).toEqual(["STE-970"]);
      expect(c.parkedReason).toBeNull();
      expect(c.shippedIn).toBeNull();
      expect([...c.shipCoherenceViolations]).toEqual([]);
      expect([...c.reviewConsistencyViolations]).toEqual([]);
    });
  });

  test("the object milestone form is BYTE-IDENTICAL to the positional form", async () => {
    const { classifyResume } = await resumeMod();
    for (const spec of [TREE_MILESTONE_NONTRIVIAL, TREE_MILESTONE_PARTLY]) {
      await withTree(spec, async (root) => {
        const positional = await classifyResume(root, MILESTONE);
        const objectForm = await classifyResume(root, {
          scope: "milestone",
          milestone: MILESTONE,
        });
        expect(
          objectForm,
          "the object milestone form diverges from the shipped positional form",
        ).toEqual(positional);
        expect(JSON.stringify(objectForm)).toBe(JSON.stringify(positional));
      });
    }
  });

  test("NOT A CONSTANT: two milestone fixtures in different states give different answers", async () => {
    const { classifyResume } = await resumeMod();
    await withTree(TREE_MILESTONE_PARTLY, async (root) => {
      const c = await classifyResume(root, MILESTONE);
      expect(c.state).toBe("partly_implemented");
      expect(c.totalTasks).toBe(5);
      expect(c.uncheckedTasks).toBe(2);
      expect([...c.frsAwaitingReview]).toEqual([]);
    });
    await withTree(TREE_MILESTONE_NONTRIVIAL, async (root) => {
      const c = await classifyResume(root, MILESTONE);
      expect(c.state).toBe("needs_technical_review");
      expect(c.totalTasks).toBe(6);
    });
  });

  test("the FR-scoped answer is a DIFFERENT shape from the milestone-scoped one", async () => {
    // A classifier that returns the same object for everything cannot pass this
    // alongside the milestone legs above.
    const { classifyResume } = await resumeMod();
    await withTree(TREE_MILESTONE_NONTRIVIAL, async (root) => {
      const milestoneView = await classifyResume(root, MILESTONE);
      const frView = await classifyFr(root, FR_IN_NONTRIVIAL, MILESTONE);
      expect(frView).not.toEqual(milestoneView as unknown as FrResumeClassification);
      expect((milestoneView as unknown as { scope?: string }).scope).toBeUndefined();
      expect(frView.scope).toBe("fr");
      expect(frView.state).toBe("ready_to_implement");
      expect(milestoneView.state).toBe("needs_technical_review");
      expect([...frView.remainingActiveFrIds]).toEqual(["STE-970"]);
    });
  });

  test("classifying at FR scope leaves the milestone-scoped answer unchanged", async () => {
    // Order-independence: the FR branch must not mutate shared state that the
    // milestone branch then reads differently.
    const { classifyResume } = await resumeMod();
    await withTree(TREE_MILESTONE_NONTRIVIAL, async (root) => {
      const before = await classifyResume(root, MILESTONE);
      await classifyFr(root, FR_IN_NONTRIVIAL, MILESTONE);
      await classifyFr(root, "STE-970", MILESTONE);
      const after = await classifyResume(root, MILESTONE);
      expect(after).toEqual(before);
    });
  });
});
