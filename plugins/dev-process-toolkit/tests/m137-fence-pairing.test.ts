// m137-fence-pairing — `fencedFlags` pairs fences the way CommonMark does.
//
// WHY THIS FILE EXISTS. The previous closer test was "is this line
// fence-shaped" — flavor-blind, run-length-blind and info-string-blind. So
// ```bash, which is an OPENER, closed the block above it, every span after
// that point shifted, and with `fenceAware: true` on the FR walk a real
// `## Summary` could land inside a phantom span and never open.
//
// The consequence is the whole probe, not one rule. A swallowed section is
// invisible to `scan_fr_summary_altitude`, so `word_cap` AND the four
// error-severity M105 rules — `line_cap`, `backtick`, `ac_id`, `path_token` —
// all go silent on that FR. Grandfathering deliberately never spares those
// four; one forgotten closing fence did.
//
// Three consumers ride on this one function: the section walk, the plan
// scanner's `categorize`, and the FR scanner's word counting. It is fixed
// once, here, rather than three times.

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fencedFlags } from "../adapters/_shared/src/markdown_section_walk";
import {
  SUMMARY_WORD_CAP,
  scanFrSummaryAltitude,
} from "../adapters/_shared/src/scan_fr_summary_altitude";

/** The 1-indexed line numbers the walk considers fenced. */
const fencedLines = (lines: string[]): number[] =>
  fencedFlags(lines).flatMap((f, i) => (f ? [i + 1] : []));

describe("a closer is not merely a fence-shaped line", () => {
  test("an INFO STRING makes it an opener, not a closer — the reported defect", () => {
    // ```bash cannot close ```markdown. Before the fix the span ended there,
    // and everything after it shifted.
    const lines = ["```markdown", "sample", "```bash", "echo hi", "```", "after"];
    expect(fencedLines(lines), "the whole block is one span, line 6 is outside")
      .toEqual([1, 2, 3, 4, 5]);
  });

  test("the FLAVOR must match — `~~~` does not close a backtick fence", () => {
    const lines = ["```", "a", "~~~", "b", "```", "after"];
    expect(fencedLines(lines)).toEqual([1, 2, 3, 4, 5]);
  });

  test("the closer must be AT LEAST as long — ``` does not close ````", () => {
    const lines = ["````", "a", "```", "b", "````", "after"];
    expect(fencedLines(lines)).toEqual([1, 2, 3, 4, 5]);
  });

  test("a LONGER closer does close a shorter opener", () => {
    // The rule is "at least as long", not "equal" — asserted so the fix is not
    // over-tightened into refusing a legal document.
    const lines = ["```", "a", "````", "after"];
    expect(fencedLines(lines)).toEqual([1, 2, 3]);
  });

  test("a plain closer still closes — the ordinary case is untouched", () => {
    const lines = ["```ts", "const x = 1;", "```", "after"];
    expect(fencedLines(lines)).toEqual([1, 2, 3]);
  });

  test("an UNTERMINATED fence still swallows nothing", () => {
    // Pre-existing behaviour worth keeping: an opener with no closer pairs
    // with nothing, so a stray fence cannot eat the rest of the file.
    expect(fencedLines(["text", "```md", "a", "b"])).toEqual([]);
  });

  test("a backtick info string containing a backtick does not open a fence", () => {
    // CommonMark's rule, and it is what stops inline code from opening blocks.
    expect(fencedLines(["```` `inline` ````", "after"])).toEqual([]);
  });
});

describe("a mispaired fence must not silence probe #67", () => {
  test("a swallowed `## Summary` is graded again, all five rules with it", () => {
    const root = mkdtempSync(join(tmpdir(), "fence-silence-"));
    mkdirSync(join(root, "specs", "frs"), { recursive: true });
    const words = Array.from({ length: SUMMARY_WORD_CAP + 60 }, () => "w").join(" ");
    writeFileSync(
      join(root, "specs", "frs", "STE-981.md"),
      [
        "# STE-981", "", "## Technical Design", "",
        "```markdown", "sample", "```bash", "echo hi", "```", "",
        "## Summary", "", words, "",
        "## Notes", "", "```ts", "const x = 1;", "```", "",
      ].join("\n"),
    );
    try {
      const rows = scanFrSummaryAltitude(root);
      expect(rows.length, "the section must be visible to the scanner at all")
        .toBeGreaterThan(0);
      expect(rows.some((r) => r.rule === "word_cap" && r.section === "Summary")).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("the fix marks LESS content fenced, not more", () => {
  test("the old closer rule swallowed two headings this one does not", () => {
    // THE DISCRIMINATING LEG. A fix to a fence pairer could plausibly go the
    // wrong way — pairing more aggressively would fence MORE of the document
    // and hide more sections. This asserts the direction, not just the
    // outcome, by running the old rule beside the new one on one input.
    //
    // Old rule: any fence-shaped line closes. New rule: CommonMark.
    const doc = [
      "# STE-981", "", "## Technical Design", "",
      "```markdown", "sample", "```bash", "echo hi", "```", "",
      "## Summary", "", "words here", "",
      "## Notes", "", "```ts", "const x = 1;", "```", "",
    ];
    const oldFlags = ((lines: readonly string[]): boolean[] => {
      const RE = /^\s*(?:```|~~~)/;
      const flags = new Array(lines.length).fill(false);
      let i = 0;
      while (i < lines.length) {
        if (!RE.test(lines[i]!)) { i++; continue; }
        let close = i + 1;
        while (close < lines.length && !RE.test(lines[close]!)) close++;
        if (close >= lines.length) break;
        for (let k = i; k <= close; k++) flags[k] = true;
        i = close + 1;
      }
      return flags;
    })(doc);

    const headings = (flags: boolean[]): number[] =>
      doc.flatMap((l, i) => (/^##\s+/.test(l) && flags[i] ? [i + 1] : []));

    expect(headings(oldFlags), "the old rule swallowed Summary and Notes").toEqual([11, 15]);
    expect(headings(fencedFlags(doc)), "the new rule swallows neither").toEqual([]);
    expect(
      fencedFlags(doc).filter(Boolean).length,
      "and it fences FEWER lines overall — the fix does not over-pair",
    ).toBeLessThan(oldFlags.filter(Boolean).length);
  });
});
