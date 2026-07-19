import { describe, expect, test } from "bun:test";
import {
  filterRowsForFR,
  renderMilestoneRollup,
  renderTokenStatsBlock,
  upsertTokenStatsBlock,
} from "../adapters/_shared/src/token_stats_render";
import {
  TOKEN_LEDGER_SCHEMA,
  type TokenLedgerRow,
} from "../adapters/_shared/src/token_usage";

// STE-345 — render half of the per-skill token-usage feature.
//
// AC-STE-345.1 — block shape: a `## Token Stats` section fenced by literal
//   `<!-- token-stats:begin -->` / `<!-- token-stats:end -->` markers; between
//   the fences a per-skill × per-model markdown table (columns: skill, model,
//   input, output, cache-read, cache-creation) with separate `brainstorm` and
//   `spec-write` rows plus a `subtotal` row; byte-stable for a given input.
// AC-STE-345.2 — `renderTokenStatsBlock(rows)` (pure) +
//   `upsertTokenStatsBlock(frBody, rows)` (idempotent: insert after `## Notes`
//   when absent, replace the fenced region in place when present; never a
//   second block, never mutates any other section).
// AC-STE-345.6 — `filterRowsForFR(ledger, { branch, sessionLineage,
//   brainstormClaim })` selector: same-session rows direct; detached
//   brainstorm bridged by claiming the most-recent UNCLAIMED
//   `dev-process-toolkit:brainstorm` rows on the current branch; rows
//   `claimed_by` another FR are skipped (no double-count); rows claimed by
//   this FR stay attached; never-claimed rows fall through to STE-346.
//
// Contract assumed by these tests (binding for the implementer):
//   - `ledger` is the parsed row array (`TokenLedgerRow[]`, rows optionally
//     carrying a `claimed_by?: string` marker per the FR Technical Design).
//   - `filterRowsForFR` returns the selected rows as an array.

const BEGIN = "<!-- token-stats:begin -->";
const END = "<!-- token-stats:end -->";
const HEADING = "## Token Stats";
const BRANCH = "chore/ste-345-token-stats";

type ClaimableRow = TokenLedgerRow & { claimed_by?: string };

function makeRow(overrides: Partial<ClaimableRow> = {}): ClaimableRow {
  return {
    schema: TOKEN_LEDGER_SCHEMA,
    ts: "2026-07-01T10:00:00Z",
    session_id: "sess-current",
    git_branch: BRANCH,
    skill: "dev-process-toolkit:spec-write",
    model: "claude-sonnet-4",
    input_tokens: 202,
    output_tokens: 88,
    cache_read_input_tokens: 31,
    cache_creation_input_tokens: 25,
    message_count: 4,
    ...overrides,
  };
}

const brainstormRow = makeRow({
  skill: "dev-process-toolkit:brainstorm",
  model: "claude-opus-4",
  input_tokens: 421,
  output_tokens: 77,
  cache_read_input_tokens: 12,
  cache_creation_input_tokens: 14,
});
const specWriteRow = makeRow();
// Column sums: input 623, output 165, cache-read 43, cache-creation 39.
const rowsA: TokenLedgerRow[] = [brainstormRow, specWriteRow];

const FR_BODY = `---
title: Sample FR
---

# STE-000: Sample FR {#STE-000}

## Requirement

Prose requirement.

## Acceptance Criteria

- AC-STE-000.1: Something binary. {#AC-STE-000.1}

## Technical Design

Design prose.

## Testing

- Test plan line.

## Notes

- A trailing note.
`;

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/** First byte of the Token Stats block (heading or begin marker, whichever comes first). */
function blockStartIndex(body: string): number {
  const candidates = [body.indexOf(HEADING), body.indexOf(BEGIN)].filter(
    (i) => i >= 0,
  );
  expect(candidates.length).toBeGreaterThan(0);
  return Math.min(...candidates);
}

const keyOf = (r: TokenLedgerRow) => `${r.session_id}|${r.skill}`;
const keysOf = (rows: TokenLedgerRow[]) => rows.map(keyOf).sort();

