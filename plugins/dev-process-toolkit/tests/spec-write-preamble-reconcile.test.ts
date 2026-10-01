// STE-284 AC-STE-284.3 — /spec-write preamble reconciliation prose grep.
//
// Asserts the SKILL.md carries a `§ 0.5 Tracker-local reconciliation` section
// between § 0 and § 0a, referencing the shared helper, the import path, and
// the no-auto-import rule that governs tracker-only orphans. Content-grep test
// in the same style as the other SKILL.md-shape tests under `tests/`.
//
// M_840a06/STE-578 replaced the old "cites the STE-135 guard" pin: no such
// guard existed then (the import path had no check of any kind), so that
// assertion was pinning a false claim open. It is deleted, not satisfied.
// M_a85e46/STE-652 then gave the importer a real, narrow guard (it refuses a
// key a local FR, active or archived, already binds), so § 0.5 stops claiming
// "no existence check" and states that scope instead.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SKILL_PATH = join(import.meta.dir, "..", "skills", "spec-write", "SKILL.md");

describe("AC-STE-284.3 + AC-STE-578.1: § 0.5 Tracker-local reconciliation section present", () => {
  test("SKILL.md contains the literal `§ 0.5` reconciliation heading", () => {
    const body = readFileSync(SKILL_PATH, "utf-8");
    // The heading text must mention both "0.5" and "Tracker-local reconciliation".
    expect(body).toMatch(/0\.5/);
    expect(body).toMatch(/Tracker-local reconciliation/i);
  });

  test("§ 0.5 sits between § 0 and § 0a in document order", () => {
    const body = readFileSync(SKILL_PATH, "utf-8");
    // Find the three section markers and assert ascending offsets.
    const idx0 = body.search(/^###\s*0\.\s/m);
    const idx05 = body.search(/0\.5.*Tracker-local reconciliation/i);
    const idx0a = body.search(/^###\s*0a\b/m);
    expect(idx0).toBeGreaterThanOrEqual(0);
    expect(idx05).toBeGreaterThan(idx0);
    expect(idx0a).toBeGreaterThan(idx05);
  });

  test("§ 0.5 references the shared helper `reconcileTrackerLocal`", () => {
    const body = readFileSync(SKILL_PATH, "utf-8");
    expect(body).toContain("reconcileTrackerLocal");
  });

  test("§ 0.5 names `importFromTracker` as the path it forbids", () => {
    const body = readFileSync(SKILL_PATH, "utf-8");
    expect(body).toContain("importFromTracker");
  });

  test("§ 0.5 forbids auto-import and cites no clobber guard", () => {
    const body = readFileSync(SKILL_PATH, "utf-8");
    // Scope the positive to § 0.5 itself: asserting against the whole file
    // would pass on the phrase turning up in any other section.
    const start = body.indexOf("### 0.5 Tracker-local reconciliation");
    const end = body.indexOf("\n### ", start + 1);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const section = body.slice(start, end);
    expect(section).toMatch(/never auto-imported/i);
    // The guard the old pin claimed does not exist, so the token must not
    // return — not even inside a sentence denying it.
    expect(body).not.toMatch(/STE-135/);
  });

  test("NFR-1: SKILL.md ≤ 358 lines (preamble addition stays within budget)", () => {
    // This pin used to allow 360 — LOOSER than the contract, so it was a
    // hole rather than a false red: two lines past NFR-1 would have passed
    // here while `tests/skill-nfr-1-length.test.ts` failed. NFR-1 is 358
    // (`specs/requirements.md`, and the one `const SKILL_LINE_CAP = 358;`).
    // Repointed by M_8f8e25/STE-558.
    const SKILL_LINE_CAP = 358;
    const body = readFileSync(SKILL_PATH, "utf-8");
    const lineCount = body.split("\n").length;
    expect(lineCount).toBeLessThanOrEqual(SKILL_LINE_CAP);
  });
});

// ---------------------------------------------------------------------------
// M_a85e46 / STE-652 — § 0.5's body line, rewritten in place.
// Pinned by PATTERN on the single § 0.5 body paragraph (found by content, not
// by line number — tests/m_840a06-ste-578-* owns the index pins).
// ---------------------------------------------------------------------------

function section05BodyLine(): string {
  const body = readFileSync(SKILL_PATH, "utf-8");
  const start = body.indexOf("### 0.5 Tracker-local reconciliation");
  const end = body.indexOf("\n### ", start + 1);
  if (start < 0 || end <= start) throw new Error("§ 0.5 not found — the slicer is broken");
  const hits = body
    .slice(start, end)
    .split("\n")
    .filter((l) => l.includes("reconcileTrackerLocal"));
  if (hits.length !== 1) throw new Error(`expected ONE § 0.5 body line naming reconcileTrackerLocal, found ${hits.length}`);
  return hits[0]!;
}

describe("AC-STE-652.5 / AC-STE-652.10: § 0.5 states the importer's real guard and the shared-repo option", () => {
  test("AC-STE-652.5: the line no longer claims importFromTracker has no existence check", () => {
    const line = section05BodyLine();
    expect(line).toContain("importFromTracker");
    expect(line, "§ 0.5 still claims the importer has no existence check").not.toMatch(/no existence check/i);
    expect(line, "§ 0.5 still claims the importer writes unconditionally").not.toMatch(/writes the FR file unconditionally/i);
  });

  test("AC-STE-652.5: the line states the guard's scope — it refuses only a key a local FR (active or archived) already binds", () => {
    const line = section05BodyLine();
    const SCOPE_RE = /importFromTracker`?[^;]{0,40}\brefuses\b[^;]{0,80}\b(active or archived|archived or active)\b[^;]{0,40}\bbinds?\b/i;
    // CONTROL: the regex fires on the sentence it is meant to catch.
    expect(
      SCOPE_RE.test("`importFromTracker` refuses only a key a local FR (active or archived) already binds; otherwise"),
      "SCOPE_RE stopped matching its own control string",
    ).toBe(true);
    expect(SCOPE_RE.test(line), "§ 0.5 does not state the importer's bound-key refusal scope").toBe(true);
    // The outward write the consent rule exists for is still named.
    expect(line).toContain("provider.sync(spec)");
    expect(line).toMatch(/never auto-imported/i);
  });

  test("AC-STE-652.10: the line tells the preamble to pass `{ shared: true }` in a shared repository", () => {
    const line = section05BodyLine();
    expect(line).toContain("{ shared: true }");
    expect(line).toMatch(/shared[^;]{0,60}\{ shared: true \}|\{ shared: true \}[^;]{0,60}shared/i);
  });

  test("AC-STE-652.10: the line reports `skippedMilestones` as a count, never as a mismatch", () => {
    const line = section05BodyLine();
    expect(line).toContain("skippedMilestones");
    expect(line).toMatch(/skippedMilestones`?[^;]{0,80}\bas a count\b|\bcount\b[^;]{0,80}skippedMilestones/i);
  });
});
