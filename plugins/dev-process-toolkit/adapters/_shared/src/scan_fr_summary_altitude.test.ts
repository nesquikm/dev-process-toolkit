// STE-386 — pure scanner backing /gate-check probe #67 `fr_summary_altitude`.
// RED-state until the implementation lands at:
//   plugins/dev-process-toolkit/adapters/_shared/src/scan_fr_summary_altitude.ts
//
// Contract pinned here:
//
//   scanFrSummaryAltitude(projectRoot: string)
//     => { file: string; line: number; rule: string }[]
//
// Walks ACTIVE FRs only — `specs/frs/*.md`, `archive/` excluded — and for
// each file whose body carries a `## Summary` section (heading matched by
// /^##\s+Summary\s*$/; the section ends at the next `^##` heading or EOF)
// evaluates the four altitude rules over the SECTION BODY ONLY:
//
//   line_cap   — more than 6 non-empty lines fails; the violation anchors at
//                the first non-empty line beyond the cap (the 7th). The
//                3-line floor is authoring guidance, NOT probe-enforced.
//   backtick   — any backtick character on a line.
//   ac_id      — an AC-ID token of the AC-prefix shape, regardless of
//                tracker flavor (AC-STE-386.2 and AC-DST-45.1 both flag).
//   path_token — a whitespace-delimited token containing BOTH a slash and a
//                dot-extension. "and/or", "read/write", "v2.46.0", and the
//                sentence-final "request/response." must all stay clean.
//
// `file` is repo-root-relative with POSIX separators; `line` is 1-indexed.
// Vacuity (AC-STE-386.2): no `## Summary` → no violations; an empty or
// absent `specs/frs/` → no violations (the probe caller renders zero
// violations as a bare GATE PASSED row with no note — a run that never
// authored a summary stays byte-identically green).
//
// AC map: AC-STE-386.1 (rule matrix, file:line, closed rule-id set),
// AC-STE-386.2 (vacuous paths), AC-STE-386.5 (one violating fixture per
// rule + a clean fixture + both vacuous paths). AC-STE-386.6 is the
// aggregate suite-green AC — no dedicated test beyond the suite itself.
// Modelled on scan_design_references.ts and its probe test.

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
// Module not yet present — this import drives the RED state.
import { scanFrSummaryAltitude } from "./scan_fr_summary_altitude";

interface Violation {
  file: string;
  line: number;
  rule: string;
}

/** Build a real temp project tree: rel-path => content, plus empty dirs. */
function makeTree(
  files: Record<string, string>,
  emptyDirs: string[] = [],
): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "fr-summary-altitude-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  for (const rel of emptyDirs) {
    mkdirSync(join(root, rel), { recursive: true });
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

/** 1-indexed line of the first line in `content` containing `needle`. */
function lineOf(content: string, needle: string): number {
  const idx = content.split("\n").findIndex((l) => l.includes(needle));
  expect(idx).toBeGreaterThan(-1);
  return idx + 1;
}

/**
 * A realistic active-FR file. When `summaryLines` is given, a `## Summary`
 * section lands first-in-body (STE-385 placement); either way the file ends
 * with a `## Requirement` tail that deliberately carries backticks, an AC-ID
 * token, and a path token — so EVERY fixture also proves the four rules stop
 * at the section boundary (post-section content never flags).
 */
function frWith(id: string, summaryLines: string[] | null): string {
  const head = [
    "---",
    `title: "Fixture ${id}"`,
    "status: active",
    "---",
    "",
    `# ${id}: Fixture`,
    "",
  ];
  const summary =
    summaryLines === null ? [] : ["## Summary", "", ...summaryLines, ""];
  const tail = [
    "## Requirement",
    "",
    "Post-section prose may reference `scan_fr_summary_altitude.ts` and",
    "adapters/_shared/src/scan_fr_summary_altitude.ts and AC-STE-386.1",
    "freely — the four altitude rules bind to the Summary section only.",
    "",
  ];
  return `${[...head, ...summary, ...tail].join("\n")}\n`;
}

const byRule = (violations: Violation[], rule: string): Violation[] =>
  violations.filter((v) => v.rule === rule);

