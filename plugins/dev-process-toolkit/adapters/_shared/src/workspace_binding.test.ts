// STE-117 AC-STE-117.6 — readWorkspaceBinding helper.
//
// Reads `### Linear` / `### Jira` sub-sections under `## Task Tracking` in
// CLAUDE.md. Returns `{}` when the section is absent (mode-none equivalent),
// the requested adapter sub-section is absent, or the binding is empty.
//
// Parser rules per AC-STE-117.1:
//   - sub-section starts at `### <Adapter>` heading and ends at the next
//     `##`/`###` heading or EOF (greedy);
//   - keys are `key: value` (same shape as Schema L top-level);
//   - `default_labels:` is an inline YAML array `[a, b]` parsed into
//     string[];
//   - whitespace lines + comments tolerated.

import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readWorkspaceBinding } from "./workspace_binding";

function makeProject(claudeMd: string | null): { path: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "workspace-binding-"));
  const path = join(root, "CLAUDE.md");
  if (claudeMd !== null) writeFileSync(path, claudeMd);
  return { path, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

describe("readWorkspaceBinding — happy path", () => {
  test("Linear sub-section: team + project parsed", () => {
    const body = [
      "# Project",
      "",
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
      expect(readWorkspaceBinding(ctx.path, "linear")).toEqual({
        team: "STE",
        project: "DPT — Dev Process Toolkit",
      });
    } finally {
      ctx.cleanup();
    }
  });

  test("Jira sub-section: project parsed", () => {
    const body = [
      "## Task Tracking",
      "",
      "mode: jira",
      "",
      "### Jira",
      "",
      "project: ENG",
      "",
    ].join("\n");
    const ctx = makeProject(body);
    try {
      expect(readWorkspaceBinding(ctx.path, "jira")).toEqual({ project: "ENG" });
    } finally {
      ctx.cleanup();
    }
  });

  test("default_labels parsed as YAML array", () => {
    const body = [
      "## Task Tracking",
      "",
      "mode: linear",
      "",
      "### Linear",
      "team: STE",
      "project: DPT",
      "default_labels: [feature, m31]",
      "",
    ].join("\n");
    const ctx = makeProject(body);
    try {
      expect(readWorkspaceBinding(ctx.path, "linear")).toEqual({
        team: "STE",
        project: "DPT",
        defaultLabels: ["feature", "m31"],
      });
    } finally {
      ctx.cleanup();
    }
  });

  test("default_labels: [] → empty array", () => {
    const body = [
      "## Task Tracking",
      "",
      "mode: linear",
      "",
      "### Linear",
      "team: STE",
      "project: DPT",
      "default_labels: []",
    ].join("\n");
    const ctx = makeProject(body);
    try {
      expect(readWorkspaceBinding(ctx.path, "linear")).toEqual({
        team: "STE",
        project: "DPT",
        defaultLabels: [],
      });
    } finally {
      ctx.cleanup();
    }
  });
});

describe("readWorkspaceBinding — vacuity / missing", () => {
  test("CLAUDE.md does not exist → {}", () => {
    expect(readWorkspaceBinding("/nonexistent/path/CLAUDE.md", "linear")).toEqual({});
  });

  test("section absent (mode-none canonical form) → {}", () => {
    const ctx = makeProject("# Project\n\nNo task tracking here.\n");
    try {
      expect(readWorkspaceBinding(ctx.path, "linear")).toEqual({});
    } finally {
      ctx.cleanup();
    }
  });

  test("requested sub-section absent → {}", () => {
    const body = [
      "## Task Tracking",
      "",
      "mode: linear",
      "",
      "### Linear",
      "team: STE",
      "project: DPT",
    ].join("\n");
    const ctx = makeProject(body);
    try {
      expect(readWorkspaceBinding(ctx.path, "jira")).toEqual({});
    } finally {
      ctx.cleanup();
    }
  });

  test("sub-section present but empty → {}", () => {
    const body = [
      "## Task Tracking",
      "",
      "mode: linear",
      "",
      "### Linear",
      "",
      "## Next Section",
    ].join("\n");
    const ctx = makeProject(body);
    try {
      expect(readWorkspaceBinding(ctx.path, "linear")).toEqual({});
    } finally {
      ctx.cleanup();
    }
  });
});

describe("readWorkspaceBinding — boundary parsing", () => {
  test("sub-section ends at next ## heading", () => {
    const body = [
      "## Task Tracking",
      "",
      "mode: linear",
      "",
      "### Linear",
      "team: STE",
      "project: DPT",
      "",
      "## Other Section",
      "",
      "team: SHOULDNT_LEAK",
    ].join("\n");
    const ctx = makeProject(body);
    try {
      expect(readWorkspaceBinding(ctx.path, "linear")).toEqual({
        team: "STE",
        project: "DPT",
      });
    } finally {
      ctx.cleanup();
    }
  });

  test("sub-section ends at next ### heading (sibling sub-section)", () => {
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
      expect(readWorkspaceBinding(ctx.path, "linear")).toEqual({
        team: "STE",
        project: "DPT",
      });
      expect(readWorkspaceBinding(ctx.path, "jira")).toEqual({ project: "ENG" });
    } finally {
      ctx.cleanup();
    }
  });

  test("multi-adapter co-presence", () => {
    const body = [
      "## Task Tracking",
      "",
      "mode: linear",
      "",
      "### Linear",
      "team: STE",
      "project: DPT — Dev Process Toolkit",
      "",
      "### Jira",
      "project: ENG",
      "default_labels: [legacy]",
    ].join("\n");
    const ctx = makeProject(body);
    try {
      expect(readWorkspaceBinding(ctx.path, "linear")).toEqual({
        team: "STE",
        project: "DPT — Dev Process Toolkit",
      });
      expect(readWorkspaceBinding(ctx.path, "jira")).toEqual({
        project: "ENG",
        defaultLabels: ["legacy"],
      });
    } finally {
      ctx.cleanup();
    }
  });

  test("em-dash project name passed through opaque (no normalization)", () => {
    const body = [
      "## Task Tracking",
      "",
      "mode: linear",
      "",
      "### Linear",
      "team: STE",
      "project: DPT — Dev Process Toolkit",
    ].join("\n");
    const ctx = makeProject(body);
    try {
      const got = readWorkspaceBinding(ctx.path, "linear");
      expect(got.project).toBe("DPT — Dev Process Toolkit");
      // U+2014 (em-dash) is preserved byte-for-byte
      expect(got.project!.charCodeAt(4)).toBe(0x2014);
    } finally {
      ctx.cleanup();
    }
  });

  test("byte-stable across re-reads (idempotent)", () => {
    const body = [
      "## Task Tracking",
      "",
      "mode: linear",
      "",
      "### Linear",
      "team: STE",
      "project: DPT",
      "default_labels: [a, b]",
    ].join("\n");
    const ctx = makeProject(body);
    try {
      const a = readWorkspaceBinding(ctx.path, "linear");
      const b = readWorkspaceBinding(ctx.path, "linear");
      expect(a).toEqual(b);
    } finally {
      ctx.cleanup();
    }
  });

  test("empty-string value is treated as missing", () => {
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
      // empty value is omitted (caller gates on absence — probe #25 will fail)
      expect(readWorkspaceBinding(ctx.path, "linear")).toEqual({ project: "DPT" });
    } finally {
      ctx.cleanup();
    }
  });

  test("whitespace-only value is treated as missing", () => {
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
      expect(readWorkspaceBinding(ctx.path, "linear")).toEqual({ project: "DPT" });
    } finally {
      ctx.cleanup();
    }
  });

  test("trims surrounding whitespace from values", () => {
    const body = [
      "## Task Tracking",
      "",
      "mode: linear",
      "",
      "### Linear",
      "team:   STE   ",
      "project:  DPT — Dev Process Toolkit  ",
    ].join("\n");
    const ctx = makeProject(body);
    try {
      expect(readWorkspaceBinding(ctx.path, "linear")).toEqual({
        team: "STE",
        project: "DPT — Dev Process Toolkit",
      });
    } finally {
      ctx.cleanup();
    }
  });
});
