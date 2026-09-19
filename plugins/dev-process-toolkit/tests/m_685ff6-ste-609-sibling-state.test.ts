// STE-609 (M_685ff6) — the sibling release gate refuses whenever it cannot
// prove the sibling is idle.
//
// AC-STE-609.4 — the sibling is read from git: every worktree's working tree,
//   every local branch and every remote-tracking ref, without fetching. An FR is
//   active when some source holds it under `specs/frs/` bound to the milestone
//   and no source holds it under `specs/frs/archive/`. The refusal names each
//   active id with its source. A failing git read is `unreadable`, never `idle`.
// AC-STE-609.5 — only `idle` passes refusal #4 without `--partial`; each non-idle
//   state refuses (exit 1, NFR-10 house shape naming milestone, sibling, state
//   and a state-specific remedy naming `--partial`, empty stdout); with
//   `--partial` every state passes and the footer is measured as today.
// AC-STE-609.6 — one classification, every surface: probe #75, the close-offer
//   CLI and both resume scopes hold every non-idle spanning milestone.
//
// One real two-root tree per state, from `tests/_sibling_state_fixture.ts`.
// Every tree is torn down in a `finally`; every subprocess is spawned
// synchronously (one child at a time) under GIT_ENV.

import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative } from "node:path";

import {
  runActivePlanShipReadyProbe,
  spanningSiblingState,
} from "../adapters/_shared/src/active_plan_ship_ready";
import { classifyResume, resumeChain } from "../adapters/_shared/src/resume_classifier";
import { siblingShipGate } from "../adapters/_shared/src/sibling_release";
import { commitAll, git, makeSpanFixture } from "./_span_fixture";
import {
  A_FR,
  B_FR_ACTIVE,
  B_FR_DONE,
  B_NAME,
  MILESTONE,
  NON_IDLE_STATES,
  type Run,
  type SiblingStateName,
  type StateTree,
  UNREADABLE_READER_TEXT,
  closeOfferDoor,
  describeRun,
  lines,
  makeIdle,
  shipGateDoor,
  spansFromA,
  withState,
  writeFr,
  writePlan,
} from "./_sibling_state_fixture";

// ===========================================================================
// Helpers.
// ===========================================================================

const read = (p: string): string => readFileSync(p, "utf-8");

const gate = (t: { a: string; planFile: string }, partial = false) =>
  siblingShipGate({ projectRoot: t.a, planBody: read(t.planFile), milestone: MILESTONE, partial });

/** The ship-milestone house refusal: three lines, returned for inspection. */
function houseLines(refusal: string | null, context: string): [string, string, string] {
  expect(refusal, `expected a refusal; the gate passed (${context})`).not.toBeNull();
  const ls = refusal!.replace(/\n+$/, "").split("\n");
  expect(ls.length, refusal!).toBe(3);
  expect(ls[0]!).toMatch(/^\/ship-milestone: /);
  expect(ls[1]!).toMatch(/^Remedy: /);
  expect(ls[2]!).toMatch(/^Context: .*skill=ship-milestone$/);
  return ls as [string, string, string];
}

/** A word-bounded match for a state name (hyphens included). */
const stateWord = (state: string): RegExp =>
  new RegExp(`(^|[^a-z-])${state.replace(/-/g, "\\-")}([^a-z-]|$)`);

const skills = (chain: readonly { skill: string }[]): string[] => chain.map((s) => s.skill);

/** One branch-built idle sibling: B's plan and a finished FR, committed on main. */
function buildGitSibling(): {
  fx: ReturnType<typeof makeSpanFixture>;
  planFile: string;
  extra: string[];
  cleanup: () => void;
} {
  const fx = makeSpanFixture(MILESTONE);
  const extra: string[] = [];
  makeIdle(fx);
  const planFile = writePlan(fx.a, "live", MILESTONE, spansFromA(relative(fx.a, fx.b)));
  fx.archivedFr(fx.a, A_FR, MILESTONE);
  return {
    fx,
    planFile,
    extra,
    cleanup: () => {
      try {
        fx.cleanup();
      } finally {
        for (const d of extra) rmSync(d, { recursive: true, force: true });
      }
    },
  };
}

/** On a new branch `branch` of B: add an ACTIVE FR `id`, commit, and return to main. */
function activeOnBranch(b: string, branch: string, id: string): void {
  git(b, "checkout", "-q", "-b", branch);
  writeFr(b, id, MILESTONE, "active");
  commitAll(b, `fixture: ${id} active on ${branch}`);
  git(b, "checkout", "-q", "main");
}

