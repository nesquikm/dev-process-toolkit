// Meta-tests for STE-348 — /setup check-skill generator + /implement
// scaffold-if-missing + /visual-check fallback (M93, FR-B).
//
// Prose + template contracts asserted (AC-STE-348.1 .. AC-STE-348.5):
//   - templates/check-skill/{flutter,web,python,generic}.SKILL.md.template
//     each exist, are non-empty, and are runnable-shaped (frontmatter with
//     disable-model-invocation:true + name + description + allowed-tools,
//     ## What this checks, ## How to run, a TODO marker, and a link to the
//     STE-349 authoring guide docs/verification-skills.md).
//   - skills/setup/SKILL.md carries a compact opt-in seed step (check-skill
//     scaffold, .claude/skills/, writes verify_skill on accept, stack-aware,
//     skippable), with the full procedure offloaded to docs/setup-reference.md.
//   - skills/implement/SKILL.md Phase 4b″ no-check branch carries the
//     scaffold-if-missing offer, the /visual-check fallback for a small web
//     project, the "no verification configured" decline note, and the
//     never-auto-write-without-offer guarantee.
//   - skills/visual-check/SKILL.md notes `verify_skill: visual-check` is a
//     valid ## Verification value.
//   - skills/spec-write/SKILL.md § 7 static map carries the two NEW keys
//     verify_skill_scaffolded + verify_skill_scaffold_declined (folded into
//     the existing verify_skill_* combined row — a bare literal grep, never a
//     new-row assertion, so the 350-line cap is not tripped).
//
// IMPORTANT: assertions are phrase/token literals only — they never require
// STE-/AC-namespace tokens in skills/** or templates/** prose (the
// shipped-prose namespace ceiling test caps those with zero headroom). This
// file's own comments cite AC IDs freely (tests/ is not shipped).

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const pluginRoot = join(import.meta.dir, "..");

const read = (...parts: string[]): string =>
  readFileSync(join(pluginRoot, ...parts), "utf8");

// Existing files — safe to read at module load.
const setupBody = read("skills", "setup", "SKILL.md");
const setupRefBody = read("docs", "setup-reference.md");
const implementBody = read("skills", "implement", "SKILL.md");
const visualCheckBody = read("skills", "visual-check", "SKILL.md");
const specWriteBody = read("skills", "spec-write", "SKILL.md");

const STACK_KEYS = ["flutter", "web", "python", "generic"] as const;
const GUIDE_PATH = "docs/verification-skills.md";

/**
 * Read a check-skill template on demand (inside the test body) so a missing
 * file surfaces as a clean per-test RED rather than a module-load error.
 */
function readTemplate(key: string): string {
  return read("templates", "check-skill", `${key}.SKILL.md.template`);
}

/**
 * The enclosing ##/###/#### section around the first occurrence of `anchor`
 * in `body` (from its heading to the next heading). Scopes generic-word
 * assertions to the new seed step so words like "opt-in" / "stack-aware"
 * that already live elsewhere in the file cannot false-green. The
 * `expect(anchor present)` guard makes the whole region RED until the step
 * lands.
 */
