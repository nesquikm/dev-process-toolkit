// STE-376 AC-STE-376.1 — centralized milestone-token union matcher.
//
// One exported matcher recognizes BOTH milestone-id shapes:
//   - `M<N>`   — sequential numeric ids (`M101`), the historical grammar
//   - `M_<key>` — opaque tracker-derived ids (`M_PROJ_500`, `M_PROJ-500`,
//     `M_0K0K0K`, `M_550e84`), fed by THREE producers of which only the first
//     is Jira: `milestoneIdFromEpicKey`, `milestoneIdFromUlid` and
//     `milestoneIdFromLinearMilestone`. Kept in step with the module header it
//     mirrors — the two are edited together or they desync.
// and rejects malformed tokens (`M`, `M_`, `Mx`, `milestone-M5`, `M5-extra`).
//
// Contract pinned here:
//   - module: `adapters/_shared/src/milestone_token.ts` (colocated with
//     plan_heading.ts per the FR's Technical Design)
//   - `isMilestoneToken(s)` — full-token boolean accept/reject
//   - `parseMilestoneToken(s)` — discriminated parse:
//       numeric  → { kind: "numeric", number: <int> }
//       epic     → { kind: "epic", key: "<key>" } (key verbatim, no case fold)
//       malformed → null
//   - STE-335 AC-7 audit leg: the private ad-hoc `M\d+` copies in the
//     consumer modules are removed in favor of this module (each consumer
//     source references `milestone_token`).
//   - `milestoneLabel` (attach_project_milestone.ts) derives the Jira label
//     from an epic-keyed canonical heading instead of throwing.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { milestoneLabel } from "./attach_project_milestone";
import {
  isMilestoneToken,
  milestoneIdFromUlid,
  parseMilestoneToken,
  PLAN_FILENAME_RE,
} from "./milestone_token";
import { mintId } from "./ulid";

describe("AC-STE-376.1 — union accept: numeric M<N>", () => {
  test("M101 is a milestone token", () => {
    expect(isMilestoneToken("M101")).toBe(true);
  });

  test("single-digit M1 is a milestone token", () => {
    expect(isMilestoneToken("M1")).toBe(true);
  });

  test("parse M101 → numeric 101", () => {
    expect(parseMilestoneToken("M101")).toEqual({ kind: "numeric", number: 101 });
  });
});

describe("AC-STE-376.1 — union accept: epic-keyed M_<key>", () => {
  test("M_PROJ_500 (underscore key) is a milestone token", () => {
    expect(isMilestoneToken("M_PROJ_500")).toBe(true);
  });

  test("M_PROJ-500 (hyphen key, raw Jira Epic key shape) is a milestone token", () => {
    expect(isMilestoneToken("M_PROJ-500")).toBe(true);
  });

  test("parse M_PROJ_500 → epic key PROJ_500 (opaque — never a number)", () => {
    expect(parseMilestoneToken("M_PROJ_500")).toEqual({ kind: "epic", key: "PROJ_500" });
  });

  test("parse M_PROJ-500 → epic key PROJ-500", () => {
    expect(parseMilestoneToken("M_PROJ-500")).toEqual({ kind: "epic", key: "PROJ-500" });
  });
});

describe("AC-STE-376.1 — malformed tokens are rejected", () => {
  const MALFORMED = ["M", "M_", "Mx", "milestone-M5", "M5-extra", ""];

  for (const token of MALFORMED) {
    test(`"${token}" is rejected by isMilestoneToken`, () => {
      expect(isMilestoneToken(token)).toBe(false);
    });

    test(`"${token}" parses to null`, () => {
      expect(parseMilestoneToken(token)).toBeNull();
    });
  }

  test("a numeric token with trailing junk is not accepted via prefix match", () => {
    // Anchoring matters: `/^M(\d+)/`-style prefix copies accept `M5-extra`.
    expect(isMilestoneToken("M5-extra")).toBe(false);
  });
});

describe("AC-STE-376.1 — milestoneLabel consumes the union grammar", () => {
  test("epic-keyed canonical heading derives milestone-M_<key> label (no throw)", () => {
    expect(milestoneLabel("M_PROJ_500 — Epic-keyed milestone")).toBe(
      "milestone-M_PROJ_500",
    );
  });

  test("numeric canonical heading label derivation is byte-unchanged", () => {
    expect(milestoneLabel("M86 — Jira Project-Milestone Support")).toBe("milestone-M86");
  });
});

