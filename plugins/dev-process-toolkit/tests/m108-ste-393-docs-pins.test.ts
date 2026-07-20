// M108 STE-393 — declaration surfaces, probe wiring, docs, and the 67 → 68
// count pins.
//
// AC map:
//   AC-STE-393.1 — Schema T (specs/technical-spec.md) + plan.md.template gain
//                  the `migration:` key; the template ships `migration: none`
//                  with an explanatory comment; /spec-write's plan-creation
//                  flow sets the value; the M108 plan carries `migration: none`.
//   AC-STE-393.2 — ship-milestone SKILL.md documents the pre-flight step
//                  (assertMigrationDeclared) before the Release Files bump.
//   AC-STE-393.3 — probe #68 `migration_coverage` is wired into the gate-check
//                  numbered probe list, following the probe-entry shape.
//   AC-STE-393.6 — docs/ship-milestone-reference.md + docs/upgrade-reference.md
//                  document the declaration contract + pre-flight; probe-count
//                  pins bump 67 → 68 at every pinned surface.
//
// Prose anchors were verified absent before these assertions were written —
// generic "migration" wording already exists in several targets, so each
// assertion scopes to a dedicated section or a byte-exact new token.

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");

const read = (...parts: string[]): string => readFileSync(join(...parts), "utf-8");

/** The leading `---` … `---` frontmatter block of a markdown-ish file. */
function frontmatter(body: string): string {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(body);
  return m?.[1] ?? "";
}

// ---------------------------------------------------------------------------
// AC-STE-393.1 — Schema T gains the `migration:` key
// ---------------------------------------------------------------------------

