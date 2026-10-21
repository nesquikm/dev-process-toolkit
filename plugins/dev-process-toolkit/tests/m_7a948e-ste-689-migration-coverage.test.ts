// M_7a948e STE-689 — migration coverage under `changelog_unversioned: true`.
//
// The FR's Technical Design: "Migration coverage under the flag checks registry
// presence only, since there is no version to compare `introduced_in` with."
// The unversioned /ship-milestone run passes the literal `unreleased` as the
// release version to `assertMigrationDeclared`; every other refusal still fires.

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertMigrationDeclared } from "../adapters/_shared/src/migrations/coverage";
import type { MigrationEntry } from "../adapters/_shared/src/migrations/index";

const entry = (id: string, introducedIn: string): MigrationEntry => ({
  id,
  introduced_in: introducedIn,
  title: `${id} (fixture)`,
  kind: "script",
  detect: () => ({ applies: false, evidence: [] }),
  apply: () => ({ changed: [], summary: "" }),
});

const REGISTRY: MigrationEntry[] = [entry("alpha-relayout", "2.49.0")];

const roots: string[] = [];
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

function plan(migrationLine: string | null): string {
  const dir = mkdtempSync(join(tmpdir(), "ste689-mig-"));
  roots.push(dir);
  const path = join(dir, "M_abc123.md");
  const fm = ["---", "milestone: M_abc123", "status: archived", ...(migrationLine === null ? [] : [migrationLine]), "---"];
  writeFileSync(path, `${fm.join("\n")}\n\n# Implementation Plan\n`, "utf-8");
  return path;
}

async function refusal(p: Promise<void>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return (e as Error).message;
  }
  return "<no refusal>";
}

describe("AC-STE-689 Technical Design — migration coverage of an unversioned release checks registry presence only", () => {
  test("a registered id passes with `unreleased` as the version — no introduced_in comparison", async () => {
    await expect(assertMigrationDeclared(plan("migration: alpha-relayout"), REGISTRY, "unreleased")).resolves.toBeUndefined();
  });

  test("`migration: none` still passes", async () => {
    await expect(assertMigrationDeclared(plan("migration: none"), REGISTRY, "unreleased")).resolves.toBeUndefined();
  });

  test("an unknown id is still refused", async () => {
    const msg = await refusal(assertMigrationDeclared(plan("migration: gamma-relayout"), REGISTRY, "unreleased"));
    expect(msg).toContain("no registry entry with that id exists");
  });

  test("an absent declaration is still refused", async () => {
    const msg = await refusal(assertMigrationDeclared(plan(null), REGISTRY, "unreleased"));
    expect(msg).toContain("declares no `migration:` key");
  });

  test("CONTROL — a versioned release still compares introduced_in", async () => {
    const msg = await refusal(assertMigrationDeclared(plan("migration: alpha-relayout"), REGISTRY, "2.50.0"));
    expect(msg).toContain("introduced_in 2.49.0, but this release ships 2.50.0");
  });

  test("skills/ship-milestone/SKILL.md's unversioned paragraph names the registry-presence-only pre-flight", () => {
    const skill = readFileSync(join(import.meta.dir, "..", "skills", "ship-milestone", "SKILL.md"), "utf-8");
    const para = skill.split("\n").find((l) => l.startsWith("**Unversioned run ("));
    expect(para, "the Unversioned run paragraph is missing").toBeDefined();
    expect(para!).toContain("assertMigrationDeclared(planPath, MIGRATIONS, \"unreleased\")");
    expect(para!).toContain("registry presence only");
  });
});
