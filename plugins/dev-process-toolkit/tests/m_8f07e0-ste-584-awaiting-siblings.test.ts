// M_8f07e0 STE-584 — a spanning milestone waits for its sibling before it reads
// as ship-ready.
//
// WHAT IS BROKEN, measured on this tree at authoring time (2026-09-10, on the
// M_8f07e0 branch after STE-583 landed `spans_repos.ts`):
//
//   * `adapters/_shared/src/active_plan_ship_ready.ts` is byte-unchanged since
//     v2.81.0 (`git log` on it: last touched by a7c40d4, before bad955f). Its
//     classifier is PRIVATE (`async function classifyActivePlans`), carries
//     only `{ shipReady, parked }`, and never reads `spans_repos:` — so root A
//     archiving its last local FR makes the milestone ship-ready while root B
//     still holds active work.
//   * `resume_classifier.ts` calls `shipReadyMilestones` and so inherits the
//     same premature verdict: the chain routes straight to `/ship-milestone`.
//
// TEST STRATEGY.
//
//   * The resume-chain test comes FIRST (FR ## Testing). Demoting the token out
//     of ship-ready is NOT enough: the classifier would then read the milestone
//     as `partly_implemented` (an archived FR is bound), which orders
//     `/implement` AND still appends the `/ship-milestone` ship tail. So the
//     busy-sibling chain is asserted to carry NEITHER, with the sibling-archived
//     tree as the negative control that still carries `/ship-milestone`.
//   * Every two-root tree is built on the shared span fixture
//     (`tests/_span_fixture.ts`) on REAL `mkdtempSync` roots, torn down in a
//     `finally`. Trees that hold several milestones write the extra plans into
//     the fixture's root A with a local writer of the same shape.
//   * AC.3 and the AC.8 negative control are TRANSITIONS on one tree (busy,
//     then B's FR is archived), so "the nudge resumes" is observed rather than
//     assumed from a second, independently-built tree.
//   * AC.5 pins the undeclared output as a LITERAL captured from the v2.81.0
//     module on this exact fixture — not recomputed, so a drift cannot agree
//     with itself.
//   * AC.11 SPAWNS the CLI (`bun run <module>`); it is never imported.
//
// DELIBERATE OMISSIONS.
//
//   * AC.12's `git diff --numstat` clause is a gate-time check the orchestrator
//     runs against the merge base. Pinned here it would red on main the moment
//     the PR merges (and skipping it would move the skip count), so only the
//     durable properties — split counts and line contents — are pinned.
//   * AC.15 (full `bun test`, zero failures, skip count 15) is a gate command,
//     not something a test file can assert about the run it is part of.

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

import * as shipReadyModule from "../adapters/_shared/src/active_plan_ship_ready";
import {
  runActivePlanShipReadyProbe,
  shipReadyMilestones,
} from "../adapters/_shared/src/active_plan_ship_ready";
import { compareMilestoneTokens, isMilestoneToken } from "../adapters/_shared/src/milestone_token";
import {
  ORDERED_UNREACHABLE_PIN,
  runModuleReachabilityProbe,
} from "../adapters/_shared/src/module_reachability";
import {
  RESUME_STATES,
  classifyResume,
  renderResumePlan,
  resumeChain,
} from "../adapters/_shared/src/resume_classifier";
import { SpansReposError } from "../adapters/_shared/src/spans_repos";
import { type SpanFixture, makeSpanFixture } from "./_span_fixture";

// ===========================================================================
// Paths.
// ===========================================================================

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");
const read = (p: string): string => readFileSync(p, "utf-8");

const SHARED_SRC = join(PLUGIN_ROOT, "adapters", "_shared", "src");
const SHIP_READY_MODULE = join(SHARED_SRC, "active_plan_ship_ready.ts");
const RESUME_MODULE = join(SHARED_SRC, "resume_classifier.ts");
const skillPath = (name: string): string => join(PLUGIN_ROOT, "skills", name, "SKILL.md");
const DOGFOOD_TEST = join(PLUGIN_ROOT, "tests", "gate-check-active-plan-ship-ready.test.ts");

// ===========================================================================
// Fixtures.
// ===========================================================================