// ---------------------------------------------------------------------------
// STE-335 AC-7 audit — private ad-hoc `M\d+` copies removed in favor of the
// shared matcher. Every consumer module the FR names must reference the
// shared `milestone_token` module (import or re-export); keeping a private
// copy alongside is what this audit exists to prevent.
// ---------------------------------------------------------------------------

describe("AC-STE-376.1 — consumers reference the shared matcher (STE-335 AC-7 audit)", () => {
  const sharedSrc = import.meta.dir; // adapters/_shared/src
  const CONSUMERS = [
    join(sharedSrc, "plan_heading.ts"),
    join(sharedSrc, "next_free_milestone_number.ts"),
    join(sharedSrc, "branch_milestone_scan.ts"),
    join(sharedSrc, "branch_proposal.ts"),
    join(sharedSrc, "plan_file_single_milestone.ts"),
    join(sharedSrc, "plan_ship_coherence.ts"),
    join(sharedSrc, "attach_project_milestone.ts"),
    join(sharedSrc, "migrations", "coverage.ts"),
    join(sharedSrc, "migrations", "monolith_split.ts"),
    join(sharedSrc, "..", "..", "jira", "src", "list_milestones.ts"),
    // Stage-A sweep closure — the four consumers routed through the shared
    // matcher after the first audit round; pinned so a private copy cannot
    // silently return.
    join(sharedSrc, "resolve.ts"),
    join(sharedSrc, "plan_task_fr_coverage.ts"),
    join(sharedSrc, "reconcile_tracker_local.ts"),
    join(sharedSrc, "root_hygiene.ts"),
    join(sharedSrc, "plan_lock.ts"),
    // M129 closure. Both of these route milestone recognition through the
    // shared union grammar, and BOTH shipped a private `M\\d+` first: the
    // capture predicate would have graded a genuine Jira- or tracker-less-leg
    // capture ok:false, and the argument grammar would have misrouted two of
    // the three minted forms. Registered here so the audit that exists to stop
    // a private copy returning actually covers them — until now it did not,
    // and a module comment claimed otherwise.
    join(sharedSrc, "deliver_stage_capture.ts"),
    join(sharedSrc, "deliver_argument.ts"),
    // STE-539. The Linear mint derives its milestone id from the identifier
    // the tracker allocates; it must reach the union grammar through this
    // module, never through a private `M\\d+` (or a private `M_` composer) of
    // its own — which is precisely the shape a tracker-first mint invites.
    join(sharedSrc, "mint_milestone_linear.ts"),
  ];

  for (const file of CONSUMERS) {
    test(`${file.split("/").slice(-2).join("/")} consumes milestone_token`, () => {
      const src = readFileSync(file, "utf-8");
      expect(src).toMatch(/milestone_token/);
    });
  }
});

// ---------------------------------------------------------------------------
// STE-417 AC-STE-417.1 — `milestoneIdFromUlid`: the tracker-less producer for
// the SAME opaque `M_<key>` branch `milestoneIdFromEpicKey` already feeds.
//
// No grammar change: `EPIC_KEY_SOURCE = [A-Za-z0-9][A-Za-z0-9_-]*` already
// admits a 6-char Crockford tail, so `M_F4VDTA` parses today. This block pins
// the NEW producer only:
//   - `M_${ulid.slice(23, 29)}` — the tail, sharing `acPrefix`'s offsets
//     verbatim (the minter is monotonic, so same-ms mints share LEADING
//     random chars; the tail is what diverges)
//   - Crockford charset of the derived tail (no I/L/O/U)
//   - round-trip `parseMilestoneToken(milestoneIdFromUlid(mintId()))`
//   - throw on any input that fails `ULID_REGEX` — never a silent bad id,
//     mirroring `milestoneIdFromEpicKey`'s contract
// ---------------------------------------------------------------------------

// A well-formed minted id: `fr_` + 26 Crockford chars = 29 chars total.
const MINTED = "fr_01K9ZQ8XJ4VDTAF4VDTAF4VDTA";

