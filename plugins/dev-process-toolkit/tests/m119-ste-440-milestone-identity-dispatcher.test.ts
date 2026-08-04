// M119 STE-440 — the CODE half of "route /spec-write milestone allocation
// through a single identity dispatcher".
//
// AC map (module contract only; the doc/template/gate surfaces live in
// `tests/m119-ste-440-dispatcher-surfaces.test.ts`, deliberately split so a
// missing module here cannot hide those REDs behind a module-resolution
// error):
//
//   AC-STE-440.1 — `adapters/_shared/src/resolve_milestone_identity.ts`
//                  exports `resolveMilestoneIdentity(input)`; given
//                  `{ specsDir, mode, epicKey? }` it dispatches to
//                  `nextFreeMilestoneNumber` (linear) /
//                  `milestoneIdFromEpicKey` (jira) / `mintMilestoneId` (none)
//                  and returns `{ milestoneId, id? }`.
//   AC-STE-440.2 — mode: none returns `M_<6 Crockford>` + a `ULID_REGEX` `id`
//                  with `milestoneIdFromUlid(id) === milestoneId`, and NO
//                  input drives it to a sequential `M<N>` token.
//   AC-STE-440.3 — jira ⇒ `M_<sanitized-epic-key>`, no `id`; linear ⇒
//                  `M<next>` from the five-way scan, no `id`. Both asserted
//                  EQUAL to the pre-existing helper's output for the same
//                  input (byte-unchanged, not merely shaped alike).
//   AC-STE-440.4 — all three branches route through ONE `requireOrRefuse`
//                  gate site, differing only in `defaultValue`.
//
// ── The contract this file FIXES (the implementer must match these names) ──
//
//   export type MilestoneIdentityMode = "linear" | "jira" | "none";
//   export interface ResolveMilestoneIdentityInput {
//     specsDir: string;
//     mode: MilestoneIdentityMode;
//     epicKey?: string;
//     // Optional five-way-scan inputs, forwarded verbatim on the linear
//     // branch. They are NOT new behavior: dropping them would silently
//     // demote the "byte-unchanged" five-way scan of AC-STE-440.3 to a
//     // two-way one, which is the defect the equality assertions catch.
//     changelogPath?: string;
//     provider?: MilestoneListingProvider;
//     branchScanner?: BranchMilestoneScanner;
//   }
//   export interface MilestoneIdentity { milestoneId: string; id?: string }
//   export const MILESTONE_ALLOCATION_GATE_SITE = "milestone-allocation";
//   export function resolveMilestoneIdentity(
//     input: ResolveMilestoneIdentityInput,
//   ): Promise<MilestoneIdentity>;
//   export function milestoneAllocationGateSpec(
//     input: ResolveMilestoneIdentityInput,
//   ): Promise<{ gateSite: string; defaultValue: string; identity: MilestoneIdentity }>;
//
// `resolveMilestoneIdentity` is async because the linear branch delegates to
// the async five-way scan; the mint and Epic branches resolve immediately.
//
// Seeded-ULID caveat, inherited from `adapters/_shared/src/mint_milestone_id.test.ts`:
// under `DPT_TEST_ULID_SEED` the tail comes from a monotonic in-process
// counter on `globalThis.__dpt_ulid_test_counter`, so consecutive mints yield
// DIFFERENT tails. Nothing below hard-codes a tail — every expectation derives
// from the value the call actually returned, or from a rewound peek.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { milestoneIdFromEpicKey, milestoneIdFromUlid } from "../adapters/_shared/src/milestone_token";
import { mintMilestoneId } from "../adapters/_shared/src/mint_milestone_id";
import {
  nextFreeMilestoneNumber,
  type BranchMilestoneScanner,
  type MilestoneListingProvider,
} from "../adapters/_shared/src/next_free_milestone_number";
import { mintId, ULID_REGEX } from "../adapters/_shared/src/ulid";
import {
  MILESTONE_ALLOCATION_GATE_SITE,
  milestoneAllocationGateSpec,
  resolveMilestoneIdentity,
  type MilestoneIdentity,
  type ResolveMilestoneIdentityInput,
} from "../adapters/_shared/src/resolve_milestone_identity";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const MODULE_PATH = join(PLUGIN_ROOT, "adapters", "_shared", "src", "resolve_milestone_identity.ts");

/** Minted-milestone token grammar: `M_` + the 6-char Crockford ULID tail. */
const MINTED_TOKEN_RE = /^M_[0-9A-HJKMNP-TV-Z]{6}$/;
/** The sequential grammar the tracker-less branch must be incapable of emitting. */
const SEQUENTIAL_TOKEN_RE = /^M\d+$/;

