import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  TOKEN_LEDGER_SCHEMA,
  type TokenLedgerRow,
} from "../adapters/_shared/src/token_usage";

// STE-345 — `## Token Stats` convention test (AC-STE-345.3), modeled on
// `design-references-convention.test.ts` (M91's additive, machine-managed,
// convention-tested FR-section precedent), plus the gate-check tolerance /
// FR-section-contract note (AC-STE-345.4).
//
// AC-STE-345.3 — asserts the fenced-block shape, the `after ## Notes`
//   placement, the separate brainstorm/spec-write rows + subtotal, and the
//   idempotent update-in-place (double render == single render).
// AC-STE-345.4 — no `/gate-check` probe enforces the FR body section
//   set/order (see docs/layout-reference.md FR-section contract), so the
//   no-false-GATE-FAILED requirement is satisfied by an explicit note in
//   that contract recording the optional `## Token Stats` section — same
//   mechanism as STE-341's `## Design References` permission note.
//
// The render-helper module is imported dynamically inside the AC-345.3
// tests so the AC-345.4 doc assertions report their own failures even
// while the helper module does not exist yet.

const pluginRoot = join(import.meta.dir, "..");
const layoutPath = join(pluginRoot, "docs", "layout-reference.md");

const BEGIN = "<!-- token-stats:begin -->";
const END = "<!-- token-stats:end -->";
const HEADING = "## Token Stats";

async function helpers() {
  return await import("../adapters/_shared/src/token_stats_render");
}

function makeRow(overrides: Partial<TokenLedgerRow> = {}): TokenLedgerRow {
  return {
    schema: TOKEN_LEDGER_SCHEMA,
    ts: "2026-07-01T10:00:00Z",
    session_id: "sess-current",
    git_branch: "chore/ste-345-token-stats",
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

const rows: TokenLedgerRow[] = [
  makeRow({
    skill: "dev-process-toolkit:brainstorm",
    model: "claude-opus-4",
    input_tokens: 421,
    output_tokens: 77,
    cache_read_input_tokens: 12,
    cache_creation_input_tokens: 14,
  }),
  makeRow(),
];

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

describe("AC-STE-345.3 — ## Token Stats convention (fenced, last, two rows + subtotal, idempotent)", () => {
  test("fenced-block shape: sentinel marker pair, heading, fixed column set", async () => {
    const { renderTokenStatsBlock } = await helpers();
    const block = renderTokenStatsBlock(rows);

    expect(count(block, BEGIN)).toBe(1);
    expect(count(block, END)).toBe(1);
    expect(block).toContain(HEADING);
    expect(block.indexOf(BEGIN)).toBeLessThan(block.indexOf(END));
    expect(block).toMatch(
      /\|\s*skill\s*\|\s*model\s*\|\s*input\s*\|\s*output\s*\|\s*cache-read\s*\|\s*cache-creation\s*\|/i,
    );
  });

  test("placement: upsert puts the block after ## Notes, last in the FR body", async () => {
    const { upsertTokenStatsBlock } = await helpers();
    const out = upsertTokenStatsBlock(FR_BODY, rows);

    const start = Math.min(
      ...[out.indexOf(HEADING), out.indexOf(BEGIN)].filter((i) => i >= 0),
    );
    expect(start).toBeGreaterThan(out.indexOf("## Notes"));
    expect(start).toBeGreaterThan(out.indexOf("A trailing note."));
    expect(out.slice(out.indexOf(END) + END.length).trim()).toBe("");
  });

  test("brainstorm and spec-write rows are separate, with a subtotal row", async () => {
    const { renderTokenStatsBlock } = await helpers();
    const lines = renderTokenStatsBlock(rows).split("\n");

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
    // input column subtotal: 421 + 202 = 623.
    expect(subtotalLine as string).toContain("623");
  });

  test("idempotent update-in-place: double render == single render, never a second block", async () => {
    const { upsertTokenStatsBlock } = await helpers();
    const once = upsertTokenStatsBlock(FR_BODY, rows);
    const twice = upsertTokenStatsBlock(once, rows);

    expect(twice).toBe(once);
    expect(count(twice, BEGIN)).toBe(1);
    expect(count(twice, END)).toBe(1);
    expect(count(twice, HEADING)).toBe(1);
  });
});

describe("AC-STE-345.4 — FR-section contract admits the optional ## Token Stats section", () => {
  test("layout-reference.md FR-section contract records the optional section (no false GATE FAILED)", () => {
    const layout = readFileSync(layoutPath, "utf8");

    // The section is named in the doc at all.
    expect(layout).toContain(HEADING);

    // The note lives in (or extends) the FR-section contract — the same
    // sentence region that already grants `## Design References` its
    // optional-section permission.
    const contractIdx = layout.indexOf("required top-level sections");
    expect(contractIdx).toBeGreaterThan(-1);
    const contract = layout.slice(contractIdx, contractIdx + 2000);
    expect(contract).toContain(HEADING);
    expect(contract).toMatch(/optional/i);

    // Somewhere near a `## Token Stats` mention, the doc states the
    // placement (after ## Notes / last) so the contract is unambiguous.
    const windows: string[] = [];
    let idx = layout.indexOf(HEADING);
    while (idx !== -1) {
      windows.push(layout.slice(Math.max(0, idx - 600), idx + 800));
      idx = layout.indexOf(HEADING, idx + HEADING.length);
    }
    expect(
      windows.some(
        (w) =>
          /optional/i.test(w) &&
          /(after[\s\S]{0,60}## Notes|last)/i.test(w),
      ),
    ).toBe(true);
  });
});
