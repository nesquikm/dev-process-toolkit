import { describe, expect, test } from "bun:test";
import {
  filterRowsForFR,
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
