import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// AC-STE-54.1 / AC-STE-54.2: Phase 4 surfaces a single atomic "Close"
// procedure that names (in order) commit → releaseLock → post-release
// status verification via Provider.getTicketStatus. No exit path through
// Phase 4 skips the releaseLock; a status mismatch surfaces an NFR-10-shape
// refusal.
//
// These prose assertions are the long-term backstop so future SKILL.md edits
// can't silently re-scatter the close procedure across paragraphs — the root
// cause of the ship-with-tickets-stuck-at-In-Progress regressions.

const pluginRoot = join(import.meta.dir, "..");
const skillPath = join(pluginRoot, "skills", "implement", "SKILL.md");

function readSkill(): string {
  return readFileSync(skillPath, "utf8");
}

function phase4Block(body: string): string {
  const start = body.indexOf("## Phase 4");
  expect(start).toBeGreaterThan(-1);
  const end = body.indexOf("## Rules", start);
  expect(end).toBeGreaterThan(start);
  return body.slice(start, end);
}

describe("AC-STE-54.1 — atomic Close procedure in Phase 4", () => {
  test("Phase 4 names a single Close step", () => {
    const body = readSkill();
    const phase4 = phase4Block(body);
    // The Close step must be named explicitly — the prior "distributes across
    // paragraphs" problem had no stable anchor to grep against.
    expect(phase4).toMatch(/\bClose\b/);
    // "atomic" or equivalent strength word must appear so the LLM treats it
    // as all-or-nothing.
    expect(phase4).toMatch(/atomic|all three|required|must complete/i);
  });

  test("Close step names the three mechanisms in order: commit → releaseLock → getTicketStatus", () => {
    const body = readSkill();
    const phase4 = phase4Block(body);
    const commitIdx = phase4.search(/\bgit commit\b|\bcommit\b/);
    const releaseIdx = phase4.indexOf("releaseLock");
    const statusIdx = phase4.indexOf("getTicketStatus");
    expect(commitIdx).toBeGreaterThan(-1);
    expect(releaseIdx).toBeGreaterThan(-1);
    expect(statusIdx).toBeGreaterThan(-1);
    // Ordering — the three mechanisms must appear in the documented sequence
    // so the LLM can't treat them as a set with free ordering.
    expect(commitIdx).toBeLessThan(releaseIdx);
    expect(releaseIdx).toBeLessThan(statusIdx);
  });

  test("Close step forbids skipping releaseLock on any exit path", () => {
    const body = readSkill();
    const phase4 = phase4Block(body);
    // Explicit "no exit path skips (b)" or equivalent phrasing covers the
    // historical regression where Phase 4 returned to the user before
    // calling releaseLock.
    expect(phase4).toMatch(/no exit path.*(skip|omit)|never skip.*releaseLock|must.*releaseLock/i);
  });
});

describe("AC-STE-54.2 — post-release status verification", () => {
  test("Phase 4 names Provider.getTicketStatus as the verification mechanism", () => {
    const body = readSkill();
    const phase4 = phase4Block(body);
    expect(phase4).toContain("getTicketStatus");
  });

  test("Phase 4 instructs asserting the status matches status_mapping.done", () => {
    const body = readSkill();
    const phase4 = phase4Block(body);
    // The assertion target is the adapter's canonical Done status name, not
    // a hard-coded string — this lets adapters with non-"Done" canonical
    // names (e.g., "Completed") still pass.
    expect(phase4).toMatch(/status_mapping\.done|canonical.*Done|assert.*status/i);
  });

  test("Phase 4 describes NFR-10-shape refusal on status mismatch", () => {
    const body = readSkill();
    const phase4 = phase4Block(body);
    // Mismatch must exit non-zero with an NFR-10-canonical message naming
    // the ticket so the human can intervene.
    expect(phase4).toMatch(/NFR-10|mismatch.*(refus|surface|fail)|exits? non-zero/i);
  });
});

describe("AC-STE-92.6 — Phase 4 prose flips plan-status on milestone close", () => {
  test("Procedure prose declares an explicit plan-status flip step", () => {
    const body = readSkill();
    const phase4 = phase4Block(body);
    // The atomic commit must include the milestone plan file's
    // status: active → status: archived flip plus an archived_at set,
    // landing in the same atomic commit as the FR moves and the plan file
    // git mv. Defense-in-depth so probe #16 (STE-92) starts and stays green.
    // The phrase "plan-status flip" or its semantic equivalent must appear
    // — generic "plan" + "status" matches on the existing FR-flip prose,
    // so use a dedicated anchor token.
    expect(phase4).toMatch(/AC-STE-92\.3|plan-status flip|flip the plan|plan frontmatter/i);
  });

  test("Procedure prose names the plan path with the status flip + archived_at", () => {
    const body = readSkill();
    const phase4 = phase4Block(body);
    // Find the plan-status anchor and verify its surrounding context names
    // the plan path and archived_at — the read-side probe enforces both.
    const idx = phase4.search(/AC-STE-92\.3|plan-status flip|flip the plan|plan frontmatter/i);
    expect(idx).toBeGreaterThan(-1);
    const block = phase4.slice(Math.max(0, idx - 200), idx + 600);
    expect(block).toMatch(/specs\/plan\/<M#>\.md|specs\/plan\/.*M.*\.md/);
    expect(block).toMatch(/archived_at/);
  });

  test("Procedure prose ties the plan-status flip to the same atomic commit as the FR moves", () => {
    const body = readSkill();
    const phase4 = phase4Block(body);
    // Same commit invariant — the plan-status flip is not a follow-up
    // commit. The probe asserts read-side; the prose asserts write-side.
    expect(phase4).toMatch(/atomic|same commit|one commit/i);
  });
});
