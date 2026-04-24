import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkPlanWriteAllowed, PLAN_FROZEN_MESSAGE } from "../adapters/_shared/src/plan_lock";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

// STE-82 AC-STE-82.4 + AC-STE-82.7 — gate-check probe #4 integration test.
//
// Probe 4 walks `specs/plan/<M#>.md` files with `status: active` and a
// non-null `frozen_at`, and reports any commits to that path authored after
// the freeze timestamp. Each post-freeze commit surfaces as GATE PASSED
// WITH NOTES — no auto-revert; the user decides (AC-STE-21.4).
//
// This test exercises the `checkPlanWriteAllowed` gate function with
// synthesized plan-file fixtures to validate the freeze logic.

const pluginRoot = join(import.meta.dir, "..");
const gateCheckSkillPath = join(pluginRoot, "skills", "gate-check", "SKILL.md");

function read(path: string): string {
  return readFileSync(path, "utf8");
}

describe("STE-82 AC-STE-82.4 prose — /gate-check probe 4 is documented in SKILL.md", () => {
  test("SKILL.md names the Plan post-freeze edit scan probe", () => {
    const body = read(gateCheckSkillPath);
    expect(body).toMatch(/Plan post-freeze edit scan/);
    expect(body).toMatch(/AC-STE-21\.4/);
  });

  test("probe names `frozen_at` + `git log --follow` + the no-auto-revert rule", () => {
    const body = read(gateCheckSkillPath);
    expect(body).toContain("frozen_at");
    expect(body).toMatch(/git log --follow/);
    expect(body).toMatch(/No auto-revert|user decides/i);
  });

  test("probe is warn-only: GATE PASSED WITH NOTES", () => {
    const body = read(gateCheckSkillPath);
    const probeIdx = body.indexOf("Plan post-freeze edit scan");
    expect(probeIdx).toBeGreaterThan(-1);
    const block = body.slice(probeIdx, probeIdx + 300);
    expect(block).toContain("GATE PASSED WITH NOTES");
  });
});

describe("STE-82 AC-STE-82.4/7 — plan-lock fixtures (positive + negative)", () => {
  function makePlanFile(frontmatter: string): { dir: string; planPath: string; cleanup: () => void } {
    const dir = mkdtempSync(join(tmpdir(), "plan-freeze-"));
    const planDir = join(dir, "specs", "plan");
    mkdirSync(planDir, { recursive: true });
    const planPath = join(planDir, "M42.md");
    writeFileSync(planPath, `---\n${frontmatter}\n---\n\n# M42\n`);
    return { dir, planPath, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
  }

  test("POSITIVE: archived plan permits writes on any branch", () => {
    const ctx = makePlanFile(
      `milestone: M42\nstatus: archived\nkickoff_branch: feat/m42\nfrozen_at: 2026-04-24T08:00:00Z`,
    );
    try {
      const result = checkPlanWriteAllowed(ctx.planPath, "feat/any-branch");
      expect(result.allowed).toBe(true);
    } finally {
      ctx.cleanup();
    }
  });

  test("NEGATIVE: active plan blocks writes off the sanctioned replan branch (canonical freeze message)", () => {
    const ctx = makePlanFile(
      `milestone: M42\nstatus: active\nkickoff_branch: feat/m42-kickoff\nfrozen_at: 2026-04-24T08:00:00Z`,
    );
    try {
      const result = checkPlanWriteAllowed(ctx.planPath, "feat/unrelated-branch");
      expect(result.allowed).toBe(false);
      expect(result.milestone).toBe("M42");
      // AC-STE-82.7 note shape — canonical freeze message names the milestone
      // and points at the sanctioned replan-branch remedy.
      expect(result.message).toBe(PLAN_FROZEN_MESSAGE("M42"));
      expect(result.message).toContain("plan/M42-replan-");
    } finally {
      ctx.cleanup();
    }
  });

  test("POSITIVE: active plan permits writes on the sanctioned plan/M42-replan-1 branch", () => {
    const ctx = makePlanFile(
      `milestone: M42\nstatus: active\nkickoff_branch: feat/m42-kickoff\nfrozen_at: 2026-04-24T08:00:00Z`,
    );
    try {
      const result = checkPlanWriteAllowed(ctx.planPath, "plan/M42-replan-1");
      expect(result.allowed).toBe(true);
      expect(result.milestone).toBe("M42");
    } finally {
      ctx.cleanup();
    }
  });
});
