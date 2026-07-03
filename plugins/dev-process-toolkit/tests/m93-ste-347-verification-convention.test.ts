// Meta-tests for STE-347 — `## Verification` convention + /implement
// Phase 4b″ verify-and-analyze step (M93).
//
// Prose contracts asserted (AC-STE-347.1 .. AC-STE-347.6):
//   - skills/implement/SKILL.md carries a Phase 4b″ "Project Verification"
//     section between the Phase 4b′ hook and the step-14 report, with
//     discovery-precedence prose, run-placement prose, spec-gap/impl-bug
//     classification + propose-never-auto-invoke prose, blocking/advisory/
//     manual gating prose, and six literal `MUST emit` capability tokens.
//   - skills/spec-write/SKILL.md § 7 static capability map carries all six
//     verify_skill_* keys (guards /gate-check's
//     closing_summary_capability_keys probe).
//   - templates/CLAUDE.md.template documents the optional `## Verification`
//     block (verify_skill + verify_mode, advisory default).
//   - docs/layout-reference.md documents the convention (closed key set +
//     three verify_mode values).
//
// IMPORTANT: assertions here are phrase/token literals only — they never
// require STE-/AC-namespace tokens in skills/** or templates/** prose (the
// shipped-prose ceiling test caps those at the current count with zero
// headroom).

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const pluginRoot = join(import.meta.dir, "..");

const implementBody = readFileSync(
  join(pluginRoot, "skills", "implement", "SKILL.md"),
  "utf8",
);
const specWriteBody = readFileSync(
  join(pluginRoot, "skills", "spec-write", "SKILL.md"),
  "utf8",
);
const templateBody = readFileSync(
  join(pluginRoot, "templates", "CLAUDE.md.template"),
  "utf8",
);
const layoutRefBody = readFileSync(
  join(pluginRoot, "docs", "layout-reference.md"),
  "utf8",
);

// "Phase 4b″" — U+2033 DOUBLE PRIME (renders as Phase 4b″), distinct
// from the existing ASCII-apostrophe "Phase 4b'" cross-cutting hook.
const PHASE_4B_DOUBLE_PRIME = "Phase 4b″";
const STEP_14_REPORT = "14. **Report**";

// The five mutually-exclusive outcome tokens (step-14 closing summary emits
// exactly one) plus the adoption-event token (emitted when discovery
// auto-adopts a single candidate).
const OUTCOME_TOKENS = [
  "verify_skill_passed",
  "verify_skill_failed_advisory",
  "verify_skill_failed_blocking",
  "verify_skill_manual_reminder",
  "verify_skill_none_declared",
] as const;
const ADOPTION_TOKEN = "verify_skill_adopted";
const ALL_TOKENS = [...OUTCOME_TOKENS, ADOPTION_TOKEN];

/** implement SKILL.md from the Phase 4b″ heading to the step-14 report. */
function phase4bSection(): string {
  const start = implementBody.indexOf(PHASE_4B_DOUBLE_PRIME);
  expect(start).toBeGreaterThan(-1);
  const end = implementBody.indexOf(STEP_14_REPORT);
  expect(end).toBeGreaterThan(start);
  return implementBody.slice(start, end);
}

/** implement SKILL.md from the Phase 4b″ heading to end of file. */
function phase4bOnward(): string {
  const start = implementBody.indexOf(PHASE_4B_DOUBLE_PRIME);
  expect(start).toBeGreaterThan(-1);
  return implementBody.slice(start);
}

describe("AC-STE-347.3 — implement SKILL.md Phase 4b″ section + placement", () => {
  test("carries a Phase 4b″ section named Project Verification", () => {
    expect(implementBody).toMatch(
      new RegExp(PHASE_4B_DOUBLE_PRIME + "[^\\n]{0,80}Project Verification"),
    );
  });

  test("Phase 4b″ sits after the Phase 4b′ hook and before the step-14 report", () => {
    const idx4bPrime = implementBody.indexOf("Phase 4b'");
    const idx4bDoublePrime = implementBody.indexOf(PHASE_4B_DOUBLE_PRIME);
    const idxStep14 = implementBody.indexOf(STEP_14_REPORT);
    expect(idx4bPrime).toBeGreaterThan(-1);
    expect(idxStep14).toBeGreaterThan(-1);
    expect(idx4bDoublePrime).toBeGreaterThan(idx4bPrime);
    expect(idx4bDoublePrime).toBeLessThan(idxStep14);
  });

  test("section states its run placement relative to Phase 4a and Phase 4c", () => {
    const section = phase4bSection();
    expect(section).toContain("Phase 4a");
    expect(section).toContain("Phase 4c");
  });

  test("section renders the check outcome into the step-14 report", () => {
    expect(phase4bSection()).toMatch(/step[ -]14/);
  });

  test("manual mode never auto-runs — one-line reminder naming the skill", () => {
    const section = phase4bSection();
    expect(section).toContain("manual");
    expect(section).toContain("reminder");
  });
});

describe("AC-STE-347.2 — discovery precedence prose in Phase 4b″", () => {
  test("names verify_skill as precedence step 1 and the .claude/skills scan as fallback", () => {
    const section = phase4bSection();
    expect(section).toContain("verify_skill");
    expect(section).toContain(".claude/skills/");
  });

  test("references the shared resolver helpers", () => {
    const section = phase4bSection();
    expect(section).toMatch(/readVerificationConfig|verification_config/);
    expect(section).toMatch(/scanCandidateCheckSkills|scan_candidate_check_skills/);
  });

  test("single candidate ⇒ adopt-offer writing verify_skill into ## Verification, never silently run", () => {
    const section = phase4bSection();
    expect(section).toContain("adopt");
    expect(section).toContain("## Verification");
    expect(section).toContain("never silently");
  });

  test("multiple candidates ⇒ list and ask, never guess", () => {
    expect(phase4bSection()).toContain("never guess");
  });

  test("zero candidates ⇒ the no-check-declared path", () => {
    expect(phase4bSection()).toContain("no check declared");
  });
});

