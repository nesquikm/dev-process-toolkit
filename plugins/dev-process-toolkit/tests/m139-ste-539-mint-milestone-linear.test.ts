// STE-539 — the Linear milestone is created FIRST, and its identity is derived
// from the identifier the tracker allocates for it.
//
// The Jira path already runs in this order: create the Epic under the human
// title, read the key back, derive `M_<key>`. The Linear path ran the reverse —
// compute a number locally with a five-way sequential scan, then name a tracker
// object after it. This FR brings Linear onto the Jira order, which is the only
// order that is computable: the canonical name `M_<id> — <Title>` contains the
// id, and the id comes from the very call the name would be an argument to.
//
// ─────────────────────────────────────────────────────────────────────────
// CONTRACT THE IMPLEMENTER IS BEING HELD TO (read this before implementing)
// ─────────────────────────────────────────────────────────────────────────
//
// 1. New module `adapters/_shared/src/mint_milestone_linear.ts` exports
//    `mintMilestoneLinear(provider, project, title, opts?)` returning a Promise
//    of `{ milestoneUuid: string; milestoneId: string }`.
//    - `milestoneUuid` — verbatim, as the tracker allocated it.
//    - `milestoneId`   — `milestoneIdFromLinearMilestone(milestoneUuid)`.
//    It calls the provider's `createMilestone(project, { name })` op with
//    `name` set to the human title ALONE.
//
// 2. `MilestoneOps` (attach_project_milestone.ts) gains
//    `createMilestone?: (project: string, opts: { name: string }) => Promise<{ id: string }>`
//    in the property-arrow style its siblings use — a method-shorthand
//    declaration reads as a call site to the AC.5 census below. Its
//    `listMilestones` widens to `{ name: string; id?: string }[]`.
//
// 3. The mint declares its OWN provider type with `listMilestones` OPTIONAL.
//    `MilestoneOps.listMilestones` is REQUIRED, so a bare `Pick` off it would
//    force every caller to carry an enumeration op the find leg treats as
//    optional (leg 4 below exercises the find-less shape).
//
// 4. `defaultSleep`, `TRANSIENT_RETRY_SCHEDULE_MS` and `retryTransient` are
//    IMPORTED from `attach_project_milestone.ts`, never re-declared: two copies
//    of a schedule is two schedules. Find-before-create runs INSIDE
//    `retryTransient`; the derivation runs OUTSIDE it.
//
// 5. WATCH THE AC.5 CENSUS: it counts syntactic `createMilestone(` invocations
//    in production code under `adapters/` + `skills/` and pins the total at
//    ONE. The op occurs NOWHERE under either root today, so the count starts
//    from a clean tree; the scan reads `.md` and `.sh` as well as modules, so
//    no shipped prose may spell `createMilestone(` either — name the op without
//    parentheses, as `mint_milestone_epic.ts` does for `createEpic`.
//
// The double and section layout follow `tests/m135-ste-522-mint-milestone-epic.test.ts`,
// the direct Jira sibling.

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { TRANSIENT_RETRY_SCHEDULE_MS } from "../adapters/_shared/src/attach_project_milestone";

const pluginRoot = join(import.meta.dir, "..");

// ───────────────────────────────────────────────────────────────────────
// Fixture constants — a real Linear-shaped mint.
// ───────────────────────────────────────────────────────────────────────

/** The project the milestone is minted into. */
const PROJECT = "DPT — Dev Process Toolkit";
/** The human title, the ONLY value that exists before the create call. */
const TITLE = "Tracker-First Linear Milestones";
/** The identifier the tracker allocates in response to the create. */
const UUID = "550e8400-e29b-41d4-a716-446655440000";
/** `milestoneIdFromLinearMilestone(UUID)` — knowable only AFTER the create. */
const MILESTONE_ID = "M_550e84";
/** A second, unrelated allocation — the distinctness leg's other input. */
const OTHER_UUID = "6f1e2d3c-4b5a-4998-8877-665544332211";
const OTHER_MILESTONE_ID = "M_6f1e2d";

/**
 * A milestone that already exists in the project under a DIFFERENT human
 * title. It exists so the find leg's by-NAME match has something to be wrong
 * about: seeded first, it is what a positional `list[0]` find would return.
 * Its leading six hex differ from both fixtures above, so choosing it changes
 * the derived token as well as the identifier.
 */
const DECOY_UUID = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const DECOY_MILESTONE_ID = "M_0a1b2c";

/** The module the census must find, and nothing else. */
const MINT_MODULE_PATH = "adapters/_shared/src/mint_milestone_linear.ts";

