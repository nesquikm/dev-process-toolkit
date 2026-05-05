import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// STE-220 / STE-221 / STE-222 — runtime regression fixtures landed in the
// /smoke-test driver. These tests assert the smoke-test SKILL.md carries
// the Phase 2.X fixtures + canonical diagnostic shape so the next smoke
// run actually exercises the M55 cohort's runtime contracts (rather than
// trusting LLM self-confirm at /implement Phase 4 self-review).
//
// Diagnostic shape contract: each fixture failure emits
//   STE-<XXX> runtime regression: <fixture-name>
// where <XXX> is the FR being regression-tested (STE-213 / STE-214 / STE-215),
// not the M56 FR carrying the fixture. Letting the diagnostic name the
// system-under-test (vs. the test FR) keeps triage instant: an operator
// sees STE-214 and goes straight to the probe-#26 implementation.

const repoRoot = join(import.meta.dir, "..", "..", "..");
const skillPath = join(repoRoot, ".claude", "skills", "smoke-test", "SKILL.md");

function readSkillIfPresent(): string | null {
  if (!existsSync(skillPath)) return null;
  return readFileSync(skillPath, "utf8");
}

const skill = readSkillIfPresent();
const describeIfPresent = skill === null ? describe.skip : describe;

describeIfPresent("AC-STE-220.4 — smoke-driver captures /spec-write stdout + asserts both capability rows", () => {
  test("the smoke driver names the canonical capability rows for the /spec-write -p run", () => {
    const body = skill!;
    // The driver must grep the captured /spec-write log for both capability
    // rows. Either row missing on a non-interactive run = STE-220 regression.
    expect(body).toMatch(/spec_write_draft_default_applied/);
    expect(body).toMatch(/spec_write_commit_default_applied/);
  });

  test("the canonical STE-220 regression diagnostic shape is documented", () => {
    const body = skill!;
    // The diagnostic must literally name STE-220 (the M56 FR carrying the
    // fix) AND identify which capability row was missing. Generic "test
    // failed" messages are insufficient per the FR's AC.4.
    expect(body).toMatch(/STE-220 runtime regression/i);
  });
});

describeIfPresent("STE-221 — Phase 2.X fixtures for STE-214 probe #26 ## Notes scanner", () => {
  test("smoke driver carries fixtures for probe #26 ## Notes capability-gap reading", () => {
    const body = skill!;
    // Three fixtures per FR: positive (canonical key) / control (no key) /
    // deprecated-alias (the STE-198 alias). All three must be named.
    expect(body).toMatch(/probe[\s-]?(?:#)?26/i);
    expect(body).toMatch(/milestone_attach_skipped_adapter_limit/);
    // Deprecated-alias coverage — STE-198 rollover-window contract.
    expect(body).toMatch(/milestone_attach_unavailable/);
  });

  test("the STE-214 regression diagnostic uses the correct tracker ID (system-under-test)", () => {
    const body = skill!;
    // The diagnostic names STE-214 (the original FR being regression-tested)
    // not STE-221 (the M56 FR carrying the fixture). Triage must point to
    // the system-under-test, not the test infrastructure.
    expect(body).toMatch(/STE-214 runtime regression/i);
  });
});

describeIfPresent("STE-222 — Phase 2.X fixtures for STE-215 cross-cutting drift propagation", () => {
  test("smoke driver carries fixtures for the cross-cutting spec-drift propagation hook", () => {
    const body = skill!;
    // Three fixtures per FR: positive (deletion ⇒ propagation commit) /
    // control (no deletion ⇒ silent no-op) / probe-side (stale ref on disk
    // ⇒ ADVISORY).
    expect(body).toMatch(/propagate.*removal to cross-cutting specs/i);
    expect(body).toMatch(/cross-cutting-spec-stale-file-refs|cross_cutting_spec_stale_file_refs/);
  });

  test("the STE-215 regression diagnostic uses the correct tracker ID (system-under-test)", () => {
    const body = skill!;
    expect(body).toMatch(/STE-215 runtime regression/i);
  });

  test("STE-222 fixture carries a git-log excerpt in its diagnostic shape (in addition to stdout)", () => {
    const body = skill!;
    // STE-222 specifically — /implement failures often surface in git log
    // shape, not stdout. The diagnostic must include both.
    const ste215Block = body.match(/STE-215 runtime regression[\s\S]{0,1500}/);
    expect(ste215Block).not.toBeNull();
    expect(ste215Block![0]).toMatch(/git log/i);
  });
});

describeIfPresent("M56 contract — runtime regressions name the system-under-test, not the test FR", () => {
  test("no diagnostic uses M56 FR IDs (STE-220 / STE-221 / STE-222) where it should use the SUT FR ID", () => {
    const body = skill!;
    // STE-221's diagnostic names STE-214; STE-222's names STE-215. We don't
    // expect STE-221 / STE-222 to appear in regression diagnostics at all
    // (only STE-214 / STE-215 do). STE-220 IS its own SUT (it both carries
    // the fix and the regression test for itself), so STE-220 IS allowed
    // in regression diagnostics.
    expect(body).not.toMatch(/STE-221 runtime regression/i);
    expect(body).not.toMatch(/STE-222 runtime regression/i);
  });
});
