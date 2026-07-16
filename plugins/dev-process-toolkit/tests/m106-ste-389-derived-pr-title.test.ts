// STE-389 — doc-conformance for derived-only PR titles (M106).
//
// AC-STE-389.1: `skills/pr/SKILL.md` frontmatter has no `argument-hint:` key.
// AC-STE-389.2: no `$ARGUMENTS` literal anywhere in `skills/pr/SKILL.md`.
// AC-STE-389.3: Step 5's Title bullet states the PR title is always derived
// from the dominant commit's Conventional Commits subject, with no
// user-supplied override path.
// AC-STE-389.4: a Notes rule pins the explicit redirect for free text after
// /pr ("PR titles are derived from the commit subject; amend the commit to
// change the title") and proceeds; the new prose adds zero `STE-<N>` tokens
// to skills/ (ceiling at 245/245), so the skill body must stay token-free.
// AC-STE-389.5: README's /pr row Args cell renders `—`, the `[PR title]`
// literal is gone, and the Args-column note explains the `—` marker.
// AC-STE-389.6: `specs/testing-spec.md` Tier-1 frontmatter row requires
// `argument-hint` only where the skill takes arguments.
//
// AC-STE-389.7 (full gate green) is the suite itself — no dedicated test.
// The byte-pinned Ship-State Pre-Flight section is owned by
// tests/m99-ste-370-post-merge-ceremony.test.ts and is not re-pinned here.
//
// Literal substring checks per this repo's doc-conformance convention
// (pattern: tests/m106-ste-388-branch-naming.test.ts).

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const pluginRoot = join(import.meta.dir, "..");
const repoRoot = join(pluginRoot, "..", "..");

const PR_SKILL = join(pluginRoot, "skills", "pr", "SKILL.md");
const README = join(repoRoot, "README.md");
const TESTING_SPEC = join(repoRoot, "specs", "testing-spec.md");

function read(path: string): string {
  return readFileSync(path, "utf8");
}

/** Frontmatter body of a SKILL.md: the text between the leading `---` fences. */
function frontmatter(body: string): string {
  const m = body.match(/^---\n([\s\S]*?)\n---/);
  expect(m).not.toBeNull();
  return (m as RegExpMatchArray)[1];
}

/** Slice body between two anchors; fails the test when either is missing. */
function sliceBetween(body: string, startAnchor: string, endAnchor: string): string {
  const start = body.indexOf(startAnchor);
  expect(start).toBeGreaterThan(-1);
  const end = body.indexOf(endAnchor, start);
  expect(end).toBeGreaterThan(start);
  return body.slice(start, end);
}

/** Section from a `## <heading>` line to the next `## ` heading or EOF. */
function sectionFrom(body: string, heading: string): string {
  const start = body.indexOf(heading);
  expect(start).toBeGreaterThan(-1);
  const rest = body.slice(start + heading.length);
  const endRel = rest.search(/\n## \S/);
  return endRel === -1 ? body.slice(start) : body.slice(start, start + heading.length + endRel);
}

/** Step 5's Title bullet: from `**Title**` to the Body-format bullet. */
function titleBullet(): string {
  return sliceBetween(read(PR_SKILL), "**Title**", "Body format");
}

describe("AC-STE-389.1 — argument-hint removed from /pr frontmatter", () => {
  test("frontmatter has no argument-hint key", () => {
    expect(/^argument-hint\s*:/m.test(frontmatter(read(PR_SKILL)))).toBe(false);
  });

  test("frontmatter still carries name + description", () => {
    const fm = frontmatter(read(PR_SKILL));
    expect(/^name:\s*pr\s*$/m.test(fm)).toBe(true);
    expect(/^description:\s*\S/m.test(fm)).toBe(true);
  });
});

describe("AC-STE-389.2 — $ARGUMENTS literal removed from /pr", () => {
  test("no $ARGUMENTS anywhere in skills/pr/SKILL.md", () => {
    expect(read(PR_SKILL)).not.toContain("$ARGUMENTS");
  });
});

describe("AC-STE-389.3 — Step 5 Title bullet is derived-only", () => {
  test("pins the always-derived-from-the-dominant-commit phrase", () => {
    const bullet = titleBullet();
    expect(bullet).toMatch(/always derived from the dominant commit['’]s/);
    expect(bullet).toContain("Conventional Commits");
    expect(bullet).toContain("subject");
  });

  test("states there is no user-supplied override path", () => {
    expect(titleBullet()).toMatch(/no user-supplied/);
  });
});

describe("AC-STE-389.4 — explicit redirect rule in Notes", () => {
  test("Notes pins the exact redirect line", () => {
    expect(sectionFrom(read(PR_SKILL), "## Notes")).toContain(
      "PR titles are derived from the commit subject; amend the commit to change the title",
    );
  });

  test("Notes rule covers free text after /pr and proceeds", () => {
    const notes = sectionFrom(read(PR_SKILL), "## Notes");
    expect(notes).toMatch(/free text after `?\/pr`?/);
    expect(notes).toMatch(/proceed/i);
  });

  test("the skill body stays STE-token-free (skills ceiling is at 245/245)", () => {
    expect(/\bSTE-\d+\b/.test(read(PR_SKILL))).toBe(false);
  });
});

describe("AC-STE-389.5 — README /pr row + Args-column note", () => {
  test("the /pr row's Args cell renders —", () => {
    const row = read(README)
      .split("\n")
      .find((line) => line.startsWith("| `/pr`"));
    expect(row).toBeDefined();
    const cells = (row as string).split("|").map((cell) => cell.trim());
    // cells: ["", "`/pr`", "<purpose>", "<args>", ""]
    expect(cells[3]).toBe("—");
  });

  test("the [PR title] literal is absent from README.md", () => {
    expect(read(README)).not.toContain("[PR title]");
  });

  test("the Args-column note explains the — marker", () => {
    expect(read(README)).toMatch(/`?—`?\s+marks a skill that takes no arguments/);
  });
});

describe("AC-STE-389.6 — testing-spec Tier-1 frontmatter row is conditional", () => {
  test("the Frontmatter row requires argument-hint only where the skill takes arguments", () => {
    const row = read(TESTING_SPEC)
      .split("\n")
      .find((line) => line.startsWith("| Frontmatter |"));
    expect(row).toBeDefined();
    expect(row as string).toContain("`argument-hint` where the skill takes arguments");
  });
});