// ===========================================================================
// AC-STE-609.4 — the sibling is read from git, not from one working tree
// ===========================================================================

describe("AC-STE-609.4 — every worktree, local branch and remote-tracking ref of the sibling is read", () => {
  test("active only on an unmerged branch that is not checked out ⇒ busy, and the refusal names the id and the branch (red on HEAD)", async () => {
    const t = buildGitSibling();
    try {
      activeOnBranch(t.fx.b, "feature-609", "STE-96100");
      // Premise: the working tree does not hold it.
      expect(() => read(join(t.fx.b, "specs", "frs", "STE-96100.md"))).toThrow();
      const [verdict] = houseLines((await gate({ a: t.fx.a, planFile: t.planFile })).refusal, "branch leg");
      expect(verdict).toContain(B_NAME);
      expect(verdict).toMatch(stateWord("busy"));
      expect(verdict).toContain("STE-96100");
      expect(verdict).toContain("feature-609");
    } finally {
      t.cleanup();
    }
  });

  test("active only on a remote-tracking ref (no local branch, no fetch) ⇒ busy (red on HEAD)", async () => {
    const t = buildGitSibling();
    try {
      activeOnBranch(t.fx.b, "teammate", "STE-96101");
      git(t.fx.b, "update-ref", "refs/remotes/origin/teammate", "teammate");
      git(t.fx.b, "branch", "-q", "-D", "teammate");
      const [verdict] = houseLines(
        (await gate({ a: t.fx.a, planFile: t.planFile })).refusal,
        "remote-tracking leg",
      );
      expect(verdict).toMatch(stateWord("busy"));
      expect(verdict).toContain("STE-96101");
      expect(verdict).toContain("origin/teammate");
    } finally {
      t.cleanup();
    }
  });

  test("active only in a second worktree's working tree ⇒ busy, and the refusal names the worktree (red on HEAD)", async () => {
    const t = buildGitSibling();
    try {
      const parent = mkdtempSync(join(tmpdir(), "dpt-609-bwt-"));
      t.extra.push(parent);
      const wt = join(parent, "second");
      git(t.fx.b, "worktree", "add", "-q", "-b", "second", wt);
      writeFr(wt, "STE-96102", MILESTONE, "active"); // uncommitted, only there
      const [verdict] = houseLines(
        (await gate({ a: t.fx.a, planFile: t.planFile })).refusal,
        "second-worktree leg",
      );
      expect(verdict).toMatch(stateWord("busy"));
      expect(verdict).toContain("STE-96102");
      expect(verdict).toContain(basename(parent));
    } finally {
      t.cleanup();
    }
  });

  test("(control) active on a stale branch but archived on the trunk ⇒ not busy: the squash-merged permit leg passes", async () => {
    const t = buildGitSibling();
    try {
      activeOnBranch(t.fx.b, "stale", "STE-96103");
      writeFr(t.fx.b, "STE-96103", MILESTONE, "archived");
      commitAll(t.fx.b, "fixture: STE-96103 archived on the trunk (squash-merged)");
      const result = await gate({ a: t.fx.a, planFile: t.planFile });
      expect(result.refusal).toBeNull();
      expect(result.footer).toEqual([`Spans: ${B_NAME}@pending`]);
    } finally {
      t.cleanup();
    }
  });

  test("a git command that fails while reading the sibling ⇒ unreadable, never idle (red on HEAD)", async () => {
    const t = buildGitSibling();
    try {
      // A branch whose root tree object is gone: every read of that ref fails.
      git(t.fx.b, "checkout", "-q", "-b", "broken");
      writeFr(t.fx.b, "STE-96104", MILESTONE, "archived");
      commitAll(t.fx.b, "fixture: a commit whose tree will be lost");
      git(t.fx.b, "checkout", "-q", "main");
      const tree = git(t.fx.b, "rev-parse", "broken^{tree}").trim();
      const mainTree = git(t.fx.b, "rev-parse", "main^{tree}").trim();
      expect(tree).not.toBe(mainTree);
      unlinkSync(join(t.fx.b, ".git", "objects", tree.slice(0, 2), tree.slice(2)));
      // Premise: git really fails to read that ref, and B still is a repository.
      expect(() => git(t.fx.b, "ls-tree", "-r", "broken")).toThrow();
      expect(git(t.fx.b, "rev-parse", "--git-common-dir").trim()).not.toBe("");

      const [verdict, remedy] = houseLines(
        (await gate({ a: t.fx.a, planFile: t.planFile })).refusal,
        "failed git read",
      );
      expect(verdict).toContain(B_NAME);
      expect(verdict).toMatch(stateWord("unreadable"));
      expect(remedy).toContain("--partial");
    } finally {
      t.cleanup();
    }
  });
});