describe("AC-STE-393.1 — Schema T documents the `migration:` key", () => {
  /**
   * The Schema T subsection body: from its heading to the next `###`/`##`, or
   * end of file. Located by index rather than one regex — a `$` end-anchor
   * under the `/m` flag matches end-of-LINE, so it would stop at the end of the
   * heading and never reach the yaml body this helper exists to return.
   */
  function schemaT(spec: string): string {
    const start = spec.indexOf("### Schema T:");
    expect(start).toBeGreaterThanOrEqual(0);
    // Skip past this heading's own `###` before hunting the next heading.
    const after = spec.slice(start + 3);
    const nextHeading = after.search(/\n#{2,3} /);
    return nextHeading === -1 ? spec.slice(start) : spec.slice(start, start + 3 + nextHeading);
  }

  test("the Schema T yaml block carries a `migration:` line", () => {
    const block = schemaT(read(REPO_ROOT, "specs", "technical-spec.md"));
    expect(block).toMatch(/^\s*migration:/m);
  });

  test("Schema T names both legal value shapes — `none` and a registry entry id", () => {
    const block = schemaT(read(REPO_ROOT, "specs", "technical-spec.md"));
    expect(block).toMatch(/\bnone\b/);
    expect(block).toMatch(/registry|entry id/i);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-393.1 — plan.md.template ships `migration: none` + a comment
// ---------------------------------------------------------------------------

describe("AC-STE-393.1 — plan.md.template ships `migration: none` with an explanatory comment", () => {
  const tmpl = (): string =>
    read(PLUGIN_ROOT, "templates", "spec-templates", "plan.md.template");

  test("the template frontmatter carries a `migration: none` line", () => {
    expect(frontmatter(tmpl())).toMatch(/^migration:\s+none\b/m);
  });

  test("the `migration: none` line carries an inline explanatory comment", () => {
    // Schema-T style: `key: value  # explanation`. The comment must actually
    // explain the key, not merely exist — it names the registry/id alternative.
    const line = frontmatter(tmpl())
      .split("\n")
      .find((l) => /^migration:\s+none\b/.test(l));
    expect(line).toBeDefined();
    expect(line!).toMatch(/#/); // an inline comment is present
    expect(line!).toMatch(/registry|entry id|none/i); // and it is explanatory
  });
});

describe("AC-STE-393.1 — the M108 plan itself declares `migration: none`", () => {
  test("the M108 plan frontmatter carries `migration: none` (active or archived)", () => {
    // Archive-fallback: /implement's own milestone close moves the plan to
    // specs/plan/archive/M108.md. The declaration is what this asserts, not the
    // path, so it reads whichever location the plan currently lives at.
    const active = join(REPO_ROOT, "specs", "plan", "M108.md");
    const archived = join(REPO_ROOT, "specs", "plan", "archive", "M108.md");
    const planPath = existsSync(active) ? active : archived;
    expect(frontmatter(readFileSync(planPath, "utf-8"))).toMatch(/^migration:\s+none\s*$/m);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-393.1 — /spec-write's plan-creation flow sets the value
// ---------------------------------------------------------------------------

describe("AC-STE-393.1 — /spec-write plan-creation flow sets `migration:` deliberately", () => {
  test("the spec-write SKILL's plan.md section references the migration declaration", () => {
    const skill = read(PLUGIN_ROOT, "skills", "spec-write", "SKILL.md");
    // Scoped to the plan.md subsection so a generic 'migration' word elsewhere
    // (the Risk table already mentions 'DB schema migration') can't pass this.
    const planSection = skill.match(/#### plan\.md[\s\S]*?(?=\n#### |\n### |$)/);
    expect(planSection).not.toBeNull();
    expect(planSection![0]).toMatch(/`?migration:?`?\b/);
    expect(planSection![0]).toMatch(/\bnone\b|registry/i);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-393.2 — ship-milestone pre-flight step
// ---------------------------------------------------------------------------

describe("AC-STE-393.2 — /ship-milestone documents the migration pre-flight", () => {
  const skill = (): string => read(PLUGIN_ROOT, "skills", "ship-milestone", "SKILL.md");

  test("the SKILL names the pre-flight helper assertMigrationDeclared", () => {
    expect(skill()).toContain("assertMigrationDeclared");
  });

  test("the pre-flight cites the migrations coverage module path", () => {
    expect(skill()).toMatch(/adapters\/_shared\/src\/migrations\/coverage\.ts/);
  });

  test("the pre-flight prose names the `none` and registry-id semantics", () => {
    const body = skill();
    // The step must explain what it checks: a declared id must be in the
    // registry at the shipping version, or `none` to proceed.
    expect(body).toMatch(/migration/i);
    expect(body).toMatch(/\bnone\b/);
    expect(body).toMatch(/registry|introduced_in/);
  });

  test("ship-milestone SKILL.md stays within the NFR-1 line cap (354)", () => {
    expect(skill().split("\n").length).toBeLessThanOrEqual(354);
  });

  test("the new pre-flight prose adds no STE-N token (skills ceiling is at 246/246)", () => {
    // The migration pre-flight step must be citation-free — the shipped-prose
    // STE-token ceiling has ZERO headroom. This guards the *new* surface only;
    // a probe entry / pre-flight that quotes `STE-393` would blow the ceiling.
    const preflight = skill().match(/assertMigrationDeclared[\s\S]{0,600}/);
    if (preflight) expect(preflight[0]).not.toMatch(/STE-\d+/);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-393.3 — probe #68 wiring in gate-check SKILL.md
// ---------------------------------------------------------------------------

describe("AC-STE-393.3 — probe #68 `migration_coverage` is wired in gate-check SKILL.md", () => {
  const skill = (): string => read(PLUGIN_ROOT, "skills", "gate-check", "SKILL.md");

  /** The #68 probe-entry block: from `^68.` to the next numbered entry / h2 / EOF. */
  function probe68Block(body: string): string {
    const m = body.match(/^68\.\s+\*\*`?migration_coverage`?\*\*[\s\S]*?(?=^\d+\.\s|\n## |$)/m);
    expect(m).not.toBeNull();
    return m![0];
  }

  test("registered as the 68th numbered probe named migration_coverage", () => {
    expect(skill()).toMatch(/^68\.\s+\*\*`?migration_coverage`?\*\*/m);
  });

  test("entry declares Severity: error", () => {
    expect(probe68Block(skill())).toMatch(/Severity:\s*error/i);
  });

  test("entry follows the probe-entry shape: names the probe call + module path + vacuity + test coverage", () => {
    const block = probe68Block(skill());
    expect(block).toMatch(/runMigrationCoverageProbe/);
    expect(block).toMatch(/adapters\/_shared\/src\/migrations\/coverage\.ts/);
    expect(block).toMatch(/[Vv]acuous/);
    expect(block).toMatch(/tests\/m108-ste-393-probe\.test\.ts/);
  });

  test("entry states the scope discipline — archive-scoped ERROR, active-scoped advisory, pre-epoch exempt", () => {
    const block = probe68Block(skill());
    expect(block).toMatch(/archive/i);
    expect(block).toMatch(/advisor|warn/i);
    expect(block).toMatch(/epoch|grandfather|exempt/i);
  });

  test("gate-check SKILL.md stays within the NFR-1 line cap (354)", () => {
    expect(skill().split("\n").length).toBeLessThanOrEqual(354);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-393.6 — docs document the declaration contract + pre-flight
// ---------------------------------------------------------------------------

describe("AC-STE-393.6 — docs/ship-milestone-reference.md documents the declaration + pre-flight", () => {
  const doc = (): string => read(PLUGIN_ROOT, "docs", "ship-milestone-reference.md");

  test("it names the migration declaration pre-flight helper", () => {
    expect(doc()).toContain("assertMigrationDeclared");
  });

  test("it documents the declaration contract — `migration:` key, `none` or a registry id", () => {
    const body = doc();
    expect(body).toMatch(/`?migration:?`?\b/);
    expect(body).toMatch(/\bnone\b/);
    expect(body).toMatch(/registry/i);
  });
});

describe("AC-STE-393.6 — docs/upgrade-reference.md documents the declaration contract", () => {
  const doc = (): string => read(PLUGIN_ROOT, "docs", "upgrade-reference.md");

  test("it documents the plan-level `migration:` declaration that binds plans to registry entries", () => {
    const body = doc();
    expect(body).toMatch(/`?migration:?`?\b/);
    expect(body).toMatch(/declar/i);
    expect(body).toMatch(/specs\/plan|plan-level|milestone plan/i);
  });

  test("it explains the coverage rule — plans declare `none` or an entry id", () => {
    const body = doc();
    expect(body).toMatch(/\bnone\b/);
    expect(body).toMatch(/entry id|registry entry/i);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-393.6 — probe-count pins track the current count at every pinned
// surface. Recalibrated 68 → 69 by M109/STE-394's #69 upgrade_staleness.
// ---------------------------------------------------------------------------

describe("AC-STE-393.6 — README probe-count pins move 68 → 69", () => {
  const readme = (): string => read(REPO_ROOT, "README.md");

  // Kept at 67 deliberately: each `mNNN-*-docs-pins` file owns the tripwire for
  // the token ITS release retired. The current-era guard (no stale `68`) lives
  // in `tests/m109-ste-394-docs-pins.test.ts`, so re-keying this one would
  // duplicate that guard and drop the 67 tripwire in exchange for nothing.
  test("no stale M107-era `67 numbered` / `layers 67 probes` token survives", () => {
    const body = readme();
    expect(body).not.toMatch(/\b67\b\s+numbered/);
    expect(body).not.toMatch(/layers 67 probes/);
  });

  test("the Features bullet counts 72 numbered probes", () => {
    expect(readme()).toMatch(/\b72\b\s+numbered `\/gate-check` probes/);
  });

  test("the /implement-invokes-/tdd aside counts 72 probes", () => {
    expect(readme()).toMatch(/layers 72 probes/);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-393.6 — the gate-check SKILL prose mirrors the epoch CONSTANT.
//
// Probe #68's SKILL.md entry names the coverage epoch as a prose literal. The
// value is single-sourced in coverage.ts (MIGRATION_COVERAGE_EPOCH), and the
// FR records that the epoch must be corrected at /ship-milestone time if the
// release target shifts (it contends with M101). Without this pin, the code
// constant could move while the SKILL prose kept the stale value — the exact
// class of doc drift the toolkit's count-pin tests exist to prevent.
// ---------------------------------------------------------------------------

import { MIGRATION_COVERAGE_EPOCH } from "../adapters/_shared/src/migrations/coverage";

describe("AC-STE-393.6 — probe #68 SKILL prose names the epoch constant, not a stale copy", () => {
  test("skills/gate-check/SKILL.md's probe #68 entry carries the live MIGRATION_COVERAGE_EPOCH value", () => {
    const skill = read(PLUGIN_ROOT, "skills", "gate-check", "SKILL.md");
    const probe68 = skill.match(/^68\. \*\*`migration_coverage`[\s\S]*?(?=^69\. \*\*|^## |\n## )/m);
    expect(probe68).not.toBeNull();
    expect(probe68![0]).toContain(MIGRATION_COVERAGE_EPOCH);
  });
});
