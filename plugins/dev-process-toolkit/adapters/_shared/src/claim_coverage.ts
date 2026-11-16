// STE-811 (AC-STE-811.6) — claim coverage over the token ledger.
//
// `bun run adapters/_shared/src/claim_coverage.ts <projectRoot>` prints one
// line: `claimed=<n> total=<m> output_tokens_claimed=<a> output_tokens_total=<b>`.
// A row counts as claimed when its `claimed_by` names an FR; the design
// bucket is not an FR and does not count.

import { DESIGN_BUCKET, readLedgerRows, type TokenLedgerRow } from "./token_usage";

export interface ClaimCoverage {
  claimed: number;
  total: number;
  outputTokensClaimed: number;
  outputTokensTotal: number;
}

function claimsAnFR(row: TokenLedgerRow): boolean {
  return typeof row.claimed_by === "string" && row.claimed_by !== "" && row.claimed_by !== DESIGN_BUCKET;
}

export function claimCoverage(rows: TokenLedgerRow[]): ClaimCoverage {
  const cov: ClaimCoverage = { claimed: 0, total: 0, outputTokensClaimed: 0, outputTokensTotal: 0 };
  for (const row of rows) {
    const out = Number(row.output_tokens) || 0;
    cov.total += 1;
    cov.outputTokensTotal += out;
    if (claimsAnFR(row)) {
      cov.claimed += 1;
      cov.outputTokensClaimed += out;
    }
  }
  return cov;
}

export function formatClaimCoverage(cov: ClaimCoverage): string {
  return `claimed=${cov.claimed} total=${cov.total} output_tokens_claimed=${cov.outputTokensClaimed} output_tokens_total=${cov.outputTokensTotal}`;
}

if (import.meta.main) {
  const projectRoot = process.argv[2];
  if (!projectRoot) {
    process.stderr.write("usage: bun run adapters/_shared/src/claim_coverage.ts <projectRoot>\n");
    process.exit(2);
  }
  process.stdout.write(`${formatClaimCoverage(claimCoverage(readLedgerRows(projectRoot)))}\n`);
}
