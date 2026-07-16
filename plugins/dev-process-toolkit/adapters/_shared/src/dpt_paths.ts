// STE-382 AC-STE-382.1 — `.dpt` path single-source-of-truth.
//
// The sole composer of `.dpt` path literals. Every consumer that needs a
// toolkit-owned path imports from here; no other module composes a `.dpt`
// string literal. Pure path composition — no I/O, no mkdir, no existence
// checks — mirroring `token_usage.ts`'s `ledgerPath()`, the one genuine
// single-source that already existed pre-M104. Callers that need a directory
// on disk own the mkdir themselves.
//
// AC-STE-382.7 — the canonical tree keeps `locks`, `ledger`, and `scratch` as
// disjoint sibling subtrees directly under `.dpt`:
//
//   <projectRoot>/.dpt/
//   ├── locks/                      → plan locks (flat files only)
//   ├── ledger/token-ledger.jsonl   → append-only token ledger
//   └── scratch/<ulid>/             → per-run research scratch
//
// That disjointness is what dissolves the EISDIR collision by layout: pre-M104
// the research scratch lived one level *inside* the flat lock folder itself,
// putting a directory inside the very folder `findStaleLocks` readFileSync's
// without an isDirectory guard. The new tree makes that shape unrepresentable.
// (The retired folder names are recorded in the M104 FRs + CHANGELOG; naming
// them here would resurrect the literals STE-384's drift meta-test retires.)

import { join } from "node:path";

/** The toolkit-owned root: `<projectRoot>/.dpt`. */
export function dptRoot(projectRoot: string): string {
  return join(projectRoot, ".dpt");
}

/** Plan-lock directory: `<projectRoot>/.dpt/locks`. Flat lock files only. */
export function locksDir(projectRoot: string): string {
  return join(dptRoot(projectRoot), "locks");
}

/** Token ledger: `<projectRoot>/.dpt/ledger/token-ledger.jsonl`. */
export function ledgerPath(projectRoot: string): string {
  return join(dptRoot(projectRoot), "ledger", "token-ledger.jsonl");
}

/**
 * Research-scratch root: `<projectRoot>/.dpt/scratch`.
 *
 * The subtree the probe walkers (#41, #64) recurse from; per-run writers want
 * `scratchDir` instead. Exported so that walking the root never requires a
 * caller to compose a `.dpt` sub-path itself (AC-STE-382.1).
 */
export function scratchRoot(projectRoot: string): string {
  return join(dptRoot(projectRoot), "scratch");
}

/** Per-run research scratch: `<projectRoot>/.dpt/scratch/<ulid>`. */
export function scratchDir(projectRoot: string, ulid: string): string {
  return join(scratchRoot(projectRoot), ulid);
}