describe("AC-STE-417.1 — milestoneIdFromUlid derives M_<6-char tail>", () => {
  test("a minted 29-char id derives its last-6 tail", () => {
    expect(MINTED.length).toBe(29);
    expect(milestoneIdFromUlid(MINTED)).toBe("M_F4VDTA");
  });

  test("the derived id is exactly `M_${ulid.slice(23, 29)}` — acPrefix's offsets", () => {
    expect(milestoneIdFromUlid(MINTED)).toBe(`M_${MINTED.slice(23, 29)}`);
  });

  test("the tail is Crockford base32 — 6 chars, no I/L/O/U", () => {
    const id = milestoneIdFromUlid(MINTED);
    expect(id).toMatch(/^M_[0-9A-HJKMNP-TV-Z]{6}$/);
    expect(id.slice(2)).toHaveLength(6);
    expect(id.slice(2)).not.toMatch(/[ILOU]/);
  });

  test("distinct minted ids with a shared timestamp head still derive distinct tails", () => {
    const a = "fr_01K9ZQ8XJ4VDTAF4VDTAF4VDTA";
    const b = "fr_01K9ZQ8XJ4VDTAF4VDTAF4VDTB";
    expect(milestoneIdFromUlid(a)).toBe("M_F4VDTA");
    expect(milestoneIdFromUlid(b)).toBe("M_F4VDTB");
    expect(milestoneIdFromUlid(a)).not.toBe(milestoneIdFromUlid(b));
  });
});

describe("AC-STE-417.1 — round-trip through the union grammar", () => {
  test("parseMilestoneToken(milestoneIdFromUlid(mintId())) → { kind: epic, key: <6-char tail> }", () => {
    const ulid = mintId();
    const id = milestoneIdFromUlid(ulid);
    expect(parseMilestoneToken(id)).toEqual({ kind: "epic", key: ulid.slice(23, 29) });
    expect((parseMilestoneToken(id) as { kind: "epic"; key: string }).key).toHaveLength(6);
  });

  test("the derived id is accepted by isMilestoneToken", () => {
    expect(isMilestoneToken(milestoneIdFromUlid(mintId()))).toBe(true);
  });

  test("the derived id names a legal plan file under PLAN_FILENAME_RE", () => {
    expect(PLAN_FILENAME_RE.test(`${milestoneIdFromUlid(mintId())}.md`)).toBe(true);
  });

  test("re-deriving from the parsed key reproduces the id (M_ + key)", () => {
    const ulid = mintId();
    const id = milestoneIdFromUlid(ulid);
    const parsed = parseMilestoneToken(id) as { kind: "epic"; key: string };
    expect(`M_${parsed.key}`).toBe(id);
  });
});

describe("AC-STE-417.1 — throws on malformed input (never a silent bad id)", () => {
  const MALFORMED: [string, string][] = [
    ["", "empty string"],
    ["fr_", "prefix only"],
    ["fr_TOOSHORT", "body shorter than 26 chars"],
    ["01K9ZQ8XJ4VDTAF4VDTAF4VDTA", "no fr_ prefix"],
    ["fr_01K9ZQ8XJ4VDTAF4VDTAF4VDTAX", "body longer than 26 chars"],
    ["fr_01k9zq8xj4vdtaf4vdtaf4vdta", "lowercase body"],
    ["fr_I1K9ZQ8XJ4VDTAF4VDTAF4VDTA", "Crockford-excluded I in the body"],
    ["fr_L1K9ZQ8XJ4VDTAF4VDTAF4VDTA", "Crockford-excluded L in the body"],
    ["fr_O1K9ZQ8XJ4VDTAF4VDTAF4VDTA", "Crockford-excluded O in the body"],
    ["fr_U1K9ZQ8XJ4VDTAF4VDTAF4VDTA", "Crockford-excluded U in the body"],
    ["M_F4VDTA", "an already-derived milestone id"],
  ];

  for (const [input, why] of MALFORMED) {
    test(`"${input}" (${why}) throws`, () => {
      expect(() => milestoneIdFromUlid(input)).toThrow();
    });
  }

  test("the throw names the helper so the diagnostic is traceable", () => {
    expect(() => milestoneIdFromUlid("fr_NOPE")).toThrow(/milestoneIdFromUlid/);
  });
});

describe("AC-STE-417.1 — the slice(23, 29) offsets are shared with acPrefix", () => {
  const sharedSrc = import.meta.dir;

  test("both producers spell the same tail offsets", () => {
    const acPrefixSrc = readFileSync(join(sharedSrc, "ac_prefix.ts"), "utf-8");
    const tokenSrc = readFileSync(join(sharedSrc, "milestone_token.ts"), "utf-8");
    expect(acPrefixSrc).toContain("slice(23, 29)");
    expect(tokenSrc).toContain("slice(23, 29)");
  });
});