// ===========================================================================
// AC-STE-609.5 — only idle passes refusal #4
// ===========================================================================

describe("AC-STE-609.5 — refusal #4 refuses every non-idle state without --partial", () => {
  for (const state of NON_IDLE_STATES) {
    const note =
      state === "busy"
        ? " (red on HEAD: it refuses there too, but never names the state)"
        : " (red on HEAD)";
    test(`${state}: the gate refuses, naming the milestone, ${B_NAME}, the state and --partial${note}`, async () => {
      await withState(state, async (t) => {
        const [verdict, remedy] = houseLines((await gate(t)).refusal, state);
        expect(verdict).toContain(MILESTONE);
        expect(verdict).toContain(B_NAME);
        expect(verdict, `the verdict does not name the state ${state}`).toMatch(stateWord(state));
        expect(remedy).toContain("--partial");
      });
    });
  }

  test("each non-idle state's remedy is its own: eight states, eight distinct Remedy lines (red on HEAD)", async () => {
    const remedies = new Map<string, string>();
    for (const state of NON_IDLE_STATES) {
      await withState(state, async (t) => {
        const refusal = (await gate(t)).refusal;
        remedies.set(state, refusal === null ? "(passed)" : houseLines(refusal, state)[1]);
      });
    }
    expect(new Set(remedies.values()).size, JSON.stringify(Object.fromEntries(remedies), null, 2)).toBe(
      NON_IDLE_STATES.length,
    );
  }, 60_000);

  test("unreadable carries the workspace-binding reader's own text (red on HEAD)", async () => {
    await withState("unreadable", async (t) => {
      const refusal = (await gate(t)).refusal;
      expect(refusal, "the gate passed").not.toBeNull();
      expect(refusal!).toContain(UNREADABLE_READER_TEXT);
    });
  });

  test("front door: every non-idle state exits 1 with the refusal on stderr and empty stdout (red on HEAD except busy)", async () => {
    for (const state of NON_IDLE_STATES) {
      await withState(state, async (t) => {
        const inProcess = (await gate(t)).refusal;
        const door = shipGateDoor(t.a, t.planFile, MILESTONE);
        expect(door.status, `${state}\n${describeRun(door)}`).toBe(1);
        expect(door.stdout, `${state}\n${describeRun(door)}`).toBe("");
        expect(door.stderr.trimEnd(), state).toBe((inProcess ?? "(in-process gate passed)").trimEnd());
      });
    }
  }, 120_000);

  test("(control) --partial: every state passes, and the footer is measured as today", async () => {
    for (const state of NON_IDLE_STATES) {
      await withState(state, async (t) => {
        const result = await gate(t, true);
        expect(result.refusal, `${state}: ${result.refusal}`).toBeNull();
        expect(result.footer, state).toEqual([`Spans: ${B_NAME}@pending`]);
      });
    }
  }, 60_000);

  test("(control) --partial: the footer reads the sibling plan's own stamp (not-toolkit-managed sibling stamped v1.4.0)", async () => {
    await withState("not-toolkit-managed", async (t) => {
      const bPlan = join(t.fx.b, "specs", "plan", `${MILESTONE}.md`);
      const body = read(bPlan).replace(/^shipped_in: null$/m, "shipped_in: v1.4.0");
      expect(body).toMatch(/^shipped_in: v1\.4\.0$/m);
      await Bun.write(bPlan, body);
      const result = await gate(t, true);
      expect(result.refusal).toBeNull();
      expect(result.footer).toEqual([`Spans: ${B_NAME}@v1.4.0`]);
    });
  });

  test("(control) front door --partial on an unlocatable sibling: exit 0, the measured footer on stdout", async () => {
    await withState("unlocatable", async (t) => {
      const door = shipGateDoor(t.a, t.planFile, MILESTONE, true);
      expect(door.status, describeRun(door)).toBe(0);
      expect(lines(door.stdout)).toEqual([`Spans: ${B_NAME}@pending`]);
    });
  }, 30_000);

  test("(control) an idle sibling passes with its measured footer, in process and at the front door", async () => {
    await withState("idle", async (t) => {
      const result = await gate(t);
      expect(result.refusal).toBeNull();
      expect(result.footer).toEqual([`Spans: ${B_NAME}@pending`]);
      const door = shipGateDoor(t.a, t.planFile, MILESTONE);
      expect(door.status, describeRun(door)).toBe(0);
      expect(lines(door.stdout)).toEqual([`Spans: ${B_NAME}@pending`]);
      expect(door.stderr, describeRun(door)).toBe("");
    });
  }, 30_000);

  test("(control) two idle repositories that declare each other both pass — no deadlock", async () => {
    await withState("idle", async (t) => {
      const bPlan = join(t.fx.b, "specs", "plan", `${MILESTONE}.md`);
      const fromA = await gate(t);
      const fromB = await siblingShipGate({
        projectRoot: t.fx.b,
        planBody: read(bPlan),
        milestone: MILESTONE,
        partial: false,
      });
      expect(fromA.refusal, fromA.refusal ?? "").toBeNull();
      expect(fromB.refusal, fromB.refusal ?? "").toBeNull();
      expect(fromB.footer).toEqual([`Spans: glacy-app-fe@pending`]);
    });
  });

  test("a declared path naming an existing unrelated directory (the measured ../docs case) refuses as not-a-repository or not-toolkit-managed (red on HEAD)", async () => {
    await withState("idle", async (t) => {
      const docs = mkdtempSync(join(tmpdir(), "dpt-609-docs-"));
      try {
        const plan = writePlan(t.a, "live", MILESTONE, spansFromA(relative(t.a, docs)));
        const [verdict] = houseLines(
          (await siblingShipGate({ projectRoot: t.a, planBody: read(plan), milestone: MILESTONE, partial: false }))
            .refusal,
          "../docs",
        );
        expect(verdict).toMatch(/(^|[^a-z-])not-(a-repository|toolkit-managed)([^a-z-]|$)/);
      } finally {
        rmSync(docs, { recursive: true, force: true });
      }
    });
  });

  test("(control) mode: none — different-container is not applicable: an otherwise idle sibling passes", async () => {
    await withState("idle", async (t) => {
      const noneMd = ["# Fixture", "", "## Task Tracking", "", "mode: none", "", "## Docs", "", "user_facing_mode: false", ""].join("\n");
      await Bun.write(join(t.a, "CLAUDE.md"), noneMd);
      await Bun.write(join(t.fx.b, "CLAUDE.md"), noneMd.replace("# Fixture", "# Another Fixture"));
      commitAll(t.fx.b, "fixture: B in mode none");
      const result = await gate(t);
      expect(result.refusal, result.refusal ?? "").toBeNull();
      expect(result.footer).toEqual([`Spans: ${B_NAME}@pending`]);
    });
  });
});

