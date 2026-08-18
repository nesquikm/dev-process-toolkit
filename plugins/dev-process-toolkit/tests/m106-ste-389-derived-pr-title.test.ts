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
// to skills/ (ceiling at 246/246), so the skill body must stay token-free.
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

// AC-STE-389.1's absence pin is SUPERSEDED (M129 / STE-496), and the reason is
// recorded here rather than in a commit message so the next reader sees it at
// the site.
//
// STE-389 removed `argument-hint` because `/pr` took NO arguments: free text
// after `/pr` was never a title, so a hint advertised a surface that did not
// exist. STE-496 changes that premise — `/pr` now accepts `--draft`, a real
// flag with real behaviour (`buildPrCreateArgv` emits `--draft`; the default
// path still emits none).
//
// The supersession is not a judgement call: AC-STE-389.6, shipped by the SAME
// FR, amended the cross-cutting testing-spec row to read "argument-hint WHERE
// THE SKILL TAKES ARGUMENTS". That rule is conditional, and it now points the
// other way — a `/pr` that takes `--draft` and advertises no hint violates
// STE-389's own amended row. Absence was never the invariant; matching the
// argument surface was.
//
// What is NOT superseded, and is asserted below unchanged: the `$ARGUMENTS`
// literal stays gone (AC-STE-389.2), titles stay derived from the commit
// subject with no user-supplied override, and free text after `/pr` is still
// never used as a title. STE-496 reintroduces a FLAG, not a title surface.
describe("AC-STE-389.1 — argument-hint matches /pr's argument surface", () => {
  test("frontmatter carries the argument-hint /pr's flag surface now requires", () => {
    const fm = frontmatter(read(PR_SKILL));
    const m = fm.match(/^argument-hint:\s*(['"])(.+?)\1\s*$/m);
    expect(m, "argument-hint missing or not single-line-quoted").not.toBeNull();
    // It advertises the flag surface, not a title surface.
    expect(m![2]).toContain("--draft");
    expect(m![2]).not.toMatch(/title/i);
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

  test("the skill body stays STE-token-free (skills ceiling is at 246/246)", () => {
    expect(/\bSTE-\d+\b/.test(read(PR_SKILL))).toBe(false);
  });
});

describe("AC-STE-389.5 — README /pr row + Args-column note", () => {
  // SUPERSEDED alongside AC-STE-389.1, and for the same reason — see the note
  // on that describe above. README's Args column "mirrors each skill's
  // argument-hint frontmatter", and `—` is defined there as "takes no
  // arguments". Once /pr gained `--draft`, the `—` cell asserted something
  // false, and this pin certified it. The invariant was never "/pr renders —";
  // it is "the Args cell mirrors the frontmatter", which is what is asserted
  // now — the byte-for-byte agreement archived AC-STE-314.1 asks for, with the
  // hint's surrounding quotes stripped.
  test("the /pr row's Args cell mirrors the skill's argument-hint", () => {
    const row = read(README)
      .split("\n")
      .find((line) => line.startsWith("| `/pr`"));
    expect(row).toBeDefined();
    const cells = (row as string).split("|").map((cell) => cell.trim());
    // cells: ["", "`/pr`", "<purpose>", "<args>", ""]
    const hint = frontmatter(read(PR_SKILL)).match(
      /^argument-hint:\s*(['"])(.+?)\1\s*$/m,
    );
    expect(hint, "no argument-hint to mirror").not.toBeNull();
    expect(cells[3]).toBe(`\`${hint![2]}\``);
    // And it is no longer the takes-no-arguments marker.
    expect(cells[3]).not.toBe("—");
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
