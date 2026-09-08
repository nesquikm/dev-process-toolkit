// STE-576 (M_a8e09a) — the /pr Title bullet states two things that are not true.
//
// Subject under test: the **Title** bullet of `skills/pr/SKILL.md`, sliced
// between its shipped anchors by the SAME reader `tests/m106-ste-389-derived-pr-title.test.ts`
// uses (`**Title**` → `Body format`). Everything asserted here is scoped to
// that slice, never to the whole file — prose elsewhere must not be able to
// satisfy these pins.
//
// AC-STE-576.1: the bullet no longer says `on a release branch`; it names the
//   branch's own `chore(release):` commit as dominant when the branch carries
//   one, and the primary feature commit otherwise.
// AC-STE-576.2: the bullet no longer claims the PR title and the squash-merge
//   subject both validate against the commit-msg hook; it states the real
//   constraint (squash merging enabled, title source = commit-or-PR title, so
//   a squash promotes the PR title to a trunk subject) and says plainly that
//   the local hook does not enforce it.
// AC-STE-576.3: both clauses are asserted through the existing reader, and the
//   slice is proved non-empty / correctly anchored so an empty or mis-anchored
//   slice reds instead of vacuously satisfying the two absence assertions.
// AC-STE-576.4: the four existing prose pins on the same bullet still hold, and
//   the file that owns them is unchanged.
// AC-STE-576.5: no title convention is sanctioned or forbidden by the edit.
// AC-STE-576.6: no `STE-<N>` token enters the skill body; the frontmatter is
//   byte-unchanged (its `argument-hint` is mirrored by a README cell).
//
// Measured facts the replacement prose must agree with (recorded so a later
// reader can re-derive them rather than trust this comment):
//   - zero `release/*` refs have ever existed in this repository;
//   - 139 `chore(release):` commits exist, one per shipped milestone branch;
//   - `gh api repos/nesquikm/dev-process-toolkit` reports allow_squash_merge:
//     true with squash_merge_commit_title: "COMMIT_OR_PR_TITLE";
//   - the commit-msg hook is local (`.git/hooks/commit-msg`), and every merge
//     here is authored server-side by `GitHub <noreply@github.com>`, so it
//     never passes through that hook.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const pluginRoot = join(import.meta.dir, "..");

const PR_SKILL = join(pluginRoot, "skills", "pr", "SKILL.md");
const M106_TEST = join(pluginRoot, "tests", "m106-ste-389-derived-pr-title.test.ts");

function read(path: string): string {
  return readFileSync(path, "utf8");
}

/** Slice body between two anchors; fails the test when either is missing. */
function sliceBetween(body: string, startAnchor: string, endAnchor: string): string {
  const start = body.indexOf(startAnchor);
  expect(start).toBeGreaterThan(-1);
  const end = body.indexOf(endAnchor, start);
  expect(end).toBeGreaterThan(start);
  return body.slice(start, end);
}

/**
 * Step 5's Title bullet — reproduced byte-for-byte from `titleBullet()` in
 * tests/m106-ste-389-derived-pr-title.test.ts:64-67 (that helper is not
 * exported). The "reader agrees with its source" test below fails if the
 * original ever changes its anchors, so the reproduction cannot silently
 * drift away from the reader AC-STE-576.3 names.
 */
function titleBullet(): string {
  return sliceBetween(read(PR_SKILL), "**Title**", "Body format");
}

/** Sentences of the bullet, split on sentence-final punctuation + whitespace. */
function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// AC-STE-576.3 — the reader is the existing one, and the slice is real.
//
// AC.1 and AC.2 are ABSENCE assertions over this slice. A slice that returned
// "" would satisfy both and prove nothing, so the slice's integrity is pinned
// first and the positive pins of AC.4 are re-asserted below.
// ---------------------------------------------------------------------------
describe("AC-STE-576.3 — assertions are scoped through the shipped titleBullet() reader", () => {
  test("the reproduced reader uses the same anchors as the m106 original", () => {
    const owner = read(M106_TEST);
    expect(owner).toContain(`function titleBullet(): string {`);
    expect(owner).toContain(`return sliceBetween(read(PR_SKILL), "**Title**", "Body format");`);
  });

  test("the slice is non-empty and anchored on the Title bullet", () => {
    const bullet = titleBullet();
    expect(bullet.length).toBeGreaterThan(200);
    expect(bullet.startsWith("**Title**")).toBe(true);
    // The end anchor is the NEXT bullet, so the slice trails off in that
    // bullet's list lead-in — proof the region really is bounded by the two
    // shipped anchors rather than running to EOF.
    expect(bullet.trimEnd().endsWith("-")).toBe(true);
  });

  test("the slice is a proper subset of the skill file, not the whole file", () => {
    const file = read(PR_SKILL);
    const bullet = titleBullet();
    expect(bullet.length).toBeLessThan(file.length);
    // Sections outside the bullet are excluded: the slice ends before the body
    // template and starts after the frontmatter.
    expect(bullet).not.toContain("## Notes");
    expect(bullet).not.toContain("## Test plan");
    expect(bullet).not.toContain("name: pr");
  });
});

