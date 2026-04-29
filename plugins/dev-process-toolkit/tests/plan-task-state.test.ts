import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readPlanTaskState } from "../adapters/_shared/src/plan_task_state";

// AC-STE-151.6 helper unit. readPlanTaskState reads a milestone's plan file and
// returns task-list state — the input probe #14 needs to decide the single-FR
// clean exemption. Strict regex (^\s*-\s*\[[ x]\]\s) keeps prose bullets out.

function makeSpecsDir(): string {
  const root = mkdtempSync(join(tmpdir(), "dpt-plan-task-state-"));
  mkdirSync(join(root, "plan"), { recursive: true });
  mkdirSync(join(root, "plan", "archive"), { recursive: true });
  return root;
}

describe("readPlanTaskState", () => {
  test("missing plan file → planStatus 'missing', zero counts", async () => {
    const specsDir = makeSpecsDir();
    const result = await readPlanTaskState(specsDir, "M99");
    expect(result.totalTasks).toBe(0);
    expect(result.uncheckedTasks).toBe(0);
    expect(result.planStatus).toBe("missing");
  });

  test("plan with only prose bullets → zero tasks (strict regex skips them)", async () => {
    const specsDir = makeSpecsDir();
    writeFileSync(
      join(specsDir, "plan", "M10.md"),
      `---
milestone: M10
status: active
---

# M10

- some prose bullet
- another one
- [ ]not actually a task (no space after bracket)
`,
    );
    const result = await readPlanTaskState(specsDir, "M10");
    expect(result.totalTasks).toBe(0);
    expect(result.uncheckedTasks).toBe(0);
    expect(result.planStatus).toBe("active");
  });

  test("plan with mixed checked/unchecked tasks", async () => {
    const specsDir = makeSpecsDir();
    writeFileSync(
      join(specsDir, "plan", "M11.md"),
      `---
milestone: M11
status: active
---

# M11

- [x] done one
- [ ] todo one
- [x] done two
- [ ] todo two
- [ ] todo three
`,
    );
    const result = await readPlanTaskState(specsDir, "M11");
    expect(result.totalTasks).toBe(5);
    expect(result.uncheckedTasks).toBe(3);
    expect(result.planStatus).toBe("active");
  });

  test("plan with all tasks checked → uncheckedTasks 0, planStatus active", async () => {
    const specsDir = makeSpecsDir();
    writeFileSync(
      join(specsDir, "plan", "M12.md"),
      `---
milestone: M12
status: active
---

# M12

- [x] one
- [x] two
- [x] three
`,
    );
    const result = await readPlanTaskState(specsDir, "M12");
    expect(result.totalTasks).toBe(3);
    expect(result.uncheckedTasks).toBe(0);
    expect(result.planStatus).toBe("active");
  });

  test("archived plan (under plan/archive/) → planStatus 'archived'", async () => {
    const specsDir = makeSpecsDir();
    writeFileSync(
      join(specsDir, "plan", "archive", "M13.md"),
      `---
milestone: M13
status: archived
---

# M13

- [x] one
- [x] two
`,
    );
    const result = await readPlanTaskState(specsDir, "M13");
    expect(result.totalTasks).toBe(2);
    expect(result.uncheckedTasks).toBe(0);
    expect(result.planStatus).toBe("archived");
  });

  test("active path takes precedence when both files exist", async () => {
    // Defensive — should not happen in practice, but the active path wins so a
    // half-archived state still surfaces in the active-side probe.
    const specsDir = makeSpecsDir();
    writeFileSync(
      join(specsDir, "plan", "M14.md"),
      `---
milestone: M14
status: active
---

# M14

- [ ] not done
`,
    );
    writeFileSync(
      join(specsDir, "plan", "archive", "M14.md"),
      `---
milestone: M14
status: archived
---

# M14

- [x] done
`,
    );
    const result = await readPlanTaskState(specsDir, "M14");
    expect(result.uncheckedTasks).toBe(1);
    expect(result.planStatus).toBe("active");
  });

  test("indented task lines counted (sub-bullets in nested lists)", async () => {
    const specsDir = makeSpecsDir();
    writeFileSync(
      join(specsDir, "plan", "M15.md"),
      `---
milestone: M15
status: active
---

# M15

- [ ] top level
  - [ ] nested unchecked
  - [x] nested checked
- [x] another top
`,
    );
    const result = await readPlanTaskState(specsDir, "M15");
    expect(result.totalTasks).toBe(4);
    expect(result.uncheckedTasks).toBe(2);
    expect(result.planStatus).toBe("active");
  });
});
