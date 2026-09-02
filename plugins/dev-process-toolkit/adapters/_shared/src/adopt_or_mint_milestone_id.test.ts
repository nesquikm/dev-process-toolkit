// M138 STE-538 AC-STE-538.1 — `adoptOrMintMilestoneId(specsDir)` adopts the
// identity `/setup` already recorded on the bootstrap plan, and mints a fresh
// one ONLY when there is nothing to adopt.
//
// THE DEFECT this closes. Since STE-537, `/setup` step 8 under `mode: none`
// mints a milestone identity and names the bootstrap plan after it
// (`specs/plan/M_<tail>.md`, recording the full `fr_`-prefixed value as `id:`).
// `/spec-write` then minted a SECOND identity through
// `resolve_milestone_identity.ts`'s `none` branch and renamed that plan from one
// opaque name to another — for nothing. The identity recorded INSIDE the file
// then disagreed with the one that named it until `consumeScaffoldPlan`
// overwrote it.
//
// WHY EVERY ABSENCE HERE IS A CALL COUNT. A second mint leaves NO trace in the
// outcome: both mints produce a well-formed `M_<6-char Crockford>` name and a
// well-formed `id:`, and the survivor is self-consistent either way. Probe #73
// reports clean on both. So "it did not mint twice" is unobservable from the
// files on disk, and the only falsifiable form of the assertion is a counter on
// the injected minter. `countingMinter()` below is that counter; every
// `calls === 0` in this file is paired with a `calls === 1` on the SAME double,
// because a zero on a double nothing ever reached proves only that nothing ran.

import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { milestoneIdFromUlid } from "./milestone_token";
import { mintMilestoneId } from "./mint_milestone_id";
import { ULID_REGEX } from "./ulid";

// ───────────────────────────────────────────────────────────────────────────
// Module under test — loaded dynamically so a missing module reports the
// CONTRACT it fails to satisfy rather than a bare resolver stack trace.
// ───────────────────────────────────────────────────────────────────────────

const MODULE_SRC = join(import.meta.dir, "adopt_or_mint_milestone_id.ts");
const REPO_ROOT = join(import.meta.dir, "..", "..", "..", "..", "..");

interface MintedMilestoneId {
  id: string;
  milestoneId: string;
}

type MilestoneMinter = (specsDir: string) => MintedMilestoneId;

interface AdoptModule {
  adoptOrMintMilestoneId(specsDir: string, mint?: MilestoneMinter): MintedMilestoneId;
}

async function loadAdoptModule(): Promise<AdoptModule> {
  if (!existsSync(MODULE_SRC)) {
    throw new Error(
      `${relative(REPO_ROOT, MODULE_SRC)} does not exist — /spec-write's tracker-less branch has ` +
        `nothing to adopt WITH, so it mints a second identity over the one /setup already ` +
        `recorded on the bootstrap plan.`,
    );
  }
  const mod = (await import(MODULE_SRC)) as Partial<AdoptModule>;
  if (typeof mod.adoptOrMintMilestoneId !== "function") {
    throw new Error(
      `${relative(REPO_ROOT, MODULE_SRC)} does not export adoptOrMintMilestoneId()`,
    );
  }
  return mod as AdoptModule;
}

// ───────────────────────────────────────────────────────────────────────────
// Fixtures
// ───────────────────────────────────────────────────────────────────────────

/**
 * A well-formed minted id and the milestone token it derives. Hard-coded rather
 * than minted so the ADOPTED value can be compared byte-for-byte against a
 * literal the production code never produced.
 */
const FIXTURE_ID = "fr_01K9ZQ8XJ4VDTAF4VDTAF4VDTA";
const FIXTURE_TOKEN = "M_F4VDTA";

interface Fixture {
  root: string;
  specsDir: string;
  planDir: string;
  cleanup: () => void;
}

function makeFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "ste538-adopt-"));
  const specsDir = join(root, "specs");
  const planDir = join(specsDir, "plan");
  mkdirSync(join(planDir, "archive"), { recursive: true });
  return {
    root,
    specsDir,
    planDir,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

/** A plan file as `/setup` step 8 (or a legacy author) leaves it. */
function planSource(opts: { milestoneId: string; id?: string; kind?: string }): string {
  const fm = ["---", `milestone: ${opts.milestoneId}`, "status: active", "archived_at: null"];
  if (opts.id !== undefined) fm.push(`id: ${opts.id}`);
  if (opts.kind !== undefined) fm.push(`kind: ${opts.kind}`);
  fm.push("---");
  return [
    ...fm,
    "",
    "# Implementation Plan",
    "",
    `## ${opts.milestoneId} — Foundation / Scaffolding {#${opts.milestoneId}}`,
    "",
    "| FR | Title | Tracker |",
    "|----|-------|---------|",
    "| <scaffolding> | Bootstrap | n/a |",
    "",
  ].join("\n");
}

interface CountingMinter extends MilestoneMinter {
  /** How many times the real minter was actually reached. */
  calls: number;
}

/**
 * A REAL minter wrapping `mintMilestoneId`, carrying a call counter.
 *
 * Deliberately not a stub returning a canned value: a stub would make the
 * "mints fresh" legs pass on a module that returned the stub's constant without
 * ever consulting `specsDir`, and would decouple the returned id from the
 * collision guard the real minter owns.
 */
function countingMinter(): CountingMinter {
  const fn = ((specsDir: string) => {
    fn.calls += 1;
    return mintMilestoneId(specsDir);
  }) as CountingMinter;
  fn.calls = 0;
  return fn;
}

/** Every `id:` value recorded anywhere under `specs/plan/**`. */
function recordedIds(planDir: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of existsSync(dir) ? readdirSync(dir) : []) {
      const full = join(dir, name);
      if (name === "archive") {
        walk(full);
        continue;
      }
      if (!name.endsWith(".md")) continue;
      for (const line of readFileSync(full, "utf-8").split("\n")) {
        const m = /^id:\s*(\S+)/.exec(line);
        if (m !== null) out.push(m[1]!);
      }
    }
  };
  walk(planDir);
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// AC-STE-538.1 — adopt when there is exactly one eligible scaffold, else mint
// ═══════════════════════════════════════════════════════════════════════════

