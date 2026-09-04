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
//                  `mintMilestoneLinear` (linear) /
//                  `milestoneIdFromEpicKey` (jira) / `mintMilestoneId` (none)
//                  and returns `{ milestoneId, id? }`.
//   AC-STE-440.2 — mode: none returns `M_<6 Crockford>` + a `ULID_REGEX` `id`
//                  with `milestoneIdFromUlid(id) === milestoneId`, and NO
//                  input drives it to a sequential `M<N>` token.
//   AC-STE-440.3 — jira ⇒ `M_<sanitized-epic-key>`, no `id`; linear ⇒
//                  `M_<6 hex>` from `mintMilestoneLinear`, no `id`. Both
//                  asserted EQUAL to the owning helper's output for the same
//                  input (delegated, not merely shaped alike).
//
//                  RETARGETED (M139 STE-541, AC-STE-541.6). The linear arm read
//                  "`M<next>` from the five-way scan … byte-unchanged": it was
//                  the code half of AC-STE-417.5's Linear-unchanged regression
//                  pin, retired by name in `specs/plan/M139.md`. THE
//                  BEHAVIOURAL CHANGE, stated once for every leg below:
//                  `mode: linear` no longer resolves an identity OFFLINE. The
//                  sequential scan needed no tracker; `mintMilestoneLinear`
//                  requires a provider carrying the milestone-create op,
//                  because an identity derived from a tracker object cannot be
//                  computed without the tracker. Every leg is retargeted onto
//                  the new contract (mint-equality, or the throw) rather than
//                  deleted — a deleted assertion is coverage lost.
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
//     // VESTIGIAL since M139/STE-541: the linear branch mints, so nothing
//     // reads these. They stay on the input type so existing callers keep
//     // type-checking; `project` / `title` / a create-carrying `provider` are
//     // what the branch reads now.
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
// the async tracker mint (the async five-way scan, before M139/STE-541); the
// mint and Epic branches resolve immediately.
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
import {
  milestoneIdFromEpicKey,
  milestoneIdFromLinearMilestone,
  milestoneIdFromUlid,
} from "../adapters/_shared/src/milestone_token";
import { mintMilestoneId } from "../adapters/_shared/src/mint_milestone_id";
import { mintMilestoneLinear } from "../adapters/_shared/src/mint_milestone_linear";
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

/** A stable Linear milestone identifier, and a second one to discriminate against. */
const LINEAR_UUID = "550e8400-e29b-41d4-a716-446655440000";
const LINEAR_UUID_2 = "9f1c2d3e-4b5a-6c7d-8e9f-0a1b2c3d4e5f";

/**
 * A milestone provider whose create allocates `uuid`, recording every call.
 *
 * ADDED M139/STE-541: the linear branch mints instead of scanning, so its legs
 * need a create-carrying provider. `listMilestones` returns `[]` so the mint's
 * find-before-create leg misses and the create runs.
 */
function makeMintingProvider(uuid: string): {
  provider: {
    createMilestone: (project: string, opts: { name: string }) => Promise<{ id: string }>;
    listMilestones: (project: string) => Promise<{ name: string; id?: string }[]>;
  };
  creates: { project: string; name: string }[];
} {
  const creates: { project: string; name: string }[] = [];
  return {
    creates,
    provider: {
      createMilestone: async (project: string, opts: { name: string }) => {
        creates.push({ project, name: opts.name });
        return { id: uuid };
      },
      listMilestones: async (_project: string) => [] as { name: string; id?: string }[],
    },
  };
}

