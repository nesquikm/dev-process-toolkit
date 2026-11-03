// STE-703 — the token-stats bridge claims only a brainstorm that wrote no
// specs of its own.
//
// The detached-brainstorm bridge in `claimRowsForFR` used to take the most
// recent unclaimed brainstorm session on the branch, even when that session
// went on to run `dev-process-toolkit:spec-write` itself — so a fresh spec run
// adopted earlier sessions' design work as its own and persisted the marks.
//
// AC-STE-703.5 (mutation control): removing the "session wrote no spec-write
// row" exclusion from the bridge's candidate filter turns these tests red:
//   - "a session that wrote its own specs is never bridged"            (AC .1/.2)
//   - "an excluded newest session falls back to an older eligible one" (AC .4)
// The control case "a detached brainstorm with no spec-write row is still
// bridged" (AC .3) stays green either way; it pins that the exclusion is
// narrow rather than a blanket disabling of the bridge.
//
// All ids are synthetic.

import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { ledgerPath, type TokenLedgerRow } from "../adapters/_shared/src/token_usage";
import { claimRowsForFR } from "../adapters/_shared/src/token_stats_render";

const BRAINSTORM = "dev-process-toolkit:brainstorm";
const SPEC_WRITE = "dev-process-toolkit:spec-write";
const DELIVER = "dev-process-toolkit:deliver";

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
  const root = mkdtempSync(join(tmpdir(), "ste-703-bridge-"));
  roots.push(root);
  return root;
}

describe("STE-703 — bridge excludes sessions that wrote their own specs", () => {
  test("a session that wrote its own specs is never bridged", () => {
    const root = freshRoot();
    writeLedger(root, [
      // Older earlier session: brainstorm + its own spec-write.
      row({ session_id: "sess-OLD", ts: "2026-11-01T08:00:00Z", skill: BRAINSTORM }),
      row({ session_id: "sess-OLD", ts: "2026-11-01T08:30:00Z", skill: SPEC_WRITE }),
      // Newer earlier session: brainstorm + its own spec-write.
      row({ session_id: "sess-NEW", ts: "2026-11-01T09:00:00Z", skill: BRAINSTORM }),
      row({ session_id: "sess-NEW", ts: "2026-11-01T09:30:00Z", skill: SPEC_WRITE }),
      // Current session: deliver only.
      row({ session_id: "sess-CUR", ts: "2026-11-01T10:00:00Z", skill: DELIVER }),
    ]);

    const foreign = new Set(["sess-OLD", "sess-NEW"]);

    const first = claimRowsForFR(root, {
      branch: "main",
      sessionLineage: ["sess-CUR"],
      brainstormClaim: "STE-9001",
    });
    expect(first.filter((r) => foreign.has(r.session_id)).map((r) => r.session_id)).toEqual([]);
    // The current session's own row is still selected (direct path unaffected).
    expect(first.map((r) => r.session_id)).toEqual(["sess-CUR"]);

    const second = claimRowsForFR(root, {
      branch: "main",
      sessionLineage: ["sess-CUR"],
      brainstormClaim: "STE-9002",
    });
    expect(second.filter((r) => foreign.has(r.session_id)).map((r) => r.session_id)).toEqual([]);

    const onDisk = readLedger(root).filter((r) => foreign.has(r.session_id));
    expect(onDisk.length).toBe(4);
    expect(onDisk.map((r) => r.claimed_by ?? null)).toEqual([null, null, null, null]);
  });

  test("an excluded newest session falls back to an older eligible one", () => {
    const root = freshRoot();
    writeLedger(root, [
      // Older detached brainstorm, no spec-write: eligible.
      row({ session_id: "sess-ELIG", ts: "2026-11-01T07:00:00Z", skill: BRAINSTORM }),
      row({
        session_id: "sess-ELIG",
        ts: "2026-11-01T07:10:00Z",
        skill: BRAINSTORM,
        model: "claude-sonnet-4-8",
      }),
      // Newest unclaimed brainstorm session wrote its own specs: excluded.
      row({ session_id: "sess-EXCL", ts: "2026-11-01T09:00:00Z", skill: BRAINSTORM }),
      row({ session_id: "sess-EXCL", ts: "2026-11-01T09:20:00Z", skill: SPEC_WRITE }),
      // Current session.
      row({ session_id: "sess-CUR", ts: "2026-11-01T10:00:00Z", skill: DELIVER }),
    ]);

    const selected = claimRowsForFR(root, {
      branch: "main",
      sessionLineage: ["sess-CUR"],
      brainstormClaim: "STE-9003",
    });

    const bridged = selected.filter((r) => r.session_id === "sess-ELIG");
    expect(bridged.length).toBe(2);
    expect(bridged.map((r) => r.claimed_by)).toEqual(["STE-9003", "STE-9003"]);
    expect(selected.filter((r) => r.session_id === "sess-EXCL")).toEqual([]);

    const onDisk = readLedger(root);
    expect(
      onDisk.filter((r) => r.session_id === "sess-ELIG").map((r) => r.claimed_by),
    ).toEqual(["STE-9003", "STE-9003"]);
    expect(
      onDisk.filter((r) => r.session_id === "sess-EXCL").map((r) => r.claimed_by ?? null),
    ).toEqual([null, null]);
  });

  test("a detached brainstorm with no spec-write row is still bridged", () => {
    const root = freshRoot();
    writeLedger(root, [
      row({ session_id: "sess-DETACHED", ts: "2026-11-01T09:00:00Z", skill: BRAINSTORM }),
      row({ session_id: "sess-CUR", ts: "2026-11-01T10:00:00Z", skill: SPEC_WRITE }),
    ]);

    const selected = claimRowsForFR(root, {
      branch: "main",
      sessionLineage: ["sess-CUR"],
      brainstormClaim: "STE-9004",
    });

    const bridged = selected.filter((r) => r.session_id === "sess-DETACHED");
    expect(bridged.map((r) => r.claimed_by)).toEqual(["STE-9004"]);
    expect(
      readLedger(root).find((r) => r.session_id === "sess-DETACHED")?.claimed_by,
    ).toBe("STE-9004");
  });
});
