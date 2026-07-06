// STE-369 AC-STE-369.{1,2,3,4,5} — /gate-check probe `plan_ship_coherence`.
// Severity: error (GATE FAILED).
//
// Pins the contract of the pure probe
// `adapters/_shared/src/plan_ship_coherence.ts`:
//
//   runPlanShipCoherenceProbe(projectRoot: string)
//     => Promise<{
//          violations: { file; line; reason; note; message }[];
//          notes: string[];
//        }>
//
// Decision matrix per `specs/plan/archive/M<N>.md` (archive dir ONLY —
// live plans under `specs/plan/` are exempt by construction):
//   - `shipped_in: v<X.Y.Z>` present → a `## [X.Y.Z]` heading must exist
//     in CHANGELOG.md; missing heading or malformed stamp value ⇒
//     violation (corrupt stamp) in NFR-10 canonical shape naming the
//     plan, the stamp value, and the remedy.
//   - `ship_state: parked` → no violation; collected into a single
//     GATE PASSED WITH NOTES row `parked milestones: M92, M97`.
//   - neither → violation whose message carries the canonical post-merge
//     ceremony recipe (exported as SHIP_CEREMONY_RECIPE so
//     docs/ship-milestone-reference.md can share it verbatim — STE-370).
//
// Violation shape follows probe #16 (`archive_plan_status`): `note` is
// `<repo-relative-file>:<line> — <reason>`, `message` is the NFR-10
// multi-line canonical shape with `Remedy:` and `Context:` sub-lines.
//
// Fixtures are in-memory via mkdtempSync per the probe convention
// (`tests/gate-check-archive-plan-status.test.ts`). Filter by AC with
// `bun test -t "AC-STE-369.N"`.

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SHIP_CEREMONY_RECIPE,
  runPlanShipCoherenceProbe,
} from "../adapters/_shared/src/plan_ship_coherence";

const pluginRoot = join(import.meta.dir, "..");
const repoRoot = join(pluginRoot, "..", "..");

interface Fixture {
  root: string;
  archiveDir: string;
  planDir: string;
  cleanup: () => void;
}

