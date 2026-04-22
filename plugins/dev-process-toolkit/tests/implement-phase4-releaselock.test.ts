import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// FR-68 AC-68.5 — doc-conformance test asserts that skills/implement/SKILL.md
// Phase 4 step 15 names `releaseLock` co-located with the commit-approval
// instruction, not only inside the Milestone Archival subsection. The
// tracker-mode flow doc (docs/implement-tracker-mode.md) must mirror with
// explicit "Done transition" wording.
//
// These markers stop the drift observed during /implement FR-57 FR-58 where
// tickets stayed at In Progress after their commits landed because the
// post-commit releaseLock instruction lived only inside milestone archival.

const pluginRoot = join(import.meta.dir, "..");
const skillPath = join(pluginRoot, "skills", "implement", "SKILL.md");
const trackerModeDocPath = join(pluginRoot, "docs", "implement-tracker-mode.md");

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

describe("FR-68 AC-68.1 / AC-68.5 — SKILL.md Phase 4 step 15 releaseLock marker", () => {
  test("Phase 4 step 15 block mentions releaseLock", () => {
    const body = readSkill();
    // Narrow to the window that owns step 15 (approval + commit) — stops before
    // the Rules section, so Milestone Archival's releaseLock reference is
    // also inside this window but not the only one.
    const phase4 = extractSection(body, /\n## Phase 4: Report & Handoff/, /\n## Rules\b/);
    expect(phase4).toContain("releaseLock");
  });

  test("step 15 has its own releaseLock instruction, not only Milestone Archival", () => {
    const body = readSkill();
    // The step-15 block starts at the line "15. **Wait for approval**" and
    // ends at the Rules heading. A `releaseLock` mention here is proof that
    // the post-commit release is wired outside the archival subsection.
    const start = body.indexOf("15. **Wait for approval");
    expect(start).toBeGreaterThan(-1);
    const end = body.indexOf("## Rules", start);
    expect(end).toBeGreaterThan(start);
    const step15 = body.slice(start, end);
    expect(step15).toContain("releaseLock");
  });

  test("step 15 instruction is scoped to 'after commit lands' — not before", () => {
    const body = readSkill();
    const start = body.indexOf("15. **Wait for approval");
    const end = body.indexOf("## Rules", start);
    const step15 = body.slice(start, end);
    // The phrasing matters for AC-68.3: release happens only after the commit
    // lands, so aborted runs do not release.
    expect(step15).toMatch(/after.*commit|commit.*succeed|commit.*land/i);
  });
});

describe("FR-68 AC-68.3 — abort boundary (no releaseLock on abort)", () => {
  test("step 15 names the abort cases that skip releaseLock", () => {
    const body = readSkill();
    const start = body.indexOf("15. **Wait for approval");
    const end = body.indexOf("## Rules", start);
    const step15 = body.slice(start, end);
    // The wording must surface the abort cases so the LLM does not
    // accidentally release on a rejected / gate-failed run.
    expect(step15).toMatch(/gate fail|spec breakout|reject|abort/i);
    // Explicit "do not release" phrasing on abort — the negative invariant
    // is the core of AC-68.3.
    expect(step15).toMatch(/not.*releaseLock|releaseLock.*only/i);
  });
});

describe("FR-68 AC-68.6 — double-call avoidance when archival runs", () => {
  test("step 15 cross-references Milestone Archival so archival consumes the responsibility", () => {
    const body = readSkill();
    const start = body.indexOf("15. **Wait for approval");
    const end = body.indexOf("## Rules", start);
    const step15 = body.slice(start, end);
    // The skill must explicitly name the archival path so the LLM does not
    // double-call releaseLock on full-milestone runs.
    expect(step15).toMatch(/archival|Milestone Archival/);
  });
});

describe("FR-68 AC-68.2 — docs/implement-tracker-mode.md mirrors the instruction", () => {
  test("tracker-mode doc has a Phase 4 subsection naming releaseLock", () => {
    const body = readFileSync(trackerModeDocPath, "utf8");
    expect(body).toMatch(/##?\s*Phase 4/);
    expect(body).toContain("releaseLock");
  });

  test("tracker-mode doc uses the explicit 'Done transition' wording", () => {
    const body = readFileSync(trackerModeDocPath, "utf8");
    expect(body).toMatch(/Done transition/);
  });

  test("tracker-mode doc cross-references SKILL.md step 15", () => {
    const body = readFileSync(trackerModeDocPath, "utf8");
    expect(body).toMatch(/step 15/i);
  });
});