/** The linear branch's inputs, minus `specsDir` — which it no longer reads. */
function linearInput(uuid: string): {
  mode: "linear";
  project: string;
  title: string;
  provider: ReturnType<typeof makeMintingProvider>["provider"];
} {
  return {
    mode: "linear",
    project: "DPT",
    title: "Tracker-First Linear Milestones",
    provider: makeMintingProvider(uuid).provider,
  };
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
    // derivation and the tracker-less allocator on their own tests. A
    // dispatcher that inlined any of them would pass the value assertions
    // below and silently fork the semantics on the next edit.
    //
    // The `none` branch's OWNING HELPER MOVED (M138/STE-538): it delegates to
    // `adoptOrMintMilestoneId`, which adopts the identity `/setup` step 8 already
    // recorded on the bootstrap plan and falls back to the collision-guarded
    // `mintMilestoneId` itself. The router invariant is untouched — only the
    // name of the helper that owns the branch — so the two `none` greps follow
    // the delegation one hop out. The linear and jira greps are unchanged.
    //
    // The `linear` branch's OWNING HELPER MOVED TOO (M139/STE-541): it delegates
    // to `mintMilestoneLinear`, because `mode: linear` no longer resolves an
    // identity OFFLINE — an identity derived from a tracker object cannot be
    // computed without the tracker. The two `linear` greps follow the
    // delegation to its new owner, and the negative below is the REPLACEMENT
    // for the retired `nextFreeMilestoneNumber(` grep: the router must not call
    // the displaced allocator at all. That is a strictly stronger claim than
    // the positive it replaces (behavioural coverage lives in
    // `tests/m139-ste-541-linear-minted-milestone.test.ts`, AC-STE-541.1).
    const src = readFileSync(MODULE_PATH, "utf-8");
    expect(src).toMatch(/from\s+["']\.\/mint_milestone_linear["']/);
    expect(src).toMatch(/from\s+["']\.\/adopt_or_mint_milestone_id["']/);
    expect(src).toMatch(/from\s+["']\.\/milestone_token["']/);
    expect(src).toMatch(/\bmintMilestoneLinear\s*\(/);
    expect(src).toMatch(/\badoptOrMintMilestoneId\s*\(/);
    expect(src).toMatch(/\bmilestoneIdFromEpicKey\s*\(/);
    expect(src).not.toMatch(/\bnextFreeMilestoneNumber\s*\(/);
    // Re-implementation tells: the minter's own primitives must not appear
    // here (they belong to `mint_milestone_id.ts`).
    expect(src).not.toMatch(/\bmintUniqueId\s*\(/);
    expect(src).not.toMatch(/\breaddirSync\s*\(/);
  });

  test("mode: linear returns the TRACKER-derived milestoneId and no `id`", async () => {
    // RETARGETED (M139 STE-541, AC-STE-541.6) from "returns a sequential
    // milestoneId": `mode: linear` no longer resolves an identity OFFLINE. The
    // sequential scan needed no tracker; `mintMilestoneLinear` requires a
    // provider carrying the milestone-create op. The REPLACEMENT for the
    // retired `"M102"` literal is equality against the derivation itself, which
    // a constant never was.
    const fx = makeFixture();
    try {
      const r = await resolveMilestoneIdentity({ specsDir: fx.specs, ...linearInput(LINEAR_UUID) });
      expect(r.milestoneId).toBe(milestoneIdFromLinearMilestone(LINEAR_UUID));
      expect(r.id).toBeUndefined();
      // The sequential answer this leg used to assert is still what a scan of
      // the SAME tree gives — so "not M102" is a statement about the branch,
      // not about a fixture that stopped answering.
      expect((await nextFreeMilestoneNumber(fx.specs)).next).toBe(102);
      expect(r.milestoneId).not.toBe("M102");
    } finally {
      fx.cleanup();
    }
  });

  test("mode: linear with NO create op REFUSES rather than falling back to the scan", async () => {
    // The other half of the same behavioural change, and the reason every
    // linear leg in this file gained a provider. A fall-back to the sequential
    // allocator here would be indistinguishable from a deliberate allocation
    // forever after — the exact failure the dispatcher exists to prevent.
    const fx = makeFixture();
    try {
      await expect(
        resolveMilestoneIdentity({
          specsDir: fx.specs,
          mode: "linear",
          project: "DPT",
          title: "Tracker-First Linear Milestones",
        }),
      ).rejects.toThrow(/milestone-create op/);
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

describe("AC-STE-440.3 — the linear branch equals mintMilestoneLinear's own derivation", () => {
  // RETARGETED WHOLESALE (M139 STE-541, AC-STE-541.6). This suite was the code
  // half of AC-STE-417.5's "Linear keeps the sequential five-way scan
  // unchanged" regression pin — retired by name in `specs/plan/M139.md`
  // alongside AC-STE-377.4's "Linear milestone allocation is byte-unchanged".
  //
  // THE BEHAVIOURAL CHANGE, stated once for the whole suite rather than
  // re-argued per leg: `mode: linear` no longer resolves an identity OFFLINE.
  // The sequential scan needed no tracker; `mintMilestoneLinear` requires a
  // provider carrying the milestone-create op, because an identity derived from
  // a tracker object cannot be computed without the tracker.
  //
  // The SHAPE of the suite is preserved on purpose: it still asserts the
  // dispatcher's answer EQUALS the owning helper's own answer for the same
  // input — only the owning helper changed. That is what keeps this a
  // delegation test rather than a shape test.

  test("bare call: dispatcher output === `milestoneIdFromLinearMilestone(allocated)`", async () => {
    const fx = makeFixture();
    try {
      const helper = await mintMilestoneLinear(
        makeMintingProvider(LINEAR_UUID).provider,
        "DPT",
        "Tracker-First Linear Milestones",
      );
      const r = await resolveMilestoneIdentity({ specsDir: fx.specs, ...linearInput(LINEAR_UUID) });
      expect(r.milestoneId).toBe(helper.milestoneId);
      expect(r.milestoneId).toBe(milestoneIdFromLinearMilestone(LINEAR_UUID));
      expect(r.id).toBeUndefined();

      // DISCRIMINATING SIBLING, replacing the retired scan equality: a
      // DIFFERENT allocation gives a DIFFERENT id, so the equality above is
      // about the tracker's answer and not about a constant.
      const other = await resolveMilestoneIdentity({
        specsDir: fx.specs,
        ...linearInput(LINEAR_UUID_2),
      });
      expect(other.milestoneId).toBe(milestoneIdFromLinearMilestone(LINEAR_UUID_2));
      expect(other.milestoneId).not.toBe(r.milestoneId);
    } finally {
      fx.cleanup();
    }
  });

  test("the CREATE args are forwarded, and the five scan seams are inert", async () => {
    // REPLACES "ALL FIVE scan legs are forwarded". That leg existed because a
    // dispatcher which dropped `changelogPath` / `provider` / `branchScanner`
    // still returned an `M<N>` and still passed a shape-only assertion — it
    // just silently demoted the five-way scan to a two-way one. The same class
    // of defect survives the retarget in a new place: a dispatcher that dropped
    // `project` or `title` would still return a well-formed `M_<hex>`, because
    // the id derives from the identifier alone. So the forwarding is asserted
    // where it now lives — on the create call itself — and the retired seams
    // are asserted INERT by call count, which is strictly more than the old
    // leg claimed.
    const fx = makeFixture();
    const minting = makeMintingProvider(LINEAR_UUID);
    let scanCalls = 0;
    const scanner: BranchMilestoneScanner = {
      listBranchMilestones: async () => {
        scanCalls++;
        return [1234];
      },
    };
    try {
      const r = await resolveMilestoneIdentity({
        specsDir: fx.specs,
        mode: "linear",
        project: "DPT",
        title: "Tracker-First Linear Milestones",
        provider: minting.provider,
        changelogPath: fx.changelog,
        branchScanner: scanner,
      });

      // The create carried the HUMAN TITLE alone — never the canonical
      // `M_<id> — <Title>` name, which is not knowable until it returns.
      expect(minting.creates).toEqual([
        { project: "DPT", name: "Tracker-First Linear Milestones" },
      ]);
      expect(r.milestoneId).toBe(milestoneIdFromLinearMilestone(LINEAR_UUID));
      expect(scanCalls).toBe(0);

      // POSITIVE CONTROL for that zero, in the same test: the SAME double
      // handed to the allocator itself increments. `0` is therefore a
      // measurement of the linear branch, not a counter that can never move.
      await nextFreeMilestoneNumber(fx.specs, fx.changelog, undefined, scanner);
      expect(scanCalls).toBe(1);
    } finally {
      fx.cleanup();
    }
  });

  test("the specs tree is IRRELEVANT: an empty tree and a populated one agree", async () => {
    // REPLACES "an empty specs tree still allocates M1 (the helper's edge case
    // is preserved)". That edge case belonged to the scan, which read the tree;
    // the mint does not read it at all. The replacement asserts exactly that
    // independence — and it is the sharpest available form, because the old
    // leg's whole point was that the tree DROVE the answer.
    const root = mkdtempSync(join(tmpdir(), "ste440-linear-empty-"));
    const populated = makeFixture();
    try {
      const specs = join(root, "specs");
      mkdirSync(join(specs, "plan"), { recursive: true });

      const onEmpty = await resolveMilestoneIdentity({ specsDir: specs, ...linearInput(LINEAR_UUID) });
      const onPopulated = await resolveMilestoneIdentity({
        specsDir: populated.specs,
        ...linearInput(LINEAR_UUID),
      });
      expect(onEmpty.milestoneId).toBe(onPopulated.milestoneId);
      expect(onEmpty.milestoneId).toBe(milestoneIdFromLinearMilestone(LINEAR_UUID));

      // CONTROL: the two trees DO disagree for the displaced allocator, so the
      // agreement above is a property of the mint and not of two identical
      // fixtures. (`M1` is the very edge case the retired leg pinned.)
      expect((await nextFreeMilestoneNumber(specs)).next).toBe(1);
      expect((await nextFreeMilestoneNumber(populated.specs)).next).toBe(102);
    } finally {
      rmSync(root, { recursive: true, force: true });
      populated.cleanup();
    }
  });

  test("the linear branch leaks no `id` KEY into a tracker-mode plan", async () => {
    const fx = makeFixture();
    try {
      const r: MilestoneIdentity = await resolveMilestoneIdentity({
        specsDir: fx.specs,
        ...linearInput(LINEAR_UUID),
      });
      // Probe #73 fails any tracker-mode plan carrying `id:`, so an `id` here
      // would turn the very next gate red rather than merely being unused. The
      // claim strengthens from "never mints" (false now — it mints a TRACKER
      // milestone) to "carries no `id` KEY", which is what the probe reads.
      expect(r.id).toBeUndefined();
      expect(Object.keys(r)).toEqual(["milestoneId"]);
      expect("id" in r).toBe(false);
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
    // RETARGETED (M139 STE-541, AC-STE-541.6): the linear spec now needs a
    // create-carrying provider, because `mode: linear` no longer resolves an
    // identity OFFLINE. The CLAIM is untouched — one gate site, three modes —
    // only the inputs the linear branch requires changed.
    const fx = makeFixture();
    try {
      const linear = await milestoneAllocationGateSpec({
        specsDir: fx.specs,
        ...linearInput(LINEAR_UUID),
      });
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
      // RETARGETED (M139 STE-541, AC-STE-541.6): same reason as the leg above
      // — the linear branch mints, so its gate spec needs the create op.
      const specs = [
        await milestoneAllocationGateSpec({ specsDir: fx.specs, ...linearInput(LINEAR_UUID) }),
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
      // The linear literal was `"M102"` — the sequential scan's answer for this
      // fixture — and is retargeted onto the mint's derivation of the allocated
      // identifier, which is what the branch returns now.
      expect(specs[0]!.defaultValue).toBe(milestoneIdFromLinearMilestone(LINEAR_UUID));
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
