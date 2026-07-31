import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runClaudeMdDocsSectionProbe } from "../adapters/_shared/src/claudemd_docs_section";
import { SETUP_MARKER, detectManagedSignals } from "../adapters/_shared/src/toolkit_managed";

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
  // AC-STE-432.6 — the fixture now carries a real `## Task Tracking` heading so
  // it is a MANAGED tree by a signal probe #18 accepts. Before STE-432 this
  // fixture passed on an asymmetry (the guard read the raw file, the assertion
  // read the comment-stripped one); the explicit heading makes the managed-ness
  // intentional, so a later normalization of both sides cannot silently vacate it.
  test("commented-out heading does not satisfy the contract", async () => {
    const body =
      "# Project\n\n## Task Tracking\n\nmode: linear\n\n<!--\n## Docs\nuser_facing_mode: true\n-->\n";
    const ctx = makeProject(body);
    try {
      const report = await runClaudeMdDocsSectionProbe(ctx.root);
      expect(report.violations.length).toBe(1);
    } finally {
      ctx.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// STE-432 — probe #18 is scoped to toolkit-managed trees.
//
// Before STE-432 the only scope check was `existsSync(CLAUDE.md)`, so the probe
// fired on any project that wrote its own CLAUDE.md — an error-severity gate
// failure on a tree the toolkit never bootstrapped, with a remedy telling the
// operator to paste toolkit content into a file the toolkit does not own.
// ---------------------------------------------------------------------------

describe("AC-STE-432.2 — unmanaged CLAUDE.md is out of scope, whatever its ## Docs state", () => {
  test("no marker, no ## Task Tracking, no ## Docs → zero violations", async () => {
    // The FR's reproduction case, verbatim in shape.
    const body = "# Stock Check App\n\n## Tech Stack\n\nNext.js 15, Prisma, Postgres.\n";
    const ctx = makeProject(body);
    try {
      expect(detectManagedSignals(ctx.root)).toEqual([]);
      const report = await runClaudeMdDocsSectionProbe(ctx.root);
      expect(report.violations).toEqual([]);
    } finally {
      ctx.cleanup();
    }
  });

  test("no marker, no ## Task Tracking, but ## Docs present → zero violations", async () => {
    const body = "# Stock Check App\n\n## Tech Stack\n\nNext.js 15.\n\n## Docs\n\nSee the wiki.\n";
    const ctx = makeProject(body);
    try {
      expect(detectManagedSignals(ctx.root)).toEqual(["docs_section"]);
      const report = await runClaudeMdDocsSectionProbe(ctx.root);
      expect(report.violations).toEqual([]);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-432.3 — SETUP_MARKER alone puts the tree in scope", () => {
  test("marker-carrying CLAUDE.md with no ## Docs → exactly 1 violation", async () => {
    const body = `${SETUP_MARKER}\n\n# Project\n\nA /setup-generated file with no Docs section.\n`;
    const ctx = makeProject(body);
    try {
      expect(detectManagedSignals(ctx.root)).toEqual(["setup_marker"]);
      const report = await runClaudeMdDocsSectionProbe(ctx.root);
      expect(report.violations.length).toBe(1);
      const v = report.violations[0]!;
      expect(v.note).toMatch(/CLAUDE\.md:\d+ — /);
      expect(v.note).toMatch(/## Docs/);
      expect(v.message).toMatch(/Remedy:/);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-432.4 — a ## Task Tracking heading alone puts the tree in scope", () => {
  test("## Task Tracking, no marker, no ## Docs → exactly 1 violation", async () => {
    const body = "# Project\n\n## Task Tracking\n\nmode: linear\n";
    const ctx = makeProject(body);
    try {
      expect(detectManagedSignals(ctx.root)).toEqual(["task_tracking_section"]);
      const report = await runClaudeMdDocsSectionProbe(ctx.root);
      expect(report.violations.length).toBe(1);
      expect(report.violations[0]!.message).toMatch(/Remedy:/);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-432.5 — probe #18 ignores the docs_section signal (no circular guard)", () => {
  test("a tree whose ONLY managed signal is ## Docs is unmanaged for probe #18", async () => {
    // The raw file carries `## Docs` at line start (inside an HTML comment), so
    // `detectManagedSignals` reports `docs_section` — and nothing else. Accepting
    // that as evidence of managed-ness inside the probe that ASSERTS `## Docs`
    // exists would be circular, so probe #18 passes `ignore: ["docs_section"]`
    // and the tree is out of scope.
    const body = "# Project\n\n<!--\n## Docs\nuser_facing_mode: true\n-->\n";
    const ctx = makeProject(body);
    try {
      expect(detectManagedSignals(ctx.root)).toEqual(["docs_section"]);
      const report = await runClaudeMdDocsSectionProbe(ctx.root);
      expect(report.violations).toEqual([]);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-432.10 — gate-check SKILL.md entry #18 declares scope and severity", () => {
  const gateCheckSkill = readFileSync(
    join(pluginRoot, "skills", "gate-check", "SKILL.md"),
    "utf-8",
  );
  const lines = gateCheckSkill.split(/\r?\n/);
  const entry18 = lines.find((l) => l.startsWith("18. **`claudemd-docs-section-present`**"));
  const entry69 = lines.find((l) => l.startsWith("69. **`upgrade_staleness`**"));

  test("entry #18 exists and states its toolkit-managed scope", () => {
    expect(entry18).toBeString();
    expect(entry18!).toMatch(/toolkit-managed/);
  });

  test("entry #18 states its error severity", () => {
    expect(entry18!).toMatch(/Severity: error/);
  });

  test("entry #69's Step-0 sentence still names the same three signals", () => {
    expect(entry69).toBeString();
    expect(entry69!).toContain("<!-- generated by /dev-process-toolkit:setup -->");
    expect(entry69!).toContain("## Task Tracking");
    expect(entry69!).toContain("## Docs");
  });
});

describe("AC-STE-432.11 — the probe module header no longer equates absence with unmanaged", () => {
  const source = readFileSync(
    join(pluginRoot, "adapters", "_shared", "src", "claudemd_docs_section.ts"),
    "utf-8",
  );

  test("the false-equivalence sentence is gone", () => {
    expect(source).not.toContain("Vacuous when CLAUDE.md is absent (project not toolkit-managed)");
  });

  test("the probe routes through the shared predicate with a greppable docs_section carve-out", () => {
    expect(source).toContain("isToolkitManaged");
    expect(source).toMatch(/ignore:\s*\[\s*"docs_section"\s*\]/);
  });
});

describe("AC-STE-432.12 — the repo baseline assertion is two-sided", () => {
  const repoRoot = join(import.meta.dir, "..", "..", "..");

  test("this repo's root yields zero violations", async () => {
    const report = await runClaudeMdDocsSectionProbe(repoRoot);
    expect(report.violations).toEqual([]);
  });

  test("a copy of this repo's CLAUDE.md with ## Docs renamed yields exactly 1 violation", async () => {
    // Non-vacuity fence: a guard that made probe #18 permanently silent on this
    // repo would keep the zero-violation half green. This half fails unless the
    // probe still has teeth on the real file.
    const real = readFileSync(join(repoRoot, "CLAUDE.md"), "utf-8");
    expect(real).toMatch(/^## Docs$/m);
    const mutated = real.replace(/^## Docs$/m, "## Documentation");
    expect(mutated).not.toMatch(/^## Docs\s*$/m);
    const ctx = makeProject(mutated);
    try {
      const report = await runClaudeMdDocsSectionProbe(ctx.root);
      expect(report.violations.length).toBe(1);
      expect(report.violations[0]!.message).toMatch(/Remedy:/);
    } finally {
      ctx.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// STE-432 audit backfill — the two sides of probe #18 must agree on what a
// `## Docs` heading IS.
//
// The DETECTION side (`toolkit_managed.ts`) normalizes a UTF-8 BOM and CRLF and
// matches `/^##\s+Docs\s*$/m`. The ASSERTION side (`claudemd_docs_section.ts`)
// reads the RAW body and matches `/^## Docs\s*$/m` — exactly one literal space,
// no BOM or CRLF normalization.
//
// A tree can therefore clear the managed-ness guard and then fail the `## Docs`
// assertion while HAVING a real `## Docs` heading: an error-severity false
// positive, the exact failure class M118 exists to eliminate.
// ---------------------------------------------------------------------------

describe("STE-432 audit backfill — probe #18's assertion side must normalize like its detection side", () => {
  test("(A) `##  Docs` (two spaces) on a managed tree → zero violations", async () => {
    const body = "## Task Tracking\n\nmode: linear\n\n##  Docs\n\nuser_facing_mode: false\n";
    const ctx = makeProject(body);
    try {
      // The asymmetry, pinned from both ends: detection DOES see the heading…
      expect(detectManagedSignals(ctx.root)).toEqual(["task_tracking_section", "docs_section"]);
      // …so the assertion side must see it too.
      const report = await runClaudeMdDocsSectionProbe(ctx.root);
      expect(report.violations).toEqual([]);
    } finally {
      ctx.cleanup();
    }
  });

  test("(B) BOM-prefixed `## Docs` as the first line on a managed tree → zero violations", async () => {
    const body = "﻿## Docs\n\nuser_facing_mode: false\n\n## Task Tracking\n\nmode: linear\n";
    const ctx = makeProject(body);
    try {
      // A byte-order mark is not content: detection strips it and sees the heading.
      expect(detectManagedSignals(ctx.root)).toEqual(["task_tracking_section", "docs_section"]);
      const report = await runClaudeMdDocsSectionProbe(ctx.root);
      expect(report.violations).toEqual([]);
    } finally {
      ctx.cleanup();
    }
  });

  test("(C) CRLF line endings with a normal `## Docs` heading → zero violations", async () => {
    const body =
      "## Task Tracking\r\n\r\nmode: linear\r\n\r\n## Docs\r\n\r\nuser_facing_mode: false\r\n";
    const ctx = makeProject(body);
    try {
      expect(detectManagedSignals(ctx.root)).toEqual(["task_tracking_section", "docs_section"]);
      const report = await runClaudeMdDocsSectionProbe(ctx.root);
      expect(report.violations).toEqual([]);
    } finally {
      ctx.cleanup();
    }
  });

  test("(D) managed tree with NO `## Docs` heading at all → exactly 1 violation", async () => {
    // Non-vacuity fence: whatever normalization lands must not disarm the probe.
    const body = "## Task Tracking\n\nmode: linear\n\nNo Docs section anywhere.\n";
    const ctx = makeProject(body);
    try {
      const report = await runClaudeMdDocsSectionProbe(ctx.root);
      expect(report.violations.length).toBe(1);
      expect(report.violations[0]!.message).toMatch(/Remedy:/);
    } finally {
      ctx.cleanup();
    }
  });

  test("(E) managed tree whose only `## Docs` is inside an HTML comment → exactly 1 violation", async () => {
    // Comment stripping must survive the normalization change — a loosened
    // heading regex applied to the RAW body would silently vacate this.
    const body = "## Task Tracking\n\nmode: linear\n\n<!--\n## Docs\nuser_facing_mode: true\n-->\n";
    const ctx = makeProject(body);
    try {
      const report = await runClaudeMdDocsSectionProbe(ctx.root);
      expect(report.violations.length).toBe(1);
    } finally {
      ctx.cleanup();
    }
  });

  test("(E2) commented-out `##  Docs` under CRLF → exactly 1 violation", async () => {
    // The same fence with both new degrees of freedom engaged at once: extra
    // heading whitespace AND CRLF, still inside a comment.
    const body =
      "## Task Tracking\r\n\r\nmode: linear\r\n\r\n<!--\r\n##  Docs\r\nuser_facing_mode: true\r\n-->\r\n";
    const ctx = makeProject(body);
    try {
      const report = await runClaudeMdDocsSectionProbe(ctx.root);
      expect(report.violations.length).toBe(1);
    } finally {
      ctx.cleanup();
    }
  });

  test("(F) `## Documentation` on a managed tree → exactly 1 violation", async () => {
    // The heading match stays anchored; it must not decay into a prefix match.
    const body = "## Task Tracking\n\nmode: linear\n\n## Documentation\n\nSee the wiki.\n";
    const ctx = makeProject(body);
    try {
      expect(detectManagedSignals(ctx.root)).toEqual(["task_tracking_section"]);
      const report = await runClaudeMdDocsSectionProbe(ctx.root);
      expect(report.violations.length).toBe(1);
      expect(report.violations[0]!.message).toMatch(/Remedy:/);
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