describe("AC-STE-345.1 — renderTokenStatsBlock block shape", () => {
  test("emits one sentinel-fenced `## Token Stats` block", () => {
    const block = renderTokenStatsBlock(rowsA);
    expect(count(block, BEGIN)).toBe(1);
    expect(count(block, END)).toBe(1);
    expect(block).toContain(HEADING);
    expect(block.indexOf(BEGIN)).toBeLessThan(block.indexOf(END));
  });

  test("table carries the fixed column set in order: skill, model, input, output, cache-read, cache-creation", () => {
    const block = renderTokenStatsBlock(rowsA);
    expect(block).toMatch(
      /\|\s*skill\s*\|\s*model\s*\|\s*input\s*\|\s*output\s*\|\s*cache-read\s*\|\s*cache-creation\s*\|/i,
    );
    // The table lives between the fences.
    const begin = block.indexOf(BEGIN);
    const end = block.indexOf(END);
    const headerIdx = block.search(/\|\s*skill\s*\|/i);
    expect(headerIdx).toBeGreaterThan(begin);
    expect(headerIdx).toBeLessThan(end);
  });

  test("brainstorm and spec-write render as separate rows, plus a subtotal row with the column sums", () => {
    const block = renderTokenStatsBlock(rowsA);
    const lines = block.split("\n");

    const brainstormLine = lines.find(
      (l) => l.includes("|") && /brainstorm/.test(l) && !/subtotal/i.test(l),
    );
    const specWriteLine = lines.find(
      (l) => l.includes("|") && /spec-write/.test(l) && !/subtotal/i.test(l),
    );
    const subtotalLine = lines.find((l) => /subtotal/i.test(l));

    expect(brainstormLine).toBeDefined();
    expect(specWriteLine).toBeDefined();
    expect(subtotalLine).toBeDefined();
    expect(brainstormLine).not.toBe(specWriteLine as string);

    // Per-row values kept separate (the "which of the two is expensive" signal).
    expect(brainstormLine as string).toContain("421");
    expect(specWriteLine as string).toContain("202");

    // Subtotal row sums each token column: 623 / 165 / 43 / 39.
    expect(subtotalLine as string).toContain("623");
    expect(subtotalLine as string).toContain("165");
    expect(subtotalLine as string).toContain("43");
    expect(subtotalLine as string).toContain("39");
  });

  test("render is byte-stable for a given ledger input", () => {
    const first = renderTokenStatsBlock(structuredClone(rowsA));
    const second = renderTokenStatsBlock(structuredClone(rowsA));
    expect(second).toBe(first);
  });
});

describe("AC-STE-345.2 — upsertTokenStatsBlock idempotent insert/replace", () => {
  test("inserts the block after ## Notes when absent — block is last, prefix byte-preserved", () => {
    const out = upsertTokenStatsBlock(FR_BODY, rowsA);
    const start = blockStartIndex(out);

    // Placed after the ## Notes heading AND after the Notes content.
    expect(start).toBeGreaterThan(out.indexOf("## Notes"));
    expect(start).toBeGreaterThan(out.indexOf("A trailing note."));

    // Last in the FR body: nothing but whitespace after the end marker.
    expect(out.slice(out.indexOf(END) + END.length).trim()).toBe("");

    // Exactly one block.
    expect(count(out, BEGIN)).toBe(1);
    expect(count(out, END)).toBe(1);
    expect(count(out, HEADING)).toBe(1);

    // Every other section is byte-identical to the input.
    expect(out.slice(0, start).trimEnd()).toBe(FR_BODY.trimEnd());
  });

  test("replaces the fenced region in place when present — never appends a second block", () => {
    const once = upsertTokenStatsBlock(FR_BODY, rowsA);

    const rowsB: TokenLedgerRow[] = [
      makeRow({
        skill: "dev-process-toolkit:brainstorm",
        model: "claude-opus-4",
        input_tokens: 733,
        output_tokens: 77,
        cache_read_input_tokens: 12,
        cache_creation_input_tokens: 14,
      }),
      specWriteRow,
    ];
    const updated = upsertTokenStatsBlock(once, rowsB);

    expect(count(updated, BEGIN)).toBe(1);
    expect(count(updated, END)).toBe(1);
    expect(count(updated, HEADING)).toBe(1);

    // New numbers in, old numbers gone.
    expect(updated).toContain("733");
    expect(updated).not.toContain("421");

    // Non-fenced sections untouched.
    expect(updated.slice(0, blockStartIndex(updated)).trimEnd()).toBe(
      FR_BODY.trimEnd(),
    );
  });

  test("double render == single render (byte equality)", () => {
    const once = upsertTokenStatsBlock(FR_BODY, rowsA);
    const twice = upsertTokenStatsBlock(once, rowsA);
    expect(twice).toBe(once);
  });
});

