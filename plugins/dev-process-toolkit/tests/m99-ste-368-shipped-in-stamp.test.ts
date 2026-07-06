import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// M99 STE-368 — /ship-milestone `shipped_in` stamp: SKILL.md prose pins.
//
// AC-STE-368.1 — a successful run writes `shipped_in: v<X.Y.Z>` into the
//   RESOLVED plan file's frontmatter (live path OR the STE-210
//   archive-fallback path) inside the single atomic release commit. Pinned
//   here as: step 1 notes the resolved path is later stamped; step 7 calls
//   the stamp helper on the resolved plan path before the commit.
// AC-STE-368.2 — pre-flight #2's expected-modified set includes the resolved
//   plan path; step 6's unified diff renders the stamp hunk; the stamp rides
//   the existing single `Apply?` approval (no extra prompt).
// AC-STE-368.3 — helper unit tests live in
//   adapters/_shared/src/plan_ship_stamp.test.ts; here we only pin that the
//   skill references the helper by name.
// AC-STE-368.4 / AC-STE-368.5 — run-once backfill + same-commit compliance
//   are validated by human diff review + STE-369's probe (FR § Testing); the
//   only permanent pin is the stamp-semantics prose naming the one-shot
//   backfill as the sole other legitimate writer.

const pluginRoot = join(import.meta.dir, "..");
const skillPath = join(pluginRoot, "skills", "ship-milestone", "SKILL.md");

function readSkill(): string {
  return readFileSync(skillPath, "utf8");
}

/** Slice [startMarker, endMarker) of the skill body; both markers must exist. */
function sectionSlice(body: string, startMarker: string, endMarker: string): string {
  const start = body.indexOf(startMarker);
  expect(start).toBeGreaterThan(-1);
  const end = body.indexOf(endMarker, start);
  expect(end).toBeGreaterThan(start);
  return body.slice(start, end);
}

describe("AC-STE-368.1 — release-commit stamp on the resolved plan path", () => {
  test("skill references the stamp helper (plan_ship_stamp.ts / stampShippedIn)", () => {
    const body = readSkill();
    expect(body).toMatch(/plan_ship_stamp\.ts|stampShippedIn/);
  });

  test("step 7 (commit) calls stampShippedIn and names the shipped_in frontmatter key", () => {
    const body = readSkill();
    const step7 = sectionSlice(body, "### 7.", "### 8.");
    expect(step7).toContain("stampShippedIn");
    expect(step7).toContain("shipped_in");
  });

  test("stamp targets the RESOLVED plan path (covers the STE-210 archive-fallback leg)", () => {
    const body = readSkill();
    // The stamp prose must bind to the resolved path — the one step 1
    // produces, which is `specs/plan/M<N>.md` OR the archive-fallback
    // `specs/plan/archive/M<N>.md`.
    expect(body).toMatch(
      /stamp[\s\S]{0,300}resolved plan (path|file)|resolved plan (path|file)[\s\S]{0,300}stamp/i,
    );
  });

  test("step 1 (plan resolution) notes the resolved path is later stamped", () => {
    const body = readSkill();
    const step1 = sectionSlice(body, "### 1.", "### 2.");
    expect(step1).toMatch(/stamp/i);
  });
});

describe("AC-STE-368.2 — approval + expected-set coverage", () => {
  test("pre-flight #2's expected-modified set includes the resolved plan path", () => {
    const body = readSkill();
    const preflight2 = sectionSlice(body, "2. **Dirty working tree", "3. **Test gate");
    expect(preflight2).toMatch(/resolved plan (path|file)|plan file|specs\/plan\//i);
  });

  test("step 6 diff preview renders the frontmatter stamp hunk", () => {
    const body = readSkill();
    const step6 = sectionSlice(body, "### 6.", "### 7.");
    expect(step6).toMatch(/shipped_in|frontmatter stamp|stamp hunk/i);
  });

  test("stamp rides the existing single approval — no extra prompt", () => {
    const body = readSkill();
    expect(body).toMatch(
      /no extra prompt|rides the existing|same single approval|single `Apply\?`/i,
    );
  });
});

describe("STE-368 — stamp semantics prose (Technical Design)", () => {
  test("shipped_in is written only by /ship-milestone (or the one-shot backfill)", () => {
    const body = readSkill();
    expect(body).toMatch(/written only by/i);
    expect(body).toMatch(/one-shot backfill/i);
  });

  test("absence on an archived plan means unshipped debt; absence on a live plan is normal", () => {
    const body = readSkill();
    expect(body).toMatch(/unshipped debt/i);
    expect(body).toMatch(/live plan[\s\S]{0,80}normal|normal[\s\S]{0,80}live plan/i);
  });
});