function makeFixture(changelog: string): Fixture {
  const root = mkdtempSync(join(tmpdir(), "plan-ship-coherence-"));
  const planDir = join(root, "specs", "plan");
  const archiveDir = join(planDir, "archive");
  mkdirSync(archiveDir, { recursive: true });
  writeFileSync(join(root, "CHANGELOG.md"), changelog);
  return { root, archiveDir, planDir, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

/** Minimal archived-plan file with optional shipped_in / ship_state lines. */
function writePlan(
  dir: string,
  name: string,
  fields: { shipped_in?: string; ship_state?: string } = {},
): void {
  const m = name.replace(/\.md$/, "");
  const lines = [
    "---",
    `milestone: ${m}`,
    "status: archived",
    "archived_at: 2026-07-01T00:00:00Z",
  ];
  if (fields.shipped_in !== undefined) lines.push(`shipped_in: ${fields.shipped_in}`);
  if (fields.ship_state !== undefined) lines.push(`ship_state: ${fields.ship_state}`);
  lines.push("---", "", `# ${m}: fixture milestone`, "", "Body.", "");
  writeFileSync(join(dir, name), lines.join("\n"));
}

const CHANGELOG_TWO_RELEASES = [
  "# Changelog",
  "",
  '## [2.40.0] — 2026-07-06 — "Ceremony"',
  "",
  "- stuff",
  "",
  '## [2.39.0] — 2026-07-06 — "Headless"',
  "",
  "- stuff",
  "",
].join("\n");

// ---------------------------------------------------------------------------
// AC-STE-369.1 — stamp coherence
// ---------------------------------------------------------------------------

describe("AC-STE-369.1 — stamp coherence", () => {
  test("positive: every stamped plan has a matching ## [X.Y.Z] CHANGELOG heading → zero violations, zero notes", async () => {
    const fx = makeFixture(CHANGELOG_TWO_RELEASES);
    try {
      writePlan(fx.archiveDir, "M98.md", { shipped_in: "v2.39.0" });
      writePlan(fx.archiveDir, "M99.md", { shipped_in: "v2.40.0" });
      const report = await runPlanShipCoherenceProbe(fx.root);
      expect(report.violations).toEqual([]);
      expect(report.notes).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("negative: stamp without a CHANGELOG heading → violation naming plan, stamp value, and remedy (NFR-10)", async () => {
    const fx = makeFixture(CHANGELOG_TWO_RELEASES);
    try {
      writePlan(fx.archiveDir, "M42.md", { shipped_in: "v9.9.9" });
      const report = await runPlanShipCoherenceProbe(fx.root);
      expect(report.violations.length).toBe(1);
      const v = report.violations[0]!;
      expect(v.file).toContain("M42.md");
      expect(v.note).toMatch(/^specs\/plan\/archive\/M42\.md:\d+ — /);
      // NFR-10 canonical message: names the plan, the stamp value, the remedy.
      expect(v.message).toContain("specs/plan/archive/M42.md");
      expect(v.message).toContain("v9.9.9");
      expect(v.message).toMatch(/Remedy:/);
      expect(v.message).toMatch(/Context:/);
    } finally {
      fx.cleanup();
    }
  });

  test("negative: malformed stamp value (not v<X.Y.Z>) → corrupt-stamp violation naming the observed value", async () => {
    const fx = makeFixture(CHANGELOG_TWO_RELEASES);
    try {
      writePlan(fx.archiveDir, "M43.md", { shipped_in: "2.40.0" }); // missing v prefix
      writePlan(fx.archiveDir, "M44.md", { shipped_in: "vNext" }); // not a semver at all
      const report = await runPlanShipCoherenceProbe(fx.root);
      expect(report.violations.length).toBe(2);
      const m43 = report.violations.find((v) => v.file.includes("M43.md"));
      const m44 = report.violations.find((v) => v.file.includes("M44.md"));
      expect(m43).toBeDefined();
      expect(m44).toBeDefined();
      expect(m43!.message).toContain("2.40.0");
      expect(m43!.message).toMatch(/Remedy:/);
      expect(m44!.message).toContain("vNext");
      expect(m44!.note).toMatch(/^specs\/plan\/archive\/M44\.md:\d+ — /);
    } finally {
      fx.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// AC-STE-369.2 — unshipped debt fails the gate
// ---------------------------------------------------------------------------

describe("AC-STE-369.2 — unshipped debt fails the gate", () => {
  test("archived plan with neither shipped_in nor ship_state: parked → GATE FAILED with the ceremony-recipe remedy", async () => {
    const fx = makeFixture(CHANGELOG_TWO_RELEASES);
    try {
      writePlan(fx.archiveDir, "M100.md"); // neither stamp nor parked
      const report = await runPlanShipCoherenceProbe(fx.root);
      expect(report.violations.length).toBe(1);
      const v = report.violations[0]!;
      expect(v.file).toContain("M100.md");
      expect(v.note).toMatch(/^specs\/plan\/archive\/M100\.md:\d+ — /);
      expect(v.message).toMatch(/Remedy:/);
      expect(v.message).toMatch(/Context:/);
      // The typed remedy carries the canonical post-merge ceremony recipe.
      expect(v.message).toContain(SHIP_CEREMONY_RECIPE);
    } finally {
      fx.cleanup();
    }
  });

  test("SHIP_CEREMONY_RECIPE is the canonical recipe string (shared with docs/ship-milestone-reference.md)", () => {
    expect(SHIP_CEREMONY_RECIPE).toContain("/spec-archive M<N>");
    expect(SHIP_CEREMONY_RECIPE).toContain("only when FRs are still active");
    expect(SHIP_CEREMONY_RECIPE).toContain("/ship-milestone M<N>");
    expect(SHIP_CEREMONY_RECIPE).toContain("/pr");
    // Ceremony order: archive → ship → pr.
    const iArchive = SHIP_CEREMONY_RECIPE.indexOf("/spec-archive M<N>");
    const iShip = SHIP_CEREMONY_RECIPE.indexOf("/ship-milestone M<N>");
    const iPr = SHIP_CEREMONY_RECIPE.indexOf("/pr");
    expect(iArchive).toBeGreaterThan(-1);
    expect(iShip).toBeGreaterThan(iArchive);
    expect(iPr).toBeGreaterThan(iShip);
  });

  test("two debtor plans → one violation each, deterministic file identity", async () => {
    const fx = makeFixture(CHANGELOG_TWO_RELEASES);
    try {
      writePlan(fx.archiveDir, "M101.md");
      writePlan(fx.archiveDir, "M102.md");
      const report = await runPlanShipCoherenceProbe(fx.root);
      expect(report.violations.length).toBe(2);
      const files = report.violations.map((v) => v.file);
      expect(files.some((f) => f.includes("M101.md"))).toBe(true);
      expect(files.some((f) => f.includes("M102.md"))).toBe(true);
    } finally {
      fx.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// AC-STE-369.3 — parked is visible, never silent
// ---------------------------------------------------------------------------

describe("AC-STE-369.3 — parked passes with a NOTES row", () => {
  test("ship_state: parked → zero violations + single NOTES row enumerating every parked milestone", async () => {
    const fx = makeFixture(CHANGELOG_TWO_RELEASES);
    try {
      writePlan(fx.archiveDir, "M91.md", { shipped_in: "v2.39.0" }); // coherent, not parked
      writePlan(fx.archiveDir, "M92.md", { ship_state: "parked" });
      writePlan(fx.archiveDir, "M97.md", { ship_state: "parked" });
      const report = await runPlanShipCoherenceProbe(fx.root);
      expect(report.violations).toEqual([]);
      // One NOTES row, enumerating both — the designed counter-pressure
      // against parked becoming a silent get-to-green stamp.
      expect(report.notes).toEqual(["parked milestones: M92, M97"]);
    } finally {
      fx.cleanup();
    }
  });

  test("no parked milestones → no NOTES row at all", async () => {
    const fx = makeFixture(CHANGELOG_TWO_RELEASES);
    try {
      writePlan(fx.archiveDir, "M98.md", { shipped_in: "v2.39.0" });
      const report = await runPlanShipCoherenceProbe(fx.root);
      expect(report.notes).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("scope guard: live plans under specs/plan/ are exempt — an unstamped live plan is never flagged", async () => {
    const fx = makeFixture(CHANGELOG_TWO_RELEASES);
    try {
      // Live (non-archive) plan with neither stamp nor parked state.
      writeFileSync(
        join(fx.planDir, "M50.md"),
        ["---", "milestone: M50", "status: active", "archived_at: null", "---", "", "# M50: live", ""].join("\n"),
      );
      writePlan(fx.archiveDir, "M49.md", { shipped_in: "v2.40.0" });
      const report = await runPlanShipCoherenceProbe(fx.root);
      expect(report.violations).toEqual([]);
      expect(report.notes).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// AC-STE-369.4 — /spec-archive --parked prose + exit hints (meta-test)
// ---------------------------------------------------------------------------

describe("AC-STE-369.4 — /spec-archive SKILL.md documents --parked + exit hints", () => {
  const specArchiveSkill = readFileSync(
    join(pluginRoot, "skills", "spec-archive", "SKILL.md"),
    "utf-8",
  );

  test("--parked flag is documented and writes ship_state: parked during the archival flip", () => {
    expect(specArchiveSkill).toContain("--parked");
    expect(specArchiveSkill).toContain("ship_state: parked");
  });

  test("the parked flip rides the existing mandatory diff-approval gate — no new prompt", () => {
    expect(specArchiveSkill).toMatch(/no new prompt/i);
  });

  test("default exit hint is pinned verbatim", () => {
    expect(specArchiveSkill).toContain("Archived. Next: /ship-milestone M<N>");
  });

  test("parked exit hint is pinned verbatim", () => {
    expect(specArchiveSkill).toContain(
      "Archived (parked). Unpark by shipping: /ship-milestone M<N>",
    );
  });
});

// ---------------------------------------------------------------------------
// AC-STE-369.5 — gate-check SKILL.md probe row (meta-test)
// ---------------------------------------------------------------------------

describe("AC-STE-369.5 — gate-check SKILL.md declares the plan_ship_coherence probe row", () => {
  const gateCheckSkill = readFileSync(
    join(pluginRoot, "skills", "gate-check", "SKILL.md"),
    "utf-8",
  );

  test("probe row exists, numbered, named plan_ship_coherence", () => {
    expect(gateCheckSkill).toMatch(/^\d+\.\s+\*\*`plan_ship_coherence`\*\*/m);
  });

  test("probe row names the module entry point + severity error", () => {
    const idx = gateCheckSkill.indexOf("`plan_ship_coherence`");
    expect(idx).toBeGreaterThan(-1);
    const block = gateCheckSkill.slice(idx, idx + 2500);
    expect(block).toContain("runPlanShipCoherenceProbe(projectRoot)");
    expect(block).toContain("adapters/_shared/src/plan_ship_coherence.ts");
    expect(block).toMatch(/\*\*Severity: error\.\*\*/);
  });

  test("probe row documents the parked NOTES row + the test-coverage file", () => {
    const idx = gateCheckSkill.indexOf("`plan_ship_coherence`");
    expect(idx).toBeGreaterThan(-1);
    const block = gateCheckSkill.slice(idx, idx + 2500);
    expect(block).toContain("parked milestones");
    expect(block).toContain("tests/gate-check-plan-ship-coherence.test.ts");
  });
});

// ---------------------------------------------------------------------------
// Dogfood — the live repo passes (STE-368 backfill stamped all 95 plans)
// ---------------------------------------------------------------------------

describe("dogfood — real specs/plan/archive/ tree is coherent", () => {
  test("every stamped archive plan resolves to a CHANGELOG heading; no unshipped debt", async () => {
    const report = await runPlanShipCoherenceProbe(repoRoot);
    expect(report.violations).toEqual([]);
  });
});
