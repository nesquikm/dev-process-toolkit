import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseFrontmatter } from "../adapters/_shared/src/frontmatter";

// STE-36 conformance — /setup --migrate none→tracker must walk the correct
// FR list for the detected layout. On v2 layout, FRs live one-per-file
// under specs/frs/*.md (not in specs/requirements.md), so the procedure
// must branch on .dpt-layout version or find zero FRs and silently do
// nothing.
//
// These tests lock the procedure-doc wording at the markers that determine
// whether the LLM driving the migration branches correctly. Plus an
// existence test on the regression fixture that AC-STE-36.3 requires.

const pluginRoot = join(import.meta.dir, "..");
const migrateDocPath = join(pluginRoot, "docs", "setup-migrate.md");
const fixtureFrsDir = join(
  pluginRoot,
  "tests",
  "fixtures",
  "projects",
  "mode-none-v2-migration",
  "specs",
  "frs",
);

function readMigrateDoc(): string {
  return readFileSync(migrateDocPath, "utf8");
}

describe("STE-36 — none→tracker migration walks the correct layout", () => {
  test("AC-STE-36.1 — procedure branches on specs/.dpt-layout version", () => {
    const body = readMigrateDoc();
    const section = body.match(/## `none → <tracker>` procedure[\s\S]*?(?=^## )/m);
    expect(section).not.toBeNull();
    // Must cite the layout marker file by path (not just "v2") so the LLM
    // reads the version rather than assuming.
    expect(section![0]).toContain("specs/.dpt-layout");
    // Must name both layout branches explicitly.
    expect(section![0]).toMatch(/v2 layout/);
    expect(section![0]).toMatch(/v1 layout/);
  });

  test("AC-STE-36.2 — v2 iteration uses readdirSync + frontmatter parser, excludes archive/", () => {
    const body = readMigrateDoc();
    const section = body.match(/## `none → <tracker>` procedure[\s\S]*?(?=^## )/m);
    expect(section).not.toBeNull();
    // Marker: the exact readdir path + parser callout that the FR demands.
    expect(section![0]).toMatch(/readdirSync\(specsDir \+ '\/frs'\)/);
    expect(section![0]).toMatch(/parseFrontmatter/);
    // Must explicitly exclude archived FRs so shipped work isn't
    // re-pushed to tracker.
    expect(section![0]).toMatch(/specs\/frs\/archive/);
  });

  test("AC-STE-36.4 — emits the exact summary prompt before pushing", () => {
    const body = readMigrateDoc();
    // The wording is load-bearing — it's the user's last off-ramp before
    // the migration mutates the tracker. A drifted phrase means the LLM
    // may skip the confirm.
    expect(body).toContain(
      "Found N FRs in <layout> layout; will create N tracker tickets.",
    );
    // Must require explicit confirmation — not an implicit proceed.
    const section = body.match(/## `none → <tracker>` procedure[\s\S]*?(?=^## )/m)![0];
    expect(section).toMatch(/explicit user confirmation/i);
  });

  test("AC-STE-36.5 — refuses when all three spec signals are absent (NFR-10 canonical shape)", () => {
    const body = readMigrateDoc();
    // Exact refusal message from AC-STE-36.5.
    expect(body).toContain("No specs/ content found; nothing to migrate.");
    // Must be in NFR-10 canonical shape — includes Remedy + Context lines.
    const section = body.match(/No specs\/ content found[\s\S]{0,400}/)![0];
    expect(section).toMatch(/Remedy:/);
    expect(section).toMatch(/Context:/);
    expect(section).toMatch(/skill=setup --migrate/);
  });

  test("AC-STE-36.3 — regression fixture mode-none-v2-migration has ≥3 FR files", () => {
    const frFiles = readdirSync(fixtureFrsDir).filter(
      (f) => f.startsWith("fr_") && f.endsWith(".md"),
    );
    expect(frFiles.length).toBeGreaterThanOrEqual(3);

    // Every FR must have valid frontmatter with `status: active` so the
    // v2 iteration discovers them (AC-STE-36.2). Archived FRs would drop out
    // and regress the "≥3 discovered" invariant.
    const active = frFiles.filter((f) => {
      const text = readFileSync(join(fixtureFrsDir, f), "utf8");
      const fm = parseFrontmatter(text);
      return fm.status === "active";
    });
    expect(active.length).toBeGreaterThanOrEqual(3);
  });
});
