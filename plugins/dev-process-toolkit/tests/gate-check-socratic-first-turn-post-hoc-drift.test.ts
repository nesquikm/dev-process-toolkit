// STE-251 AC-STE-251.3 — integration test for the
// socratic_first_turn_post_hoc_drift /gate-check probe.
//
// Builds a real git repo per variant, lands one commit with the variant's
// (subject, body), runs runSocraticFirstTurnPostHocDriftProbe(root), and
// asserts the report shape:
//
//   (a) canonical subject + audit row marker  ⇒ pass (no violations)
//   (b) canonical subject + refusal NFR-10    ⇒ pass (no violations)
//   (c) canonical subject + NEITHER marker    ⇒ violation (1 row, severity=error)
//   (d) non-canonical subject                 ⇒ vacuous (no violations)
//
// Variants intentionally mirror the unit-test matrix at
// adapters/_shared/src/socratic_first_turn_post_hoc_drift.test.ts; the
// integration test is the wire-up confirmation that the runner reads HEAD
// correctly and surfaces the violation in NFR-10 canonical shape.

import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSocraticFirstTurnPostHocDriftProbe } from "../adapters/_shared/src/socratic_first_turn_post_hoc_drift";

interface Repo {
  root: string;
  cleanup: () => void;
}

function newRepo(): Repo {
  const root = mkdtempSync(join(tmpdir(), "post-hoc-drift-probe-"));
  execFileSync("git", ["-C", root, "init", "-q"]);
  execFileSync("git", ["-C", root, "config", "user.email", "test@example.com"]);
  execFileSync("git", ["-C", root, "config", "user.name", "Test User"]);
  // Disable commit-msg hook so the test can land non-conventional subjects
  // for variant (d). The probe runs against HEAD bytes, not against hook
  // output.
  execFileSync("git", ["-C", root, "config", "core.hooksPath", "/dev/null"]);
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function commit(root: string, subject: string, body: string): void {
  writeFileSync(join(root, "README.md"), `${subject}\n\n${body}\n`);
  execFileSync("git", ["-C", root, "add", "README.md"]);
  const message = body ? `${subject}\n\n${body}` : subject;
  execFileSync("git", ["-C", root, "commit", "-q", "--allow-empty", "-m", message]);
}

describe("AC-STE-251.3 — gate-check post-hoc-drift probe (integration)", () => {
  test("(a) canonical subject + spec_write_draft_default_applied row ⇒ no violations", async () => {
    const ctx = newRepo();
    try {
      commit(
        ctx.root,
        "chore(specs): write FR STE-251",
        [
          "Capability rows:",
          "spec_write_draft_default_applied",
          "",
          "Refs: STE-251",
        ].join("\n"),
      );
      const report = await runSocraticFirstTurnPostHocDriftProbe(ctx.root);
      expect(report.violations).toEqual([]);
    } finally {
      ctx.cleanup();
    }
  });

  test("(b) canonical subject + Verdict refusal block ⇒ no violations", async () => {
    const ctx = newRepo();
    try {
      commit(
        ctx.root,
        "chore(specs): write FR STE-251",
        [
          "Operator surfaced refusal:",
          "",
          "Verdict: /spec-write step 0a Refused; tracker_mode requires explicit answer.",
          "Remedy: re-invoke with --tracker=<mode> pre-bake or run interactively (tty).",
          "Context: skill=/spec-write, step=0a, key=tracker_mode, stdin=non-tty",
          "",
          "Refs: STE-251",
        ].join("\n"),
      );
      const report = await runSocraticFirstTurnPostHocDriftProbe(ctx.root);
      expect(report.violations).toEqual([]);
    } finally {
      ctx.cleanup();
    }
  });

  test("(c) canonical subject + NEITHER marker ⇒ 1 violation, severity=error, capability key set", async () => {
    const ctx = newRepo();
    try {
      commit(
        ctx.root,
        "chore(specs): write FR STE-251",
        [
          "Wrote new FR with default-applied draft. No explicit consent captured.",
          "",
          "Refs: STE-251",
        ].join("\n"),
      );
      const report = await runSocraticFirstTurnPostHocDriftProbe(ctx.root);
      expect(report.violations.length).toBe(1);
      const v = report.violations[0]!;
      expect(v.severity).toBe("error");
      expect(v.capability).toBe("socratic_first_turn_post_hoc_drift_violation");
      expect(v.subject).toBe("chore(specs): write FR STE-251");
      expect(v.commit).toMatch(/^[0-9a-f]{12}$/);
      // NFR-10 canonical shape — identifier-prefixed Verdict line, then
      // Remedy / Context on subsequent lines (matches probe #43 message
      // convention).
      expect(v.message).toContain("socratic_first_turn_post_hoc_drift_violation");
      expect(v.message).toContain("Remedy:");
      expect(v.message).toContain("Context:");
      expect(v.message).toContain("docs/auto-mode-protocol.md");
      // Subject + commit hash surface in the message so the operator can
      // git-show the offending commit directly from the gate output.
      expect(v.message).toContain("chore(specs): write FR STE-251");
      expect(v.note).toMatch(/^[0-9a-f]{12}:1 — /);
    } finally {
      ctx.cleanup();
    }
  });

  test("(c') canonical docs(specs) cross-cutting subject + NEITHER marker ⇒ 1 violation", async () => {
    const ctx = newRepo();
    try {
      commit(
        ctx.root,
        "docs(specs): edit cross-cutting specs for STE-251",
        "Updated technical-spec.md and testing-spec.md.\n\nRefs: STE-251",
      );
      const report = await runSocraticFirstTurnPostHocDriftProbe(ctx.root);
      expect(report.violations.length).toBe(1);
      expect(report.violations[0]!.subject).toContain(
        "docs(specs): edit cross-cutting specs",
      );
    } finally {
      ctx.cleanup();
    }
  });

  test("(d) non-canonical subject (feat) ⇒ vacuous (no violations)", async () => {
    const ctx = newRepo();
    try {
      commit(
        ctx.root,
        "feat(skills/setup): install commit-msg hook",
        "Body has no markers, but subject is out of scope.\n\nRefs: STE-251",
      );
      const report = await runSocraticFirstTurnPostHocDriftProbe(ctx.root);
      expect(report.violations).toEqual([]);
    } finally {
      ctx.cleanup();
    }
  });

  test("vacuous on a directory with no .git/ — graceful no-op", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "post-hoc-drift-no-git-"));
    try {
      const report = await runSocraticFirstTurnPostHocDriftProbe(tmp);
      expect(report.violations).toEqual([]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