// ---------------------------------------------------------------------------
// STE-539 AC-STE-539.3 / AC-STE-539.4 — `milestoneIdFromLinearMilestone`: the
// Linear producer for the SAME opaque `M_<key>` branch `milestoneIdFromEpicKey`
// and `milestoneIdFromUlid` already feed.
//
// No grammar change: `EPIC_KEY_SOURCE = [A-Za-z0-9][A-Za-z0-9_-]*` already
// admits a 6-char hex head, so `M_550e84` parses today. This block pins the
// NEW producer only, mirroring the ULID sibling's shape above:
//   - `M_` + the LEADING SIX hex characters of the tracker's identifier
//   - the shape, independently of the literal (6 chars, epic-key charset)
//   - round-trip `parseMilestoneToken(milestoneIdFromLinearMilestone(u))`
//   - throw on any input that fails the UUID-shape gate — never a silent bad
//     id, mirroring `milestoneIdFromUlid`'s contract
//
// NOT `slice(23, 29)`: index 23 of a UUID is a HYPHEN. The dedicated leg below
// makes that decision executable rather than a comment.
//
// The function is loaded lazily and per test, so that until it exists the RED
// is scoped to these blocks instead of taking the whole file — and with it the
// STE-376/STE-417 pins above — down on a module-link error that says nothing
// about its own subject.
// ---------------------------------------------------------------------------

/** `[uuid, expected id]` — the literal table. */
const LINEAR_FIXTURES: [string, string][] = [
  ["550e8400-e29b-41d4-a716-446655440000", "M_550e84"],
  ["6f1e2d3c-4b5a-4998-8877-665544332211", "M_6f1e2d"],
  ["00000000-0000-4000-8000-000000000000", "M_000000"],
  ["ffffffff-ffff-4fff-bfff-ffffffffffff", "M_ffffff"],
];

/** The canonical fixture, named because three separate legs read it. */
const LINEAR_UUID = "550e8400-e29b-41d4-a716-446655440000";

async function loadMilestoneIdFromLinearMilestone(): Promise<(uuid: string) => string> {
  const mod = (await import("./milestone_token")) as {
    milestoneIdFromLinearMilestone?: (uuid: string) => string;
  };
  if (typeof mod.milestoneIdFromLinearMilestone !== "function") {
    throw new Error(
      "adapters/_shared/src/milestone_token.ts does not export a `milestoneIdFromLinearMilestone` function",
    );
  }
  return mod.milestoneIdFromLinearMilestone;
}

describe("AC-STE-539.3 — milestoneIdFromLinearMilestone derives M_<leading 6 hex>", () => {
  for (const [uuid, expected] of LINEAR_FIXTURES) {
    test(`${uuid} derives ${expected}`, async () => {
      const milestoneIdFromLinearMilestone = await loadMilestoneIdFromLinearMilestone();
      expect(milestoneIdFromLinearMilestone(uuid)).toBe(expected);
    });
  }

  test("the derived id is exactly `M_${uuid.slice(0, 6)}` — the LEADING six", async () => {
    const milestoneIdFromLinearMilestone = await loadMilestoneIdFromLinearMilestone();
    for (const [uuid] of LINEAR_FIXTURES) {
      expect(milestoneIdFromLinearMilestone(uuid)).toBe(`M_${uuid.slice(0, 6)}`);
    }
  });

  test("the SHAPE is pinned independently of the literals — 6 chars, epic-key charset", async () => {
    const milestoneIdFromLinearMilestone = await loadMilestoneIdFromLinearMilestone();
    // A derivation emitting four or eight characters fails here even if
    // someone updated the table above in step with it.
    for (const [uuid] of LINEAR_FIXTURES) {
      const id = milestoneIdFromLinearMilestone(uuid);
      expect(id).toMatch(/^M_[A-Za-z0-9_]{6}$/);
      expect(id.slice(2)).toHaveLength(6);
      expect(isMilestoneToken(id)).toBe(true);
    }
  });
});

