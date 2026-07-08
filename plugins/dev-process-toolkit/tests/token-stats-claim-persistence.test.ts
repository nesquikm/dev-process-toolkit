// AC-STE-345.6 (remediation) — durable brainstorm-claim persistence.
//
// The spec-review audit flagged the claim marking as in-memory only:
// `filterRowsForFR` sets `claimed_by` on bridged rows but nothing wrote the
// mutation back to `.dev-process/token-ledger.jsonl`, so the no-double-count
// guarantee did not survive across separate /spec-write runs. These tests pin
// the durable path: `claimRowsForFR(projectRoot, opts)` reads the ledger,
// selects + claims via the same bridging semantics, persists the `claimed_by`
// marks, and returns the selected rows.

import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ledgerPath, type TokenLedgerRow } from "../adapters/_shared/src/token_usage";
import { claimRowsForFR } from "../adapters/_shared/src/token_stats_render";

function row(overrides: Partial<TokenLedgerRow>): TokenLedgerRow {
  return {
    schema: "token-ledger/v1",
    ts: "2026-07-01T10:00:00Z",
    session_id: "sess-a",
    git_branch: "chore/ste-345-branch",
    skill: "dev-process-toolkit:brainstorm",
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
  mkdirSync(join(projectRoot, ".dev-process"), { recursive: true });
  writeFileSync(path, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
}

function readLedger(projectRoot: string): TokenLedgerRow[] {
  return readFileSync(ledgerPath(projectRoot), "utf-8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as TokenLedgerRow);
}

describe("AC-STE-345.6 — claimRowsForFR persists claimed_by to the ledger file", () => {
  test("bridging a detached brainstorm sets claimed_by on the bridged rows AND persists it", () => {
    const root = mkdtempSync(join(tmpdir(), "token-claim-"));
    writeLedger(root, [
      row({ session_id: "brainstorm-old", ts: "2026-07-01T08:00:00Z" }),
      row({ session_id: "brainstorm-recent", ts: "2026-07-01T09:00:00Z" }),
      row({ session_id: "spec-write-sess", skill: "dev-process-toolkit:spec-write" }),
    ]);

    const selected = claimRowsForFR(root, {
      branch: "chore/ste-345-branch",
      sessionLineage: ["spec-write-sess"],
      brainstormClaim: "STE-345",
    });

    // Returned selection: the FR's own session rows + the bridged brainstorm rows.
    const bridged = selected.filter((r) => r.session_id === "brainstorm-recent");
    expect(bridged.length).toBe(1);
    expect(bridged[0]!.claimed_by).toBe("STE-345");

    // Durability: the claim mark landed in the ledger file itself.
    const onDisk = readLedger(root);
    const persisted = onDisk.find((r) => r.session_id === "brainstorm-recent");
    expect(persisted?.claimed_by).toBe("STE-345");
    // The older detached brainstorm stays unclaimed for the milestone bucket.
    const older = onDisk.find((r) => r.session_id === "brainstorm-old");
    expect(older?.claimed_by).toBeUndefined();
  });

  test("a second FR's claim run does not double-count already-claimed rows (cross-run)", () => {
    const root = mkdtempSync(join(tmpdir(), "token-claim-"));
    writeLedger(root, [
      row({ session_id: "brainstorm-shared", ts: "2026-07-01T09:00:00Z" }),
    ]);

    const first = claimRowsForFR(root, {
      branch: "chore/ste-345-branch",
      sessionLineage: ["fr-a-sess"],
      brainstormClaim: "STE-345",
    });
    expect(first.some((r) => r.session_id === "brainstorm-shared")).toBe(true);

    // Fresh invocation (simulating a separate /spec-write run reading from disk).
    const second = claimRowsForFR(root, {
      branch: "chore/ste-345-branch",
      sessionLineage: ["fr-b-sess"],
      brainstormClaim: "STE-346",
    });
    expect(second.some((r) => r.session_id === "brainstorm-shared")).toBe(false);
  });

  test("fail-open: missing ledger returns [] and creates nothing", () => {
    const root = mkdtempSync(join(tmpdir(), "token-claim-"));
    const selected = claimRowsForFR(root, {
      branch: "any",
      sessionLineage: ["s"],
      brainstormClaim: "STE-345",
    });
    expect(selected).toEqual([]);
    expect(existsSync(ledgerPath(root))).toBe(false);
  });

  test("no new claims ⇒ ledger bytes untouched (non-interference)", () => {
    const root = mkdtempSync(join(tmpdir(), "token-claim-"));
    writeLedger(root, [
      row({ session_id: "spec-write-sess", skill: "dev-process-toolkit:spec-write" }),
      row({ session_id: "brainstorm-owned", claimed_by: "STE-999" }),
    ]);
    const before = readFileSync(ledgerPath(root), "utf-8");

    claimRowsForFR(root, {
      branch: "chore/ste-345-branch",
      sessionLineage: ["spec-write-sess"],
      brainstormClaim: "STE-345",
    });

    expect(readFileSync(ledgerPath(root), "utf-8")).toBe(before);
  });
});
