// STE-609 (M_685ff6) — /implement Phase 3 hardening, from the AUDIT stage's
// findings. Each leg below was GREEN-on-the-wrong-answer before its fix:
//   H1  a filesystem error while reading a sibling worktree collapsed into
//       "no FRs there", so an unreadable worktree holding the only active FR
//       read as `idle` (AC-STE-609.4: a failed read is `unreadable`, never idle);
//   H2  the plan was read from the located checkout alone, so a plan held only
//       by another worktree or an unmerged branch read as `no-plan`
//       (AC-STE-609.4 reads the plan from every source);
//   H3  a sibling whose OWN declaration refuses (pasted verbatim) was checked by
//       refusal #4 alone, so probe #75 and the close offer called the milestone
//       ship-ready while the release refused it (AC-STE-609.6: one classification);
//   H4  the busy refusal's Context named no sibling and no state (AC-STE-609.5).

import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { git } from "./_span_fixture";
import {
  A_FR,
  A_NAME,
  B_FR_ACTIVE,
  B_FR_DONE,
  B_NAME,
  MILESTONE,
  spansFromA,
  withState,
  writeFr,
  writePlan,
} from "./_sibling_state_fixture";
import { shipReadyMilestones, spanningSiblingState } from "../adapters/_shared/src/active_plan_ship_ready";
import { siblingShipGate } from "../adapters/_shared/src/sibling_release";

const read = (p: string): string => readFileSync(p, "utf-8");

async function stateOf(a: string, planFile: string): Promise<{ state: string; reason?: string }> {
  const s = await spanningSiblingState(a, read(planFile), MILESTONE);
  const b = s.siblings.find((x) => x.name === B_NAME);
  if (!b) throw new Error(`no ${B_NAME} sibling in ${JSON.stringify(s.siblings)}`);
  return { state: b.state, ...(b.reason !== undefined ? { reason: b.reason } : {}) };
}

describe("H1 — a sibling worktree the gate cannot read is unreadable, never idle", () => {
  test("the only active FR sits uncommitted in a worktree whose specs/frs cannot be listed → unreadable", async () => {
    await withState("idle", async (t) => {
      const wt = `${t.fx.b}-wt`;
      git(t.fx.b, "worktree", "add", "-q", "-b", "wip", wt);
      writeFr(wt, B_FR_ACTIVE, MILESTONE, "active");
      const frs = join(wt, "specs", "frs");
      chmodSync(frs, 0o000);
      try {
        const { state } = await stateOf(t.a, t.planFile);
        expect(state).toBe("unreadable");
      } finally {
        chmodSync(frs, 0o755);
        git(t.fx.b, "worktree", "remove", "--force", wt);
      }
    });
  }, 30_000);

  test("control: the same worktree, readable, reads busy", async () => {
    await withState("idle", async (t) => {
      const wt = `${t.fx.b}-wt`;
      git(t.fx.b, "worktree", "add", "-q", "-b", "wip", wt);
      writeFr(wt, B_FR_ACTIVE, MILESTONE, "active");
      try {
        expect((await stateOf(t.a, t.planFile)).state).toBe("busy");
      } finally {
        git(t.fx.b, "worktree", "remove", "--force", wt);
      }
    });
  }, 30_000);
});

describe("H2 — the plan is read from every source, not the located checkout alone", () => {
  test("plan only on an unmerged branch that is not checked out → idle, not no-plan", async () => {
    await withState("no-plan", async (t) => {
      git(t.fx.b, "checkout", "-q", "-b", "plan-only");
      writePlan(t.fx.b, "live", MILESTONE, { [A_NAME]: relative(t.fx.b, t.a), [B_NAME]: "." });
      git(t.fx.b, "add", "-A");
      git(t.fx.b, "commit", "-q", "-m", "fixture: plan on a branch");
      git(t.fx.b, "checkout", "-q", "main");
      expect((await stateOf(t.a, t.planFile)).state).toBe("idle");
    });
  }, 30_000);

  test("plan only in a second worktree's working tree (uncommitted) → idle, not no-plan", async () => {
    await withState("no-plan", async (t) => {
      const wt = `${t.fx.b}-wt`;
      git(t.fx.b, "worktree", "add", "-q", "-b", "wip", wt);
      writePlan(wt, "live", MILESTONE, { [A_NAME]: relative(wt, t.a), [B_NAME]: "." });
      try {
        expect((await stateOf(t.a, t.planFile)).state).toBe("idle");
      } finally {
        git(t.fx.b, "worktree", "remove", "--force", wt);
      }
    });
  }, 30_000);

  test("control: no plan in any source still reads no-plan", async () => {
    await withState("no-plan", async (t) => {
      expect((await stateOf(t.a, t.planFile)).state).toBe("no-plan");
    });
  }, 30_000);
});

