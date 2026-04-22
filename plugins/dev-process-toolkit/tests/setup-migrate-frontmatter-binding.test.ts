import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// FR-58 conformance — /setup --migrate must record tracker bindings in the
// right place for the detected layout. On v2, that means writing to each
// FR's frontmatter `tracker:` map via the shared setTrackerBinding writer
// (not the traceability matrix, which v2 slimmed away); on v1, it means
// the traceability matrix as today.
//
// These tests lock the procedure-doc wording at the markers that tell the
// LLM which writer to use, plus the partial-failure rollback prompt
// required when the frontmatter write fails after a successful push.

const pluginRoot = join(import.meta.dir, "..");
const migrateDocPath = join(pluginRoot, "docs", "setup-migrate.md");

function readMigrateDoc(): string {
  return readFileSync(migrateDocPath, "utf8");
}

describe("FR-58 — migration writes tracker bindings to FR frontmatter", () => {
  test("AC-58.1/58.4 — v2 branch names the setTrackerBinding helper (canonical writer)", () => {
    const body = readMigrateDoc();
    const section = body.match(/## `none → <tracker>` procedure[\s\S]*?(?=^## )/m);
    expect(section).not.toBeNull();
    // Writer name must be spelled out so the LLM reaches for the shared
    // helper instead of rendering ad-hoc YAML.
    expect(section![0]).toContain("setTrackerBinding");
    // Explicit path so the import target is obvious.
    expect(section![0]).toContain("adapters/_shared/src/frontmatter.ts");
    // Must name the canonical multi-line form and forbid the inline-{}
    // shortcut (AC-58.4).
    expect(section![0]).toMatch(/tracker:\\n\s*<key>: <id>|tracker:\n  <key>: <id>/);
  });

  test("AC-58.2 — alphabetical preservation rule is stated in the v2 branch", () => {
    const body = readMigrateDoc();
    const section = body.match(/## `none → <tracker>` procedure[\s\S]*?(?=^## )/m)![0];
    // The rule must be present explicitly — it's the difference between a
    // merging bind and an overwriting bind on the multi-tracker path.
    expect(section).toMatch(/preserv.*alphabetical/i);
    // AC-42.5 cross-reference keeps the pointer stable when readers chase
    // the alphabetical-ordering invariant.
    expect(section).toContain("AC-42.5");
  });

  test("AC-58.3 — v1 branch keeps the traceability-matrix write as today", () => {
    const body = readMigrateDoc();
    const section = body.match(/## `none → <tracker>` procedure[\s\S]*?(?=^## )/m)![0];
    // Must explicitly name the v1 backward-compat path so a reader doesn't
    // drop it when maintaining the doc.
    expect(section).toMatch(/v1 layout/);
    expect(section).toMatch(/traceability matrix/);
    expect(section).toMatch(/ticket=<id>/);
  });

  test("AC-58.5 — partial-failure NFR-10 prompt enumerates un-bound FRs and blocks mode-line write", () => {
    const body = readMigrateDoc();
    // The exact header phrase from AC-58.5 — locks the load-bearing
    // "K of N frontmatter writes succeeded" wording that tells the
    // operator how far the bulk got before the failure.
    expect(body).toMatch(/Migration failed mid-bind: K of N frontmatter writes succeeded/);
    // Un-bound FR enumeration is the key recovery surface.
    expect(body).toMatch(/Un-bound FRs/);
    // NFR-10 canonical shape requires Context + skill labels.
    const section = body.match(/Migration failed mid-bind[\s\S]{0,600}/)![0];
    expect(section).toMatch(/Remedy:/);
    expect(section).toMatch(/Context:/);
    expect(section).toMatch(/skill=setup --migrate/);
    // The atomicity guarantee — CLAUDE.md mode line must not be written
    // until bindings succeed — is stated verbatim so the LLM doesn't
    // "helpfully" proceed past the partial failure.
    expect(body).toMatch(/CLAUDE\.md `mode:` line is NOT written/);
  });
});
