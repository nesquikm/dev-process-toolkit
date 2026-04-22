// Tests for ac_lint — FR-73 AC-73.5 (duplicate-AC scan).
//
// ac_lint scans every active FR for duplicate `AC-<prefix>.<N>` lines
// inside the `## Acceptance Criteria` section. Duplicates inside the
// same FR are reported as issues; duplicates across FRs are allowed
// (different FRs can reasonably reuse the same N for different prefixes).

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acLint } from "./ac_lint";

function makeSpecsDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "ac-lint-"));
  mkdirSync(join(dir, "frs"), { recursive: true });
  mkdirSync(join(dir, "frs", "archive"), { recursive: true });
  return dir;
}

function writeFr(specsDir: string, id: string, acs: string[], subdir = "frs"): void {
  const body = [
    "---",
    `id: ${id}`,
    "title: Test FR",
    "milestone: M99",
    "status: active",
    "archived_at: null",
    "tracker:",
    "  {}",
    "created_at: 2026-04-22T00:00:00.000Z",
    "---",
    "",
    "## Requirement",
    "",
    "test",
    "",
    "## Acceptance Criteria",
    "",
    ...acs.map((ac) => `- ${ac}`),
    "",
    "## Notes",
    "",
    "notes",
    "",
  ].join("\n");
  writeFileSync(join(specsDir, subdir, `${id}.md`), body);
}

describe("acLint — clean FRs", () => {
  test("reports no issues for a single FR with unique AC prefixes", async () => {
    const specsDir = makeSpecsDir();
    try {
      writeFr(specsDir, "fr_01KCLEAN0000000000000000001", [
        "AC-STE-50.1: first",
        "AC-STE-50.2: second",
        "AC-STE-50.3: third",
      ]);
      const result = await acLint(specsDir);
      expect(result.issues).toEqual([]);
      expect(result.filesScanned).toBe(1);
    } finally {
      rmSync(specsDir, { recursive: true, force: true });
    }
  });

  test("reports no issues across multiple FRs with disjoint prefixes", async () => {
    const specsDir = makeSpecsDir();
    try {
      writeFr(specsDir, "fr_01KCLEAN0000000000000000001", [
        "AC-STE-50.1: first",
        "AC-STE-50.2: second",
      ]);
      writeFr(specsDir, "fr_01KCLEAN0000000000000000002", [
        "AC-STE-51.1: first",
        "AC-STE-51.2: second",
      ]);
      const result = await acLint(specsDir);
      expect(result.issues).toEqual([]);
      expect(result.filesScanned).toBe(2);
    } finally {
      rmSync(specsDir, { recursive: true, force: true });
    }
  });
});

