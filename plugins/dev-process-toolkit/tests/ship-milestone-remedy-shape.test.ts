import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// STE-83 — /ship-milestone pre-flight refusal #1 remedy rewrite.
//
// Pre-flight refusal #1 fires when any FR in the milestone plan is
// status: active. Before STE-83, the canned remedy told the user to run
// /implement to archive — wrong for the common case where every FR had
// already shipped via single-FR /implement (which legitimately leaves
// status: active; milestone-scope archival is a separate step). STE-83
// rewrites the remedy to branch on the tracker-state probe:
//
//   (1) tracker-Done-but-file-active → direct to /spec-archive M<N>
//   (2) genuinely unshipped          → keep the existing remedy
//
// These prose assertions lock the two shapes against regression — the
// SKILL.md-testing convention used by ship-milestone-shape.test.ts,
// implement-phase4-close.test.ts, etc.

const pluginRoot = join(import.meta.dir, "..");
const shipSkillPath = join(pluginRoot, "skills", "ship-milestone", "SKILL.md");
const implementSkillPath = join(pluginRoot, "skills", "implement", "SKILL.md");

function readShip(): string {
  return readFileSync(shipSkillPath, "utf8");
}
function readImplement(): string {
  return readFileSync(implementSkillPath, "utf8");
}

describe("AC-STE-83.1 — tracker-Done remedy names /spec-archive M<N>", () => {
  test("ship-milestone SKILL.md refusal #1 body contains the literal `/spec-archive M<N>`", () => {
    const body = readShip();
    expect(body).toContain("/spec-archive M<N>");
  });

  test("the /spec-archive M<N> mention lives inside pre-flight refusal #1", () => {
    const body = readShip();
    // Refusal #1 is titled "Unshipped FRs"; the /spec-archive pointer must
    // appear in the window between that heading and refusal #2 so it
    // surfaces at refusal time, not as background prose elsewhere.
    const refusal1Start = body.search(/1\.\s+\*\*Unshipped FRs\*\*/);
    expect(refusal1Start).toBeGreaterThan(-1);
    const refusal2Start = body.search(/2\.\s+\*\*Dirty working tree/);
    expect(refusal2Start).toBeGreaterThan(refusal1Start);
    const window = body.slice(refusal1Start, refusal2Start);
    expect(window).toContain("/spec-archive M<N>");
  });
});

describe("AC-STE-83.2 — two remedy shapes branched on tracker state", () => {
  test("refusal #1 names Provider.getTicketStatus as the branch probe", () => {
    const body = readShip();
    const refusal1Start = body.search(/1\.\s+\*\*Unshipped FRs\*\*/);
    const refusal2Start = body.search(/2\.\s+\*\*Dirty working tree/);
    const window = body.slice(refusal1Start, refusal2Start);
    expect(window).toMatch(/getTicketStatus|Provider\.getTicketStatus/);
  });

  test("refusal #1 names status_mapping.done as the tracker-Done comparison target", () => {
    const body = readShip();
    const refusal1Start = body.search(/1\.\s+\*\*Unshipped FRs\*\*/);
    const refusal2Start = body.search(/2\.\s+\*\*Dirty working tree/);
    const window = body.slice(refusal1Start, refusal2Start);
    expect(window).toMatch(/status_mapping\.done/);
  });

  test("refusal #1 distinguishes tracker-Done-but-file-active vs genuinely-unshipped shapes", () => {
    const body = readShip();
    const refusal1Start = body.search(/1\.\s+\*\*Unshipped FRs\*\*/);
    const refusal2Start = body.search(/2\.\s+\*\*Dirty working tree/);
    const window = body.slice(refusal1Start, refusal2Start);
    // The two shape names must both appear so the LLM reads them as a
    // branch, not a single remedy.
    expect(window).toMatch(/tracker-Done-but-file-active|tracker-?[Dd]one/);
    expect(window).toMatch(/genuinely[- ]unshipped|not yet at.*done/i);
  });

  test("genuinely-unshipped shape still names /implement as the remedy for that case", () => {
    const body = readShip();
    const refusal1Start = body.search(/1\.\s+\*\*Unshipped FRs\*\*/);
    const refusal2Start = body.search(/2\.\s+\*\*Dirty working tree/);
    const window = body.slice(refusal1Start, refusal2Start);
    // The second shape preserves the existing direction to finish via /implement.
    expect(window).toMatch(/\/implement/);
  });

  test("refusal #1 names mode: none as a 'genuinely unshipped' fallback (local-no-tracker)", () => {
    const body = readShip();
    const refusal1Start = body.search(/1\.\s+\*\*Unshipped FRs\*\*/);
    const refusal2Start = body.search(/2\.\s+\*\*Dirty working tree/);
    const window = body.slice(refusal1Start, refusal2Start);
    // mode: none has no tracker to probe, so the remedy must fall through
    // to the genuinely-unshipped shape deterministically.
    expect(window).toMatch(/mode:\s*none|local-no-tracker/);
  });
});

describe("AC-STE-83.3 — both shapes exit non-zero with Context preserved", () => {
  test("refusal #1 window carries the Context: milestone=..., unshipped=..., skill=ship-milestone line", () => {
    const body = readShip();
    const refusal1Start = body.search(/1\.\s+\*\*Unshipped FRs\*\*/);
    const refusal2Start = body.search(/2\.\s+\*\*Dirty working tree/);
    const window = body.slice(refusal1Start, refusal2Start);
    expect(window).toMatch(/Context:[^\n]*milestone=M<N>/);
    expect(window).toMatch(/unshipped=<count>/);
    expect(window).toMatch(/skill=ship-milestone/);
  });

  test("refusal still exits non-zero (pre-flight refusal contract unchanged)", () => {
    const body = readShip();
    // The pre-amble above the numbered refusals promises non-zero exit.
    const intro = body.slice(0, body.search(/1\.\s+\*\*Unshipped FRs\*\*/));
    expect(intro).toMatch(/exits? non-zero|refuse.*non-zero|non-zero/i);
  });
});

describe("AC-STE-83.4 — locked literal substring /spec-archive M<N>", () => {
  test("the exact substring `/spec-archive M<N>` is present (regression anchor)", () => {
    const body = readShip();
    // Anchor against a future rewrite that drops the concrete command form.
    expect(body.includes("/spec-archive M<N>")).toBe(true);
  });
});

describe("AC-STE-83.5 — /implement SKILL.md Milestone Archival cross-reference", () => {
  test("implement SKILL.md § Milestone Archival contains the /spec-archive M<N> cross-reference sentence", () => {
    const body = readImplement();
    // Narrow the window: Milestone Archival heading → Post-Archive Drift Check heading.
    const start = body.indexOf("### Milestone Archival");
    expect(start).toBeGreaterThan(-1);
    const end = body.indexOf("#### Post-Archive Drift Check", start);
    expect(end).toBeGreaterThan(start);
    const window = body.slice(start, end);
    expect(window).toContain("/spec-archive M<N>");
    // The sentence must surface the single-FR vs milestone-scope split so
    // the LLM understands why single-FR runs leave status: active.
    expect(window).toMatch(/single[- ]FR/i);
  });
});
