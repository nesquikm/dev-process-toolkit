import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// STE-224 AC-STE-224.8 — termination logic doc-conformance. Three exit
// conditions: green, max-iterations, no-progress.

const repoRoot = join(import.meta.dir, "..", "..", "..");
const skillPath = join(repoRoot, ".claude", "skills", "conformance-loop", "SKILL.md");

function readSkillIfPresent(): string | null {
  if (!existsSync(skillPath)) return null;
  return readFileSync(skillPath, "utf8");
}

const skill = readSkillIfPresent();
const describeIfPresent = skill === null ? describe.skip : describe;

describeIfPresent("STE-224 AC-STE-224.8 — termination logic", () => {
  test("Termination section names all three exit modes", () => {
    const body = skill!;
    const termAt = body.indexOf("### Termination");
    expect(termAt).toBeGreaterThan(-1);
    const tail = body.slice(termAt);
    const next = tail.search(/\n### \S/);
    const block = next === -1 ? tail : tail.slice(0, next);
    expect(block).toMatch(/`green`/);
    expect(block).toMatch(/`max-iterations`/);
    expect(block).toMatch(/`no-progress`/);
  });

  test("green exit fires when both per-tracker findings have zero **Severity:** high lines", () => {
    const body = skill!;
    expect(body).toMatch(/HIGH_LINEAR/);
    expect(body).toMatch(/HIGH_JIRA/);
    // grep -c on the canonical Severity line in both files. The bash command
    // carries the grep-escape `\*\*` form, so match that literal here.
    expect(body).toMatch(/grep -c[\s\S]{0,80}\\\*\\\*Severity:\\\*\\\*\s*high/);
    // Both must equal 0 to trip green.
    expect(body).toMatch(/HIGH_LINEAR.*-eq\s*0[\s\S]{0,80}HIGH_JIRA.*-eq\s*0/);
    expect(body).toMatch(/STATUS=green/);
  });

  test("max-iterations exit fires when ITER >= --max-iterations counter", () => {
    const body = skill!;
    expect(body).toMatch(/STATUS=max-iterations/);
    expect(body).toMatch(/ITER.*-ge.*MAX_ITERATIONS/);
  });

  test("no-progress exit fires on byte-identical aggregated diff", () => {
    const body = skill!;
    expect(body).toMatch(/STATUS=no-progress/);
    // cmp -s comparing iter-N to iter-(N-1).
    expect(body).toMatch(/cmp -s[\s\S]{0,80}PREV[\s\S]{0,80}CURR/);
  });

  test("no-progress exit also fires on zero git rev-parse HEAD advance after Phase B", () => {
    const body = skill!;
    expect(body).toMatch(/git rev-parse HEAD/);
    expect(body).toMatch(/HEAD_BEFORE_PHASE_B/);
    expect(body).toMatch(/HEAD_AFTER_PHASE_B/);
  });

  test("capture-only short-circuits after iteration 1 with --auto-fix OFF", () => {
    const body = skill!;
    expect(body).toMatch(/Capture-only short-circuit/i);
    expect(body).toMatch(/iter\s*==?\s*1/i);
    expect(body).toMatch(/STATUS=capture-only/);
  });

  test("termination probes are checked in documented order (green first, max-iterations next, no-progress last)", () => {
    const body = skill!;
    const termAt = body.indexOf("### Termination");
    const tail = body.slice(termAt);
    const greenAt = tail.search(/`green`/);
    const maxAt = tail.search(/`max-iterations`/);
    const noProgAt = tail.search(/`no-progress`/);
    expect(greenAt).toBeGreaterThan(-1);
    expect(maxAt).toBeGreaterThan(greenAt);
    expect(noProgAt).toBeGreaterThan(maxAt);
  });
});