const MILESTONE = "M_GF_78";
const A_NAME = "glacy-app-fe";
const B_NAME = "glacy-app-be";
const A_FR = "STE-900"; // root A's own work on the milestone — archived
const B_FR = "STE-901"; // root B's work on the milestone — active until archived

/** The two-entry map every spanning fixture declares: `.` and B's path. */
const spansToB = (fx: SpanFixture): Record<string, string> => ({
  [A_NAME]: ".",
  [B_NAME]: relative(fx.a, fx.b),
});

/**
 * AC.1 tree: A declares the span, holds zero active FRs and one archived FR
 * bound; B holds one ACTIVE FR bound.
 */
function buildBusy(fx: SpanFixture): void {
  fx.planA(spansToB(fx));
  fx.archivedFr(fx.a, A_FR, MILESTONE);
  fx.activeFr(fx.b, B_FR, MILESTONE);
}

/** The AC.3 transition: B's FR moves from `specs/frs/` to `specs/frs/archive/`. */
function archiveSiblingFr(fx: SpanFixture): void {
  rmSync(join(fx.b, "specs", "frs", `${B_FR}.md`), { force: true });
  fx.archivedFr(fx.b, B_FR, MILESTONE);
}

/**
 * A plan in `root` for a token OTHER than the fixture's milestone — same shape
 * `_span_fixture.ts` writes (tracker-mode, `shipped_in: null`, nested 2-space
 * `spans_repos:` map, empty record omits the key), so several milestones can
 * share one tree.
 */
function writePlan(
  root: string,
  token: string,
  spans: Record<string, string>,
  extra: Record<string, string> = {},
): void {
  const lines = ["---", `milestone: ${token}`, "status: active", "archived_at: null"];
  if (extra.shipped_in === undefined) lines.push("shipped_in: null");
  const entries = Object.entries(spans);
  if (entries.length > 0) {
    lines.push("spans_repos:");
    for (const [name, path] of entries) lines.push(`  ${name}: ${path}`);
  }
  for (const [key, value] of Object.entries(extra)) lines.push(`${key}: ${value}`);
  lines.push("---", "", `# ${token}`, "");
  writeFileSync(join(root, "specs", "plan", `${token}.md`), lines.join("\n"));
}

/**
 * A bucket entry's milestone token, whatever the entry's shape. A string entry
 * is either a bare token (`M7`) or a rendered one (`M7 (glacy-app-be: 1 active
 * FRs)`); the token is the leading space-free segment in both cases.
 */
function tokenOf(entry: unknown): string {
  if (typeof entry === "string") return entry.split(" ", 1)[0] as string;
  if (entry !== null && typeof entry === "object") {
    const hit = Object.values(entry as Record<string, unknown>).find(
      (v) => typeof v === "string" && isMilestoneToken(v),
    );
    if (typeof hit === "string") return hit;
  }
  throw new Error(`bucket entry carries no milestone token: ${JSON.stringify(entry)}`);
}

const skills = (chain: readonly { skill: string }[]): string[] => chain.map((s) => s.skill);

// `classifyActivePlans` is not exported at authoring time; reaching it through
// the namespace makes its absence a named assertion failure instead of an
// import-time crash that would red every test in this file at once.
type ActivePlanClassification = {
  shipReady: string[];
  parked: string[];
  awaitingSiblings: unknown[];
  unlocatableSiblings: unknown[];
};
function classifyActivePlans(root: string): Promise<ActivePlanClassification> {
  const fn = (shipReadyModule as Record<string, unknown>).classifyActivePlans;
  expect(typeof fn).toBe("function");
  return (fn as (r: string) => Promise<ActivePlanClassification>)(root);
}

const AWAITING_ROW_RE = /^awaiting-sibling milestones: M_GF_78 \(glacy-app-be: 1 active FRs?\)$/;
const UNLOCATABLE_ROW_RE = /^sibling-unlocatable milestones: M_GF_78 /;

// ===========================================================================
// AC-STE-584.8 — FIRST: the resume chain holds back BOTH /implement and the
// ship tail. Demotion alone reads `partly_implemented`, which orders both.
// ===========================================================================

