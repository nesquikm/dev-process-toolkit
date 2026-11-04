// STE-726 — the token-stats bridge stays off when the session's own
// brainstorm was shared.
//
// `filterRowsForFR` bridges a detached brainstorm session only as a fallback,
// when the FR's own lineage holds no brainstorm. The guard used to look at the
// rows *selected* for this FR. A lineage brainstorm row that one session shared
// across several FRs is demoted to `design/exploration` and skipped before
// selection, so the guard saw no brainstorm and bridged the newest unrelated
// earlier session into every later FR — persisting the foreign claims.
//
// AC-STE-726.5 (mutation control): restoring the selected-rows-only check
//   const hasBrainstorm = selected.some((row) => row.skill === BRAINSTORM_SKILL);
// in place of the lineage check turns these tests red:
//   - "a demoted lineage brainstorm blocks the bridge"                 (AC .1)
//   - "replay: 20 sequential claims from one lineage claim no foreign row" (AC .4)
// The control case "a lineage with no brainstorm row is still bridged" (AC .3)
// stays green either way; it pins that the guard is narrow rather than a
// blanket disabling of the bridge.
//
// All ids are synthetic.

import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { ledgerPath, type TokenLedgerRow } from "../adapters/_shared/src/token_usage";
import { claimRowsForFR, filterRowsForFR } from "../adapters/_shared/src/token_stats_render";

const BRAINSTORM = "dev-process-toolkit:brainstorm";
const SPEC_WRITE = "dev-process-toolkit:spec-write";
const DESIGN_BUCKET = "design/exploration";

function row(overrides: Partial<TokenLedgerRow>): TokenLedgerRow {
  return {
    schema: "token-ledger/v1",
    ts: "2026-11-01T10:00:00Z",
    session_id: "sess-x",
    git_branch: "main",
    skill: BRAINSTORM,
    model: "claude-opus-4-8",
    input_tokens: 100,
    output_tokens: 50,
    cache_read_input_tokens: 10,
    cache_creation_input_tokens: 5,
    message_count: 3,
    ...overrides,
  };
}

function writeLedger(projectRoot: string, rows: TokenLedgerRow[]): void {
  const path = ledgerPath(projectRoot);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
}

function readLedger(projectRoot: string): TokenLedgerRow[] {
  return readFileSync(ledgerPath(projectRoot), "utf-8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as TokenLedgerRow);
}

const roots: string[] = [];
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

function freshRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "ste-726-bridge-"));
  roots.push(root);
  return root;
}

const EARLIER = ["sess-OLD1", "sess-OLD2", "sess-OLD3"];
const EARLIER_SET = new Set(EARLIER);

/** The FR's "Steps to reproduce" ledger: three earlier sessions, each with one
 * unclaimed brainstorm row and no spec-write row, plus a current session
 * holding one brainstorm row and one spec-write row. */
function reproduceLedger(): TokenLedgerRow[] {
  return [
    row({ session_id: "sess-OLD1", ts: "2026-07-10T09:00:00Z", skill: BRAINSTORM }),
    row({ session_id: "sess-OLD2", ts: "2026-08-05T09:00:00Z", skill: BRAINSTORM }),
    row({ session_id: "sess-OLD3", ts: "2026-08-20T09:00:00Z", skill: BRAINSTORM }),
    row({ session_id: "sess-CUR", ts: "2026-11-04T09:00:00Z", skill: BRAINSTORM }),
    row({ session_id: "sess-CUR", ts: "2026-11-04T09:30:00Z", skill: SPEC_WRITE }),
  ];
}

function claim(root: string, id: string): TokenLedgerRow[] {
  return claimRowsForFR(root, {
    branch: "main",
    sessionLineage: ["sess-CUR"],
    brainstormClaim: id,
  });
}

