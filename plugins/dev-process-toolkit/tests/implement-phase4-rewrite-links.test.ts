import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// STE-125 AC-STE-125.1 / .3 / .4 — /implement Phase 4 archival must invoke
// rewriteArchiveLinks() between `git mv` and the Phase 4c commit, and the
// SKILL.md prose must surface the work in the report + the failure abort
// semantics. This is the doc-conformance test for the instruction; the
// helper itself is exercised by spec_archive_rewrite_links.test.ts.

const pluginRoot = join(import.meta.dir, "..");
const skillPath = join(pluginRoot, "skills", "implement", "SKILL.md");

function readSkill(): string {
  return readFileSync(skillPath, "utf8");
}

function extractSection(body: string, startHeadingRegex: RegExp, endHeadingRegex: RegExp): string {
  const start = body.search(startHeadingRegex);
  expect(start).toBeGreaterThan(-1);
  const remainder = body.slice(start + 1);
  const endRelative = remainder.search(endHeadingRegex);
  return endRelative === -1 ? body.slice(start) : body.slice(start, start + 1 + endRelative);
}

describe("STE-125 AC-STE-125.1 — Milestone Archival invokes rewriteArchiveLinks", () => {
  test("Milestone Archival section names rewriteArchiveLinks(repoRoot, frId)", () => {
    const body = readSkill();
    const section = extractSection(
      body,
      /\n### Milestone Archival/,
      /\n#### Post-Archive Drift Check|\n### Spec Deviation Summary|\n## Phase 5/,
    );
    expect(section).toContain("rewriteArchiveLinks");
    expect(section).toMatch(/spec_archive\/rewrite_links/);
  });

  test("rewriteArchiveLinks invocation lands between `git mv` and the atomic commit", () => {
    const body = readSkill();
    const section = extractSection(
      body,
      /\n### Milestone Archival/,
      /\n#### Post-Archive Drift Check|\n### Spec Deviation Summary|\n## Phase 5/,
    );
    const gitMv = section.indexOf("git mv specs/frs");
    const rewriteCall = section.indexOf("rewriteArchiveLinks");
    expect(gitMv).toBeGreaterThan(-1);
    expect(rewriteCall).toBeGreaterThan(gitMv);
    // The rewrite paragraph itself must restate that the rewrites land in the
    // same atomic commit as the git mv — this is what STE-125 makes load-bearing.
    const tail = section.slice(rewriteCall);
    expect(tail).toMatch(/same atomic commit|atomic commit/i);
  });
});

describe("STE-125 AC-STE-125.4 — Phase 4 report surfaces the rewrite count", () => {
  test("Step 14 Report block names traceability-link rewrite count", () => {
    const body = readSkill();
    const start = body.indexOf("14. **Report**");
    expect(start).toBeGreaterThan(-1);
    const end = body.indexOf("15. **Wait for approval", start);
    expect(end).toBeGreaterThan(start);
    const step14 = body.slice(start, end);
    // Must mention traceability + a count phrasing so operators see the work.
    expect(step14).toMatch(/traceability/i);
    expect(step14).toMatch(/rewrote|link/i);
  });
});

describe("STE-125 AC-STE-125.3 — failure semantics: abort cleanly, no commit, no release", () => {
  test("Milestone Archival section documents rewrite-failure abort path", () => {
    const body = readSkill();
    const section = extractSection(
      body,
      /\n### Milestone Archival/,
      /\n#### Post-Archive Drift Check|\n### Spec Deviation Summary|\n## Phase 5/,
    );
    // The instruction must name the failure semantics explicitly so the LLM
    // does not commit a half-done archive when the rewrite step throws.
    expect(section).toMatch(/rewrite.*fail|fail.*rewrite|rewriteArchiveLinks.*throw/i);
    expect(section).toMatch(/abort|do not commit|no commit/i);
  });
});
