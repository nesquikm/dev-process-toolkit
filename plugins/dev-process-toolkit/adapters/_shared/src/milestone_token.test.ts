// STE-376 AC-STE-376.1 — centralized milestone-token union matcher.
//
// One exported matcher recognizes BOTH milestone-id shapes:
//   - `M<N>`         — sequential numeric ids (`M101`), the historical grammar
//   - `M_<epic-key>` — opaque Jira-Epic-keyed ids (`M_PROJ_500`, `M_PROJ-500`)
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
