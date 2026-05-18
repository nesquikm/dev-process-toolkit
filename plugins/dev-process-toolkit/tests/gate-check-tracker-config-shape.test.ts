// STE-302 AC-STE-302.8 — `tracker_config_shape` /gate-check probe.
//
// Byte-checks `specs/tracker-config.yaml` shape when the file exists:
// schema invariants per AC.2 + AC.3 + AC.4. Vacuous when file absent
// (FR2's responsibility to write it). `mode: none` short-circuits — no
// read attempted.
//
// Mirrors the shape of `runArchivePlanStatusProbe` (probe #16) — returns a
// `violations: TrackerConfigShapeViolation[]` report with `file:line —
// reason` notes in NFR-10 canonical shape.

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTrackerConfigShapeProbe } from "../adapters/_shared/src/tracker_config_shape";

function makeProjectRoot(opts?: { trackerMode?: string }): {
  root: string;
  specsDir: string;
  cleanup: () => void;
} {
  const root = mkdtempSync(join(tmpdir(), "tracker-config-probe-"));
  const specsDir = join(root, "specs");
  mkdirSync(specsDir, { recursive: true });
  // CLAUDE.md with the canonical Task Tracking section so the probe can
  // resolve the active adapter for the cross-check arm. Use `mode: linear`
  // by default; `mode: none` is the short-circuit branch.
  const trackerMode = opts?.trackerMode ?? "linear";
  const claudeMd = [
    "# Test project",
    "",
    "## Task Tracking",
    "",
    `mode: ${trackerMode}`,
    "mcp_server: linear",
    "",
    "### Linear",
    "",
    "team: TST",
    "project: Test",
    "",
  ].join("\n");
  writeFileSync(join(root, "CLAUDE.md"), claudeMd);
  return { root, specsDir, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function writeYaml(specsDir: string, body: string): void {
  writeFileSync(join(specsDir, "tracker-config.yaml"), body);
}

const VALID_YAML = [
  "tracker_key: linear",
  "statuses:",
  "  - Backlog",
  "  - In Progress",
  "  - In Review",
  "  - Done",
  "roles:",
  "  initial: Backlog",
  "  in_progress: In Progress",
  "  in_review: In Review",
  "  done: Done",
  "",
].join("\n");

describe("AC-STE-302.8 positive — valid tracker-config.yaml passes", () => {
  test("conforming file → zero violations", async () => {
    const ctx = makeProjectRoot();
    try {
      writeYaml(ctx.specsDir, VALID_YAML);
      const report = await runTrackerConfigShapeProbe(ctx.root);
      expect(report.violations).toEqual([]);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-302.8 vacuous — file absent does not fail the probe", () => {
  test("no tracker-config.yaml → zero violations (FR2 owns creation)", async () => {
    const ctx = makeProjectRoot();
    try {
      const report = await runTrackerConfigShapeProbe(ctx.root);
      expect(report.violations).toEqual([]);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-302.8 short-circuit — mode: none skips the probe", () => {
  test("mode: none + present (but malformed) file → zero violations, no read attempted", async () => {
    const ctx = makeProjectRoot({ trackerMode: "none" });
    try {
      // Even a garbage file should not cause violations under mode: none.
      writeYaml(ctx.specsDir, "this is: not\n  -valid-\n yaml::::\n");
      const report = await runTrackerConfigShapeProbe(ctx.root);
      expect(report.violations).toEqual([]);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-302.8 negative — malformed YAML fails the probe", () => {
  test("garbage YAML → violation in NFR-10 canonical shape", async () => {
    const ctx = makeProjectRoot();
    try {
      writeYaml(ctx.specsDir, "tracker_key: linear\nstatuses: not-a-list\nroles: {}\n");
      const report = await runTrackerConfigShapeProbe(ctx.root);
      expect(report.violations.length).toBeGreaterThanOrEqual(1);
      const v = report.violations[0]!;
      expect(v.file).toContain("tracker-config.yaml");
      expect(v.message).toMatch(/Refusing:|tracker_config_shape/);
      expect(v.message).toMatch(/Remedy:/);
      expect(v.message).toMatch(/Context:/);
      expect(v.note).toMatch(/^specs\/tracker-config\.yaml:\d+ — /);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-302.8 negative — schema invariants per AC.2/.3/.4", () => {
  test("empty statuses array fails the probe (AC.2)", async () => {
    const ctx = makeProjectRoot();
    try {
      writeYaml(
        ctx.specsDir,
        [
          "tracker_key: linear",
          "statuses: []",
          "roles:",
          "  initial: Backlog",
          "  in_progress: In Progress",
          "  in_review: In Review",
          "  done: Done",
          "",
        ].join("\n"),
      );
      const report = await runTrackerConfigShapeProbe(ctx.root);
      expect(report.violations.length).toBeGreaterThanOrEqual(1);
      expect(report.violations[0]!.note).toMatch(/statuses/);
    } finally {
      ctx.cleanup();
    }
  });

  test("role value not in statuses: fails the probe (AC.2)", async () => {
    const ctx = makeProjectRoot();
    try {
      writeYaml(
        ctx.specsDir,
        [
          "tracker_key: linear",
          "statuses:",
          "  - Backlog",
          "  - In Progress",
          "  - In Review",
          "  - Done",
          "roles:",
          "  initial: Backlog",
          "  in_progress: Coding",     // not in statuses
          "  in_review: In Review",
          "  done: Done",
          "",
        ].join("\n"),
      );
      const report = await runTrackerConfigShapeProbe(ctx.root);
      expect(report.violations.length).toBeGreaterThanOrEqual(1);
      expect(report.violations[0]!.message).toMatch(/Coding|in_progress/);
    } finally {
      ctx.cleanup();
    }
  });

  test("missing required role fails the probe (AC.3)", async () => {
    const ctx = makeProjectRoot();
    try {
      writeYaml(
        ctx.specsDir,
        [
          "tracker_key: linear",
          "statuses:",
          "  - Backlog",
          "  - In Progress",
          "  - In Review",
          "  - Done",
          "roles:",
          "  initial: Backlog",
          "  in_progress: In Progress",
          "  done: Done",
          // in_review intentionally missing
          "",
        ].join("\n"),
      );
      const report = await runTrackerConfigShapeProbe(ctx.root);
      expect(report.violations.length).toBeGreaterThanOrEqual(1);
      expect(report.violations[0]!.message).toMatch(/in_review/);
    } finally {
      ctx.cleanup();
    }
  });

  test("extra role outside the four-value enum fails the probe (AC.3)", async () => {
    const ctx = makeProjectRoot();
    try {
      writeYaml(
        ctx.specsDir,
        [
          "tracker_key: linear",
          "statuses:",
          "  - Backlog",
          "  - In Progress",
          "  - In Review",
          "  - Done",
          "  - Blocked",
          "roles:",
          "  initial: Backlog",
          "  in_progress: In Progress",
          "  in_review: In Review",
          "  done: Done",
          "  blocked: Blocked",
          "",
        ].join("\n"),
      );
      const report = await runTrackerConfigShapeProbe(ctx.root);
      expect(report.violations.length).toBeGreaterThanOrEqual(1);
      expect(report.violations[0]!.message).toMatch(/blocked/);
    } finally {
      ctx.cleanup();
    }
  });

  test("tracker_key mismatch against active adapter fails the probe (AC.2)", async () => {
    const ctx = makeProjectRoot({ trackerMode: "linear" });
    try {
      writeYaml(
        ctx.specsDir,
        [
          "tracker_key: jira",   // mismatches CLAUDE.md's `mode: linear`
          "statuses:",
          "  - Backlog",
          "  - In Progress",
          "  - In Review",
          "  - Done",
          "roles:",
          "  initial: Backlog",
          "  in_progress: In Progress",
          "  in_review: In Review",
          "  done: Done",
          "",
        ].join("\n"),
      );
      const report = await runTrackerConfigShapeProbe(ctx.root);
      expect(report.violations.length).toBeGreaterThanOrEqual(1);
      expect(report.violations[0]!.message).toMatch(/tracker_key|jira|linear/);
    } finally {
      ctx.cleanup();
    }
  });
});
