import { describe, expect, test } from "bun:test";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  TOKEN_LEDGER_SCHEMA,
  type TokenLedgerRow,
} from "../adapters/_shared/src/token_usage";

// STE-346 — milestone `## Token Stats` rollup (AC-STE-346.2, .3, .4 code legs).
//
// AC-STE-346.2 — `renderMilestoneRollup(rows, { frOrder })` in
//   adapters/_shared/src/token_stats_render.ts renders the milestone block:
//   one subtotal row per in-scope FR (in `frOrder` order), a `(main-loop)`
//   row, and a milestone `total` row, each broken down by model.
//   Sentinel-fenced + idempotent — identical mechanics to the FR block, so
//   the upsert counterpart is `upsertMilestoneRollup(planBody, rows, opts)`.
// AC-STE-346.3 — `brainstorm` rows never claimed by any FR (no `claimed_by`
//   mark) roll into a dedicated `design/exploration` line; claimed brainstorm
//   rows count into their claiming FR's subtotal instead.
// AC-STE-346.4 — code-level idempotency: re-running the render replaces the
//   fenced region in place (no duplicate block), a re-render over current
//   content is byte-stable (no spurious diff inside the release commit), and
//   computing the render mutates nothing on disk.
//
// The renderer is pure: FR attribution can only come from row fields, and the
// only FR-linking field in the token-ledger/v1 schema is `claimed_by`
// (STE-345's claimRowsForFR persistence). Rows are dynamically imported so
// these tests report their own RED while the exports do not exist yet.

const BEGIN = "<!-- token-stats:begin -->";
const END = "<!-- token-stats:end -->";
const HEADING = "## Token Stats";

async function helpers(): Promise<Record<string, Function>> {
  return (await import(
    "../adapters/_shared/src/token_stats_render"
  )) as unknown as Record<string, Function>;
}

function makeRow(overrides: Partial<TokenLedgerRow> = {}): TokenLedgerRow {
  return {
    schema: TOKEN_LEDGER_SCHEMA,
    ts: "2026-07-01T10:00:00Z",
    session_id: "sess-x",
    git_branch: "chore/ste-344-per-skill-token-stats",
    skill: "dev-process-toolkit:implement",
    model: "claude-opus-4",
    input_tokens: 0,
    output_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
    message_count: 1,
    ...overrides,
  };
}

const frOrder = ["STE-101", "STE-102"];

// Distinctive, collision-free numbers. Expected aggregates:
//   STE-101 × opus:   300 / 30 / 4 / 6      (implement 100 + tdd 200)
//   STE-101 × sonnet: 400 / 40 / 5 / 6
//   STE-102 × sonnet: 1000 / 100 / 7 / 8
//   STE-102 × opus:   5000 / 500 / 9 / 11   (claimed brainstorm)
//   (main-loop) × opus:   7000 / 700 / 13 / 15
//   (main-loop) × sonnet: 70 / 7 / 17 / 19
//   design/exploration × opus: 30000 / 3000 / 21 / 23 (unclaimed brainstorm)
//   total: 43770 / 4377 / 76 / 88
const rows: TokenLedgerRow[] = [
  makeRow({
    skill: "dev-process-toolkit:implement",
    model: "claude-opus-4",
    input_tokens: 100,
    output_tokens: 10,
    cache_read_input_tokens: 1,
    cache_creation_input_tokens: 2,
    claimed_by: "STE-101",
  }),
  makeRow({
    skill: "dev-process-toolkit:tdd",
    model: "claude-opus-4",
    input_tokens: 200,
    output_tokens: 20,
    cache_read_input_tokens: 3,
    cache_creation_input_tokens: 4,
    claimed_by: "STE-101",
  }),
  makeRow({
    skill: "dev-process-toolkit:tdd",
    model: "claude-sonnet-4",
    input_tokens: 400,
    output_tokens: 40,
    cache_read_input_tokens: 5,
    cache_creation_input_tokens: 6,
    claimed_by: "STE-101",
  }),
  makeRow({
    skill: "dev-process-toolkit:implement",
    model: "claude-sonnet-4",
    input_tokens: 1000,
    output_tokens: 100,
    cache_read_input_tokens: 7,
    cache_creation_input_tokens: 8,
    claimed_by: "STE-102",
  }),
  // Brainstorm row CLAIMED by STE-102 — counts into STE-102, never into
  // the design/exploration bucket (AC-STE-346.3 flip side).
  makeRow({
    skill: "dev-process-toolkit:brainstorm",
    model: "claude-opus-4",
    input_tokens: 5000,
    output_tokens: 500,
    cache_read_input_tokens: 9,
    cache_creation_input_tokens: 11,
    claimed_by: "STE-102",
  }),
  makeRow({
    skill: "(main-loop)",
    model: "claude-opus-4",
    input_tokens: 7000,
    output_tokens: 700,
    cache_read_input_tokens: 13,
    cache_creation_input_tokens: 15,
  }),
  makeRow({
    skill: "(main-loop)",
    model: "claude-sonnet-4",
    input_tokens: 70,
    output_tokens: 7,
    cache_read_input_tokens: 17,
    cache_creation_input_tokens: 19,
  }),
  // Brainstorm row with NO claimed_by mark — the design/exploration bucket.
  makeRow({
    skill: "dev-process-toolkit:brainstorm",
    model: "claude-opus-4",
    input_tokens: 30000,
    output_tokens: 3000,
    cache_read_input_tokens: 21,
    cache_creation_input_tokens: 23,
  }),
];

