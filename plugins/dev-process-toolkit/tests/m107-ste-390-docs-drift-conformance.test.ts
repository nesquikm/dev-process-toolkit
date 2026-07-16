// STE-390 (M107) — docs-drift sweep: retire stale branch-automation
// phrasing, clear the probe-#37 tree-leaf advisories. Prose-only FR; this
// one doc-conformance meta-test carries every pin (retired-phrase absence
// + corrected-phrase presence per site) plus the probe-#37 dogfood.
// RED-state until the docs edits land.
//
// AC map:
//   AC-STE-390.1 — templates/CLAUDE.md.template's `branch_template:`
//                  comment names the trunk-OK allowlist as `ci` only;
//                  retired "`chore`, `docs`, `ci`" phrasing gone.
//   AC-STE-390.2 — docs/setup-tracker-mode.md + docs/patterns.md describe
//                  `{type}` as derived deterministically via
//                  `branchTypeFor` from `changelog_category` (unknown-
//                  clamp mention kept); no "LLM-inferred" attached to
//                  `{type}`. `{slug}` stays LLM-inferred by design and is
//                  deliberately NOT pinned here.
//   AC-STE-390.3 — specs/technical-spec.md Schema L `branch_template:`
//                  bullet: `/setup` seeds the single canonical default
//                  `{type}/m{N}-{slug}` in every mode; "scope-aware
//                  default" gone.
//   AC-STE-390.4 — the three genuinely stale tree leaves in
//                  specs/technical-spec.md no longer surface as probe-#37
//                  violations (resolve on disk or no longer parse).
//   AC-STE-390.5 — the two illustrative example fences (Schema A
//                  traceability map, Schema AA fragment frontmatter) are
//                  reworded to resolvable/neutral tokens; dogfood:
//                  runCrossCuttingSpecStaleFileRefsProbe(repoRoot) returns
//                  zero violations on this repo.
//   AC-STE-390.6 — full gate green: no dedicated test (covered by running
//                  `bun test` from plugins/dev-process-toolkit).
//
// Dogfood precedent: tests/gate-check-fr-summary-altitude.test.ts (#67).

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runCrossCuttingSpecStaleFileRefsProbe } from "../adapters/_shared/src/cross_cutting_spec_stale_file_refs";

const pluginRoot = join(import.meta.dir, "..");
const repoRoot = join(import.meta.dir, "..", "..", "..");

const templatePath = join(pluginRoot, "templates", "CLAUDE.md.template");
const setupTrackerModePath = join(pluginRoot, "docs", "setup-tracker-mode.md");
const patternsPath = join(pluginRoot, "docs", "patterns.md");
const technicalSpecPath = join(repoRoot, "specs", "technical-spec.md");

function read(path: string): string {
  return readFileSync(path, "utf-8");
}

/** Conventional Commits type vocabulary (CLAUDE.md commit convention). */
const CC_TYPES = new Set([
  "feat",
  "fix",
  "docs",
  "style",
  "refactor",
  "perf",
  "test",
  "build",
  "ci",
  "chore",
  "revert",
]);

/**
 * The allow clause of the template's Trunk-OK sentence: from the
 * `**Trunk-OK allowlist:**` marker up to the first `;` (the enforce
 * clause, if any, is out of scope — listing `chore`/`docs` among the
 * branch-enforced types there is correct, not retired phrasing).
 */
function trunkOkAllowClause(template: string): string {
  const match = template.match(
    /\*\*Trunk-OK allowlist:\*\*([\s\S]*?)(?:\n[ \t]*\n|-->)/,
  );
  expect(match).not.toBeNull();
  return match![1]!.split(";")[0]!;
}

/**
 * The `{type}` placeholder description: from the standalone `` `{type}` ``
 * token (backtick right after `}` — the template form
 * `` `{type}/m{N}-{slug}` `` never matches) to the next placeholder token.
 */
function typeDescription(content: string): string {
  const match = content.match(
    /`\{type\}`([\s\S]*?)(?:`\{N\}`|`\{ticket-id\}`|`\{slug\}`|$)/,
  );
  expect(match).not.toBeNull();
  return match![1]!;
}

describe("AC-STE-390.1 — template trunk-OK comment names `ci` only", () => {
  test("Schema L comment block still carries the Trunk-OK allowlist marker", () => {
    const template = read(templatePath);
    const commentBlocks = template.match(/<!--[\s\S]*?-->/g) ?? [];
    const schemaLBlock = commentBlocks.find((block) =>
      block.includes("Trunk-OK allowlist"),
    );
    expect(schemaLBlock).toBeDefined();
    // Same block as the branch_template: key hint — the sweep rewords the
    // comment, it does not relocate or delete it.
    expect(schemaLBlock).toContain("branch_template:");
  });

  test("the allow clause names `ci` as the only trunk-OK type", () => {
    const clause = trunkOkAllowClause(read(templatePath));
    const mentioned = Array.from(
      new Set(
        Array.from(clause.matchAll(/`([a-z]+)`/g), (m) => m[1]!).filter(
          (token) => CC_TYPES.has(token),
        ),
      ),
    );
    expect(mentioned).toEqual(["ci"]);
    expect(clause).toMatch(/trunk/i);
  });

  test("the retired '`chore`, `docs`, `ci`' allowlist phrasing is gone", () => {
    expect(read(templatePath)).not.toContain("`chore`, `docs`, `ci`");
  });
});

