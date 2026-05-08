// STE-251 AC-STE-251.3 — unit-test matrix for the inspectCommit pure helper
// behind the socratic_first_turn_post_hoc_drift /gate-check probe.
//
// Variants per AC:
//   (a) canonical subject + audit row marker  ⇒ pass (legitimate)
//   (b) canonical subject + refusal NFR-10    ⇒ pass (legitimate)
//   (c) canonical subject + NEITHER           ⇒ violation
//   (d) non-canonical subject                 ⇒ vacuous (out-of-scope)
//
// The probe runner that wraps git is covered by the gate-check integration
// test at tests/gate-check-socratic-first-turn-post-hoc-drift.test.ts.

import { describe, expect, test } from "bun:test";
import {
  inspectCommit,
  runSocraticFirstTurnPostHocDriftProbe,
} from "./socratic_first_turn_post_hoc_drift";

describe("AC-STE-251.3 — inspectCommit decision matrix", () => {
  test("(a) canonical subject + spec_write_draft_default_applied row ⇒ legitimate", () => {
    const subject = "chore(specs): write FR STE-251";
    const body = [
      "",
      "Capability rows:",
      "spec_write_draft_default_applied",
      "",
      "Refs: STE-251",
    ].join("\n");
    expect(inspectCommit(subject, body)).toBe("legitimate");
  });

  test("(a') canonical subject + spec_write_commit_default_applied row ⇒ legitimate", () => {
    const subject = "chore(specs): write FR STE-251";
    const body = "Default-applied path: spec_write_commit_default_applied";
    expect(inspectCommit(subject, body)).toBe("legitimate");
  });

  test("(b) canonical subject + refusal NFR-10 block (Verdict: ... Refused) ⇒ legitimate", () => {
    const subject = "chore(specs): write FR STE-251";
    const body = [
      "Operator surfaced refusal:",
      "",
      "Verdict: /spec-write step 0a Refused; tracker_mode requires explicit answer.",
      "Remedy: re-invoke with --tracker=<mode> pre-bake or run interactively (tty).",
      "Context: skill=/spec-write, step=0a, key=tracker_mode, stdin=non-tty",
    ].join("\n");
    expect(inspectCommit(subject, body)).toBe("legitimate");
  });

  test("(b') refusal regex is case-insensitive on 'Refused'", () => {
    const subject = "chore(specs): write FR STE-251";
    const body = "Verdict: /spec-write refused — operator answer missing.";
    expect(inspectCommit(subject, body)).toBe("legitimate");
  });

  test("(c) canonical chore(specs): write FR subject + NEITHER marker ⇒ violation", () => {
    const subject = "chore(specs): write FR STE-251";
    const body = [
      "",
      "Wrote new FR with default-applied draft. No explicit consent captured.",
      "",
      "Refs: STE-251",
    ].join("\n");
    expect(inspectCommit(subject, body)).toBe("violation");
  });

  test("(c') canonical docs(specs): edit cross-cutting specs subject + NEITHER marker ⇒ violation", () => {
    const subject = "docs(specs): edit cross-cutting specs for STE-251";
    const body = "Updated technical-spec.md and testing-spec.md.\n\nRefs: STE-251";
    expect(inspectCommit(subject, body)).toBe("violation");
  });

  test("(d) non-canonical subject (feat scope) ⇒ out-of-scope (vacuous)", () => {
    const subject = "feat(skills/setup): install commit-msg hook";
    const body =
      "Body has no markers, but the subject is out of scope so the probe doesn't fire.";
    expect(inspectCommit(subject, body)).toBe("out-of-scope");
  });

  test("(d') chore(specs) with non-write verb ⇒ out-of-scope", () => {
    const subject = "chore(specs): bump traceability rows";
    expect(inspectCommit(subject, "")).toBe("out-of-scope");
  });

  test("(d'') docs(specs) with different cross-cutting wording ⇒ out-of-scope", () => {
    const subject = "docs(specs): refresh README links";
    expect(inspectCommit(subject, "")).toBe("out-of-scope");
  });

  test("subject with quoted canonical pattern mid-line ⇒ out-of-scope (anchored regex)", () => {
    // A revert / merge that quotes the original subject inline must NOT
    // activate the probe — the anchor (^) stops false-positives.
    const subject =
      'revert: this reverts "chore(specs): write FR STE-201" — see #1234';
    expect(inspectCommit(subject, "")).toBe("out-of-scope");
  });

  test("Verdict: line without 'Refused' wording ⇒ violation (must explicitly mark refusal)", () => {
    // A Verdict: line alone is not enough — the legitimacy contract
    // requires the literal "Refused" tag so the operator was truly
    // surfaced the refusal path.
    const subject = "chore(specs): write FR STE-251";
    const body = "Verdict: /spec-write step 0a — proceeding with default value.";
    expect(inspectCommit(subject, body)).toBe("violation");
  });
});

describe("AC-STE-251.3 — runSocraticFirstTurnPostHocDriftProbe (no-git fallback)", () => {
  test("vacuous on a directory with no .git/ — empty violations array", async () => {
    // The probe runner reads HEAD via `git -C`. When there is no .git/
    // directory it returns an empty report rather than throwing.
    const report = await runSocraticFirstTurnPostHocDriftProbe(
      "/tmp/nonexistent-no-git-dir-for-post-hoc-drift-probe-test",
    );
    expect(report.violations).toEqual([]);
  });
});
