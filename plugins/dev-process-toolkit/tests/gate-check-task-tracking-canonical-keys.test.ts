import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTaskTrackingCanonicalKeysProbe } from "../adapters/_shared/src/task_tracking_canonical_keys";

// STE-114 AC-STE-114.3 / AC-STE-114.4 — `task-tracking-canonical-keys` probe.
//
// Closed set: {mode, mcp_server, jira_ac_field, branch_template}.
// Top-level keys outside this set fail. `### <Subsection>` contents are
// scoped out. Empty/whitespace lines and comments ignored.
//
// Five fixtures (per AC-STE-114.4):
//   (a) canonical-only keys → pass
//   (b) extra keys at top level → fail naming offenders
//   (c) extra keys under ### Linear subsection → pass (subsection scoping)
//   (d) mode: none (section absent) → vacuous pass
//   (e) malformed Schema L (no `:` separator on a non-blank line) → fail

const pluginRoot = join(import.meta.dir, "..");

function makeProject(claudeMd: string | null): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "task-tracking-canonical-"));
  if (claudeMd !== null) writeFileSync(join(root, "CLAUDE.md"), claudeMd);
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

describe("AC-STE-114.4(a) canonical-only keys → pass", () => {
  test("the four canonical keys + nothing else → no violations", async () => {
    const body = `# Project\n\n## Task Tracking\n\nmode: linear\nmcp_server: linear\njira_ac_field:\nbranch_template: feat/{ticket-id}-{slug}\n`;
    const ctx = makeProject(body);
    try {
      const report = await runTaskTrackingCanonicalKeysProbe(ctx.root);
      expect(report.violations).toEqual([]);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-114.4(b) extra keys at top level → fail", () => {
  test("non-canonical keys named in violation note", async () => {
    const body = [
      "# Project",
      "",
      "## Task Tracking",
      "",
      "mode: linear",
      "mcp_server: linear",
      "linear_team_id: foo",
      "linear_project_id: bar",
      "branch_template: feat/{ticket-id}",
      "",
    ].join("\n");
    const ctx = makeProject(body);
    try {
      const report = await runTaskTrackingCanonicalKeysProbe(ctx.root);
      expect(report.violations.length).toBeGreaterThanOrEqual(1);
      const note = report.violations[0]!.note;
      expect(note).toMatch(/linear_team_id/);
      expect(note).toMatch(/linear_project_id/);
      expect(report.violations[0]!.message).toMatch(/Remedy:/);
      expect(report.violations[0]!.message).toMatch(/Context:/);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-114.4(c) extra keys under ### Linear → pass (subsection scoping)", () => {
  test("non-canonical keys under a subsection do not flag", async () => {
    const body = [
      "# Project",
      "",
      "## Task Tracking",
      "",
      "mode: linear",
      "mcp_server: linear",
      "branch_template: feat/{ticket-id}",
      "",
      "### Linear",
      "",
      "linear_team_id: foo",
      "linear_project_id: bar",
      "",
    ].join("\n");
    const ctx = makeProject(body);
    try {
      const report = await runTaskTrackingCanonicalKeysProbe(ctx.root);
      expect(report.violations).toEqual([]);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-114.4(d) mode: none / section absent → vacuous pass", () => {
  test("CLAUDE.md without ## Task Tracking → no violations", async () => {
    const body = `# Project\n\n## Tech Stack\n\n- TypeScript\n`;
    const ctx = makeProject(body);
    try {
      const report = await runTaskTrackingCanonicalKeysProbe(ctx.root);
      expect(report.violations).toEqual([]);
    } finally {
      ctx.cleanup();
    }
  });

  test("CLAUDE.md absent entirely → vacuous pass", async () => {
    const ctx = makeProject(null);
    try {
      const report = await runTaskTrackingCanonicalKeysProbe(ctx.root);
      expect(report.violations).toEqual([]);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-114.4(e) malformed Schema L (no `:`) → fail", () => {
  test("non-blank line with no `:` flags a parse-error violation", async () => {
    const body = [
      "# Project",
      "",
      "## Task Tracking",
      "",
      "mode: linear",
      "this line is malformed because there is no colon",
      "branch_template: feat/{ticket-id}",
      "",
    ].join("\n");
    const ctx = makeProject(body);
    try {
      const report = await runTaskTrackingCanonicalKeysProbe(ctx.root);
      expect(report.violations.length).toBeGreaterThanOrEqual(1);
      expect(
        report.violations.some((v) => /malformed|parse/i.test(v.note)),
      ).toBe(true);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-114.3 — gate-check SKILL.md prose declares the probe", () => {
  const gateCheckSkill = readFileSync(
    join(pluginRoot, "skills", "gate-check", "SKILL.md"),
    "utf-8",
  );
  test("SKILL.md references probe `task-tracking-canonical-keys`", () => {
    expect(gateCheckSkill).toMatch(/task-tracking-canonical-keys/);
  });
});

describe("AC-STE-114 — repo's own CLAUDE.md passes the probe", () => {
  test("the live repo's CLAUDE.md only carries canonical keys", async () => {
    const repoRoot = join(pluginRoot, "..", "..");
    const report = await runTaskTrackingCanonicalKeysProbe(repoRoot);
    expect(report.violations).toEqual([]);
  });
});