describe("AC-STE-345.6 — filterRowsForFR brainstorm→FR bridging", () => {
  const opts = {
    branch: BRANCH,
    sessionLineage: ["sess-current"],
    brainstormClaim: "STE-345",
  };

  test("same-session brainstorm + spec-write rows are used directly", () => {
    const ledger: ClaimableRow[] = [brainstormRow, specWriteRow];
    const selected = filterRowsForFR(ledger, opts);
    expect(keysOf(selected)).toEqual(
      keysOf([brainstormRow, specWriteRow]),
    );
  });

  test("detached brainstorm: most-recent UNCLAIMED session on the branch is claimed; older rows left for STE-346", () => {
    const older = makeRow({
      skill: "dev-process-toolkit:brainstorm",
      session_id: "sess-old",
      ts: "2026-06-28T09:00:00Z",
    });
    const newer = makeRow({
      skill: "dev-process-toolkit:brainstorm",
      session_id: "sess-new",
      ts: "2026-06-30T09:00:00Z",
    });
    const ledger: ClaimableRow[] = [older, newer, specWriteRow];

    const selected = filterRowsForFR(ledger, opts);
    expect(keysOf(selected)).toEqual(keysOf([newer, specWriteRow]));
  });

  test("off-branch brainstorm and detached non-brainstorm rows are never bridged", () => {
    const offBranch = makeRow({
      skill: "dev-process-toolkit:brainstorm",
      session_id: "sess-foreign",
      git_branch: "feat/other-topic",
      ts: "2026-07-01T09:00:00Z",
    });
    const detachedImplement = makeRow({
      skill: "dev-process-toolkit:implement",
      session_id: "sess-other",
      ts: "2026-07-01T09:30:00Z",
    });
    const ledger: ClaimableRow[] = [offBranch, detachedImplement, specWriteRow];

    const selected = filterRowsForFR(ledger, opts);
    expect(keysOf(selected)).toEqual(keysOf([specWriteRow]));
  });

  test("rows claimed_by another FR are skipped — bridging falls back to the next most-recent unclaimed session", () => {
    const claimedNewer = makeRow({
      skill: "dev-process-toolkit:brainstorm",
      session_id: "sess-claimed",
      ts: "2026-06-30T09:00:00Z",
      claimed_by: "STE-999",
    });
    const unclaimedOlder = makeRow({
      skill: "dev-process-toolkit:brainstorm",
      session_id: "sess-unclaimed",
      ts: "2026-06-28T09:00:00Z",
    });
    const ledger: ClaimableRow[] = [claimedNewer, unclaimedOlder, specWriteRow];

    const selected = filterRowsForFR(ledger, opts);
    expect(keysOf(selected)).toEqual(keysOf([unclaimedOlder, specWriteRow]));
  });

  test("no double-count across FRs: a row claimed by this FR stays attached; another FR cannot take it", () => {
    const claimedByThis = makeRow({
      skill: "dev-process-toolkit:brainstorm",
      session_id: "sess-detached",
      ts: "2026-06-29T09:00:00Z",
      claimed_by: "STE-345",
    });
    const ledger: ClaimableRow[] = [claimedByThis];

    const forThis = filterRowsForFR(ledger, opts);
    expect(keysOf(forThis)).toEqual(keysOf([claimedByThis]));

    const forOther = filterRowsForFR(ledger, {
      branch: BRANCH,
      sessionLineage: ["sess-zzz"],
      brainstormClaim: "STE-346",
    });
    expect(forOther).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// STE-396 — same-session double-count fix: direct-path marking + shared-session
// demotion to the milestone design bucket.
//
// AC-STE-396.1 — `filterRowsForFR` marks direct-path rows: a row selected
//   because its `session_id` is in `sessionLineage` and it carries no prior
//   claim is assigned `claimed_by = <brainstormClaim>`.
// AC-STE-396.2 — shared-session demotion: a row already claimed by a DIFFERENT
//   FR whose `session_id` is in this run's lineage is re-marked
//   `claimed_by = design/exploration` and returned to NEITHER FR. A row claimed
//   by a different FR from a DIFFERENT session stays claimed, as today.
// AC-STE-396.3 — demotion is idempotent and order-independent.
// AC-STE-396.5 — rollup attribution: demoted rows render under the design
//   bucket, FR-claimed rows get their per-FR subtotal lines, and the milestone
//   `total` row never moves.
// AC-STE-396.6 — sum invariant: per-FR blocks + design bucket == ledger total,
//   every row counted exactly once, over a multi-FR / multi-session fixture.
// AC-STE-396.8 — bridging is untouched: the detached-brainstorm claim path
//   still marks the bridged rows with the FR id, never the design bucket.
// ---------------------------------------------------------------------------

/** Existing module constant reused as the demotion sentinel (token_stats_render.ts). */
const DESIGN_BUCKET = "design/exploration";
// Mirrors the module-private constant in token_stats_render.ts (not exported).
const BRAINSTORM_SKILL = "dev-process-toolkit:brainstorm";

/** Token columns, in render order, of one parsed markdown table row. */
type Totals = [number, number, number, number];

function zeroTotals(): Totals {
  return [0, 0, 0, 0];
}

/** Trimmed cells of a markdown table line, outer pipes dropped. */
function cells(line: string): string[] {
  return line
    .split("|")
    .map((c) => c.trim())
    .slice(1, -1);
}

/** The four token numbers of a rendered block's `subtotal` row. */
function subtotalOf(block: string): Totals {
  const line = block
    .split("\n")
    .find((l) => /^\|\s*subtotal\s*\|/.test(l.trimStart()));
  expect(line).toBeDefined();
  const nums = cells(line as string)
    .slice(2)
    .map(Number);
  expect(nums).toHaveLength(4);
  return nums as Totals;
}

/** Column sums of every rollup table line whose label cell equals `label`. */
function bucketTotals(block: string, label: string): Totals {
  const totals = zeroTotals();
  for (const line of block.split("\n")) {
    if (!line.trimStart().startsWith("|")) continue;
    const c = cells(line);
    if (c[0] !== label) continue;
    for (let i = 0; i < 4; i++) totals[i] += Number(c[i + 2]);
  }
  return totals;
}

/** Column sums straight off the raw ledger rows. */
function ledgerTotals(rows: TokenLedgerRow[]): Totals {
  const totals = zeroTotals();
  for (const r of rows) {
    totals[0] += r.input_tokens;
    totals[1] += r.output_tokens;
    totals[2] += r.cache_read_input_tokens;
    totals[3] += r.cache_creation_input_tokens;
  }
  return totals;
}

/** `claimed_by` of every ledger row, keyed by session|skill — the terminal state. */
function claimState(ledger: ClaimableRow[]): Record<string, string> {
  const state: Record<string, string> = {};
  for (const r of ledger) state[keyOf(r)] = r.claimed_by ?? "(unclaimed)";
  return state;
}

describe("AC-STE-396.1 — filterRowsForFR marks direct-path rows with the claiming FR", () => {
  const opts = {
    branch: BRANCH,
    sessionLineage: ["sess-current"],
    brainstormClaim: "STE-396",
  };

  test("an unclaimed row whose session is in the lineage is assigned claimed_by = brainstormClaim", () => {
    const direct = makeRow({
      skill: "dev-process-toolkit:spec-write",
      session_id: "sess-current",
    });
    const ledger: ClaimableRow[] = [direct];

    const selected = filterRowsForFR(ledger, opts);

    expect(keysOf(selected)).toEqual(keysOf([direct]));
    // The mark is what makes claimRowsForFR's claim-value diff persist it.
    expect(direct.claimed_by).toBe("STE-396");
  });

  test("every direct-path row of a multi-skill session is marked, not just the brainstorm one", () => {
    const brainstorm = makeRow({
      skill: "dev-process-toolkit:brainstorm",
      session_id: "sess-current",
    });
    const specWrite = makeRow({
      skill: "dev-process-toolkit:spec-write",
      session_id: "sess-current",
    });
    const implement = makeRow({
      skill: "dev-process-toolkit:implement",
      session_id: "sess-current",
    });
    const ledger: ClaimableRow[] = [brainstorm, specWrite, implement];

    filterRowsForFR(ledger, opts);

    expect(ledger.map((r) => r.claimed_by)).toEqual([
      "STE-396",
      "STE-396",
      "STE-396",
    ]);
  });

  test("rows outside the lineage are left unmarked (no over-claiming)", () => {
    const outside = makeRow({
      skill: "dev-process-toolkit:implement",
      session_id: "sess-elsewhere",
    });
    const ledger: ClaimableRow[] = [outside];

    const selected = filterRowsForFR(ledger, opts);

    expect(selected).toHaveLength(0);
    expect(outside.claimed_by).toBeUndefined();
  });
});

describe("AC-STE-396.2 — shared-session rows are demoted to the design bucket", () => {
  test("row claimed by a DIFFERENT FR whose session IS in this lineage is re-marked design/exploration and returned to neither FR", () => {
    const shared = makeRow({
      skill: "dev-process-toolkit:spec-write",
      session_id: "sess-shared",
      claimed_by: "STE-394",
    });
    const ledger: ClaimableRow[] = [shared];

    const selected = filterRowsForFR(ledger, {
      branch: BRANCH,
      sessionLineage: ["sess-shared"],
      brainstormClaim: "STE-395",
    });

    // Returned to neither FR.
    expect(selected).toHaveLength(0);
    // Re-marked with the design-bucket sentinel, not either FR id.
    expect(shared.claimed_by).toBe(DESIGN_BUCKET);
  });

  test("the first FR loses the row too: re-selecting for the original claimant returns nothing", () => {
    const shared = makeRow({
      skill: "dev-process-toolkit:spec-write",
      session_id: "sess-shared",
      claimed_by: "STE-394",
    });
    const ledger: ClaimableRow[] = [shared];

    filterRowsForFR(ledger, {
      branch: BRANCH,
      sessionLineage: ["sess-shared"],
      brainstormClaim: "STE-395",
    });

    const backToFirst = filterRowsForFR(ledger, {
      branch: BRANCH,
      sessionLineage: ["sess-shared"],
      brainstormClaim: "STE-394",
    });
    expect(backToFirst).toHaveLength(0);
    expect(shared.claimed_by).toBe(DESIGN_BUCKET);
  });

  test("row claimed by a different FR from a DIFFERENT session stays claimed and is simply not selected (unchanged behaviour)", () => {
    const foreign = makeRow({
      skill: "dev-process-toolkit:spec-write",
      session_id: "sess-theirs",
      claimed_by: "STE-394",
    });
    const ledger: ClaimableRow[] = [foreign];

    const selected = filterRowsForFR(ledger, {
      branch: BRANCH,
      sessionLineage: ["sess-mine"],
      brainstormClaim: "STE-395",
    });

    expect(selected).toHaveLength(0);
    expect(foreign.claimed_by).toBe("STE-394");
  });

  test("partial lineage overlap demotes only the shared session's rows", () => {
    const onlyA = makeRow({
      skill: "dev-process-toolkit:spec-write",
      session_id: "sess-a-only",
      claimed_by: "STE-394",
    });
    const shared = makeRow({
      skill: "dev-process-toolkit:implement",
      session_id: "sess-both",
      claimed_by: "STE-394",
    });
    const onlyB = makeRow({
      skill: "dev-process-toolkit:implement",
      session_id: "sess-b-only",
    });
    const ledger: ClaimableRow[] = [onlyA, shared, onlyB];

    const selected = filterRowsForFR(ledger, {
      branch: BRANCH,
      sessionLineage: ["sess-both", "sess-b-only"],
      brainstormClaim: "STE-395",
    });

    expect(onlyA.claimed_by).toBe("STE-394");
    expect(shared.claimed_by).toBe(DESIGN_BUCKET);
    expect(onlyB.claimed_by).toBe("STE-395");
    expect(keysOf(selected)).toEqual(keysOf([onlyB]));
  });
});

describe("AC-STE-396.3 — demotion is idempotent and order-independent", () => {
  const FR_A = { sessionLineage: ["sess-shared"], brainstormClaim: "STE-394" };
  const FR_B = { sessionLineage: ["sess-shared"], brainstormClaim: "STE-395" };
  const FR_C = { sessionLineage: ["sess-shared"], brainstormClaim: "STE-396" };

  function sharedLedger(): ClaimableRow[] {
    return [
      makeRow({ skill: "dev-process-toolkit:spec-write", session_id: "sess-shared" }),
      makeRow({ skill: "dev-process-toolkit:implement", session_id: "sess-shared" }),
    ];
  }

  test("A-then-B and B-then-A reach the same terminal ledger state (both rows demoted)", () => {
    const forward = sharedLedger();
    filterRowsForFR(forward, { branch: BRANCH, ...FR_A });
    filterRowsForFR(forward, { branch: BRANCH, ...FR_B });

    const reverse = sharedLedger();
    filterRowsForFR(reverse, { branch: BRANCH, ...FR_B });
    filterRowsForFR(reverse, { branch: BRANCH, ...FR_A });

    expect(claimState(forward)).toEqual(claimState(reverse));
    expect(forward.map((r) => r.claimed_by)).toEqual([
      DESIGN_BUCKET,
      DESIGN_BUCKET,
    ]);
  });

  test("a third FR from the same session changes nothing further and gets nothing", () => {
    const ledger = sharedLedger();
    filterRowsForFR(ledger, { branch: BRANCH, ...FR_A });
    filterRowsForFR(ledger, { branch: BRANCH, ...FR_B });
    const before = claimState(ledger);

    const third = filterRowsForFR(ledger, { branch: BRANCH, ...FR_C });

    expect(third).toHaveLength(0);
    expect(claimState(ledger)).toEqual(before);
  });

  test("re-running any claim after demotion is a no-op", () => {
    const ledger = sharedLedger();
    filterRowsForFR(ledger, { branch: BRANCH, ...FR_A });
    filterRowsForFR(ledger, { branch: BRANCH, ...FR_B });
    const settled = claimState(ledger);

    for (const fr of [FR_A, FR_B, FR_A]) {
      const again = filterRowsForFR(ledger, { branch: BRANCH, ...fr });
      expect(again).toHaveLength(0);
      expect(claimState(ledger)).toEqual(settled);
    }
  });
});

describe("AC-STE-396.5 — rollup attribution: design bucket for demoted rows, subtotals for FR-claimed rows, total pinned", () => {
  test("per-FR subtotal lines are emitted for direct-path rows that stay FR-claimed", () => {
    const brainstorm = makeRow({
      skill: "dev-process-toolkit:brainstorm",
      model: "claude-opus-4",
      session_id: "sess-solo",
      input_tokens: 5,
      output_tokens: 50,
      cache_read_input_tokens: 500,
      cache_creation_input_tokens: 5000,
    });
    const specWrite = makeRow({
      skill: "dev-process-toolkit:spec-write",
      model: "claude-opus-4",
      session_id: "sess-solo",
      input_tokens: 7,
      output_tokens: 70,
      cache_read_input_tokens: 700,
      cache_creation_input_tokens: 7000,
    });
    const ledger: ClaimableRow[] = [brainstorm, specWrite];

    filterRowsForFR(ledger, {
      branch: BRANCH,
      sessionLineage: ["sess-solo"],
      brainstormClaim: "STE-396",
    });

    const rollup = renderMilestoneRollup(ledger, { frOrder: ["STE-396"] });

    // AC-STE-346.2's promised per-FR subtotal line, restored.
    expect(bucketTotals(rollup, "STE-396")).toEqual([12, 120, 1200, 12000]);
    // No skill-labelled fallback lines survive for claimed rows.
    expect(rollup).not.toContain("dev-process-toolkit:spec-write");
  });

  test("demoted rows render under the existing design/exploration bucket", () => {
    const a = makeRow({
      skill: "dev-process-toolkit:spec-write",
      model: "claude-opus-4",
      session_id: "sess-shared",
      input_tokens: 3,
      output_tokens: 30,
      cache_read_input_tokens: 300,
      cache_creation_input_tokens: 3000,
    });
    const ledger: ClaimableRow[] = [a];

    filterRowsForFR(ledger, {
      branch: BRANCH,
      sessionLineage: ["sess-shared"],
      brainstormClaim: "STE-394",
    });
    filterRowsForFR(ledger, {
      branch: BRANCH,
      sessionLineage: ["sess-shared"],
      brainstormClaim: "STE-395",
    });

    const rollup = renderMilestoneRollup(ledger, {
      frOrder: ["STE-394", "STE-395"],
    });

    expect(bucketTotals(rollup, DESIGN_BUCKET)).toEqual([3, 30, 300, 3000]);
    expect(bucketTotals(rollup, "STE-394")).toEqual([0, 0, 0, 0]);
    expect(bucketTotals(rollup, "STE-395")).toEqual([0, 0, 0, 0]);
  });

  test("the milestone total row is unchanged by demotion — rows move between buckets, never out of the total", () => {
    const pristine = makeRow({
      skill: "dev-process-toolkit:spec-write",
      model: "claude-opus-4",
      session_id: "sess-shared",
      input_tokens: 3,
      output_tokens: 30,
      cache_read_input_tokens: 300,
      cache_creation_input_tokens: 3000,
    });
    const frOrder = ["STE-394", "STE-395"];
    const before = bucketTotals(
      renderMilestoneRollup([pristine], { frOrder }),
      "total",
    );

    const ledger: ClaimableRow[] = [pristine];
    filterRowsForFR(ledger, {
      branch: BRANCH,
      sessionLineage: ["sess-shared"],
      brainstormClaim: "STE-394",
    });
    filterRowsForFR(ledger, {
      branch: BRANCH,
      sessionLineage: ["sess-shared"],
      brainstormClaim: "STE-395",
    });

    const after = bucketTotals(renderMilestoneRollup(ledger, { frOrder }), "total");
    expect(after).toEqual(before);
    expect(after).toEqual([3, 30, 300, 3000]);
  });
});

describe("AC-STE-396.6 — sum invariant: per-FR blocks + design bucket == ledger total, exactly once", () => {
  // Two sessions, three FRs (two of them sharing `sess-1`), and one detached
  // brainstorm — so the bridging and direct paths are exercised together.
  // Column totals: 31 / 310 / 3100 / 31000.
  function invariantLedger(): ClaimableRow[] {
    return [
      makeRow({
        skill: "dev-process-toolkit:brainstorm",
        model: "claude-opus-4",
        session_id: "sess-1",
        ts: "2026-07-01T09:00:00Z",
        input_tokens: 1,
        output_tokens: 10,
        cache_read_input_tokens: 100,
        cache_creation_input_tokens: 1000,
      }),
      makeRow({
        skill: "dev-process-toolkit:spec-write",
        session_id: "sess-1",
        input_tokens: 2,
        output_tokens: 20,
        cache_read_input_tokens: 200,
        cache_creation_input_tokens: 2000,
      }),
      makeRow({
        skill: "dev-process-toolkit:implement",
        session_id: "sess-1",
        input_tokens: 4,
        output_tokens: 40,
        cache_read_input_tokens: 400,
        cache_creation_input_tokens: 4000,
      }),
      makeRow({
        skill: "dev-process-toolkit:spec-write",
        session_id: "sess-2",
        input_tokens: 8,
        output_tokens: 80,
        cache_read_input_tokens: 800,
        cache_creation_input_tokens: 8000,
      }),
      // Detached brainstorm — latest `ts`, so it deterministically wins bridging.
      makeRow({
        skill: "dev-process-toolkit:brainstorm",
        model: "claude-opus-4",
        session_id: "sess-detached",
        ts: "2026-07-05T09:00:00Z",
        input_tokens: 16,
        output_tokens: 160,
        cache_read_input_tokens: 1600,
        cache_creation_input_tokens: 16000,
      }),
    ];
  }

  const frs = [
    { sessionLineage: ["sess-1"], brainstormClaim: "STE-A" },
    { sessionLineage: ["sess-1"], brainstormClaim: "STE-B" },
    { sessionLineage: ["sess-2"], brainstormClaim: "STE-C" },
  ];
  const frOrder = ["STE-A", "STE-B", "STE-C"];

  function permutations<T>(items: T[]): T[][] {
    if (items.length <= 1) return [items];
    const out: T[][] = [];
    for (let i = 0; i < items.length; i++) {
      const rest = [...items.slice(0, i), ...items.slice(i + 1)];
      for (const tail of permutations(rest)) out.push([items[i] as T, ...tail]);
    }
    return out;
  }

  for (const order of permutations(frs)) {
    const name = order.map((f) => f.brainstormClaim).join(" → ");

    test(`claim order ${name}: every ledger row lands in exactly one bucket`, () => {
      const ledger = invariantLedger();
      const total = ledgerTotals(ledger);

      // Pass 1 — claims settle in this order.
      for (const fr of order) {
        filterRowsForFR(ledger, { branch: BRANCH, ...fr });
      }

      // Pass 2 — the AC-STE-396.4 re-render: every touched FR is re-selected
      // AFTER all claims settle, so a retroactive demotion is reflected.
      const selections = frs.map((fr) => ({
        claim: fr.brainstormClaim,
        rows: filterRowsForFR(ledger, { branch: BRANCH, ...fr }),
      }));

      // Disjoint: no ledger row is claimed by two FRs.
      const seen = new Set<TokenLedgerRow>();
      for (const { rows } of selections) {
        for (const r of rows) {
          expect(seen.has(r)).toBe(false);
          seen.add(r);
        }
      }

      const frSum = zeroTotals();
      for (const { rows } of selections) {
        const sub = subtotalOf(renderTokenStatsBlock(rows));
        for (let i = 0; i < 4; i++) frSum[i] += sub[i];
      }
      const rollup = renderMilestoneRollup(ledger, { frOrder });
      const design = bucketTotals(rollup, DESIGN_BUCKET);

      // STRUCTURAL property (holds for ANY ledger): the milestone total is the
      // ledger total — relabeling only moves rows between buckets, so nothing
      // can be gained or lost. This is what AC-STE-396.6 actually guarantees.
      expect(bucketTotals(rollup, "total")).toEqual(total);

      // FIXTURE-SCOPED check: `frSum + design == total` is NOT universal — an
      // unattributed non-brainstorm row on a session no FR owns forms its own
      // rollup bucket and breaks the equation without any regression (see
      // AC-STE-396.6's restatement). It holds here only because this ledger
      // leaves no such row, which the guard below pins so the equation cannot
      // silently start meaning something weaker if the fixture grows.
      const bucketed = new Set([...frOrder, DESIGN_BUCKET]);
      const unbucketed = ledger.filter(
        (r) => !bucketed.has(r.claimed_by ?? "") && r.skill !== BRAINSTORM_SKILL,
      );
      expect(unbucketed).toEqual([]);
      for (let i = 0; i < 4; i++) {
        expect(frSum[i] + design[i]).toBe(total[i]);
      }
    });
  }

  test("the re-render pass is stable: a third pass returns the same selections", () => {
    const ledger = invariantLedger();
    for (const fr of frs) filterRowsForFR(ledger, { branch: BRANCH, ...fr });

    const second = frs.map((fr) =>
      keysOf(filterRowsForFR(ledger, { branch: BRANCH, ...fr })),
    );
    const third = frs.map((fr) =>
      keysOf(filterRowsForFR(ledger, { branch: BRANCH, ...fr })),
    );
    expect(third).toEqual(second);
  });
});

describe("AC-STE-396.8 — bridging is untouched by the demotion path", () => {
  test("a detached brainstorm is still bridged and marked with the FR id, never the design bucket", () => {
    const detached = makeRow({
      skill: "dev-process-toolkit:brainstorm",
      session_id: "sess-detached",
      ts: "2026-06-30T09:00:00Z",
    });
    const own = makeRow({
      skill: "dev-process-toolkit:spec-write",
      session_id: "sess-current",
    });
    const ledger: ClaimableRow[] = [detached, own];

    const selected = filterRowsForFR(ledger, {
      branch: BRANCH,
      sessionLineage: ["sess-current"],
      brainstormClaim: "STE-396",
    });

    expect(keysOf(selected)).toEqual(keysOf([detached, own]));
    expect(detached.claimed_by).toBe("STE-396");
    expect(detached.claimed_by).not.toBe(DESIGN_BUCKET);
  });

  test("a bridged row is NOT demoted by a later FR whose lineage excludes the detached session", () => {
    const detached = makeRow({
      skill: "dev-process-toolkit:brainstorm",
      session_id: "sess-detached",
      ts: "2026-06-30T09:00:00Z",
      claimed_by: "STE-394",
    });
    const ledger: ClaimableRow[] = [detached];

    const selected = filterRowsForFR(ledger, {
      branch: BRANCH,
      sessionLineage: ["sess-other"],
      brainstormClaim: "STE-395",
    });

    expect(selected).toHaveLength(0);
    expect(detached.claimed_by).toBe("STE-394");
  });
});
