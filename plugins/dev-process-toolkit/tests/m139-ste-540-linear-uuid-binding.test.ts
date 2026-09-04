// M139 / STE-540 — "A Linear milestone binds by identifier, never by name".
//
// Subject: the OBJECT branch of `attachProjectMilestone`
// (adapters/_shared/src/attach_project_milestone.ts) — the default/Linear
// binding. The `epic` branch is Jira's and is NOT the subject here.
//
// Once STE-539 mints a milestone identity FROM the identifier Linear
// allocated (`milestoneIdFromLinearMilestone(uuid)` → `M_<6 hex>`), the
// canonical plan name is `M_3fa85f — Waiting States II` while the milestone
// object keeps whatever human title someone typed (`Waiting States II`). The
// shipped join — `existing.find(m => m.name === milestoneName)` — can never
// succeed on that pair, and its miss branch auto-CREATES: a second milestone
// under a fresh identifier that can never sanitize back to the token.
//
// This file pins the replacement: for an `epic`-KIND token the object branch
// derives each candidate's identifier FORWARD and compares to the token, the
// post-write verify re-derives from the read-back identifier, a miss REFUSES,
// and a grandfathered numeric `M<N>` token keeps the shipped by-name path
// byte-for-byte.
//
// Every absence is asserted as a COUNT on the double
// (`expect(d.saveMilestoneCalls).toBe(0)`), never as a missing side effect —
// a stray milestone is invisible from the ticket's point of view. The counter
// itself has a positive control: AC.3's numeric MISS leg drives
// `saveMilestoneCalls === 1` through the SAME double implementation, so AC.5's
// zero is a real zero and not a counter that never increments.

import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTrackerProjectMilestoneAttachedProbe } from "../adapters/_shared/src/tracker_project_milestone_attached";
import * as attachModule from "../adapters/_shared/src/attach_project_milestone";
import {
  MilestoneAttachmentError,
  isMilestonePermanentRefusal,
  milestoneBindingPresent,
} from "../adapters/_shared/src/attach_project_milestone";
import {
  milestoneIdFromLinearMilestone,
  parseMilestoneToken,
} from "../adapters/_shared/src/milestone_token";

const PLUGIN_ROOT = join(import.meta.dir, "..");

// ───────────────────────────────────────────────────────────────────────
// Fixtures. The token is CALLED, never hand-spelled, so this file cannot
// disagree with the minter it is supposed to agree with.
// ───────────────────────────────────────────────────────────────────────

/** The identifier Linear allocated for the milestone object. */
const MILESTONE_UUID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
/** The milestone token — DERIVED, so a minter change cannot silently pass. */
const TOKEN = milestoneIdFromLinearMilestone(MILESTONE_UUID);
/** The human title the operator typed when the milestone was created. */
const HUMAN_TITLE = "Waiting States II";
/** The canonical plan-heading name: `<token> — <title>`. */
const CANONICAL = `${TOKEN} — ${HUMAN_TITLE}`;
/** The Linear project the attach searches. */
const PROJECT = "DPT";
/** The FR ticket being bound. */
const TICKET = "STE-540";

/**
 * The DECOY. Its `name` byte-equals the canonical name — exactly what
 * `existing.find(m => m.name === milestoneName)` picks today — while its
 * identifier derives to a DIFFERENT token, which the reader would reject.
 */
const DECOY_UUID = "9c1d2e3f-5717-4562-b3fc-2c963f66afa6";
/** A third, unrelated milestone identifier (silent-swap simulation). */
const OTHER_UUID = "a1b2c3d4-5717-4562-b3fc-2c963f66afa6";

/**
 * ISOLATION HALF of AC.1's decoy control: a flip INSIDE the six-char window
 * the derivation reads (`uuid.slice(0, 6)`). A flip OUTSIDE that window
 * leaves the token identical and would make the leg pass vacuously, which is
 * why `OUTSIDE_WINDOW_UUID` below is asserted rather than assumed.
 */
const INSIDE_WINDOW_UUID = "3fb85f64-5717-4562-b3fc-2c963f66afa6";
/** Same milestone, a character flipped at index 7 — outside the window. */
const OUTSIDE_WINDOW_UUID = "3fa85f65-5717-4562-b3fc-2c963f66afa6";

/** The grandfathered numeric leg's canonical name. */
const NUMERIC_CANONICAL = "M31 — Tracker Workflow Hardening";

const UUID_SHAPE_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

