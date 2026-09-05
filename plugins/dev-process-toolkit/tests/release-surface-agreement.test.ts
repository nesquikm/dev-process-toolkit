// Release-surface agreement — README "Latest:" line vs CHANGELOG top entry.
//
// THE DEFECT THIS GUARDS (measured, shipped, recovered in
// `fixtures/readme-latest/shipped-defect-v2.75.0.md`):
//
//   Latest: **v2.75.0 — "Pawl"** (M136, the ratchet that never ran: …)
//
// v2.75.0's *version* carrying v2.74.0's *codename* and the whole of M136's
// paragraph. The `## Release Files` entry for README is `kind: regex` with
// pattern `Latest: \*\*v(?<version>\d+\.\d+\.\d+) — ` — it captures the
// version and replaces UP TO the em-dash, so the codename and the sentence
// after it are outside the match and were never rewritten. Every release
// since that entry was written bumped the number and left the description
// describing an older milestone.
//
// It survived because nothing checked it, and the hand verification that
// should have caught it grepped `Latest: \*\*v2\.[0-9.]*` — a pattern whose
// subject ends before the thing that drifts. A check that stops short of the
// drifting field is not a check; test B3 pins exactly that.
//
// These tests constrain the OBSERVABLE contract (README and CHANGELOG agree
// on version, codename and milestone) rather than the bumper's regex, so the
// next occurrence is caught whichever mechanism is at fault. Group D pins the
// mechanism itself — and specifically pins the fact that the mechanism CANNOT
// rewrite the codename today, which is why the drift had to be caught at the
// observable layer in the first place.
//
// Nothing here hand-types a version or a codename: both are derived from
// CHANGELOG.md, which is the source of truth for what shipped, and the
// milestone is derived from the plan file whose `shipped_in:` names that
// release.

import { describe, expect, test } from "bun:test";
// STE-556. The banner's milestone is asserted through the SHARED grammar, never a
// private `M\\d+`. This suite carried the fourth copy of that assumption — three in
// the module it guards, one here — and this one only fired the day the banner first
// named an `M_<key>` milestone, in the release that fixed the other three.
import { isMilestoneToken } from "../adapters/_shared/src/milestone_token";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  checkReleaseSurfaceAgreement,
  findMilestoneForRelease,
  parseChangelogEntries,
  parseChangelogTop,
  parseReadmeLatest,
  type PlanText,
} from "../adapters/_shared/src/release_surface_agreement";
import { bumpFile, bumpRegex, parseReleaseFiles } from "../adapters/_shared/src/release_config";

const repoRoot = join(import.meta.dir, "..", "..", "..");

const readme = readFileSync(join(repoRoot, "README.md"), "utf-8");
const changelog = readFileSync(join(repoRoot, "CHANGELOG.md"), "utf-8");
const claudeMd = readFileSync(join(repoRoot, "CLAUDE.md"), "utf-8");

function loadPlanTexts(): PlanText[] {
  const dirs = [join(repoRoot, "specs", "plan"), join(repoRoot, "specs", "plan", "archive")];
  const out: PlanText[] = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".md")) continue;
      const path = join(dir, name);
      out.push({ path, text: readFileSync(path, "utf-8") });
    }
  }
  return out;
}

const plans = loadPlanTexts();

// The release these fixtures grade. STE-546 made the version an EXPLICIT
// argument to `checkReleaseSurfaceAgreement` — the check locates its CHANGELOG
// entry by version match, never by position — and every call below is grading
// this repo's newest release, so the subject is named once here.
//
// A function, not a `const`: the parseability of CHANGELOG.md is what the first
// test in group A asserts, and evaluating `!` at module scope would turn that
// failure into a whole-file load crash with no assertion to name it.
const topVersion = (): string => parseChangelogTop(changelog)!.version;

// The shipped defect, recovered verbatim from the pre-amend release commit (bb8973f, superseded by the amended release commit; the sha is unreachable — this fixture IS the record).
const defectFixture = readFileSync(
  join(import.meta.dir, "fixtures", "readme-latest", "shipped-defect-v2.75.0.md"),
  "utf-8",
);

// ---------------------------------------------------------------------------
// Group A — the observable contract holds in this repo, right now.
// The three fields are asserted as THREE facts, never one: version agreement
// already held while the codename drifted, and a single combined assertion
// would have been green throughout the defect's whole life.
// ---------------------------------------------------------------------------