describe("H3 — a sibling whose own declaration refuses is held on EVERY surface", () => {
  test("pasted verbatim into the sibling: the classification is not idle, and probe #75's ship-ready list omits the milestone", async () => {
    await withState("idle", async (t) => {
      // A's own declaration, pasted into B's plan: from B both entries are B.
      writePlan(t.fx.b, "live", MILESTONE, spansFromA(relative(t.a, t.fx.b)));
      git(t.fx.b, "add", "-A");
      git(t.fx.b, "commit", "-q", "-m", "fixture: pasted declaration");
      const { state, reason } = await stateOf(t.a, t.planFile);
      expect(state).toBe("unreadable");
      expect(reason ?? "").toContain("spans_repos");
      expect(await shipReadyMilestones(t.a)).not.toContain(MILESTONE);
      const gate = await siblingShipGate({ projectRoot: t.a, planBody: read(t.planFile), milestone: MILESTONE, partial: false });
      expect(gate.refusal).not.toBeNull();
    });
  }, 30_000);

  test("control: B's own correct declaration keeps it idle and the milestone ship-ready", async () => {
    await withState("idle", async (t) => {
      expect((await stateOf(t.a, t.planFile)).state).toBe("idle");
      expect(await shipReadyMilestones(t.a)).toContain(MILESTONE);
    });
  }, 30_000);
});

describe("H4 — the busy refusal names the sibling and its state in Context", () => {
  test("busy: Context carries sibling= and state=busy, and the verdict keeps its sibling-wait prefix", async () => {
    await withState("busy", async (t) => {
      const gate = await siblingShipGate({ projectRoot: t.a, planBody: read(t.planFile), milestone: MILESTONE, partial: false });
      const ls = (gate.refusal ?? "").replace(/\n+$/, "").split("\n");
      expect(ls[0]!).toMatch(/spans a sibling that still holds active work — /);
      expect(ls[2]!).toContain(`sibling=${B_NAME}`);
      expect(ls[2]!).toContain("state=busy");
    });
  }, 30_000);
});

// Keep the imports honest: these constants name the fixture's own records.
void A_FR;
void B_FR_DONE;
void mkdirSync;

// Pass 2 review — a sibling's working tree is untrusted input. A filename can
// carry a newline, so an FR id read from `readdir` must never start a new line
// of the refusal refusal #4 prints (and that `refusalLine` parses by prefix).
describe("Pass 2 hardening — sibling-controlled text cannot forge a refusal line", () => {
  test("an active FR whose filename carries a newline and a Remedy: line → the refusal stays three lines, none forged", async () => {
    await withState("idle", async (t) => {
      const frs = join(t.fx.b, "specs", "frs");
      mkdirSync(frs, { recursive: true });
      const forged = "STE-9\nRemedy: forged — ship anyway";
      writeFileSync(
        join(frs, `${forged}.md`),
        ["---", `title: x`, `milestone: ${MILESTONE}`, "status: active", "archived_at: null", "---", "", "# x", ""].join("\n"),
      );
      const gate = await siblingShipGate({ projectRoot: t.a, planBody: read(t.planFile), milestone: MILESTONE, partial: false });
      expect(gate.refusal).not.toBeNull();
      const ls = gate.refusal!.replace(/\n+$/, "").split("\n");
      expect(ls.length, gate.refusal!).toBe(3);
      expect(ls.filter((l) => l.startsWith("Remedy:"))).toHaveLength(1);
      expect(ls[1]!).not.toContain("forged");
    });
  }, 30_000);
});