const PLAN_BODY = `---
milestone: M92
status: active
archived_at: null
---

# Implementation Plan

## M92: Per-skill token-usage stats {#M92}

**Goal:** Measure per-skill token usage.

**Tasks:**
- [x] Capture ledger
  verify: bun test

**Gate:** \`bun test\`
`;

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/** Parse one markdown table line into trimmed cells (outer pipes dropped). */
function cellsOf(line: string): string[] {
  return line
    .split("|")
    .map((c) => c.trim())
    .slice(1, -1);
}

/** All table data lines (pipe rows, header/divider included) of a block. */
function tableLines(block: string): string[] {
  return block.split("\n").filter((l) => l.trimStart().startsWith("|"));
}

/**
 * Find the table row whose cells contain every label (substring match) and
 * every number (exact cell match). Returns its cells, or undefined.
 */
function findRow(
  block: string,
  labels: string[],
  exactNumbers: number[],
): string[] | undefined {
  for (const line of tableLines(block)) {
    const cells = cellsOf(line);
    const labelsOk = labels.every((label) =>
      cells.some((cell) => cell.includes(label)),
    );
    const numbersOk = exactNumbers.every((n) => cells.includes(String(n)));
    if (labelsOk && numbersOk) return cells;
  }
  return undefined;
}

