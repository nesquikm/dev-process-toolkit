// STE-462 AC-STE-462.{1,2,3,4,5,6,8,9} — /gate-check probe #75
// `active_plan_ship_ready`. Severity: warning (NotesOnly — the probe NEVER
// fails the gate).
//
// Pins the contract of the pure probe
// `adapters/_shared/src/active_plan_ship_ready.ts`:
//
//   shipReadyMilestones(projectRoot: string)
//     => Promise<string[]>            // bare milestone tokens, sorted via
//                                     // compareMilestoneTokens
//   runActivePlanShipReadyProbe(projectRoot: string)
//     => Promise<{ violations: unknown[]; notes: string[] }>
//                                     // violations is ALWAYS [] (warning-only)
//
// Classification per active `specs/plan/<M-token>.md` (numeric `M<N>` and
// epic-keyed `M_<epic-key>` filenames alike):
//   ship-ready ⇔ zero ACTIVE FRs (`specs/frs/*.md`) carry its milestone token
//   in frontmatter AND ≥ 1 ARCHIVED FR (`specs/frs/archive/*.md`) does.
//   - `ship_state: parked` on the active plan → excluded from the ship-ready
//     row, surfaced via the parked-note idiom of `plan_ship_coherence.ts`
//     (`parked milestones: <list>`), and excluded from shipReadyMilestones —
//     both consumers (/gate-check + /implement) share ONE predicate.
//   - `shipped_in: null` template sentinel → unshipped, still eligible.
//   - real `shipped_in: v<X.Y.Z>` stamp → never nudged.
//   - zero bound FRs (fresh / plan-only) → never flagged.
//   - `specs/plan/` absent or empty → vacuous.
//
// Fixtures are on-disk tmpdir trees via mkdtempSync per the probe convention
// (`tests/gate-check-plan-ship-coherence.test.ts`). Frontmatter reads must be
// CRLF/BOM-tolerant (one CRLF fixture below). Filter by AC with
// `bun test -t "AC-STE-462.N"`.

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  runActivePlanShipReadyProbe,
  shipReadyMilestones,
} from "../adapters/_shared/src/active_plan_ship_ready";
import { compareMilestoneTokens } from "../adapters/_shared/src/milestone_token";

const pluginRoot = join(import.meta.dir, "..");
const repoRoot = join(pluginRoot, "..", "..");

// Canonical prose literals — single-sourced here so every pin below and the
// implementer's prose converge on one byte sequence.
const NOTE_SUFFIX = " — run /spec-archive M<N> then /ship-milestone M<N>";
const OFFER_PROMPT = "Milestone M<N> is ship-ready — run the close ceremony now? [y/N]";
const DECLINE_LINE = "Run: /spec-archive M<N> then /ship-milestone M<N>";
const SKILL_LINE_CAP = 358; // NFR-1, mirrors tests/skill-nfr-1-length.test.ts

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

interface Fixture {
  root: string;
  planDir: string;
  frsDir: string;
  frArchiveDir: string;
  cleanup: () => void;
}

function makeFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "active-plan-ship-ready-"));
  const planDir = join(root, "specs", "plan");
  const frsDir = join(root, "specs", "frs");
  const frArchiveDir = join(frsDir, "archive");
  mkdirSync(planDir, { recursive: true });
  mkdirSync(frArchiveDir, { recursive: true });
  return {
    root,
    planDir,
    frsDir,
    frArchiveDir,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

/** Active-plan file mirroring the live template (shipped_in: null sentinel). */
function writePlan(
  dir: string,
  token: string,
  fields: { ship_state?: string; shipped_in?: string } = {},
): void {
  const lines = [
    "---",
    `milestone: ${token}`,
    "status: active",
    "archived_at: null",
    `shipped_in: ${fields.shipped_in ?? "null"}`,
  ];
  if (fields.ship_state !== undefined) lines.push(`ship_state: ${fields.ship_state}`);
  lines.push("---", "", "# Implementation Plan", "", `## ${token} — fixture {#${token}}`, "");
  writeFileSync(join(dir, `${token}.md`), lines.join("\n"));
}

/** FR file bound to a milestone via frontmatter `milestone:`. */
function writeFr(dir: string, name: string, milestone: string, status: "active" | "archived"): void {
  const lines = [
    "---",
    `title: "fixture FR ${name}"`,
    `milestone: ${milestone}`,
    `status: ${status}`,
    `archived_at: ${status === "archived" ? "2026-08-01T00:00:00Z" : "null"}`,
    "---",
    "",
    `# fixture FR ${name}`,
    "",
  ];
  writeFileSync(join(dir, name), lines.join("\n"));
}

// ---------------------------------------------------------------------------
// AC-STE-462.1 — predicate classification + AC-STE-462.9 required cases
// ---------------------------------------------------------------------------

describe("AC-STE-462.1 — shipReadyMilestones classifies active plans", () => {
  test("ship-ready hit: active plan, zero active FRs, one archived FR bound → flagged", async () => {
    const fx = makeFixture();
    try {
      writePlan(fx.planDir, "M7");
      writeFr(fx.frArchiveDir, "fr-a.md", "M7", "archived");
      await expect(shipReadyMilestones(fx.root)).resolves.toEqual(["M7"]);
    } finally {
      fx.cleanup();
    }
  });

  test("active FR still present → NOT flagged (AC-STE-462.9 mutation guard: zero-active clause)", async () => {
    const fx = makeFixture();
    try {
      writePlan(fx.planDir, "M7");
      writeFr(fx.frsDir, "fr-live.md", "M7", "active");
      writeFr(fx.frArchiveDir, "fr-done.md", "M7", "archived");
      await expect(shipReadyMilestones(fx.root)).resolves.toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("M_<epic-key> plan filename is walked, not silently skipped", async () => {
    const fx = makeFixture();
    try {
      writePlan(fx.planDir, "M_PROJ_500");
      writeFr(fx.frArchiveDir, "fr-epic.md", "M_PROJ_500", "archived");
      await expect(shipReadyMilestones(fx.root)).resolves.toEqual(["M_PROJ_500"]);
    } finally {
      fx.cleanup();
    }
  });

  test("frontmatter reads are CRLF/BOM-tolerant — a CRLF+BOM plan and FR still classify ship-ready", async () => {
    const fx = makeFixture();
    try {
      const planBody =
        "\uFEFF" +
        ["---", "milestone: M7", "status: active", "archived_at: null", "shipped_in: null", "---", "", "# plan", ""].join(
          "\r\n",
        );
      writeFileSync(join(fx.planDir, "M7.md"), planBody);
      const frBody =
        "\uFEFF" +
        ["---", "milestone: M7", "status: archived", "archived_at: 2026-08-01T00:00:00Z", "---", "", "# fr", ""].join(
          "\r\n",
        );
      writeFileSync(join(fx.frArchiveDir, "fr-crlf.md"), frBody);
      await expect(shipReadyMilestones(fx.root)).resolves.toEqual(["M7"]);
    } finally {
      fx.cleanup();
    }
  });

  test("an archived FR bound to a DIFFERENT milestone does not make a plan ship-ready", async () => {
    const fx = makeFixture();
    try {
      writePlan(fx.planDir, "M7");
      writeFr(fx.frArchiveDir, "fr-other.md", "M8", "archived");
      await expect(shipReadyMilestones(fx.root)).resolves.toEqual([]);
    } finally {
      fx.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// AC-STE-462.2 — warning-only probe: notes row, never violations
// ---------------------------------------------------------------------------

describe("AC-STE-462.2 — probe renders one NOTES row and never returns violations", () => {
  test("report shape is { violations, notes } with violations ALWAYS empty — even on a hit", async () => {
    const fx = makeFixture();
    try {
      writePlan(fx.planDir, "M7");
      writeFr(fx.frArchiveDir, "fr-a.md", "M7", "archived");
      const report = await runActivePlanShipReadyProbe(fx.root);
      expect(Array.isArray(report.violations)).toBe(true);
      expect(Array.isArray(report.notes)).toBe(true);
      expect(report.violations).toEqual([]);
      expect(report.notes).toEqual([`ship-ready milestones: M7${NOTE_SUFFIX}`]);
    } finally {
      fx.cleanup();
    }
  });

  test("multi-hit renders exactly ONE row, comma-separated, sorted via compareMilestoneTokens", async () => {
    const fx = makeFixture();
    try {
      // Lexicographic order would render "M10, M9, M_PROJ_500"-adjacent shapes
      // wrong: compareMilestoneTokens is numeric-first ascending, epics after.
      for (const token of ["M10", "M9", "M_PROJ_500"]) {
        writePlan(fx.planDir, token);
        writeFr(fx.frArchiveDir, `fr-${token}.md`, token, "archived");
      }
      const expected = ["M10", "M9", "M_PROJ_500"].sort(compareMilestoneTokens);
      expect(expected).toEqual(["M9", "M10", "M_PROJ_500"]);
      await expect(shipReadyMilestones(fx.root)).resolves.toEqual(expected);
      const report = await runActivePlanShipReadyProbe(fx.root);
      expect(report.violations).toEqual([]);
      expect(report.notes).toEqual([
        `ship-ready milestones: M9, M10, M_PROJ_500${NOTE_SUFFIX}`,
      ]);
    } finally {
      fx.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// AC-STE-462.3 — parked exclusion + shipped_in sentinel/stamp semantics
// ---------------------------------------------------------------------------

describe("AC-STE-462.3 — parked plans are excluded but visible; shipped_in semantics", () => {
  test("ship_state: parked → excluded from ship-ready, surfaced via the parked-note idiom", async () => {
    const fx = makeFixture();
    try {
      writePlan(fx.planDir, "M7");
      writeFr(fx.frArchiveDir, "fr-a.md", "M7", "archived");
      writePlan(fx.planDir, "M8", { ship_state: "parked" });
      writeFr(fx.frArchiveDir, "fr-b.md", "M8", "archived");
      // Predicate-level exclusion: /implement consumes the same function, so a
      // parked milestone must never receive the close offer either.
      await expect(shipReadyMilestones(fx.root)).resolves.toEqual(["M7"]);
      const report = await runActivePlanShipReadyProbe(fx.root);
      expect(report.violations).toEqual([]);
      expect(report.notes).toContain(`ship-ready milestones: M7${NOTE_SUFFIX}`);
      // Mirrors plan_ship_coherence's `parked milestones: <list>` row.
      expect(report.notes).toContain("parked milestones: M8");
      const shipReadyRow = report.notes.find((n) => n.startsWith("ship-ready milestones:"))!;
      expect(shipReadyRow).not.toContain("M8");
    } finally {
      fx.cleanup();
    }
  });

  test("template sentinel shipped_in: null reads as unshipped — still ship-ready-eligible, never a violation", async () => {
    const fx = makeFixture();
    try {
      writePlan(fx.planDir, "M7", { shipped_in: "null" });
      writeFr(fx.frArchiveDir, "fr-a.md", "M7", "archived");
      await expect(shipReadyMilestones(fx.root)).resolves.toEqual(["M7"]);
      const report = await runActivePlanShipReadyProbe(fx.root);
      expect(report.violations).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("a real shipped_in: v<X.Y.Z> stamp on an active plan is NOT nudged", async () => {
    const fx = makeFixture();
    try {
      writePlan(fx.planDir, "M7", { shipped_in: "v2.61.0" });
      writeFr(fx.frArchiveDir, "fr-a.md", "M7", "archived");
      await expect(shipReadyMilestones(fx.root)).resolves.toEqual([]);
      const report = await runActivePlanShipReadyProbe(fx.root);
      expect(report.violations).toEqual([]);
      expect(report.notes).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// AC-STE-462.4 — zero-bound-FR exemption + vacuous cases
// ---------------------------------------------------------------------------

describe("AC-STE-462.4 — zero-FR plans and absent/empty plan dirs are never flagged", () => {
  test("plan with zero bound FRs (fresh / plan-only) → never flagged (mutation guard: ≥1-archived clause)", async () => {
    const fx = makeFixture();
    try {
      writePlan(fx.planDir, "M9");
      await expect(shipReadyMilestones(fx.root)).resolves.toEqual([]);
      const report = await runActivePlanShipReadyProbe(fx.root);
      expect(report.violations).toEqual([]);
      expect(report.notes).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("vacuous when specs/plan/ is absent", async () => {
    const root = mkdtempSync(join(tmpdir(), "active-plan-ship-ready-noplan-"));
    try {
      mkdirSync(join(root, "specs", "frs", "archive"), { recursive: true });
      writeFr(join(root, "specs", "frs", "archive"), "fr-a.md", "M7", "archived");
      await expect(shipReadyMilestones(root)).resolves.toEqual([]);
      const report = await runActivePlanShipReadyProbe(root);
      expect(report.violations).toEqual([]);
      expect(report.notes).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("vacuous when specs/plan/ is empty", async () => {
    const fx = makeFixture();
    try {
      const report = await runActivePlanShipReadyProbe(fx.root);
      expect(report.violations).toEqual([]);
      expect(report.notes).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("HARDENING — frontmatter-less legacy plan classifies by FR binding; FR missing milestone: key is ignored", async () => {
    const fx = makeFixture();
    try {
      // Legacy /setup plan (pre-frontmatter era): binding is by plan FILENAME
      // vs FR frontmatter token, so the plan body never matters — no crash,
      // no silent skip, and absent shipped_in reads as unshipped-eligible.
      writeFileSync(join(fx.planDir, "M6.md"), "# Implementation Plan\n\n## M6 — legacy {#M6}\n");
      writeFr(fx.frArchiveDir, "fr-legacy.md", "M6", "archived");
      // An FR with no milestone: key binds nothing and must not throw.
      writeFileSync(join(fx.frsDir, "stray.md"), "---\ntitle: stray\nstatus: active\n---\n\n# stray\n");
      await expect(shipReadyMilestones(fx.root)).resolves.toEqual(["M6"]);
    } finally {
      fx.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// AC-STE-462.5 — gate-check SKILL registration row #75 (meta-test)
// ---------------------------------------------------------------------------

describe("AC-STE-462.5 — gate-check SKILL.md registers probe #75 active_plan_ship_ready", () => {
  const gateCheckSkill = (): string =>
    readFileSync(join(pluginRoot, "skills", "gate-check", "SKILL.md"), "utf-8");

  test("row #75 exists, numbered, named active_plan_ship_ready", () => {
    expect(gateCheckSkill()).toMatch(/^75\.\s+\*\*`active_plan_ship_ready`\*\*/m);
  });

  test("row names the runner, the module path, warning/NotesOnly severity, and the test file", () => {
    const body = gateCheckSkill();
    const idx = body.indexOf("`active_plan_ship_ready`");
    expect(idx).toBeGreaterThan(-1);
    const block = body.slice(idx, idx + 2500);
    expect(block).toContain("runActivePlanShipReadyProbe(projectRoot)");
    expect(block).toContain("adapters/_shared/src/active_plan_ship_ready.ts");
    expect(block).toContain("**Severity: warning** (NotesOnly, never **GATE FAILED**)");
    expect(block).toContain("tests/gate-check-active-plan-ship-ready.test.ts");
  });

  test("the numbered probe list is contiguous 1..77", () => {
    // Recalibrated 76 → 77: M126 added #77 first_turn_refusal_marker.
    const numbers = [...gateCheckSkill().matchAll(/^(\d+)\. \*\*/gm)].map((m) => Number(m[1]));
    expect(numbers.length).toBe(77);
    expect([...numbers].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 77 }, (_, i) => i + 1),
    );
  });

  test("retirement tripwire: no stale `74 numbered` / `layers 74 probes` token survives in README", () => {
    // Per the mNNN-docs-pins precedent, the release that retires a count token
    // owns its tripwire: M122 (probe #75) retires the M118-era 74.
    const readme = readFileSync(join(repoRoot, "README.md"), "utf-8");
    expect(readme).not.toMatch(/\b74\b\s+numbered/);
    expect(readme).not.toMatch(/layers 74 probes/);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-462.6 / AC-STE-462.7 / AC-STE-462.8 — /implement offer prose (meta-test)
// ---------------------------------------------------------------------------

describe("AC-STE-462.8 — implement SKILL.md pins the ship-ready close offer", () => {
  const implementSkill = (): string =>
    readFileSync(join(pluginRoot, "skills", "implement", "SKILL.md"), "utf-8");

  test("the exact offer prompt and the exact decline line are present", () => {
    const body = implementSkill();
    expect(body).toContain(OFFER_PROMPT);
    expect(body).toContain(DECLINE_LINE);
  });

  test("AC-STE-462.6 — the offer sits after Phase 4 Close and runs the shared predicate via bun", () => {
    const body = implementSkill();
    const closeIdx = body.indexOf("### Phase 4 Close");
    const offerIdx = body.indexOf(OFFER_PROMPT);
    expect(closeIdx).toBeGreaterThan(-1);
    expect(offerIdx).toBeGreaterThan(closeIdx);
    // Vicinity window: the offer block plus surrounding prose.
    const block = body.slice(Math.max(0, offerIdx - 1000), offerIdx + 2000);
    // Predicate is RUN (bun), not re-derived in prose, and it is the shared
    // module — the single-predicate reuse that keeps both surfaces from
    // drifting. The FULL command literal is byte-pinned: a `toContain("bun")`
    // word-pin let a non-executable repo-root-relative `bun -e` form ship
    // (caught by the FR audit executing it verbatim) — the plugin-rooted CLI
    // form is the only spelling that runs from a consumer project.
    expect(block).toContain(
      "`bun run ${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/active_plan_ship_ready.ts <projectRoot>`",
    );
    expect(block).toContain("shipReadyMilestones");
  });

  test("AC-STE-462.6 — the pinned CLI actually executes: prints ship-ready milestones, one per line", () => {
    const fx = makeFixture();
    try {
      writePlan(fx.planDir, "M7");
      writeFr(fx.frArchiveDir, "one.md", "M7", "archived");
      writePlan(fx.planDir, "M9");
      writeFr(fx.frArchiveDir, "two.md", "M9", "archived");
      const proc = spawnSync(
        "bun",
        ["run", join(pluginRoot, "adapters", "_shared", "src", "active_plan_ship_ready.ts"), fx.root],
        { encoding: "utf-8" },
      );
      expect(proc.status).toBe(0);
      expect(proc.stdout.trim().split("\n")).toEqual(["M7", "M9"]);
    } finally {
      fx.cleanup();
    }
  });

  test("AC-STE-462.7 — the offer is FR-form-only: milestone-scope runs silently skip (no double-offer)", () => {
    const body = implementSkill();
    const offerIdx = body.indexOf(OFFER_PROMPT);
    expect(offerIdx).toBeGreaterThan(-1);
    const block = body.slice(Math.max(0, offerIdx - 1000), offerIdx + 2000);
    expect(block).toMatch(/FR-form/);
    expect(block).toMatch(/M-form|milestone-scope/);
    expect(block).toMatch(/skip/i);
    expect(block).toMatch(/double|duplicate/i);
  });

  test("NEGATIVE — the offer block carries no hard-refusal wording (decline is an offer, not a refusal)", () => {
    const body = implementSkill();
    const offerIdx = body.indexOf(OFFER_PROMPT);
    expect(offerIdx).toBeGreaterThan(-1);
    // Tight window on purpose: the offer prompt + its y / decline handling.
    // Neighboring Phase 4 steps legitimately use refusal language; the offer
    // itself must not.
    const block = body.slice(offerIdx, offerIdx + 700);
    expect(block).not.toMatch(/hard-refuse|refusal|refuse/i);
  });

  test("NFR-1 — both edited SKILL files stay at or under the 358-line cap", () => {
    const implementLines = implementSkill().split("\n").length;
    const gateCheckLines = readFileSync(
      join(pluginRoot, "skills", "gate-check", "SKILL.md"),
      "utf-8",
    ).split("\n").length;
    expect(implementLines).toBeLessThanOrEqual(SKILL_LINE_CAP);
    expect(gateCheckLines).toBeLessThanOrEqual(SKILL_LINE_CAP);
  });
});

// ---------------------------------------------------------------------------
// Dogfood — the live repo never produces violations (warning-only by contract)
// ---------------------------------------------------------------------------

describe("dogfood — real repo run is warning-only", () => {
  test("violations are empty on the live tree and every note uses a known row idiom", async () => {
    const report = await runActivePlanShipReadyProbe(repoRoot);
    expect(report.violations).toEqual([]);
    for (const note of report.notes) {
      expect(note).toMatch(/^(ship-ready|parked) milestones: /);
    }
  });
});
