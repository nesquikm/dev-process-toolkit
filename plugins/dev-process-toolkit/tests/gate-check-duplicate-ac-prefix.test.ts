import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acLint, formatAcLintFailure } from "../adapters/_shared/src/ac_lint";

// STE-82 AC-STE-82.5 + AC-STE-82.7 — gate-check probe #7 integration test.
//
// Probe 7 walks active FR files and asserts that each file's `## Acceptance
// Criteria` section contains each `AC-<prefix>.<N>` combination at most
// once. Cross-file duplicates are allowed — the uniqueness invariant is
// per-FR.
//
// Positive fixture: an FR with unique AC numbering → `acLint` reports zero
// issues. Negative fixture: an FR with a repeated `AC-STE-82.5` → issue
// surfaces with filename, prefix, number, and occurrence count.

const pluginRoot = join(import.meta.dir, "..");
const gateCheckSkillPath = join(pluginRoot, "skills", "gate-check", "SKILL.md");

function read(path: string): string {
  return readFileSync(path, "utf8");
}

describe("STE-82 AC-STE-82.5 prose — /gate-check probe 7 is documented in SKILL.md", () => {
  test("SKILL.md names the Duplicate AC-prefix scan probe", () => {
    const body = read(gateCheckSkillPath);
    expect(body).toMatch(/Duplicate AC-prefix scan/);
    expect(body).toMatch(/AC-STE-50\.5/);
  });

  test("probe references `acLint` and the per-file uniqueness rule", () => {
    const body = read(gateCheckSkillPath);
    expect(body).toContain("acLint");
    expect(body).toMatch(/per file|within a single file/i);
  });

  test("probe emits GATE FAILED naming file + prefix + count", () => {
    const body = read(gateCheckSkillPath);
    const probeIdx = body.indexOf("Duplicate AC-prefix scan");
    expect(probeIdx).toBeGreaterThan(-1);
    const block = body.slice(probeIdx, probeIdx + 400);
    expect(block).toContain("GATE FAILED");
    expect(block).toMatch(/occurrence count|count/i);
  });
});

describe("STE-82 AC-STE-82.5/7 — acLint fixtures (positive + negative)", () => {
  function makeSpecsDir(frs: Record<string, string>): { dir: string; specsDir: string; cleanup: () => void } {
    const dir = mkdtempSync(join(tmpdir(), "ac-lint-"));
    const specsDir = join(dir, "specs");
    const frsDir = join(specsDir, "frs");
    mkdirSync(frsDir, { recursive: true });
    for (const [name, body] of Object.entries(frs)) {
      writeFileSync(join(frsDir, name), body);
    }
    return { dir, specsDir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
  }

  const UNIQUE_AC_BODY = `---
id: fr_unique
title: Unique
---

## Acceptance Criteria

- AC-STE-82.1: first.
- AC-STE-82.2: second.
- AC-STE-82.3: third.
`;

  const DUPLICATE_AC_BODY = `---
id: fr_dupe
title: Dupe
---

## Acceptance Criteria

- AC-STE-82.5: first mention.
- AC-STE-82.6: unique.
- AC-STE-82.5: repeated — triggers the probe.
`;

  test("POSITIVE: file with unique AC numbering produces zero issues", async () => {
    const ctx = makeSpecsDir({ "unique.md": UNIQUE_AC_BODY });
    try {
      const result = await acLint(ctx.specsDir);
      expect(result.issues).toEqual([]);
      expect(result.filesScanned).toBe(1);
    } finally {
      ctx.cleanup();
    }
  });

  test("NEGATIVE: file with repeated AC-STE-82.5 surfaces a single issue naming prefix + number + count", async () => {
    const ctx = makeSpecsDir({ "dupe.md": DUPLICATE_AC_BODY });
    try {
      const result = await acLint(ctx.specsDir);
      expect(result.issues.length).toBe(1);
      const issue = result.issues[0]!;
      expect(issue.prefix).toBe("STE-82");
      expect(issue.number).toBe(5);
      expect(issue.occurrences).toBe(2);
      expect(issue.file).toContain("dupe.md");
      // AC-STE-82.7 canonical format — `formatAcLintFailure` renders the
      // note shape the gate reporter surfaces.
      const rendered = formatAcLintFailure(result);
      expect(rendered).toContain("AC-STE-82.5 appears 2 times");
    } finally {
      ctx.cleanup();
    }
  });

  test("cross-file duplicates are allowed (per-FR uniqueness only)", async () => {
    // Two different FRs that happen to both use AC-STE-82.1 → zero issues.
    const ctx = makeSpecsDir({
      "a.md": UNIQUE_AC_BODY,
      "b.md": UNIQUE_AC_BODY.replace("id: fr_unique", "id: fr_other"),
    });
    try {
      const result = await acLint(ctx.specsDir);
      expect(result.issues).toEqual([]);
      expect(result.filesScanned).toBe(2);
    } finally {
      ctx.cleanup();
    }
  });
});
