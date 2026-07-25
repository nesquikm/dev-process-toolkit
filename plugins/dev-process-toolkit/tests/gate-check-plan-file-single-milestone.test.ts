import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPlanFileSingleMilestoneProbe } from "../adapters/_shared/src/plan_file_single_milestone";

function makeFixture(): string {
  const root = mkdtempSync(join(tmpdir(), "dpt-probe-"));
  mkdirSync(join(root, "specs", "plan"), { recursive: true });
  mkdirSync(join(root, "specs", "plan", "archive"), { recursive: true });
  return root;
}

function cleanup(root: string): void {
  rmSync(root, { recursive: true, force: true });
}

describe("STE-197 — plan-file-single-milestone probe", () => {
  test("AC-STE-197.5: passes on a single-milestone plan file", async () => {
    const root = makeFixture();
    try {
      writeFileSync(
        join(root, "specs", "plan", "M1.md"),
        "---\nmilestone: M1\nstatus: active\n---\n\n# Plan\n\n## M1: Foundation {#M1}\n\n**Goal:** scaffold\n",
      );
      const report = await runPlanFileSingleMilestoneProbe(root);
      expect(report.violations).toEqual([]);
    } finally {
      cleanup(root);
    }
  });

  test("AC-STE-197.5: flags multi-milestone plan file at ADVISORY", async () => {
    const root = makeFixture();
    try {
      const multiMilestone = [
        "---",
        "milestone: M1",
        "status: active",
        "---",
        "",
        "# Plan",
        "",
        "## M1: Foundation",
        "",
        "## M2: Core arithmetic operations",
        "",
        "## Milestone Dependency Graph",
        "",
      ].join("\n");
      writeFileSync(join(root, "specs", "plan", "M1.md"), multiMilestone);
      const report = await runPlanFileSingleMilestoneProbe(root);
      expect(report.violations.length).toBe(1);
      expect(report.violations[0]!.count).toBe(2);
      expect(report.violations[0]!.note).toMatch(/M1\.md:1 —/);
      // STE-415: separator-neutral wording — the reason names the count and the
      // exactly-one invariant without pinning one separator (the probe now
      // counts both `## M<N>:` and `## M<N> —` headings).
      expect(report.violations[0]!.reason).toMatch(/carries 2 .*headings; expected exactly 1/);
    } finally {
      cleanup(root);
    }
  });

  test("AC-STE-197.5: also walks specs/plan/archive/", async () => {
    const root = makeFixture();
    try {
      writeFileSync(
        join(root, "specs", "plan", "archive", "M1.md"),
        "## M1: Foo\n## M2: Bar\n",
      );
      const report = await runPlanFileSingleMilestoneProbe(root);
      expect(report.violations.length).toBe(1);
    } finally {
      cleanup(root);
    }
  });

  test("AC-STE-197.5: silently skips a missing archive/ directory", async () => {
    const root = mkdtempSync(join(tmpdir(), "dpt-probe-noarchive-"));
    mkdirSync(join(root, "specs", "plan"), { recursive: true });
    try {
      writeFileSync(
        join(root, "specs", "plan", "M1.md"),
        "## M1: Foo\n",
      );
      const report = await runPlanFileSingleMilestoneProbe(root);
      expect(report.violations).toEqual([]);
    } finally {
      cleanup(root);
    }
  });
});

// STE-376 AC-STE-376.5 — the probe's walk + heading count accept the
// M_<epic-key> union shape: Epic-keyed plan files are inspected (never
// silently skipped) and epic milestone headings count toward the
// exactly-one invariant.
describe("STE-376 — M_<epic-key> plan files (AC-STE-376.5)", () => {
  test("epic-keyed plan file carrying two milestone headings is flagged (not skipped)", async () => {
    const root = makeFixture();
    try {
      writeFileSync(
        join(root, "specs", "plan", "M_PROJ_500.md"),
        "---\nmilestone: M_PROJ_500\nstatus: active\n---\n\n# Plan\n\n## M_PROJ_500: Epic-keyed milestone\n\n## M2: Stray second milestone\n",
      );
      const report = await runPlanFileSingleMilestoneProbe(root);
      expect(report.violations.length).toBe(1);
      expect(report.violations[0]!.count).toBe(2);
      expect(report.violations[0]!.note).toMatch(/M_PROJ_500\.md:1 —/);
    } finally {
      cleanup(root);
    }
  });

  test("well-formed single-heading epic plan passes (no false positive)", async () => {
    const root = makeFixture();
    try {
      writeFileSync(
        join(root, "specs", "plan", "M_PROJ_500.md"),
        "---\nmilestone: M_PROJ_500\nstatus: active\n---\n\n# Plan\n\n## M_PROJ_500: Epic-keyed milestone\n\n**Goal:** epic grammar\n",
      );
      const report = await runPlanFileSingleMilestoneProbe(root);
      expect(report.violations).toEqual([]);
    } finally {
      cleanup(root);
    }
  });

  test("archived epic-keyed plan files are walked too", async () => {
    const root = makeFixture();
    try {
      writeFileSync(
        join(root, "specs", "plan", "archive", "M_PROJ_500.md"),
        "## M_PROJ_500: Foo\n## M_OTHER_9: Bar\n",
      );
      const report = await runPlanFileSingleMilestoneProbe(root);
      expect(report.violations.length).toBe(1);
    } finally {
      cleanup(root);
    }
  });
});