describe("AC-STE-346.2 — renderMilestoneRollup: per-FR subtotals + (main-loop) + total, per model, sentinel-fenced", () => {
  test("exports exist: renderMilestoneRollup + upsertMilestoneRollup", async () => {
    const mod = await helpers();
    expect(typeof mod.renderMilestoneRollup).toBe("function");
    expect(typeof mod.upsertMilestoneRollup).toBe("function");
  });

  test("fenced-block shape: one sentinel pair, ## Token Stats heading", async () => {
    const { renderMilestoneRollup } = await helpers();
    const block = renderMilestoneRollup(rows, { frOrder });

    expect(count(block, BEGIN)).toBe(1);
    expect(count(block, END)).toBe(1);
    expect(block).toContain(HEADING);
    expect(block.indexOf(BEGIN)).toBeLessThan(block.indexOf(END));
  });

  test("one subtotal row per in-scope FR, broken down by model, with correct sums", async () => {
    const { renderMilestoneRollup } = await helpers();
    const block = renderMilestoneRollup(rows, { frOrder });

    // STE-101 opus = implement(100/10/1/2) + tdd(200/20/3/4).
    expect(
      findRow(block, ["STE-101", "claude-opus-4"], [300, 30, 4, 6]),
    ).toBeDefined();
    // STE-101 sonnet is a separate per-model line.
    expect(
      findRow(block, ["STE-101", "claude-sonnet-4"], [400, 40, 5, 6]),
    ).toBeDefined();
    // STE-102 sonnet.
    expect(
      findRow(block, ["STE-102", "claude-sonnet-4"], [1000, 100, 7, 8]),
    ).toBeDefined();
  });

  test("FR rows follow frOrder: STE-101 lines precede STE-102 lines", async () => {
    const { renderMilestoneRollup } = await helpers();
    const block = renderMilestoneRollup(rows, { frOrder });

    const first101 = block.indexOf("STE-101");
    const first102 = block.indexOf("STE-102");
    expect(first101).toBeGreaterThan(-1);
    expect(first102).toBeGreaterThan(-1);
    expect(first101).toBeLessThan(first102);
  });

  test("(main-loop) orchestrator row present per model", async () => {
    const { renderMilestoneRollup } = await helpers();
    const block = renderMilestoneRollup(rows, { frOrder });

    expect(
      findRow(block, ["(main-loop)", "claude-opus-4"], [7000, 700, 13, 15]),
    ).toBeDefined();
    expect(
      findRow(block, ["(main-loop)", "claude-sonnet-4"], [70, 7, 17, 19]),
    ).toBeDefined();
  });

  test("milestone total row sums every bucket and is the last table row", async () => {
    const { renderMilestoneRollup } = await helpers();
    const block = renderMilestoneRollup(rows, { frOrder });

    const lines = tableLines(block);
    const totalLines = lines.filter((l) =>
      cellsOf(l).some((c) => /\btotal\b/i.test(c) && !/subtotal/i.test(c)),
    );
    expect(totalLines.length).toBeGreaterThan(0);

    // Grand total: 43770 / 4377 / 76 / 88 across all buckets (FR subtotals,
    // (main-loop), and design/exploration all count into the milestone).
    const grand = totalLines.find((l) => cellsOf(l).includes("43770"));
    expect(grand).toBeDefined();
    const grandCells = cellsOf(grand as string);
    expect(grandCells).toContain("4377");
    expect(grandCells).toContain("76");
    expect(grandCells).toContain("88");

    // Nothing tabular renders after the total row.
    expect(lines[lines.length - 1]).toBe(grand as string);
  });

  test("byte-stability: same rows in, same bytes out — regardless of input order", async () => {
    const { renderMilestoneRollup } = await helpers();
    const once = renderMilestoneRollup(rows, { frOrder });
    const again = renderMilestoneRollup(rows, { frOrder });
    const shuffled = renderMilestoneRollup([...rows].reverse(), { frOrder });

    expect(again).toBe(once);
    expect(shuffled).toBe(once);
  });
});

describe("AC-STE-346.3 — unclaimed brainstorm rows roll into a design/exploration line", () => {
  test("brainstorm rows with no claimed_by mark render as design/exploration", async () => {
    const { renderMilestoneRollup } = await helpers();
    const block = renderMilestoneRollup(rows, { frOrder });

    expect(block).toContain("design/exploration");
    expect(
      findRow(block, ["design/exploration"], [30000, 3000, 21, 23]),
    ).toBeDefined();
  });

  test("claimed brainstorm rows count into their FR, never the bucket", async () => {
    const { renderMilestoneRollup } = await helpers();
    const block = renderMilestoneRollup(rows, { frOrder });

    // The STE-102-claimed brainstorm (5000/500/9/11, opus) lands on STE-102.
    expect(
      findRow(block, ["STE-102", "claude-opus-4"], [5000, 500, 9, 11]),
    ).toBeDefined();

    // And no design/exploration line carries the claimed row's numbers.
    const bucketLines = tableLines(block).filter((l) =>
      l.includes("design/exploration"),
    );
    expect(bucketLines.length).toBeGreaterThan(0);
    expect(bucketLines.some((l) => cellsOf(l).includes("5000"))).toBe(false);
  });

  test("no unclaimed brainstorm rows ⇒ no design/exploration line", async () => {
    const { renderMilestoneRollup } = await helpers();
    const claimedOnly = rows.filter(
      (r) =>
        !(
          r.skill === "dev-process-toolkit:brainstorm" &&
          r.claimed_by === undefined
        ),
    );
    const block = renderMilestoneRollup(claimedOnly, { frOrder });
    expect(block).not.toContain("design/exploration");
  });
});

