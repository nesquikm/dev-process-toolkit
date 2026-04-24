import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runIdentityModeConditionalProbe } from "../adapters/_shared/src/identity_mode_conditional";

// STE-86 AC-STE-86.5/6/7 — bimodal identity probe integration test.
//
// Six fixtures under tests/fixtures/probe-identity/:
//   (a) mode-none-valid        — FR with valid id:, mode-none CLAUDE.md → pass
//   (b) tracker-mode-valid     — FR without id:, tracker CLAUDE.md     → pass
//   (c) mode-none-missing-id   — FR without id:, mode-none CLAUDE.md   → warn
//   (d) mode-none-wrong-id     — FR with malformed id:, mode-none      → warn
//   (e) tracker-mode-has-id    — FR with stale id:, tracker CLAUDE.md  → warn
//   (f) tracker-mode-malformed-id — FR with malformed id:, tracker     → warn
//
// Test-file naming follows the STE-82 convention: `gate-check-<slug>.test.ts`.

const pluginRoot = join(import.meta.dir, "..");
const fixtureRoot = join(pluginRoot, "tests", "fixtures", "probe-identity");

function fixturePath(name: string): string {
  return join(fixtureRoot, name);
}

describe("STE-86 AC-STE-86.5 — runIdentityModeConditionalProbe passes on valid fixtures", () => {
  test("(a) mode-none-valid: FR carries a valid short-ULID id", async () => {
    const report = await runIdentityModeConditionalProbe(fixturePath("mode-none-valid"));
    expect(report.mode).toBe("none");
    expect(report.violations).toEqual([]);
  });

  test("(b) tracker-mode-valid: FR carries no id line", async () => {
    const report = await runIdentityModeConditionalProbe(fixturePath("tracker-mode-valid"));
    expect(report.mode).toBe("linear");
    expect(report.violations).toEqual([]);
  });
});

describe("STE-86 AC-STE-86.5 — probe flags violations in NFR-10 canonical shape", () => {
  test("(c) mode-none-missing-id: warns expected present, actual missing", async () => {
    const report = await runIdentityModeConditionalProbe(fixturePath("mode-none-missing-id"));
    expect(report.mode).toBe("none");
    expect(report.violations.length).toBe(1);
    const v = report.violations[0]!;
    expect(v.file).toContain("XXXXXX.md");
    expect(v.expected).toBe("present");
    expect(v.actual).toBe("missing");
    expect(v.message).toMatch(/id:\s+line/i);
    expect(v.message).toMatch(/Remedy:/);
    expect(v.message).toMatch(/Context:/);
  });

  test("(d) mode-none-wrong-id: warns expected fr_<26-char ULID>, actual <value>", async () => {
    const report = await runIdentityModeConditionalProbe(fixturePath("mode-none-wrong-id"));
    expect(report.mode).toBe("none");
    expect(report.violations.length).toBe(1);
    const v = report.violations[0]!;
    expect(v.expected).toMatch(/fr_<26-char ULID>/);
    expect(v.actual).toBe("fr_BADFORMAT");
  });

  test("(e) tracker-mode-has-id: warns expected absent, actual <value>", async () => {
    const report = await runIdentityModeConditionalProbe(fixturePath("tracker-mode-has-id"));
    expect(report.mode).toBe("linear");
    expect(report.violations.length).toBe(1);
    const v = report.violations[0]!;
    expect(v.expected).toBe("absent");
    expect(v.actual).toBe("fr_01KPWPMA9TKSYYBNCQ3TAYM9BE");
  });

  test("(f) tracker-mode-malformed-id: warns expected absent, actual fr_SHORT", async () => {
    const report = await runIdentityModeConditionalProbe(
      fixturePath("tracker-mode-malformed-id"),
    );
    expect(report.mode).toBe("linear");
    expect(report.violations.length).toBe(1);
    const v = report.violations[0]!;
    expect(v.expected).toBe("absent");
    expect(v.actual).toBe("fr_SHORT");
  });
});

describe("STE-86 AC-STE-86.6 — probe source has TODO anchor + severity warning", () => {
  const probeSrc = readFileSync(
    join(pluginRoot, "adapters", "_shared", "src", "identity_mode_conditional.ts"),
    "utf-8",
  );

  test("probe source declares severity='warning' at M21 ship", () => {
    // AC-STE-86.6: severity is exported so gate-check and follow-up can grep.
    expect(probeSrc).toMatch(/severity[:\s]+"warning"/);
  });

  test("probe source carries grep anchor for the follow-up severity flip", () => {
    // AC-STE-86.6: the placeholder `<follow-up>` in STE-<follow-up> is
    // expected literal form until the successor FR is minted.
    expect(probeSrc).toMatch(/TODO\(STE-[<>A-Za-z0-9-]+\): flip severity to "error"/);
  });

  test("probe has zero runtime dep on ulid.ts (AC-STE-86.8)", () => {
    // Module import of ./ulid is forbidden; `import type` (erased) is fine.
    expect(probeSrc).not.toMatch(/^\s*import\s+\{[^}]*\}\s+from\s+["']\.\.\/ulid["']/m);
  });
});

describe("STE-86 AC-STE-86.7 — note shape matches `file:line — reason`", () => {
  test("violations render a canonical `file:line — reason` note", async () => {
    const report = await runIdentityModeConditionalProbe(fixturePath("tracker-mode-has-id"));
    expect(report.violations.length).toBe(1);
    const note = report.violations[0]!.note;
    expect(note).toMatch(/^specs\/frs\/.*\.md:\d+ — /);
  });
});

describe("STE-86 AC-STE-86.5/7 prose — /gate-check probe 13 is documented in SKILL.md", () => {
  const gateCheckSkill = readFileSync(
    join(pluginRoot, "skills", "gate-check", "SKILL.md"),
    "utf-8",
  );

  test("SKILL.md names the identity_mode_conditional probe + STE-86 AC reference", () => {
    expect(gateCheckSkill).toMatch(/identity_mode_conditional/);
    expect(gateCheckSkill).toMatch(/AC-STE-86\.5/);
  });

  test("SKILL.md declares warning-severity posture at M21 ship", () => {
    expect(gateCheckSkill).toMatch(/warning.*identity_mode_conditional|identity_mode_conditional.*warning/i);
  });
});

describe("STE-86 — mode-none regression fixtures pass the probe (AC-STE-76.8)", () => {
  // mode-none-v2-migration carries real mode-none FRs with valid id: lines;
  // a non-vacuous pass requires actual FR files to scan.
  const migrationPath = join(pluginRoot, "tests", "fixtures", "projects", "mode-none-v2-migration");

  test("mode-none-v2-migration has real FR files (fixture is non-empty)", () => {
    const frsDir = join(migrationPath, "specs", "frs");
    const files = readdirSync(frsDir).filter((f: string) => f.endsWith(".md"));
    expect(files.length).toBeGreaterThan(0);
    // Every FR must carry a well-formed id: line so the probe has something
    // to affirm, not silently skip.
    for (const f of files) {
      const content = readFileSync(join(frsDir, f), "utf-8");
      expect(content).toMatch(/^id: fr_[0-9A-HJKMNP-TV-Z]{26}$/m);
    }
  });

  test("probe passes silently on mode-none FRs with valid id: lines", async () => {
    const report = await runIdentityModeConditionalProbe(migrationPath);
    expect(report.mode).toBe("none");
    expect(report.violations).toEqual([]);
  });
});
