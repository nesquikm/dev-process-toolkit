// AC-STE-345.6 (remediation) — durable brainstorm-claim persistence.
//
// The spec-review audit flagged the claim marking as in-memory only:
// `filterRowsForFR` sets `claimed_by` on bridged rows but nothing wrote the
// mutation back to the on-disk token ledger, so the no-double-count
// guarantee did not survive across separate /spec-write runs. These tests pin
// the durable path: `claimRowsForFR(projectRoot, opts)` reads the ledger,
// selects + claims via the same bridging semantics, persists the `claimed_by`
// marks, and returns the selected rows.

import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

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
  // Derive the parent from the ledger path itself — STE-382 AC-STE-382.1: no
  // module (or test helper) re-composes a `.dpt` literal of its own.
  mkdirSync(dirname(path), { recursive: true });
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
    // Fixture re-pointed under STE-396. It used to seed `spec-write-sess` and
    // then pass it INSIDE `sessionLineage` — but AC-STE-396.1 makes a
    // direct-path lineage row a claim in its own right, so that seed had come
    // to express "exactly one new claim", the opposite of this test's premise.
    // Both rows below are genuinely unclaimable by this run: one is already
    // owned by another FR, the other sits outside the lineage and is not
    // bridgeable (bridging only considers UNCLAIMED `brainstorm` rows).
    const rows = [
      row({ session_id: "other-fr-sess", skill: "dev-process-toolkit:spec-write" }),
      row({ session_id: "brainstorm-owned", claimed_by: "STE-999" }),
    ];
    // Seeded non-canonically (spaces after the separators) so that "did not
    // rewrite" is actually observable: `rewriteLedgerRows` re-serializes
    // compactly, so ANY rewrite — even one that changes no `claimed_by` —
    // changes the bytes. A compact seed would round-trip identically and make
    // the assertion below vacuous.
    mkdirSync(dirname(ledgerPath(root)), { recursive: true });
    writeFileSync(
      ledgerPath(root),
      rows.map((r) => JSON.stringify(r, null, 1).replace(/\n\s*/g, " ")).join("\n") + "\n",
    );
    const before = readFileSync(ledgerPath(root), "utf-8");

    claimRowsForFR(root, {
      branch: "chore/ste-345-branch",
      // This FR's own session has logged nothing yet — no direct-path row.
      sessionLineage: ["fr-own-sess"],
      brainstormClaim: "STE-345",
    });

    expect(readFileSync(ledgerPath(root), "utf-8")).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// STE-396 — the direct (non-bridging) claim path, durably.
//
// The coverage hole this closes: the "cross-run" case above puts the row's
// `session_id` OUTSIDE `sessionLineage`, so run 1 goes through the BRIDGING
// fallback — the one path that already marked and persisted `claimed_by`. The
// sibling cases below keep the row's `session_id` INSIDE `sessionLineage`, so
// selection happens on the direct path, which marked nothing and therefore
// persisted nothing: two FRs from one session each reported the whole
// session's cost.
//
// AC-STE-396.7 — regression anchor: two `claimRowsForFR` calls sharing one
//   `sessionLineage` with different claims. Against today's code both calls
//   return the same rows; after the fix the second returns none.
// AC-STE-396.1 — the direct-path mark is what makes the claim-value persistence
//   trigger fire, so the mark lands in the ledger file. (The trigger was reworked
//   from an identity-Set membership check to a claim-VALUE diff: a demotion
//   rewrites an already-claimed row's value, which membership could never see.)
// AC-STE-396.2/.3 — the shared-session demotion is durable, order-independent
//   and idempotent across separate runs.
// ---------------------------------------------------------------------------

/** Existing module constant reused as the demotion sentinel. */
const DESIGN_BUCKET = "design/exploration";
const BRANCH = "chore/ste-345-branch";

/** Every row's `claimed_by` on disk, keyed by session|skill. */
function claimStateOnDisk(projectRoot: string): Record<string, string> {
  const state: Record<string, string> = {};
  for (const r of readLedger(projectRoot)) {
    state[`${r.session_id}|${r.skill}`] = r.claimed_by ?? "(unclaimed)";
  }
  return state;
}

/** One session with a brainstorm + a spec-write row — no detached rows at all. */
function sharedSessionLedger(projectRoot: string): void {
  writeLedger(projectRoot, [
    row({ session_id: "shared-sess", skill: "dev-process-toolkit:brainstorm" }),
    row({ session_id: "shared-sess", skill: "dev-process-toolkit:spec-write" }),
  ]);
}

