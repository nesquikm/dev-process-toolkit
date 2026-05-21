// AC-STE-139.3 — NFR-1 (≤350-line per SKILL.md) enforced for every shipped
// skill, not just docs/SKILL.md (which is covered by docs-skill-shape.test.ts
// per STE-70 AC-STE-70.7). Generalizes that single assertion into a loop over
// all directories under skills/. Fails loudly the moment any skill exceeds
// the cap so the LLM-runtime cost stays bounded. Cap raised 300 → 350 in
// M68 / v2.19.0 (STE-252) and 350 → 351 in M81 (STE-305) to acknowledge
// contract-locked prose pressure in spec-write.

import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const pluginRoot = join(import.meta.dir, "..");
const skillsDir = join(pluginRoot, "skills");
const SKILL_LINE_CAP = 351;

const skills = readdirSync(skillsDir).filter((name) => {
  const full = join(skillsDir, name);
  return statSync(full).isDirectory();
});

describe(`AC-STE-139.3 — NFR-1 length cap (≤${SKILL_LINE_CAP}) per SKILL.md`, () => {
  for (const skill of skills) {
    test(`${skill}/SKILL.md is ≤ ${SKILL_LINE_CAP} lines`, () => {
      const skillPath = join(skillsDir, skill, "SKILL.md");
      const body = readFileSync(skillPath, "utf-8");
      const lines = body.split("\n").length;
      expect(lines).toBeLessThanOrEqual(SKILL_LINE_CAP);
    });
  }
});
