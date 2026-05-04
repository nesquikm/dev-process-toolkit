import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluatePlanOnlyEligibility } from "./plan_only_archival";

function makeSpecs(): string {
  const root = mkdtempSync(join(tmpdir(), "plan-only-"));
  mkdirSync(join(root, "plan"), { recursive: true });
  return root;
}

function writePlan(specsDir: string, milestone: string, body: string): void {
  writeFileSync(join(specsDir, "plan", `${milestone}.md`), body);
}

describe("STE-200 — evaluatePlanOnlyEligibility", () => {
  test("AC-STE-200.1 (a): kind: scaffolding ⇒ eligible/scaffolding", async () => {
    const root = makeSpecs();
    try {
      writePlan(
        root,
        "M1",
        "---\nmilestone: M1\nstatus: active\nkind: scaffolding\n---\n\n# Plan\n\n## M1: Bootstrap\n\n- [ ] still pending\n",
      );
      const r = await evaluatePlanOnlyEligibility(root, "M1");
      expect(r.eligible).toBe(true);
      expect(r.reason).toBe("scaffolding");
      expect(r.planExists).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("AC-STE-200.1 (b): every task checked ⇒ eligible/all-checked", async () => {
    const root = makeSpecs();
    try {
      writePlan(
        root,
        "M2",
        "---\nmilestone: M2\nstatus: active\n---\n\n## M2: Foo\n\n- [x] one\n- [x] two\n- [deferred] three — moved to M3\n",
      );
      const r = await evaluatePlanOnlyEligibility(root, "M2");
      expect(r.eligible).toBe(true);
      expect(r.reason).toBe("all-checked");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("AC-STE-200.1: unchecked task ⇒ ineligible/ineligible-mixed-tasks", async () => {
    const root = makeSpecs();
    try {
      writePlan(
        root,
        "M2",
        "---\nmilestone: M2\nstatus: active\n---\n\n## M2: Foo\n\n- [x] one\n- [ ] two\n",
      );
      const r = await evaluatePlanOnlyEligibility(root, "M2");
      expect(r.eligible).toBe(false);
      expect(r.reason).toBe("ineligible-mixed-tasks");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("AC-STE-200.2: --plan-only flag forces eligibility/explicit-flag", async () => {
    const root = makeSpecs();
    try {
      writePlan(
        root,
        "M3",
        "---\nmilestone: M3\nstatus: active\n---\n\n## M3: Foo\n\n- [ ] still open\n",
      );
      const r = await evaluatePlanOnlyEligibility(root, "M3", { planOnlyFlag: true });
      expect(r.eligible).toBe(true);
      expect(r.reason).toBe("explicit-flag");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("missing plan file ⇒ ineligible/ineligible-plan-missing/planExists=false", async () => {
    const root = makeSpecs();
    try {
      const r = await evaluatePlanOnlyEligibility(root, "M99");
      expect(r.eligible).toBe(false);
      expect(r.reason).toBe("ineligible-plan-missing");
      expect(r.planExists).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("plan with no tasks AND no scaffolding marker ⇒ ineligible-mixed-tasks", async () => {
    const root = makeSpecs();
    try {
      writePlan(
        root,
        "M4",
        "---\nmilestone: M4\nstatus: active\n---\n\n## M4: Empty\n\nnone\n",
      );
      const r = await evaluatePlanOnlyEligibility(root, "M4");
      expect(r.eligible).toBe(false);
      expect(r.reason).toBe("ineligible-mixed-tasks");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