// ───────────────────────────────────────────────────────────────────────
// Fixtures
// ───────────────────────────────────────────────────────────────────────

const COUNTER_KEY = "__dpt_ulid_test_counter";
const SEED = "0K0K0K"; // valid Crockford, ≤ 10 chars

function resetCounter(): void {
  delete (globalThis as Record<string, unknown>)[COUNTER_KEY];
}

/** The exact ids the NEXT `mintId()` calls will return, counter rewound. */
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
  changelog: string;
  cleanup: () => void;
}

/**
 * A specs tree with a visible sequential history: a sequential allocator
 * looking at it answers 102. Every `mode: none` assertion below runs against
 * this same tree, so "the mint ignored the sequence" is observable rather
 * than vacuous.
 */
function makeFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "ste440-dispatch-"));
  const specs = join(root, "specs");
  const planDir = join(specs, "plan");
  const archiveDir = join(planDir, "archive");
  mkdirSync(archiveDir, { recursive: true });
  writeFileSync(join(planDir, "M101.md"), "# M101 — Sequential milestone\n");
  writeFileSync(join(archiveDir, "M99.md"), "# M99 — Archived milestone\n");
  const changelog = join(root, "CHANGELOG.md");
  writeFileSync(changelog, "# Changelog\n\nM100 shipped.\n");
  return {
    root,
    specs,
    planDir,
    archiveDir,
    changelog,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function makeProvider(names: string[]): MilestoneListingProvider {
  return { listMilestones: async () => names.map((name) => ({ name })) };
}

function makeBranchScanner(numbers: number[]): BranchMilestoneScanner {
  return { listBranchMilestones: async () => [...numbers] };
}

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
// AC-STE-440.1 — one dispatcher, three delegated branches
// ───────────────────────────────────────────────────────────────────────

describe("AC-STE-440.1 — resolveMilestoneIdentity dispatches by mode", () => {
  test("the module ships at the specified path and exports the dispatcher", () => {
    expect(typeof resolveMilestoneIdentity).toBe("function");
    expect(readFileSync(MODULE_PATH, "utf-8").length).toBeGreaterThan(0);
  });

  test("it is a ROUTER: it delegates to the three owning helpers, never re-implements them", () => {
    // The Technical Design's load-bearing claim — "a thin router, not a
    // reimplementation" — is what keeps the five-way scan, the Epic-key
    // derivation and the collision-guarded minter on their own tests. A
    // dispatcher that inlined any of them would pass the value assertions
    // below and silently fork the semantics on the next edit.
    const src = readFileSync(MODULE_PATH, "utf-8");
    expect(src).toMatch(/from\s+["']\.\/next_free_milestone_number["']/);
    expect(src).toMatch(/from\s+["']\.\/mint_milestone_id["']/);
    expect(src).toMatch(/from\s+["']\.\/milestone_token["']/);
    expect(src).toMatch(/\bnextFreeMilestoneNumber\s*\(/);
    expect(src).toMatch(/\bmintMilestoneId\s*\(/);
    expect(src).toMatch(/\bmilestoneIdFromEpicKey\s*\(/);
    // Re-implementation tells: the minter's own primitives must not appear
    // here (they belong to `mint_milestone_id.ts`).
    expect(src).not.toMatch(/\bmintUniqueId\s*\(/);
    expect(src).not.toMatch(/\breaddirSync\s*\(/);
  });

  test("mode: linear returns a sequential milestoneId and no `id`", async () => {
    const fx = makeFixture();
    try {
      const r = await resolveMilestoneIdentity({ specsDir: fx.specs, mode: "linear" });
      expect(r.milestoneId).toBe("M102");
      expect(r.id).toBeUndefined();
    } finally {
      fx.cleanup();
    }
  });

  test("mode: jira returns the Epic-derived milestoneId and no `id`", async () => {
    const fx = makeFixture();
    try {
      const r = await resolveMilestoneIdentity({
        specsDir: fx.specs,
        mode: "jira",
        epicKey: "PROJ-500",
      });
      expect(r.milestoneId).toBe("M_PROJ_500");
      expect(r.id).toBeUndefined();
    } finally {
      fx.cleanup();
    }
  });

  test("mode: none returns a minted milestoneId AND the full minted `id`", async () => {
    const fx = makeFixture();
    try {
      const [expected] = peekNextMintedIds(1);
      const r = await resolveMilestoneIdentity({ specsDir: fx.specs, mode: "none" });
      expect(r.id).toBe(expected!);
      expect(r.milestoneId).toBe(milestoneIdFromUlid(expected!));
    } finally {
      fx.cleanup();
    }
  });
});

// ───────────────────────────────────────────────────────────────────────
// AC-STE-440.2 — mode: none is STRUCTURALLY incapable of a sequential token
// ───────────────────────────────────────────────────────────────────────

describe("AC-STE-440.2 — mode: none mints a ULID-derived identity", () => {
  test("the returned shape is `M_<6 Crockford>` + a ULID_REGEX id that derives it", async () => {
    const fx = makeFixture();
    try {
      const r = await resolveMilestoneIdentity({ specsDir: fx.specs, mode: "none" });
      expect(r.milestoneId).toMatch(MINTED_TOKEN_RE);
      expect(r.id).toBeDefined();
      expect(ULID_REGEX.test(r.id!)).toBe(true);
      expect(milestoneIdFromUlid(r.id!)).toBe(r.milestoneId);
    } finally {
      fx.cleanup();
    }
  });

  test("it delegates to mintMilestoneId verbatim (same tree ⇒ same next minted id)", async () => {
    const fx = makeFixture();
    try {
      const [expected] = peekNextMintedIds(1);
      const direct = mintMilestoneId(fx.specs);
      expect(direct.id).toBe(expected!);

      resetCounter();
      const viaDispatcher = await resolveMilestoneIdentity({ specsDir: fx.specs, mode: "none" });
      expect(viaDispatcher).toEqual({ id: direct.id, milestoneId: direct.milestoneId });
    } finally {
      fx.cleanup();
    }
  });

  test("NEGATIVE: no input drives mode: none to a sequential `M<N>` token", async () => {
    // The Testing section calls this out as its own case: asserting the
    // positive shape alone would pass a dispatcher that fell THROUGH to the
    // sequential branch on an unexpected input. Every case below sits on a
    // tree/provider/branch set whose sequential answer is a real number, so a
    // fall-through is observable, not theoretical.
    const fx = makeFixture();
    const emptyRoot = mkdtempSync(join(tmpdir(), "ste440-empty-"));
    const emptySpecs = join(emptyRoot, "specs");
    mkdirSync(join(emptySpecs, "plan"), { recursive: true });
    try {
      const inputs: ResolveMilestoneIdentityInput[] = [
        // 1. the ordinary case, on a tree whose sequential answer is M102
        { specsDir: fx.specs, mode: "none" },
        // 2. an empty tree — the sequential answer would be M1
        { specsDir: emptySpecs, mode: "none" },
        // 3. a specsDir that does not exist at all
        { specsDir: join(emptyRoot, "nope", "specs"), mode: "none" },
        // 4. an Epic key supplied under mode: none (wrong-branch bait)
        { specsDir: fx.specs, mode: "none", epicKey: "PROJ-500" },
        // 5. an EMPTY Epic key — the jira branch would throw on this
        { specsDir: fx.specs, mode: "none", epicKey: "" },
        // 6. every five-way-scan input supplied, all answering high
        {
          specsDir: fx.specs,
          mode: "none",
          changelogPath: fx.changelog,
          provider: makeProvider(["M900 — tracker"]),
          branchScanner: makeBranchScanner([1234]),
        },
        // 7. unexpected extra fields (a caller spreading a wider object)
        {
          specsDir: fx.specs,
          mode: "none",
          next: 102,
          milestone: "M102",
        } as unknown as ResolveMilestoneIdentityInput,
      ];

      for (const [i, input] of inputs.entries()) {
        const r = await resolveMilestoneIdentity(input);
        const where = `input #${i + 1}`;
        expect(r.milestoneId, where).toMatch(MINTED_TOKEN_RE);
        expect(SEQUENTIAL_TOKEN_RE.test(r.milestoneId), where).toBe(false);
        expect(r.milestoneId, where).not.toBe("M102");
        expect(r.milestoneId, where).not.toBe("M1");
        expect(r.id, where).toBeDefined();
        expect(ULID_REGEX.test(r.id!), where).toBe(true);
        expect(milestoneIdFromUlid(r.id!), where).toBe(r.milestoneId);
      }
    } finally {
      fx.cleanup();
      rmSync(emptyRoot, { recursive: true, force: true });
    }
  });

  test("an Epic key under mode: none is IGNORED, never used to derive the id", async () => {
    const fx = makeFixture();
    try {
      const r = await resolveMilestoneIdentity({
        specsDir: fx.specs,
        mode: "none",
        epicKey: "PROJ-500",
      });
      expect(r.milestoneId).not.toBe("M_PROJ_500");
      expect(r.milestoneId).toMatch(MINTED_TOKEN_RE);
    } finally {
      fx.cleanup();
    }
  });
});

// ───────────────────────────────────────────────────────────────────────
// AC-STE-440.3 — jira + linear are byte-unchanged, asserted by EQUALITY
// against the helper each branch delegates to
// ───────────────────────────────────────────────────────────────────────

describe("AC-STE-440.3 — the jira branch equals milestoneIdFromEpicKey", () => {
  for (const key of ["PROJ-500", "DST-49", "PROJ_500", "ABC-1"]) {
    test(`epicKey ${JSON.stringify(key)} ⇒ the sanitizer's own output, id absent`, async () => {
      const fx = makeFixture();
      try {
        const r = await resolveMilestoneIdentity({ specsDir: fx.specs, mode: "jira", epicKey: key });
        expect(r.milestoneId).toBe(milestoneIdFromEpicKey(key));
        expect(r.id).toBeUndefined();
      } finally {
        fx.cleanup();
      }
    });
  }

  test("the sanitizer's never-a-silent-bad-id contract survives the dispatch (empty key throws)", async () => {
    const fx = makeFixture();
    try {
      await expect(
        resolveMilestoneIdentity({ specsDir: fx.specs, mode: "jira", epicKey: "" }),
      ).rejects.toThrow();
    } finally {
      fx.cleanup();
    }
  });

  test("the jira branch never runs the sequential scan", async () => {
    const fx = makeFixture();
    const calls: string[] = [];
    try {
      const provider: MilestoneListingProvider = {
        listMilestones: async () => {
          calls.push("listMilestones");
          return [{ name: "M900 — tracker" }];
        },
      };
      const scanner: BranchMilestoneScanner = {
        listBranchMilestones: async () => {
          calls.push("listBranchMilestones");
          return [1234];
        },
      };
      const r = await resolveMilestoneIdentity({
        specsDir: fx.specs,
        mode: "jira",
        epicKey: "PROJ-500",
        changelogPath: fx.changelog,
        provider,
        branchScanner: scanner,
      });
      expect(r.milestoneId).toBe("M_PROJ_500");
      expect(calls).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });
});

describe("AC-STE-440.3 — the linear branch equals the five-way scan's own answer", () => {
  test("bare call: dispatcher output === `M${nextFreeMilestoneNumber(specsDir).next}`", async () => {
    const fx = makeFixture();
    try {
      const helper = await nextFreeMilestoneNumber(fx.specs);
      const r = await resolveMilestoneIdentity({ specsDir: fx.specs, mode: "linear" });
      expect(r.milestoneId).toBe(`M${helper.next}`);
      expect(r.id).toBeUndefined();
    } finally {
      fx.cleanup();
    }
  });

  test("ALL FIVE scan legs are forwarded: dispatcher === helper given the same four args", async () => {
    // A dispatcher that forgot to forward `changelogPath` / `provider` /
    // `branchScanner` still returns an `M<N>` and still passes a
    // shape-only assertion — it just silently demotes the five-way scan to a
    // two-way one. Only equality against the fully-armed helper catches that,
    // and each leg below is the sole source of its own number.
    const fx = makeFixture();
    try {
      const args = {
        changelogPath: fx.changelog,
        providerNames: ["M900 — tracker milestone"],
        branchNumbers: [1234],
      };
      const helper = await nextFreeMilestoneNumber(
        fx.specs,
        args.changelogPath,
        makeProvider(args.providerNames),
        makeBranchScanner(args.branchNumbers),
      );
      expect(helper.next).toBe(1235); // branches leg dominates
      expect(helper.sources).toEqual({
        active: [101],
        archived: [99],
        changelog: [100],
        tracker: [900],
        branches: [1234],
      });

      const r = await resolveMilestoneIdentity({
        specsDir: fx.specs,
        mode: "linear",
        changelogPath: args.changelogPath,
        provider: makeProvider(args.providerNames),
        branchScanner: makeBranchScanner(args.branchNumbers),
      });
      expect(r.milestoneId).toBe(`M${helper.next}`);
      expect(r.milestoneId).toBe("M1235");
      expect(r.id).toBeUndefined();
    } finally {
      fx.cleanup();
    }
  });

  test("an empty specs tree still allocates M1 (the helper's edge case is preserved)", async () => {
    const root = mkdtempSync(join(tmpdir(), "ste440-linear-empty-"));
    try {
      const specs = join(root, "specs");
      mkdirSync(join(specs, "plan"), { recursive: true });
      const helper = await nextFreeMilestoneNumber(specs);
      const r = await resolveMilestoneIdentity({ specsDir: specs, mode: "linear" });
      expect(helper.next).toBe(1);
      expect(r.milestoneId).toBe("M1");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("the linear branch never mints — no `id` leaks into a tracker-mode plan", async () => {
    const fx = makeFixture();
    try {
      const r: MilestoneIdentity = await resolveMilestoneIdentity({
        specsDir: fx.specs,
        mode: "linear",
      });
      // Probe #73 fails any tracker-mode plan carrying `id:`, so an `id` here
      // would turn the very next gate red rather than merely being unused.
      expect(r.id).toBeUndefined();
      expect("id" in r ? r.id : undefined).toBeUndefined();
    } finally {
      fx.cleanup();
    }
  });
});

// ───────────────────────────────────────────────────────────────────────
// AC-STE-440.4 — one gate site, three defaultValues
// ───────────────────────────────────────────────────────────────────────

describe("AC-STE-440.4 — all three branches share ONE requireOrRefuse gate site", () => {
  test("the gate site is the canonical `milestone-allocation` identifier", () => {
    expect(MILESTONE_ALLOCATION_GATE_SITE).toBe("milestone-allocation");
  });

  test("the gate site identifier is IDENTICAL across the three modes", async () => {
    const fx = makeFixture();
    try {
      const linear = await milestoneAllocationGateSpec({ specsDir: fx.specs, mode: "linear" });
      const jira = await milestoneAllocationGateSpec({
        specsDir: fx.specs,
        mode: "jira",
        epicKey: "PROJ-500",
      });
      const none = await milestoneAllocationGateSpec({ specsDir: fx.specs, mode: "none" });

      expect(linear.gateSite).toBe(MILESTONE_ALLOCATION_GATE_SITE);
      expect(jira.gateSite).toBe(linear.gateSite);
      expect(none.gateSite).toBe(linear.gateSite);
    } finally {
      fx.cleanup();
    }
  });

  test("the branches differ ONLY in defaultValue (the identity feeds it, nothing else)", async () => {
    // The Technical Design's reason this FR does not inline three calls at the
    // call site: an off-gate branch is the silent no-op the gate exists to
    // prevent. Strip defaultValue + identity and the three specs must be
    // indistinguishable.
    const fx = makeFixture();
    try {
      const specs = [
        await milestoneAllocationGateSpec({ specsDir: fx.specs, mode: "linear" }),
        await milestoneAllocationGateSpec({
          specsDir: fx.specs,
          mode: "jira",
          epicKey: "PROJ-500",
        }),
        await milestoneAllocationGateSpec({ specsDir: fx.specs, mode: "none" }),
      ];

      const shapeOf = (s: (typeof specs)[number]): string[] => Object.keys(s).sort();
      expect(shapeOf(specs[1]!)).toEqual(shapeOf(specs[0]!));
      expect(shapeOf(specs[2]!)).toEqual(shapeOf(specs[0]!));

      const withoutVarying = (s: (typeof specs)[number]): Record<string, unknown> => {
        const rest = { ...(s as unknown as Record<string, unknown>) };
        delete rest["defaultValue"];
        delete rest["identity"];
        return rest;
      };
      expect(withoutVarying(specs[1]!)).toEqual(withoutVarying(specs[0]!));
      expect(withoutVarying(specs[2]!)).toEqual(withoutVarying(specs[0]!));

      // ...and defaultValue is exactly the resolved milestone id, per mode.
      expect(specs[0]!.defaultValue).toBe("M102");
      expect(specs[1]!.defaultValue).toBe("M_PROJ_500");
      expect(specs[2]!.defaultValue).toMatch(MINTED_TOKEN_RE);
      for (const s of specs) expect(s.defaultValue).toBe(s.identity.milestoneId);

      // Three distinct defaults — a gate that collapsed them would be a
      // dispatcher that never dispatched.
      expect(new Set(specs.map((s) => s.defaultValue)).size).toBe(3);
    } finally {
      fx.cleanup();
    }
  });

  test("the gate spec carries the mode: none `id` through, so the plan can record it", async () => {
    const fx = makeFixture();
    try {
      const none = await milestoneAllocationGateSpec({ specsDir: fx.specs, mode: "none" });
      expect(none.identity.id).toBeDefined();
      expect(ULID_REGEX.test(none.identity.id!)).toBe(true);
      expect(milestoneIdFromUlid(none.identity.id!)).toBe(none.defaultValue);
    } finally {
      fx.cleanup();
    }
  });
});
