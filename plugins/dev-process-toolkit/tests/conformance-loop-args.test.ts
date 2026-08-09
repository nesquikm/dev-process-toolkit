import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { SMOKE_LEGS } from "../adapters/_shared/src/smoke_fixture_groups";

// STE-224 AC-STE-224.2 — /conformance-loop argument parsing doc-conformance.
// The skill is project-local (lives in .claude/skills/conformance-loop/) and
// argument-parsing happens in skill prose, not TypeScript code — these tests
// assert the prose contract is intact, same pattern as
// `smoke-test-driver-hardening.test.ts`.

const repoRoot = join(import.meta.dir, "..", "..", "..");
const skillPath = join(repoRoot, ".claude", "skills", "conformance-loop", "SKILL.md");

function readSkillIfPresent(): string | null {
  if (!existsSync(skillPath)) return null;
  return readFileSync(skillPath, "utf8");
}

const skill = readSkillIfPresent();
const describeIfPresent = skill === null ? describe.skip : describe;

describeIfPresent("STE-224 AC-STE-224.2 — argument parsing flags", () => {
  test("argument-parsing section names all six flags", () => {
    const body = skill!;
    const argSection = body.indexOf("## Argument parsing");
    expect(argSection).toBeGreaterThan(-1);
    const tail = body.slice(argSection);
    const next = tail.search(/\n## \S/);
    const block = next === -1 ? tail : tail.slice(0, next);
    expect(block).toContain("--auto-fix");
    expect(block).toContain("--max-iterations");
    expect(block).toContain("--linear-team");
    expect(block).toContain("--jira-project");
    expect(block).toContain("--dry-run");
    expect(block).toContain("--legs");
  });

  test("--legs defaults to every registered leg and is the documented opt-out", () => {
    const body = skill!;
    expect(body).toMatch(/--legs[\s\S]{0,300}every leg registered in `SMOKE_LEGS`/);
  });

  test("--legs is advertised in the frontmatter argument-hint, with the CURRENT leg set", () => {
    // An operator-facing flag the skill parses but does not advertise is a
    // flag nobody discovers; the argument-hint is the only surface the slash
    // menu shows.
    //
    // Pinned to SMOKE_LEGS, not merely to the flag name. STE-447 introduced
    // this literal and the remedy literal below INSIDE the milestone whose
    // purpose is deleting hand-maintained copies of the leg set; asserting
    // only `toContain("--legs")` would have let both go stale on a fourth leg
    // with nothing red. Contrast the poll-loop word list, which AC.9 made
    // enum-derived — these two are the same class and now carry the same pin.
    const hint = /^argument-hint:.*$/m.exec(skill!)?.[0] ?? "";
    expect(hint.length).toBeGreaterThan(0);
    expect(hint).toContain(`--legs ${SMOKE_LEGS.join(",")}`);
  });

  test("the unknown-flag remedy advertises the CURRENT leg set", () => {
    const argSection = skill!.indexOf("## Argument parsing");
    const block = skill!.slice(argSection, skill!.indexOf("\n## ", argSection + 1));
    expect(block).toContain(`--legs ${SMOKE_LEGS.join(",")}`);
  });

  test("--auto-fix defaults OFF (capture-only is the default mode)", () => {
    const body = skill!;
    // Must explicitly call out the default OFF and the capture-only consequence.
    expect(body).toMatch(/--auto-fix[^\n]*default\s*OFF/i);
    expect(body).toMatch(/capture-only/i);
  });

  test("--max-iterations defaults to 3", () => {
    const body = skill!;
    expect(body).toMatch(/--max-iterations[\s\S]{0,200}default\s*3/i);
  });

  test("--linear-team defaults to STE", () => {
    const body = skill!;
    expect(body).toMatch(/--linear-team[\s\S]{0,200}STE/);
  });

  test("--jira-project is required when the Jira child fires", () => {
    const body = skill!;
    expect(body).toMatch(/--jira-project[\s\S]{0,200}required/i);
  });

  test("--dry-run is documented as INERT — no mechanism is claimed for it", () => {
    // REPLACED BY STE-453, and the replacement is forced rather than chosen.
    //
    // This assertion used to be `/--dry-run[\s\S]{0,400}mock/i`, enforcing
    // AC-STE-224.2's clause "`--dry-run` (mocks subprocess for unit tests)".
    // No mock was ever built: no branch, fence or conditional in the driver
    // reads the flag, and the "fixture directory" the prose named has never
    // existed in this repository. AC-STE-453.1 requires the prose to describe
    // only what ships, so the clause had to go.
    //
    // The trap this walks around is why the old regex could not simply be
    // kept: honest prose saying "there is no mock, no canned findings and no
    // fixture directory" SATISFIES it. Keeping the pin would have produced a
    // green assertion whose subject had been deleted — the exact defect M121
    // exists to eliminate — so it is replaced by a positive pin on the honest
    // statement, which a return of the vaporware claim turns RED.
    //
    // AC-STE-224.2 and AC-STE-453.1 cannot both hold. Neither is amended; the
    // pair is recorded in `specs/plan/M121.md`.
    const body = skill!;
    expect(body).toMatch(/--dry-run[\s\S]{0,400}nothing in this document reads it/i);
    expect(body).not.toMatch(/--dry-run[^\n]*(?<!no )(?<!there is no )mocks the subprocess/i);
  });
});

describeIfPresent("STE-224 AC-STE-224.2 — unknown-flag refusal", () => {
  test("unknown flag refuses with NFR-10 canonical shape naming the supported set", () => {
    const body = skill!;
    // Refusal block must name all five flags so the operator can re-invoke.
    const argSection = body.indexOf("## Argument parsing");
    const next = body.slice(argSection).search(/\n## \S/);
    const block = next === -1 ? body.slice(argSection) : body.slice(argSection, argSection + next);
    expect(block).toMatch(/Unknown flag/);
    expect(block).toMatch(/Remedy:/);
    expect(block).toMatch(/Context:/);
    expect(block).toContain("skill=conformance-loop");
    // Refusal must list the supported flag set in the remedy line — all SIX,
    // including --legs. Leaving --legs out would have kept this green while
    // the refusal misdirected the operator away from a flag the skill ships.
    expect(block).toMatch(/Remedy:[\s\S]{0,400}--auto-fix[\s\S]{0,400}--max-iterations[\s\S]{0,400}--linear-team[\s\S]{0,400}--jira-project[\s\S]{0,400}--dry-run[\s\S]{0,400}--legs/);
  });
});
