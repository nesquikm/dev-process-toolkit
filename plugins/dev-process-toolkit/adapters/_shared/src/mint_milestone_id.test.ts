// STE-417 AC-STE-417.4 — minted tracker-less milestone ids route through
// `mintUniqueId({ exists })`.
//
// Contract pinned here:
//   - module: `adapters/_shared/src/mint_milestone_id.ts`
//   - `mintMilestoneId(specsDir)` → `{ id, milestoneId }` where `id` is the
//     FULL 29-char `fr_`-prefixed minted value (stored verbatim in plan
//     frontmatter) and `milestoneId` is `milestoneIdFromUlid(id)`.
//   - the `exists` predicate receives the FULL minted id — that is
//     `mintUniqueId`'s existing contract, it does NOT pass a derived tail —
//     and derives `M_${id.slice(23, 29)}` internally before probing the
//     filesystem.
//   - it reports true when EITHER `specs/plan/M_<tail>.md` OR
//     `specs/plan/archive/M_<tail>.md` exists, so a 6-char tail collision
//     re-mints instead of silently overwriting an existing plan.
//   - `mintUniqueId`'s 3-attempt budget is reused verbatim (no new scan
//     module): three consecutive collisions throw.
//   - minting is PURE — it never writes the plan file it names.
//
// Collision-fixture caveat (recorded in the FR Notes): under
// `DPT_TEST_ULID_SEED` the tail comes from a monotonic IN-PROCESS counter on
// `globalThis.__dpt_ulid_test_counter`, so consecutive mints yield DIFFERENT
// tails and the counter's value depends on test position in the file. Nothing
// below hard-codes a filename: every fixture derives the tail the next mint
// will actually produce by resetting the counter, minting, and resetting it
// again.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { milestoneIdFromUlid, PLAN_FILENAME_RE, parseMilestoneToken } from "./milestone_token";
import { mintMilestoneId } from "./mint_milestone_id";
import { nextFreeMilestoneNumber } from "./next_free_milestone_number";
import { stampShippedIn } from "./plan_ship_stamp";
import { mintId, ULID_REGEX } from "./ulid";

// ───────────────────────────────────────────────────────────────────────
// Fixtures
// ───────────────────────────────────────────────────────────────────────

const COUNTER_KEY = "__dpt_ulid_test_counter";
const SEED = "0K0K0K"; // valid Crockford, ≤ 10 chars

function resetCounter(): void {
  delete (globalThis as Record<string, unknown>)[COUNTER_KEY];
}

/** The exact id the NEXT `mintId()` will return, with the counter rewound. */
function peekNextMintedIds(count: number): string[] {
  resetCounter();
  const ids: string[] = [];
  for (let i = 0; i < count; i++) ids.push(mintId());
  resetCounter();
  return ids;
}

interface Fixture {
  root: string;
  specs: string;
  planDir: string;
  archiveDir: string;
  cleanup: () => void;
}

function makeFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "ste417-mint-"));
  const specs = join(root, "specs");
  const planDir = join(specs, "plan");
  const archiveDir = join(planDir, "archive");
  mkdirSync(archiveDir, { recursive: true });
  return {
    root,
    specs,
    planDir,
    archiveDir,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

const SENTINEL = "---\nstatus: active\n---\n\n# pre-existing plan — DO NOT OVERWRITE\n";

let stashedNodeEnv: string | undefined;
let stashedSeed: string | undefined;

beforeEach(() => {
  stashedNodeEnv = process.env["NODE_ENV"];
  stashedSeed = process.env["DPT_TEST_ULID_SEED"];
  process.env["NODE_ENV"] = "test";
  process.env["DPT_TEST_ULID_SEED"] = SEED;
  resetCounter();
});

afterEach(() => {
  if (stashedNodeEnv === undefined) delete process.env["NODE_ENV"];
  else process.env["NODE_ENV"] = stashedNodeEnv;
  if (stashedSeed === undefined) delete process.env["DPT_TEST_ULID_SEED"];
  else process.env["DPT_TEST_ULID_SEED"] = stashedSeed;
  resetCounter();
});

// ───────────────────────────────────────────────────────────────────────
// Happy path — no collision
// ───────────────────────────────────────────────────────────────────────

describe("AC-STE-417.4 — mintMilestoneId returns the minted id and its derived milestone id", () => {
  test("clean plan tree: the first mint is used verbatim", () => {
    const fx = makeFixture();
    try {
      const [expected] = peekNextMintedIds(1);
      const result = mintMilestoneId(fx.specs);
      expect(result.id).toBe(expected!);
      expect(ULID_REGEX.test(result.id)).toBe(true);
      expect(result.milestoneId).toBe(milestoneIdFromUlid(result.id));
      expect(parseMilestoneToken(result.milestoneId)).toEqual({
        kind: "epic",
        key: result.id.slice(23, 29),
      });
    } finally {
      fx.cleanup();
    }
  });

  test("minting is pure — it names the plan file but never writes it", () => {
    const fx = makeFixture();
    try {
      const result = mintMilestoneId(fx.specs);
      expect(PLAN_FILENAME_RE.test(`${result.milestoneId}.md`)).toBe(true);
      expect(existsSync(join(fx.planDir, `${result.milestoneId}.md`))).toBe(false);
    } finally {
      fx.cleanup();
    }
  });

  test("an absent specs/plan tree is not a collision — the first mint still wins", () => {
    const root = mkdtempSync(join(tmpdir(), "ste417-noplan-"));
    try {
      const [expected] = peekNextMintedIds(1);
      const result = mintMilestoneId(join(root, "specs"));
      expect(result.id).toBe(expected!);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ───────────────────────────────────────────────────────────────────────
// Forced collision — the reason the predicate exists
// ───────────────────────────────────────────────────────────────────────

describe("AC-STE-417.4 — a 6-char tail collision re-mints instead of overwriting", () => {
  test("active plan collision: the SECOND mint is used, the existing plan is byte-unchanged", () => {
    const fx = makeFixture();
    try {
      const [first, second] = peekNextMintedIds(2);
      const takenPath = join(fx.planDir, `${milestoneIdFromUlid(first!)}.md`);
      writeFileSync(takenPath, SENTINEL);

      const result = mintMilestoneId(fx.specs);

      expect(result.id).not.toBe(first!);
      expect(result.id).toBe(second!);
      expect(result.milestoneId).not.toBe(milestoneIdFromUlid(first!));
      expect(result.milestoneId).toBe(milestoneIdFromUlid(second!));
      // The pre-existing plan was never touched.
      expect(readFileSync(takenPath, "utf-8")).toBe(SENTINEL);
    } finally {
      fx.cleanup();
    }
  });

  test("ARCHIVED plan collision re-mints too — archive/ is probed alongside active", () => {
    const fx = makeFixture();
    try {
      const [first, second] = peekNextMintedIds(2);
      const takenPath = join(fx.archiveDir, `${milestoneIdFromUlid(first!)}.md`);
      writeFileSync(takenPath, SENTINEL);

      const result = mintMilestoneId(fx.specs);

      expect(result.id).toBe(second!);
      expect(result.milestoneId).toBe(milestoneIdFromUlid(second!));
      expect(readFileSync(takenPath, "utf-8")).toBe(SENTINEL);
    } finally {
      fx.cleanup();
    }
  });

  test("the predicate receives the FULL 29-char id and derives the tail itself", () => {
    // A file named after the RAW minted id is NOT a plan file, so it must not
    // read as a collision. Only `M_<tail>.md` counts. This is the assertion
    // that distinguishes "derives M_${id.slice(23, 29)} internally" from
    // "probes for whatever string it was handed".
    const fx = makeFixture();
    try {
      const [first] = peekNextMintedIds(1);
      writeFileSync(join(fx.planDir, `${first!}.md`), SENTINEL);

      const result = mintMilestoneId(fx.specs);

      expect(result.id).toBe(first!);
      expect(result.milestoneId).toBe(milestoneIdFromUlid(first!));
    } finally {
      fx.cleanup();
    }
  });

  test("three consecutive collisions exhaust mintUniqueId's budget and throw", () => {
    const fx = makeFixture();
    try {
      const taken = peekNextMintedIds(3);
      for (const id of taken) {
        writeFileSync(join(fx.planDir, `${milestoneIdFromUlid(id)}.md`), SENTINEL);
      }
      expect(() => mintMilestoneId(fx.specs)).toThrow(/collision/i);
      // Nothing was clobbered on the way out.
      for (const id of taken) {
        expect(readFileSync(join(fx.planDir, `${milestoneIdFromUlid(id)}.md`), "utf-8")).toBe(
          SENTINEL,
        );
      }
    } finally {
      fx.cleanup();
    }
  });
});

// ───────────────────────────────────────────────────────────────────────
// AC-STE-417.5 — coexistence: existing `M<N>` plans keep working
// ───────────────────────────────────────────────────────────────────────

describe("AC-STE-417.5 — minted and sequential plan ids coexist, no migration", () => {
  test("a minted plan does not bump the sequential counter (AC-STE-376.3 exclusion holds)", async () => {
    const fx = makeFixture();
    try {
      writeFileSync(join(fx.planDir, "M101.md"), "# M101 — Sequential milestone\n");
      writeFileSync(join(fx.archiveDir, "M99.md"), "# M99 — Archived milestone\n");
      const minted = mintMilestoneId(fx.specs);
      writeFileSync(
        join(fx.planDir, `${minted.milestoneId}.md`),
        `# ${minted.milestoneId} — Minted milestone\n`,
      );

      const r = await nextFreeMilestoneNumber(fx.specs);
      expect(r.next).toBe(102);
      expect(r.sources.active).toEqual([101]); // the minted plan is excluded
      expect(r.sources.archived).toEqual([99]);
    } finally {
      fx.cleanup();
    }
  });

  test("a minted plan file resolves and ships: parses, and /ship-milestone can stamp it", async () => {
    const fx = makeFixture();
    try {
      const minted = mintMilestoneId(fx.specs);
      const planPath = join(fx.planDir, `${minted.milestoneId}.md`);
      writeFileSync(
        planPath,
        [
          "---",
          `id: ${minted.id}`,
          `milestone: ${minted.milestoneId}`,
          "status: active",
          "shipped_in: null",
          "---",
          "",
          `# ${minted.milestoneId} — Minted milestone`,
          "",
        ].join("\n"),
      );
      expect(PLAN_FILENAME_RE.test(`${minted.milestoneId}.md`)).toBe(true);
      await stampShippedIn(planPath, "2.56.0");
      expect(readFileSync(planPath, "utf-8")).toContain("shipped_in: v2.56.0");
    } finally {
      fx.cleanup();
    }
  });

  test("the minted path never routes through nextFreeMilestoneNumber", () => {
    // Import + call shapes only — the module header is free to NAME the
    // bypass in prose, which is exactly what it should document.
    const src = readFileSync(join(import.meta.dir, "mint_milestone_id.ts"), "utf-8");
    expect(src).not.toMatch(/from\s+["'][^"']*next_free_milestone_number["']/);
    expect(src).not.toMatch(/\bnextFreeMilestoneNumber\s*\(/);
    // It DOES route through the shared minter + the shared derivation.
    expect(src).toContain("mintUniqueId");
    expect(src).toContain("milestoneIdFromUlid");
  });
});
