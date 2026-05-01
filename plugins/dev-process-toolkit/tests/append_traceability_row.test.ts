import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendTraceabilityRow } from "../adapters/_shared/src/spec_archive/append_traceability_row";

// STE-171 AC-STE-171.1 — appendTraceabilityRow(repoRoot, frId, acNumbers, implFiles, testFiles)
//
// Phase 4 § Milestone Archival calls this helper per archived FR. It appends
// one row of shape `| AC-<frId>.<lo>..<hi> | <impl-files> | <test-files> |`
// to `specs/requirements.md` § 6 Traceability Matrix. Idempotent on re-run:
// an already-present row matching the FR's AC prefix is detected and not
// duplicated. Missing § 6 or missing requirements.md ⇒ silent no-op.

function makeProject(files: Record<string, string>): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "trace-row-"));
  for (const [path, content] of Object.entries(files)) {
    const dir = join(root, path.split("/").slice(0, -1).join("/"));
    if (dir !== root) mkdirSync(dir, { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

const headerOnlyMatrix = [
  "# Requirements",
  "",
  "## 6. Traceability Matrix",
  "",
  "| Requirement | Implementation | Tests |",
  "|-------------|---------------|-------|",
  "| *(see individual FR files under specs/frs/ for per-FR traceability)* | | |",
  "",
].join("\n");

describe("AC-STE-171.1 — appendTraceabilityRow appends a row per FR", () => {
  test("appends one row of canonical shape with contiguous AC range", () => {
    const ctx = makeProject({ "specs/requirements.md": headerOnlyMatrix });
    try {
      const result = appendTraceabilityRow(
        ctx.root,
        "STE-171",
        [1, 2, 3, 4, 5],
        ["plugins/dev-process-toolkit/skills/implement/SKILL.md"],
        ["plugins/dev-process-toolkit/tests/append_traceability_row.test.ts"],
      );
      expect(result.added).toBe(true);
      const after = readFileSync(join(ctx.root, "specs/requirements.md"), "utf-8");
      // Single contiguous range collapses to `1..5`.
      expect(after).toContain("AC-STE-171.1..5");
      expect(after).toContain("plugins/dev-process-toolkit/skills/implement/SKILL.md");
      expect(after).toContain("plugins/dev-process-toolkit/tests/append_traceability_row.test.ts");
      // Row must follow pipe-table format, not arrow shorthand.
      expect(after).toMatch(/\|\s*AC-STE-171\.1\.\.5\s*\|/);
    } finally {
      ctx.cleanup();
    }
  });

  test("single AC number renders without `..` range", () => {
    const ctx = makeProject({ "specs/requirements.md": headerOnlyMatrix });
    try {
      const result = appendTraceabilityRow(
        ctx.root,
        "STE-200",
        [1],
        ["plugins/dev-process-toolkit/skills/foo/SKILL.md"],
        ["plugins/dev-process-toolkit/tests/foo.test.ts"],
      );
      expect(result.added).toBe(true);
      const after = readFileSync(join(ctx.root, "specs/requirements.md"), "utf-8");
      expect(after).toMatch(/\|\s*AC-STE-200\.1\s*\|/);
      expect(after).not.toContain("AC-STE-200.1..1");
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-171.1 — idempotent on re-run (no duplicate rows)", () => {
  test("second invocation with same frId is a no-op", () => {
    const ctx = makeProject({ "specs/requirements.md": headerOnlyMatrix });
    try {
      const first = appendTraceabilityRow(
        ctx.root,
        "STE-171",
        [1, 2],
        ["impl.ts"],
        ["tests/impl.test.ts"],
      );
      expect(first.added).toBe(true);
      const second = appendTraceabilityRow(
        ctx.root,
        "STE-171",
        [1, 2],
        ["impl.ts"],
        ["tests/impl.test.ts"],
      );
      expect(second.added).toBe(false);
      const after = readFileSync(join(ctx.root, "specs/requirements.md"), "utf-8");
      // Only one row mentioning STE-171.
      const matches = after.match(/AC-STE-171\.[0-9]/g) ?? [];
      expect(matches.length).toBe(1);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-171.1 — graceful no-op on missing § 6 or missing requirements.md", () => {
  test("missing requirements.md → no-op, no throw", () => {
    const ctx = makeProject({});
    try {
      const result = appendTraceabilityRow(ctx.root, "STE-171", [1], ["a"], ["b"]);
      expect(result.added).toBe(false);
    } finally {
      ctx.cleanup();
    }
  });

  test("requirements.md without § 6 → no-op, file unchanged", () => {
    const before = "# Requirements\n\n## 1. Overview\n\nNo matrix here.\n";
    const ctx = makeProject({ "specs/requirements.md": before });
    try {
      const result = appendTraceabilityRow(ctx.root, "STE-171", [1], ["a"], ["b"]);
      expect(result.added).toBe(false);
      const after = readFileSync(join(ctx.root, "specs/requirements.md"), "utf-8");
      expect(after).toBe(before);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-171.1 — non-contiguous AC numbers fall back to comma list", () => {
  test("acNumbers [1,3,5] renders as comma-separated AC-STE-X.1, AC-STE-X.3, AC-STE-X.5", () => {
    const ctx = makeProject({ "specs/requirements.md": headerOnlyMatrix });
    try {
      const result = appendTraceabilityRow(
        ctx.root,
        "STE-300",
        [1, 3, 5],
        ["a.ts"],
        ["a.test.ts"],
      );
      expect(result.added).toBe(true);
      const after = readFileSync(join(ctx.root, "specs/requirements.md"), "utf-8");
      expect(after).toContain("AC-STE-300.1");
      expect(after).toContain("AC-STE-300.3");
      expect(after).toContain("AC-STE-300.5");
      expect(after).not.toContain("AC-STE-300.1..5");
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-171.1 — multiple impl/test files render comma-separated", () => {
  test("two impl files + two test files appear as comma-separated lists in row", () => {
    const ctx = makeProject({ "specs/requirements.md": headerOnlyMatrix });
    try {
      appendTraceabilityRow(
        ctx.root,
        "STE-171",
        [1],
        ["impl/a.ts", "impl/b.ts"],
        ["tests/a.test.ts", "tests/b.test.ts"],
      );
      const after = readFileSync(join(ctx.root, "specs/requirements.md"), "utf-8");
      expect(after).toContain("impl/a.ts, impl/b.ts");
      expect(after).toContain("tests/a.test.ts, tests/b.test.ts");
    } finally {
      ctx.cleanup();
    }
  });
});

// STE-171 — Stage C hardening: edge cases for append_traceability_row.
// These pin defensive behavior so future refactors don't silently regress.

describe("AC-STE-171.1 — Stage C hardening: empty file lists + degenerate inputs", () => {
  test("empty implFiles AND testFiles render the em-dash placeholder, not blank pipes", () => {
    const ctx = makeProject({ "specs/requirements.md": headerOnlyMatrix });
    try {
      const result = appendTraceabilityRow(ctx.root, "STE-401", [1, 2], [], []);
      expect(result.added).toBe(true);
      const after = readFileSync(join(ctx.root, "specs/requirements.md"), "utf-8");
      // Both empty lists → em-dash sentinels per the helper contract.
      expect(after).toMatch(/\|\s*AC-STE-401\.1\.\.2\s*\|\s*—\s*\|\s*—\s*\|/);
    } finally {
      ctx.cleanup();
    }
  });

  test("empty acNumbers degrades cleanly to bare `AC-<frId>` token (no .N suffix)", () => {
    const ctx = makeProject({ "specs/requirements.md": headerOnlyMatrix });
    try {
      const result = appendTraceabilityRow(
        ctx.root,
        "STE-402",
        [],
        ["impl.ts"],
        ["impl.test.ts"],
      );
      expect(result.added).toBe(true);
      const after = readFileSync(join(ctx.root, "specs/requirements.md"), "utf-8");
      // Bare token, no `.N` suffix.
      expect(after).toMatch(/\|\s*AC-STE-402\s*\|/);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-171.1 — Stage C hardening: regex-special frIds escaped safely", () => {
  test("frId containing regex metacharacters (e.g., `+`, `(`) does not corrupt idempotency check", () => {
    const ctx = makeProject({ "specs/requirements.md": headerOnlyMatrix });
    try {
      // A pathological tracker key — exercises the metachar-escape path.
      const weirdId = "STE+9(99)";
      const first = appendTraceabilityRow(ctx.root, weirdId, [1], ["a.ts"], ["a.test.ts"]);
      expect(first.added).toBe(true);
      // Idempotency must still detect the row even with metachars in the key.
      const second = appendTraceabilityRow(ctx.root, weirdId, [1], ["a.ts"], ["a.test.ts"]);
      expect(second.added).toBe(false);
    } finally {
      ctx.cleanup();
    }
  });
});
