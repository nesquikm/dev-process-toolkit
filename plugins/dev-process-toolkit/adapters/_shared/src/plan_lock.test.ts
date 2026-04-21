// Phase G Tier 4 tests — plan_lock.ts (FR-44).

import { $ } from "bun";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkPlanWriteAllowed, findPostFreezeEdits, PLAN_FROZEN_MESSAGE } from "./plan_lock";

let work: string;

async function initRepo(dir: string) {
  await $`git init --initial-branch=main -q`.cwd(dir);
  await $`git config user.email t@t.t`.cwd(dir);
  await $`git config user.name t`.cwd(dir);
  await $`git config commit.gpgsign false`.cwd(dir);
}

beforeEach(async () => {
  work = mkdtempSync(join(tmpdir(), "dpt-plan-lock-"));
  await initRepo(work);
  mkdirSync(join(work, "specs", "plan"), { recursive: true });
});
afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

describe("checkPlanWriteAllowed — Schema T enforcement (AC-44.3)", () => {
  test("refuses write to status=active plan file with replan-branch guidance", () => {
    const planPath = join(work, "specs", "plan", "M13.md");
    writeFileSync(
      planPath,
      [
        "---",
        "milestone: M13",
        "status: active",
        "kickoff_branch: plan/M13-kickoff",
        "frozen_at: 2026-04-21T00:00:00Z",
        "revision: 1",
        "---",
        "",
        "# M13",
        "",
      ].join("\n"),
    );
    const result = checkPlanWriteAllowed(planPath, "feat/something");
    expect(result.allowed).toBe(false);
    expect(result.message).toContain("M13");
    expect(result.message).toContain("plan/M13-replan-");
    expect(PLAN_FROZEN_MESSAGE("M13")).toContain("frozen");
  });

  test("allows write to status=draft plan file", () => {
    const planPath = join(work, "specs", "plan", "M20.md");
    writeFileSync(
      planPath,
      [
        "---",
        "milestone: M20",
        "status: draft",
        "kickoff_branch: null",
        "frozen_at: null",
        "revision: 1",
        "---",
        "",
      ].join("\n"),
    );
    const result = checkPlanWriteAllowed(planPath, "main");
    expect(result.allowed).toBe(true);
  });

  test("allows write when on a plan/M<N>-replan-<N> branch (AC-44.4)", () => {
    const planPath = join(work, "specs", "plan", "M13.md");
    writeFileSync(
      planPath,
      [
        "---",
        "milestone: M13",
        "status: active",
        "kickoff_branch: plan/M13-kickoff",
        "frozen_at: 2026-04-21T00:00:00Z",
        "revision: 1",
        "---",
        "",
      ].join("\n"),
    );
    const result = checkPlanWriteAllowed(planPath, "plan/M13-replan-1");
    expect(result.allowed).toBe(true);
  });

  test("refuses write when branch is plan/M14-replan-1 but editing M13.md", () => {
    const planPath = join(work, "specs", "plan", "M13.md");
    writeFileSync(
      planPath,
      [
        "---",
        "milestone: M13",
        "status: active",
        "kickoff_branch: plan/M13-kickoff",
        "frozen_at: 2026-04-21T00:00:00Z",
        "revision: 1",
        "---",
        "",
      ].join("\n"),
    );
    const result = checkPlanWriteAllowed(planPath, "plan/M14-replan-1");
    expect(result.allowed).toBe(false);
  });

  test("allows write to status=complete plan file (archived/complete is read-mostly but not gated here)", () => {
    const planPath = join(work, "specs", "plan", "archive", "M1.md");
    mkdirSync(join(work, "specs", "plan", "archive"), { recursive: true });
    writeFileSync(
      planPath,
      [
        "---",
        "milestone: M1",
        "status: complete",
        "kickoff_branch: null",
        "frozen_at: null",
        "revision: 1",
        "---",
        "",
      ].join("\n"),
    );
    const result = checkPlanWriteAllowed(planPath, "any-branch");
    expect(result.allowed).toBe(true);
  });
});

describe("findPostFreezeEdits — git-log scan (AC-44.4)", () => {
  test("returns empty when plan has no commits after frozen_at", async () => {
    const planPath = join(work, "specs", "plan", "M13.md");
    const frontmatter = [
      "---",
      "milestone: M13",
      "status: active",
      "kickoff_branch: plan/M13-kickoff",
      `frozen_at: 2099-01-01T00:00:00Z`, // far future
      "revision: 1",
      "---",
      "",
      "# M13",
      "",
    ].join("\n");
    writeFileSync(planPath, frontmatter);
    await $`git add -A`.cwd(work).quiet();
    await $`git commit -q -m plan-write`.cwd(work).quiet();
    const edits = await findPostFreezeEdits(work);
    expect(edits).toEqual([]);
  });

  test("flags commits to plan file authored after frozen_at", async () => {
    const planPath = join(work, "specs", "plan", "M13.md");
    const initialFm = [
      "---",
      "milestone: M13",
      "status: active",
      "kickoff_branch: plan/M13-kickoff",
      "frozen_at: 2020-01-01T00:00:00Z", // well in the past
      "revision: 1",
      "---",
      "",
      "# M13 initial",
      "",
    ].join("\n");
    writeFileSync(planPath, initialFm);
    await $`git add -A`.cwd(work).quiet();
    await $`git commit -q -m initial-plan`.cwd(work).quiet();
    // Now edit the plan post-freeze
    writeFileSync(planPath, initialFm + "\npost-freeze line\n");
    await $`git add -A`.cwd(work).quiet();
    await $`git commit -q -m post-freeze-edit`.cwd(work).quiet();
    const edits = await findPostFreezeEdits(work);
    expect(edits.length).toBeGreaterThan(0);
    const m13Edits = edits.filter((e) => e.milestone === "M13");
    expect(m13Edits.length).toBeGreaterThan(0);
    expect(m13Edits[0]?.sha).toMatch(/^[0-9a-f]+$/);
  });
});
