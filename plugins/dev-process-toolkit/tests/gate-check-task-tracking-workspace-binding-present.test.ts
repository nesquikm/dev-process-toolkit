// STE-117 AC-STE-117.8 — task-tracking-workspace-binding-present probe (#25).
//
// Tracker mode requires a populated `### Linear` / `### Jira` sub-section
// under `## Task Tracking`. Vacuous on mode-none. Hard-fails (severity error,
// NFR-10 canonical shape) when the sub-section is absent or any required
// field is missing/empty.

import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTaskTrackingWorkspaceBindingPresentProbe } from "../adapters/_shared/src/task_tracking_workspace_binding_present";

function makeProject(claudeMd: string | null): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "ws-binding-probe-"));
  if (claudeMd !== null) writeFileSync(join(root, "CLAUDE.md"), claudeMd);
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

describe("vacuous: mode-none / no CLAUDE.md", () => {
  test("CLAUDE.md absent → vacuous pass", async () => {
    const ctx = makeProject(null);
    try {
      const report = await runTaskTrackingWorkspaceBindingPresentProbe(ctx.root);
      expect(report.violations).toEqual([]);
    } finally {
      ctx.cleanup();
    }
  });

  test("section absent (mode-none canonical) → vacuous pass", async () => {
    const ctx = makeProject("# Project\n\nNo task tracking.\n");
    try {
      const report = await runTaskTrackingWorkspaceBindingPresentProbe(ctx.root);
      expect(report.violations).toEqual([]);
    } finally {
      ctx.cleanup();
    }
  });

  test("explicit mode: none → vacuous pass even with section present", async () => {
    const body = ["## Task Tracking", "", "mode: none", ""].join("\n");
    const ctx = makeProject(body);
    try {
      const report = await runTaskTrackingWorkspaceBindingPresentProbe(ctx.root);
      expect(report.violations).toEqual([]);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("happy path", () => {
  test("Linear sub-section with team + project → pass", async () => {
    const body = [
      "## Task Tracking",
      "",
      "mode: linear",
      "mcp_server: linear",
      "",
      "### Linear",
      "",
      "team: STE",
      "project: DPT — Dev Process Toolkit",
      "",
    ].join("\n");
    const ctx = makeProject(body);
    try {
      const report = await runTaskTrackingWorkspaceBindingPresentProbe(ctx.root);
      expect(report.violations).toEqual([]);
    } finally {
      ctx.cleanup();
    }
  });

  test("Jira sub-section with project → pass", async () => {
    const body = [
      "## Task Tracking",
      "",
      "mode: jira",
      "",
      "### Jira",
      "project: ENG",
      "",
    ].join("\n");
    const ctx = makeProject(body);
    try {
      const report = await runTaskTrackingWorkspaceBindingPresentProbe(ctx.root);
      expect(report.violations).toEqual([]);
    } finally {
      ctx.cleanup();
    }
  });

  test("multi-adapter co-presence (linear active, jira binding tolerated) → pass", async () => {
    const body = [
      "## Task Tracking",
      "",
      "mode: linear",
      "",
      "### Linear",
      "team: STE",
      "project: DPT",
      "",
      "### Jira",
      "project: ENG",
    ].join("\n");
    const ctx = makeProject(body);
    try {
      const report = await runTaskTrackingWorkspaceBindingPresentProbe(ctx.root);
      expect(report.violations).toEqual([]);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("violations: tracker mode without binding", () => {
  test("Linear mode, sub-section absent → fail (NFR-10 shape)", async () => {
    const body = ["## Task Tracking", "", "mode: linear", "mcp_server: linear", ""].join("\n");
    const ctx = makeProject(body);
    try {
      const report = await runTaskTrackingWorkspaceBindingPresentProbe(ctx.root);
      expect(report.violations.length).toBe(1);
      const v = report.violations[0]!;
      expect(v.note).toMatch(/### Linear/);
      expect(v.message).toMatch(/Remedy:/);
      expect(v.message).toMatch(/Context:/);
      expect(v.message).toMatch(/probe=task_tracking_workspace_binding_present/);
    } finally {
      ctx.cleanup();
    }
  });

  test("Linear mode, missing team → fail naming team", async () => {
    const body = [
      "## Task Tracking",
      "",
      "mode: linear",
      "",
      "### Linear",
      "project: DPT",
    ].join("\n");
    const ctx = makeProject(body);
    try {
      const report = await runTaskTrackingWorkspaceBindingPresentProbe(ctx.root);
      expect(report.violations.length).toBe(1);
      expect(report.violations[0]!.note).toMatch(/team/);
    } finally {
      ctx.cleanup();
    }
  });

  test("Linear mode, missing project → fail naming project", async () => {
    const body = [
      "## Task Tracking",
      "",
      "mode: linear",
      "",
      "### Linear",
      "team: STE",
    ].join("\n");
    const ctx = makeProject(body);
    try {
      const report = await runTaskTrackingWorkspaceBindingPresentProbe(ctx.root);
      expect(report.violations.length).toBe(1);
      expect(report.violations[0]!.note).toMatch(/project/);
    } finally {
      ctx.cleanup();
    }
  });

  test("Linear mode, empty-string value → fail", async () => {
    const body = [
      "## Task Tracking",
      "",
      "mode: linear",
      "",
      "### Linear",
      "team:",
      "project: DPT",
    ].join("\n");
    const ctx = makeProject(body);
    try {
      const report = await runTaskTrackingWorkspaceBindingPresentProbe(ctx.root);
      expect(report.violations.length).toBe(1);
      expect(report.violations[0]!.note).toMatch(/team/);
    } finally {
      ctx.cleanup();
    }
  });

  test("Linear mode, whitespace-only value → fail", async () => {
    const body = [
      "## Task Tracking",
      "",
      "mode: linear",
      "",
      "### Linear",
      "team:    ",
      "project: DPT",
    ].join("\n");
    const ctx = makeProject(body);
    try {
      const report = await runTaskTrackingWorkspaceBindingPresentProbe(ctx.root);
      expect(report.violations.length).toBe(1);
      expect(report.violations[0]!.note).toMatch(/team/);
    } finally {
      ctx.cleanup();
    }
  });

  test("Jira mode, missing project → fail (team not required for jira)", async () => {
    const body = ["## Task Tracking", "", "mode: jira", "", "### Jira", ""].join("\n");
    const ctx = makeProject(body);
    try {
      const report = await runTaskTrackingWorkspaceBindingPresentProbe(ctx.root);
      expect(report.violations.length).toBe(1);
      expect(report.violations[0]!.note).toMatch(/project/);
    } finally {
      ctx.cleanup();
    }
  });

  test("Jira mode, sub-section absent → fail", async () => {
    const body = ["## Task Tracking", "", "mode: jira"].join("\n");
    const ctx = makeProject(body);
    try {
      const report = await runTaskTrackingWorkspaceBindingPresentProbe(ctx.root);
      expect(report.violations.length).toBe(1);
      expect(report.violations[0]!.note).toMatch(/### Jira/);
    } finally {
      ctx.cleanup();
    }
  });
});
