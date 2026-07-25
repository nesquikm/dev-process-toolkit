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
import { isMilestoneToken, parseMilestoneToken } from "./milestone_token";

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
  ];

  for (const file of CONSUMERS) {
    test(`${file.split("/").slice(-2).join("/")} consumes milestone_token`, () => {
      const src = readFileSync(file, "utf-8");
      expect(src).toMatch(/milestone_token/);
    });
  }
});