describe("AC-STE-386.1 — rule matrix over the Summary section", () => {
  test("line_cap — 7 non-empty summary lines flag once, anchored at the first line beyond the cap", () => {
    const content = frWith("STE-901", [
      "One plain line.",
      "Two plain lines.",
      "Three plain lines.",
      "Four plain lines.",
      "Five plain lines.",
      "Six plain lines.",
      "Seven-over-cap line.",
    ]);
    const fx = makeTree({ "specs/frs/STE-901.md": content });
    try {
      const violations = scanFrSummaryAltitude(fx.root) as Violation[];
      expect(violations).toHaveLength(1);
      expect(violations[0]).toMatchObject({
        file: "specs/frs/STE-901.md",
        line: lineOf(content, "Seven-over-cap line."),
        rule: "line_cap",
      });
    } finally {
      fx.cleanup();
    }
  });

  test("backtick — any backtick character in the summary flags that line", () => {
    const content = frWith("STE-902", [
      "Names a helper `renderThing` mid-sentence.",
      "Second line stays plain prose.",
    ]);
    const fx = makeTree({ "specs/frs/STE-902.md": content });
    try {
      const violations = scanFrSummaryAltitude(fx.root) as Violation[];
      expect(violations).toHaveLength(1);
      expect(violations[0]).toMatchObject({
        file: "specs/frs/STE-902.md",
        line: lineOf(content, "`renderThing`"),
        rule: "backtick",
      });
    } finally {
      fx.cleanup();
    }
  });

  test("ac_id — AC-ID tokens flag regardless of tracker flavor", () => {
    const linearFlavor = frWith("STE-903", [
      "Delivers what AC-STE-386.2 asked for, in plain words.",
    ]);
    const jiraFlavor = frWith("DST-45", [
      "Validated against AC-DST-45.1 during the review pass.",
    ]);
    const fx = makeTree({
      "specs/frs/STE-903.md": linearFlavor,
      "specs/frs/DST-45.md": jiraFlavor,
    });
    try {
      const violations = scanFrSummaryAltitude(fx.root) as Violation[];
      const linearHits = violations.filter(
        (v) => v.file === "specs/frs/STE-903.md",
      );
      expect(linearHits).toHaveLength(1);
      expect(linearHits[0]).toMatchObject({
        line: lineOf(linearFlavor, "AC-STE-386.2 asked"),
        rule: "ac_id",
      });
      const jiraHits = violations.filter(
        (v) => v.file === "specs/frs/DST-45.md",
      );
      expect(jiraHits).toHaveLength(1);
      expect(jiraHits[0]).toMatchObject({
        line: lineOf(jiraFlavor, "AC-DST-45.1 during"),
        rule: "ac_id",
      });
    } finally {
      fx.cleanup();
    }
  });

  test("path_token — a token with both a slash and a dot-extension flags", () => {
    const content = frWith("STE-904", [
      "The scanner walks adapters/_shared/src/foo.ts on every run.",
    ]);
    const fx = makeTree({ "specs/frs/STE-904.md": content });
    try {
      const violations = scanFrSummaryAltitude(fx.root) as Violation[];
      expect(violations).toHaveLength(1);
      expect(violations[0]).toMatchObject({
        file: "specs/frs/STE-904.md",
        line: lineOf(content, "adapters/_shared/src/foo.ts"),
        rule: "path_token",
      });
    } finally {
      fx.cleanup();
    }
  });

  test("clean summary — natural prose with and/or, read/write, v2.46.0, sentence-final request/response. yields zero violations", () => {
    const content = frWith("STE-905", [
      "A project-health probe keeps FR summaries readable and/or terse.",
      "It applies read/write heuristics without flagging v2.46.0 either.",
      "",
      "Sentence-final tokens like request/response. also stay clean.",
      "Nothing here names code, file paths, or acceptance identifiers.",
    ]);
    const fx = makeTree({ "specs/frs/STE-905.md": content });
    try {
      expect(scanFrSummaryAltitude(fx.root)).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("line_cap boundary — exactly 6 non-empty lines (blank lines don't count) yields zero violations", () => {
    const content = frWith("STE-906", [
      "First plain line.",
      "",
      "Second plain line.",
      "Third plain line.",
      "",
      "Fourth plain line.",
      "Fifth plain line.",
      "Sixth plain line.",
    ]);
    const fx = makeTree({ "specs/frs/STE-906.md": content });
    try {
      expect(scanFrSummaryAltitude(fx.root)).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("EOF-bounded section — a Summary with no following heading is still scanned", () => {
    const content = `${[
      "---",
      'title: "Fixture STE-907"',
      "---",
      "",
      "# STE-907: Fixture",
      "",
      "## Summary",
      "",
      "Ends at EOF while naming `tail_helper` in backticks.",
    ].join("\n")}\n`;
    const fx = makeTree({ "specs/frs/STE-907.md": content });
    try {
      const violations = scanFrSummaryAltitude(fx.root) as Violation[];
      expect(violations).toHaveLength(1);
      expect(violations[0]).toMatchObject({
        file: "specs/frs/STE-907.md",
        line: lineOf(content, "`tail_helper`"),
        rule: "backtick",
      });
    } finally {
      fx.cleanup();
    }
  });

  test("rule ids come from the closed set across a multi-file tree; the clean file never appears", () => {
    const fx = makeTree({
      "specs/frs/STE-901.md": frWith("STE-901", [
        "One.",
        "Two.",
        "Three.",
        "Four.",
        "Five.",
        "Six.",
        "Seven-over-cap.",
      ]),
      "specs/frs/STE-902.md": frWith("STE-902", [
        "Names a helper `renderThing` mid-sentence.",
      ]),
      "specs/frs/STE-903.md": frWith("STE-903", [
        "Delivers what AC-STE-386.2 asked for, in plain words.",
      ]),
      "specs/frs/STE-904.md": frWith("STE-904", [
        "The scanner walks adapters/_shared/src/foo.ts on every run.",
      ]),
      "specs/frs/STE-905.md": frWith("STE-905", [
        "A plain-language summary with nothing to flag at all.",
      ]),
    });
    try {
      const violations = scanFrSummaryAltitude(fx.root) as Violation[];
      expect(new Set(violations.map((v) => v.rule))).toEqual(
        new Set(["line_cap", "backtick", "ac_id", "path_token"]),
      );
      expect(violations).toHaveLength(4);
      expect(
        violations.some((v) => v.file === "specs/frs/STE-905.md"),
      ).toBe(false);
      for (const v of violations) {
        expect(v.line).toBeGreaterThan(0);
      }
    } finally {
      fx.cleanup();
    }
  });
});

describe("AC-STE-386.2 — vacuity: absent Summary / absent FRs never flag", () => {
  test("an FR without a ## Summary section produces no violation", () => {
    const fx = makeTree({
      "specs/frs/STE-910.md": frWith("STE-910", null),
    });
    try {
      expect(scanFrSummaryAltitude(fx.root)).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("an h3 `### Summary` heading is NOT a Summary section (heading regex is level-2 exact)", () => {
    const content = `${[
      "---",
      'title: "Fixture STE-911"',
      "---",
      "",
      "# STE-911: Fixture",
      "",
      "### Summary",
      "",
      "Would flag `backticks` and AC-STE-386.2 if this h3 counted.",
      "",
      "## Requirement",
      "",
      "Body.",
    ].join("\n")}\n`;
    const fx = makeTree({ "specs/frs/STE-911.md": content });
    try {
      expect(scanFrSummaryAltitude(fx.root)).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("an FR-less specs/frs/ (empty dir) passes clean", () => {
    const fx = makeTree({}, ["specs/frs"]);
    try {
      expect(scanFrSummaryAltitude(fx.root)).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("an absent specs/frs/ passes clean (returns [], never throws)", () => {
    const fx = makeTree({ "specs/requirements.md": "# Requirements\n" });
    try {
      expect(scanFrSummaryAltitude(fx.root)).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("an absent specs/ tree passes clean", () => {
    const fx = makeTree({ "README.md": "# Not a specs project\n" });
    try {
      expect(scanFrSummaryAltitude(fx.root)).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("archived FRs are excluded — a violating archive/ summary never flags", () => {
    const violating = frWith("OLD-1", [
      "Archived summary naming `legacy_module.ts` in backticks.",
    ]);
    const fx = makeTree({
      "specs/frs/archive/OLD-1.md": violating,
      "specs/frs/STE-912.md": frWith("STE-912", [
        "A clean active summary in plain language.",
      ]),
    });
    try {
      expect(scanFrSummaryAltitude(fx.root)).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });
});
