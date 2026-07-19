// M108 STE-391 AC-STE-391.2 + AC-STE-391.7 — the runner skill's contract
// prose, and /setup's best-effort upgrade hint.
//
// STE-49-shape doc-conformance greps: the runner sequence steps must be
// present in skills/upgrade/SKILL.md, the permission entry's never-auto-apply
// clause must be stated, the "Nothing to do." literal must appear, and
// skills/setup/SKILL.md must carry the `upgrade_available` audit-row hint.

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  COMMIT_PRODUCING_SKILLS,
  NON_COMMIT_PRODUCING_SKILLS,
} from "../adapters/_shared/src/commit_producing_skill_branch_gate";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const UPGRADE_SKILL = join(PLUGIN_ROOT, "skills", "upgrade", "SKILL.md");
const SETUP_SKILL = join(PLUGIN_ROOT, "skills", "setup", "SKILL.md");

const readUpgrade = (): string => readFileSync(UPGRADE_SKILL, "utf-8");
const readSetup = (): string => readFileSync(SETUP_SKILL, "utf-8");

const paragraphs = (body: string): string[] => body.split(/\n{2,}/);

// ---------------------------------------------------------------------------
// AC-STE-391.2 — the skill exists and is user-invocable
// ---------------------------------------------------------------------------