// ---------------------------------------------------------------------------
// AC-STE-576.1 — the release-branch clause is gone, replaced by what exists.
// ---------------------------------------------------------------------------
describe("AC-STE-576.1 — the dominant-commit rule names a real branch shape", () => {
  test("the bullet no longer mentions a release branch", () => {
    expect(titleBullet()).not.toContain("on a release branch");
  });

  test("it names the branch's own chore(release): commit as the dominant one", () => {
    const bullet = titleBullet();
    expect(bullet).toContain("chore(release):");
    // The naming is conditional on the branch carrying one.
    expect(bullet).toMatch(/\bwhen the branch carries one\b|\bif the branch carries one\b|\bwhen (a|the) branch carries\b/i);
  });

  test("it keeps the primary feature commit as the fallback", () => {
    expect(titleBullet()).toMatch(/otherwise[^.]*primary feature commit/i);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-576.2 — the hook claim is replaced by the real constraint.
// ---------------------------------------------------------------------------
describe("AC-STE-576.2 — the squash constraint is stated honestly", () => {
  test("the bullet no longer claims both subjects validate against the commit-msg hook", () => {
    const bullet = titleBullet();
    expect(bullet).not.toContain("must both validate against the commit-msg hook");
    expect(bullet).not.toMatch(/both validate against the commit-msg hook/);
  });

  test("it states the host squash setting that promotes the PR title to a subject", () => {
    const bullet = titleBullet();
    expect(bullet).toMatch(/squash/i);
    expect(bullet).toMatch(/commit-or-PR title/i);
    expect(bullet).toMatch(/subject/);
  });

  test("every sentence naming the commit-msg hook says it does not enforce this", () => {
    const naming = sentences(titleBullet()).filter((s) => s.includes("commit-msg hook"));
    expect(naming.length).toBeGreaterThan(0);
    for (const sentence of naming) {
      expect(sentence).toMatch(/\b(does not|doesn't|never|cannot|can't|no)\b/i);
    }
  });
});

// ---------------------------------------------------------------------------
// AC-STE-576.4 — the four shipped prose pins on this bullet still hold.
//
// These are re-asserted here (not merely delegated to m106) so that a rewrite
// that emptied or gutted the bullet reds in THIS file too, which is what keeps
// the two absence assertions above from passing vacuously.
// ---------------------------------------------------------------------------
describe("AC-STE-576.4 — the four existing prose pins survive unchanged", () => {
  test("pin 1: derived from the dominant commit's subject", () => {
    expect(titleBullet()).toMatch(/always derived from the dominant commit['’]s/);
  });

  test("pin 2: Conventional Commits is still named", () => {
    expect(titleBullet()).toContain("Conventional Commits");
  });

  test("pin 3: the word subject is still there", () => {
    expect(titleBullet()).toContain("subject");
  });

  test("pin 4: no user-supplied override path", () => {
    expect(titleBullet()).toMatch(/no user-supplied/);
  });

  test("the m106 file that owns those pins is not edited away", () => {
    const owner = read(M106_TEST);
    for (const assertion of [
      `expect(bullet).toMatch(/always derived from the dominant commit['’]s/);`,
      `expect(bullet).toContain("Conventional Commits");`,
      `expect(bullet).toContain("subject");`,
      `expect(titleBullet()).toMatch(/no user-supplied/);`,
    ]) {
      expect(owner).toContain(assertion);
    }
  });

  test("the possessive survives the edit in one of the two tolerated spellings", () => {
    // Tolerant on purpose, matching the shipped m106 pin's own `['’]`
    // alternation. An earlier draft of this test ALSO forbade the curly form.
    // That was wrong in a way worth recording rather than just deleting: the
    // pin this file exists to protect deliberately accepts both spellings, so
    // forbidding one converted a tolerated variant into a banned one and would
    // have redded a future typographic pass for a change AC.4 explicitly
    // allows. The file carries the straight form today; what is asserted is
    // that the possessive still EXISTS after the edit, which is the thing the
    // edit could plausibly break.
    expect(titleBullet()).toMatch(/dominant commit['’]s/);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-576.5 — no convention is sanctioned or forbidden.
// ---------------------------------------------------------------------------
describe("AC-STE-576.5 — the edit blesses and rejects no title shape", () => {
  test("the milestone-keyed PR-title shape is not sanctioned", () => {
    const bullet = titleBullet();
    expect(bullet).not.toMatch(/M_[0-9a-z]{6}/i);
    expect(bullet).not.toMatch(/codename/i);
  });

  test("no clause permits or bans an alternative title shape", () => {
    const bullet = titleBullet();
    expect(bullet).not.toMatch(/\balso (valid|accepted|acceptable|allowed|permitted|fine)\b/i);
    expect(bullet).not.toMatch(/\b(may|can) also (use|be used|carry)\b/i);
    expect(bullet).not.toMatch(/\b(is|are) (not allowed|forbidden|prohibited|banned|rejected)\b/i);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-576.6 — no tracker token enters the body; the frontmatter is byte-stable.
// ---------------------------------------------------------------------------
describe("AC-STE-576.6 — token ceiling and frontmatter are untouched", () => {
  test("the skill body carries no STE-<N> token", () => {
    expect(/\bSTE-\d+\b/.test(read(PR_SKILL))).toBe(false);
  });

  test("the frontmatter block is byte-identical to the shipped one", () => {
    const m = read(PR_SKILL).match(/^---\n([\s\S]*?)\n---/);
    expect(m).not.toBeNull();
    expect((m as RegExpMatchArray)[1]).toBe(
      [
        "name: pr",
        "description: Create a pull request with conventional format. Use when asked to create a PR, open a pull request, or push changes for review.",
        "argument-hint: '[--draft]'",
      ].join("\n"),
    );
  });
});
