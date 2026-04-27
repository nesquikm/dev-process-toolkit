import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runRequirementsMdNoPlaceholderProbe } from "../adapters/_shared/src/requirements_md_no_placeholder";

// STE-129 AC-STE-129.4 — `requirements-md-no-placeholder` probe (warning).
//
// Scans `specs/requirements.md` for the literal placeholder strings
// `<tracker-id>` (outside fenced/inline-backtick spans) and `[Feature Name]`,
// and the legacy `### FR-N: [Feature Name] {#FR-N}` heading shape. Each
// surviving placeholder → one note in `file:line — reason` shape. Severity:
// warning (NotesOnly).
//
// Five fixtures:
//   (a) clean requirements.md → no notes
//   (b) hand-edited requirements.md with `FR-1: [Feature Name]` → note
//   (c) `<tracker-id>` placeholder literal in a heading → note
//   (d) backticked `<tracker-id>` in prose → exempt (fenced)
//   (e) specs/ absent → vacuous pass

const pluginRoot = join(import.meta.dir, "..");

function makeProject(files: Record<string, string>): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "req-md-placeholder-"));
  for (const [path, content] of Object.entries(files)) {
    const dir = join(root, path.split("/").slice(0, -1).join("/"));
    if (dir !== root) mkdirSync(dir, { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

describe("AC-STE-129.4(a) clean requirements.md → no notes", () => {
  test("post-M33 template body has no placeholders", async () => {
    const ctx = makeProject({
      "specs/requirements.md": [
        "<!-- scope: cross-cutting only -->",
        "",
        "# Requirements",
        "",
        "## 1. Overview",
        "",
        "This project handles X.",
        "",
        "## 2. Functional Requirements (cross-cutting)",
        "",
        "Per-FR detail lives in `specs/frs/`. This section captures cross-cutting concerns only.",
        "",
        "## 3. Non-Functional Requirements",
        "",
        "### NFR-1: Performance",
        "",
      ].join("\n"),
    });
    try {
      const report = await runRequirementsMdNoPlaceholderProbe(ctx.root);
      expect(report.violations).toEqual([]);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-129.4(b) hand-edited FR-1 placeholder → note", () => {
  test("violation flags the legacy FR-1: [Feature Name] heading", async () => {
    const ctx = makeProject({
      "specs/requirements.md": [
        "# Requirements",
        "",
        "## 2. Functional Requirements",
        "",
        "### FR-1: [Feature Name] {#FR-1}",
        "",
        "**Description:** <!-- What this feature does -->",
        "",
      ].join("\n"),
    });
    try {
      const report = await runRequirementsMdNoPlaceholderProbe(ctx.root);
      expect(report.violations.length).toBeGreaterThanOrEqual(1);
      const fr1 = report.violations.find((v) => v.note.includes("FR-1"));
      expect(fr1).toBeDefined();
      expect(fr1!.severity).toBe("warning");
      expect(fr1!.message).toMatch(/Remedy:/);
      expect(fr1!.note).toMatch(/specs\/requirements\.md:\d+/);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-129.4(c) literal <tracker-id> in heading → note", () => {
  test("hand-edited heading carrying <tracker-id> literal flagged", async () => {
    const ctx = makeProject({
      "specs/requirements.md": [
        "# Requirements",
        "",
        "## 2. Functional Requirements",
        "",
        "### <tracker-id>: New feature {#<tracker-id>}",
        "",
      ].join("\n"),
    });
    try {
      const report = await runRequirementsMdNoPlaceholderProbe(ctx.root);
      expect(report.violations.length).toBeGreaterThanOrEqual(1);
      const v = report.violations[0]!;
      expect(v.note).toMatch(/<tracker-id>|tracker-id/);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-129.4(d) backticked <tracker-id> in prose → exempt", () => {
  test("inline-backtick reference treated as documentation, not a placeholder", async () => {
    const ctx = makeProject({
      "specs/requirements.md": [
        "# Requirements",
        "",
        "Use the literal placeholder `<tracker-id>` in drafts until the allocator returns the real ID.",
        "",
        "<!-- comment block can also reference <tracker-id> as a documentation example -->",
        "",
      ].join("\n"),
    });
    try {
      const report = await runRequirementsMdNoPlaceholderProbe(ctx.root);
      // Comments are also exempt (operator-facing prose, not active content).
      expect(report.violations).toEqual([]);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-129.4 — fenced code-block content is exempt", () => {
  test("placeholders inside a ```...``` block do NOT trigger violations", async () => {
    const ctx = makeProject({
      "specs/requirements.md": [
        "# Requirements",
        "",
        "Reference example:",
        "",
        "```markdown",
        "### FR-1: [Feature Name] {#FR-1}",
        "- AC-<tracker-id>.1: ...",
        "```",
        "",
        "End of doc.",
        "",
      ].join("\n"),
    });
    try {
      const report = await runRequirementsMdNoPlaceholderProbe(ctx.root);
      expect(report.violations).toEqual([]);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-129.4(e) specs/ absent → vacuous pass", () => {
  test("project without specs/ → no violations", async () => {
    const ctx = makeProject({});
    try {
      const report = await runRequirementsMdNoPlaceholderProbe(ctx.root);
      expect(report.violations).toEqual([]);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-129.4 — gate-check SKILL.md prose declares the probe", () => {
  test("SKILL.md references probe `requirements-md-no-placeholder`", () => {
    const skill = readFileSync(
      join(pluginRoot, "skills", "gate-check", "SKILL.md"),
      "utf-8",
    );
    expect(skill).toMatch(/requirements-md-no-placeholder/);
  });
});

describe("AC-STE-129.4 — runs green on this repo's baseline", () => {
  test("the live repo's requirements.md has no surviving placeholders", async () => {
    const repoRoot = join(pluginRoot, "..", "..");
    const report = await runRequirementsMdNoPlaceholderProbe(repoRoot);
    expect(report.violations).toEqual([]);
  });
});