describe("AC-STE-391.2 — skills/upgrade/SKILL.md exists and Claude can invoke it", () => {
  test("the file exists", () => {
    expect(existsSync(UPGRADE_SKILL)).toBe(true);
  });

  // M109 AC-STE-395.1 inverted this assertion. `/upgrade` left the slash menu
  // (`user-invocable: false`) but did NOT become a dispatch fork — it carries
  // no `context: fork` and no `agent:`, so the model-invocation path probe #69's
  // remedy relies on stays intact. Non-user-invocable ≠ fork-dispatch, and the
  // two halves are asserted separately below.
  test("frontmatter names the skill `upgrade`, hides it from the menu, and is NOT a dispatch fork", () => {
    const fm = readUpgrade().match(/^---\n([\s\S]*?)\n---/);
    expect(fm).not.toBeNull();
    expect(fm![1]).toMatch(/^name:\s*upgrade\s*$/m);
    expect(fm![1]).toMatch(/user-invocable:\s*false/);
    expect(fm![1]).not.toMatch(/^context:\s*fork\s*$/m);
    expect(fm![1]).not.toMatch(/^agent:\s*\S/m);
    expect(fm![1]).toMatch(/^description:\s*\S/m);
  });

  test("the runner walks the shared migration registry, not a private list", () => {
    expect(readUpgrade()).toMatch(/adapters\/_shared\/src\/migrations|migration registry/i);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-391.2 — runner sequence steps
// ---------------------------------------------------------------------------

describe("AC-STE-391.2 — step 0: never-bootstrapped trees route to /setup", () => {
  test("a paragraph pairs the bootstrap probe with the /setup hand-off", () => {
    const hits = paragraphs(readUpgrade()).filter(
      (p) => p.includes("/setup") && /bootstrap/i.test(p),
    );
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });
});

// The stale-plugin advisory that once lived alongside this one was retired by
// M109 AC-STE-394.6 (structurally inert: the registry ships inside the plugin,
// so `max(introduced_in) <= installed` holds for every released build). Its
// presence assertion is SPEC-SUPERSEDED; `tests/m109-ste-394-docs-pins.test.ts`
// now pins its ABSENCE.
describe("AC-STE-391.2 — the preamble advisory is warn-only", () => {
  test("blanket `.dpt/` root-.gitignore advisory is present", () => {
    const hits = paragraphs(readUpgrade()).filter(
      (p) => p.includes(".dpt/") && p.includes(".gitignore") && /warn|advisor|blanket/i.test(p),
    );
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });
});

describe("AC-STE-391.2 — dirty-tree refusal (NFR-10 shape, offenders listed)", () => {
  test("the clean-tree gate uses git status --porcelain", () => {
    expect(readUpgrade()).toContain("git status --porcelain");
  });

  test("the refusal carries the NFR-10 canonical shape and lists offenders", () => {
    const body = readUpgrade();
    expect(body).toMatch(/Refusing/);
    expect(body).toMatch(/Remedy/);
    const hits = paragraphs(body).filter(
      (p) => /dirty|porcelain/i.test(p) && /offender/i.test(p),
    );
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });
});

describe("AC-STE-391.2 — detector walk, preview, and the ONE approval commit", () => {
  test("the walk presents the detected set", () => {
    expect(readUpgrade()).toMatch(/detected set/i);
  });

  test("script entries apply with a diff preview", () => {
    expect(readUpgrade()).toMatch(/diff preview/i);
  });

  test("ONE approval commit for the batch, with the pinned subject", () => {
    const body = readUpgrade();
    expect(body).toContain("chore(upgrade): apply toolkit migrations");
    expect(body).toMatch(/one approval commit|single approval commit/i);
  });

  test("assisted entries route to their own documented flow", () => {
    const hits = paragraphs(readUpgrade()).filter(
      (p) => /assisted/i.test(p) && /flow/i.test(p),
    );
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  test('zero detections exits with the literal "Nothing to do."', () => {
    expect(readUpgrade()).toContain("Nothing to do.");
  });
});

describe("AC-STE-391.2 — the permission entry NEVER auto-applies", () => {
  test("the never-auto-apply clause is stated against the auto-approve marker", () => {
    const body = readUpgrade();
    expect(body).toMatch(/never auto-appl/i);
    expect(body).toMatch(/auto-approve marker/);
  });

  test("a paragraph ties the permission entry to explicit per-entry approval", () => {
    const hits = paragraphs(readUpgrade()).filter(
      (p) => /permission/i.test(p) && /explicit/i.test(p) && /approval/i.test(p),
    );
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-391.7 — /setup emits the upgrade hint
// ---------------------------------------------------------------------------

// M109 AC-STE-395.5 re-keyed the recommendation target. `/upgrade` is off the
// slash menu, so telling a human to run it is a dead instruction; the row now
// points at `/gate-check`, whose probe #69 reports the drift and hands Claude
// the remedy. The `upgrade_available` capability key is unchanged — only the
// user-facing invocation literal moved.
describe("AC-STE-391.7 — /setup audit row routes a legacy tree at /gate-check", () => {
  test("the capability key `upgrade_available` appears in skills/setup/SKILL.md", () => {
    expect(readSetup()).toContain("upgrade_available");
  });

  test("the row no longer recommends the de-listed runner by invocation name", () => {
    expect(readSetup()).not.toContain("/dev-process-toolkit:upgrade");
  });

  test("the row recommends /gate-check instead", () => {
    expect(readSetup()).toMatch(/gate-check/);
  });

  test("the hint is best-effort and wired to the registry detectors (STE-133 precedent)", () => {
    const hits = paragraphs(readSetup()).filter(
      (p) =>
        p.includes("upgrade_available") &&
        /best-effort/i.test(p) &&
        /detector|migration|registry/i.test(p),
    );
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  test("the detection walk never blocks or fails /setup", () => {
    const hits = paragraphs(readSetup()).filter(
      (p) =>
        p.includes("upgrade_available") &&
        /never (blocks|fails)|does not (block|fail)|without (blocking|failing)|continues/i.test(p),
    );
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-391.2 — the branch gate the skill claims must actually apply.
//
// The skill states it is commit-producing and that "the normal commit-producing
// branch gate applies". That claim is only true if `upgrade` is registered in
// COMMIT_PRODUCING_SKILLS — the probe silently ignores unregistered skills, so
// an unregistered commit-producing skill can commit straight to trunk while the
// gate stays green. Caught by the STE-391 AUDIT pass.
// ---------------------------------------------------------------------------

describe("AC-STE-391.2 — /upgrade is registered under the commit-producing branch gate", () => {
  test("`upgrade` is on the canonical commit-producing list", () => {
    expect(COMMIT_PRODUCING_SKILLS).toContain("upgrade");
  });

  test("`upgrade` is not double-registered as non-commit-producing", () => {
    expect(NON_COMMIT_PRODUCING_SKILLS).not.toContain("upgrade");
  });

  test("the skill references the gate symbol its prose promises", () => {
    expect(readUpgrade()).toContain("requireCommittableBranch");
  });
});
