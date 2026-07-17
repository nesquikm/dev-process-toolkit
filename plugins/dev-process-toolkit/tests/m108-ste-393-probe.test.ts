// M108 STE-393 — /gate-check probe `migration_coverage` (probe #68).
//
// AC map:
//   AC-STE-393.3 — for every archived plan whose `shipped_in` is >= the epoch:
//                  the `migration:` key must be present, and a declared entry id
//                  must exist in the registry with introduced_in == the plan's
//                  shipped_in. Violations are ERROR (NFR-10 shape). Pre-epoch
//                  archived plans are exempt → a NOTES count. Active plans
//                  missing the key → advisory WARNING only (consumer-safe).
//   AC-STE-393.4 — `migration: null` / `migration:` (empty) are absent in the
//                  probe too (M103 sentinel lesson).
//   AC-STE-393.5 — the probe is pure file reads + a registry module load: no
//                  git, no network, no LLM judgment.
//
// Report contract pinned here:
//   runMigrationCoverageProbe(projectRoot, registry?)
//     => Promise<{
//          violations: { file; line; note; message }[];  // ERROR
//          warnings:   { file; line; note; message }[];   // advisory
//          notes:      string[];                          // exempt count
//        }>
//
// The `registry` parameter defaults to the live MIGRATIONS list; tests inject a
// synthetic post-epoch registry because every live entry predates the epoch by
// construction (retro-seeded + unclaimed per the FR's Notes). That injection is
// also the mutation-check lever: neutering the lookup turns valid-id RED.
//
// Scope discipline mirrors probe #63 `plan_ship_coherence`: archive-scoped hard
// checks, active-scoped advisories only. Fixtures are in-memory mkdtempSync.

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMigrationCoverageProbe } from "../adapters/_shared/src/migrations/coverage";
import type { MigrationEntry } from "../adapters/_shared/src/migrations/index";

const repoRoot = join(import.meta.dir, "..", "..", "..");

// The epoch this FR ships in — post-epoch fixtures stamp AT it, pre-epoch fixtures below it.
const EPOCH = "2.49.0";
const PRE_EPOCH = "2.46.0";

const fixtureEntry = (id: string, introducedIn: string): MigrationEntry => ({
  id,
  introduced_in: introducedIn,
  title: `${id} (fixture)`,
  kind: "script",
  detect: () => ({ applies: false, evidence: [] }),
  apply: () => ({ changed: [], summary: "" }),
});

/** A registry carrying the exact entry the post-epoch valid-id fixture declares. */
const REGISTRY: MigrationEntry[] = [
  fixtureEntry("alpha-relayout", EPOCH), // introduced AT the epoch
  fixtureEntry("beta-relayout", "2.50.0"), // a later release
];

const tmpRoots: string[] = [];