// ───────────────────────────────────────────────────────────────────────
// Provider double — records every creation argument verbatim, and holds the
// tracker's milestone store so the find leg has something to enumerate.
//
// AC.1 is asserted against THIS record, never against the module source: a
// helper that composed `M_550e84 — Tracker-First Linear Milestones` into a
// local and sent it would pass a source grep and fail here.
// ───────────────────────────────────────────────────────────────────────

interface MintDouble {
  /** The tracker's milestone store. Its LENGTH is the duplicate assertion. */
  milestones: { id?: string; name: string }[];
  createMilestoneCalls: number;
  listMilestonesCalls: number;
  /** Every `(project, opts)` pair handed to `createMilestone`, in order. */
  createArgs: { project: string; opts: { name: string } }[];
  provider: Record<string, unknown>;
}

function makeMintDouble(
  opts: {
    /** The identifier the tracker allocates for the milestone this mint creates. */
    nextUuid?: string;
    /** Thrown by `createMilestone`, one per call, FIFO, then it succeeds. */
    createErrors?: Error[];
    /** The create REGISTERS the milestone server-side and THEN throws. */
    createLandsBeforeThrow?: boolean;
    /** Omit the enumeration op entirely (the degraded, find-less shape). */
    withoutListMilestones?: boolean;
    /** Milestones the store already holds before the mint runs. */
    seed?: { id?: string; name: string }[];
  } = {},
): MintDouble {
  const nextUuid = opts.nextUuid ?? UUID;
  const errors = [...(opts.createErrors ?? [])];
  const d: MintDouble = {
    milestones: [...(opts.seed ?? [])],
    createMilestoneCalls: 0,
    listMilestonesCalls: 0,
    createArgs: [],
    provider: {},
  };
  const provider: Record<string, unknown> = {
    milestoneBinding: "object" as const,
    // Arrow-function property (not a prototype method): production code
    // destructures the op off the provider and calls it unbound.
    createMilestone: async (project: string, o: { name: string }): Promise<{ id: string }> => {
      d.createMilestoneCalls += 1;
      d.createArgs.push({ project, opts: { ...o } });
      const err = errors.shift();
      if (err) {
        // A create that reaches the server, registers, and THEN times out.
        if (opts.createLandsBeforeThrow) d.milestones.push({ id: nextUuid, name: o.name });
        throw err;
      }
      d.milestones.push({ id: nextUuid, name: o.name });
      return { id: nextUuid };
    },
  };
  if (!opts.withoutListMilestones) {
    provider.listMilestones = async (
      _project: string,
    ): Promise<{ name: string; id?: string }[]> => {
      d.listMilestonesCalls += 1;
      return d.milestones.map((m) => ({ ...m }));
    };
  }
  d.provider = provider;
  return d;
}

/** The contract every behavioural AC below holds the mint to. */
type MintFn = (
  provider: unknown,
  project: string,
  title: string,
  opts?: { sleep?: (ms: number) => Promise<void> },
) => Promise<{ milestoneUuid: string; milestoneId: string }>;

/**
 * Loaded lazily and per test, so a missing module fails ONLY the behavioural
 * ACs. A top-level import would take the whole file down with it, and the
 * census/source ACs below would then report a module-resolution error instead
 * of the state of the surfaces they measure — a red that says nothing about
 * its own subject.
 */
async function loadMintMilestoneLinear(): Promise<MintFn> {
  const mod = (await import("../adapters/_shared/src/mint_milestone_linear")) as {
    mintMilestoneLinear?: MintFn;
  };
  if (typeof mod.mintMilestoneLinear !== "function") {
    throw new Error(
      "adapters/_shared/src/mint_milestone_linear.ts does not export a `mintMilestoneLinear` function",
    );
  }
  return mod.mintMilestoneLinear;
}

/** The shared derivation, loaded the same way and for the same reason. */
async function loadDerivation(): Promise<(uuid: string) => string> {
  const mod = (await import("../adapters/_shared/src/milestone_token")) as {
    milestoneIdFromLinearMilestone?: (uuid: string) => string;
  };
  if (typeof mod.milestoneIdFromLinearMilestone !== "function") {
    throw new Error(
      "adapters/_shared/src/milestone_token.ts does not export a `milestoneIdFromLinearMilestone` function",
    );
  }
  return mod.milestoneIdFromLinearMilestone;
}