describe("A — README 'Latest:' line agrees with the topmost CHANGELOG entry", () => {
  test("the surfaces are parseable at all (guards a vacuous zero-violation pass)", () => {
    const top = parseChangelogTop(changelog);
    const latest = parseReadmeLatest(readme);
    expect(top).not.toBeNull();
    expect(latest).not.toBeNull();
    expect(top!.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(top!.codename.length).toBeGreaterThan(0);
    expect(isMilestoneToken(latest!.milestone)).toBe(true);
  });

  test("A1 — the VERSION matches", () => {
    expect(parseReadmeLatest(readme)!.version).toBe(topVersion());
  });

  test("A2 — the CODENAME matches", () => {
    expect(parseReadmeLatest(readme)!.codename).toBe(parseChangelogTop(changelog)!.codename);
  });

  test("A3 — the MILESTONE matches the plan that shipped in that release", () => {
    const top = parseChangelogTop(changelog)!;
    const expected = findMilestoneForRelease(plans, top.version);
    expect(expected).not.toBeNull();
    expect(parseReadmeLatest(readme)!.milestone).toBe(expected);
  });

  test("A4 — the aggregate check reports no violations for the live repo", () => {
    expect(checkReleaseSurfaceAgreement(readme, changelog, plans, topVersion())).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Group B — falsifiability against the REAL shipped defect.
// The mutant is not invented: it is the line this repo published.
// ---------------------------------------------------------------------------

describe("B — the check reddens on the line that actually shipped", () => {
  test("the fixture is the defect, not a stub", () => {
    const parsed = parseReadmeLatest(defectFixture);
    expect(parsed).not.toBeNull();
    // Its codename and milestone are BOTH stale relative to what shipped.
    expect(parsed!.codename).not.toBe(parseChangelogTop(changelog)!.codename);
    expect(parsed!.milestone).not.toBe(
      findMilestoneForRelease(plans, topVersion()),
    );
  });

  test("B1 — a CODENAME violation is reported", () => {
    const violations = checkReleaseSurfaceAgreement(defectFixture, changelog, plans, topVersion());
    const codename = violations.find((v) => v.field === "codename");
    expect(codename).toBeDefined();
    expect(codename!.found).toBe(parseReadmeLatest(defectFixture)!.codename);
    expect(codename!.expected).toBe(parseChangelogTop(changelog)!.codename);
  });

  test("B2 — a MILESTONE violation is reported", () => {
    const violations = checkReleaseSurfaceAgreement(defectFixture, changelog, plans, topVersion());
    const milestone = violations.find((v) => v.field === "milestone");
    expect(milestone).toBeDefined();
    expect(milestone!.expected).toBe(
      findMilestoneForRelease(plans, topVersion()),
    );
  });

  test("B3 — the version-only grep that MISSED it still matches the defect", () => {
    // This is the check that was actually run by hand and reported
    // "all six release surfaces agree". Its subject ends at the version, so
    // it is satisfied by the broken line. Keeping it here pins the reason the
    // defect escaped: not a wrong answer, a wrong question.
    const versionOnly = /Latest: \*\*v\d+\.\d+\.\d+/;
    expect(versionOnly.test(defectFixture)).toBe(true);
    expect(checkReleaseSurfaceAgreement(defectFixture, changelog, plans, topVersion()).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Group C — isolation. Each field must fail on its own, or a green aggregate
// proves nothing about the field that drifted. Every mutant value is derived
// from the CHANGELOG's PREVIOUS entry, never hand-typed.
// ---------------------------------------------------------------------------

describe("C — each field fails independently", () => {
  const entries = parseChangelogEntries(changelog);

  test("the CHANGELOG carries a previous entry to build mutants from", () => {
    expect(entries.length).toBeGreaterThanOrEqual(2);
    expect(entries[1]!.codename).not.toBe(entries[0]!.codename);
  });

  test("C1 — a stale CODENAME alone is caught", () => {
    const prev = entries[1]!;
    const current = parseReadmeLatest(readme)!;
    const mutant = readme.replace(`"${current.codename}"`, `"${prev.codename}"`);
    expect(mutant).not.toBe(readme);
    const violations = checkReleaseSurfaceAgreement(mutant, changelog, plans, topVersion());
    expect(violations.map((v) => v.field)).toEqual(["codename"]);
  });

  test("C2 — a stale MILESTONE alone is caught", () => {
    const prevMilestone = findMilestoneForRelease(plans, entries[1]!.version);
    expect(prevMilestone).not.toBeNull();
    const current = parseReadmeLatest(readme)!;
    const mutant = readme.replace(`(${current.milestone},`, `(${prevMilestone},`);
    expect(mutant).not.toBe(readme);
    const violations = checkReleaseSurfaceAgreement(mutant, changelog, plans, topVersion());
    expect(violations.map((v) => v.field)).toEqual(["milestone"]);
  });

  test("C3 — a stale VERSION alone is caught", () => {
    const prev = entries[1]!;
    const current = parseReadmeLatest(readme)!;
    const mutant = readme.replace(`**v${current.version} —`, `**v${prev.version} —`);
    expect(mutant).not.toBe(readme);
    const violations = checkReleaseSurfaceAgreement(mutant, changelog, plans, topVersion());
    expect(violations.map((v) => v.field)).toEqual(["version"]);
  });
});

// ---------------------------------------------------------------------------
// Group D — the mechanism, PINNED AS A CAPABILITY (STE-554 closed the gap).
//
// This group used to pin the LIMITATION: `bumpRegex` interpolated exactly one
// token, `BumpOptions.codename` was discarded on the `kind: regex` arm, and no
// pattern/replace pair writable in CLAUDE.md could rewrite the codename. The
// mechanism was incapable, not merely misconfigured, and that incapability was
// the root cause of the shipped defect at the top of this file.
//
// The old contract said, in as many words, that no path to a fix leaves this
// group green: the fix must force it to be REWRITTEN as a capability rather
// than let the mechanism quietly diverge from the tests describing it. STE-554
// landed both halves it named —
//   1. `bumpRegex` learned `{codename}`, and `bumpFile`'s `regex` arm forwards
//      `opts.codename`;
//   2. the README entry's `pattern`/`replace` pair was widened past the
//      em-dash to span the codename.
// — so what follows is that rewrite, assertion for assertion. Each one keeps
// reading the shipped configuration through `parseReleaseFiles` / `bumpFile`,
// so it still describes what `/ship-milestone` actually executes.
//
// Groups A–C stay load-bearing. The banner also names a MILESTONE and a
// paragraph of prose, neither of which any bump writes, so the observable
// check is still the only thing standing between a release and a stale banner.
// ---------------------------------------------------------------------------

describe("D — what the release bumper rewrites", () => {
  const entries = parseChangelogEntries(changelog);
  const readmeEntry = parseReleaseFiles(claudeMd).find((e) => e.path === "README.md");

  const nextVersionAfterTop = () => {
    const parts = entries[0]!.version.split(".");
    return `${parts[0]}.${Number(parts[1]) + 1}.0`;
  };

  test("CLAUDE.md declares a README release-file entry", () => {
    expect(readmeEntry).toBeDefined();
  });

  test("D1 — a bump through bumpFile rewrites the VERSION", () => {
    const nextVersion = nextVersionAfterTop();
    const bumped = bumpFile(readmeEntry!, readme, {
      newVersion: nextVersion,
      codename: entries[1]!.codename,
      date: "2999-01-01",
      changelogBody: "",
    });
    expect(parseReadmeLatest(bumped)!.version).toBe(nextVersion);
  });

  test("D2 — bumpRegex substitutes a codename token", () => {
    // Half 1 of the old gap, now the capability. Calls bumpRegex with a
    // replacement template that ASKS for a codename, using a pattern wide
    // enough to span one. The token is interpolated; the literal `{codename}`
    // can no longer survive into the output.
    const out = bumpRegex(
      readme,
      'Latest: \\*\\*v(?<version>\\d+\\.\\d+\\.\\d+) — "[^"]+"',
      'Latest: **v{version} — "{codename}"',
      "9.9.9",
      "Ceremony",
    );
    expect(out).toContain('Latest: **v9.9.9 — "Ceremony"');
    expect(out).not.toContain("{codename}");
  });

  test("D2b — a {codename} template with no codename refuses rather than writing the token", () => {
    // The measured pre-STE-554 output was the six characters `{codename}` on
    // disk. Rendering an empty string would be the same silence with fewer
    // characters, so the miss refuses instead.
    expect(() =>
      bumpRegex(
        readme,
        'Latest: \\*\\*v(?<version>\\d+\\.\\d+\\.\\d+) — "[^"]+"',
        'Latest: **v{version} — "{codename}"',
        "9.9.9",
      ),
    ).toThrow(/\{codename\}/);
  });

  test("D3 — the shipped README entry's templates reach the codename", () => {
    // Half 2, asserted on the shipped configuration rather than on the code.
    expect(readmeEntry!.kind).toBe("regex");
    expect(readmeEntry!.replace).toContain("{codename}");
    expect(readmeEntry!.pattern).toContain("(?<codename>");
    // And the widened pattern still matches the banner as it stands, which a
    // declaration alone no longer proves: an optional entry whose pattern
    // misses is skipped rather than fatal (STE-555).
    expect(new RegExp(readmeEntry!.pattern!).test(readme)).toBe(true);
  });

  test("D4 — end-to-end, a bump carries the NEW version AND the NEW codename", () => {
    // The two halves composed: the exact shape of the defect this file guards,
    // no longer producible by the shipped release path. `codename:` is passed
    // and used.
    const nextVersion = nextVersionAfterTop();
    const before = parseReadmeLatest(readme)!.codename;
    // Derived from the previous release, never hand-typed.
    const requested = entries[1]!.codename;
    expect(requested).not.toBe(before);

    const bumped = bumpFile(readmeEntry!, readme, {
      newVersion: nextVersion,
      codename: requested,
      date: "2999-01-01",
      changelogBody: "",
    });
    const after = parseReadmeLatest(bumped)!;
    expect(after.version).toBe(nextVersion);
    expect(after.codename).toBe(requested);
    expect(after.codename).not.toBe(before);
    // The milestone and the prose after it are still untouched by any bump —
    // which is why groups A–C remain the guard that catches them.
    expect(after.milestone).toBe(parseReadmeLatest(readme)!.milestone);
  });
});
