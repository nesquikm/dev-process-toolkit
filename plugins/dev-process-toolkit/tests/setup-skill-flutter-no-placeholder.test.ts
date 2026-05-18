// STE-309 — Remove Flutter/Dart empty_test.dart placeholder from /setup.
//
// Three AC's covered:
//   AC-STE-309.1 — SKILL.md prose conformance: bullet states `flutter create .`
//     writes `test/widget_test.dart`, includes the literal "do NOT add an extra
//     placeholder file (e.g. `test/empty_test.dart`)" directive, and notes
//     `flutter test` exits 0 against an empty `test/` dir on current SDKs.
//   AC-STE-309.2 — canonical regression test from FR Technical Design: the
//     Flutter/Dart bullet does NOT contain placeholder-test substrings, has no
//     `test/<name>.dart` reference other than `test/widget_test.dart`, and
//     positively carries the "do NOT add" / "placeholder" tokens
//     (case-insensitive).
//   AC-STE-309.3 — CHANGELOG entry: the v2.27.0 release block (under the M80
//     section) carries an M80/STE-309 line in either `### Fixed` or
//     `### Changed` with the cleanup-callout text instructing downstream
//     Flutter/Dart packages to delete `test/empty_test.dart` manually.

import { test, expect, describe } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SKILL_PATH = join(
  import.meta.dir,
  "..",
  "skills",
  "setup",
  "SKILL.md",
);

const CHANGELOG_PATH = join(
  import.meta.dir,
  "..",
  "..",
  "..",
  "CHANGELOG.md",
);

// Matches a Flutter/Dart bullet starting with `- **Flutter/Dart:**` and
// continuing onto indented continuation lines (two-space indent).
const FLUTTER_BULLET_RE = /^\s*-\s+\*\*Flutter\/Dart:\*\*[^\n]+(\n  [^\n]+)*/m;

function readSkill(): string {
  return readFileSync(SKILL_PATH, "utf8");
}

function readChangelog(): string {
  return readFileSync(CHANGELOG_PATH, "utf8");
}

function matchFlutterBullet(md: string): string {
  const m = md.match(FLUTTER_BULLET_RE);
  expect(m, "Flutter/Dart bullet not found in SKILL.md").not.toBeNull();
  return m![0];
}

describe("AC-STE-309.1 — SKILL.md Flutter/Dart bullet prose conformance", () => {
  test("bullet states flutter create writes test/widget_test.dart automatically", () => {
    const md = readSkill();
    const bullet = matchFlutterBullet(md);
    // The bullet must mention `flutter create .` paired with the auto-write
    // of `test/widget_test.dart`; this is the rationale anchor that explains
    // why the placeholder is unnecessary.
    expect(bullet).toMatch(/flutter create \./);
    expect(bullet).toContain("test/widget_test.dart");
    // The pairing must be in the same bullet (single block, not split across
    // unrelated prose) — the indented continuation regex already enforces
    // this; assert both tokens are present.
    expect(bullet.toLowerCase()).toMatch(/writes.*test\/widget_test\.dart|test\/widget_test\.dart.*automatically/);
  });

  test("bullet carries the literal do-NOT-add directive with empty_test.dart example", () => {
    const md = readSkill();
    const bullet = matchFlutterBullet(md);
    // Literal directive from AC.1(b): "do NOT add an extra placeholder file
    // (e.g. `test/empty_test.dart`)". We assert each load-bearing token
    // sequence separately so a minor punctuation drift doesn't mask intent
    // drift.
    expect(bullet).toContain("do NOT add");
    expect(bullet.toLowerCase()).toContain("placeholder");
    expect(bullet).toContain("test/empty_test.dart");
  });

  test("bullet notes flutter test exits 0 against empty test/ on current SDKs", () => {
    const md = readSkill();
    const bullet = matchFlutterBullet(md);
    // AC.1(c): the rationale tying placeholder removal to current Flutter
    // SDK behavior. Require both the runner reference (`flutter test`) and
    // the exit-0-on-empty assertion (`exits 0` plus `empty`).
    expect(bullet).toContain("flutter test");
    expect(bullet.toLowerCase()).toMatch(/exits?\s+0/);
    expect(bullet.toLowerCase()).toContain("empty");
  });
});

