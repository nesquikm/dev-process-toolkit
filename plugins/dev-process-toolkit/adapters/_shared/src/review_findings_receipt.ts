// STE-774 — reviews record their finding counts.
//
//   bun run "${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/review_findings_receipt.ts" record <root> <reviewer> <result-file>
//
// Parses the reviewer's result (a `spec-review-result` block, a
// `tdd-spec-review-result` block, or a code-review `OVERALL:` line) and writes
// ONE `review-findings` receipt through the shipped receipt store
// (`tracker_receipts.ts`). The receipt holds counts only — never finding text
// or a source path.
//
// FAIL-CLOSED like `gate_receipt.ts`: every refusal exits 1 with the NFR-10
// envelope on stderr, prints nothing on stdout and writes nothing. An
// unparseable result is never recorded as a zero.

import { existsSync, readFileSync } from "node:fs";

import { nfr10Message } from "./dpt_version";
import { checkoutRootOf, headOf } from "./gate_receipt";
import { reviewFindingsSwitchOn } from "./project_settings";
import { parseSpecReviewResultBlock } from "./spec_review_result";
import { extractTddSpecReviewBlock, parseTddSpecReviewBlock } from "./tdd_spec_review_result";
import { announceReceipt, oneLine, writeReceipt } from "./tracker_receipts";

/** The reviewers that record findings — a closed list. */
export const REVIEWERS = ["spec-review", "tdd-audit", "code-review"] as const;

export type Reviewer = (typeof REVIEWERS)[number];

/** The receipt kind a review's counts are recorded under. */
export const REVIEW_FINDINGS_KIND = "review-findings";

export interface FrCounts {
  done?: number;
  partial: number;
  missing: number;
}

export type ReviewCounts = Record<string, FrCounts> | { concerns: number };

export interface ReviewFindings {
  frs: string[];
  counts: ReviewCounts;
}

/** A refusal carrying the NFR-10 three-line shape. */
export class ReviewFindingsError extends Error {
  constructor(verdict: string, remedy: string, context: string) {
    super(nfr10Message(`Refusing: ${oneLine(verdict)}`, oneLine(remedy), oneLine(context)));
    this.name = "ReviewFindingsError";
  }
}

export function isReviewer(name: string): name is Reviewer {
  return (REVIEWERS as readonly string[]).includes(name);
}

/** `AC-STE-900.3` → `STE-900`; null when the id has no `.N` suffix. */
function frOfAc(ac: string): string | null {
  const m = /^AC-(.+)\.\d+$/.exec(ac.trim());
  return m ? m[1]! : null;
}

function unparseable(reviewer: Reviewer, reason: string): ReviewFindingsError {
  return new ReviewFindingsError(
    `the ${reviewer} result could not be parsed (${reason}), so no finding counts were recorded`,
    `pass the file holding the ${reviewer} result exactly as the reviewer emitted it, then re-run the record call`,
    `reason=unparseable, reviewer=${reviewer}`,
  );
}

/** The FR an AC id names, or the unparseable refusal both block parsers share. */
function frOrRefuse(reviewer: Reviewer, ac: string): string {
  const fr = frOfAc(ac);
  if (fr === null) throw unparseable(reviewer, `AC id "${ac}" names no FR`);
  return fr;
}

function bump(counts: Record<string, FrCounts>, fr: string, key: "done" | "partial" | "missing", seed: FrCounts): void {
  const row = (counts[fr] ??= { ...seed });
  row[key] = (row[key] ?? 0) + 1;
}

/** Parse one reviewer's result text into FR ids and counts, or throw. */
export function parseReviewFindings(reviewer: Reviewer, text: string): ReviewFindings {
  if (reviewer === "spec-review") {
    const parsed = parseSpecReviewResultBlock(text);
    if (!parsed.ok) throw unparseable(reviewer, parsed.reason);
    const counts: Record<string, FrCounts> = {};
    for (const row of parsed.block.traceability) {
      bump(counts, frOrRefuse(reviewer, row.ac), row.status, { done: 0, partial: 0, missing: 0 });
    }
    return { frs: Object.keys(counts).sort(), counts };
  }

  if (reviewer === "tdd-audit") {
    const extracted = extractTddSpecReviewBlock(text);
    if (!extracted.ok) throw unparseable(reviewer, extracted.reason);
    const parsed = parseTddSpecReviewBlock(extracted.body);
    if (!parsed.ok) throw unparseable(reviewer, parsed.reason);
    // The block carries no done list, so only partial and missing are counted.
    const counts: Record<string, FrCounts> = {};
    const seed: FrCounts = { partial: 0, missing: 0 };
    for (const [list, key] of [
      [parsed.block.missing_acs, "missing"],
      [parsed.block.partial_acs, "partial"],
    ] as const) {
      for (const ac of list) {
        bump(counts, frOrRefuse(reviewer, ac), key, seed);
      }
    }
    return { frs: Object.keys(counts).sort(), counts };
  }

  // code-review: one OVERALL line per pass.
  const overall = text.split("\n").filter((l) => /^OVERALL:/.test(l.trim()));
  if (overall.length !== 1) {
    throw unparseable(reviewer, `expected exactly one OVERALL line, found ${overall.length}`);
  }
  const line = overall[0]!.trim();
  let concerns: number;
  const m = /^OVERALL: CONCERNS \((\d+)\)$/.exec(line);
  if (m) concerns = Number(m[1]);
  else if (line === "OVERALL: OK") concerns = 0;
  else throw unparseable(reviewer, `"${line}" is neither "OVERALL: OK" nor "OVERALL: CONCERNS (N)"`);
  // FR ids by the spec reviewers' rule (frOfAc), so both paths name an FR alike.
  const frs = new Set<string>();
  for (const hit of text.matchAll(/\bAC-[A-Za-z0-9_-]+\.\d+\b/g)) {
    const fr = frOfAc(hit[0]);
    if (fr !== null) frs.add(fr);
  }
  return { frs: [...frs].sort(), counts: { concerns } };
}