// ===========================================================================
// AC-STE-609.6 — one classification, every surface
// ===========================================================================

describe("AC-STE-609.6 — every surface reads the one classification", () => {
  test("spanningSiblingState reports each declared sibling's state from the closed set (red on HEAD)", async () => {
    const seen: Record<string, unknown> = {};
    for (const state of ["idle", ...NON_IDLE_STATES] as SiblingStateName[]) {
      await withState(state, async (t) => {
        const s = await spanningSiblingState(t.a, read(t.planFile), MILESTONE);
        const sibling = (s.siblings as unknown as Array<{ name: string; state?: unknown }>).find(
          (x) => x.name === B_NAME,
        );
        seen[state] = sibling?.state;
      });
    }
    expect(seen).toEqual(
      Object.fromEntries((["idle", ...NON_IDLE_STATES] as string[]).map((s) => [s, s])),
    );
  }, 60_000);

  for (const state of NON_IDLE_STATES) {
    if (state === "unlocatable") continue;
    test(`probe #75: a ${state} sibling holds the milestone out of ship-ready and renders awaiting-sibling (${B_NAME}: ${state}) (red on HEAD)`, async () => {
      await withState(state, async (t) => {
        const report = await runActivePlanShipReadyProbe(t.a);
        expect(report.violations).toEqual([]);
        expect(report.notes.some((n) => n.startsWith("ship-ready milestones:")), report.notes.join("\n")).toBe(
          false,
        );
        expect(report.notes).toContain(`awaiting-sibling milestones: ${MILESTONE} (${B_NAME}: ${state})`);
      });
    });
  }

  test("probe #75: an unlocatable sibling keeps its sibling-unlocatable row but is no longer ship-ready (red on HEAD)", async () => {
    await withState("unlocatable", async (t) => {
      const report = await runActivePlanShipReadyProbe(t.a);
      expect(report.notes.some((n) => n.startsWith("ship-ready milestones:")), report.notes.join("\n")).toBe(
        false,
      );
      const row = report.notes.find((n) => n.startsWith("sibling-unlocatable milestones: "));
      expect(row, report.notes.join("\n")).toBeDefined();
      expect(row!).toContain(MILESTONE);
      expect(row!).toContain(B_NAME);
    });
  });

  test("(control) probe #75: an idle sibling leaves the milestone ship-ready with no sibling row", async () => {
    await withState("idle", async (t) => {
      const report = await runActivePlanShipReadyProbe(t.a);
      expect(report.notes.filter((n) => n.startsWith("ship-ready milestones:"))).toHaveLength(1);
      expect(report.notes.some((n) => /^(awaiting-sibling|sibling-unlocatable) /.test(n))).toBe(false);
    });
  });

  test("close-offer CLI: every held milestone prints `held: <token> (<sibling>: <state>)` on stderr, stdout stays empty, exit 0 (red on HEAD)", async () => {
    const runs: Array<[SiblingStateName, Run]> = [];
    for (const state of NON_IDLE_STATES) {
      await withState(state, (t) => {
        runs.push([state, closeOfferDoor(t.a)]);
      });
    }
    for (const [state, run] of runs) {
      expect(run.status, `${state}\n${describeRun(run)}`).toBe(0);
      expect(run.stdout, `${state}\n${describeRun(run)}`).toBe("");
      expect(lines(run.stderr), `${state}\n${describeRun(run)}`).toEqual([
        `held: ${MILESTONE} (${B_NAME}: ${state})`,
      ]);
    }
  }, 120_000);

  test("(control) close-offer CLI: an idle sibling prints the token on stdout and nothing on stderr", async () => {
    await withState("idle", (t) => {
      const run = closeOfferDoor(t.a);
      expect(run.status, describeRun(run)).toBe(0);
      expect(run.stdout).toBe(`${MILESTONE}\n`);
      expect(run.stderr, describeRun(run)).toBe("");
    });
  }, 30_000);

  test("milestone-scope resume: every non-idle state is awaiting — the chain orders nothing (red on HEAD except busy)", async () => {
    const got: Record<string, unknown> = {};
    for (const state of NON_IDLE_STATES) {
      await withState(state, async (t) => {
        const c = await classifyResume(t.a, { scope: "milestone", milestone: MILESTONE });
        got[state] = {
          awaiting: (c.awaitingSiblings ?? []).length > 0,
          chain: skills(resumeChain(c)),
        };
      });
    }
    expect(got).toEqual(
      Object.fromEntries(NON_IDLE_STATES.map((s) => [s, { awaiting: true, chain: [] }])),
    );
  }, 60_000);

  test("FR-scope resume: the last local FR of a milestone whose sibling is not idle stops at /pr (red on HEAD except busy)", async () => {
    const got: Record<string, unknown> = {};
    for (const state of NON_IDLE_STATES) {
      await withState(
        state,
        async (t) => {
          const c = await classifyResume(t.a, { scope: "fr", fr: A_FR, milestone: MILESTONE });
          got[state] = {
            last: c.lastActiveFr,
            awaiting: (c.awaitingSiblings ?? []).length > 0,
            chain: skills(resumeChain(c)),
          };
        },
        { local: "active" },
      );
    }
    expect(got).toEqual(
      Object.fromEntries(
        NON_IDLE_STATES.map((s) => [s, { last: true, awaiting: true, chain: ["/implement", "/pr"] }]),
      ),
    );
  }, 60_000);

  test("(control) both resume scopes still order the ship tail for an idle sibling", async () => {
    await withState("idle", async (t) => {
      const c = await classifyResume(t.a, { scope: "milestone", milestone: MILESTONE });
      expect(c.awaitingSiblings ?? []).toEqual([]);
      expect(skills(resumeChain(c))).toContain("/ship-milestone");
    });
    await withState(
      "idle",
      async (t) => {
        const c = await classifyResume(t.a, { scope: "fr", fr: A_FR, milestone: MILESTONE });
        expect(skills(resumeChain(c))).toEqual(["/implement", "/spec-archive", "/ship-milestone", "/pr"]);
      },
      { local: "active" },
    );
  });

  test("(control) fixture premise: the busy sibling holds one active and one archived FR", async () => {
    await withState("busy", async (t: StateTree) => {
      expect(read(join(t.fx.b, "specs", "frs", `${B_FR_ACTIVE}.md`))).toContain("status: active");
      expect(read(join(t.fx.b, "specs", "frs", "archive", `${B_FR_DONE}.md`))).toContain(
        "status: archived",
      );
    });
  });
});
