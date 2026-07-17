// M108 — defects surfaced by the pre-release adversarial verification sweep.
// Each test pins a real correctness bug a green gate missed: the migration
// frontmatter parser choking on the template's own inline comment (would refuse
// the next milestone's ship), and the permission-shape projection widening the
// operator's security allowlist across toolchains.

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { assertMigrationDeclared, runMigrationCoverageProbe } from "../adapters/_shared/src/migrations/coverage";
import { MIGRATIONS } from "../adapters/_shared/src/migrations/index";
import type { MigrationEntry } from "../adapters/_shared/src/migrations/index";
import { permissionShapes } from "../adapters/_shared/src/migrations/entries/permission_shapes";
import { writeJsonIfChanged } from "../adapters/_shared/src/migrations/consumer_files";

const roots: string[] = [];
const mkRoot = (): string => {
  const r = mkdtempSync(join(tmpdir(), "m108-prerel-"));
  roots.push(r);
  return r;
};
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// BLOCKER — the migration frontmatter parser must strip a YAML inline comment.
// The shipped plan.md.template ships `migration: none  # literal ...`, so a plan
// created from the default must classify as `none`, not as an unknown id.
// ---------------------------------------------------------------------------

const writePlan = (root: string, name: string, frontmatter: string[]): string => {
  const dir = join(root, "specs", "plan");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, ["---", ...frontmatter, "---", "", "# Plan", ""].join("\n"));
  return path;
};

describe("migration declaration — the template's inline comment classifies as `none`", () => {
  test("assertMigrationDeclared proceeds on `migration: none  # literal ...` (the template default)", async () => {
    const root = mkRoot();
    const plan = writePlan(root, "M999.md", ["milestone: M999", "migration: none  # literal `none`, or a migration-registry entry id"]);
    // Must NOT throw — the commented default is semantically `none`.
    await assertMigrationDeclared(plan, MIGRATIONS, "2.49.0");
  });

  test("a genuinely unknown id still refuses (the strip does not swallow real ids)", async () => {
    const root = mkRoot();
    const plan = writePlan(root, "M999.md", ["milestone: M999", "migration: ghost-entry"]);
    await expect(assertMigrationDeclared(plan, MIGRATIONS, "2.49.0")).rejects.toThrow();
  });

  test("probe: an active plan with commented `none` is coherent — no advisory warning", async () => {
    const root = mkRoot();
    writePlan(root, "M999.md", ["milestone: M999", "migration: none  # literal none"]);
    mkdirSync(join(root, "specs", "plan", "archive"), { recursive: true });
    const report = await runMigrationCoverageProbe(root, MIGRATIONS);
    expect(report.warnings).toEqual([]);
    expect(report.violations).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// MAJOR — permission-shape projection must NOT widen across toolchains. A
// `Bash(<stack> *)` glob may only project to rules that invoke that command,
// never the stack's adjacent tooling (uv/pytest off python, npm/npx off node).
// ---------------------------------------------------------------------------

const bootstrapSettings = (root: string, allow: string[]): string => {
  const dir = join(root, ".claude");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "settings.json");
  writeFileSync(path, JSON.stringify({ permissions: { allow } }, null, 2) + "\n");
  return path;
};

const allowAfter = (path: string): string[] =>
  (JSON.parse(readFileSync(path, "utf-8")) as { permissions: { allow: string[] } }).permissions.allow;

describe("permission-shape projection only ever narrows — no cross-toolchain widening", () => {
  test("`Bash(python *)` never grants uv/pytest (adjacent tools the operator did not name)", () => {
    const root = mkRoot();
    const path = bootstrapSettings(root, ["Bash(python *)"]);
    permissionShapes.apply!(root);
    const after = allowAfter(path);
    for (const forbidden of ["Bash(uv sync)", "Bash(uv run)", "Bash(pytest)"]) {
      expect(after).not.toContain(forbidden);
    }
    // Any surviving rule must actually invoke python.
    for (const rule of after) expect(rule.startsWith("Bash(python")).toBe(true);
  });

  test("`Bash(node *)` never grants npm/npx", () => {
    const root = mkRoot();
    const path = bootstrapSettings(root, ["Bash(node *)"]);
    permissionShapes.apply!(root);
    const after = allowAfter(path);
    for (const forbidden of ["Bash(npm install)", "Bash(npm test)", "Bash(npx)"]) {
      expect(after).not.toContain(forbidden);
    }
  });

  test("`Bash(flutter *)` never grants dart or fvm", () => {
    const root = mkRoot();
    const path = bootstrapSettings(root, ["Bash(flutter *)"]);
    permissionShapes.apply!(root);
    const after = allowAfter(path);
    expect(after).not.toContain("Bash(dart)");
    expect(after).not.toContain("Bash(fvm flutter)");
  });

  test("`Bash(bun *)` STILL projects the full bun toolchain (the coherent case is unbroken)", () => {
    const root = mkRoot();
    const path = bootstrapSettings(root, ["Bash(bun *)"]);
    permissionShapes.apply!(root);
    const after = allowAfter(path);
    for (const expected of ["Bash(bun install)", "Bash(bun test)", "Bash(bun run)", "Bash(bunx)"]) {
      expect(after).toContain(expected);
    }
  });
});

// ---------------------------------------------------------------------------
// MINOR — writeJsonIfChanged must preserve the file's own indentation, not
// re-emit at a fixed 2-space width (AC-STE-391.5/.6 "every other byte preserved").
// ---------------------------------------------------------------------------

describe("writeJsonIfChanged — preserves the file's own indent width", () => {
  test("a 4-space-indented JSON file stays 4-space after a change", () => {
    const root = mkRoot();
    const path = join(root, "settings.json");
    writeFileSync(path, JSON.stringify({ a: 1, keep: "me" }, null, 4) + "\n");
    writeJsonIfChanged(path, { a: 2, keep: "me" });
    const after = readFileSync(path, "utf-8");
    expect(after).toMatch(/\n {4}"keep"/); // 4-space indent survives
    expect(after).not.toMatch(/\n {2}"keep"/); // not reindented to 2
  });

  test("a tab-indented JSON file stays tab-indented", () => {
    const root = mkRoot();
    const path = join(root, "settings.json");
    writeFileSync(path, JSON.stringify({ a: 1 }, null, "\t") + "\n");
    writeJsonIfChanged(path, { a: 2 });
    expect(readFileSync(path, "utf-8")).toMatch(/\n\t"a"/);
  });
});
