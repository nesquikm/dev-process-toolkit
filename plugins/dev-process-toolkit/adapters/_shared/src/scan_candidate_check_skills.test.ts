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
import {
  SLUG_PATTERNS,
  scanCandidateCheckSkills,
} from "./scan_candidate_check_skills";

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

// ---------------------------------------------------------------------------
// STE-506 (M131) — the frontmatter arm and the list-and-ask path, asserted
// end-to-end against the real scanner rather than assumed from the prose.
// ---------------------------------------------------------------------------

/** A slug that matches NO pattern — the whole point of the AC.1 fixtures. */
const UNMATCHED_SLUG = "orbital-launcher";

describe("scanCandidateCheckSkills — frontmatter arm, end-to-end (AC-STE-506.1)", () => {
  test("the fixture slug is genuinely unmatched by the heuristic", () => {
    // Guards the fixture itself: if `orbital-launcher` ever started matching a
    // (widened) pattern, the three tests below would pass for the wrong reason.
    expect(SLUG_PATTERNS.some((p) => UNMATCHED_SLUG.includes(p))).toBe(false);
  });

  test("`verify: true` in frontmatter makes an unmatched slug a candidate", () => {
    addSkill(UNMATCHED_SLUG, VERIFY_MARKED_SKILL_MD);
    const result = scanCandidateCheckSkills(projectRoot);
    expect(result.map((c) => c.slug)).toEqual([UNMATCHED_SLUG]);
    expect(result[0]!.path).toContain(
      `.claude/skills/${UNMATCHED_SLUG}/SKILL.md`,
    );
  });

  test("negative twin — the same slug with `verify: false` is NOT a candidate", () => {
    addSkill(
      UNMATCHED_SLUG,
      `---\nname: ${UNMATCHED_SLUG}\nverify: false\n---\n\n# Skill body\n`,
    );
    expect(scanCandidateCheckSkills(projectRoot)).toEqual([]);
  });

  test("negative twin — the same slug with `verify: true` only in the BODY is NOT a candidate", () => {
    addSkill(
      UNMATCHED_SLUG,
      `---\nname: ${UNMATCHED_SLUG}\n---\n\n# Skill body\n\nDeclare verify: true to opt in.\n`,
    );
    expect(scanCandidateCheckSkills(projectRoot)).toEqual([]);
  });
});

describe("scanCandidateCheckSkills — conformance/smoke shapes stay unmatched (AC-STE-506.2)", () => {
  test("conformance- and smoke-shaped slugs without a marker yield NO candidates", () => {
    for (const slug of [
      "conformance-loop",
      "smoke-test",
      "conformance-report",
      "smoke-test-fixtures",
    ]) {
      addSkill(slug);
    }
    expect(scanCandidateCheckSkills(projectRoot)).toEqual([]);
  });
});

describe("scanCandidateCheckSkills — multiple candidates list, never guess (AC-STE-506.4)", () => {
  test("three candidates across BOTH arms are ALL returned, slug-sorted", () => {
    addSkill("zeta-drive"); // slug arm
    addSkill("mid-check"); // slug arm
    addSkill(UNMATCHED_SLUG, VERIFY_MARKED_SKILL_MD); // marker arm
    addSkill("deploy"); // neither — excluded
    const result = scanCandidateCheckSkills(projectRoot);
    // Count first: a scanner that returned only the first candidate would
    // satisfy a bare "returns candidates" assertion.
    expect(result.length).toBe(3);
    expect(result.map((c) => c.slug)).toEqual([
      "mid-check",
      UNMATCHED_SLUG,
      "zeta-drive",
    ]);
  });
});

// ---------------------------------------------------------------------------
// STE-506 (M131) — the documented-but-unexercised arm, one level down from
// AC-STE-506.1.
//
// `hasVerifyMarker` documents (scan_candidate_check_skills.ts, the doc comment
// above the function) that its literal `content.startsWith("---\n")` gate
// exists BECAUSE `parseFrontmatter`'s FRONTMATTER_RE is
// `/^---\n([\s\S]*?)\n---/m` — the `/m` flag makes `^` match at every line
// start, so a `---`-delimited block ANYWHERE in the file parses as if it were
// frontmatter. Until now no test built that shape: the existing body-marker
// tests all use a file that DOES open with real frontmatter, so they are
// caught by the parse, never by the gate.
//
// Falsifiability, confirmed by inspection against the shipped module: the leg
// below protects exactly ONE deletion — the `content.startsWith("---\n")` line
// in `hasVerifyMarker`. With that line removed, `parseFrontmatter(content,
// { lenient: true }).verify` returns `true` for the fixture, the fixture skill
// becomes a candidate, and this leg goes red.
// ---------------------------------------------------------------------------

/**
 * No leading frontmatter at all — but a `---`-delimited block further down
 * carrying `verify: true`. The `/m`-flagged frontmatter regex matches it; the
 * literal leading-`---\n` gate is the only thing that rejects it.
 */
const MID_FILE_DELIMITED_BLOCK_SKILL_MD = `# ${UNMATCHED_SLUG}

Prose comes first: this file has NO frontmatter on line 0.

---
name: ${UNMATCHED_SLUG}
verify: true
---

Trailing prose after the block.
`;

describe("scanCandidateCheckSkills — a `---` block that does not open the file (AC-STE-506.1)", () => {
  test("the fixture really has no leading frontmatter, and really carries a mid-file block", () => {
    // Guards the fixture: if it ever grew a leading `---`, the leg below would
    // pass for the ordinary frontmatter reason instead of the gate.
    expect(MID_FILE_DELIMITED_BLOCK_SKILL_MD.startsWith("---\n")).toBe(false);
    expect(MID_FILE_DELIMITED_BLOCK_SKILL_MD).toMatch(
      /\n---\nname: [^\n]+\nverify: true\n---\n/,
    );
  });

  test("`verify: true` inside a mid-file `---` block is NOT a candidate", () => {
    addSkill(UNMATCHED_SLUG, MID_FILE_DELIMITED_BLOCK_SKILL_MD);
    expect(scanCandidateCheckSkills(projectRoot)).toEqual([]);
  });

  test("positive twin — hoisting the SAME block to line 0 DOES make it a candidate", () => {
    // Isolation: proves the leg above is about POSITION, not about the block's
    // contents being unparseable. Same keys, same values, only the offset
    // differs — and the verdict flips.
    addSkill(
      UNMATCHED_SLUG,
      `---\nname: ${UNMATCHED_SLUG}\nverify: true\n---\n\n# Body\n`,
    );
    expect(scanCandidateCheckSkills(projectRoot).map((c) => c.slug)).toEqual([
      UNMATCHED_SLUG,
    ]);
  });
});
