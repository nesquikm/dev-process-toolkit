// Unit tests for scanCandidateCheckSkills (STE-347 AC-STE-347.2).
//
// Covers the read-only `.claude/skills/*/SKILL.md` candidate scan: slug
// substring matches (`drive` / `check` / `verify`), the frontmatter
// `verify: true` marker, empty results (dir absent or no candidates),
// 2-candidate ambiguity (all matches returned — caller decides), and
// deterministic slug-sorted ordering. Same mkdtemp-per-test isolation
// pattern as the sibling docs_config.test.ts.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanCandidateCheckSkills } from "./scan_candidate_check_skills";

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "dpt-scanck-"));
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

const PLAIN_SKILL_MD = `---
name: placeholder
description: a project-local skill
---

# Skill body
`;

const VERIFY_MARKED_SKILL_MD = `---
name: placeholder
description: a project-local skill
verify: true
---

# Skill body
`;

/** Create .claude/skills/<slug>/ with the given SKILL.md (null = no file). */
function addSkill(slug: string, skillMd: string | null = PLAIN_SKILL_MD): void {
  const dir = join(projectRoot, ".claude", "skills", slug);
  mkdirSync(dir, { recursive: true });
  if (skillMd !== null) writeFileSync(join(dir, "SKILL.md"), skillMd);
}

describe("scanCandidateCheckSkills — empty results (AC-STE-347.2)", () => {
  test("returns [] when .claude/skills is absent", () => {
    expect(scanCandidateCheckSkills(projectRoot)).toEqual([]);
  });

  test("returns [] when .claude/skills exists but is empty", () => {
    mkdirSync(join(projectRoot, ".claude", "skills"), { recursive: true });
    expect(scanCandidateCheckSkills(projectRoot)).toEqual([]);
  });

  test("returns [] when the only skill matches no slug pattern and has no marker", () => {
    addSkill("deploy");
    expect(scanCandidateCheckSkills(projectRoot)).toEqual([]);
  });
});

describe("scanCandidateCheckSkills — slug pattern matches (AC-STE-347.2)", () => {
  test("slug containing `drive` is a candidate", () => {
    addSkill("glacy-drive");
    addSkill("deploy"); // non-matching sibling excluded
    const result = scanCandidateCheckSkills(projectRoot);
    expect(result.length).toBe(1);
    expect(result[0]!.slug).toBe("glacy-drive");
    expect(result[0]!.path).toContain(".claude/skills/glacy-drive/SKILL.md");
  });

  test("slug containing `check` is a candidate", () => {
    addSkill("journey-check");
    const result = scanCandidateCheckSkills(projectRoot);
    expect(result.length).toBe(1);
    expect(result[0]!.slug).toBe("journey-check");
  });

  test("slug containing `verify` is a candidate", () => {
    addSkill("verify-ui");
    const result = scanCandidateCheckSkills(projectRoot);
    expect(result.length).toBe(1);
    expect(result[0]!.slug).toBe("verify-ui");
  });

  test("matching slug directory without a SKILL.md file is NOT a candidate", () => {
    addSkill("smoke-drive", null); // dir only, no SKILL.md
    expect(scanCandidateCheckSkills(projectRoot)).toEqual([]);
  });
});

describe("scanCandidateCheckSkills — frontmatter marker (AC-STE-347.2)", () => {
  test("non-matching slug with frontmatter `verify: true` is a candidate", () => {
    addSkill("smoke-journey", VERIFY_MARKED_SKILL_MD);
    const result = scanCandidateCheckSkills(projectRoot);
    expect(result.length).toBe(1);
    expect(result[0]!.slug).toBe("smoke-journey");
    expect(result[0]!.path).toContain(".claude/skills/smoke-journey/SKILL.md");
  });

  test("frontmatter `verify: false` is NOT a marker match", () => {
    addSkill(
      "deploy",
      `---\nname: deploy\nverify: false\n---\n\n# Skill body\n`,
    );
    expect(scanCandidateCheckSkills(projectRoot)).toEqual([]);
  });

  test("`verify: true` in the body (not frontmatter) is NOT a marker match", () => {
    addSkill(
      "deploy",
      `---\nname: deploy\n---\n\n# Skill body\n\nSet verify: true in frontmatter to mark a check skill.\n`,
    );
    expect(scanCandidateCheckSkills(projectRoot)).toEqual([]);
  });

  test("skill matched by BOTH slug and marker appears exactly once", () => {
    addSkill("drive-check", VERIFY_MARKED_SKILL_MD);
    const result = scanCandidateCheckSkills(projectRoot);
    expect(result.length).toBe(1);
    expect(result[0]!.slug).toBe("drive-check");
  });
});

describe("scanCandidateCheckSkills — ambiguity + determinism (AC-STE-347.2)", () => {
  test("two candidates ⇒ both returned (caller decides; never guesses)", () => {
    addSkill("glacy-drive");
    addSkill("verify-ui");
    addSkill("deploy"); // excluded
    const result = scanCandidateCheckSkills(projectRoot);
    expect(result.map((c) => c.slug)).toEqual(["glacy-drive", "verify-ui"]);
  });

  test("results are sorted by slug regardless of creation order", () => {
    addSkill("zz-drive");
    addSkill("aa-check");
    addSkill("mm-verify");
    const result = scanCandidateCheckSkills(projectRoot);
    expect(result.map((c) => c.slug)).toEqual([
      "aa-check",
      "mm-verify",
      "zz-drive",
    ]);
  });
});
