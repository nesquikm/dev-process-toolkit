// M116 STE-418 — the AC-STE-418.4 DEFERRAL must be disclosed in the release
// record, not only in the FR and the plan.
//
// AC-STE-418.4 shipped DEFERRED: the recorded-replay half landed (a six-capture
// set through `assertChainIntegrity` returns zero findings, negative direction
// reproducing both truncation rows); the live `/smoke-test` leg — a ~10-minute
// `claude -p` fan-out with real tracker writes — was never run. That is stated
// verbatim in `specs/frs/archive/STE-418.md` (in the AC itself and again under
// Implementation notes) and in `specs/plan/archive/M116.md` as a `- [deferred]`
// task with its reasoning. It was NOT stated in the `## [2.56.1]` "Keystone"
// CHANGELOG section — the one surface a consumer of the release actually reads
// — which listed eight clean `### Fixed` bullets and a test count, and so read
// as a milestone that shipped whole.
//
// WHY A TEST AND NOT JUST AN EDIT. The FR and the plan are archived and inert;
// the CHANGELOG is live, and `/ship-milestone` rewrites the top of it on every
// release. Nothing regenerates the v2.56.1 section, but nothing protects it
// either. This file makes deleting the disclosure RED.
//
// SCOPING IS LOAD-BEARING. Every CHANGELOG assertion is bounded to the
// `## [2.56.1]` section (its heading through the next `## [` heading), so a
// mention that drifts into a neighbouring release entry does NOT satisfy it — a
// deferral belongs to the release that shipped it, and the section a merging
// operator reads is the one that has to carry it. The tripwire at the end of
// the first describe is what keeps that scoping honest.
//
// THE PR-BODY HALF IS NOT TESTABLE HERE. The same gap existed in PR #54's
// "Recorded limitations — deliberately not papered over" section, which listed
// AC-STE-428.4 and AC-STE-430.3 and omitted the one AC on the branch that
// shipped unproven. Nothing in this repo can assert against a GitHub PR body;
// that half is applied by hand and stated in the release report.

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..", "..", "..");

function readIfPresent(relPath: string): string | null {
  const full = join(repoRoot, relPath);
  return existsSync(full) ? readFileSync(full, "utf-8") : null;
}

const changelog = readIfPresent("CHANGELOG.md");
const fr = readIfPresent("specs/frs/archive/STE-418.md");
const plan = readIfPresent("specs/plan/archive/M116.md");

/**
 * One release entry: its `## [X.Y.Z]` heading through (but not including) the
 * next `## [` heading. Empty when the version has no entry.
 */
function releaseSection(body: string, version: string): string {
  const start = body.indexOf(`## [${version}]`);
  if (start === -1) return "";
  const rest = body.slice(start + 1);
  const endRel = rest.indexOf("\n## [");
  return endRel === -1 ? body.slice(start) : body.slice(start, start + 1 + endRel);
}

const describeIfChangelog = changelog ? describe : describe.skip;

describeIfChangelog("the v2.56.1 release entry discloses the deferred AC", () => {
  const section = () => releaseSection(changelog!, "2.56.1");

  test("slice sanity: the v2.56.1 section anchors and still carries what it always did", () => {
    // Non-vacuity for everything below: if this slice went empty, every
    // `toContain` under it would fail for the wrong reason and every
    // `not.toContain` would pass for the wrong one.
    const s = section();
    expect(s).toContain('"Keystone"');
    expect(s).toContain("### Fixed");
    expect(s).toContain("(STE-424)");
    expect(s).toContain("Total test count at release: 5958 tests");
  });

  test("the deferral is named in the release entry, with its AC id", () => {
    expect(section()).toContain("AC-STE-418.4");
    expect(section()).toMatch(/defer/i);
  });

  test("it says WHICH half shipped and which did not — not merely that something was deferred", () => {
    // A bare "one AC was deferred" would satisfy a laxer assertion while
    // telling a merging operator nothing about what is unproven. The two
    // halves are the content: recorded replay landed, live leg did not.
    const s = section();
    expect(s).toMatch(/assertChainIntegrity/);
    expect(s).toMatch(/live/i);
    expect(s).toMatch(/\/smoke-test/);
  });

  test("it names when the AC actually closes, so the debt has an owner", () => {
    expect(section()).toMatch(/retroactive|next conformance run/i);
  });

  test("the disclosure is visually separate from the eight things that shipped whole", () => {
    // Buried as a ninth `### Fixed` bullet it would read as another fix.
    const s = section();
    expect(s).toContain("### Known limitations at ship");
    const limitationsAt = s.indexOf("### Known limitations at ship");
    const deferralAt = s.indexOf("AC-STE-418.4");
    expect(limitationsAt).toBeGreaterThan(-1);
    expect(deferralAt).toBeGreaterThan(limitationsAt);
  });

  test("TRIPWIRE: the disclosure lives in v2.56.1's own entry, not a neighbour's", () => {
    // The scoping every assertion above depends on. A deferral recorded
    // against v2.57.0 or v2.56.0 would leave the release that shipped it
    // silent, which is the exact defect.
    for (const other of ["2.57.0", "2.56.0"]) {
      const s = releaseSection(changelog!, other);
      expect(s.length).toBeGreaterThan(0); // slice sanity for the negative
      expect(s).not.toContain("AC-STE-418.4");
    }
  });
});

// The two surfaces that were already correct. Pinned so a future tidy-up
// cannot quietly make the CHANGELOG the only place the deferral survives —
// three records agreeing is the point, and any one of them going silent is
// the drift this file exists to catch.

describe("the FR and the plan keep their record of the same deferral", () => {
  test("the FR states it on the AC itself and again under Implementation notes", () => {
    expect(fr).not.toBeNull();
    const body = fr!;
    expect(body).toContain("AC-STE-418.4");
    expect(body).toMatch(/Shipped DEFERRED/);
    expect(body).toContain("## Implementation notes");
    expect(body.slice(body.indexOf("## Implementation notes"))).toMatch(/defer/i);
  });

  test("the plan records it as a `- [deferred]` task with its reasoning", () => {
    expect(plan).not.toBeNull();
    const body = plan!;
    expect(body).toContain("- [deferred]");
    expect(body).toMatch(/deferred: the recorded-replay half shipped/i);
    expect(body).toMatch(/STE-418/);
  });
});