/**
 * Record one review's counts and return the receipt path — or `null` when the
 * `tracking.review_findings` switch reads off, in which case nothing is read,
 * parsed or written.
 */
export function recordReviewFindings(root: string, reviewer: string, resultFile: string): string | null {
  const checkout = checkoutRootOf(root);
  // The switch is read from the checkout, or from the root itself outside one, so
  // "switch off" is the same silent no-op everywhere.
  if (!reviewFindingsSwitchOn(checkout ?? root)) return null;
  if (!isReviewer(reviewer)) {
    throw new ReviewFindingsError(
      `"${reviewer}" is not a reviewer that records findings, so nothing was recorded`,
      `name one of ${REVIEWERS.join(", ")} when running the record call`,
      `reason=unknown-reviewer, reviewer=${reviewer}`,
    );
  }
  if (!existsSync(resultFile)) {
    throw new ReviewFindingsError(
      `the result file "${resultFile}" does not exist, so no finding counts were recorded`,
      "write the reviewer's result to a file first, then pass its path",
      `reason=no-result-file, reviewer=${reviewer}`,
    );
  }
  const sessionId = process.env.CLAUDE_CODE_SESSION_ID;
  if (sessionId === undefined || sessionId === "") {
    throw new ReviewFindingsError(
      "CLAUDE_CODE_SESSION_ID is unset or empty, and review findings are keyed by the session that produced them",
      "run the record call from a Claude Code session, which exports CLAUDE_CODE_SESSION_ID",
      `reason=session-id-unavailable, reviewer=${reviewer}`,
    );
  }
  if (checkout === null) {
    throw new ReviewFindingsError(
      `"${root}" is not inside a git checkout, so there is no project to record review findings against`,
      "pass a path inside a git checkout as <root>",
      `reason=no-checkout, path=${root}`,
    );
  }

  let resultText: string;
  try {
    resultText = readFileSync(resultFile, "utf-8");
  } catch (error) {
    throw new ReviewFindingsError(
      `the result file "${resultFile}" could not be read (${error instanceof Error ? error.message : String(error)}), so no finding counts were recorded`,
      "pass a readable file holding the reviewer's result",
      `reason=unreadable-result-file, reviewer=${reviewer}`,
    );
  }
  const findings = parseReviewFindings(reviewer, resultText);
  const evidence = { reviewer, head: headOf(checkout), frs: findings.frs, counts: findings.counts };
  try {
    return writeReceipt(checkout, {
      kind: REVIEW_FINDINGS_KIND,
      adapter: null,
      container: null,
      subject: reviewer,
      decision: "recorded",
      evidence,
    });
  } catch (error) {
    throw new ReviewFindingsError(
      `the review-findings receipt could not be stored under ${checkout}: ${error instanceof Error ? error.message : String(error)}`,
      `make the toolkit's ${checkout}/.dpt tree writable, then re-run the record call`,
      `reason=receipt-not-written, reviewer=${reviewer}, root=${checkout}`,
    );
  }
}

if (import.meta.main) {
  const [verb, root, reviewer, resultFile] = process.argv.slice(2);
  try {
    if (verb !== "record" || root === undefined || reviewer === undefined || resultFile === undefined) {
      throw new ReviewFindingsError(
        "the review-findings front door was not given the record verb and its three values",
        "run `bun run review_findings_receipt.ts record <root> <reviewer> <result-file>`",
        "reason=incomplete-argv",
      );
    }
    const path = recordReviewFindings(root, reviewer, resultFile);
    if (path !== null) console.log(announceReceipt(path));
  } catch (error) {
    // stderr, never stdout — fail-closed on both channels.
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