describe("acLint — duplicate detection (AC-73.5)", () => {
  test("flags a simple duplicate AC line within a single FR", async () => {
    const specsDir = makeSpecsDir();
    try {
      writeFr(specsDir, "fr_01KDUPE00000000000000000001", [
        "AC-STE-50.1: first",
        "AC-STE-50.1: accidental duplicate",
        "AC-STE-50.2: second",
      ]);
      const result = await acLint(specsDir);
      expect(result.issues.length).toBe(1);
      const issue = result.issues[0]!;
      expect(issue.file).toContain("fr_01KDUPE00000000000000000001.md");
      expect(issue.prefix).toBe("STE-50");
      expect(issue.number).toBe(1);
    } finally {
      rmSync(specsDir, { recursive: true, force: true });
    }
  });

  test("flags duplicates across two different prefixes in the same FR", async () => {
    const specsDir = makeSpecsDir();
    try {
      writeFr(specsDir, "fr_01KDUPE00000000000000000001", [
        "AC-STE-50.1: a",
        "AC-STE-50.1: dupe",
        "AC-STE-51.2: b",
        "AC-STE-51.2: also dupe",
      ]);
      const result = await acLint(specsDir);
      expect(result.issues.length).toBe(2);
      const prefixes = result.issues.map((i) => `${i.prefix}.${i.number}`).sort();
      expect(prefixes).toEqual(["STE-50.1", "STE-51.2"]);
    } finally {
      rmSync(specsDir, { recursive: true, force: true });
    }
  });

  test("flags duplicates in multiple FRs independently", async () => {
    const specsDir = makeSpecsDir();
    try {
      writeFr(specsDir, "fr_01KDUPE00000000000000000001", [
        "AC-STE-50.1: a",
        "AC-STE-50.1: dupe",
      ]);
      writeFr(specsDir, "fr_01KDUPE00000000000000000002", [
        "AC-STE-51.1: a",
        "AC-STE-51.1: dupe",
      ]);
      const result = await acLint(specsDir);
      expect(result.issues.length).toBe(2);
      const files = result.issues.map((i) => i.file.match(/fr_[^/]+\.md/)?.[0]).sort();
      expect(files).toEqual([
        "fr_01KDUPE00000000000000000001.md",
        "fr_01KDUPE00000000000000000002.md",
      ]);
    } finally {
      rmSync(specsDir, { recursive: true, force: true });
    }
  });

  test("allows the same AC-N across different FRs (no cross-file collision)", async () => {
    const specsDir = makeSpecsDir();
    try {
      writeFr(specsDir, "fr_01KCROSS0000000000000000001", ["AC-STE-50.1: one"]);
      writeFr(specsDir, "fr_01KCROSS0000000000000000002", ["AC-STE-50.1: another"]);
      const result = await acLint(specsDir);
      expect(result.issues).toEqual([]);
    } finally {
      rmSync(specsDir, { recursive: true, force: true });
    }
  });

  test("short-ULID prefixes are treated the same as tracker prefixes", async () => {
    const specsDir = makeSpecsDir();
    try {
      writeFr(specsDir, "fr_01KDUPE00000000000000000001", [
        "AC-VDTAF4.1: a",
        "AC-VDTAF4.1: dupe",
      ]);
      const result = await acLint(specsDir);
      expect(result.issues.length).toBe(1);
      expect(result.issues[0]!.prefix).toBe("VDTAF4");
    } finally {
      rmSync(specsDir, { recursive: true, force: true });
    }
  });
});

describe("acLint — scope", () => {
  test("skips archive/ subdirectory", async () => {
    const specsDir = makeSpecsDir();
    try {
      writeFr(specsDir, "fr_01KARCH00000000000000000001", [
        "AC-STE-50.1: a",
        "AC-STE-50.1: dupe",
      ], "frs/archive");
      const result = await acLint(specsDir);
      expect(result.issues).toEqual([]);
      expect(result.filesScanned).toBe(0);
    } finally {
      rmSync(specsDir, { recursive: true, force: true });
    }
  });

  test("only scans AC-<prefix>.<N> lines inside ## Acceptance Criteria section", async () => {
    const specsDir = makeSpecsDir();
    try {
      // A `AC-STE-50.1` mention in the Notes section shouldn't count.
      const id = "fr_01KOUTS000000000000000000001";
      const body = [
        "---",
        `id: ${id}`,
        "title: Test FR",
        "milestone: M99",
        "status: active",
        "archived_at: null",
        "tracker:",
        "  {}",
        "created_at: 2026-04-22T00:00:00.000Z",
        "---",
        "",
        "## Acceptance Criteria",
        "",
        "- AC-STE-50.1: the one",
        "",
        "## Notes",
        "",
        "See AC-STE-50.1 for details; this is a citation, not a duplicate AC.",
        "",
      ].join("\n");
      writeFileSync(join(specsDir, "frs", `${id}.md`), body);
      const result = await acLint(specsDir);
      expect(result.issues).toEqual([]);
    } finally {
      rmSync(specsDir, { recursive: true, force: true });
    }
  });

  test("returns filesScanned count excluding archive", async () => {
    const specsDir = makeSpecsDir();
    try {
      writeFr(specsDir, "fr_01KTWO0000000000000000000001", ["AC-STE-50.1: a"]);
      writeFr(specsDir, "fr_01KTWO0000000000000000000002", ["AC-STE-51.1: b"]);
      writeFr(specsDir, "fr_01KTWO0000000000000000000003", ["AC-STE-52.1: c"], "frs/archive");
      const result = await acLint(specsDir);
      expect(result.filesScanned).toBe(2);
    } finally {
      rmSync(specsDir, { recursive: true, force: true });
    }
  });
});