describe("AC-STE-538.1 — adoptOrMintMilestoneId adopts the recorded id, or mints", () => {
  test("one `kind: scaffolding` plan carrying a well-formed id: is ADOPTED, and the same double mints on an empty tree", async () => {
    const mod = await loadAdoptModule();
    const double = countingMinter();

    // ── Leg 1: the adoption path. ──────────────────────────────────────────
    const adopting = makeFixture();
    try {
      writeFileSync(
        join(adopting.planDir, `${FIXTURE_TOKEN}.md`),
        planSource({ milestoneId: FIXTURE_TOKEN, id: FIXTURE_ID, kind: "scaffolding" }),
      );

      const adopted = mod.adoptOrMintMilestoneId(adopting.specsDir, double);

      // BOTH halves of the pair, not just the id: a module that adopted the id
      // but re-derived the token from a fresh mint would still be minting.
      expect(adopted.id).toBe(FIXTURE_ID);
      expect(adopted.milestoneId).toBe(milestoneIdFromUlid(FIXTURE_ID));
      expect(adopted.milestoneId).toBe(FIXTURE_TOKEN);
      expect(double.calls).toBe(0);
    } finally {
      adopting.cleanup();
    }

    // ── Leg 2: the positive control for that zero. SAME double. ────────────
    const empty = makeFixture();
    try {
      const minted = mod.adoptOrMintMilestoneId(empty.specsDir, double);

      expect(minted.id).toMatch(ULID_REGEX);
      expect(minted.id).not.toBe(FIXTURE_ID);
      expect(minted.milestoneId).toBe(milestoneIdFromUlid(minted.id));
      // The counter CAN move on this harness — so leg 1's zero is a measurement.
      expect(double.calls).toBe(1);
    } finally {
      empty.cleanup();
    }
  });

  test("`kind: legacy` plus a well-formed id: MINTS — adoption keys on the kind, not on the mere presence of an id:", async () => {
    const mod = await loadAdoptModule();
    const double = countingMinter();
    const fx = makeFixture();
    try {
      writeFileSync(
        join(fx.planDir, "M1.md"),
        planSource({ milestoneId: "M1", id: FIXTURE_ID, kind: "legacy" }),
      );

      const result = mod.adoptOrMintMilestoneId(fx.specsDir, double);

      expect(double.calls).toBe(1);
      expect(result.id).not.toBe(FIXTURE_ID);
      expect(result.milestoneId).not.toBe(FIXTURE_TOKEN);
      expect(result.id).toMatch(ULID_REGEX);
    } finally {
      fx.cleanup();
    }
  });

  test("ISOLATION CONTROL — delete only the id: line from the adopting fixture and the same call mints", async () => {
    // One line separates this fixture from the adopting one above: the `kind:`,
    // the filename, the body and the harness are identical. So the adoption
    // clause is what fired there, not the presence of a plan file.
    const mod = await loadAdoptModule();
    const double = countingMinter();
    const fx = makeFixture();
    try {
      const withId = planSource({
        milestoneId: FIXTURE_TOKEN,
        id: FIXTURE_ID,
        kind: "scaffolding",
      });
      const withoutId = withId
        .split("\n")
        .filter((line) => !line.startsWith("id:"))
        .join("\n");
      // Non-vacuity: the deletion really removed something.
      expect(withoutId.split("\n").length).toBe(withId.split("\n").length - 1);
      expect(withoutId).toContain("kind: scaffolding");

      writeFileSync(join(fx.planDir, `${FIXTURE_TOKEN}.md`), withoutId);

      const result = mod.adoptOrMintMilestoneId(fx.specsDir, double);

      expect(double.calls).toBe(1);
      expect(result.id).toMatch(ULID_REGEX);
      expect(recordedIds(fx.planDir)).not.toContain(result.id);
    } finally {
      fx.cleanup();
    }
  });

  test("a malformed recorded id: is NOT adopted — it mints rather than deriving a token from garbage", async () => {
    // `milestoneIdFromUlid` throws on a value outside `ULID_REGEX`. Adopting
    // one would turn a repairable frontmatter typo into a hard crash in
    // /spec-write's allocation gate, so the shape check gates the adoption.
    const mod = await loadAdoptModule();
    const double = countingMinter();
    const fx = makeFixture();
    try {
      writeFileSync(
        join(fx.planDir, `${FIXTURE_TOKEN}.md`),
        planSource({ milestoneId: FIXTURE_TOKEN, id: "fr_NOT-A-ULID", kind: "scaffolding" }),
      );

      const result = mod.adoptOrMintMilestoneId(fx.specsDir, double);

      expect(double.calls).toBe(1);
      expect(result.id).toMatch(ULID_REGEX);
      expect(result.id).not.toBe("fr_NOT-A-ULID");
    } finally {
      fx.cleanup();
    }
  });

  test("the one-argument signature adopts too — the default minter is a seam, not a required argument", async () => {
    // AC-STE-538.1 names `adoptOrMintMilestoneId(specsDir)`. If the default
    // parameter were missing, every production call site would have to thread a
    // minter and the seam would stop being optional.
    const mod = await loadAdoptModule();
    const fx = makeFixture();
    try {
      writeFileSync(
        join(fx.planDir, `${FIXTURE_TOKEN}.md`),
        planSource({ milestoneId: FIXTURE_TOKEN, id: FIXTURE_ID, kind: "scaffolding" }),
      );

      const adopted = mod.adoptOrMintMilestoneId(fx.specsDir);

      expect(adopted.id).toBe(FIXTURE_ID);
      expect(adopted.milestoneId).toBe(FIXTURE_TOKEN);
    } finally {
      fx.cleanup();
    }
  });

  test("adoption is PURE — it reads the scaffold and never renames or rewrites it", async () => {
    // Renaming belongs to `consumeScaffoldPlan`. If adoption also touched the
    // file, the two would have to agree about ordering forever after.
    const mod = await loadAdoptModule();
    const fx = makeFixture();
    try {
      const path = join(fx.planDir, `${FIXTURE_TOKEN}.md`);
      const raw = planSource({ milestoneId: FIXTURE_TOKEN, id: FIXTURE_ID, kind: "scaffolding" });
      writeFileSync(path, raw);

      mod.adoptOrMintMilestoneId(fx.specsDir, countingMinter());

      expect(readFileSync(path, "utf-8")).toBe(raw);
      // Both sides go through the same default (UTF-16) comparator, so this is an
      // exact set comparison: a rename, an extra file, or a vanished scaffold all
      // break it. Do NOT hand-write the literal in "alphabetical" order — "M" (77)
      // sorts before "a" (97), so ["archive", ...] is unreachable.
      expect(readdirSync(fx.planDir).sort()).toEqual([`${FIXTURE_TOKEN}.md`, "archive"].sort());
    } finally {
      fx.cleanup();
    }
  });
});