/** Records every wait instead of taking it — the tests must not cost 7s. */
function sleepRecorder(): { sleeps: number[]; sleep: (ms: number) => Promise<void> } {
  const sleeps: number[] = [];
  return {
    sleeps,
    sleep: async (ms: number) => {
      sleeps.push(ms);
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════
// AC-STE-539.1 — the create carries the human title ALONE.
// ═══════════════════════════════════════════════════════════════════════

describe("AC-STE-539.1 — the canonical `M_<id> — <Title>` name never reaches createMilestone", () => {
  test("exactly one create, against the named project, carrying the title alone", async () => {
    const mintMilestoneLinear = await loadMintMilestoneLinear();
    const d = makeMintDouble();

    const result = await mintMilestoneLinear(d.provider, PROJECT, TITLE, {
      sleep: sleepRecorder().sleep,
    });

    // The subject of the loop below is pinned PRESENT: a `for` over an empty
    // recording asserts nothing at all.
    expect(d.createMilestoneCalls).toBe(1);
    expect(d.createArgs.length).toBe(1);

    expect(d.createArgs[0]!.project).toBe(PROJECT);
    // The name is the human title ALONE — not decorated, not prefixed.
    expect(d.createArgs[0]!.opts.name).toBe(TITLE);

    const canonical = `${result.milestoneId} — ${TITLE}`;
    for (const call of d.createArgs) {
      // Read the RECORDING, not the source.
      expect(call.opts.name).not.toBe(canonical);
      expect(call.opts.name).not.toContain(result.milestoneId);
      expect(call.opts.name).not.toContain("—");
      // A canonical name is `<token> — <title>`; nothing sent may be in that
      // shape, whichever token someone might have guessed at.
      expect(call.opts.name).not.toMatch(/^M(?:\d+|_[A-Za-z0-9][A-Za-z0-9_-]*)\s+—\s+/);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
// AC-STE-539.2 — read the identifier back, derive the id from it.
// ═══════════════════════════════════════════════════════════════════════

describe("AC-STE-539.2 — both halves come back, the id derived from the identifier read back", () => {
  test("the literal pair, AND the derivation applied to the returned identifier", async () => {
    const mintMilestoneLinear = await loadMintMilestoneLinear();
    const milestoneIdFromLinearMilestone = await loadDerivation();
    const d = makeMintDouble();

    const result = await mintMilestoneLinear(d.provider, PROJECT, TITLE, {
      sleep: sleepRecorder().sleep,
    });

    // The literal pair. `milestoneUuid` is the value the double RETURNED from
    // `createMilestone` — the mint takes no uuid argument, so there is no
    // input it could be echoing.
    expect(result).toEqual({ milestoneUuid: UUID, milestoneId: MILESTONE_ID });

    // And the relation between the two halves. Neither assertion alone is
    // enough: the literal can drift, and this one alone is tautological — a
    // mint deriving from the WRONG uuid would still satisfy it.
    expect(result.milestoneId).toBe(milestoneIdFromLinearMilestone(result.milestoneUuid));
  });

  test("a different tracker allocation flows through end to end", async () => {
    const mintMilestoneLinear = await loadMintMilestoneLinear();
    const milestoneIdFromLinearMilestone = await loadDerivation();
    const d = makeMintDouble({ nextUuid: OTHER_UUID });

    const result = await mintMilestoneLinear(d.provider, PROJECT, TITLE, {
      sleep: sleepRecorder().sleep,
    });

    expect(result).toEqual({ milestoneUuid: OTHER_UUID, milestoneId: OTHER_MILESTONE_ID });
    expect(result.milestoneId).toBe(milestoneIdFromLinearMilestone(result.milestoneUuid));
  });
});

// ═══════════════════════════════════════════════════════════════════════
// AC-STE-539.5 — create + read-back retry as ONE unit, with the find leg
// inside it; and the create op keeps exactly ONE production call site.
// ═══════════════════════════════════════════════════════════════════════

describe("AC-STE-539.5 — the retry carries find-before-create, and never duplicates the milestone", () => {
  test("leg 1 — a plain transient failure retries on the canonical schedule and yields ONE milestone", async () => {
    const mintMilestoneLinear = await loadMintMilestoneLinear();
    // The create fails before reaching the server, so nothing landed and the
    // retry genuinely has to create.
    const d = makeMintDouble({ createErrors: [new Error("read ECONNRESET")] });
    const rec = sleepRecorder();

    const result = await mintMilestoneLinear(d.provider, PROJECT, TITLE, { sleep: rec.sleep });

    // The canonical schedule's FIRST step, as the exported constant AND as the
    // literal — neither can drift away from the other alone.
    expect(rec.sleeps).toEqual([TRANSIENT_RETRY_SCHEDULE_MS[0]!]);
    expect(rec.sleeps).toEqual([1000]);

    // It really did retry, and the retry really did create.
    expect(d.createMilestoneCalls).toBe(2);
    expect(d.createArgs.length).toBe(2);

    // And the tracker holds ONE milestone, not two.
    expect(d.milestones.length).toBe(1);
    expect(d.milestones[0]!.id).toBe(UUID);

    expect(result.milestoneUuid).toBe(UUID);
    expect(result.milestoneId).toBe(MILESTONE_ID);

    // The retry re-sends the SAME computable name — a second attempt that
    // re-composed a canonical name would be AC.1's defect wearing a retry.
    for (const call of d.createArgs) {
      expect(call.opts.name).toBe(TITLE);
    }
  });

  test("leg 2 — a landed-but-timed-out create is FOUND and reused, never re-created", async () => {
    const mintMilestoneLinear = await loadMintMilestoneLinear();
    // The create registers the milestone server-side, THEN times out. A blind
    // re-create on the retry mints the duplicate this FR exists to prevent.
    const d = makeMintDouble({
      nextUuid: OTHER_UUID,
      createErrors: [new Error("504 Gateway Timeout")],
      createLandsBeforeThrow: true,
    });
    const rec = sleepRecorder();

    const result = await mintMilestoneLinear(d.provider, PROJECT, TITLE, { sleep: rec.sleep });

    expect(rec.sleeps).toEqual([TRANSIENT_RETRY_SCHEDULE_MS[0]!]);

    // The decisive assertion: the call COUNT on the instrumented op. The
    // absence of a second create is MEASURED, not read off the source.
    expect(d.createMilestoneCalls).toBe(1);
    expect(d.milestones.length).toBe(1);

    // Reuse is asserted on the VALUE too: the identifier that comes back is
    // the landed milestone's, and the id is derived from it.
    expect(result.milestoneUuid).toBe(OTHER_UUID);
    expect(result.milestoneId).toBe(OTHER_MILESTONE_ID);

    // The find leg is what ran during the retry — the enumeration op is the
    // only way the landed milestone could have been seen at all.
    //
    // Pinned at the EXACT count, not `>= 1`: the find leg fires on the first
    // attempt too (before the create), so `>= 1` holds no matter what the
    // retry did and could only fail if the find leg never ran at all. Two is
    // the falsifiable number — attempt 1 enumerates the empty store, attempt 2
    // enumerates the landed one — so a retry that skipped the enumeration and
    // recovered some other way now reds here.
    expect(d.listMilestonesCalls).toBe(2);
  });

  test("leg 3 — a re-mint against a store already holding the milestone creates nothing", async () => {
    const mintMilestoneLinear = await loadMintMilestoneLinear();
    // The find leg runs on the FIRST attempt, not only on retries, which is
    // what makes minting idempotent across a crash or a repeated step.
    const d = makeMintDouble({ seed: [{ id: OTHER_UUID, name: TITLE }] });
    const rec = sleepRecorder();

    const result = await mintMilestoneLinear(d.provider, PROJECT, TITLE, { sleep: rec.sleep });

    expect(d.createMilestoneCalls).toBe(0);
    expect(d.milestones.length).toBe(1);
    expect(result.milestoneUuid).toBe(OTHER_UUID);
    expect(result.milestoneId).toBe(OTHER_MILESTONE_ID);

    // A reuse is a find, not a recovery: it costs no backoff.
    expect(rec.sleeps).toEqual([]);
  });

  // Legs 3a/3b close a hole the AUDIT stage found in legs 2/3/5: every store
  // above holds exactly ONE row, so a find leg written as `list[0]` — reusing
  // whatever milestone happens to be first — passes all of them and the whole
  // gate. That is this FR's own defect one level down: not a DUPLICATE
  // identity, but the WRONG one. The match is by NAME, and these two legs are
  // what make that falsifiable.
  test("leg 3a — the find leg matches by NAME, never by position", async () => {
    const mintMilestoneLinear = await loadMintMilestoneLinear();
    // The decoy is seeded FIRST, so a positional find returns IT. Its name
    // differs from the title and its identifier derives to a different token,
    // so picking it is visible in both halves of the result.
    const d = makeMintDouble({
      seed: [
        { id: DECOY_UUID, name: "Some Other Milestone" },
        { id: OTHER_UUID, name: TITLE },
      ],
    });
    const rec = sleepRecorder();

    const result = await mintMilestoneLinear(d.provider, PROJECT, TITLE, { sleep: rec.sleep });

    // The name-matched row wins, and the decoy is named explicitly in the
    // negative so a regression reports WHICH row was taken.
    expect(result.milestoneUuid).toBe(OTHER_UUID);
    expect(result.milestoneUuid).not.toBe(DECOY_UUID);
    expect(result.milestoneId).toBe(OTHER_MILESTONE_ID);
    expect(result.milestoneId).not.toBe(DECOY_MILESTONE_ID);
    // Still a find, not a create: the decoy must not have provoked one.
    expect(d.createMilestoneCalls).toBe(0);
    expect(d.milestones.length).toBe(2);
    expect(rec.sleeps).toEqual([]);
  });

  test("leg 3b — a store holding ONLY a non-matching row creates rather than reusing it", async () => {
    const mintMilestoneLinear = await loadMintMilestoneLinear();
    // The isolation half of 3a. A `list[0]` find would reuse this row and
    // create nothing; the by-name find misses, so the mint creates. Without
    // this leg, 3a alone is satisfied by a find that merely prefers a later
    // row, which is not the same rule.
    const d = makeMintDouble({
      nextUuid: UUID,
      seed: [{ id: DECOY_UUID, name: "Some Other Milestone" }],
    });
    const rec = sleepRecorder();

    const result = await mintMilestoneLinear(d.provider, PROJECT, TITLE, { sleep: rec.sleep });

    expect(d.createMilestoneCalls).toBe(1);
    expect(d.createArgs[0]!.opts.name).toBe(TITLE);
    expect(result.milestoneUuid).toBe(UUID);
    expect(result.milestoneId).toBe(MILESTONE_ID);
    // The decoy survives untouched beside the freshly created milestone.
    expect(d.milestones.length).toBe(2);
    expect(rec.sleeps).toEqual([]);
  });

  test("leg 4 — a provider with createMilestone and NO listMilestones still mints", async () => {
    const mintMilestoneLinear = await loadMintMilestoneLinear();
    // The find leg is OPTIONAL. Without this leg, leg 2's single create could
    // just as well have come from the create being skipped for some unrelated
    // reason; here there is no find leg at all and the create still runs once.
    const d = makeMintDouble({ withoutListMilestones: true });
    const rec = sleepRecorder();

    expect(d.provider.listMilestones).toBeUndefined();

    const result = await mintMilestoneLinear(d.provider, PROJECT, TITLE, { sleep: rec.sleep });

    expect(d.createMilestoneCalls).toBe(1);
    expect(d.listMilestonesCalls).toBe(0);
    expect(d.milestones.length).toBe(1);
    expect(rec.sleeps).toEqual([]);
    expect(result).toEqual({ milestoneUuid: UUID, milestoneId: MILESTONE_ID });
  });

  test("leg 5 — a name hit carrying no identifier refuses rather than blind-creating", async () => {
    const mintMilestoneLinear = await loadMintMilestoneLinear();
    // The store holds a milestone under this exact title, but the enumeration
    // gives no `id` for it. Creating anyway would mint the duplicate; deriving
    // from nothing would produce a malformed id.
    const d = makeMintDouble({ seed: [{ name: TITLE }] });
    const rec = sleepRecorder();

    let returned: unknown;
    let caught: unknown = null;
    try {
      returned = await mintMilestoneLinear(d.provider, PROJECT, TITLE, { sleep: rec.sleep });
    } catch (err) {
      caught = err;
    }

    expect(returned).toBeUndefined();
    expect(caught).toBeInstanceOf(Error);
    // Named, so an unrelated `TypeError` from some other line cannot score as
    // this refusal.
    expect((caught as Error).message).toMatch(/mintMilestoneLinear/);

    // The decisive part: no duplicate was created on the way out.
    expect(d.createMilestoneCalls).toBe(0);
    expect(d.milestones.length).toBe(1);
  });

  test("leg 6 — a persistent transient failure exhausts 1s+2s+4s, then surfaces the error", async () => {
    const mintMilestoneLinear = await loadMintMilestoneLinear();
    // One more failure than the schedule has steps: the wrapper must stop
    // after the third backoff rather than looping forever.
    const d = makeMintDouble({
      createErrors: [
        new Error("504 Gateway Timeout"),
        new Error("504 Gateway Timeout"),
        new Error("504 Gateway Timeout"),
        new Error("504 Gateway Timeout"),
      ],
    });
    const rec = sleepRecorder();

    let returned: unknown;
    let caught: unknown = null;
    try {
      returned = await mintMilestoneLinear(d.provider, PROJECT, TITLE, { sleep: rec.sleep });
    } catch (err) {
      caught = err;
    }

    expect(returned).toBeUndefined();
    expect(caught).toBeInstanceOf(Error);
    // The ORIGINAL failure surfaces, not a locally re-worded one.
    expect((caught as Error).message).toMatch(/504|Gateway/i);

    // The whole canonical schedule, in order, and nothing beyond it.
    expect(rec.sleeps).toEqual([...TRANSIENT_RETRY_SCHEDULE_MS]);
    expect(rec.sleeps).toEqual([1000, 2000, 4000]);

    // One fast-path attempt plus three retries; nothing ever landed.
    expect(d.createMilestoneCalls).toBe(4);
    expect(d.milestones.length).toBe(0);
  });
});

// ───────────────────────────────────────────────────────────────────────
// AC-STE-539.5 — one production call site, proven measured.
//
// The census helper is the one from
// `tests/m135-ste-522-mint-milestone-epic.test.ts:418-524`, re-run for
// `createMilestone`.
// ───────────────────────────────────────────────────────────────────────

/**
 * The trees a production call site could live in. NOTE: `adapters/` and
 * `skills/` live under `plugins/dev-process-toolkit/`, NOT the repository
 * root — a scan pointed one level too high reports zero exactly like a clean
 * tree does, which is why the positive control below exists and why these
 * roots are named in every assertion.
 */
const SEARCH_ROOTS = ["adapters", "skills"] as const;
const ROOTS_DESC = SEARCH_ROOTS.map((r) => join(pluginRoot, r)).join(" + ");

/** Surfaces that can carry an executable step: modules and skill/adapter prose. */
const SCANNED_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".md", ".sh"]);

function collectScannedFiles(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      // Test trees are not production code.
      if (entry.name === "tests" || entry.name === "node_modules") continue;
      collectScannedFiles(p, out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (entry.name.endsWith(".test.ts")) continue; // nor are test files
    const dot = entry.name.lastIndexOf(".");
    if (dot < 0 || !SCANNED_EXTENSIONS.has(entry.name.slice(dot))) continue;
    out.push(p);
  }
}

/**
 * Every INVOCATION of `token` in production code under the named roots —
 * `token(`, with a word boundary in front. Deliberately not a bare grep for
 * the identifier: the `MilestoneOps` interface declaration
 * (`createMilestone?: (project…`), the destructuring
 * (`{ …, createMilestone, … }`), and every prose mention would all match one
 * of those, and none of them is a call site.
 */
function scanProductionCallSites(token: string): { file: string; line: number }[] {
  const files: string[] = [];
  for (const root of SEARCH_ROOTS) collectScannedFiles(join(pluginRoot, root), files);
  files.sort();

  const re = new RegExp(String.raw`(?<![A-Za-z0-9_$])${token}\s*\(`, "g");
  const sites: { file: string; line: number }[] = [];
  for (const file of files) {
    const src = readFileSync(file, "utf-8");
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      sites.push({
        file: relative(pluginRoot, file),
        line: src.slice(0, m.index).split("\n").length,
      });
    }
  }
  return sites;
}

describe("AC-STE-539.5 — createMilestone has exactly ONE production call site, and it is the mint", () => {
  test("the census, measured over a scan first proven to be looking at something", () => {
    // POSITIVE CONTROL, run FIRST and in the SAME test: `attachProjectMilestone`
    // is invoked in production code under BOTH roots today. A walk pointed one
    // directory too high — or a file collector that silently gathers nothing —
    // reports zero exactly like a clean tree, so without this the count below
    // would be a claim about the search, not about the repository.
    const control = scanProductionCallSites("attachProjectMilestone");
    expect(
      control.length > 0
        ? "non-zero"
        : `ZERO control hits — the scan of [${ROOTS_DESC}] is looking at nothing`,
    ).toBe("non-zero");

    // Both roots are live, not just the first one.
    const rootsHit = new Set(control.map((s) => s.file.split("/")[0]));
    expect([...rootsHit].sort().join(",")).toBe([...SEARCH_ROOTS].sort().join(","));

    // Same scan, same roots, same test — the count this AC asserts. The
    // verdict is composed so the searched roots travel WITH the failure: a
    // regression here is either a second home for the op or a moved
    // directory, and the message has to let a reader tell those apart.
    const sites = scanProductionCallSites("createMilestone");
    const verdict =
      `${sites.length} createMilestone call site(s) under [${ROOTS_DESC}] ` +
      `(excluding *.test.ts and tests/): ${sites.map((s) => s.file).join(", ") || "(none)"}`;

    expect(verdict).toBe(
      `1 createMilestone call site(s) under [${ROOTS_DESC}] ` +
        `(excluding *.test.ts and tests/): ${MINT_MODULE_PATH}`,
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════
// AC-STE-539.6 — distinct identifiers yield distinct ids, and the sequential
// five-way scan is never consulted on this path.
// ═══════════════════════════════════════════════════════════════════════

describe("AC-STE-539.6 — distinct milestone identifiers yield distinct milestone ids", () => {
  test("two mints under different allocations return different ids", async () => {
    const mintMilestoneLinear = await loadMintMilestoneLinear();

    const a = await mintMilestoneLinear(makeMintDouble().provider, PROJECT, TITLE, {
      sleep: sleepRecorder().sleep,
    });
    const b = await mintMilestoneLinear(
      makeMintDouble({ nextUuid: OTHER_UUID }).provider,
      PROJECT,
      TITLE,
      { sleep: sleepRecorder().sleep },
    );

    expect(a.milestoneUuid).not.toBe(b.milestoneUuid);
    expect(a.milestoneId).not.toBe(b.milestoneId);
    expect(a.milestoneId).toBe(MILESTONE_ID);
    expect(b.milestoneId).toBe(OTHER_MILESTONE_ID);
  });

  test("falsifying sibling: two identifiers SHARING their first six chars DO collide", async () => {
    const milestoneIdFromLinearMilestone = await loadDerivation();

    // Without this, "distinct identifiers yield distinct ids" would also hold
    // for a derivation that returned something distinct for anything at all.
    // The collision proves the property belongs to the input the derivation
    // ACTUALLY reads — the leading six characters.
    const twinA = "550e8400-e29b-41d4-a716-446655440000";
    const twinB = "550e84ff-1111-4222-8333-444444444444";
    expect(twinA.slice(0, 6)).toBe(twinB.slice(0, 6));
    expect(twinA).not.toBe(twinB);
    expect(milestoneIdFromLinearMilestone(twinA)).toBe(milestoneIdFromLinearMilestone(twinB));
    expect(milestoneIdFromLinearMilestone(twinB)).toBe(MILESTONE_ID);
  });
});

describe("AC-STE-539.6 — nextFreeMilestoneNumber is never called on this path", () => {
  test("the call count on an instrumented double is zero, and the counter demonstrably fires", async () => {
    const mintMilestoneLinear = await loadMintMilestoneLinear();

    // An instrumented sequential allocator, hung off the provider where a mint
    // that wanted one would reach for it.
    const counter = {
      calls: 0,
      nextFreeMilestoneNumber: async (..._args: unknown[]): Promise<{ next: number }> => {
        counter.calls += 1;
        return { next: 999 };
      },
    };

    const d = makeMintDouble();
    (d.provider as Record<string, unknown>).nextFreeMilestoneNumber =
      counter.nextFreeMilestoneNumber;

    const result = await mintMilestoneLinear(d.provider, PROJECT, TITLE, {
      sleep: sleepRecorder().sleep,
    });

    // The absence, measured.
    expect(counter.calls).toBe(0);
    expect(result.milestoneId).toBe(MILESTONE_ID);

    // POSITIVE CONTROL: a counter wired to nothing also records zero. Fire it
    // by hand and watch it move, so the zero above is a fact about the mint.
    await counter.nextFreeMilestoneNumber("specs");
    expect(counter.calls).toBe(1);
  });

  test("the module neither imports nor calls the sequential allocator — regexes proven live", () => {
    const sharedSrc = join(pluginRoot, "adapters", "_shared", "src");
    const IMPORT_RE = /from\s+["'][^"']*next_free_milestone_number["']/;
    const CALL_RE = /\bnextFreeMilestoneNumber\s*\(/;

    // POSITIVE CONTROL first: a file that genuinely imports the allocator and
    // calls it. An absence measured by a regex is vacuous until the regex is
    // shown to match SOMETHING, and these are the same two regexes, run in the
    // same test.
    //
    // RETARGETED, and the reason is the lesson. This control used to read
    // `resolve_milestone_identity.ts`, which imported and called the allocator
    // on its linear branch. STE-541 rewired that branch to the tracker-first
    // mint and reduced the import to `import type`, so the control's SUBJECT
    // stopped satisfying it — and a control that no longer matches makes the
    // absence below unmeasured while every leg still reads green. A control is
    // only as durable as the property it depends on, and "the dispatcher calls
    // the allocator" was a property this milestone was always going to remove.
    //
    // The allocator's OWN suite is the durable target: it exists to exercise
    // that function, so it imports and calls it by definition, and it cannot
    // stop doing so without a far louder failure than this leg.
    const control = readFileSync(join(sharedSrc, "next_free_milestone_number.test.ts"), "utf-8");
    expect(control).toMatch(IMPORT_RE);
    expect(control).toMatch(CALL_RE);

    // The subject.
    const src = readFileSync(join(sharedSrc, "mint_milestone_linear.ts"), "utf-8");
    expect(src).not.toMatch(IMPORT_RE);
    expect(src).not.toMatch(CALL_RE);
    // It DOES route through the shared derivation.
    expect(src).toContain("milestoneIdFromLinearMilestone");
  });

  test("behavioural backing: the mint completes with no scan inputs anywhere in reach", async () => {
    const mintMilestoneLinear = await loadMintMilestoneLinear();

    // A provider carrying ONLY the two milestone ops — no `specsDir`, no
    // `changelogPath`, no `branchScanner`, no tracker listing. The five-way
    // scan has no inputs it could be called with, and the mint completes
    // regardless, so the identity cannot be coming from it.
    let createCalls = 0;
    const bare = {
      createMilestone: async (_project: string, o: { name: string }): Promise<{ id: string }> => {
        createCalls += 1;
        expect(o.name).toBe(TITLE);
        return { id: UUID };
      },
      listMilestones: async (_project: string): Promise<{ name: string; id?: string }[]> => [],
    };
    expect(Object.keys(bare).sort()).toEqual(["createMilestone", "listMilestones"]);

    const result = await mintMilestoneLinear(bare, PROJECT, TITLE, {
      sleep: sleepRecorder().sleep,
    });

    expect(createCalls).toBe(1);
    expect(result).toEqual({ milestoneUuid: UUID, milestoneId: MILESTONE_ID });
  });
});

// ---------------------------------------------------------------------------
// The retry apparatus is SHARED, not copied — enforced, not merely asserted.
// ---------------------------------------------------------------------------
//
// Both mints' headers, and this file's own contract note, say the schedule and
// the loop are "imported, never re-declared". Until now that claim was carried
// by prose alone: a GREEN-stage mutation replaced the import with a local
// `retryTransient` plus a re-declared `[1000, 2000, 4000]` and passed all 92
// legs AND the full gate, because every behavioural leg asserts sleep VALUES,
// which a copy reproduces exactly.
//
// The same unenforced claim sits at `tests/m135-ste-522-mint-milestone-epic.test.ts`
// and `tests/m141-ste-545-release-writer-door.test.ts`. Pinning only the module
// this FR happens to add would be the sibling-surface drift STE-540's Notes
// names as this repo's recurring defect, so BOTH mints are the subject here and
// one loop decides the verdict for each.
describe("the retry apparatus is imported by both mints, never re-declared", () => {
  const MINTS = [
    "adapters/_shared/src/mint_milestone_linear.ts",
    "adapters/_shared/src/mint_milestone_epic.ts",
  ] as const;

  /** The one module that may DEFINE the schedule and the loop. */
  const OWNER = "adapters/_shared/src/attach_project_milestone.ts";

  test("the owner defines them — the control proving these searches can match", () => {
    // Without this leg the two absences below are claims about a search, not
    // about the mints: a typo'd regex finds nothing everywhere and reads clean.
    const owner = readFileSync(join(pluginRoot, OWNER), "utf-8");
    expect(owner).toMatch(/export const TRANSIENT_RETRY_SCHEDULE_MS/);
    expect(owner).toMatch(/export async function retryTransient/);
    expect(owner).toMatch(/export const defaultSleep/);
  });

  for (const mint of MINTS) {
    test(`${mint} imports the apparatus and re-declares no part of it`, () => {
      const src = readFileSync(join(pluginRoot, mint), "utf-8");

      // It must IMPORT the loop and the wait from the owner. Asserted on an
      // import statement naming that module, so a same-named local symbol
      // cannot satisfy it.
      expect(src).toMatch(
        /import\s*\{[^}]*\bretryTransient\b[^}]*\}\s*from\s*["']\.\/attach_project_milestone["']/,
      );
      expect(src).toMatch(
        /import\s*\{[^}]*\bdefaultSleep\b[^}]*\}\s*from\s*["']\.\/attach_project_milestone["']/,
      );

      // And it must re-declare NOTHING: no local binding shadowing either
      // symbol, and no second copy of the schedule's literal values. The
      // literal check is what kills the mutation that survived — a local
      // `[1000, 2000, 4000]` reproduces every observable sleep.
      expect(src).not.toMatch(/(?:const|let|function)\s+retryTransient\b/);
      expect(src).not.toMatch(/(?:const|let)\s+defaultSleep\b/);
      expect(src).not.toMatch(/(?:const|let)\s+TRANSIENT_RETRY_SCHEDULE_MS\b/);
      expect(src).not.toMatch(/\[\s*1000\s*,\s*2000\s*,\s*4000\s*\]/);
    });
  }
});