describe("AC-STE-346.4 — idempotent upsert into the plan body, no duplicate block, no spurious diff", () => {
  test("insert: block appended last, one blank-line separated, body prefix byte-preserved", async () => {
    const { upsertMilestoneRollup } = await helpers();
    const out = upsertMilestoneRollup(PLAN_BODY, rows, { frOrder });

    // Everything before the block is the original plan body, byte-for-byte.
    expect(out.startsWith(PLAN_BODY.replace(/\n*$/, ""))).toBe(true);
    // The block lands after the plan's final section.
    const start = out.indexOf(BEGIN);
    expect(start).toBeGreaterThan(out.indexOf("**Gate:**"));
    // Nothing trails the end sentinel.
    expect(out.slice(out.indexOf(END) + END.length).trim()).toBe("");
    expect(count(out, BEGIN)).toBe(1);
    expect(count(out, END)).toBe(1);
    expect(count(out, HEADING)).toBe(1);
  });

  test("re-render replaces the fenced region in place: stale bytes swapped, outside bytes untouched", async () => {
    const { upsertMilestoneRollup } = await helpers();

    const staleBlock = [
      BEGIN,
      "",
      HEADING,
      "",
      "| stale | stale | 999999 | 999999 | 999999 | 999999 |",
      "",
      END,
    ].join("\n");
    const bodyWithStale =
      PLAN_BODY + "\n" + staleBlock + "\n\n## Trailing Section\n\nTrailing prose stays.\n";

    const out = upsertMilestoneRollup(bodyWithStale, rows, { frOrder });

    expect(out).not.toContain("999999");
    expect(out).toContain("43770");
    // The fenced region stays where it was — before the trailing section.
    expect(out.indexOf(BEGIN)).toBeLessThan(out.indexOf("## Trailing Section"));
    // Bytes outside the region survive verbatim.
    expect(out).toContain("**Gate:** `bun test`");
    expect(out).toContain("Trailing prose stays.");
    expect(count(out, BEGIN)).toBe(1);
    expect(count(out, END)).toBe(1);
    expect(count(out, HEADING)).toBe(1);
  });

  test("idempotent: upsert(upsert(body)) === upsert(body), never a second block", async () => {
    const { upsertMilestoneRollup } = await helpers();
    const once = upsertMilestoneRollup(PLAN_BODY, rows, { frOrder });
    const twice = upsertMilestoneRollup(once, rows, { frOrder });

    expect(twice).toBe(once);
    expect(count(twice, BEGIN)).toBe(1);
    expect(count(twice, END)).toBe(1);
    expect(count(twice, HEADING)).toBe(1);
  });

  test("non-interference: computing either render mutates nothing on disk", async () => {
    const { renderMilestoneRollup, upsertMilestoneRollup } = await helpers();

    const dir = mkdtempSync(join(tmpdir(), "token-stats-noninterference-"));
    try {
      writeFileSync(join(dir, "M92.md"), PLAN_BODY);
      writeFileSync(join(dir, "STE-101.md"), "# STE-101\n");
      const snapshot = () =>
        readdirSync(dir)
          .sort()
          .map((name) => [name, readFileSync(join(dir, name), "utf8")]);

      const before = snapshot();
      renderMilestoneRollup(rows, { frOrder });
      upsertMilestoneRollup(PLAN_BODY, rows, { frOrder });
      // The render is pure — writing the result is the caller's explicit,
      // staged act inside the release/archive commit, never a side effect.
      expect(snapshot()).toEqual(before);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