describe("AC-STE-584.8 — the resume chain holds both /implement and /ship-milestone back while a sibling is busy", () => {
  test("busy sibling: awaitingSiblings non-empty; chain has no /implement and no /ship-milestone; render names glacy-app-be", async () => {
    const fx = makeSpanFixture(MILESTONE);
    try {
      buildBusy(fx);
      const c = await classifyResume(fx.a, MILESTONE);
      const awaiting = (c as unknown as { awaitingSiblings?: readonly unknown[] })
        .awaitingSiblings;
      expect(Array.isArray(awaiting)).toBe(true);
      expect(awaiting!.length).toBeGreaterThan(0);

      const chain = skills(resumeChain(c));
      expect(chain).not.toContain("/implement");
      expect(chain).not.toContain("/ship-milestone");

      expect(renderResumePlan(c).rendered).toContain(B_NAME);
    } finally {
      fx.cleanup();
    }
  });

  test("Technical Design — the waiting milestone's chain is EMPTY (no step ordered while it waits)", async () => {
    const fx = makeSpanFixture(MILESTONE);
    try {
      buildBusy(fx);
      const c = await classifyResume(fx.a, MILESTONE);
      expect(resumeChain(c)).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("negative control: once B's FR is archived the same tree's chain carries /ship-milestone", async () => {
    const fx = makeSpanFixture(MILESTONE);
    try {
      buildBusy(fx);
      archiveSiblingFr(fx);
      const c = await classifyResume(fx.a, MILESTONE);
      expect(skills(resumeChain(c))).toContain("/ship-milestone");
      expect((c as unknown as { awaitingSiblings?: readonly unknown[] }).awaitingSiblings).toEqual(
        [],
      );
    } finally {
      fx.cleanup();
    }
  });
});

// ===========================================================================
// AC-STE-584.1 / .2 / .3 — the nudge stops, is visible, and resumes.
// ===========================================================================

describe("AC-STE-584.1 — the nudge stops while the sibling holds active work", () => {
  test("shipReadyMilestones(A) returns [] on the busy-sibling tree", async () => {
    const fx = makeSpanFixture(MILESTONE);
    try {
      buildBusy(fx);
      await expect(shipReadyMilestones(fx.a)).resolves.toEqual([]);
    } finally {
      fx.cleanup();
    }
  });
});

describe("AC-STE-584.2 — the nudge is visible, not silent", () => {
  test("exactly one awaiting-sibling NOTES row naming glacy-app-be with its active count; violations []", async () => {
    const fx = makeSpanFixture(MILESTONE);
    try {
      buildBusy(fx);
      const report = await runActivePlanShipReadyProbe(fx.a);
      expect(report.violations).toEqual([]);
      expect(report.notes.filter((n) => AWAITING_ROW_RE.test(n))).toHaveLength(1);
      expect(report.notes.some((n) => n.startsWith("ship-ready milestones:"))).toBe(false);
    } finally {
      fx.cleanup();
    }
  });
});

describe("AC-STE-584.3 — the nudge resumes after B's FR is archived", () => {
  test("same tree: [] while busy, then [M_GF_78] with the ship-ready row and no awaiting-sibling row", async () => {
    const fx = makeSpanFixture(MILESTONE);
    try {
      buildBusy(fx);
      await expect(shipReadyMilestones(fx.a)).resolves.toEqual([]);

      archiveSiblingFr(fx);
      await expect(shipReadyMilestones(fx.a)).resolves.toEqual([MILESTONE]);
      const report = await runActivePlanShipReadyProbe(fx.a);
      expect(report.violations).toEqual([]);
      expect(report.notes.some((n) => n.startsWith("ship-ready milestones:"))).toBe(true);
      expect(report.notes.some((n) => n.startsWith("awaiting-sibling"))).toBe(false);
    } finally {
      fx.cleanup();
    }
  });
});

// ===========================================================================
// AC-STE-584.4 — unlocatable degrades with the verdict intact.
// ===========================================================================

describe("AC-STE-584.4 — an unlocatable sibling keeps the verdict and adds a note", () => {
  test("B's entry points at a missing path: still [M_GF_78], plus a sibling-unlocatable row naming the entry", async () => {
    const fx = makeSpanFixture(MILESTONE);
    try {
      const missing = relative(fx.a, join(fx.b, "no-such-repo"));
      fx.planA({ [A_NAME]: ".", [B_NAME]: missing });
      fx.archivedFr(fx.a, A_FR, MILESTONE);
      fx.activeFr(fx.b, B_FR, MILESTONE); // present in B, but B is never located

      await expect(shipReadyMilestones(fx.a)).resolves.toEqual([MILESTONE]);
      const report = await runActivePlanShipReadyProbe(fx.a);
      expect(report.violations).toEqual([]);
      expect(report.notes.some((n) => n.startsWith("ship-ready milestones:"))).toBe(true);
      const rows = report.notes.filter((n) => UNLOCATABLE_ROW_RE.test(n));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toContain(`${B_NAME} at ${missing}`);
    } finally {
      fx.cleanup();
    }
  });
});

// ===========================================================================
// AC-STE-584.5 — undeclared is byte-identical to v2.81.0.
// ===========================================================================

// Captured 2026-09-10 by running the v2.81.0 module (unchanged since a7c40d4)
// on exactly the fixture below. A LITERAL on purpose — never recompute it.
const V2_81_0_UNDECLARED_REPORT = {
  violations: [],
  notes: [
    "ship-ready milestones: M6 — run /spec-archive M<N> then /ship-milestone M<N>",
    "parked milestones: M3",
  ],
};

describe("AC-STE-584.5 — plans without spans_repos produce the v2.81.0 output byte-for-byte", () => {
  test("parked + stamped + zero-FR + ship-ready, none declaring spans_repos → the committed literal", async () => {
    const fx = makeSpanFixture("M6");
    try {
      fx.planA({}); // M6 — ship-ready, undeclared (empty record omits the key)
      fx.archivedFr(fx.a, "FR-6", "M6");
      writePlan(fx.a, "M3", {}, { ship_state: "parked" });
      fx.archivedFr(fx.a, "FR-3", "M3");
      writePlan(fx.a, "M4", {}, { shipped_in: "v1.2.3" });
      fx.archivedFr(fx.a, "FR-4", "M4");
      writePlan(fx.a, "M5", {}); // zero bound FRs

      expect(await runActivePlanShipReadyProbe(fx.a)).toEqual(V2_81_0_UNDECLARED_REPORT);
    } finally {
      fx.cleanup();
    }
  });
});

// ===========================================================================
// AC-STE-584.6 — parked still wins over a busy sibling.
// ===========================================================================

describe("AC-STE-584.6 — parked still wins", () => {
  test("parked + busy sibling: in the parked row, in neither the ship-ready nor the awaiting-sibling row/bucket", async () => {
    const fx = makeSpanFixture(MILESTONE);
    try {
      fx.planA(spansToB(fx), { ship_state: "parked" });
      fx.archivedFr(fx.a, A_FR, MILESTONE);
      fx.activeFr(fx.b, B_FR, MILESTONE);

      const report = await runActivePlanShipReadyProbe(fx.a);
      expect(report.violations).toEqual([]);
      expect(report.notes).toContain(`parked milestones: ${MILESTONE}`);
      expect(report.notes.some((n) => n.startsWith("ship-ready milestones:"))).toBe(false);
      expect(report.notes.some((n) => n.startsWith("awaiting-sibling"))).toBe(false);

      const c = await classifyActivePlans(fx.a);
      expect(c.parked).toEqual([MILESTONE]);
      expect(c.shipReady).toEqual([]);
      expect(c.awaitingSiblings.map(tokenOf)).not.toContain(MILESTONE);
    } finally {
      fx.cleanup();
    }
  });
});

// ===========================================================================
// AC-STE-584.7 — stamped and parked plans never read the declaration.
// ===========================================================================

describe("AC-STE-584.7 — the declaration is read only for an otherwise ship-ready plan", () => {
  test("stamped and parked plans carrying the malformed `spans_repos: [a, b]` classify without a throw", async () => {
    const fx = makeSpanFixture(MILESTONE);
    try {
      writePlan(fx.a, MILESTONE, {}, { shipped_in: "v1.2.3", spans_repos: "[a, b]" });
      fx.archivedFr(fx.a, A_FR, MILESTONE);
      writePlan(fx.a, "M_GF_79", {}, { ship_state: "parked", spans_repos: "[a, b]" });
      fx.archivedFr(fx.a, "STE-902", "M_GF_79");

      const c = await classifyActivePlans(fx.a);
      expect(c.shipReady).toEqual([]);
      expect(c.parked).toEqual(["M_GF_79"]);
      await expect(shipReadyMilestones(fx.a)).resolves.toEqual([]);
      await expect(runActivePlanShipReadyProbe(fx.a)).resolves.toEqual({
        violations: [],
        notes: ["parked milestones: M_GF_79"],
      });
    } finally {
      fx.cleanup();
    }
  });

  test("the same malformed value on an otherwise ship-ready plan makes shipReadyMilestones reject with SpansReposError", async () => {
    const fx = makeSpanFixture(MILESTONE);
    try {
      fx.planA({}, { spans_repos: "[a, b]" });
      fx.archivedFr(fx.a, A_FR, MILESTONE);
      await expect(shipReadyMilestones(fx.a)).rejects.toBeInstanceOf(SpansReposError);
    } finally {
      fx.cleanup();
    }
  });

  test("Technical Design — the refusal propagates through the probe and the resume classifier too", async () => {
    const fx = makeSpanFixture(MILESTONE);
    try {
      fx.planA({}, { spans_repos: "[a, b]" });
      fx.archivedFr(fx.a, A_FR, MILESTONE);
      await expect(runActivePlanShipReadyProbe(fx.a)).rejects.toBeInstanceOf(SpansReposError);
      await expect(classifyResume(fx.a, MILESTONE)).rejects.toBeInstanceOf(SpansReposError);
    } finally {
      fx.cleanup();
    }
  });
});

// ===========================================================================
// AC-STE-584.9 — one read.
// ===========================================================================

describe("AC-STE-584.9 — the resume classifier reads the one classification", () => {
  test("resume_classifier.ts imports classifyActivePlans from active_plan_ship_ready", () => {
    expect(read(RESUME_MODULE)).toMatch(
      /import\s*\{[^}]*\bclassifyActivePlans\b[^}]*\}\s*from\s*["']\.\/active_plan_ship_ready["']/,
    );
  });

  test("resume_classifier.ts no longer calls shipReadyMilestones", () => {
    expect(read(RESUME_MODULE)).not.toMatch(/\bshipReadyMilestones\s*\(/);
  });

  test("RESUME_STATES still has exactly the six members (ResumeState is not widened)", () => {
    expect(RESUME_STATES).toHaveLength(6);
    expect([...RESUME_STATES]).toEqual([
      "needs_technical_review",
      "ready_to_implement",
      "partly_implemented",
      "ship_ready",
      "shipped",
      "parked",
    ]);
  });
});

// ===========================================================================
// AC-STE-584.10 — the export exists, four buckets, each sorted.
// ===========================================================================

describe("AC-STE-584.10 — classifyActivePlans is exported with four compareMilestoneTokens-sorted buckets", () => {
  test("classifyActivePlans is an exported function", () => {
    expect(typeof (shipReadyModule as Record<string, unknown>).classifyActivePlans).toBe(
      "function",
    );
  });

  test("every bucket holds exactly its milestones in compareMilestoneTokens order; shipReadyMilestones === .shipReady", async () => {
    const fx = makeSpanFixture(MILESTONE);
    try {
      const toB = relative(fx.a, fx.b);
      const missing = relative(fx.a, join(fx.b, "no-such-repo"));
      const archiveInA = (token: string): void => fx.archivedFr(fx.a, `FR-${token}`, token);

      // Awaiting a busy sibling: M7, M11, M_GF_78.
      fx.planA({ [A_NAME]: ".", [B_NAME]: toB });
      archiveInA(MILESTONE);
      fx.activeFr(fx.b, `B-${MILESTONE}`, MILESTONE);
      for (const token of ["M7", "M11"]) {
        writePlan(fx.a, token, { [A_NAME]: ".", [B_NAME]: toB });
        archiveInA(token);
        fx.activeFr(fx.b, `B-${token}`, token);
      }
      // Sibling unlocatable — verdict intact: M6, M12.
      for (const token of ["M6", "M12"]) {
        writePlan(fx.a, token, { [A_NAME]: ".", [B_NAME]: missing });
        archiveInA(token);
      }
      // Plain ship-ready, undeclared: M9, M10.
      for (const token of ["M9", "M10"]) {
        writePlan(fx.a, token, {});
        archiveInA(token);
      }
      // Parked: M5, M13.
      for (const token of ["M5", "M13"]) {
        writePlan(fx.a, token, {}, { ship_state: "parked" });
        archiveInA(token);
      }

      const expected = {
        shipReady: ["M6", "M9", "M10", "M12"],
        parked: ["M5", "M13"],
        awaitingSiblings: ["M7", "M11", MILESTONE],
        unlocatableSiblings: ["M6", "M12"],
      };
      // Each expected list is compareMilestoneTokens order and NOT lexicographic
      // order, so a bucket left in readdir order cannot pass.
      for (const list of Object.values(expected)) {
        expect([...list].sort(compareMilestoneTokens)).toEqual(list);
        expect([...list].sort()).not.toEqual(list);
      }

      const c = await classifyActivePlans(fx.a);
      expect(c.shipReady).toEqual(expected.shipReady);
      expect(c.parked).toEqual(expected.parked);
      expect(c.awaitingSiblings.map(tokenOf)).toEqual(expected.awaitingSiblings);
      expect(c.unlocatableSiblings.map(tokenOf)).toEqual(expected.unlocatableSiblings);

      await expect(shipReadyMilestones(fx.a)).resolves.toEqual(c.shipReady);
    } finally {
      fx.cleanup();
    }
  });
});

// ===========================================================================
// AC-STE-584.11 — the CLI stream keeps its shape.
// ===========================================================================

describe("AC-STE-584.11 — the ship-ready CLI stream is unchanged in shape", () => {
  const runCli = (root: string) =>
    spawnSync("bun", ["run", SHIP_READY_MODULE, root], { encoding: "utf-8" });

  test("busy sibling: exit 0 with EMPTY stdout (the offer goes quiet)", () => {
    const fx = makeSpanFixture(MILESTONE);
    try {
      buildBusy(fx);
      const proc = runCli(fx.a);
      expect(proc.status).toBe(0);
      expect(proc.stdout).toBe("");
    } finally {
      fx.cleanup();
    }
  });

  test("sibling archived: exit 0 printing exactly `M_GF_78\\n`", () => {
    const fx = makeSpanFixture(MILESTONE);
    try {
      buildBusy(fx);
      archiveSiblingFr(fx);
      const proc = runCli(fx.a);
      expect(proc.status).toBe(0);
      expect(proc.stdout).toBe(`${MILESTONE}\n`);
    } finally {
      fx.cleanup();
    }
  });
});

// ===========================================================================
// AC-STE-584.12 — prose lands in the executing copies with zero new lines.
// (The `git diff --numstat` clause is gate-time — see the header.)
// ===========================================================================

const splitCount = (p: string): number => read(p).split("\n").length;

describe("AC-STE-584.12 — prose lands in the executing copies with zero new lines", () => {
  test("implement SKILL.md still splits to 358 and its close-offer line names spans_repos", () => {
    const file = skillPath("implement");
    expect(splitCount(file)).toBe(358);
    const offerLines = read(file)
      .split("\n")
      .filter((l) => l.includes("adapters/_shared/src/active_plan_ship_ready.ts"));
    expect(offerLines).toHaveLength(1);
    expect(offerLines[0]).toContain("spans_repos");
  });

  test("gate-check SKILL.md still splits to 356 and probe 75's row names spans_repos.ts, awaiting-sibling, sibling-unlocatable", () => {
    const file = skillPath("gate-check");
    expect(splitCount(file)).toBe(356);
    const row = read(file)
      .split("\n")
      .find((l) => /^75\. \*\*/.test(l));
    expect(row).toBeDefined();
    expect(row).toContain("spans_repos.ts");
    expect(row).toContain("awaiting-sibling");
    expect(row).toContain("sibling-unlocatable");
  });

  test("deliver SKILL.md keeps its 262-line split and its helper-assembly line says a milestone awaiting a sibling gets no step", () => {
    const file = skillPath("deliver");
    expect(splitCount(file)).toBe(262); // measured at authoring time
    const body = read(file);
    const start = body.indexOf("\n## Resume");
    expect(start).toBeGreaterThan(-1);
    const end = body.indexOf("\n## ", start + 1);
    const section = body.slice(start, end < 0 ? undefined : end);
    const helperLines = section.split("\n").filter((l) => l.includes("active_plan_ship_ready"));
    expect(helperLines).toHaveLength(1);
    expect(helperLines[0]).toMatch(/\bsibling\b/);
    expect(helperLines[0]).toMatch(/\bno step\b/);
  });
});

// ===========================================================================
// AC-STE-584.13 — the dogfood idiom is widened (by the implementer, not here).
// ===========================================================================

describe("AC-STE-584.13 — the dogfood note regex admits the two new rows; the live tree stays quiet", () => {
  /** The regex literal the dogfood block applies to every live note. */
  function dogfoodNoteRegex(): RegExp {
    const src = read(DOGFOOD_TEST);
    const blockIdx = src.indexOf('describe("dogfood');
    expect(blockIdx).toBeGreaterThan(-1);
    const m = /expect\(note\)\.toMatch\(\/(.+)\/([a-z]*)\)/.exec(src.slice(blockIdx));
    expect(m).not.toBeNull();
    return new RegExp(m![1]!, m![2]);
  }

  test("admits awaiting-sibling and sibling-unlocatable rows, still admits the shipped two, still rejects an unknown row", () => {
    const re = dogfoodNoteRegex();
    expect(re.test(`awaiting-sibling milestones: ${MILESTONE} (${B_NAME}: 1 active FR)`)).toBe(true);
    expect(re.test(`sibling-unlocatable milestones: ${MILESTONE} (${B_NAME} at ../gone)`)).toBe(
      true,
    );
    expect(re.test("ship-ready milestones: M7")).toBe(true);
    expect(re.test("parked milestones: M8")).toBe(true);
    expect(re.test("bogus milestones: M9")).toBe(false);
  });

  test("the live tree returns { violations: [], notes: [] }", async () => {
    expect(await runActivePlanShipReadyProbe(REPO_ROOT)).toEqual({ violations: [], notes: [] });
  });
});

// ===========================================================================
// AC-STE-584.14 — counts hold.
// ===========================================================================

describe("AC-STE-584.14 — probe count and the unreachable pin hold", () => {
  test("gate-check lists 85 numbered probes, contiguous 1..85", () => {
    const numbers = [...read(skillPath("gate-check")).matchAll(/^(\d+)\. \*\*/gm)].map((m) =>
      Number(m[1]),
    );
    expect(numbers).toHaveLength(85);
    expect([...numbers].sort((a, b) => a - b)).toEqual(Array.from({ length: 85 }, (_, i) => i + 1));
  });

  test("module reachability reports orderedUnreachable === the shipped ORDERED_UNREACHABLE_PIN with ok: true", async () => {
    const report = await runModuleReachabilityProbe(REPO_ROOT);
    expect(report.orderedUnreachable).toBe(ORDERED_UNREACHABLE_PIN);
    expect(report.ok).toBe(true);
  });
});

// ===========================================================================
// Stage C hardening (post-audit) — the ship-ready CLI is the command the
// /implement close offer runs. A malformed spans_repos on an otherwise
// ship-ready plan must reach it as a clean NFR-10 refusal on stderr with an
// EMPTY stdout (so the offer's "empty stdout = none" reading stays safe), never
// as an uncaught stack trace.
// ===========================================================================

describe("Stage C hardening — the ship-ready CLI refuses a malformed declaration cleanly", () => {
  const CLI = join(import.meta.dir, "..", "adapters", "_shared", "src", "active_plan_ship_ready.ts");

  test("malformed spans_repos on an otherwise ship-ready plan: non-zero, empty stdout, three-line stderr", () => {
    const fx = makeSpanFixture(MILESTONE);
    try {
      fx.archivedFr(fx.a, "FR-A1", MILESTONE);
      writeFileSync(
        join(fx.a, "specs", "plan", `${MILESTONE}.md`),
        `---\nmilestone: ${MILESTONE}\nstatus: active\narchived_at: null\nshipped_in: null\nspans_repos: [a, b]\n---\n\n# ${MILESTONE}\n`,
      );
      const run = spawnSync("bun", ["run", CLI, fx.a], { encoding: "utf-8" });
      expect(run.status).not.toBe(0);
      expect(run.stdout).toBe("");
      expect(run.stderr).toMatch(/^Refusing:/m);
      expect(run.stderr).toMatch(/^Remedy:/m);
      expect(run.stderr).toMatch(/^Context:/m);
      expect(run.stderr).not.toMatch(/^\s+at /m);
    } finally {
      fx.cleanup();
    }
  });
});
