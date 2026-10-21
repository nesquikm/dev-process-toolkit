// STE-683 — bun count fallback stops subtracting skips twice.
//
// `parseBun`'s fallback (no `Ran N tests across M files` line) took the last
// `N pass` counter as `total`, while `deriveRunCounts` derives bun `pass` as
// `total - fail - skipped` — the `Ran`-line meaning. The fallback total must
// carry that same meaning: pass + fail + skip.
//
// Naming note: the AC says `formatClosingLine`; the codebase's one exported
// closing-line renderer is `renderClosingLine` in test_count_parser.ts.

import { describe, expect, test } from "bun:test";
import {
  parseTestOutput,
  renderClosingLine,
} from "../adapters/_shared/src/test_count_parser";
import { deriveRunCounts } from "../adapters/_shared/src/deliver_stage_evidence";

// The FR's reproduction: ends with 5 pass, 2 skip, 1 fail; no Ran line.
const FALLBACK_OUTPUT = [
  "tests/a.test.ts:",
  "(pass) a > one",
  "(skip) a > two",
  "",
  " 5 pass",
  " 2 skip",
  " 1 fail",
  " 12 expect() calls",
].join("\n");

// Multi-file shape: earlier per-file counters precede the summary block.
const FALLBACK_MULTI_FILE = [
  "tests/a.test.ts:",
  " 1 pass",
  " 1 skip",
  " 0 fail",
  "tests/b.test.ts:",
  " 2 pass",
  " 0 fail",
  "",
  " 7 pass",
  " 3 skip",
  " 2 fail",
].join("\n");

// Control: the Ran line is present — the total it carries is authoritative.
const RAN_LINE_OUTPUT = [
  " 5 pass",
  " 2 skip",
  " 1 fail",
  " 12 expect() calls",
  "Ran 8 tests across 3 files. [1.23s]",
].join("\n");

describe("STE-683 bun fallback total", () => {
  test("bun output with no Ran line reports the pass counter as pass", () => {
    const counts = deriveRunCounts({ output: FALLBACK_OUTPUT, stack: "bun" });
    expect(counts).toEqual({ ok: true, pass: 5, fail: 1, skip: 2 });
  });

  test("AC-STE-683.2: fallback total = last pass + failures + skipped", () => {
    const parsed = parseTestOutput(FALLBACK_OUTPUT, "bun");
    expect(parsed).toEqual({
      ok: true,
      count: { total: 8, failures: 1, errors: 0, skipped: 2 },
    });
  });

  test("AC-STE-683.2: fallback total anchors on the LAST counters in multi-file output", () => {
    const parsed = parseTestOutput(FALLBACK_MULTI_FILE, "bun");
    expect(parsed).toEqual({
      ok: true,
      count: { total: 12, failures: 2, errors: 0, skipped: 3 },
    });
  });

  test("AC-STE-683.2: fallback with no skip and no fail lines totals the pass counter", () => {
    const parsed = parseTestOutput(" 4 pass\n", "bun");
    expect(parsed).toEqual({
      ok: true,
      count: { total: 4, failures: 0, errors: 0, skipped: 0 },
    });
  });

  test("AC-STE-683.2 control: output with a Ran line parses unchanged", () => {
    const parsed = parseTestOutput(RAN_LINE_OUTPUT, "bun");
    expect(parsed).toEqual({
      ok: true,
      count: { total: 8, failures: 1, errors: 0, skipped: 2 },
    });
    expect(deriveRunCounts({ output: RAN_LINE_OUTPUT, stack: "bun" })).toEqual({
      ok: true,
      pass: 5,
      fail: 1,
      skip: 2,
    });
  });

  test("AC-STE-683.3: deriveRunCounts pass equals the last pass counter in multi-file fallback", () => {
    const counts = deriveRunCounts({ output: FALLBACK_MULTI_FILE, stack: "bun" });
    expect(counts).toEqual({ ok: true, pass: 7, fail: 2, skip: 3 });
  });

  test("AC-STE-683.3: the closing line renders the skip-inclusive total", () => {
    const parsed = parseTestOutput(FALLBACK_OUTPUT, "bun");
    if (!parsed.ok) throw new Error(`parse failed: ${parsed.reason}`);
    expect(renderClosingLine(parsed.count)).toBe(
      "Total test count at release: 8 tests, 1 failures, 0 errors.",
    );
  });

  test("AC-STE-683.3: fallback and Ran-line output render the same closing line", () => {
    const fallback = parseTestOutput(FALLBACK_OUTPUT, "bun");
    const ran = parseTestOutput(RAN_LINE_OUTPUT, "bun");
    if (!fallback.ok || !ran.ok) throw new Error("parse failed");
    expect(renderClosingLine(fallback.count)).toBe(renderClosingLine(ran.count));
  });
});