describe("AC-STE-539.3 — the offsets decision is executable, not a comment", () => {
  test("slice(23, 29) lands on a hyphen and sanitizes to the malformed M__44665", async () => {
    const milestoneIdFromLinearMilestone = await loadMilestoneIdFromLinearMilestone();

    // A fact about UUIDs, not prose: index 23 is the fourth group separator.
    expect(LINEAR_UUID.charAt(23)).toBe("-");

    // The ULID sibling's offsets, applied here and sanitized the way
    // `milestoneIdFromEpicKey` sanitizes, produce a token whose key head is
    // `_` — malformed under the union grammar.
    const wrong = `M_${LINEAR_UUID.slice(23, 29).replace(/[^A-Za-z0-9_]/g, "_")}`;
    expect(wrong).toBe("M__44665");
    expect(isMilestoneToken("M__44665")).toBe(false);
    expect(parseMilestoneToken("M__44665")).toBeNull();

    // And the SHIPPED derivation does not do that.
    expect(milestoneIdFromLinearMilestone(LINEAR_UUID)).toBe("M_550e84");
    expect(milestoneIdFromLinearMilestone(LINEAR_UUID)).not.toBe(wrong);
  });
});

describe("AC-STE-539.3 — an identifier that will not sanitize is refused, never returned malformed", () => {
  const MALFORMED: [string, string][] = [
    ["", "empty string"],
    ["not-a-uuid", "not a uuid at all"],
    ["------------", "hyphens only"],
    ["--0e8400-e29b-41d4-a716-446655440000", "canonical shape with its head hyphenated"],
  ];

  for (const [input, why] of MALFORMED) {
    test(`${JSON.stringify(input)} (${why}) throws, naming the helper`, async () => {
      const milestoneIdFromLinearMilestone = await loadMilestoneIdFromLinearMilestone();
      // Matching the MESSAGE, so a `TypeError` from an unrelated line cannot
      // score as the refusal.
      expect(() => milestoneIdFromLinearMilestone(input)).toThrow(
        /milestoneIdFromLinearMilestone/,
      );
    });
  }

  test("positive control — it is not simply throwing on everything", async () => {
    const milestoneIdFromLinearMilestone = await loadMilestoneIdFromLinearMilestone();
    // The literal table, re-run here so "it throws" is known not to be "it
    // always throws". Without this the four refusals above are satisfied by a
    // one-line `throw`.
    for (const [uuid, expected] of LINEAR_FIXTURES) {
      expect(milestoneIdFromLinearMilestone(uuid)).toBe(expected);
    }
  });
});

describe("AC-STE-539.4 — every emitted token parses as the epic-kind branch", () => {
  test("the fixture table round-trips through the union grammar", async () => {
    const milestoneIdFromLinearMilestone = await loadMilestoneIdFromLinearMilestone();
    for (const [uuid] of LINEAR_FIXTURES) {
      const id = milestoneIdFromLinearMilestone(uuid);
      // `kind` compared against the LITERAL "epic" — never merely `!== null`,
      // so a numeric or null parse fails here.
      expect(parseMilestoneToken(id)).toEqual({ kind: "epic", key: id.slice(2) });
      expect(parseMilestoneToken(id)).toEqual({ kind: "epic", key: uuid.slice(0, 6) });
    }
  });

  test("200 real crypto.randomUUID() values all parse as epic", async () => {
    const milestoneIdFromLinearMilestone = await loadMilestoneIdFromLinearMilestone();
    for (let i = 0; i < 200; i += 1) {
      const uuid = crypto.randomUUID();
      const id = milestoneIdFromLinearMilestone(uuid);
      expect(parseMilestoneToken(id)).toEqual({ kind: "epic", key: id.slice(2) });
      expect((parseMilestoneToken(id) as { kind: "epic"; key: string }).key).toHaveLength(6);
    }
  });

  test("the derived id is accepted by isMilestoneToken and names a legal plan file", async () => {
    const milestoneIdFromLinearMilestone = await loadMilestoneIdFromLinearMilestone();
    for (let i = 0; i < 200; i += 1) {
      const id = milestoneIdFromLinearMilestone(crypto.randomUUID());
      expect(isMilestoneToken(id)).toBe(true);
      expect(PLAN_FILENAME_RE.test(`${id}.md`)).toBe(true);
    }
  });

  test("re-deriving from the parsed key reproduces the id (M_ + key)", async () => {
    const milestoneIdFromLinearMilestone = await loadMilestoneIdFromLinearMilestone();
    const id = milestoneIdFromLinearMilestone(LINEAR_UUID);
    const parsed = parseMilestoneToken(id) as { kind: "epic"; key: string };
    expect(`M_${parsed.key}`).toBe(id);
  });
});
