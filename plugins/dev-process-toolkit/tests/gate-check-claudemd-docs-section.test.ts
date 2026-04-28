import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runClaudeMdDocsSectionProbe } from "../adapters/_shared/src/claudemd_docs_section";

// STE-107 AC-STE-107.4 / AC-STE-107.6 — `claudemd-docs-section-present` probe.
//
// If CLAUDE.md exists, it MUST have a `## Docs` section. Sibling probe to
// existing `## Task Tracking` checks. Vacuous when CLAUDE.md is absent.
//
// Six fixtures via mkdtempSync:
//   (a) CLAUDE.md absent → vacuous pass
//   (b) ## Docs present, all-false defaults → pass
//   (c) ## Docs present, one true → pass
//   (d) ## Docs present, all true → pass
//   (e) ## Docs absent → fail
//   (f) ## Docs only inside an HTML comment → fail (commented-out doesn't count)

const pluginRoot = join(import.meta.dir, "..");

function makeProject(claudeMd: string | null): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "claudemd-docs-section-"));
  if (claudeMd !== null) {
    writeFileSync(join(root, "CLAUDE.md"), claudeMd);
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

describe("AC-STE-107.6(a) CLAUDE.md absent → vacuous pass", () => {
  test("no project CLAUDE.md → no violations", async () => {
    const ctx = makeProject(null);
    try {
      const report = await runClaudeMdDocsSectionProbe(ctx.root);
      expect(report.violations).toEqual([]);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-107.6(b)–(d) ## Docs present in any flag combination → pass", () => {
  test("(b) all-false defaults → pass", async () => {
    const body = "# Project\n\n## Docs\n\nuser_facing_mode: false\npackages_mode: false\nchangelog_ci_owned: false\n";
    const ctx = makeProject(body);
    try {
      const report = await runClaudeMdDocsSectionProbe(ctx.root);
      expect(report.violations).toEqual([]);
    } finally {
      ctx.cleanup();
    }
  });

  test("(c) one true → pass", async () => {
    const body = "# Project\n\n## Docs\n\nuser_facing_mode: true\npackages_mode: false\nchangelog_ci_owned: false\n";
    const ctx = makeProject(body);
    try {
      const report = await runClaudeMdDocsSectionProbe(ctx.root);
      expect(report.violations).toEqual([]);
    } finally {
      ctx.cleanup();
    }
  });

  test("(d) all true → pass", async () => {
    const body = "# Project\n\n## Docs\n\nuser_facing_mode: true\npackages_mode: true\nchangelog_ci_owned: true\n";
    const ctx = makeProject(body);
    try {
      const report = await runClaudeMdDocsSectionProbe(ctx.root);
      expect(report.violations).toEqual([]);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-107.6(e) ## Docs absent → fail", () => {
  test("CLAUDE.md without ## Docs heading → 1 violation", async () => {
    const body = "# Project\n\n## Task Tracking\n\nmode: linear\n";
    const ctx = makeProject(body);
    try {
      const report = await runClaudeMdDocsSectionProbe(ctx.root);
      expect(report.violations.length).toBe(1);
      const v = report.violations[0]!;
      expect(v.note).toMatch(/CLAUDE\.md:\d+ — /);
      expect(v.note).toMatch(/## Docs/);
      expect(v.message).toMatch(/Remedy:/);
      expect(v.message).toMatch(/Context:/);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-107.6(f) ## Docs only inside HTML comment → fail", () => {
  test("commented-out heading does not satisfy the contract", async () => {
    const body = "# Project\n\n<!--\n## Docs\nuser_facing_mode: true\n-->\n";
    const ctx = makeProject(body);
    try {
      const report = await runClaudeMdDocsSectionProbe(ctx.root);
      expect(report.violations.length).toBe(1);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-107 — gate-check SKILL.md prose declares the probe", () => {
  const gateCheckSkill = readFileSync(
    join(pluginRoot, "skills", "gate-check", "SKILL.md"),
    "utf-8",
  );
  test("SKILL.md references probe `claudemd-docs-section-present`", () => {
    expect(gateCheckSkill).toMatch(/claudemd-docs-section-present/);
  });
});

describe("AC-STE-107.5 — CLAUDE.md.template advertises ## Docs default block", () => {
  const template = readFileSync(
    join(pluginRoot, "templates", "CLAUDE.md.template"),
    "utf-8",
  );
  test("template carries a literal ## Docs heading at the top level", () => {
    // The probe matches `^## Docs\b` outside HTML comments; the template
    // must emit the section as a real heading.
    expect(template).toMatch(/^## Docs$/m);
  });

  test("template seeds all three Schema-D defaults to false", () => {
    expect(template).toMatch(/user_facing_mode: false/);
    expect(template).toMatch(/packages_mode: false/);
    expect(template).toMatch(/changelog_ci_owned: false/);
  });
});

describe("AC-STE-136.3 — claudemd-docs-section-present runs clean on this repo's baseline", () => {
  test("the real repo's CLAUDE.md carries the ## Docs section (probe #18 is green)", async () => {
    const repoRoot = join(import.meta.dir, "..", "..", "..");
    const report = await runClaudeMdDocsSectionProbe(repoRoot);
    if (report.violations.length > 0) {
      const detail = report.violations
        .map((v) => `VIOL ${v.note} — ${v.message}`)
        .join("\n");
      throw new Error(`claudemd-docs-section self-check failed on this repo:\n${detail}`);
    }
    expect(report.violations).toEqual([]);
  });
});
