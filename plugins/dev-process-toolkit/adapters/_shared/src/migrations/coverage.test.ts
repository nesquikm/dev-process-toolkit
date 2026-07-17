// M108 STE-393 — `assertMigrationDeclared`, the /ship-milestone pre-flight.
//
// AC map:
//   AC-STE-393.2 — six deterministic verdicts over (planPath, registry,
//                  releaseVersion): absent key / `none` / valid id + matching
//                  version / unknown id / introduced_in mismatch / null-empty
//                  sentinel. Refusals carry the NFR-10 canonical shape.
//   AC-STE-393.4 — `migration: null` and `migration:` (empty) are ABSENT, never
//                  a valid declaration (M103 template-sentinel lesson, 8ed7c80).
//
// Shape precedent: `plan_ship_stamp.ts` (byte-preserving frontmatter reads,
// unclosed-frontmatter refusals, `Refusing: / Remedy: / Context:` messages).
//
// The helper is async: it reads the plan off disk, same as its ship-ceremony
// sibling `stampShippedIn` (whose asyncness was an M105 gotcha worth inheriting
// deliberately rather than rediscovering).

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MIGRATION_COVERAGE_EPOCH, assertMigrationDeclared } from "./coverage";
import type { MigrationEntry } from "./index";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * A synthetic registry. The real MIGRATIONS list tops out at `introduced_in:
 * 2.46.0` — every entry predates the coverage epoch by construction (the four
 * seeded entries are retro-seeded and unclaimed by design, per the FR's Notes).
 * A post-epoch "valid id + matching version" case therefore CANNOT be built
 * from the live registry, which is exactly why the registry is a parameter.
 */
const fixtureEntry = (id: string, introducedIn: string): MigrationEntry => ({
  id,
  introduced_in: introducedIn,
  title: `${id} (fixture)`,
  kind: "script",
  detect: () => ({ applies: false, evidence: [] }),
  apply: () => ({ changed: [], summary: "" }),
});

const REGISTRY: MigrationEntry[] = [
  fixtureEntry("alpha-relayout", "2.49.0"),
  fixtureEntry("beta-relayout", "2.50.0"),
];

const SHIPPING = "2.49.0";

const tmpRoots: string[] = [];

afterEach(() => {
  while (tmpRoots.length > 0) {
    const dir = tmpRoots.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

/** Write a plan file whose frontmatter carries exactly `keys`. */
function planFile(keys: string[]): string {
  const root = mkdtempSync(join(tmpdir(), "ste-393-coverage-"));
  tmpRoots.push(root);
  const path = join(root, "M108.md");
  writeFileSync(
    path,
    [
      "---",
      "milestone: M108",
      "status: active",
      "archived_at: null",
      ...keys,
      "---",
      "",
      "# Implementation Plan",
      "",
      "## M108: fixture {#M108}",
      "",
    ].join("\n"),
    "utf-8",
  );
  return path;
}

/** Capture the rejection message, failing loudly if the call resolved. */
async function refusalOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    return (err as Error).message;
  }
  throw new Error("expected assertMigrationDeclared to refuse, but it resolved");
}

/** Every NFR-10 refusal is verdict / `Remedy:` / `Context:`. */
function expectNfr10Shape(message: string, planPath: string): void {
  const lines = message.split("\n");
  expect(lines[0]).toMatch(/^Refusing: /);
  expect(lines.some((l) => l.startsWith("Remedy: "))).toBe(true);
  const context = lines.find((l) => l.startsWith("Context: "));
  expect(context).toBeDefined();
  // The plan is named — a refusal the operator can act on without a hunt.
  expect(message).toContain(planPath);
  expect(context!).toContain(`file=${planPath}`);
}

// ---------------------------------------------------------------------------
// AC-STE-393.2 — the six verdicts
// ---------------------------------------------------------------------------

describe("AC-STE-393.2 — verdict 1/6: absent key ⇒ NFR-10 refusal", () => {
  test("a plan with no `migration:` key refuses, naming the plan", async () => {
    const path = planFile(["kickoff_branch: null"]);
    const message = await refusalOf(assertMigrationDeclared(path, REGISTRY, SHIPPING));
    expectNfr10Shape(message, path);
    expect(message).toMatch(/migration/i);
    // The verdict says WHAT is wrong: the declaration is missing.
    expect(message.split("\n")[0]!).toMatch(/no `?migration:?`? (key|declaration)|missing|undeclared/i);
  });

  test("the remedy is the declare-remedy — it names both legal value shapes", async () => {
    const path = planFile(["kickoff_branch: null"]);
    const message = await refusalOf(assertMigrationDeclared(path, REGISTRY, SHIPPING));
    const remedy = message.split("\n").find((l) => l.startsWith("Remedy: "))!;
    // `migration: none` OR a registry entry id — the operator must be told both.
    expect(remedy).toContain("migration:");
    expect(remedy).toMatch(/\bnone\b/);
    expect(remedy).toMatch(/registry|entry id/i);
  });
});

describe("AC-STE-393.2 — verdict 2/6: `migration: none` ⇒ proceed", () => {
  test("resolves without throwing", async () => {
    const path = planFile(["migration: none"]);
    expect(await assertMigrationDeclared(path, REGISTRY, SHIPPING)).toBeUndefined();
  });

  test("`none` never consults the registry — an EMPTY registry still proceeds", async () => {
    const path = planFile(["migration: none"]);
    expect(await assertMigrationDeclared(path, [], SHIPPING)).toBeUndefined();
  });
});

describe("AC-STE-393.2 — verdict 3/6: valid id + matching version ⇒ proceed", () => {
  test("declared id present in registry with introduced_in == the shipping version", async () => {
    const path = planFile(["migration: alpha-relayout"]);
    expect(await assertMigrationDeclared(path, REGISTRY, SHIPPING)).toBeUndefined();
  });

  test("a leading `v` on releaseVersion is tolerated (stampShippedIn's contract)", async () => {
    const path = planFile(["migration: alpha-relayout"]);
    expect(await assertMigrationDeclared(path, REGISTRY, "v2.49.0")).toBeUndefined();
  });

  test("a leading `v` on the entry's introduced_in is tolerated too", async () => {
    const path = planFile(["migration: v-prefixed"]);
    const registry = [fixtureEntry("v-prefixed", "v2.49.0")];
    expect(await assertMigrationDeclared(path, registry, "2.49.0")).toBeUndefined();
  });
});

describe("AC-STE-393.2 — verdict 4/6: unknown id ⇒ refusal", () => {
  test("an id the registry does not carry refuses, naming the offending value", async () => {
    const path = planFile(["migration: ghost-relayout"]);
    const message = await refusalOf(assertMigrationDeclared(path, REGISTRY, SHIPPING));
    expectNfr10Shape(message, path);
    expect(message).toContain("ghost-relayout");
    expect(message.split("\n")[0]!).toMatch(/not (present |found )?in the registry|unknown|no registry entry/i);
  });

  test("the refusal is NOT the absent-key verdict — the two are distinguishable", async () => {
    const absent = await refusalOf(
      assertMigrationDeclared(planFile(["kickoff_branch: null"]), REGISTRY, SHIPPING),
    );
    const unknown = await refusalOf(
      assertMigrationDeclared(planFile(["migration: ghost-relayout"]), REGISTRY, SHIPPING),
    );
    expect(unknown.split("\n")[0]).not.toBe(absent.split("\n")[0]);
  });
});

describe("AC-STE-393.2 — verdict 5/6: introduced_in mismatch ⇒ refusal", () => {
  test("a registry entry introduced in a DIFFERENT release refuses, naming both versions", async () => {
    // beta-relayout is introduced_in 2.50.0; we are shipping 2.49.0.
    const path = planFile(["migration: beta-relayout"]);
    const message = await refusalOf(assertMigrationDeclared(path, REGISTRY, SHIPPING));
    expectNfr10Shape(message, path);
    expect(message).toContain("beta-relayout");
    expect(message).toContain("2.50.0"); // the entry's introduced_in
    expect(message).toContain("2.49.0"); // the version being shipped
    expect(message.split("\n")[0]!).toMatch(/introduced_in|version/i);
  });

  test("the mismatch verdict differs from the unknown-id verdict", async () => {
    const unknown = await refusalOf(
      assertMigrationDeclared(planFile(["migration: ghost-relayout"]), REGISTRY, SHIPPING),
    );
    const mismatch = await refusalOf(
      assertMigrationDeclared(planFile(["migration: beta-relayout"]), REGISTRY, SHIPPING),
    );
    expect(mismatch.split("\n")[0]).not.toBe(unknown.split("\n")[0]);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-393.4 — verdict 6/6: the null / empty sentinel is ABSENT
// ---------------------------------------------------------------------------

describe("AC-STE-393.4 — `migration: null` and `migration:` are treated as absent", () => {
  test("`migration: null` refuses — the template sentinel is not a declaration", async () => {
    const path = planFile(["migration: null"]);
    const message = await refusalOf(assertMigrationDeclared(path, REGISTRY, SHIPPING));
    expectNfr10Shape(message, path);
    // Crucially NOT an "unknown id" refusal naming `null` as a candidate id —
    // the sentinel must classify as the absent-key verdict.
    const absent = await refusalOf(
      assertMigrationDeclared(planFile(["kickoff_branch: null"]), REGISTRY, SHIPPING),
    );
    expect(message.split("\n")[0]!.replace(path, "<plan>")).toBe(
      absent.split("\n")[0]!.replace(absent.match(/\S+M108\.md/)?.[0] ?? "", "<plan>"),
    );
  });

  test("`migration:` with an empty value refuses as absent", async () => {
    const path = planFile(["migration:"]);
    const message = await refusalOf(assertMigrationDeclared(path, REGISTRY, SHIPPING));
    expectNfr10Shape(message, path);
    expect(message.split("\n")[0]!).toMatch(/no `?migration:?`? (key|declaration)|missing|undeclared/i);
  });

  test("`migration:   ` (whitespace only) refuses as absent", async () => {
    const path = planFile(["migration:   "]);
    const message = await refusalOf(assertMigrationDeclared(path, REGISTRY, SHIPPING));
    expectNfr10Shape(message, path);
  });

  test("a registry entry literally id'd `null` still does not rescue the sentinel", async () => {
    // Belt-and-braces: even a pathological registry cannot turn the sentinel
    // into a valid declaration, because the sentinel never reaches lookup.
    const path = planFile(["migration: null"]);
    const registry = [fixtureEntry("null", "2.49.0")];
    await expect(assertMigrationDeclared(path, registry, SHIPPING)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// AC-STE-393.2 — frontmatter-read discipline (plan_ship_stamp shape)
// ---------------------------------------------------------------------------

describe("AC-STE-393.2 — frontmatter parsing follows plan_ship_stamp discipline", () => {
  test("a plan with no frontmatter block refuses (never silently proceeds)", async () => {
    const root = mkdtempSync(join(tmpdir(), "ste-393-nofm-"));
    tmpRoots.push(root);
    const path = join(root, "M108.md");
    writeFileSync(path, "# Implementation Plan\n\nmigration: none\n", "utf-8");
    await expect(assertMigrationDeclared(path, REGISTRY, SHIPPING)).rejects.toThrow();
  });

  test("an unclosed frontmatter block refuses", async () => {
    const root = mkdtempSync(join(tmpdir(), "ste-393-unclosed-"));
    tmpRoots.push(root);
    const path = join(root, "M108.md");
    writeFileSync(path, "---\nmilestone: M108\nmigration: none\n\n# Plan\n", "utf-8");
    await expect(assertMigrationDeclared(path, REGISTRY, SHIPPING)).rejects.toThrow();
  });

  test("a body line reading `migration: none` below the frontmatter does NOT satisfy the key", async () => {
    const root = mkdtempSync(join(tmpdir(), "ste-393-body-"));
    tmpRoots.push(root);
    const path = join(root, "M108.md");
    writeFileSync(
      path,
      ["---", "milestone: M108", "---", "", "# Plan", "", "migration: none", ""].join("\n"),
      "utf-8",
    );
    const message = await refusalOf(assertMigrationDeclared(path, REGISTRY, SHIPPING));
    expect(message.split("\n")[0]!).toMatch(/no `?migration:?`? (key|declaration)|missing|undeclared/i);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-393.3 — the epoch constant
// ---------------------------------------------------------------------------

describe("AC-STE-393.3 — MIGRATION_COVERAGE_EPOCH", () => {
  test("is a bare semver string (no `v` prefix), matching the registry's introduced_in shape", () => {
    expect(MIGRATION_COVERAGE_EPOCH).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test("is pinned to this FR's release target", () => {
    // Provisional v2.49.0 — contends with M101. If the release target shifts,
    // correcting this constant is an explicit /ship-milestone-time checklist
    // item (FR § Technical Design), and this pin is what enforces it.
    expect(MIGRATION_COVERAGE_EPOCH).toBe("2.49.0");
  });
});