describe("AC-STE-390.2 — deterministic `{type}` phrasing in placeholder docs", () => {
  const sites = [
    { name: "docs/setup-tracker-mode.md", path: setupTrackerModePath },
    { name: "docs/patterns.md", path: patternsPath },
  ] as const;

  for (const site of sites) {
    test(`${site.name}: {type} described as deterministic branchTypeFor(changelog_category), clamp kept`, () => {
      const segment = typeDescription(read(site.path));
      expect(segment).toMatch(/determinist/i);
      expect(segment).toMatch(/branchTypeFor/);
      expect(segment).toMatch(/changelog_category/);
      // Unknown-clamp mention kept (currently "unknown values clamp to `feat`").
      expect(segment).toMatch(/clamp/i);
    });

    test(`${site.name}: no "LLM-inferred" phrasing attached to {type}`, () => {
      const content = read(site.path);
      expect(typeDescription(content)).not.toMatch(/LLM-inferred/i);
      // Byte-level absence of the two retired literals, wherever they sit.
      expect(content).not.toContain("`{type}` — LLM-inferred");
      expect(content).not.toContain("`{type}` (LLM-inferred");
      // NOTE: `{slug}` stays LLM-inferred by design — no pins on it.
    });
  }
});

describe("AC-STE-390.3 — Schema L branch_template bullet (specs/technical-spec.md)", () => {
  function schemaLSection(): string {
    const match = read(technicalSpecPath).match(
      /^### Schema L:[\s\S]*?(?=^### Schema M:)/m,
    );
    expect(match).not.toBeNull();
    return match![0];
  }

  test("bullet says /setup seeds the single canonical default {type}/m{N}-{slug} in every mode", () => {
    const bullet = schemaLSection()
      .split("\n")
      .find((line) => /single canonical default/.test(line));
    expect(bullet).toBeDefined();
    expect(bullet).toContain("branch_template");
    expect(bullet).toMatch(/\/setup/);
    expect(bullet).toMatch(/seed/i);
    expect(bullet).toContain("{type}/m{N}-{slug}");
    expect(bullet).toMatch(/every mode/);
  });

  test("the 'scope-aware default' phrasing is gone", () => {
    expect(read(technicalSpecPath)).not.toMatch(/scope-aware default/i);
    expect(schemaLSection()).not.toMatch(/scope-aware/i);
  });
});

/** Probe-#37 violations whose reason names the given path token. */
async function violationsNaming(token: string) {
  const report = await runCrossCuttingSpecStaleFileRefsProbe(repoRoot);
  return report.violations.filter((v) => v.reason.includes(`"${token}"`));
}

describe("AC-STE-390.4 — the three stale tree leaves no longer flag", () => {
  // Third token doubles as the Schema AA example's target_file (AC-.5's
  // second fence) — one reword serves both ACs.
  const staleLeaves = [
    "agents/code-reviewer.md",
    "docs/layout-reference.md",
    "docs/reference/api/task_tracking_config.md",
  ] as const;

  for (const leaf of staleLeaves) {
    test(`probe #37 no longer flags "${leaf}"`, async () => {
      const offenders = await violationsNaming(leaf);
      expect(
        offenders.map((v) => `${v.file}:${v.line}`).join(", "),
      ).toBe("");
    });
  }
});

describe("AC-STE-390.5 — illustrative example fences clean + dogfood", () => {
  test("Schema A traceability example survives, reworded past the probe", async () => {
    const spec = read(technicalSpecPath);
    const schemaA = spec.match(/^### Schema A:[\s\S]*?(?=^### Schema B:)/m);
    expect(schemaA).not.toBeNull();
    // The example fence keeps its Schema A shape (file:line pairs + the
    // `(not found)` literal) — fixed by rewording, not by deletion.
    expect(schemaA![0]).toMatch(/^AC-[\w.]+ → .+:\d+/m);
    expect(schemaA![0]).toMatch(/^AC-[\w.]+ → \(not found\)/m);
    // The retired non-resolving tokens no longer surface via the probe.
    for (const token of ["src/file.ts", "tests/file.test.ts"]) {
      const offenders = await violationsNaming(token);
      expect(
        offenders.map((v) => `${v.file}:${v.line}`).join(", "),
      ).toBe("");
    }
  });

  test("Schema AA fragment example keeps its docs/-anchored target_file line", () => {
    const spec = read(technicalSpecPath);
    const schemaAA = spec.match(/^### Schema AA:[\s\S]*?(?=^#{2,3} )/m);
    expect(schemaAA).not.toBeNull();
    // Merge contract: target_file must start with docs/<target_section>/ —
    // the reword keeps the shape while clearing the probe.
    expect(schemaAA![0]).toMatch(/^target_file:\s*docs\//m);
  });

  test("dogfood: runCrossCuttingSpecStaleFileRefsProbe(repoRoot) returns zero violations", async () => {
    const report = await runCrossCuttingSpecStaleFileRefsProbe(repoRoot);
    if (report.violations.length > 0) {
      // Name every offender so the failing test says exactly which fence
      // drifted — the probe's own UX, dogfooded (probe-#67 precedent).
      const noted = report.violations.map((v) => v.note).join("\n");
      throw new Error(
        `Expected this repo's cross-cutting specs to clear probe #37, got ${report.violations.length} violation(s):\n${noted}`,
      );
    }
    expect(report.violations).toEqual([]);
  });
});
