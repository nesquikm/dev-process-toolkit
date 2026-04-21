// Phase D Tier 4 test — convert_archive.ts (AC-48.9).

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { convertArchiveFile } from "./convert_archive";

const INPUT_DIR = join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "tests",
  "fixtures",
  "migration",
  "v1-to-v2",
  "input",
  "specs",
  "archive",
);

describe("convertArchiveFile", () => {
  test("extracts the archived milestone's FR blocks with preserved archived date (AC-48.9)", () => {
    const md = readFileSync(join(INPUT_DIR, "M97-first.md"), "utf-8");
    const result = convertArchiveFile(md);
    expect(result.milestone).toBe("M97");
    expect(result.archivedAt).toBe("2026-01-01T00:00:00Z");
    expect(result.title).toBe("First Archived Milestone");
    expect(result.frs).toHaveLength(1);
    const fr100 = result.frs[0]!;
    expect(fr100.oldId).toBe("FR-100");
    expect(fr100.title).toBe("Archived Requirement from M97");
    expect(fr100.body).toContain("Requirement archived at milestone close");
    expect(fr100.acceptanceCriteria.some((a) => a.includes("AC-100.1"))).toBe(true);
  });

  test("handles M98 fixture symmetrically", () => {
    const md = readFileSync(join(INPUT_DIR, "M98-second.md"), "utf-8");
    const result = convertArchiveFile(md);
    expect(result.milestone).toBe("M98");
    expect(result.archivedAt).toBe("2026-02-01T00:00:00Z");
    expect(result.frs[0]?.oldId).toBe("FR-200");
  });

  test("archived date parses from YAML frontmatter `archived:` field", () => {
    const md = [
      "---",
      "milestone: M42",
      "title: Sample",
      "archived: 2025-12-15",
      "revision: 1",
      "source_files: [plan.md, requirements.md]",
      "---",
      "",
      "## Plan block (from plan.md)",
      "",
      "plan stuff",
      "",
      "## Requirements block (from requirements.md)",
      "",
      "### FR-42: Sample {#FR-42}",
      "",
      "Body.",
      "",
      "**Acceptance Criteria:**",
      "- AC-42.1: one",
      "",
    ].join("\n");
    const result = convertArchiveFile(md);
    expect(result.archivedAt).toBe("2025-12-15T00:00:00Z");
    expect(result.frs[0]?.oldId).toBe("FR-42");
  });
});