afterEach(() => {
  while (tmpRoots.length > 0) {
    const dir = tmpRoots.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

interface PlanFields {
  shipped_in?: string; // v-prefixed, e.g. "v2.49.0"; omit for an active plan
  migration?: string | null; // omit ⇒ no key; null ⇒ literal `migration: null`
}

function makeFixture(): { root: string; addArchived: (m: string, f: PlanFields) => void; addActive: (m: string, f: PlanFields) => void } {
  const root = mkdtempSync(join(tmpdir(), "ste-393-probe-"));
  tmpRoots.push(root);
  const archiveDir = join(root, "specs", "plan", "archive");
  const planDir = join(root, "specs", "plan");
  mkdirSync(archiveDir, { recursive: true });

  const body = (m: string, f: PlanFields): string => {
    const lines = ["---", `milestone: ${m}`, "status: active", "archived_at: null"];
    if (f.shipped_in !== undefined) lines.push(`shipped_in: ${f.shipped_in}`);
    if ("migration" in f) lines.push(`migration: ${f.migration === null ? "null" : f.migration}`);
    lines.push("---", "", `# ${m}`, "");
    return lines.join("\n");
  };

  return {
    root,
    addArchived: (m, f) => writeFileSync(join(archiveDir, `${m}.md`), body(m, f), "utf-8"),
    addActive: (m, f) => writeFileSync(join(planDir, `${m}.md`), body(m, f), "utf-8"),
  };
}

/** Every ERROR/advisory message is verdict / `Remedy:` / `Context:`. */
function expectNfr10(message: string): void {
  const lines = message.split("\n");
  expect(lines[0]!.length).toBeGreaterThan(0);
  expect(lines.some((l) => l.startsWith("Remedy: "))).toBe(true);
  expect(lines.some((l) => l.startsWith("Context: "))).toBe(true);
}

// ---------------------------------------------------------------------------
// AC-STE-393.3 — post-epoch archived: the pass cases
// ---------------------------------------------------------------------------

describe("AC-STE-393.3 — post-epoch archived `migration: none` ⇒ pass", () => {
  test("no violation when a post-epoch plan declares none", async () => {
    const fx = makeFixture();
    fx.addArchived("M200", { shipped_in: "v2.49.0", migration: "none" });
    const r = await runMigrationCoverageProbe(fx.root, REGISTRY);
    expect(r.violations).toEqual([]);
  });
});

describe("AC-STE-393.3 — post-epoch archived valid id + matching version ⇒ pass", () => {
  test("no violation when the declared id is in the registry at introduced_in == shipped_in", async () => {
    const fx = makeFixture();
    fx.addArchived("M200", { shipped_in: "v2.49.0", migration: "alpha-relayout" });
    const r = await runMigrationCoverageProbe(fx.root, REGISTRY);
    expect(r.violations).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-393.3 — post-epoch archived: the three FAIL classes
// ---------------------------------------------------------------------------

describe("AC-STE-393.3 — post-epoch archived unknown id ⇒ FAIL", () => {
  test("an id absent from the registry is an ERROR naming the plan and the value", async () => {
    const fx = makeFixture();
    fx.addArchived("M200", { shipped_in: "v2.49.0", migration: "ghost-relayout" });
    const r = await runMigrationCoverageProbe(fx.root, REGISTRY);
    expect(r.violations.length).toBe(1);
    const v = r.violations[0]!;
    expect(v.note).toContain("specs/plan/archive/M200.md");
    expect(v.message).toContain("ghost-relayout");
    expectNfr10(v.message);
  });
});

describe("AC-STE-393.3 — post-epoch archived version-mismatch id ⇒ FAIL", () => {
  test("a registry id whose introduced_in != the plan's shipped_in is an ERROR", async () => {
    const fx = makeFixture();
    // beta-relayout is introduced_in 2.50.0; this plan shipped in 2.49.0.
    fx.addArchived("M200", { shipped_in: "v2.49.0", migration: "beta-relayout" });
    const r = await runMigrationCoverageProbe(fx.root, REGISTRY);
    expect(r.violations.length).toBe(1);
    const v = r.violations[0]!;
    expect(v.message).toContain("beta-relayout");
    expect(v.message).toContain("2.50.0"); // entry introduced_in
    expect(v.message).toContain("2.49.0"); // plan shipped_in
    expectNfr10(v.message);
  });
});

describe("AC-STE-393.3 — post-epoch archived missing key ⇒ FAIL", () => {
  test("a post-epoch archived plan with no `migration:` key is an ERROR", async () => {
    const fx = makeFixture();
    fx.addArchived("M200", { shipped_in: "v2.49.0" }); // no migration key at all
    const r = await runMigrationCoverageProbe(fx.root, REGISTRY);
    expect(r.violations.length).toBe(1);
    const v = r.violations[0]!;
    expect(v.note).toContain("specs/plan/archive/M200.md");
    expect(v.message).toMatch(/migration/i);
    expectNfr10(v.message);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-393.3 — pre-epoch archived ⇒ exempt, rendered as a NOTES count
// ---------------------------------------------------------------------------

describe("AC-STE-393.3 — pre-epoch archived ⇒ exempt + NOTES", () => {
  test("a pre-epoch plan missing the key is NOT a violation", async () => {
    const fx = makeFixture();
    fx.addArchived("M100", { shipped_in: `v${PRE_EPOCH}` }); // no migration key, pre-epoch
    const r = await runMigrationCoverageProbe(fx.root, REGISTRY);
    expect(r.violations).toEqual([]);
  });

  test("pre-epoch exempt plans surface as a NOTES count (never silent)", async () => {
    const fx = makeFixture();
    fx.addArchived("M100", { shipped_in: `v${PRE_EPOCH}` });
    fx.addArchived("M99", { shipped_in: "v2.40.0" });
    const r = await runMigrationCoverageProbe(fx.root, REGISTRY);
    expect(r.violations).toEqual([]);
    // A single NOTES row that counts the exempt plans.
    const noteLine = r.notes.join("\n");
    expect(noteLine).toMatch(/2/); // two pre-epoch plans counted
    expect(noteLine).toMatch(/exempt|pre-epoch|grandfather/i);
  });

  test("a pre-epoch plan carrying a bogus migration id is STILL exempt (not retro-classified)", async () => {
    const fx = makeFixture();
    fx.addArchived("M100", { shipped_in: `v${PRE_EPOCH}`, migration: "ghost-relayout" });
    const r = await runMigrationCoverageProbe(fx.root, REGISTRY);
    expect(r.violations).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-393.3 — active plan missing key ⇒ advisory WARNING only
// ---------------------------------------------------------------------------

describe("AC-STE-393.3 — active plan missing key ⇒ advisory warning, not error", () => {
  test("an active plan with no `migration:` key produces a warning, never a violation", async () => {
    const fx = makeFixture();
    fx.addActive("M300", {}); // active, no shipped_in, no migration key
    const r = await runMigrationCoverageProbe(fx.root, REGISTRY);
    expect(r.violations).toEqual([]);
    expect(r.warnings.length).toBe(1);
    const w = r.warnings[0]!;
    expect(w.note).toContain("specs/plan/M300.md");
    expect(w.note).not.toContain("archive");
    expectNfr10(w.message);
  });

  test("an active plan that DOES declare `migration: none` produces no warning", async () => {
    const fx = makeFixture();
    fx.addActive("M300", { migration: "none" });
    const r = await runMigrationCoverageProbe(fx.root, REGISTRY);
    expect(r.violations).toEqual([]);
    expect(r.warnings).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-393.4 — null / empty sentinel is absent in the probe too
// ---------------------------------------------------------------------------

describe("AC-STE-393.4 — `migration: null` / empty are absent in the probe", () => {
  test("post-epoch archived `migration: null` is a missing-key ERROR (not a valid `null` id)", async () => {
    const fx = makeFixture();
    fx.addArchived("M200", { shipped_in: "v2.49.0", migration: null });
    const r = await runMigrationCoverageProbe(fx.root, REGISTRY);
    expect(r.violations.length).toBe(1);
    // The offending value is treated as absent — not looked up as an id named "null".
    expect(r.violations[0]!.message).toMatch(/migration/i);
  });

  test("post-epoch archived `migration:` (empty) is a missing-key ERROR", async () => {
    const fx = makeFixture();
    fx.addArchived("M200", { shipped_in: "v2.49.0", migration: "" });
    const r = await runMigrationCoverageProbe(fx.root, REGISTRY);
    expect(r.violations.length).toBe(1);
  });

  test("active `migration: null` still counts as missing ⇒ advisory warning, not violation", async () => {
    const fx = makeFixture();
    fx.addActive("M300", { migration: null });
    const r = await runMigrationCoverageProbe(fx.root, REGISTRY);
    expect(r.violations).toEqual([]);
    expect(r.warnings.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Mutation check — neutering the registry lookup turns valid-id RED
// ---------------------------------------------------------------------------

describe("AC-STE-393.3 — mutation check: registry lookup is load-bearing", () => {
  test("the SAME valid-id fixture that passes against REGISTRY FAILS against an empty registry", async () => {
    const fx = makeFixture();
    fx.addArchived("M200", { shipped_in: "v2.49.0", migration: "alpha-relayout" });
    // Passes with the entry present …
    expect((await runMigrationCoverageProbe(fx.root, REGISTRY)).violations).toEqual([]);
    // … and turns red the moment the registry can't vouch for the id.
    const neutered = await runMigrationCoverageProbe(fx.root, []);
    expect(neutered.violations.length).toBe(1);
    expect(neutered.violations[0]!.message).toContain("alpha-relayout");
  });
});

// ---------------------------------------------------------------------------
// AC-STE-393.5 — purity: repeatable, side-effect-free, network-free
// ---------------------------------------------------------------------------

describe("AC-STE-393.5 — probe purity", () => {
  test("two runs over the same tree return identical verdicts (deterministic, no writes)", async () => {
    const fx = makeFixture();
    fx.addArchived("M200", { shipped_in: "v2.49.0", migration: "ghost-relayout" });
    fx.addArchived("M100", { shipped_in: `v${PRE_EPOCH}` });
    fx.addActive("M300", {});
    const a = await runMigrationCoverageProbe(fx.root, REGISTRY);
    const b = await runMigrationCoverageProbe(fx.root, REGISTRY);
    expect(b.violations.map((v) => v.note)).toEqual(a.violations.map((v) => v.note));
    expect(b.warnings.map((w) => w.note)).toEqual(a.warnings.map((w) => w.note));
    expect(b.notes).toEqual(a.notes);
  });

  test("vacuous when specs/plan is absent — a bare root yields empty verdicts", async () => {
    const root = mkdtempSync(join(tmpdir(), "ste-393-empty-"));
    tmpRoots.push(root);
    const r = await runMigrationCoverageProbe(root, REGISTRY);
    expect(r.violations).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.notes).toEqual([]);
  });

  test("registry defaults to the live MIGRATIONS list when omitted (module load, not injection)", async () => {
    const fx = makeFixture();
    // A post-epoch plan declaring `none` passes regardless of registry contents,
    // proving the default-registry call path is wired and does not throw.
    fx.addArchived("M200", { shipped_in: "v2.49.0", migration: "none" });
    const r = await runMigrationCoverageProbe(fx.root);
    expect(r.violations).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-393.3/.7 dogfood — the probe runs clean on the REAL toolkit tree.
//
// Probe #68 patterns itself on #63 (plan_ship_coherence), and #63 dogfoods its
// own repo (gate-check-plan-ship-coherence.test.ts). Fixture-only coverage would
// leave a real post-epoch archived plan with a bad `migration:` declaration
// invisible to `bun test` until a live /gate-check. This closes that asymmetry.
//
// Scope: ERROR violations only, mirroring #63's corrupt-stamp-only dogfood. A
// flat zero-everything assert would red the gate on a legitimate transient —
// an active plan still missing the key is an advisory WARNING, not an error, so
// asserting on `warnings` would deadlock a mid-rebase commit. The epoch is
// 2.49.0 and nothing has shipped there yet, so today this is genuinely empty;
// the moment M108 archives its plan at 2.49.0 it starts guarding real history.
// ---------------------------------------------------------------------------

describe("dogfood — the real specs/plan/archive tree declares migration coverage", () => {
  test("no post-epoch archived plan carries an ERROR-level coverage violation", async () => {
    const report = await runMigrationCoverageProbe(repoRoot);
    expect(report.violations).toEqual([]);
  });
});
