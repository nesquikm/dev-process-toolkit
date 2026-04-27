import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// STE-127 AC-STE-127.1 / .2 / .3 / .4 — /spec-write Step 7 must emit a
// closing summary on every successful run. The skill is LLM-driven, so the
// test is a doc-conformance probe asserting the SKILL.md prose:
//   1. Phrases the summary as MANDATORY / UNCONDITIONAL (not advisory).
//   2. Names the three required signals: FR id, FR file path, milestone.
//   3. References the >= 100-byte-stdout floor (smoke-test regression guard).
//   4. Calls out the import-path branch (importFromTracker miss).
// The smoke-test driver (out of repo) is the runtime regression guard.

const pluginRoot = join(import.meta.dir, "..");
const skillPath = join(pluginRoot, "skills", "spec-write", "SKILL.md");

function readSkill(): string {
  return readFileSync(skillPath, "utf8");
}

function extractStep7(body: string): string {
  const start = body.search(/\n### 7\. Report/);
  expect(start).toBeGreaterThan(-1);
  // Step 7 is the last `### N.` step in spec-write SKILL.md; the next top-level
  // heading is `## Rules`. (Anchor on `## Rules` specifically — code blocks
  // inside Step 7 may contain `## ...` markdown that's not a real section break.)
  const tail = body.slice(start + 1);
  const endRel = tail.search(/\n## Rules\b/);
  return endRel === -1 ? body.slice(start) : body.slice(start, start + 1 + endRel);
}

describe("STE-127 AC-STE-127.1 — Step 7 closing summary is mandatory, not advisory", () => {
  test("Step 7 prose uses unconditional / mandatory language", () => {
    const step7 = extractStep7(readSkill());
    // Pre-M33 prose was "Summarize what was completed" (advisory). The fix
    // must use mandatory phrasing so `-p` non-interactive runs still emit it.
    expect(step7).toMatch(/MUST emit|always emit|unconditional|mandatory/i);
  });
});

describe("STE-127 AC-STE-127.1 — Step 7 names the three required signals", () => {
  test("Step 7 prose enumerates FR id, FR file path, and milestone", () => {
    const step7 = extractStep7(readSkill());
    expect(step7).toMatch(/FR id|FR ID|tracker.id|tracker ID|short.ULID/i);
    expect(step7).toMatch(/specs\/frs\/|FR file path/i);
    expect(step7).toMatch(/milestone/i);
  });
});

describe("STE-127 AC-STE-127.2 — Step 7 names the >=100-byte stdout floor", () => {
  test("Step 7 prose references the size constraint or the smoke-test regression guard", () => {
    const step7 = extractStep7(readSkill());
    expect(step7).toMatch(/100\s*bytes|>=\s*100|wc -c|smoke-test/i);
  });
});

describe("STE-127 AC-STE-127.4 — Step 7 covers both new-FR and import paths", () => {
  test("Step 7 prose names importFromTracker / import path explicitly", () => {
    const step7 = extractStep7(readSkill());
    expect(step7).toMatch(/import|importFromTracker|tracker-id resolve/i);
  });
});
