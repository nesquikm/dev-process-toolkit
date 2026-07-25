// STE-376 AC-STE-376.4 / AC-STE-376.5 — M_<epic-key> union grammar:
// ship-milestone + gate-probe tolerance for Epic-keyed milestone plans.
//
// AC-STE-376.4 (doc leg): `skills/ship-milestone/SKILL.md` documents that a
// `specs/plan/M_<epic-key>.md` plan ships exactly like an `M<N>` plan (the
// stamp-writer behavior itself is pinned in
// `adapters/_shared/src/plan_ship_stamp.test.ts`).
//
// AC-STE-376.5 (archive walks): probes whose plan listing filters on
// `/^M\d+\.md$/` today silently skip Epic-keyed plans. Pinned here:
//   - probe #68 `migration_coverage` — an archived `M_PROJ_500.md` shipped
//     post-epoch must stay inside migration-coverage enforcement, and an
//     active `M_PROJ_500.md` missing `migration:` must surface the advisory.
//   - probe #16 `archive_plan_status` (the plan-filename walk) — an archived
//     `M_PROJ_500.md` with un-flipped frontmatter must be flagged.
//   - `skills/gate-check/SKILL.md` names the epic-keyed form so the
//     LLM-executed probe prose matches the deterministic helpers.

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runArchivePlanStatusProbe } from "../adapters/_shared/src/archive_plan_status";
import { runMigrationCoverageProbe } from "../adapters/_shared/src/migrations/coverage";

const pluginRoot = join(import.meta.dir, "..");

// Matches "M_<epic-key>" and close variants ("M_<epic_key>", "M_<key>") so the
// prose assert doesn't hinge on one placeholder spelling.
const EPIC_FORM_PROSE = /M_<[^>]*key[^>]*>/i;

interface Fixture {
  root: string;
  planDir: string;
  archiveDir: string;
  cleanup: () => void;
}

function makeFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "m101-epic-grammar-"));
  const planDir = join(root, "specs", "plan");
  const archiveDir = join(planDir, "archive");
  mkdirSync(archiveDir, { recursive: true });
  return { root, planDir, archiveDir, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

/** Minimal plan file with configurable frontmatter scalar lines. */
function writePlan(dir: string, name: string, fields: Record<string, string>): void {
  const m = name.replace(/\.md$/, "");
  const lines = ["---", `milestone: ${m}`];
  for (const [key, value] of Object.entries(fields)) lines.push(`${key}: ${value}`);
  lines.push("---", "", `## ${m}: Epic-keyed fixture milestone`, "", "Body.", "");
  writeFileSync(join(dir, name), lines.join("\n"));
}

// ---------------------------------------------------------------------------
// AC-STE-376.4 — ship-milestone documents the epic-keyed plan form
// ---------------------------------------------------------------------------

describe("AC-STE-376.4 — /ship-milestone accepts M_<epic-key> plans (doc leg)", () => {
  test("skills/ship-milestone/SKILL.md names the M_<epic-key> milestone form", () => {
    const md = readFileSync(join(pluginRoot, "skills", "ship-milestone", "SKILL.md"), "utf-8");
    expect(md).toMatch(EPIC_FORM_PROSE);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-376.5 — probe #68 migration_coverage archive walk
// ---------------------------------------------------------------------------

describe("AC-STE-376.5 — probe #68 walks epic-keyed archived plans", () => {
  test("post-epoch archived M_PROJ_500.md with no migration: key → ERROR violation (not silently skipped)", async () => {
    const fx = makeFixture();
    try {
      writePlan(fx.archiveDir, "M_PROJ_500.md", {
        status: "archived",
        archived_at: "2026-07-23T00:00:00Z",
        shipped_in: "v9.9.9", // unambiguously ≥ MIGRATION_COVERAGE_EPOCH
      });
      const report = await runMigrationCoverageProbe(fx.root, []);
      expect(report.violations.length).toBe(1);
      expect(report.violations[0]!.note).toMatch(/M_PROJ_500\.md/);
      expect(report.violations[0]!.message).toMatch(/migration/);
    } finally {
      fx.cleanup();
    }
  });

  test("post-epoch archived M_PROJ_500.md declaring migration: none → zero violations", async () => {
    const fx = makeFixture();
    try {
      writePlan(fx.archiveDir, "M_PROJ_500.md", {
        status: "archived",
        archived_at: "2026-07-23T00:00:00Z",
        shipped_in: "v9.9.9",
        migration: "none",
      });
      const report = await runMigrationCoverageProbe(fx.root, []);
      expect(report.violations).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("active M_PROJ_500.md with no migration: key → advisory warning (not silently skipped)", async () => {
    const fx = makeFixture();
    try {
      writePlan(fx.planDir, "M_PROJ_500.md", { status: "active" });
      const report = await runMigrationCoverageProbe(fx.root, []);
      expect(report.violations).toEqual([]);
      expect(report.warnings.length).toBe(1);
      expect(report.warnings[0]!.note).toMatch(/M_PROJ_500\.md/);
    } finally {
      fx.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// AC-STE-376.5 — probe #16 archive_plan_status plan-filename walk
// ---------------------------------------------------------------------------

describe("AC-STE-376.5 — probe #16 plan-filename walk sees epic-keyed plans", () => {
  test("archived M_PROJ_500.md with un-flipped status: active → violation (not silently skipped)", async () => {
    const fx = makeFixture();
    try {
      writePlan(fx.archiveDir, "M_PROJ_500.md", {
        status: "active",
        archived_at: "null",
      });
      const report = await runArchivePlanStatusProbe(fx.root);
      expect(report.violations.length).toBeGreaterThanOrEqual(1);
      expect(report.violations.map((v) => v.note).join("\n")).toMatch(/M_PROJ_500\.md/);
    } finally {
      fx.cleanup();
    }
  });

  test("archived M_PROJ_500.md with coherent frontmatter → zero violations (no false positive)", async () => {
    const fx = makeFixture();
    try {
      writePlan(fx.archiveDir, "M_PROJ_500.md", {
        status: "archived",
        archived_at: "2026-07-23T00:00:00Z",
      });
      const report = await runArchivePlanStatusProbe(fx.root);
      expect(report.violations).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// AC-STE-376.5 — gate-check prose names the epic-keyed form
// ---------------------------------------------------------------------------

describe("AC-STE-376.5 — gate-check documents the union grammar", () => {
  test("skills/gate-check/SKILL.md names the M_<epic-key> milestone form", () => {
    const md = readFileSync(join(pluginRoot, "skills", "gate-check", "SKILL.md"), "utf-8");
    expect(md).toMatch(EPIC_FORM_PROSE);
  });
});