// Robustness backfill (underspecified): the adopt-offer (path 2) and the
// scaffold / visual-check offer (path 4) both have a SAFE DEFAULT (decline →
// proceed), so they are advisory-class, NOT requires-input. In a
// non-interactive / autonomous run (the /smoke-test + /conformance-loop
// `claude -p` chain), the offers MUST default to decline and never block —
// otherwise an autonomous /implement child stalls at Phase 4b″. This makes
// the non-TTY behavior explicit so the autonomous path is deterministic.
describe("Phase 4b″ — non-interactive offers default to decline (autonomous safety)", () => {
  test("documents a non-interactive / non-TTY safe-decline default for the offers", () => {
    const section = phase4bSection();
    expect(section).toMatch(/non-interactive|non-TTY|autonomous/);
    expect(section).toMatch(/default[^.]*declin|declin[^.]*default|treat[^.]*declin/i);
  });

  test("states the non-interactive default never blocks the commit", () => {
    expect(phase4bSection()).toMatch(/never block/i);
  });
});

describe("AC-STE-347.4 — failure classification + propose (never auto-invoke)", () => {
  test("classifies failures as spec-gap or impl-bug", () => {
    const section = phase4bSection();
    expect(section).toContain("spec-gap");
    expect(section).toContain("impl-bug");
  });

  test("recommends the exact next command — /brainstorm or /spec-write or inline fix", () => {
    const section = phase4bSection();
    expect(section).toContain("/dev-process-toolkit:brainstorm");
    expect(section).toContain("/dev-process-toolkit:spec-write");
    expect(section).toMatch(/inline fix/i);
  });

  test("states the recommendation is never auto-invoked", () => {
    expect(phase4bSection()).toMatch(
      /(never|does (\*\*)?not(\*\*)?) auto-invoke/i,
    );
  });
});

describe("AC-STE-347.5 — verify_mode gating of the step-15 commit", () => {
  test("blocking mode gates step-15 commit approval (pass or explicit override)", () => {
    const onward = phase4bOnward();
    expect(onward).toContain("verify_mode: blocking");
    expect(onward).toMatch(/override/i);
  });

  test("advisory mode (the default) reports but does not block step-15", () => {
    const onward = phase4bOnward();
    expect(onward).toContain("verify_mode: advisory");
    expect(onward).toMatch(/default/i);
  });

  test("manual mode never blocks (no auto-run)", () => {
    expect(phase4bOnward()).toContain("never blocks");
  });
});

describe("AC-STE-347.6 — capability tokens (implement MUST-emit directives)", () => {
  for (const token of ALL_TOKENS) {
    test(`implement SKILL.md carries a backticked MUST-emit directive for ${token}`, () => {
      expect(implementBody).toMatch(
        new RegExp("MUST emit `" + token + "`"),
      );
    });
  }

  test("step-14 closing summary emits exactly one outcome token", () => {
    expect(phase4bOnward()).toMatch(/exactly one/i);
  });
});

describe("AC-STE-347.6 — spec-write § 7 static capability map", () => {
  const mapIdx = specWriteBody.indexOf("Static plain-language map");

  test("the static map marker exists", () => {
    expect(mapIdx).toBeGreaterThan(-1);
  });

  for (const token of ALL_TOKENS) {
    test(`static map carries the \`${token}\` capability key`, () => {
      const tokenIdx = specWriteBody.indexOf("`" + token + "`");
      expect(tokenIdx).toBeGreaterThan(mapIdx);
    });
  }
});

describe("AC-STE-347.1 — templates/CLAUDE.md.template documents ## Verification", () => {
  test("template carries a ## Verification block with both keys and the advisory default", () => {
    const start = templateBody.indexOf("## Verification");
    expect(start).toBeGreaterThan(-1);
    const next = templateBody.indexOf("\n## ", start + 1);
    const region =
      next === -1 ? templateBody.slice(start) : templateBody.slice(start, next);
    expect(region).toContain("verify_skill");
    expect(region).toContain("verify_mode");
    expect(region).toContain("advisory");
    expect(region).toMatch(/default/i);
  });
});

describe("AC-STE-347.1 — docs/layout-reference.md documents the convention", () => {
  test("layout-reference documents ## Verification with the closed key set and all three modes", () => {
    const start = layoutRefBody.indexOf("## Verification");
    expect(start).toBeGreaterThan(-1);
    const next = layoutRefBody.indexOf("\n## ", start + 1);
    const region =
      next === -1 ? layoutRefBody.slice(start) : layoutRefBody.slice(start, next);
    expect(region).toContain("verify_skill");
    expect(region).toContain("verify_mode");
    expect(region).toContain("advisory");
    expect(region).toContain("blocking");
    expect(region).toContain("manual");
    expect(region).toMatch(/closed/i);
  });

  test("layout-reference names the visual-check literal and the .claude/skills slug form", () => {
    const start = layoutRefBody.indexOf("## Verification");
    expect(start).toBeGreaterThan(-1);
    const next = layoutRefBody.indexOf("\n## ", start + 1);
    const region =
      next === -1 ? layoutRefBody.slice(start) : layoutRefBody.slice(start, next);
    expect(region).toContain("visual-check");
    expect(region).toContain(".claude/skills/");
  });
});
