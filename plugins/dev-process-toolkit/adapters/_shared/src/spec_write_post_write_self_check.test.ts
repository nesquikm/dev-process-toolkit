// Shared post-write self-check tests for /spec-write — STE-121 + STE-122.
//
// STE-121 AC-STE-121.3: hand-rolled FR YAML carrying `id:` in tracker mode
// must be refused with NFR-10 canonical shape; helper output passes clean.
//
// STE-122 AC-STE-122.3 / AC-STE-122.4: literal `AC-<digit>.<N>` placeholders
// must be refused; fenced / inline-backtick / 4-space-indent forms exempt.

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildFRFrontmatter,
  FRFrontmatterShapeError,
  runFrontmatterShapeCheck,
} from "./fr_frontmatter";
import { scanGuessedTrackerIdLiterals } from "./guessed_tracker_id_scan";

function makeProject(opts: {
  mode: "linear" | "none";
  frFiles: Record<string, string>;
}): { root: string; frPaths: Record<string, string>; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "spec-write-post-write-"));
  const claudeMd =
    opts.mode === "linear"
      ? `# Project\n\n## Task Tracking\n\nmode: linear\n\n### Linear\n\nteam: STE\nproject: DPT\n`
      : `# Project\n`;
  writeFileSync(join(root, "CLAUDE.md"), claudeMd);
  const frsDir = join(root, "specs", "frs");
  mkdirSync(frsDir, { recursive: true });
  const frPaths: Record<string, string> = {};
  for (const [name, content] of Object.entries(opts.frFiles)) {
    const p = join(frsDir, name);
    writeFileSync(p, content);
    frPaths[name] = p;
  }
  return { root, frPaths, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

describe("STE-121 post-write self-check (AC-STE-121.3)", () => {
  test("hand-rolled YAML with id: in tracker mode refuses with FRFrontmatterShapeError", async () => {
    const handRolled = [
      "---",
      "title: Bad FR",
      "milestone: M99",
      "status: active",
      "archived_at: null",
      "id: STE-999", // forbidden in tracker mode
      "tracker:",
      "  linear: STE-999",
      "created_at: 2026-04-27T00:00:00Z",
      "---",
      "",
      "## Requirement",
      "",
    ].join("\n");
    const ctx = makeProject({ mode: "linear", frFiles: { "STE-999.md": handRolled } });
    try {
      await expect(
        runFrontmatterShapeCheck(ctx.root, ctx.frPaths["STE-999.md"]!),
      ).rejects.toThrow(FRFrontmatterShapeError);
    } finally {
      ctx.cleanup();
    }
  });

  test("FRFrontmatterShapeError carries NFR-10 canonical shape (verdict + remedy + context)", async () => {
    const handRolled = [
      "---",
      "title: Bad FR",
      "milestone: M99",
      "status: active",
      "archived_at: null",
      "id: STE-999",
      "tracker:",
      "  linear: STE-999",
      "created_at: 2026-04-27T00:00:00Z",
      "---",
      "",
    ].join("\n");
    const ctx = makeProject({ mode: "linear", frFiles: { "STE-999.md": handRolled } });
    try {
      let caught: Error | null = null;
      try {
        await runFrontmatterShapeCheck(ctx.root, ctx.frPaths["STE-999.md"]!);
      } catch (e) {
        caught = e as Error;
      }
      expect(caught).toBeInstanceOf(FRFrontmatterShapeError);
      expect(caught!.message).toMatch(/identity_mode_conditional/);
      expect(caught!.message).toMatch(/Remedy:.*buildFRFrontmatter/);
      expect(caught!.message).toMatch(/Context:/);
      expect(caught!.message).toMatch(/STE-999\.md/);
    } finally {
      ctx.cleanup();
    }
  });

  test("helper output (canonical) passes clean — no refusal", async () => {
    const helperOutput = buildFRFrontmatter(
      { title: "Good FR", milestone: "M99", createdAt: "2026-04-27T00:00:00Z" },
      { key: "linear", id: "STE-1000" },
    );
    const body = `${helperOutput}\n## Requirement\n`;
    const ctx = makeProject({ mode: "linear", frFiles: { "STE-1000.md": body } });
    try {
      await runFrontmatterShapeCheck(ctx.root, ctx.frPaths["STE-1000.md"]!);
      // No throw → pass.
    } finally {
      ctx.cleanup();
    }
  });

  test("violations on OTHER FR files do not affect the check on the target file", async () => {
    // Only flag the file we just wrote, not pre-existing dirty files.
    const goodHelper = buildFRFrontmatter(
      { title: "Good FR", milestone: "M99", createdAt: "2026-04-27T00:00:00Z" },
      { key: "linear", id: "STE-1001" },
    );
    const badOther = [
      "---",
      "title: Pre-existing bad",
      "milestone: M98",
      "status: active",
      "archived_at: null",
      "id: STE-998",
      "tracker:",
      "  linear: STE-998",
      "created_at: 2026-04-27T00:00:00Z",
      "---",
      "",
    ].join("\n");
    const ctx = makeProject({
      mode: "linear",
      frFiles: { "STE-1001.md": goodHelper, "STE-998.md": badOther },
    });
    try {
      // Check only on the target — should not raise even though another file is dirty.
      await runFrontmatterShapeCheck(ctx.root, ctx.frPaths["STE-1001.md"]!);
    } finally {
      ctx.cleanup();
    }
  });

  test("mode-none missing id refuses on the target file", async () => {
    const handRolled = [
      "---",
      "title: Bad FR",
      "milestone: M99",
      "status: active",
      "archived_at: null",
      // missing id: line
      "created_at: 2026-04-27T00:00:00Z",
      "---",
      "",
    ].join("\n");
    const ctx = makeProject({ mode: "none", frFiles: { "VDTAF4.md": handRolled } });
    try {
      await expect(
        runFrontmatterShapeCheck(ctx.root, ctx.frPaths["VDTAF4.md"]!),
      ).rejects.toThrow(FRFrontmatterShapeError);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("STE-122 post-write self-check (AC-STE-122.3)", () => {
  test("hand-rolled FR with literal AC-1.1 surfaces violation", () => {
    const ctx = makeProject({ mode: "linear", frFiles: {} });
    try {
      const path = join(ctx.root, "specs", "frs", "STE-1.md");
      writeFileSync(
        path,
        [
          "## Acceptance Criteria",
          "",
          "- AC-1.1: System must validate input.",
          "- AC-1.2: Errors are surfaced.",
          "",
        ].join("\n"),
      );
      const violations = scanGuessedTrackerIdLiterals([path]);
      expect(violations.length).toBe(2);
      expect(violations[0]!.match).toBe("AC-1.1");
      expect(violations[1]!.match).toBe("AC-1.2");
      expect(violations[0]!.message).toMatch(/guessed_tracker_id/);
      expect(violations[0]!.message).toMatch(/acPrefix/);
    } finally {
      ctx.cleanup();
    }
  });

  test("helper-rendered tracker-mode AC-prefix passes clean", () => {
    const ctx = makeProject({ mode: "linear", frFiles: {} });
    try {
      const path = join(ctx.root, "specs", "frs", "STE-1.md");
      writeFileSync(
        path,
        [
          "## Acceptance Criteria",
          "",
          "- AC-STE-1.1: System must validate input.",
          "- AC-STE-1.2: Errors are surfaced.",
          "",
        ].join("\n"),
      );
      const violations = scanGuessedTrackerIdLiterals([path]);
      expect(violations).toEqual([]);
    } finally {
      ctx.cleanup();
    }
  });
});
