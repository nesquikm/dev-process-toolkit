import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// STE-360 AC-STE-360.2 — /setup's bootstrap-commit prose (SKILL.md step 8b)
// documents that `src/.placeholder.test.ts` (the STE-113 Bun zero-match
// workaround) is exempt from the pre-commit-tdd-orchestrator hook via its
// marker comment and rides the bootstrap commit. Doc-conformance only; the
// hook behavior itself is pinned by
// tests/hook-modules-pre-commit-tdd-orchestrator.test.ts.

const pluginRoot = join(import.meta.dir, "..");
const skillPath = join(pluginRoot, "skills", "setup", "SKILL.md");

function readSkill(): string {
  return readFileSync(skillPath, "utf8");
}

function extractStep8b(body: string): string {
  const start = body.search(/\n### 8b\. Bootstrap commit/);
  expect(start).toBeGreaterThan(-1);
  const remainder = body.slice(start + 1);
  const endRelative = remainder.search(/\n### |\n## /);
  return endRelative === -1
    ? body.slice(start)
    : body.slice(start, start + 1 + endRelative);
}

describe("AC-STE-360.2 — bootstrap-commit prose documents the placeholder exemption", () => {
  test("step 8b names the placeholder so it rides the bootstrap commit", () => {
    const step = extractStep8b(readSkill());
    expect(step).toContain(".placeholder.test.ts");
  });

  test("step 8b documents the hook exemption", () => {
    const step = extractStep8b(readSkill());
    expect(step).toMatch(/exempt/i);
    expect(step).toMatch(/pre-commit-tdd-orchestrator|pre-commit \/tdd|hook/i);
  });

  test("step 8b cites the marker comment as the exemption key", () => {
    const step = extractStep8b(readSkill());
    expect(step).toContain("Bun zero-match workaround");
  });
});
