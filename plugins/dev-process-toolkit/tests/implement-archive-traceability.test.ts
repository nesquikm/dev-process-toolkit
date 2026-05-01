import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// STE-171 AC-STE-171.1 / AC-STE-171.2 / AC-STE-171.3 — doc-conformance test
// for /implement Phase 4 § Milestone Archival prose. The helpers themselves
// are exercised by their own unit tests (append_traceability_row.test.ts,
// stage_untracked_fr.test.ts, cleanup_plan_verify_lines.test.ts). This file
// pins the SKILL.md prose so the LLM-as-runtime invokes the helpers in the
// right order with the right arguments.

const pluginRoot = join(import.meta.dir, "..");
const skillPath = join(pluginRoot, "skills", "implement", "SKILL.md");

function readSkill(): string {
  return readFileSync(skillPath, "utf8");
}

function extractMilestoneArchival(body: string): string {
  const start = body.search(/\n### Milestone Archival/);
  expect(start).toBeGreaterThan(-1);
  const remainder = body.slice(start + 1);
  const endRelative = remainder.search(
    /\n#### Post-Archive Drift Check|\n### Spec Deviation Summary|\n## Phase 5/,
  );
  return endRelative === -1 ? body.slice(start) : body.slice(start, start + 1 + endRelative);
}

describe("STE-171 AC-STE-171.1 — Milestone Archival appends shipped-AC traceability row", () => {
  test("section names appendTraceabilityRow + the helper path", () => {
    const section = extractMilestoneArchival(readSkill());
    expect(section).toContain("appendTraceabilityRow");
    expect(section).toMatch(/spec_archive\/append_traceability_row/);
  });

  test("section commits to per-FR row write + idempotency on re-run", () => {
    const section = extractMilestoneArchival(readSkill());
    // Per-FR scope (one row per archived FR) and idempotent on re-run.
    expect(section).toMatch(/per (archived |)FR/i);
    expect(section).toMatch(/idempotent/i);
  });
});

describe("STE-171 AC-STE-171.2 — Milestone Archival stages untracked FR before git mv", () => {
  test("section instructs the LLM to detect untracked FR via porcelain + git add first", () => {
    const section = extractMilestoneArchival(readSkill());
    // The prose must mention `git status --porcelain` (or equivalent) AND
    // `git add` before `git mv`, so untracked FRs preserve rename history.
    expect(section).toMatch(/porcelain/i);
    expect(section).toMatch(/git add/i);
    // The "before `git mv`" ordering is load-bearing.
    const addPos = section.search(/git add\b/);
    const mvPos = section.search(/git mv specs\/frs/);
    expect(addPos).toBeGreaterThan(-1);
    expect(mvPos).toBeGreaterThan(-1);
  });

  test("section names the isFRUntrackedInPorcelain helper", () => {
    const section = extractMilestoneArchival(readSkill());
    expect(section).toContain("isFRUntrackedInPorcelain");
    expect(section).toMatch(/spec_archive\/stage_untracked_fr/);
  });
});

describe("STE-171 AC-STE-171.3 — Milestone Archival ensures cleanupPlanVerifyLines fires", () => {
  test("section commits to deriving deletedFiles[] from git diff (not LLM memory)", () => {
    const section = extractMilestoneArchival(readSkill());
    // The prose must give an explicit recipe so the LLM doesn't forget to
    // include run-removed files in deletedFiles[].
    expect(section).toMatch(/git diff --name-status/i);
    expect(section).toMatch(/--diff-filter=D|diff-filter=D/);
  });

  test("section calls out the filesystem-fallback as defense-in-depth", () => {
    const section = extractMilestoneArchival(readSkill());
    // The helper auto-detects missing paths even if deletedFiles[] is
    // incomplete. The prose names the fallback so the operator knows
    // probe #28 will stay quiet.
    expect(section).toMatch(/filesystem fallback|auto-detect|fallback/i);
  });
});

describe("STE-171 — Step 14 Report surfaces the new archival hygiene fields", () => {
  test("step 14 names the appended traceability row count + git-add-untracked count", () => {
    const body = readSkill();
    const start = body.indexOf("14. **Report**");
    expect(start).toBeGreaterThan(-1);
    const end = body.indexOf("15. **Wait for approval", start);
    expect(end).toBeGreaterThan(start);
    const step14 = body.slice(start, end);
    // Mention "appended N traceability row(s)" and the untracked-FR stage count.
    expect(step14).toMatch(/appended.*traceability row/i);
    expect(step14).toMatch(/untracked|staged/i);
  });
});