function enclosingSection(body: string, anchor: string | RegExp): string {
  const idx = typeof anchor === "string" ? body.indexOf(anchor) : body.search(anchor);
  expect(idx).toBeGreaterThan(-1);
  const before = body.slice(0, idx);
  const heads = [...before.matchAll(/\n#{2,4} /g)];
  const start = heads.length ? heads[heads.length - 1]!.index! : 0;
  const after = body.slice(idx);
  const nextRel = after.search(/\n#{2,4} /);
  const end = nextRel === -1 ? body.length : idx + nextRel;
  return body.slice(start, end);
}

describe("AC-STE-348.2 — check-skill templates exist and are runnable-shaped", () => {
  for (const key of STACK_KEYS) {
    describe(`templates/check-skill/${key}.SKILL.md.template`, () => {
      test("exists and is non-empty", () => {
        const body = readTemplate(key);
        expect(body.trim().length).toBeGreaterThan(0);
      });

      test("carries disable-model-invocation: true", () => {
        expect(readTemplate(key)).toContain("disable-model-invocation: true");
      });

      test("carries name: + description: frontmatter keys", () => {
        const body = readTemplate(key);
        expect(body).toMatch(/^name:/m);
        expect(body).toMatch(/^description:/m);
      });

      test("carries an allowed-tools: key", () => {
        expect(readTemplate(key)).toMatch(/^allowed-tools:/m);
      });

      test("carries the ## What this checks and ## How to run sections", () => {
        const body = readTemplate(key);
        expect(body).toContain("## What this checks");
        expect(body).toContain("## How to run");
      });

      test("carries at least one TODO placeholder", () => {
        expect(readTemplate(key)).toContain("TODO");
      });

      test("links the STE-349 authoring guide (docs/verification-skills.md)", () => {
        expect(readTemplate(key)).toContain(GUIDE_PATH);
      });
    });
  }
});

describe("AC-STE-348.1 — /setup opt-in seed step (compact contract in SKILL.md)", () => {
  // The whole seed step, scoped by its sole `.claude/skills/` write target.
  // `.claude/skills/` is absent from setup/SKILL.md today, so every
  // region-scoped assertion below is RED until the step lands — and scoping
  // stops "opt-in" (§7b tracker heading) / "Stack-appropriate" (.gitignore
  // note) elsewhere in the file from false-greening.
  const seedRegion = () => enclosingSection(setupBody, ".claude/skills/");

  test("targets .claude/skills/ and writes verify_skill on accept", () => {
    const region = seedRegion();
    expect(region).toContain(".claude/skills/");
    expect(region).toContain("verify_skill");
  });

  test("names a check-skill scaffold", () => {
    expect(seedRegion()).toMatch(/check[- ]skill/i);
  });

  test("is stack-aware", () => {
    expect(seedRegion()).toMatch(/stack-aware|stack-appropriate/i);
  });

  test("is opt-in / skippable", () => {
    expect(seedRegion()).toMatch(/opt-in|skippable/i);
  });
});

describe("AC-STE-348.1 — /setup full procedure elaboration in docs/setup-reference.md", () => {
  test("carries a check-skill scaffold section", () => {
    expect(setupRefBody).toMatch(/check[- ]skill/i);
  });

  // Region-scoped to the new section so `decline` can't false-green elsewhere.
  test("the section documents the disable marker, verify_skill write, and decline no-op", () => {
    const idx = setupRefBody.search(/check[- ]skill/i);
    expect(idx).toBeGreaterThan(-1);
    const rest = setupRefBody.slice(idx);
    const next = rest.indexOf("\n## ", 1);
    const region = next === -1 ? rest : rest.slice(0, next);
    expect(region).toContain("disable-model-invocation");
    expect(region).toContain("verify_skill");
    expect(region).toMatch(/decline|no-op/i);
  });
});

describe("AC-STE-348.3 — /implement Phase 4b″ scaffold-if-missing offer", () => {
  const PHASE = "Phase 4b″";
  const END = "### Commit message format";

  /** The Phase 4b″ section body (heading → commit-message subsection). */
  function phase4bSection(): string {
    const start = implementBody.indexOf(PHASE);
    expect(start).toBeGreaterThan(-1);
    const end = implementBody.indexOf(END);
    expect(end).toBeGreaterThan(start);
    return implementBody.slice(start, end);
  }

  test("offers to scaffold a check skill when none is declared/adopted", () => {
    const section = phase4bSection();
    expect(section).toMatch(/scaffold/i);
    expect(section).toMatch(/offer/i);
  });

  test("offers /dev-process-toolkit:visual-check as a fallback for a small web project", () => {
    const section = phase4bSection();
    expect(section).toContain("/dev-process-toolkit:visual-check");
    expect(section).toMatch(/web/i);
  });

  test("on decline, proceeds to the step-14 report with a 'no verification configured' note", () => {
    expect(phase4bSection()).toContain("no verification configured");
  });

  test("never writes a skill without the offer", () => {
    // Narrow to "never writes/scaffolds" — NOT the pre-existing "never
    // auto-invokes" (failure-recommendation guarantee), which is a different
    // contract and would false-green a looser regex.
    const section = phase4bSection();
    expect(section).toMatch(/never (writes?|scaffolds?)/i);
  });
});

describe("AC-STE-348.4 — /visual-check is a valid verify_skill value", () => {
  test("visual-check SKILL.md notes verify_skill: visual-check is valid", () => {
    expect(visualCheckBody).toContain("verify_skill: visual-check");
  });
});

describe("AC-STE-348.5 — spec-write § 7 static map carries the two new keys", () => {
  const NEW_KEYS = [
    "verify_skill_scaffolded",
    "verify_skill_scaffold_declined",
  ] as const;

  const mapIdx = specWriteBody.indexOf("Static plain-language map");

  test("the static map marker exists", () => {
    expect(mapIdx).toBeGreaterThan(-1);
  });

  for (const key of NEW_KEYS) {
    test(`static map carries the \`${key}\` capability key (bare literal — combined-row OK)`, () => {
      const tokenIdx = specWriteBody.indexOf("`" + key + "`");
      expect(tokenIdx).toBeGreaterThan(mapIdx);
    });
  }
});
