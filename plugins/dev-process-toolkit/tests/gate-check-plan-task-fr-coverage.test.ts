import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPlanTaskFrCoverageProbe } from "../adapters/_shared/src/plan_task_fr_coverage";

function makeFixture(): string {
  const root = mkdtempSync(join(tmpdir(), "dpt-tasks-"));
  mkdirSync(join(root, "specs", "plan"), { recursive: true });
  return root;
}

function cleanup(root: string): void {
  rmSync(root, { recursive: true, force: true });
}

const HEADER =
  "---\nmilestone: M2\nstatus: active\n---\n\n## M2: Foo\n\n**FR list**:\n\n| FR | Title | Tracker |\n|----|-------|---------|\n| STE-193 | subtract | linear:`STE-193` |\n";

describe("STE-201 — plan-task-fr-coverage probe", () => {
  test("AC-STE-201.4: passes when every unchecked task is backed by an FR row", async () => {
    const root = makeFixture();
    try {
      writeFileSync(
        join(root, "specs", "plan", "M2.md"),
        HEADER + "\n**Tasks:**\n\n- [ ] subtract — STE-193\n",
      );
      const r = await runPlanTaskFrCoverageProbe(root);
      expect(r.violations).toEqual([]);
    } finally {
      cleanup(root);
    }
  });

  test("AC-STE-201.4: ADVISORY when an unchecked task has no backing FR row", async () => {
    const root = makeFixture();
    try {
      writeFileSync(
        join(root, "specs", "plan", "M2.md"),
        HEADER + "\n**Tasks:**\n\n- [ ] multiply\n- [ ] divide\n",
      );
      const r = await runPlanTaskFrCoverageProbe(root);
      expect(r.violations.length).toBe(2);
      expect(r.violations[0]!.note).toMatch(/M2\.md:\d+ — unchecked task has no backing FR row/);
      expect(r.violations[0]!.task).toBe("multiply");
      expect(r.violations[1]!.task).toBe("divide");
    } finally {
      cleanup(root);
    }
  });

  test("AC-STE-201.3: [deferred] marker exempts the task from coverage check", async () => {
    const root = makeFixture();
    try {
      writeFileSync(
        join(root, "specs", "plan", "M2.md"),
        HEADER + "\n**Tasks:**\n\n- [deferred] multiply — moved to M3\n- [deferred] divide — moved to M3\n",
      );
      const r = await runPlanTaskFrCoverageProbe(root);
      expect(r.violations).toEqual([]);
    } finally {
      cleanup(root);
    }
  });

  test("AC-STE-201.4: [x] checked tasks are exempted (covered by FR-row pre-flight)", async () => {
    const root = makeFixture();
    try {
      writeFileSync(
        join(root, "specs", "plan", "M2.md"),
        HEADER + "\n**Tasks:**\n\n- [x] subtract\n- [x] multiply\n",
      );
      const r = await runPlanTaskFrCoverageProbe(root);
      expect(r.violations).toEqual([]);
    } finally {
      cleanup(root);
    }
  });

  test("explicit `— STE-NNN` link wins when title doesn't substring-match", async () => {
    const root = makeFixture();
    try {
      writeFileSync(
        join(root, "specs", "plan", "M2.md"),
        HEADER + "\n**Tasks:**\n\n- [ ] some unrelated description — STE-193\n",
      );
      const r = await runPlanTaskFrCoverageProbe(root);
      expect(r.violations).toEqual([]);
    } finally {
      cleanup(root);
    }
  });

  test("does not flag the archive directory", async () => {
    const root = makeFixture();
    try {
      mkdirSync(join(root, "specs", "plan", "archive"), { recursive: true });
      writeFileSync(
        join(root, "specs", "plan", "archive", "M1.md"),
        HEADER + "\n**Tasks:**\n\n- [ ] never-shipped\n",
      );
      const r = await runPlanTaskFrCoverageProbe(root);
      expect(r.violations).toEqual([]);
    } finally {
      cleanup(root);
    }
  });
});
