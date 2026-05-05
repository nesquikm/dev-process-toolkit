import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// STE-224 — /conformance-loop --dry-run integration coverage. The skill is
// pure prose for the LLM; --dry-run mocks the subprocess spawn so the
// parallelism + aggregation + termination paths can be exercised without
// invoking real `claude -p` children. This test asserts the prose contract
// for the --dry-run path is intact.

const repoRoot = join(import.meta.dir, "..", "..", "..");
const skillPath = join(repoRoot, ".claude", "skills", "conformance-loop", "SKILL.md");

function readSkillIfPresent(): string | null {
  if (!existsSync(skillPath)) return null;
  return readFileSync(skillPath, "utf8");
}

const skill = readSkillIfPresent();
const describeIfPresent = skill === null ? describe.skip : describe;

describeIfPresent("STE-224 --dry-run integration contract", () => {
  test("--dry-run is documented in the argument-parsing section", () => {
    const body = skill!;
    const argSection = body.indexOf("## Argument parsing");
    expect(argSection).toBeGreaterThan(-1);
    const tail = body.slice(argSection);
    const next = tail.search(/\n## \S/);
    const block = next === -1 ? tail : tail.slice(0, next);
    expect(block).toContain("--dry-run");
  });

  test("--dry-run mocks the subprocess spawn (no real claude -p children)", () => {
    const body = skill!;
    expect(body).toMatch(/--dry-run[\s\S]{0,500}mock/i);
    expect(body).toMatch(/--dry-run[\s\S]{0,500}(canned|fixture|without invoking real)/i);
  });

  test("--dry-run wires the same Phase A and termination paths as a real run", () => {
    const body = skill!;
    // The dry-run path must not fork the implementation — only the subprocess
    // call is replaced. Asserts the prose calls out the shared path.
    expect(body).toMatch(/--dry-run[\s\S]{0,500}(same|wires|covers)[\s\S]{0,200}(Phase A|aggregation|termination)/i);
  });

  test("--dry-run is named as a test-only flag (operators always run live)", () => {
    const body = skill!;
    // The Rules section must call out that operators don't use --dry-run.
    const rulesAt = body.indexOf("## Rules");
    expect(rulesAt).toBeGreaterThan(-1);
    const tail = body.slice(rulesAt);
    const next = tail.search(/\n## \S/);
    const block = next === -1 ? tail : tail.slice(0, next);
    expect(block).toMatch(/--dry-run[\s\S]{0,300}(test|integration)/i);
    expect(block).toMatch(/operator/i);
  });

  test("integration-test scope: parallelism + aggregation + termination", () => {
    const body = skill!;
    // The --dry-run paragraph must explicitly enumerate what the integration
    // test covers — parallelism mechanics, aggregation, termination — so the
    // operator understands the scope of the dry-run path's coverage. Scoped
    // to the argument-parsing section (mirrors the slicing technique in the
    // sibling args.test.ts) so a future edit that mentions these terms
    // elsewhere in the skill cannot mask a missing claim in the --dry-run
    // paragraph.
    const argSection = body.indexOf("## Argument parsing");
    expect(argSection).toBeGreaterThan(-1);
    const tail = body.slice(argSection);
    const next = tail.search(/\n## \S/);
    const block = next === -1 ? tail : tail.slice(0, next);
    expect(block).toMatch(/--dry-run[\s\S]{0,500}parallelism/i);
    expect(block).toMatch(/--dry-run[\s\S]{0,500}aggregation/i);
    expect(block).toMatch(/--dry-run[\s\S]{0,500}termination/i);
  });

  test("--dry-run integration test file path is named in the description", () => {
    const body = skill!;
    expect(body).toMatch(/conformance-loop-dry-run\.test\.ts/);
  });
});