// ---------------------------------------------------------------------------
// STE-415 AC-STE-415.2 — MILESTONE_HEADING_RE widened to BOTH separators. The
// new emit form is `## M<N> — <Title> {#M<N>}` (em-dash); a colon-only counter
// would score an em-dash multi-milestone plan file as 0 headings and silently
// drop the advisory this probe exists to raise.
// ---------------------------------------------------------------------------

const EM_DASH = "—";

describe("STE-415 — separator-neutral milestone-heading count", () => {
  test("em-dash multi-milestone plan file is flagged (count 2)", async () => {
    const root = makeFixture();
    try {
      writeFileSync(
        join(root, "specs", "plan", "M1.md"),
        [
          "---",
          "milestone: M1",
          "status: active",
          "---",
          "",
          "# Plan",
          "",
          `## M1 ${EM_DASH} Foundation {#M1}`,
          "",
          `## M2 ${EM_DASH} Core arithmetic operations {#M2}`,
          "",
        ].join("\n"),
      );
      const report = await runPlanFileSingleMilestoneProbe(root);
      expect(report.violations.length).toBe(1);
      expect(report.violations[0]!.count).toBe(2);
      expect(report.violations[0]!.note).toMatch(/M1\.md:1 —/);
    } finally {
      cleanup(root);
    }
  });

  test("mixed colon + em-dash headings count together (count 2)", async () => {
    const root = makeFixture();
    try {
      writeFileSync(
        join(root, "specs", "plan", "M1.md"),
        `## M1: Foundation\n\n## M2 ${EM_DASH} Core arithmetic operations\n`,
      );
      const report = await runPlanFileSingleMilestoneProbe(root);
      expect(report.violations.length).toBe(1);
      expect(report.violations[0]!.count).toBe(2);
    } finally {
      cleanup(root);
    }
  });

  test("epic-keyed em-dash headings are counted too (union grammar preserved)", async () => {
    const root = makeFixture();
    try {
      writeFileSync(
        join(root, "specs", "plan", "M_PROJ_500.md"),
        `## M_PROJ_500 ${EM_DASH} Epic-keyed milestone {#M_PROJ_500}\n\n## M2 ${EM_DASH} Stray second milestone\n`,
      );
      const report = await runPlanFileSingleMilestoneProbe(root);
      expect(report.violations.length).toBe(1);
      expect(report.violations[0]!.count).toBe(2);
    } finally {
      cleanup(root);
    }
  });

  test("a single em-dash heading yields no advisory (no false positive)", async () => {
    const root = makeFixture();
    try {
      writeFileSync(
        join(root, "specs", "plan", "M1.md"),
        `---\nmilestone: M1\nstatus: active\n---\n\n# Plan\n\n## M1 ${EM_DASH} Foundation {#M1}\n\n**Goal:** scaffold\n`,
      );
      const report = await runPlanFileSingleMilestoneProbe(root);
      expect(report.violations).toEqual([]);
    } finally {
      cleanup(root);
    }
  });

  test("the advisory reason is separator-neutral (no colon-only `## M<N>:` literal)", async () => {
    const root = makeFixture();
    try {
      writeFileSync(
        join(root, "specs", "plan", "M1.md"),
        `## M1 ${EM_DASH} Foundation\n\n## M2 ${EM_DASH} Core\n`,
      );
      const report = await runPlanFileSingleMilestoneProbe(root);
      expect(report.violations.length).toBe(1);
      expect(report.violations[0]!.reason).not.toContain("## M<N>:");
      expect(report.violations[0]!.reason).toMatch(/carries 2 .*headings; expected exactly 1/);
    } finally {
      cleanup(root);
    }
  });
});
