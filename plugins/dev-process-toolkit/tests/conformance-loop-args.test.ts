import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

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
  test("argument-parsing section names all five flags", () => {
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

  test("--dry-run is documented as test-only (mocks subprocess spawn)", () => {
    const body = skill!;
    // Must mention mocking the subprocess spawn so the integration test
    // covers the parallelism path without invoking real claude -p children.
    expect(body).toMatch(/--dry-run[\s\S]{0,400}mock/i);
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
    // Refusal must list the supported flag set in the remedy line.
    expect(block).toMatch(/Remedy:[\s\S]{0,400}--auto-fix[\s\S]{0,400}--max-iterations[\s\S]{0,400}--linear-team[\s\S]{0,400}--jira-project[\s\S]{0,400}--dry-run/);
  });
});