describe("STE-540 fixture guards — the legs cannot pass by accident", () => {
  test("the token routes to the NEW by-id arm, not the grandfathered numeric one", () => {
    expect(parseMilestoneToken(TOKEN)?.kind).toBe("epic");
    expect(parseMilestoneToken("M31")?.kind).toBe("numeric");
  });

  test("the decoy and the swap identifiers derive to DIFFERENT tokens", () => {
    expect(milestoneIdFromLinearMilestone(DECOY_UUID)).not.toBe(TOKEN);
    expect(milestoneIdFromLinearMilestone(OTHER_UUID)).not.toBe(TOKEN);
    expect(milestoneIdFromLinearMilestone(DECOY_UUID)).not.toBe(
      milestoneIdFromLinearMilestone(OTHER_UUID),
    );
  });

  test("the mutation is INSIDE the derivation window; the control flip is outside", () => {
    // Inside the window ⇒ a different token (the mutation the leg relies on).
    expect(milestoneIdFromLinearMilestone(INSIDE_WINDOW_UUID)).not.toBe(TOKEN);
    // Outside the window ⇒ the SAME token. This is why an outside flip would
    // make the isolation leg vacuous.
    expect(milestoneIdFromLinearMilestone(OUTSIDE_WINDOW_UUID)).toBe(TOKEN);
  });

  test("the canonical name can never byte-equal the milestone's human title", () => {
    expect(CANONICAL).not.toBe(HUMAN_TITLE);
    expect(CANONICAL.startsWith(`${TOKEN} `)).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────
// Object-binding double — in-memory, counting every op, recording order.
// ───────────────────────────────────────────────────────────────────────

interface MilestoneRow {
  name: string;
  /** OPTIONAL — STE-539 widened the row so no existing double needs editing. */
  id?: string;
}

interface ObjectDoubleOptions {
  milestones?: MilestoneRow[];
  /** When defined, EVERY read-back returns this (silent-swap simulation). */
  forceVerify?: { name: string; id?: string } | null;
  /** The identifier `saveMilestone` would allocate for a freshly created row. */
  nextMilestoneId?: string;
  /**
   * AC.4(c): a tracker that REJECTS an identifier in the `milestone:` param
   * and accepts only a name — the fallback the corrected adapter doc admits.
   */
  rejectIdShaped?: boolean;
}

interface ObjectDouble {
  milestones: MilestoneRow[];
  attached: MilestoneRow | null;
  forceVerify?: { name: string; id?: string } | null;
  nextMilestoneId: string;
  rejectIdShaped: boolean;
  listMilestonesCalls: number;
  saveMilestoneCalls: number;
  upsertTicketMetadataCalls: number;
  getIssueCalls: number;
  /** Every `meta.milestone` value written, in order. */
  upsertArgs: string[];
  /** Op names in call order — AC.3's byte-for-byte control. */
  calls: string[];
  provider: Record<string, unknown>;
}

function makeObjectDouble(opts: ObjectDoubleOptions = {}): ObjectDouble {
  const d: ObjectDouble = {
    milestones: (opts.milestones ?? []).map((m) => ({ ...m })),
    attached: null,
    forceVerify: opts.forceVerify,
    nextMilestoneId: opts.nextMilestoneId ?? "ffffffff-0000-4000-8000-000000000000",
    rejectIdShaped: opts.rejectIdShaped ?? false,
    listMilestonesCalls: 0,
    saveMilestoneCalls: 0,
    upsertTicketMetadataCalls: 0,
    getIssueCalls: 0,
    upsertArgs: [],
    calls: [],
    provider: {},
  };
  // Arrow-function properties: production destructures some ops off the
  // provider and calls them unbound.
  d.provider = {
    listMilestones: async (_project: string): Promise<MilestoneRow[]> => {
      d.listMilestonesCalls += 1;
      d.calls.push("listMilestones");
      return d.milestones.map((m) => ({ ...m }));
    },
    saveMilestone: async (_project: string, o: { name: string }): Promise<void> => {
      d.saveMilestoneCalls += 1;
      d.calls.push("saveMilestone");
      d.milestones.push({ name: o.name, id: d.nextMilestoneId });
    },
    upsertTicketMetadata: async (
      ticketId: string,
      meta: { milestone?: string },
    ): Promise<string> => {
      d.upsertTicketMetadataCalls += 1;
      d.calls.push("upsertTicketMetadata");
      const value = meta.milestone;
      if (value !== undefined) d.upsertArgs.push(value);
      if (d.rejectIdShaped && value !== undefined && UUID_SHAPE_RE.test(value)) {
        throw new Error(
          `Linear: milestone "${value}" was not accepted as an identifier on this workspace`,
        );
      }
      if (value !== undefined) {
        const row =
          d.milestones.find((m) => m.id !== undefined && m.id === value) ??
          d.milestones.find((m) => m.name === value);
        d.attached = row ? { ...row } : { name: value };
      }
      return ticketId;
    },
    getIssue: async (
      _ticketId: string,
    ): Promise<{ projectMilestone: { name: string; id?: string } | null }> => {
      d.getIssueCalls += 1;
      d.calls.push("getIssue");
      if (d.forceVerify !== undefined) return { projectMilestone: d.forceVerify };
      return { projectMilestone: d.attached ? { ...d.attached } : null };
    },
  };
  return d;
}

type AttachResult = { capability: string | null; createdName?: string; epicKey?: string };

// Cast keeps this file compiling against whatever the shipped MilestoneOps
// type is; at runtime the real module runs, so a wrong binding fails via
// assertion rather than a TypeError.
const attach = attachModule.attachProjectMilestone as unknown as (
  provider: unknown,
  project: string,
  milestoneName: string,
  ticketId: string,
  opts?: { sleep?: (ms: number) => Promise<void> },
) => Promise<AttachResult>;

function sleepRecorder(): { sleeps: number[]; sleep: (ms: number) => Promise<void> } {
  const sleeps: number[] = [];
  return {
    sleeps,
    sleep: async (ms: number) => {
      sleeps.push(ms);
    },
  };
}

async function attachCatching(
  d: ObjectDouble,
  project: string,
  name: string,
  rec: { sleep: (ms: number) => Promise<void> },
): Promise<Error | null> {
  try {
    await attach(d.provider, project, name, TICKET, { sleep: rec.sleep });
    return null;
  } catch (e) {
    return e instanceof Error ? e : new Error(String(e));
  }
}

// ───────────────────────────────────────────────────────────────────────
// AC-STE-540.1 — the join is by IDENTIFIER; name equality is not consulted.
// ───────────────────────────────────────────────────────────────────────

describe("AC-STE-540.1 — match-by-key: milestoneIdFromLinearMilestone(id) === token", () => {
  /**
   * Three rows, and the target is NEITHER first NOR alone: a `list[0]` or
   * first-match implementation picks the decoy and fails this leg.
   */
  function decoyStore(realId: string = MILESTONE_UUID): MilestoneRow[] {
    return [
      { name: "Unrelated milestone", id: OTHER_UUID },
      // The decoy: name byte-equals the canonical name.
      { name: CANONICAL, id: DECOY_UUID },
      { name: HUMAN_TITLE, id: realId },
    ];
  }

  test("a name-matching DECOY loses to the identifier-matching milestone", async () => {
    const d = makeObjectDouble({ milestones: decoyStore() });
    const rec = sleepRecorder();
    const result = await attach(d.provider, PROJECT, CANONICAL, TICKET, { sleep: rec.sleep });

    // The write named the REAL milestone's identifier, exactly once.
    expect(d.upsertArgs).toEqual([MILESTONE_UUID]);
    expect(d.upsertTicketMetadataCalls).toBe(1);
    // …and never the decoy's, nor the canonical NAME the decoy carries.
    expect(d.upsertArgs).not.toContain(DECOY_UUID);
    expect(d.upsertArgs).not.toContain(CANONICAL);
    expect(d.attached).toEqual({ name: HUMAN_TITLE, id: MILESTONE_UUID });

    // One enumeration, no mint, and the attach reports a clean bind.
    expect(d.listMilestonesCalls).toBe(1);
    expect(d.saveMilestoneCalls).toBe(0);
    expect(result.capability).toBeNull();
    expect(result.createdName).toBeUndefined();
    expect(rec.sleeps).toEqual([]);
  });

  test("ISOLATION: flip a character INSIDE the derivation window ⇒ the same call refuses", async () => {
    // Same array, same order, same decoy carrying the canonical NAME. The
    // ONLY change is one character inside `uuid.slice(0, 6)`. If the pass
    // above came from array order or from a surviving name compare, this
    // still binds — so this leg is what makes the previous one mean
    // "the derivation decided it".
    const d = makeObjectDouble({ milestones: decoyStore(INSIDE_WINDOW_UUID) });
    const rec = sleepRecorder();
    const err = await attachCatching(d, PROJECT, CANONICAL, rec);

    expect(err).not.toBeNull();
    expect(err!.name).toBe("MilestoneObjectNotFoundError");
    expect(d.upsertArgs).toEqual([]);
    expect(d.upsertTicketMetadataCalls).toBe(0);
    expect(d.saveMilestoneCalls).toBe(0);
    // An independent STATE witness beside the counter. `saveMilestone` pushes
    // a row, so a create is visible in the store whether or not the counter
    // fires — without this, the zero above rests entirely on AC.3's numeric
    // miss leg being the only thing in the file that ever drives that counter
    // above zero, and weakening THAT leg would silently un-falsify this one.
    expect(d.milestones.length).toBe(decoyStore(INSIDE_WINDOW_UUID).length);
  });

  test("CONTROL: the same flip OUTSIDE the window changes nothing — the bind lands", async () => {
    const d = makeObjectDouble({ milestones: decoyStore(OUTSIDE_WINDOW_UUID) });
    const rec = sleepRecorder();
    const result = await attach(d.provider, PROJECT, CANONICAL, TICKET, { sleep: rec.sleep });
    expect(d.upsertArgs).toEqual([OUTSIDE_WINDOW_UUID]);
    expect(result.capability).toBeNull();
  });

  test("the identifier-matching milestone wins even when NO milestone carries the canonical name", async () => {
    const d = makeObjectDouble({
      milestones: [
        { name: "Unrelated milestone", id: OTHER_UUID },
        { name: "Another unrelated milestone", id: DECOY_UUID },
        { name: HUMAN_TITLE, id: MILESTONE_UUID },
      ],
    });
    const rec = sleepRecorder();
    const result = await attach(d.provider, PROJECT, CANONICAL, TICKET, { sleep: rec.sleep });
    expect(d.upsertArgs).toEqual([MILESTONE_UUID]);
    expect(d.saveMilestoneCalls).toBe(0);
    expect(result.capability).toBeNull();
  });

  test("no name string-comparison survives: a milestone whose NAME is the token alone is not picked", async () => {
    const d = makeObjectDouble({
      milestones: [
        { name: TOKEN, id: DECOY_UUID },
        { name: CANONICAL, id: OTHER_UUID },
        { name: HUMAN_TITLE, id: MILESTONE_UUID },
      ],
    });
    const rec = sleepRecorder();
    await attach(d.provider, PROJECT, CANONICAL, TICKET, { sleep: rec.sleep });
    expect(d.upsertArgs).toEqual([MILESTONE_UUID]);
  });
});

// ───────────────────────────────────────────────────────────────────────
// AC-STE-540.2 — the verify re-derives from the READ-BACK identifier.
// ───────────────────────────────────────────────────────────────────────

describe("AC-STE-540.2 — post-write verify derives the read-back identifier back to the token", () => {
  /** The silent-swap read-back: right name, wrong identifier. */
  const SWAPPED = { name: CANONICAL, id: OTHER_UUID };

  test("POSITIVE CONTROL: the shipped name-only verify PASSES this fixture", () => {
    // The expression at attach_project_milestone.ts:683, copied verbatim:
    //   read: (fresh) => fresh.projectMilestone?.name ?? null
    // …compared against `expected = milestoneName`. It accepts the swap, which
    // is exactly why an id-verify is needed. Without this control the leg
    // below could pass on a fixture the OLD code already rejected.
    const nameOnlyProjection = (fresh: { projectMilestone?: { name: string } | null }) =>
      fresh.projectMilestone?.name ?? null;
    expect(nameOnlyProjection({ projectMilestone: SWAPPED })).toBe(CANONICAL);
  });

  test("a swapped identifier raises MilestoneAttachmentError with binding 'milestone-id'", async () => {
    const d = makeObjectDouble({
      milestones: [
        { name: "Unrelated milestone", id: DECOY_UUID },
        { name: HUMAN_TITLE, id: MILESTONE_UUID },
      ],
      forceVerify: SWAPPED,
    });
    const rec = sleepRecorder();
    const err = await attachCatching(d, PROJECT, CANONICAL, rec);

    expect(err).not.toBeNull();
    expect(err).toBeInstanceOf(MilestoneAttachmentError);
    const e = err as MilestoneAttachmentError;
    expect(e.binding).toBe("milestone-id");
    expect(e.expected).toBe(TOKEN);
    // `writeAndVerify` compares `actual !== expected`, so the read side must
    // project to a TOKEN — the swapped milestone's own derivation.
    expect(e.actual).toBe(milestoneIdFromLinearMilestone(OTHER_UUID));

    // NFR-10 canonical shape: verdict line + Remedy: + Context:.
    expect(e.message).toMatch(/^MilestoneAttachmentError: /);
    expect(e.message).toMatch(/\nRemedy: /);
    expect(e.message).toMatch(/\nContext: /);
    // Linear-specific remedy naming the IDENTIFIER — not merely the token
    // again: blank the token out and the uuid must still be there.
    expect(e.message).toContain("mcp__linear__get_issue");
    expect(e.message.split(TOKEN).join("<token>")).toContain(MILESTONE_UUID);

    // Non-retry is a COUNT, not an impression: `retryTransient` rethrows this
    // class unretried (attach_project_milestone.ts:398).
    expect(rec.sleeps).toEqual([]);
    expect(d.upsertTicketMetadataCalls).toBe(1);
    expect(d.getIssueCalls).toBe(1);
  });

  test("the milestone-id remedy is its OWN, not the object remedy by fallthrough", () => {
    // `binding` is a string union with an object-remedy DEFAULT arm, so a new
    // member that nobody branched on renders the old Linear name remedy and
    // reads like a pass. Pinned here so `tests/m135-ste-525-executable-remedy`'s
    // pairwise-distinctness count cannot be satisfied by the fallthrough.
    const remedyFor = (binding: string): string => {
      const Ctor = MilestoneAttachmentError as unknown as new (
        expected: string,
        actual: string | null,
        binding: string,
        identifier?: string,
      ) => MilestoneAttachmentError;
      const message = new Ctor(TOKEN, "M_a1b2c3", binding, MILESTONE_UUID).message;
      const line = message.split("\n").find((l) => l.startsWith("Remedy: "));
      expect(line).toBeDefined();
      return line!.slice("Remedy: ".length);
    };
    expect(remedyFor("milestone-id")).not.toBe(remedyFor("object"));
    expect(remedyFor("milestone-id")).not.toBe(remedyFor("label"));
    expect(remedyFor("milestone-id")).not.toBe(remedyFor("epic"));
    // Linear-specific, and it names the identifier rather than the name.
    expect(remedyFor("milestone-id")).toContain("mcp__linear__get_issue");
    expect(remedyFor("milestone-id")).toContain(MILESTONE_UUID);
  });

  test("a read-back with NO identifier at all is a mismatch, not a silent pass", async () => {
    const d = makeObjectDouble({
      milestones: [
        { name: "Unrelated milestone", id: DECOY_UUID },
        { name: HUMAN_TITLE, id: MILESTONE_UUID },
      ],
      forceVerify: { name: CANONICAL },
    });
    const rec = sleepRecorder();
    const err = await attachCatching(d, PROJECT, CANONICAL, rec);
    expect(err).toBeInstanceOf(MilestoneAttachmentError);
    expect((err as MilestoneAttachmentError).binding).toBe("milestone-id");
    expect((err as MilestoneAttachmentError).actual).toBeNull();
    expect(rec.sleeps).toEqual([]);
  });

  test("the matching identifier read back VERIFIES — the error is not unconditional", async () => {
    const d = makeObjectDouble({
      milestones: [
        { name: "Unrelated milestone", id: DECOY_UUID },
        { name: HUMAN_TITLE, id: MILESTONE_UUID },
      ],
      // A DIFFERENT human name on the read-back: only the identifier decides.
      forceVerify: { name: "Renamed by an operator mid-milestone", id: MILESTONE_UUID },
    });
    const rec = sleepRecorder();
    const result = await attach(d.provider, PROJECT, CANONICAL, TICKET, { sleep: rec.sleep });
    expect(result.capability).toBeNull();
    expect(rec.sleeps).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────
// AC-STE-540.3 — the grandfathered numeric path, byte-for-byte.
// ───────────────────────────────────────────────────────────────────────

describe("AC-STE-540.3 — a numeric M<N> token keeps the shipped match-by-name path", () => {
  test("found-by-name: call ORDER is exactly listMilestones → upsertTicketMetadata → getIssue", async () => {
    const d = makeObjectDouble({
      milestones: [
        { name: "Unrelated milestone", id: OTHER_UUID },
        { name: "Another unrelated milestone" },
        { name: NUMERIC_CANONICAL },
      ],
    });
    const rec = sleepRecorder();
    const result = await attach(d.provider, PROJECT, NUMERIC_CANONICAL, TICKET, {
      sleep: rec.sleep,
    });
    expect(d.calls).toEqual(["listMilestones", "upsertTicketMetadata", "getIssue"]);
    // The NAME is written, never an identifier.
    expect(d.upsertArgs).toEqual([NUMERIC_CANONICAL]);
    expect(UUID_SHAPE_RE.test(d.upsertArgs[0]!)).toBe(false);
    expect(d.saveMilestoneCalls).toBe(0);
    expect(result.capability).toBeNull();
    expect(result.createdName).toBeUndefined();
    expect(rec.sleeps).toEqual([]);
  });

  test("miss: call ORDER is listMilestones → saveMilestone → upsertTicketMetadata → getIssue", async () => {
    // POSITIVE CONTROL for AC.5's `saveMilestoneCalls === 0`: the same double
    // implementation increments this counter here, so a zero there is real.
    const d = makeObjectDouble({
      milestones: [
        { name: "Unrelated milestone", id: OTHER_UUID },
        { name: "Another unrelated milestone" },
      ],
    });
    const rec = sleepRecorder();
    const result = await attach(d.provider, PROJECT, "M31 — New", TICKET, { sleep: rec.sleep });
    expect(d.calls).toEqual([
      "listMilestones",
      "saveMilestone",
      "upsertTicketMetadata",
      "getIssue",
    ]);
    expect(d.saveMilestoneCalls).toBe(1);
    expect(d.upsertArgs).toEqual(["M31 — New"]);
    expect(result.capability).toBe("milestone_create_required");
    expect(result.createdName).toBe("M31 — New");
  });

  test("BYTE-FOR-BYTE: a numeric-token milestone whose id derives elsewhere STILL binds (name wins)", async () => {
    // `milestoneIdFromLinearMilestone(OTHER_UUID)` is unrelated to `M31`. On
    // the numeric route that is irrelevant — the identifier is never read.
    expect(milestoneIdFromLinearMilestone(OTHER_UUID)).not.toBe("M31");
    const d = makeObjectDouble({
      milestones: [
        { name: "Unrelated milestone", id: MILESTONE_UUID },
        { name: NUMERIC_CANONICAL, id: OTHER_UUID },
      ],
    });
    const rec = sleepRecorder();
    const result = await attach(d.provider, PROJECT, NUMERIC_CANONICAL, TICKET, {
      sleep: rec.sleep,
    });
    expect(d.calls).toEqual(["listMilestones", "upsertTicketMetadata", "getIssue"]);
    expect(d.upsertArgs).toEqual([NUMERIC_CANONICAL]);
    expect(d.saveMilestoneCalls).toBe(0);
    expect(result.capability).toBeNull();
  });

  test("id-less rows are SKIPPED on the by-id arm rather than derived from", async () => {
    // The claim behind "no existing double needs editing": every shipped
    // `listMilestones` stub returns `{ name }[]`, so the by-id arm must
    // tolerate `id === undefined` — refusing cleanly, not crashing in the
    // derivation.
    const d = makeObjectDouble({
      milestones: [{ name: "Unrelated milestone" }, { name: HUMAN_TITLE }, { name: CANONICAL }],
    });
    const rec = sleepRecorder();
    const err = await attachCatching(d, PROJECT, CANONICAL, rec);
    expect(err).not.toBeNull();
    expect(err!.name).toBe("MilestoneObjectNotFoundError");
    expect(err!.message).not.toMatch(/not a well-formed Linear milestone identifier/);
    expect(d.saveMilestoneCalls).toBe(0);
  });

  test("the widened row keeps `id` OPTIONAL on MilestoneOps.listMilestones", () => {
    const src = readFileSync(
      join(PLUGIN_ROOT, "adapters/_shared/src/attach_project_milestone.ts"),
      "utf-8",
    );
    const decl = /listMilestones\(project: string\): Promise<\{([^}]*)\}\[\]>/.exec(src);
    expect(decl).not.toBeNull();
    expect(decl![1]).toMatch(/id\?:\s*string/);
    // Non-optional would force every shipped double to grow the field.
    expect(decl![1]).not.toMatch(/[^?]\bid:\s*string/);
  });

  test("the sibling doubles stayed UNCHANGED — none of them grew an `id`", () => {
    const siblingTest = join(
      PLUGIN_ROOT,
      "adapters/_shared/src/attach_project_milestone.test.ts",
    );
    const src = readFileSync(siblingTest, "utf-8");
    // The 19 `milestones:` stub sites and the `makeProvider` factory's row
    // type are the claim: the object branch's existing coverage did not have
    // to be rewritten to accommodate this FR.
    expect(src.split("milestones:").length - 1).toBe(19);
    expect(src).toContain("milestones: { name: string }[];");
    expect(src).toContain("async listMilestones(project: string): Promise<{ name: string }[]> {");

    // …and the other `listMilestones` implementers are all still there.
    const implementers = [
      "adapters/_shared/src/tracker_provider.ts",
      "adapters/_shared/src/provider.ts",
      "adapters/_shared/src/next_free_milestone_number.ts",
      "adapters/jira/src/list_milestones.ts",
      "adapters/_shared/src/backfill_milestone_labels.test.ts",
      "adapters/_shared/src/assert_milestone_binding_at_archive.test.ts",
      "adapters/_shared/src/epic_first_allocation.test.ts",
      "tests/list-milestones-provider.test.ts",
    ];
    expect(implementers.filter((p) => !existsSync(join(PLUGIN_ROOT, p)))).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────
// AC-STE-540.4 — the false claim is corrected on BOTH surfaces, one scan.
// ───────────────────────────────────────────────────────────────────────

/**
 * The verbatim `mcp__linear__save_issue` tool-schema phrase for the
 * `milestone` parameter, checked against the live Linear MCP schema.
 */
const SCHEMA_PHRASE = "Milestone name or ID";
/** The false claim both surfaces shipped. */
const FALSE_CLAIM_RE = /not an ID/;

interface ClaimScan {
  hasSchemaPhrase: boolean;
  hasFalseClaim: boolean;
  ok: boolean;
}

/**
 * ONE scan, run over BOTH surfaces, so they cannot drift. Proved by a
 * negative fixture below — a doc grep with no negative fixture asserts
 * nothing.
 */
function scanMilestoneParamClaim(text: string): ClaimScan {
  const hasSchemaPhrase = text.includes(SCHEMA_PHRASE);
  const hasFalseClaim = FALSE_CLAIM_RE.test(text);
  return { hasSchemaPhrase, hasFalseClaim, ok: hasSchemaPhrase && !hasFalseClaim };
}

/** `adapters/linear.md:208`, recorded verbatim before the change. */
const PRE_CHANGE_LINEAR_MD =
  "3. Attach the ticket via `mcp__linear__save_issue(id=ticket_id, milestone=milestone_name)` " +
  "— the parameter is the milestone *name* (string), not an ID.";
/** The object remedy at `attach_project_milestone.ts:59`, recorded verbatim. */
const PRE_CHANGE_OBJECT_REMEDY =
  "re-fetch the ticket via mcp__linear__get_issue and confirm the projectMilestone.name field; " +
  "if Linear silently dropped the param, verify the adapter is forwarding `milestone:` as a " +
  "string (not an ID) to mcp__linear__save_issue. Re-run /implement Phase 1 to retry.";

const CLAIM_SURFACES = [
  "adapters/linear.md",
  "adapters/_shared/src/attach_project_milestone.ts",
] as const;

describe("AC-STE-540.4 — the milestone param is documented as a name OR an ID", () => {
  test("the scan FAILS on both pre-change strings (proof it can fail)", () => {
    expect(scanMilestoneParamClaim(PRE_CHANGE_LINEAR_MD)).toEqual({
      hasSchemaPhrase: false,
      hasFalseClaim: true,
      ok: false,
    });
    expect(scanMilestoneParamClaim(PRE_CHANGE_OBJECT_REMEDY)).toEqual({
      hasSchemaPhrase: false,
      hasFalseClaim: true,
      ok: false,
    });
  });

  test("both surfaces are scanned — not one of them", () => {
    expect(CLAIM_SURFACES.length).toBe(2);
    expect(CLAIM_SURFACES.filter((p) => !existsSync(join(PLUGIN_ROOT, p)))).toEqual([]);
  });

  test("both surfaces carry the schema phrase and neither carries the false claim", () => {
    expect(
      CLAIM_SURFACES.map((p) => ({
        surface: p,
        ...scanMilestoneParamClaim(readFileSync(join(PLUGIN_ROOT, p), "utf-8")),
      })),
    ).toEqual([
      {
        surface: "adapters/linear.md",
        hasSchemaPhrase: true,
        hasFalseClaim: false,
        ok: true,
      },
      {
        surface: "adapters/_shared/src/attach_project_milestone.ts",
        hasSchemaPhrase: true,
        hasFalseClaim: false,
        ok: true,
      },
    ]);
  });

  test("name-resolution fallback: an id-rejecting tracker retries once with found.name", async () => {
    const d = makeObjectDouble({
      milestones: [
        { name: "Unrelated milestone", id: OTHER_UUID },
        // The decoy still carries the canonical name — the fallback must use
        // the FOUND milestone's own name, not the requested canonical one.
        { name: CANONICAL, id: DECOY_UUID },
        { name: HUMAN_TITLE, id: MILESTONE_UUID },
      ],
      rejectIdShaped: true,
    });
    const rec = sleepRecorder();
    const result = await attach(d.provider, PROJECT, CANONICAL, TICKET, { sleep: rec.sleep });

    expect(result).toEqual({ capability: null });
    // The identifier FIRST, then the found milestone's own name — in order.
    expect(d.upsertArgs).toEqual([MILESTONE_UUID, HUMAN_TITLE]);
    expect(d.upsertTicketMetadataCalls).toBe(2);
    // The count IS the "one list_milestones lookup" claim: a re-enumerating
    // implementation reads 2.
    expect(d.listMilestonesCalls).toBe(1);
    // The fallback lives inside `write`, so it never rides the transient
    // backoff schedule.
    expect(rec.sleeps).toEqual([]);
    expect(d.saveMilestoneCalls).toBe(0);
  });
});

// ───────────────────────────────────────────────────────────────────────
// AC-STE-540.5 — a token with no matching milestone is REFUSED, never minted.
// ───────────────────────────────────────────────────────────────────────

describe("AC-STE-540.5 — no milestone derives to the token ⇒ refuse, never create", () => {
  test("MilestoneObjectNotFoundError names the token and the project, and mints nothing", async () => {
    const d = makeObjectDouble({
      milestones: [
        { name: "Unrelated milestone", id: OTHER_UUID },
        // Even a byte-equal NAME match must not rescue it.
        { name: CANONICAL, id: DECOY_UUID },
        { name: HUMAN_TITLE },
      ],
    });
    const rec = sleepRecorder();
    const err = await attachCatching(d, PROJECT, CANONICAL, rec);

    expect(err).not.toBeNull();
    expect(err!.name).toBe("MilestoneObjectNotFoundError");
    expect(isMilestonePermanentRefusal(err)).toBe(true);
    // NFR-10 canonical shape.
    expect(err!.message).toMatch(/\nRemedy: /);
    expect(err!.message).toMatch(/\nContext: /);
    expect(err!.message).toContain(TOKEN);
    // Names the PROJECT it searched, not merely the token again.
    expect(err!.message.split(TOKEN).join("<token>")).toContain(PROJECT);

    // Every absence is a COUNT. The counter's positive control is AC.3's
    // numeric miss leg, which drives `saveMilestoneCalls === 1` on this same
    // double implementation.
    expect(d.saveMilestoneCalls).toBe(0);
    expect(d.upsertTicketMetadataCalls).toBe(0);
    expect(d.upsertArgs).toEqual([]);
    expect(d.milestones.length).toBe(3);
    // Raised OUTSIDE `retryTransient` — a refusal is a decision, not a transient.
    expect(rec.sleeps).toEqual([]);
  });

  test("an EMPTY project refuses too — it does not fall back to auto-create", async () => {
    const d = makeObjectDouble({ milestones: [] });
    const rec = sleepRecorder();
    const err = await attachCatching(d, PROJECT, CANONICAL, rec);
    expect(err!.name).toBe("MilestoneObjectNotFoundError");
    expect(d.saveMilestoneCalls).toBe(0);
    expect(d.milestones).toEqual([]);
    expect(d.upsertTicketMetadataCalls).toBe(0);
  });

  test("the refusal is a MilestonePermanentRefusalError subclass, exported by name", () => {
    const ctor = (attachModule as unknown as Record<string, unknown>)[
      "MilestoneObjectNotFoundError"
    ];
    expect(typeof ctor).toBe("function");
    const base = (attachModule as unknown as Record<string, unknown>)[
      "MilestonePermanentRefusalError"
    ];
    expect(
      Object.getPrototypeOf(ctor as new (...a: never[]) => unknown) === base,
    ).toBe(true);
  });

  test("a MINTED milestone could never sanitize back to the token (why refusing is right)", () => {
    // The identifier `saveMilestone` would allocate is the tracker's, not the
    // operator's — so the token derived from it is a different token by
    // construction. This is the reason the miss branch is gone, recorded as
    // an assertion rather than a comment.
    const fresh = "ffffffff-0000-4000-8000-000000000000";
    expect(milestoneIdFromLinearMilestone(fresh)).not.toBe(TOKEN);
  });
});

// ───────────────────────────────────────────────────────────────────────
// Cross-surface — writer and reader agree, and BOTH types admit `id`.
// ───────────────────────────────────────────────────────────────────────

describe("STE-540 cross-surface — milestoneBindingPresent reads what the writer wrote", () => {
  test("the real identifier is present; the decoy's is not", () => {
    expect(
      milestoneBindingPresent(
        { projectMilestone: { name: HUMAN_TITLE, id: MILESTONE_UUID } } as never,
        CANONICAL,
        "object",
      ),
    ).toBe(true);
    expect(
      milestoneBindingPresent(
        { projectMilestone: { name: CANONICAL, id: DECOY_UUID } } as never,
        CANONICAL,
        "object",
      ),
    ).toBe(false);
  });

  test("a numeric canonical name still reads by NAME on the object binding", () => {
    expect(
      milestoneBindingPresent(
        { projectMilestone: { name: NUMERIC_CANONICAL, id: OTHER_UUID } } as never,
        NUMERIC_CANONICAL,
        "object",
      ),
    ).toBe(true);
    expect(
      milestoneBindingPresent(
        { projectMilestone: { name: "M31 — Something Else" } } as never,
        NUMERIC_CANONICAL,
        "object",
      ),
    ).toBe(false);
  });

  /**
   * `TicketMilestoneView.projectMilestone` and `milestoneBindingPresent`'s
   * SEPARATE inline parameter type are two different declarations. Widening
   * one alone is exactly the sibling-surface drift this FR exists to stop, so
   * BOTH are pinned — and the site COUNT is pinned too, so a third site
   * cannot appear un-widened.
   */
  const SITE_RE = /projectMilestone\?:\s*\{([^}]*)\}/g;

  function projectMilestoneSites(src: string): { body: string; admitsId: boolean }[] {
    return [...src.matchAll(SITE_RE)].map((m) => ({
      body: m[1]!,
      admitsId: /\bid\?:\s*string/.test(m[1]!),
    }));
  }

  test("NEGATIVE FIXTURE: the site scan fails when only ONE site is widened", () => {
    const halfWidened =
      "export interface TicketMilestoneView {\n" +
      "  projectMilestone?: { name: string; id?: string } | null;\n" +
      "}\n" +
      "export function milestoneBindingPresent(\n" +
      "  issue: { projectMilestone?: { name: string } | null; labels?: string[] },\n" +
      ") {}\n";
    const sites = projectMilestoneSites(halfWidened);
    expect(sites.length).toBe(2);
    expect(sites.map((s) => s.admitsId)).toEqual([true, false]);
  });

  test("BOTH declaration sites in attach_project_milestone.ts admit `id`", () => {
    const src = readFileSync(
      join(PLUGIN_ROOT, "adapters/_shared/src/attach_project_milestone.ts"),
      "utf-8",
    );
    const sites = projectMilestoneSites(src);
    // TicketMilestoneView + milestoneBindingPresent's inline param.
    expect(sites.length).toBe(2);
    expect(sites.map((s) => s.admitsId)).toEqual([true, true]);
  });
});

// ---------------------------------------------------------------------------
// The sleep recorder's own positive control.
// ---------------------------------------------------------------------------
//
// Every `rec.sleeps` assertion in this file is `toEqual([])` — the refusals and
// the name fallback all claim they never paid the transient backoff. Not one
// leg above ever drives a NON-empty schedule, so those empties were being read
// off a recorder never shown capable of recording: a `sleep` seam that was
// simply never wired would satisfy all of them.
//
// This leg is the missing half. It drives a genuine transient failure through
// the object branch's `writeAndVerify` and pins the canonical schedule that
// comes back, so every `toEqual([])` elsewhere in this file is a measurement.
describe("STE-540 control — the sleep recorder records when the backoff really runs", () => {
  /** A minimal object-binding provider whose upsert fails `failures` times. */
  function flakyProvider(canonical: string, row: { name: string; id?: string }, failures: number) {
    let upsertCalls = 0;
    return {
      counts: () => upsertCalls,
      provider: {
        milestoneBinding: "object" as const,
        listMilestones: async (): Promise<{ name: string; id?: string }[]> => [row],
        saveMilestone: async (): Promise<void> => {},
        upsertTicketMetadata: async (): Promise<string> => {
          upsertCalls += 1;
          // `retryTransient` classifies BY EXCLUSION — only
          // MilestoneAttachmentError is known-permanent — so a plain Error is
          // treated as possibly-transient and retried.
          if (upsertCalls <= failures) throw new Error("504 Gateway Timeout");
          return "ok";
        },
        getIssue: async (): Promise<{
          projectMilestone?: { name: string; id?: string } | null;
        }> => ({ projectMilestone: row }),
      },
      canonical,
    };
  }

  test("the grandfathered numeric arm pays the canonical 1s + 2s, recorded in order", async () => {
    // The numeric arm has no name-resolution fallback, so the schedule is
    // observed cleanly: two failed round-trips, two waits.
    const f = flakyProvider(NUMERIC_CANONICAL, { name: NUMERIC_CANONICAL, id: OTHER_UUID }, 2);
    const rec = sleepRecorder();

    await attach(f.provider, PROJECT, f.canonical, TICKET, { sleep: rec.sleep });

    // Asserted against the shared constant AND the literal, so neither can
    // drift alone. This is the leg that makes every `toEqual([])` above a
    // measurement rather than a reading off a seam that was never wired.
    expect(rec.sleeps).toEqual([
      attachModule.TRANSIENT_RETRY_SCHEDULE_MS[0]!,
      attachModule.TRANSIENT_RETRY_SCHEDULE_MS[1]!,
    ]);
    expect(rec.sleeps).toEqual([1000, 2000]);
    expect(f.counts()).toBe(3);
  });

  test("the identifier-keyed arm's name fallback ABSORBS one failure before the backoff", async () => {
    // Measured, not predicted: the same two failures cost only ONE wait here.
    // The fallback retries with `found.name` INSIDE `write`, so the first
    // failure is consumed before the round-trip ever returns to
    // `retryTransient` — an id-rejecting tracker therefore gets one fewer
    // backoff round than a plain flaky one. Pinned because it is a real
    // asymmetry between the two arms, and because a fallback that silently
    // moved OUTSIDE `write` would show up here as [1000, 2000].
    const f = flakyProvider(CANONICAL, { name: HUMAN_TITLE, id: MILESTONE_UUID }, 2);
    const rec = sleepRecorder();

    await attach(f.provider, PROJECT, f.canonical, TICKET, { sleep: rec.sleep });

    expect(rec.sleeps).toEqual([attachModule.TRANSIENT_RETRY_SCHEDULE_MS[0]!]);
    expect(rec.sleeps).toEqual([1000]);
    expect(f.counts()).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// The name fallback is backstopped by the identifier verify.
// ---------------------------------------------------------------------------
//
// The fallback's catch is deliberately broad — it cannot distinguish an
// id-rejecting workspace from a 504. That is safe only because the verify
// checks the IDENTIFIER, not the name it wrote with. These two legs measure
// that, in both directions, so the safety is a property of the code rather
// than of the comment above it.
describe("STE-540 — the name fallback cannot silently bind the wrong milestone", () => {
  test("a fallback that lands on a same-named DIFFERENT milestone is refused, not accepted", async () => {
    // The write is addressed by name; two milestones carry that name; the
    // tracker binds the other one. Only the identifier reveals it.
    let upserts = 0;
    const provider = {
      milestoneBinding: "object" as const,
      listMilestones: async (): Promise<{ name: string; id?: string }[]> => [
        { name: HUMAN_TITLE, id: MILESTONE_UUID },
      ],
      saveMilestone: async (): Promise<void> => {},
      upsertTicketMetadata: async (_t: string, meta: { milestone?: string }): Promise<string> => {
        upserts += 1;
        // Reject the identifier form, forcing the name fallback.
        if (meta.milestone && UUID_SHAPE_RE.test(meta.milestone)) throw new Error("id not accepted");
        return "ok";
      },
      // The name bound the WRONG milestone — same name, different identifier.
      getIssue: async (): Promise<{ projectMilestone?: { name: string; id?: string } | null }> => ({
        projectMilestone: { name: HUMAN_TITLE, id: DECOY_UUID },
      }),
    };
    const rec = sleepRecorder();

    await expect(
      attach(provider, PROJECT, CANONICAL, TICKET, { sleep: rec.sleep }),
    ).rejects.toThrow(MilestoneAttachmentError);

    // Both writes ran (id rejected, then name) — so the refusal is the
    // VERIFY's, not a failure to attempt the fallback at all.
    expect(upserts).toBe(2);
    // A binding mismatch is known-permanent: no backoff was paid.
    expect(rec.sleeps).toEqual([]);
  });

  test("CONTROL: the same fallback on the RIGHT milestone succeeds", async () => {
    // Without this the leg above could pass on a fallback that always fails.
    let upserts = 0;
    const provider = {
      milestoneBinding: "object" as const,
      listMilestones: async (): Promise<{ name: string; id?: string }[]> => [
        { name: HUMAN_TITLE, id: MILESTONE_UUID },
      ],
      saveMilestone: async (): Promise<void> => {},
      upsertTicketMetadata: async (_t: string, meta: { milestone?: string }): Promise<string> => {
        upserts += 1;
        if (meta.milestone && UUID_SHAPE_RE.test(meta.milestone)) throw new Error("id not accepted");
        return "ok";
      },
      getIssue: async (): Promise<{ projectMilestone?: { name: string; id?: string } | null }> => ({
        projectMilestone: { name: HUMAN_TITLE, id: MILESTONE_UUID },
      }),
    };
    const rec = sleepRecorder();

    const result = await attach(provider, PROJECT, CANONICAL, TICKET, { sleep: rec.sleep });

    expect(result).toEqual({ capability: null });
    expect(upserts).toBe(2);
    expect(rec.sleeps).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The THIRD reader — gate probe #26.
// ---------------------------------------------------------------------------
//
// The block above pins both `projectMilestone` declaration sites IN
// `attach_project_milestone.ts`. That scoping is exactly how this one was
// missed: `tracker_project_milestone_attached.ts` (probe #26) is a THIRD
// reader of the same binding, in a different file, and it routes the `object`
// binding through neither `milestoneBindingPresent` nor the shared derivation
// — it declares its own `{ projectMilestone?: { name: string } }` projection
// and byte-compares the name against the plan heading.
//
// That comparison cannot survive this milestone. A milestone minted by
// `mintMilestoneLinear` keeps the HUMAN TITLE ("Waiting States II") while the
// plan heading is the canonical `M_<6 hex> — <Title>`, so a CORRECTLY bound
// identifier-keyed FR reads as a mismatch and the gate reds — in every
// consumer project on Linear, on every such FR.
//
// Found by the REFACTOR stage reading five forks' edits as one branch. No AC
// covers it: STE-540's cross-surface requirement names two sites in one file.
// Recorded here as `underspecified`, with the fix in the same change.
describe("STE-540 cross-surface — gate probe #26 reads the identifier too", () => {
  const PROBE_FR = "STE-540";

  function probeFixture(bound: { name: string; id?: string } | null): {
    root: string;
    cleanup: () => void;
  } {
    const root = mkdtempSync(join(tmpdir(), "m139-probe26-"));
    const specs = join(root, "specs");
    mkdirSync(join(specs, "frs", "archive"), { recursive: true });
    mkdirSync(join(specs, "plan", "archive"), { recursive: true });
    writeFileSync(
      join(root, "CLAUDE.md"),
      `# Project\n\n## Task Tracking\n\nmode: linear\nmcp_server: linear\n\n### Linear\n\nteam: STE\nproject: ${PROJECT}\n`,
    );
    // The FR is bound to an IDENTIFIER-KEYED milestone — the shape this
    // milestone makes the default for new Linear milestones.
    writeFileSync(
      join(specs, "frs", `${PROBE_FR}.md`),
      `---\ntitle: t\nmilestone: ${TOKEN}\nstatus: active\narchived_at: null\ntracker:\n  linear: ${PROBE_FR}\ncreated_at: 2026-09-02T00:00:00Z\n---\n\nbody\n`,
    );
    // The plan file is named by the token, and its heading is canonical.
    writeFileSync(
      join(specs, "plan", `${TOKEN}.md`),
      `---\nmilestone: ${TOKEN}\nstatus: active\n---\n\n## ${CANONICAL} {#${TOKEN}}\n`,
    );
    return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
  }

  const lookup =
    (bound: { name: string; id?: string } | null) =>
    async (): Promise<{ projectMilestone?: { name: string; id?: string } | null }> => ({
      projectMilestone: bound,
    });

  test("a CORRECTLY bound identifier-keyed milestone is not reported as a mismatch", async () => {
    // The tracker holds the human title and the real identifier — precisely
    // what `attachProjectMilestone`'s by-id arm writes and its verify accepts.
    const fx = probeFixture({ name: HUMAN_TITLE, id: MILESTONE_UUID });
    try {
      const r = await runTrackerProjectMilestoneAttachedProbe(fx.root, {
        getIssue: lookup({ name: HUMAN_TITLE, id: MILESTONE_UUID }),
      });
      expect(r.violations).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("CONTROL: a milestone whose identifier derives elsewhere IS reported", async () => {
    // Without this leg the zero above is a claim about a probe that might
    // report nothing at all. The name still matches nothing and the id
    // derives to a different token, so a correct probe must object.
    const fx = probeFixture({ name: HUMAN_TITLE, id: DECOY_UUID });
    try {
      const r = await runTrackerProjectMilestoneAttachedProbe(fx.root, {
        getIssue: lookup({ name: HUMAN_TITLE, id: DECOY_UUID }),
      });
      expect(r.violations.length).toBeGreaterThanOrEqual(1);
    } finally {
      fx.cleanup();
    }
  });

  test("a genuine identifier-keyed failure gets its OWN remedy, not the rename order", async () => {
    // Fixing the VERDICT is not fixing the DIAGNOSTIC. A real failure still
    // reaches the message builder, and the generic object arm told the
    // operator to "rename the tracker milestone to that exact string" — which
    // on this arm overwrites the human title and does NOT restore the binding,
    // because the binding is by identifier. The remedy would break what it
    // diagnoses. This is the mirror of the Epic-keyed clause STE-525 added.
    const fx = probeFixture({ name: HUMAN_TITLE, id: DECOY_UUID });
    try {
      const r = await runTrackerProjectMilestoneAttachedProbe(fx.root, {
        getIssue: lookup({ name: HUMAN_TITLE, id: DECOY_UUID }),
      });
      expect(r.violations.length).toBe(1);
      const msg = r.violations[0]!.message;

      // The harmful instruction is gone…
      expect(msg).not.toContain("rename the tracker milestone");
      // …and the remedy says plainly that renaming is not the fix.
      expect(msg).toContain("renaming the milestone would NOT fix it");
      // It names the TOKEN that nothing derives to — the one actionable fact.
      expect(msg).toContain(TOKEN);
      // And it quotes the real schema, so the operator sends the right param.
      expect(msg).toContain("Milestone name or ID");
      // NFR-10 canonical shape survives the new arm.
      expect(msg).toMatch(/^Remedy: /m);
      expect(msg).toMatch(/^Context: /m);
    } finally {
      fx.cleanup();
    }
  });

  test("CONTROL: the grandfathered numeric arm KEEPS the rename remedy", async () => {
    // The clause above is scoped by `M_`, so a numeric milestone — where the
    // name genuinely IS the binding — must still be told to reconcile names.
    // Without this leg the scoping is unmeasured and a blanket suppression of
    // the rename remedy would read identical. Driven through the probe rather
    // than the builder, so it takes the same path a real mismatch does.
    const root = mkdtempSync(join(tmpdir(), "m139-probe26-num-"));
    try {
      const specs = join(root, "specs");
      mkdirSync(join(specs, "frs", "archive"), { recursive: true });
      mkdirSync(join(specs, "plan", "archive"), { recursive: true });
      writeFileSync(
        join(root, "CLAUDE.md"),
        `# P\n\n## Task Tracking\n\nmode: linear\nmcp_server: linear\n\n### Linear\n\nteam: STE\nproject: ${PROJECT}\n`,
      );
      writeFileSync(
        join(specs, "frs", "STE-31.md"),
        "---\ntitle: t\nmilestone: M31\nstatus: active\narchived_at: null\ntracker:\n  linear: STE-31\ncreated_at: 2026-09-02T00:00:00Z\n---\n\nbody\n",
      );
      writeFileSync(
        join(specs, "plan", "M31.md"),
        `---\nmilestone: M31\nstatus: active\n---\n\n## ${NUMERIC_CANONICAL} {#M31}\n`,
      );
      const r = await runTrackerProjectMilestoneAttachedProbe(root, {
        getIssue: async () => ({ projectMilestone: { name: "Something Else" } }),
      });
      expect(r.violations.length).toBe(1);
      expect(r.violations[0]!.message).toContain("rename the tracker milestone");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("CONTROL: an unbound ticket is still reported missing", async () => {
    const fx = probeFixture(null);
    try {
      const r = await runTrackerProjectMilestoneAttachedProbe(fx.root, {
        getIssue: lookup(null),
      });
      expect(r.violations.length).toBeGreaterThanOrEqual(1);
    } finally {
      fx.cleanup();
    }
  });
});