describe("AC-STE-396.7 — two FRs from ONE session do not both claim the session (direct path, no bridging)", () => {
  test("first claim takes the session's rows and persists the mark", () => {
    const root = mkdtempSync(join(tmpdir(), "token-claim-direct-"));
    sharedSessionLedger(root);

    const first = claimRowsForFR(root, {
      branch: BRANCH,
      sessionLineage: ["shared-sess"],
      brainstormClaim: "STE-394",
    });

    expect(first).toHaveLength(2);
    // AC-STE-396.1 — the direct-path mark reached the ledger FILE, via the
    // claim-value persistence trigger.
    expect(claimStateOnDisk(root)).toEqual({
      "shared-sess|dev-process-toolkit:brainstorm": "STE-394",
      "shared-sess|dev-process-toolkit:spec-write": "STE-394",
    });
  });

  test("REGRESSION ANCHOR: a second FR sharing the sessionLineage gets NOTHING — the shared rows demote to the design bucket", () => {
    const root = mkdtempSync(join(tmpdir(), "token-claim-direct-"));
    sharedSessionLedger(root);

    const first = claimRowsForFR(root, {
      branch: BRANCH,
      sessionLineage: ["shared-sess"],
      brainstormClaim: "STE-394",
    });
    expect(first).toHaveLength(2);

    // Fresh invocation, same session lineage, different FR — the exact shape
    // that produced two byte-identical `## Token Stats` blocks in M109.
    const second = claimRowsForFR(root, {
      branch: BRANCH,
      sessionLineage: ["shared-sess"],
      brainstormClaim: "STE-395",
    });

    // No double-count: the second FR does not re-report the same rows.
    expect(second).toHaveLength(0);

    // And the first FR loses them too — shared cost belongs to the milestone
    // design bucket, durably.
    expect(claimStateOnDisk(root)).toEqual({
      "shared-sess|dev-process-toolkit:brainstorm": DESIGN_BUCKET,
      "shared-sess|dev-process-toolkit:spec-write": DESIGN_BUCKET,
    });

    // AC-STE-396.4's re-render: the first FR's block, recomputed after all
    // claims settle, is now empty rather than carrying the whole session.
    const reRendered = claimRowsForFR(root, {
      branch: BRANCH,
      sessionLineage: ["shared-sess"],
      brainstormClaim: "STE-394",
    });
    expect(reRendered).toHaveLength(0);
  });

  test("token totals are not duplicated across the two FRs (the inflation itself)", () => {
    const root = mkdtempSync(join(tmpdir(), "token-claim-direct-"));
    sharedSessionLedger(root);

    const ledgerOutput = readLedger(root).reduce(
      (sum, r) => sum + r.output_tokens,
      0,
    );

    const first = claimRowsForFR(root, {
      branch: BRANCH,
      sessionLineage: ["shared-sess"],
      brainstormClaim: "STE-394",
    });
    const second = claimRowsForFR(root, {
      branch: BRANCH,
      sessionLineage: ["shared-sess"],
      brainstormClaim: "STE-395",
    });

    const claimedOutput =
      first.reduce((s, r) => s + r.output_tokens, 0) +
      second.reduce((s, r) => s + r.output_tokens, 0);

    // Today: 100 + 100 against a ledger total of 100. After the fix the two
    // runs never sum past the ledger.
    expect(claimedOutput).toBeLessThanOrEqual(ledgerOutput);
  });
});

describe("AC-STE-396.3 — durable demotion is order-independent and idempotent across runs", () => {
  test("STE-394→STE-395 and STE-395→STE-394 leave the same ledger on disk", () => {
    const forward = mkdtempSync(join(tmpdir(), "token-claim-order-"));
    sharedSessionLedger(forward);
    claimRowsForFR(forward, {
      branch: BRANCH,
      sessionLineage: ["shared-sess"],
      brainstormClaim: "STE-394",
    });
    claimRowsForFR(forward, {
      branch: BRANCH,
      sessionLineage: ["shared-sess"],
      brainstormClaim: "STE-395",
    });

    const reverse = mkdtempSync(join(tmpdir(), "token-claim-order-"));
    sharedSessionLedger(reverse);
    claimRowsForFR(reverse, {
      branch: BRANCH,
      sessionLineage: ["shared-sess"],
      brainstormClaim: "STE-395",
    });
    claimRowsForFR(reverse, {
      branch: BRANCH,
      sessionLineage: ["shared-sess"],
      brainstormClaim: "STE-394",
    });

    expect(claimStateOnDisk(forward)).toEqual(claimStateOnDisk(reverse));
    expect(Object.values(claimStateOnDisk(forward))).toEqual([
      DESIGN_BUCKET,
      DESIGN_BUCKET,
    ]);
  });

  test("a third FR from the same session changes neither the ledger bytes nor its own selection", () => {
    const root = mkdtempSync(join(tmpdir(), "token-claim-order-"));
    sharedSessionLedger(root);
    claimRowsForFR(root, {
      branch: BRANCH,
      sessionLineage: ["shared-sess"],
      brainstormClaim: "STE-394",
    });
    claimRowsForFR(root, {
      branch: BRANCH,
      sessionLineage: ["shared-sess"],
      brainstormClaim: "STE-395",
    });
    const settled = readFileSync(ledgerPath(root), "utf-8");

    const third = claimRowsForFR(root, {
      branch: BRANCH,
      sessionLineage: ["shared-sess"],
      brainstormClaim: "STE-396",
    });

    expect(third).toHaveLength(0);
    expect(readFileSync(ledgerPath(root), "utf-8")).toBe(settled);
  });
});
