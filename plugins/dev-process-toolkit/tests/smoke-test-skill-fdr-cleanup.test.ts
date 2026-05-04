// STE-218 — `.claude/skills/smoke-test/SKILL.md` cleanup. Removes the
// `## smoke-test runs` reference table at the bottom of the file and
// inlines the F-DR rationale at each of the 9 inline reference sites so
// the body stands alone (a fresh reader can understand each driver-side
// workaround without the lookup table). Per the M55 brainstorm decision.

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Locate the smoke-test SKILL.md from the test file at runtime. The skill
// lives at `<repoRoot>/.claude/skills/smoke-test/SKILL.md`. From this test
// file (`plugins/dev-process-toolkit/tests/`), repoRoot is two levels up.
const repoRoot = join(import.meta.dir, "..", "..", "..");
const skillPath = join(repoRoot, ".claude", "skills", "smoke-test", "SKILL.md");

describe("AC-STE-218.1 — `## smoke-test runs` section is removed", () => {
  test("the SKILL.md file exists at the expected path", () => {
    // Guard against path drift; the AC is meaningful only if we're reading
    // the right file.
    expect(existsSync(skillPath)).toBe(true);
  });

  test("the `## smoke-test runs` heading is absent post-fix", () => {
    const body = readFileSync(skillPath, "utf-8");
    expect(body).not.toMatch(/^## smoke-test runs\b/m);
  });
});

describe("AC-STE-218.2 — F-DR codes scrubbed; run #N references scrubbed", () => {
  test("zero `F-DR<N>` codes remain in the file", () => {
    const body = readFileSync(skillPath, "utf-8");
    expect(body).not.toMatch(/F-DR\d/);
  });

  test("zero `run #<N>` references remain in the file", () => {
    const body = readFileSync(skillPath, "utf-8");
    // Both lower-case `run` and capitalised `Run` shapes (the AC scrub
    // includes both).
    expect(body).not.toMatch(/\brun #\d/);
    expect(body).not.toMatch(/\bRun #\d/);
  });
});

describe("AC-STE-218.3 — body stands alone; line-12 pointer removed", () => {
  test("the introduction does NOT direct readers to a `§ smoke-test runs` section", () => {
    const body = readFileSync(skillPath, "utf-8");
    expect(body).not.toMatch(/§\s*smoke-test runs/);
    expect(body).not.toMatch(/the bottom of this file for the full reference-run list/);
  });
});

describe("AC-STE-218.5 — the canonical grep returns 0", () => {
  test("the AC's `grep` count returns 0 across all four patterns", () => {
    const body = readFileSync(skillPath, "utf-8");
    const matches =
      (body.match(/F-DR/g) || []).length +
      (body.match(/run #\d/g) || []).length +
      (body.match(/Run #\d/g) || []).length +
      (body.match(/^## smoke-test runs/gm) || []).length;
    expect(matches).toBe(0);
  });
});

describe("AC-STE-218.4 — intra-file section references preserved (regression guard)", () => {
  test("`§ Threat model` cross-reference still resolves to a real section", () => {
    const body = readFileSync(skillPath, "utf-8");
    // The Threat model section is intra-file (not run-table); the cleanup
    // must not touch it. We assert the heading exists when the file has
    // a § Threat model reference.
    if (/§\s*Threat model/.test(body) || /\*\*Threat model/.test(body)) {
      expect(body).toMatch(/^##.*Threat model/m);
    }
  });
});

describe("AC-STE-218.2 — each inline replacement carries its constraint inline", () => {
  test("driver-side workarounds reference the four constraints by content (not by F-DR code)", () => {
    const body = readFileSync(skillPath, "utf-8");
    // Smoke driver workarounds must read coherently after the cleanup.
    // Pin the four substantive constraints from the FR's substitution
    // table (STE-218 § Technical Design).
    expect(body).toMatch(/claude-st`?\s*zsh alias|claude-st\s+(?:alias|zsh)/i);
    expect(body).toMatch(/disable-model-invocation/);
    expect(body).toMatch(/--plugin-dir/);
    expect(body).toMatch(/sensitive-path classification/i);
  });
});