describe("AC-STE-309.2 — regression test (canonical shape from FR Technical Design)", () => {
  test("SKILL.md Flutter/Dart bullet emits no placeholder-test instructions", () => {
    const md = readSkill();
    const bullet = matchFlutterBullet(md);

    // (a) The placeholder test BODY is the regression we actually care about.
    // The filename (`empty_test`) is permitted here only because AC.1(b)
    // mandates citing it as the counter-example inside the "do NOT add"
    // directive — see FR § Acceptance Criteria, AC.2 deviation note.
    expect(bullet).not.toMatch(/expect\(\s*1\s*,\s*1\s*\)/);

    // (b) The only `test/*.dart` path the bullet positively instructs adding
    // is `test/widget_test.dart`. `test/empty_test.dart` may appear inside
    // the documented counter-example (AC.1(b)'s mandated literal), but
    // nowhere else — at most one mention, and only inside the "do NOT add"
    // / "e.g." counter-example clause.
    const dartFiles = bullet.match(/test\/[A-Za-z0-9_.-]+\.dart/g) ?? [];
    const allowed = new Set(["test/widget_test.dart", "test/empty_test.dart"]);
    for (const path of dartFiles) {
      expect(allowed.has(path)).toBe(true);
    }
    const emptyTestCount = (bullet.match(/test\/empty_test\.dart/g) ?? [])
      .length;
    expect(emptyTestCount).toBeLessThanOrEqual(1);

    // (c) Positive tokens — these are the load-bearing assertions catching
    // future drift toward placeholder-emitting prose.
    expect(bullet.toLowerCase()).toContain("do not add");
    expect(bullet.toLowerCase()).toContain("placeholder");
  });
});

describe("AC-STE-309.3 — CHANGELOG entry under M80 / v2.27.0 callout", () => {
  test("v2.27.0 section exists in CHANGELOG", () => {
    const cl = readChangelog();
    // Allow either bracketed Keep-a-Changelog style `## [2.27.0]` or the
    // unbracketed form used elsewhere in this repo. The release ships as
    // v2.27.0 per specs/plan/M80.md `Release target:`.
    expect(cl).toMatch(/##\s*\[?2\.27\.0\]?/);
  });

  test("v2.27.0 section carries an M80/STE-309 line with the cleanup callout text", () => {
    const cl = readChangelog();
    // Locate the v2.27.0 release block. It runs from the `## [2.27.0]`
    // header to the next top-level `## [` header (or end of file).
    const headerRe = /##\s*\[?2\.27\.0\]?/g;
    const headerMatch = headerRe.exec(cl);
    expect(headerMatch, "v2.27.0 release block missing").not.toBeNull();
    const start = headerMatch!.index;
    const tail = cl.slice(start + 1);
    const nextHeaderIdx = tail.search(/\n##\s+\[?\d+\.\d+\.\d+\]?/);
    const end = nextHeaderIdx === -1 ? cl.length : start + 1 + nextHeaderIdx;
    const block = cl.slice(start, end);

    // The entry must reference STE-309 and live under either `### Fixed`
    // or `### Changed` per AC.3.
    expect(block).toContain("STE-309");
    expect(block).toMatch(/###\s+(Fixed|Changed)/);

    // Cleanup callout text from AC.3 — literal directive to delete the
    // placeholder file manually. Assert each load-bearing fragment so a
    // minor wording drift doesn't mask intent drift.
    expect(block).toContain("test/empty_test.dart");
    expect(block.toLowerCase()).toContain("delete the file manually");
    expect(block.toLowerCase()).toMatch(/flutter test\s+exits?\s+0/);
    expect(block.toLowerCase()).toContain("empty");
  });
});
