// Phase D Tier 4 test — migrate/index.ts (AC-48.1..13, NFR-14).
//
// End-to-end migration round trip: input fixture → output → byte-compare
// against expected fixture (modulo ULIDs, which are deterministic under
// DPT_TEST_ULID_SEED).

import { $ } from "bun";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { migrate } from "./index";

const FIXTURE_INPUT = join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "tests",
  "fixtures",
  "migration",
  "v1-to-v2",
  "input",
);
const FIXTURE_EXPECTED = join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "tests",
  "fixtures",
  "migration",
  "v1-to-v2",
  "expected",
);

let work: string;
const savedEnv: Record<string, string | undefined> = {};

async function initRepo(dir: string) {
  await $`git init --initial-branch=main -q`.cwd(dir);
  await $`git config user.email migrate@test.example`.cwd(dir);
  await $`git config user.name Migrate`.cwd(dir);
  await $`git config commit.gpgsign false`.cwd(dir);
}

function copyFixtureInto(src: string, dst: string) {
  cpSync(src, dst, { recursive: true });
}

function walk(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) out.push(...walk(full, base));
    else out.push(relative(base, full));
  }
  return out.sort();
}

beforeEach(async () => {
  savedEnv["NODE_ENV"] = process.env["NODE_ENV"];
  savedEnv["DPT_TEST_ULID_SEED"] = process.env["DPT_TEST_ULID_SEED"];
  process.env["NODE_ENV"] = "test";
  process.env["DPT_TEST_ULID_SEED"] = "01HZ";
  delete (globalThis as Record<string, unknown>)["__dpt_ulid_test_counter"];

  work = mkdtempSync(join(tmpdir(), "dpt-migrate-"));
  await initRepo(work);
  copyFixtureInto(join(FIXTURE_INPUT, "specs"), join(work, "specs"));
  await $`git add .`.cwd(work).quiet();
  await $`git commit -q -m "v1 baseline"`.cwd(work).quiet();
});

afterEach(() => {
  if (savedEnv["NODE_ENV"] === undefined) delete process.env["NODE_ENV"];
  else process.env["NODE_ENV"] = savedEnv["NODE_ENV"];
  if (savedEnv["DPT_TEST_ULID_SEED"] === undefined) delete process.env["DPT_TEST_ULID_SEED"];
  else process.env["DPT_TEST_ULID_SEED"] = savedEnv["DPT_TEST_ULID_SEED"];
  delete (globalThis as Record<string, unknown>)["__dpt_ulid_test_counter"];
  rmSync(work, { recursive: true, force: true });
});

describe("migrate — end-to-end round-trip", () => {
  test("live migration produces the expected v2 tree + tag + two commits (AC-48.5/10/11)", async () => {
    const result = await migrate({
      repoRoot: work,
      mode: "live",
      now: "2026-04-21T10:30:00Z",
    });
    expect(result.kind).toBe("migrated");
    expect(result.tag).toMatch(/^dpt-v1-snapshot-\d{8}-\d{6}$/);

    // Two commits: layout change + marker
    const log = (await $`git log --format=%s`.cwd(work).text()).trim().split("\n");
    expect(log[0]).toContain("record v2 layout marker");
    expect(log[1]).toContain("migrate to v2 layout");

    // Walk produced tree under specs/ and compare to expected
    const actualFiles = walk(join(work, "specs")).filter((f) => !f.startsWith(".migration-preview/"));
    const expectedFiles = walk(join(FIXTURE_EXPECTED, "specs"));
    expect(actualFiles).toEqual(expectedFiles);

    // Byte-compare each file against expected (markers with migration_commit:null are comparable directly)
    for (const rel of expectedFiles) {
      const expected = readFileSync(join(FIXTURE_EXPECTED, "specs", rel), "utf-8");
      const actual = readFileSync(join(work, "specs", rel), "utf-8");
      expect(actual).toBe(expected);
    }
  });

  test("dry-run writes to specs/.migration-preview/ and leaves live tree intact (AC-48.4)", async () => {
    const preBlob = (await $`git rev-parse HEAD`.cwd(work).text()).trim();
    const result = await migrate({
      repoRoot: work,
      mode: "dry-run",
      now: "2026-04-21T10:30:00Z",
    });
    expect(result.kind).toBe("dry-run");
    const postBlob = (await $`git rev-parse HEAD`.cwd(work).text()).trim();
    expect(postBlob).toBe(preBlob);
    expect(existsSync(join(work, "specs", ".migration-preview"))).toBe(true);
    expect(existsSync(join(work, "specs", ".dpt-layout"))).toBe(false);
  });

  test("rejects on dirty working tree (AC-48.3)", async () => {
    writeFileSync(join(work, "uncommitted.txt"), "dirty");
    await expect(
      migrate({ repoRoot: work, mode: "live", now: "2026-04-21T10:30:00Z" }),
    ).rejects.toThrow(/clean working tree|uncommitted/i);
  });

  test("idempotent on an already-v2 tree (AC-48.13)", async () => {
    // First migration
    await migrate({ repoRoot: work, mode: "live", now: "2026-04-21T10:30:00Z" });
    // Second call should be a no-op with a nothing-to-do message
    const result = await migrate({ repoRoot: work, mode: "live", now: "2026-04-21T10:30:00Z" });
    expect(result.kind).toBe("already-v2");
  });
});

describe("migrate — summary output (AC-48.12)", () => {
  test("returns counts: FRs migrated, milestones split, archived items converted, tag name", async () => {
    const result = await migrate({ repoRoot: work, mode: "live", now: "2026-04-21T10:30:00Z" });
    if (result.kind !== "migrated") throw new Error(`expected migrated kind, got ${result.kind}`);
    expect(result.summary.frsMigrated).toBe(3);
    expect(result.summary.milestonesSplit).toBe(1);
    expect(result.summary.archivedItemsConverted).toBe(2);
    expect(result.tag).toMatch(/^dpt-v1-snapshot-/);
  });
});
