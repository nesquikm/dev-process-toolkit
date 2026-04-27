import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanupPlanVerifyLines } from "../adapters/_shared/src/spec_archive/cleanup_plan_verify_lines";

// STE-126 AC-STE-126.1 — cleanupPlanVerifyLines(specsDir, deletedFiles, addedTestFiles?)
//
// When /implement Phase 4 deletes file P, scan active plan files
// (`specs/plan/M*.md`, excluding `archive/`) for `verify:` lines that
// reference P, then either:
//   (a) rewrite the verify line to reference the replacement test file
//       when the deleted file is `*.placeholder.test.ts` AND a single
//       new `*.test.ts` was added in the same diff, OR
//   (b) mark the parent task `[x]` and drop the verify line entirely
//       when no replacement is detected.
//
// Idempotent: re-running with no matches is a no-op (`filesChanged: []`).

function makeProject(files: Record<string, string>): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "cleanup-verify-"));
  for (const [path, content] of Object.entries(files)) {
    const dir = join(root, path.split("/").slice(0, -1).join("/"));
    if (dir !== root) mkdirSync(dir, { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

describe("AC-STE-126.1(a) — deleted-with-replacement → verify line rewritten", () => {
  test("placeholder.test.ts deleted, single new src/foo.test.ts → verify line rewritten", () => {
    const ctx = makeProject({
      "specs/plan/M1.md": [
        "# Plan",
        "",
        "- [ ] Add foundation test",
        "  verify: head -1 tests/.placeholder.test.ts shows the marker",
        "",
      ].join("\n"),
    });
    try {
      const result = cleanupPlanVerifyLines(
        ctx.root,
        ["tests/.placeholder.test.ts"],
        ["src/foo.test.ts"],
      );
      expect(result.filesChanged).toContain("specs/plan/M1.md");
      expect(result.linesUpdated).toBe(1);
      const after = readFileSync(join(ctx.root, "specs/plan/M1.md"), "utf-8");
      expect(after).not.toContain("tests/.placeholder.test.ts");
      expect(after).toContain("src/foo.test.ts");
      // The parent task remains unchecked since the work is now real-test verified.
      expect(after).toContain("- [ ] Add foundation test");
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-126.1(b) — deleted-no-replacement → mark [x] + drop verify line", () => {
  test("file deleted with no test replacement → task marked done, verify dropped", () => {
    const ctx = makeProject({
      "specs/plan/M2.md": [
        "# Plan",
        "",
        "- [ ] Remove obsolete helper",
        "  verify: test ! -f src/legacy.ts",
        "",
      ].join("\n"),
    });
    try {
      const result = cleanupPlanVerifyLines(ctx.root, ["src/legacy.ts"], []);
      expect(result.filesChanged).toContain("specs/plan/M2.md");
      expect(result.linesUpdated).toBe(1);
      const after = readFileSync(join(ctx.root, "specs/plan/M2.md"), "utf-8");
      expect(after).toContain("- [x] Remove obsolete helper");
      expect(after).not.toContain("verify: test ! -f src/legacy.ts");
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-126.1 — verify line references untouched file → no change", () => {
  test("plan file not modified when its verify line points at a kept file", () => {
    const ctx = makeProject({
      "specs/plan/M3.md": [
        "- [ ] Run typecheck",
        "  verify: bunx tsc --noEmit",
        "",
      ].join("\n"),
    });
    try {
      const before = readFileSync(join(ctx.root, "specs/plan/M3.md"), "utf-8");
      const result = cleanupPlanVerifyLines(
        ctx.root,
        ["src/some-other-file.ts"],
        [],
      );
      expect(result.filesChanged).toEqual([]);
      expect(result.linesUpdated).toBe(0);
      const after = readFileSync(join(ctx.root, "specs/plan/M3.md"), "utf-8");
      expect(after).toBe(before);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-126.1 — archive/ plan files are NOT scanned (frozen invariant)", () => {
  test("plan/archive/M1.md verify lines untouched even when deletedFile matches", () => {
    const ctx = makeProject({
      "specs/plan/archive/M0.md": [
        "- [ ] Done long ago",
        "  verify: head -1 tests/.placeholder.test.ts shows the marker",
        "",
      ].join("\n"),
    });
    try {
      const before = readFileSync(join(ctx.root, "specs/plan/archive/M0.md"), "utf-8");
      const result = cleanupPlanVerifyLines(
        ctx.root,
        ["tests/.placeholder.test.ts"],
        ["src/new.test.ts"],
      );
      expect(result.filesChanged).toEqual([]);
      const after = readFileSync(join(ctx.root, "specs/plan/archive/M0.md"), "utf-8");
      expect(after).toBe(before);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-126.1 — multi-replacement diff → fall back to mark-done path", () => {
  test("placeholder deleted but TWO new test files added → cannot pick replacement, mark [x]", () => {
    const ctx = makeProject({
      "specs/plan/M4.md": [
        "- [ ] Foundation tests",
        "  verify: head -1 tests/.placeholder.test.ts shows the marker",
        "",
      ].join("\n"),
    });
    try {
      const result = cleanupPlanVerifyLines(
        ctx.root,
        ["tests/.placeholder.test.ts"],
        ["src/foo.test.ts", "src/bar.test.ts"],
      );
      const after = readFileSync(join(ctx.root, "specs/plan/M4.md"), "utf-8");
      expect(after).toContain("- [x] Foundation tests");
      expect(after).not.toContain(".placeholder.test.ts");
      expect(result.filesChanged).toContain("specs/plan/M4.md");
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-126.1 — idempotent: empty deletedFiles → no work", () => {
  test("empty deletion list yields zero filesChanged", () => {
    const ctx = makeProject({
      "specs/plan/M1.md": "- [ ] foo\n  verify: head src/foo.ts\n",
    });
    try {
      const result = cleanupPlanVerifyLines(ctx.root, [], []);
      expect(result.filesChanged).toEqual([]);
      expect(result.linesUpdated).toBe(0);
    } finally {
      ctx.cleanup();
    }
  });
});