describe("STE-726 — a lineage brainstorm in any claim state turns the bridge off", () => {
  test("a demoted lineage brainstorm blocks the bridge", () => {
    const root = freshRoot();
    writeLedger(root, reproduceLedger());

    const ids = ["STE-9001", "STE-9002", "STE-9003", "STE-9004"];
    for (const id of ids) {
      const selected = claim(root, id);
      expect(
        selected.filter((r) => EARLIER_SET.has(r.session_id)).map((r) => r.session_id),
      ).toEqual([]);
    }

    const onDisk = readLedger(root);
    const earlier = onDisk.filter((r) => EARLIER_SET.has(r.session_id));
    expect(earlier.length).toBe(3);
    expect(earlier.map((r) => r.claimed_by ?? null)).toEqual([null, null, null]);

    const current = onDisk.filter((r) => r.session_id === "sess-CUR");
    expect(current.length).toBe(2);
    expect(current.map((r) => r.claimed_by)).toEqual([DESIGN_BUCKET, DESIGN_BUCKET]);
  });

  test("replay: 20 sequential claims from one lineage claim no foreign row", () => {
    const root = freshRoot();
    writeLedger(root, reproduceLedger());

    const foreignSelected: string[] = [];
    for (let n = 1; n <= 20; n++) {
      const id = `STE-${9000 + n}`;
      const selected = claim(root, id);
      for (const r of selected) {
        if (EARLIER_SET.has(r.session_id)) foreignSelected.push(`${id}:${r.session_id}`);
      }
    }
    expect(foreignSelected).toEqual([]);

    const onDisk = readLedger(root);
    expect(
      onDisk.filter((r) => EARLIER_SET.has(r.session_id)).map((r) => r.claimed_by ?? null),
    ).toEqual([null, null, null]);
    const current = onDisk.filter((r) => r.session_id === "sess-CUR");
    expect(current.length).toBe(2);
    for (const r of current) expect(r.claimed_by).toBe(DESIGN_BUCKET);
  });

  describe("filterRowsForFR — lineage brainstorm claim states (AC .2)", () => {
    function ledgerWithLineageBrainstorm(claimedBy: string | undefined): TokenLedgerRow[] {
      return [
        row({ session_id: "sess-OLD1", ts: "2026-08-01T09:00:00Z", skill: BRAINSTORM }),
        row({ session_id: "sess-OLD2", ts: "2026-08-02T09:00:00Z", skill: BRAINSTORM }),
        // Off-lineage row already owned by an unrelated FR: must stay as is.
        row({
          session_id: "sess-OTHER",
          ts: "2026-08-03T09:00:00Z",
          skill: BRAINSTORM,
          claimed_by: "STE-9100",
        }),
        row({
          session_id: "sess-CUR",
          ts: "2026-11-04T09:00:00Z",
          skill: BRAINSTORM,
          ...(claimedBy === undefined ? {} : { claimed_by: claimedBy }),
        }),
        row({ session_id: "sess-CUR", ts: "2026-11-04T09:30:00Z", skill: SPEC_WRITE }),
      ];
    }

    const states: Array<[string, string | undefined]> = [
      ["unset", undefined],
      ["another FR's id", "STE-9050"],
      ["design/exploration", DESIGN_BUCKET],
    ];

    for (const [label, claimedBy] of states) {
      test(`lineage brainstorm claimed_by ${label} → no off-lineage row selected or marked`, () => {
        const ledger = ledgerWithLineageBrainstorm(claimedBy);
        const selected = filterRowsForFR(ledger, {
          branch: "main",
          sessionLineage: ["sess-CUR"],
          brainstormClaim: "STE-9060",
        });

        expect(
          selected.filter((r) => r.session_id !== "sess-CUR").map((r) => r.session_id),
        ).toEqual([]);

        const offLineage = ledger.filter((r) => r.session_id !== "sess-CUR");
        expect(offLineage.map((r) => [r.session_id, r.claimed_by ?? null])).toEqual([
          ["sess-OLD1", null],
          ["sess-OLD2", null],
          ["sess-OTHER", "STE-9100"],
        ]);
      });
    }
  });

  test("a lineage with no brainstorm row is still bridged (AC .3 control)", () => {
    const root = freshRoot();
    writeLedger(root, [
      row({ session_id: "sess-OLD1", ts: "2026-08-01T09:00:00Z", skill: BRAINSTORM }),
      row({ session_id: "sess-OLD2", ts: "2026-08-02T09:00:00Z", skill: BRAINSTORM }),
      row({ session_id: "sess-CUR", ts: "2026-11-04T09:30:00Z", skill: SPEC_WRITE }),
    ]);

    const selected = claim(root, "STE-9070");
    expect(
      selected.filter((r) => EARLIER_SET.has(r.session_id)).map((r) => r.session_id),
    ).toEqual(["sess-OLD2"]);

    const onDisk = readLedger(root);
    expect(onDisk.find((r) => r.session_id === "sess-OLD2")?.claimed_by).toBe("STE-9070");
    expect(onDisk.find((r) => r.session_id === "sess-OLD1")?.claimed_by ?? null).toBeNull();
  });
});
