import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// FR-66 conformance — updatedAt recording must happen AFTER claimLock,
// not "at skill start" (the ambiguous original AC-33.2 wording).
//
// Background: claimLock (step 0.c) sets tracker status `In Progress` +
// assignee, which bumps `updatedAt`. Recording `updatedAt` before
// claimLock makes /gate-check fire a false-positive drift warning on
// the skill's own write. These tests lock the corrected wording in
// SKILL.md + the docs call-out.

const pluginRoot = join(import.meta.dir, "..");

function read(relPath: string): string {
  return readFileSync(join(pluginRoot, relPath), "utf8");
}

describe("FR-66 — updatedAt recorded after claimLock (not at skill start)", () => {
  test("AC-66.1/2 — implement SKILL.md step 0.d labels updatedAt recording as post-claimLock", () => {
    const body = read("skills/implement/SKILL.md");
    // Marker: the "Record `updatedAt`" sub-bullet of step 0.d must explicitly
    // name claimLock as its predecessor, not say "at skill start".
    expect(body).toMatch(/Record\s+`updatedAt`\s*\(post-claimLock\)/);
    // And must NOT retain the ambiguous "at skill start" phrasing that
    // misled a naive reading.
    expect(body).not.toContain("store the ticket's `updatedAt` in-session for `/gate-check` to compare later (AC-33.2).");
  });

  test("AC-66.7 — docs/implement-tracker-mode.md carries the one-line AFTER-claimLock call-out", () => {
    const body = read("docs/implement-tracker-mode.md");
    // The one-line callout from AC-66.7 (exact wording).
    expect(body).toContain("Record `updatedAt` AFTER `claimLock` — the claim itself mutates the ticket");
  });

  test("AC-66.5/66.6 — docs/implement-tracker-mode.md covers the general rule + already-ours edge", () => {
    const body = read("docs/implement-tracker-mode.md");
    // AC-66.5: the rule generalizes to any tracker-writing pre-flight step,
    // not just claimLock. Marker: "after all pre-flight side effects"
    // (tolerates markdown line-wrap between words).
    expect(body).toMatch(/after all pre-flight side\s+effects/i);
    // AC-66.6: if claimLock returns `already-ours` and an older updatedAt
    // is observed than what's already in session, prefer the newer.
    expect(body).toMatch(/already-ours/);
    expect(body).toMatch(/prefer the newer/i);
  });
});
