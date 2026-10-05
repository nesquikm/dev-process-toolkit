// STE-661 — Summary sentences stay short and plain.
//
// RED-state until the implementation lands in:
//   adapters/_shared/src/plain_sentences.ts           (new pure splitter)
//   adapters/_shared/src/scan_fr_summary_altitude.ts  (`sentence_cap` + epoch)
//   adapters/_shared/src/stage_block_adoption.ts      (lead-in sentence rule)
//   docs/prose-altitude.md § Plain sentences, the four writer-surface pointers,
//   skills/gate-check/SKILL.md probe #67, docs/stage-status-block.md.
//
// CONTRACT PINNED HERE (the shape the implementer must build):
//
//   // plain_sentences.ts
//   export const PLAIN_SENTENCE_WORD_CAP = 20;
//   export const SENTENCE_TERMINATORS: readonly string[];   // [".", "!", "?", ";"]
//   export function longSentences(
//     lines: readonly string[],
//     terminators?: readonly string[],   // defaults to SENTENCE_TERMINATORS
//   ): { line: number; words: number }[];
//
//   `line` is 1-INDEXED into `lines` — the line holding the word that first
//   pushes the running count past the cap. `words` is the WHOLE sentence's
//   whitespace-delimited word count. A terminator ends a sentence only when
//   followed by whitespace or end of text; a blank line ends a sentence too.
//
//   The terminator set is an injectable parameter (default = the exported
//   constant) so AC-STE-661.9's `;` mutation can be applied and PROVEN applied
//   without rewriting source on disk.
//
// The modules under test are imported as NAMESPACES (or dynamically, for the
// module that does not exist yet) so one missing export reds the tests that
// need it rather than failing the whole file at link time.

import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import * as scanner from "../adapters/_shared/src/scan_fr_summary_altitude";
import * as adoption from "../adapters/_shared/src/stage_block_adoption";
import { STAGE_BLOCK_FENCE_BANNER } from "../adapters/_shared/src/stage_status_block";
import { DELIVER_STAGE_FENCE_BANNER } from "../adapters/_shared/src/deliver_stage_capture";
import {
  IMPLEMENT_EVIDENCE_HEADING,
  renderImplementReportEvidence,
} from "../adapters/_shared/src/implement_report_evidence";
import { readSpecFile } from "./_spec_tree";

// ----------------------------------------------------------------------- paths

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");
const read = (p: string): string => readFileSync(p, "utf-8");

const PLAIN_SENTENCES_SRC = join(PLUGIN_ROOT, "adapters", "_shared", "src", "plain_sentences.ts");
const SCANNER_SRC = join(PLUGIN_ROOT, "adapters", "_shared", "src", "scan_fr_summary_altitude.ts");
const PROSE_ALTITUDE_DOC = join(PLUGIN_ROOT, "docs", "prose-altitude.md");
const STATUS_BLOCK_DOC = join(PLUGIN_ROOT, "docs", "stage-status-block.md");
const SPEC_WRITE_SKILL = join(PLUGIN_ROOT, "skills", "spec-write", "SKILL.md");
const PR_SKILL = join(PLUGIN_ROOT, "skills", "pr", "SKILL.md");
const CODE_REVIEWER = join(PLUGIN_ROOT, "agents", "code-reviewer.md");
const GATE_CHECK_SKILL = join(PLUGIN_ROOT, "skills", "gate-check", "SKILL.md");

// ------------------------------------------------- the module under construction

interface SentenceRow {
  line: number;
  words: number;
}
interface PlainSentencesModule {
  PLAIN_SENTENCE_WORD_CAP: number;
  SENTENCE_TERMINATORS: readonly string[];
  longSentences: (lines: readonly string[], terminators?: readonly string[]) => SentenceRow[];
}

const loaded: PlainSentencesModule | null = await import(
  "../adapters/_shared/src/plain_sentences"
)
  .then((m) => m as unknown as PlainSentencesModule)
  .catch(() => null);

/** The splitter module, or a loud failure naming what is missing. */
function ps(): PlainSentencesModule {
  if (loaded === null) {
    throw new Error(
      "adapters/_shared/src/plain_sentences.ts does not exist or failed to load",
    );
  }
  return loaded;
}

const longSentences = (lines: readonly string[], terminators?: readonly string[]): SentenceRow[] =>
  terminators === undefined ? ps().longSentences(lines) : ps().longSentences(lines, terminators);

// ------------------------------------------------------------------ word helpers

/** `n` distinct plain words, no terminator. */
const words = (n: number, prefix = "w"): string =>
  Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`).join(" ");

/** A sentence of exactly `n` words, closed with `.` (attached to the last word). */
const sentence = (n: number, prefix = "w", end = "."): string => `${words(n, prefix)}${end}`;

// ═══════════════════════════════════════════════════════════════════════════
// AC-STE-661.1 — the rule lives once, in docs/prose-altitude.md § Plain sentences
// ═══════════════════════════════════════════════════════════════════════════

/** The body of a level-2 section, up to the next level-2 heading. */
function level2Section(body: string, heading: string): string | null {
  const lines = body.split("\n");
  const start = lines.findIndex((l) => l.trim() === `## ${heading}`);
  if (start < 0) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^## /.test(l));
  return (end < 0 ? rest : rest.slice(0, end)).join("\n");
}

const SIX_RULES: readonly [string, RegExp][] = [
  ["one idea per sentence", /one idea per sentence/i],
  ["at most 20 words per sentence", /(?:at most|no more than)\s+20\s+words/i],
  ["active voice", /active voice/i],
  ["one term for one thing", /one term for one thing/i],
  ["no idioms", /no idioms/i],
  ["no claim absent from the body being summarized", /no claim\b[^\n]*\bbody\b/i],
];

describe("AC-STE-661.1 — § Plain sentences lists the six rules and the four surfaces", () => {
  test("docs/prose-altitude.md carries a `## Plain sentences` section", () => {
    expect(level2Section(read(PROSE_ALTITUDE_DOC), "Plain sentences")).not.toBeNull();
  });

  test("the section enumerates EXACTLY six rules as a numbered list, one rule per item, in order", () => {
    const section = level2Section(read(PROSE_ALTITUDE_DOC), "Plain sentences") ?? "";
    const items = section
      .split("\n")
      .filter((l) => /^\d+\.\s+\S/.test(l));
    expect(items.length).toBe(6);
    SIX_RULES.forEach(([name, re], i) => {
      expect({ rule: name, item: items[i] ?? "", matches: re.test(items[i] ?? "") }).toEqual({
        rule: name,
        item: items[i] ?? "",
        matches: true,
      });
    });
  });

  test("each of the six rules is stated by text", () => {
    const section = level2Section(read(PROSE_ALTITUDE_DOC), "Plain sentences") ?? "";
    for (const [name, re] of SIX_RULES) {
      expect({ rule: name, present: re.test(section) }).toEqual({ rule: name, present: true });
    }
  });

  test("the section names the four surfaces it binds", () => {
    const section = level2Section(read(PROSE_ALTITUDE_DOC), "Plain sentences") ?? "";
    const surfaces: [string, (s: string) => boolean][] = [
      ["FR `## Summary`", (s) => /\bFR\b[^\n]*## Summary/.test(s)],
      ["lead-in above a stage-status-block", (s) => /lead-in/i.test(s) && /stage-status-block/.test(s)],
      ["PR body `## Summary`", (s) => /\bPR\b[^\n]*## Summary/.test(s)],
      ["code-reviewer CONCERN explanation", (s) => /code-reviewer/.test(s) && /CONCERN/.test(s)],
    ];
    for (const [name, has] of surfaces) {
      expect({ surface: name, named: has(section) }).toEqual({ surface: name, named: true });
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-STE-661.2 — each writer surface points at the rule; none restates it
// ═══════════════════════════════════════════════════════════════════════════

const isPointer = (line: string): boolean =>
  line.includes("prose-altitude.md") && /Plain sentences/.test(line);

/** Lines of a `### <prefix>` subsection, up to the next level-2 or level-3 heading. */
function level3Section(body: string, prefix: string): string[] {
  const lines = body.split("\n");
  const start = lines.findIndex((l) => l.startsWith(`### ${prefix}`));
  if (start < 0) return [];
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^#{2,3} /.test(l));
  return end < 0 ? rest : rest.slice(0, end);
}

describe("AC-STE-661.2 — four pointers at docs/prose-altitude.md § Plain sentences", () => {
  test("skills/spec-write/SKILL.md § 0b carries the pointer on its Summary guidance", () => {
    const section = level3Section(read(SPEC_WRITE_SKILL), "0b.");
    expect(section.length).toBeGreaterThan(0);
    const pointers = section.filter(isPointer);
    expect(pointers.length).toBeGreaterThan(0);
    expect(pointers.some((l) => /Summary/.test(l))).toBe(true);
  });

  test("docs/stage-status-block.md carries the pointer on its lead-in rule", () => {
    const pointers = read(STATUS_BLOCK_DOC).split("\n").filter(isPointer);
    expect(pointers.length).toBeGreaterThan(0);
    expect(pointers.some((l) => /lead-in/i.test(l))).toBe(true);
  });

  test("skills/pr/SKILL.md carries the pointer for the body `## Summary`", () => {
    const pointers = read(PR_SKILL).split("\n").filter(isPointer);
    expect(pointers.length).toBeGreaterThan(0);
    expect(pointers.some((l) => /Summary/.test(l))).toBe(true);
  });

  test("agents/code-reviewer.md carries the pointer for the `CONCERN` explanation", () => {
    const pointers = read(CODE_REVIEWER).split("\n").filter(isPointer);
    expect(pointers.length).toBeGreaterThan(0);
    expect(pointers.some((l) => /CONCERN|explanation/.test(l))).toBe(true);
  });

  test("no surface RESTATES the rule list — they point, the doc states", () => {
    // Two of the six rule phrases are distinctive enough that their presence
    // on a surface means the list was copied there.
    for (const path of [SPEC_WRITE_SKILL, STATUS_BLOCK_DOC, PR_SKILL, CODE_REVIEWER]) {
      const body = read(path);
      expect({ path, restated: /one term for one thing/i.test(body) && /no idioms/i.test(body) }).toEqual({
        path,
        restated: false,
      });
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-STE-661.3 — the pure splitter
// ═══════════════════════════════════════════════════════════════════════════

describe("AC-STE-661.3 — plain_sentences.ts exports the cap and the splitter", () => {
  test("the module exists at adapters/_shared/src/plain_sentences.ts", () => {
    expect(existsSync(PLAIN_SENTENCES_SRC)).toBe(true);
  });

  test("PLAIN_SENTENCE_WORD_CAP is 20", () => {
    expect(ps().PLAIN_SENTENCE_WORD_CAP).toBe(20);
  });

  test("SENTENCE_TERMINATORS is exactly `.` `!` `?` `;`", () => {
    expect([...ps().SENTENCE_TERMINATORS].sort()).toEqual(["!", ".", ";", "?"]);
  });

  test("a 20-word sentence is at the cap and yields no row", () => {
    expect(longSentences([sentence(20)])).toEqual([]);
  });

  test("a 21-word sentence yields one row with its line and word count", () => {
    expect(longSentences([sentence(21)])).toEqual([{ line: 1, words: 21 }]);
  });

  test("an unterminated run at end of text is still a sentence", () => {
    expect(longSentences([words(25)])).toEqual([{ line: 1, words: 25 }]);
  });

  test("empty input yields no rows", () => {
    expect(longSentences([])).toEqual([]);
  });

  for (const t of [".", "!", "?", ";"]) {
    test(`\`${t}\` followed by whitespace ends a sentence`, () => {
      const line = `${words(15, "a")}${t} ${words(15, "b")}.`;
      expect(longSentences([line])).toEqual([]);
    });
  }

  test("a terminator at the end of a line (end of line, then next line) ends a sentence", () => {
    expect(longSentences([sentence(15, "a"), sentence(15, "b")])).toEqual([]);
  });

  test("a terminator NOT followed by whitespace does not end a sentence", () => {
    // `glue.x` is one word whose `.` is followed by a letter: 14 + 1 + 14 = 29
    // words in ONE sentence. A split at the `.` would leave two clean halves.
    const line = `${words(14, "a")} glue.x ${words(14, "b")}.`;
    expect(longSentences([line])).toEqual([{ line: 1, words: 29 }]);
  });

  for (const token of ["v2.46.0", "e.g.x", "and/or"]) {
    test(`\`${token}\` does not end a sentence`, () => {
      // Each half alone is under the cap; only a split at the token would
      // make the line clean.
      const line = `${words(12, "a")} ${token} ${words(12, "b")}.`;
      expect(longSentences([line])).toEqual([{ line: 1, words: 25 }]);
    });
  }

  test("a blank line ends a sentence, even with no terminator", () => {
    expect(longSentences([words(15, "a"), "", words(15, "b")])).toEqual([]);
  });

  test("without the blank line the same text is one long sentence", () => {
    expect(longSentences([words(15, "a"), words(15, "b")])).toEqual([{ line: 2, words: 30 }]);
  });

  test("a sentence wrapped across lines anchors at the line holding the cap-crossing word", () => {
    // Words 1-10 on line 1, 11-20 on line 2, 21-30 on line 3: word 21 is on line 3.
    const lines = [words(10, "a"), words(10, "b"), sentence(10, "c")];
    expect(longSentences(lines)).toEqual([{ line: 3, words: 30 }]);
  });

  test("the crossing word decides the anchor, not where the sentence ends", () => {
    // 15 on line 1, 10 on line 2 (word 21 is on line 2), 5 more on line 3.
    const lines = [words(15, "a"), words(10, "b"), sentence(5, "c")];
    expect(longSentences(lines)).toEqual([{ line: 2, words: 30 }]);
  });

  test("a sentence starting mid-line counts only its own words", () => {
    // `a` sentence is 10 words; the `b` sentence is 10 on line 1 + 11 on line 2 = 21.
    const lines = [`${sentence(10, "a")} ${words(10, "b")}`, sentence(11, "c")];
    expect(longSentences(lines)).toEqual([{ line: 2, words: 21 }]);
  });

  // Phase 3 review (STE-661, underspecified backfill): a list row is its own
  // item, punctuated or not. Pooling unpunctuated rows into one "sentence"
  // flagged every ordinary bullet list in a report lead-in.
  for (const marker of ["-", "*", "+", "1.", "12)"]) {
    test(`a list-item line opened by \`${marker}\` starts a new sentence`, () => {
      const lines = [`${marker} ${words(12, "a")}`, `${marker} ${words(12, "b")}`];
      expect(longSentences(lines)).toEqual([]);
    });
  }

  test("CONTROL — the same rows without list markers are one long sentence", () => {
    expect(longSentences([words(12, "a"), words(12, "b")])).toEqual([{ line: 2, words: 24 }]);
  });

  test("a single list row over the cap is still flagged; the marker is not a word", () => {
    expect(longSentences([`- ${words(24, "a")}`])).toEqual([{ line: 1, words: 24 }]);
  });

  test("a list row of exactly 20 words is at the cap, whatever its marker", () => {
    for (const marker of ["-", "*", "+", "1.", "12)"]) {
      expect(longSentences([`${marker} ${sentence(20, "a")}`])).toEqual([]);
    }
  });

  test("NEGATIVE CONTROL — a line opening with `-5`, `-->`, `**bold**` or `3.5` is not a list item", () => {
    for (const opener of ["-5", "-->", "**bold**", "3.5"]) {
      // 12 words, then a 13-word line opened by the non-marker: one sentence.
      const lines = [words(12, "a"), `${opener} ${words(12, "b")}`];
      expect({ opener, rows: longSentences(lines) }).toEqual({
        opener,
        rows: [{ line: 2, words: 25 }],
      });
    }
  });

  test("a closing quote or bracket after the terminator does NOT end a sentence (pinned: terminator must be followed by whitespace)", () => {
    expect(longSentences([`${words(12, "a")} "stop." ${words(12, "b")}`])).toEqual([
      { line: 1, words: 25 },
    ]);
  });

  test("one row per long sentence, in order", () => {
    const lines = [sentence(25, "a"), sentence(5, "b"), "", sentence(22, "c")];
    expect(longSentences(lines)).toEqual([
      { line: 1, words: 25 },
      { line: 4, words: 22 },
    ]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-STE-661.4 — `sentence_cap` joins the union, bound to Summary alone
// ═══════════════════════════════════════════════════════════════════════════

const rowFor = (table: readonly scanner.SectionRuleSpec[], section: string) =>
  table.find((r) => r.section === section);

describe("AC-STE-661.4 — RuleName gains `sentence_cap`; only the Summary row lists it", () => {
  test("the RuleName union in the scanner source names `sentence_cap`", () => {
    const union = /export type RuleName\s*=([^;]+);/.exec(read(SCANNER_SRC));
    expect(union).not.toBeNull();
    expect(union![1]).toContain('"sentence_cap"');
  });

  test("the Summary row of SECTION_RULES lists `sentence_cap`", () => {
    const summary = rowFor(scanner.SECTION_RULES, "Summary");
    expect(summary).toBeDefined();
    expect(summary!.rules as readonly string[]).toContain("sentence_cap");
  });

  test("the Technical Design and Notes rows do NOT list `sentence_cap`", () => {
    for (const section of ["Technical Design", "Notes"]) {
      const row = rowFor(scanner.SECTION_RULES, section);
      expect(row).toBeDefined();
      expect(row!.rules as readonly string[]).not.toContain("sentence_cap");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-STE-661.5 — the scanner grades Summary sentences
// ═══════════════════════════════════════════════════════════════════════════

/** Build a real (non-git) temp project tree: rel-path => content. */
function makeTree(files: Record<string, string>): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "ste-661-tree-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

/** An active FR whose `## Summary` body is exactly `summary`. */
function frWithSummary(id: string, summary: readonly string[]): string {
  return [
    "---",
    `title: "Fixture ${id}"`,
    "status: active",
    "---",
    "",
    `# ${id}: Fixture`,
    "",
    "## Summary",
    "",
    ...summary,
    "",
    "## Requirement",
    "",
    "Unmeasured.",
    "",
  ].join("\n");
}

/** 1-indexed file line of the first line containing `needle`. */
function lineOf(content: string, needle: string): number {
  const idx = content.split("\n").findIndex((l) => l.includes(needle));
  if (idx < 0) throw new Error(`fixture bug: ${needle} not found`);
  return idx + 1;
}

const sentenceCapRows = <T extends { rule: string }>(rows: readonly T[]): T[] =>
  rows.filter((r) => r.rule === "sentence_cap");

/** Run the RAW scanner over a one-FR tree; returns its sentence_cap rows. */
function scanSummary(
  summary: readonly string[],
  table?: readonly scanner.SectionRuleSpec[],
): { content: string; rows: scanner.FrSummaryAltitudeViolation[] } {
  const content = frWithSummary("STE-9661", summary);
  const fx = makeTree({ "specs/frs/STE-9661.md": content });
  try {
    const all =
      table === undefined
        ? scanner.scanFrSummaryAltitude(fx.root)
        : scanner.scanFrSummaryAltitude(fx.root, table);
    return { content, rows: sentenceCapRows(all) };
  } finally {
    fx.cleanup();
  }
}

/** The AC-STE-661.5 primary fixture: one 21-word sentence on one line. */
const ONE_21_WORD_SENTENCE = [sentence(21, "s")];

describe("AC-STE-661.5 — Summary sentence cap on an active FR fixture", () => {
  test("one 21-word sentence yields EXACTLY one `sentence_cap` row at the crossing line", () => {
    const { content, rows } = scanSummary(ONE_21_WORD_SENTENCE);
    expect(rows.length).toBe(1);
    expect(rows[0]!.line).toBe(lineOf(content, "s21."));
    expect(rows[0]!.section).toBe("Summary");
    expect(rows[0]!.file).toBe("specs/frs/STE-9661.md");
  });

  test("a 20-word sentence yields zero rows", () => {
    expect(scanSummary([sentence(20, "s")]).rows).toEqual([]);
  });

  test("a 30-word sentence wrapped over two lines anchors on the line holding word 21", () => {
    // Line A carries words 1-15, line B words 16-30 — word 21 is on line B.
    const lineA = words(15, "p");
    const lineB = `${Array.from({ length: 15 }, (_, i) => `q${i + 16}`).join(" ")}.`;
    const { content, rows } = scanSummary([lineA, lineB]);
    expect(rows.length).toBe(1);
    expect(rows[0]!.line).toBe(lineOf(content, "q21"));
  });

  test("fenced content in the Summary is not counted toward a sentence", () => {
    // 15 prose words, a fence of 10 words, then 4 prose words closing the
    // sentence. Prose alone is 19 (clean); counting the fence makes it 29.
    const { rows } = scanSummary([
      words(15, "f"),
      "```",
      words(10, "code"),
      "```",
      sentence(4, "g"),
    ]);
    expect(rows).toEqual([]);
  });

  test("a fence ends a sentence: prose either side of it never joins into one", () => {
    // 12 prose words, a fence, 12 more: joined they would be 24 (flagged).
    const { rows } = scanSummary([words(12, "m"), "```", "code", "```", sentence(12, "n")]);
    expect(rows).toEqual([]);
  });

  test("CONTROL — the same words without the fence ARE flagged", () => {
    const { rows } = scanSummary([words(15, "f"), words(10, "code"), sentence(4, "g")]);
    expect(rows.length).toBe(1);
  });

  // Phase 3 review (STE-661 audit advisory): the report verifier blanks a
  // heading, so a sentence never runs across one. The FR scanner must agree,
  // or the two graders disagree on what a sentence is.
  test("an in-Summary `###` subheading ends a sentence, as it does in a report lead-in", () => {
    const { rows } = scanSummary([words(15, "h"), "### Subheading", sentence(15, "i")]);
    expect(rows).toEqual([]);
  });

  test("a repeated `## Summary` heading ends a sentence; it pools words, not sentences", () => {
    // No blank lines around the heading: the heading alone must break it.
    const { rows } = scanSummary([words(15, "j"), "## Summary", sentence(15, "k")]);
    expect(rows).toEqual([]);
    const control = scanSummary([words(15, "j"), sentence(15, "k")]);
    expect(control.rows.length, "CONTROL: without the heading it is one long sentence").toBe(1);
  });

  test("Technical Design and Notes are not sentence-capped", () => {
    const content = [
      "---",
      'title: "Fixture"',
      "status: active",
      "---",
      "",
      "# STE-9662: Fixture",
      "",
      "## Summary",
      "",
      "A short summary.",
      "",
      "## Technical Design",
      "",
      sentence(40, "d"),
      "",
      "## Notes",
      "",
      sentence(30, "n"),
      "",
    ].join("\n");
    const fx = makeTree({ "specs/frs/STE-9662.md": content });
    try {
      expect(sentenceCapRows(scanner.scanFrSummaryAltitude(fx.root))).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-STE-661.6 — the sentence cap is grandfathered by its OWN epoch
// ═══════════════════════════════════════════════════════════════════════════

function git(root: string, args: string[], extraEnv: Record<string, string> = {}): string {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
      GIT_TERMINAL_PROMPT: "0",
      ...extraEnv,
    },
  });
}

function commitAt(root: string, iso: string, message: string): void {
  git(root, ["commit", "-q", "-m", message], { GIT_AUTHOR_DATE: iso, GIT_COMMITTER_DATE: iso });
}

const SENTENCE_EPOCH_LITERAL = "2026-10-05T00:00:00Z";
const sentenceEpoch = (): string =>
  (scanner as unknown as { FR_SENTENCE_CAP_EPOCH?: string }).FR_SENTENCE_CAP_EPOCH ??
  SENTENCE_EPOCH_LITERAL;
const sentenceEpochMs = (): number => Date.parse(sentenceEpoch());
const wordEpochMs = (): number => Date.parse(scanner.FR_WORD_CAP_EPOCH);
const isoAt = (ms: number): string => new Date(ms).toISOString();
const ONE_SECOND = 1000;
const ONE_DAY = 24 * 60 * 60 * 1000;
const ONE_YEAR = 365 * ONE_DAY;

interface FrFixture {
  name: string;
  body: string;
  committedAt?: string;
}

function makeProject(opts: { git?: boolean; frs: FrFixture[] }): { root: string; cleanup: () => void } {
  const useGit = opts.git ?? true;
  const root = mkdtempSync(join(tmpdir(), "ste-661-epoch-"));
  mkdirSync(join(root, "specs", "frs", "archive"), { recursive: true });
  writeFileSync(join(root, "README.md"), "# Fixture project\n");
  if (useGit) {
    git(root, ["init", "-q", "."]);
    git(root, ["config", "user.email", "fixture@example.invalid"]);
    git(root, ["config", "user.name", "Fixture"]);
    git(root, ["config", "commit.gpgsign", "false"]);
    git(root, ["add", "--", "README.md"]);
    commitAt(root, isoAt(wordEpochMs() - ONE_YEAR), "chore: fixture base");
  }
  for (const fr of opts.frs) {
    const rel = `specs/frs/${fr.name}`;
    writeFileSync(join(root, rel), fr.body);
    if (useGit && fr.committedAt !== undefined) {
      git(root, ["add", "--", rel]);
      commitAt(root, fr.committedAt, `chore: add ${fr.name}`);
    }
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

/** Delete the FR's introducing commit object while the FR stays in HEAD. */
function severIntroducingCommit(root: string, rel: string): void {
  writeFileSync(join(root, "README.md"), "# Fixture project\n\nTrailing.\n");
  git(root, ["add", "--", "README.md"]);
  commitAt(root, isoAt(sentenceEpochMs() + ONE_SECOND), "chore: trailing");
  const sha = git(root, ["log", "--diff-filter=A", "-1", "--format=%H", "--", rel]).trim();
  if (sha.length !== 40) throw new Error(`fixture bug: no introducing commit for ${rel}`);
  const objectPath = join(root, ".git", "objects", sha.slice(0, 2), sha.slice(2));
  if (!existsSync(objectPath)) throw new Error(`fixture bug: loose object ${sha} missing`);
  rmSync(objectPath);
}

/** Breaks `sentence_cap` and NOTHING else: one 25-word sentence. */
const sentenceOnlyFr = (id: string): string => frWithSummary(id, [sentence(25, "s")]);

/**
 * Breaks `sentence_cap` AND `word_cap` (Summary cap 80), nothing else: nine
 * 9-word sentences packed three per line (81 words), then one 25-word sentence.
 */
function sentenceAndWordCapFr(id: string): string {
  const shortLine = (k: number) =>
    [sentence(9, `a${k}x`), sentence(9, `b${k}x`), sentence(9, `c${k}x`)].join(" ");
  return frWithSummary(id, [shortLine(1), shortLine(2), shortLine(3), sentence(25, "long")]);
}

/** Breaks `sentence_cap` AND the per-line `backtick` rule. */
const sentenceAndBacktickFr = (id: string): string =>
  frWithSummary(id, ["This names `a token` here.", sentence(25, "s")]);

describe("AC-STE-661.6 — FR_SENTENCE_CAP_EPOCH and its classification arm", () => {
  test("FR_SENTENCE_CAP_EPOCH is exported as midnight UTC of the release date", () => {
    expect((scanner as unknown as { FR_SENTENCE_CAP_EPOCH?: string }).FR_SENTENCE_CAP_EPOCH).toBe(
      SENTENCE_EPOCH_LITERAL,
    );
  });

  test("the literal is written down ONCE in the scanner source, as the export", () => {
    const src = read(SCANNER_SRC);
    expect(src.split(SENTENCE_EPOCH_LITERAL).length - 1).toBe(1);
    expect(src).toMatch(
      /export const FR_SENTENCE_CAP_EPOCH\s*(?::[^=]+)?=\s*["']2026-10-05T00:00:00Z["']/,
    );
  });

  test("FR_WORD_CAP_EPOCH is untouched", () => {
    expect(scanner.FR_WORD_CAP_EPOCH).toBe("2026-09-01T00:00:00Z");
  });

  test("legacy (introduced before the sentence epoch): the row is dropped and the file is named in `grandfathered`", () => {
    const fx = makeProject({
      frs: [{ name: "old.md", body: sentenceOnlyFr("old"), committedAt: isoAt(sentenceEpochMs() - ONE_SECOND) }],
    });
    try {
      // The raw scanner still sees it — the arm is a layer, not a scanner change.
      expect(sentenceCapRows(scanner.scanFrSummaryAltitude(fx.root)).length).toBe(1);
      const report = scanner.runFrSummaryAltitudeProbe(fx.root);
      expect(sentenceCapRows(report.violations)).toEqual([]);
      expect(report.grandfathered).toContain("specs/frs/old.md");
      expect(report.grandfatheredRows).toBe(1);
    } finally {
      fx.cleanup();
    }
  });

  test("fresh (introduced AT the sentence epoch): the row is reported at `error`", () => {
    const fx = makeProject({
      frs: [{ name: "at.md", body: sentenceOnlyFr("at"), committedAt: sentenceEpoch() }],
    });
    try {
      const report = scanner.runFrSummaryAltitudeProbe(fx.root);
      const rows = sentenceCapRows(report.violations);
      expect(rows.length).toBe(1);
      expect(rows[0]!.severity).toBe("error");
      expect(report.grandfathered).not.toContain("specs/frs/at.md");
    } finally {
      fx.cleanup();
    }
  });

  test("fresh (untracked): the row is reported at `error`", () => {
    const fx = makeProject({ frs: [{ name: "new.md", body: sentenceOnlyFr("new") }] });
    try {
      const rows = sentenceCapRows(scanner.runFrSummaryAltitudeProbe(fx.root).violations);
      expect(rows.length).toBe(1);
      expect(rows[0]!.severity).toBe("error");
    } finally {
      fx.cleanup();
    }
  });

  test("undecidable (severed introducing commit): the row is downgraded to `warning`", () => {
    const fx = makeProject({
      frs: [
        { name: "severed.md", body: sentenceOnlyFr("severed"), committedAt: isoAt(sentenceEpochMs() - ONE_DAY) },
      ],
    });
    try {
      severIntroducingCommit(fx.root, "specs/frs/severed.md");
      const rows = sentenceCapRows(scanner.runFrSummaryAltitudeProbe(fx.root).violations);
      expect(rows.length).toBe(1);
      expect(rows[0]!.severity).toBe("warning");
    } finally {
      fx.cleanup();
    }
  });

  test("a non-git tree is legacy: the sentence row is spared", () => {
    const fx = makeProject({ git: false, frs: [{ name: "plain.md", body: sentenceOnlyFr("plain") }] });
    try {
      const report = scanner.runFrSummaryAltitudeProbe(fx.root);
      expect(sentenceCapRows(report.violations)).toEqual([]);
      expect(report.grandfathered).toContain("specs/frs/plain.md");
    } finally {
      fx.cleanup();
    }
  });

  test("word_cap keeps FR_WORD_CAP_EPOCH: an FR between the two epochs keeps its word_cap error and loses its sentence row", () => {
    const between = isoAt(sentenceEpochMs() - ONE_DAY);
    expect(Date.parse(between)).toBeGreaterThan(wordEpochMs());
    const fx = makeProject({
      frs: [{ name: "between.md", body: sentenceAndWordCapFr("between"), committedAt: between }],
    });
    try {
      // Non-vacuity: the raw scanner sees BOTH rules on this fixture.
      const raw = scanner.scanFrSummaryAltitude(fx.root);
      expect(raw.filter((r) => r.rule === "word_cap").length).toBe(1);
      expect(sentenceCapRows(raw).length).toBe(1);

      const report = scanner.runFrSummaryAltitudeProbe(fx.root);
      const wordRows = report.violations.filter((r) => r.rule === "word_cap");
      expect(wordRows.length).toBe(1);
      expect(wordRows[0]!.severity).toBe("error");
      expect(sentenceCapRows(report.violations)).toEqual([]);
      expect(report.grandfathered).toContain("specs/frs/between.md");
    } finally {
      fx.cleanup();
    }
  });

  test("the per-line rules stay ungrandfathered: a pre-word-epoch FR keeps its backtick error, loses its sentence row", () => {
    const fx = makeProject({
      frs: [
        { name: "ancient.md", body: sentenceAndBacktickFr("ancient"), committedAt: isoAt(wordEpochMs() - ONE_DAY) },
      ],
    });
    try {
      const report = scanner.runFrSummaryAltitudeProbe(fx.root);
      const backticks = report.violations.filter((r) => r.rule === "backtick");
      expect(backticks.length).toBe(1);
      expect(backticks[0]!.severity).toBe("error");
      expect(sentenceCapRows(report.violations)).toEqual([]);
      // Non-vacuity: the raw scanner did flag the sentence.
      expect(sentenceCapRows(scanner.scanFrSummaryAltitude(fx.root)).length).toBe(1);
    } finally {
      fx.cleanup();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-STE-661.7 — the report verifier grades the lead-in's sentences
// ═══════════════════════════════════════════════════════════════════════════

const CLEAN_REPORT = read(
  join(import.meta.dir, "fixtures", "deliver-stage-capture", "worker-stage-report.txt"),
)
  .replace(/\n+$/, "")
  .replace(DELIVER_STAGE_FENCE_BANNER, STAGE_BLOCK_FENCE_BANNER);

/** The fence alone, opener to closer, from the shipped model report. */
function blockLines(report: string): string[] {
  const all = report.split("\n");
  const open = all.findIndex((l) => l.trim() === STAGE_BLOCK_FENCE_BANNER);
  const close = all.findIndex((l, i) => i > open && /^[ \t]*```[ \t]*$/.test(l));
  if (open < 0 || close < 0) throw new Error("fixture bug: no fence in the model report");
  return all.slice(open, close + 1);
}

/** A stage that owes NO cap-exempt section, so the block alone is compliant. */
const PLAIN_STAGE: string = (() => {
  const s = adoption.ADOPTING_STAGES.find((stage) => adoption.exemptSectionsFor(stage).length === 0);
  if (s === undefined) throw new Error("fixture bug: every adopting stage owes an exempt section");
  return s;
})();

const blockFor = (stage: string): string[] =>
  blockLines(CLEAN_REPORT).map((l) => l.replace(/^(\s*stage:).*$/, `$1 ${stage}`));

/** A report: `leadIn` lines, a blank line, then a compliant block. */
const reportWith = (leadIn: readonly string[], stage = PLAIN_STAGE): string =>
  [...leadIn, "", ...blockFor(stage)].join("\n");

const sentenceReasons = (reasons: readonly string[]): string[] =>
  reasons.filter((r) => /sentence/i.test(r));

describe("AC-STE-661.7 — verifyStageReportAdoption refuses a long lead-in sentence", () => {
  test("CONTROL — a short lead-in over the block grades clean", () => {
    const verdict = adoption.verifyStageReportAdoption(reportWith(["The stage finished its work."]));
    expect(verdict).toEqual({ ok: true, reasons: [] });
  });

  test("a 21-word lead-in sentence is refused, the reason naming the line and the word count", () => {
    const report = reportWith(["The stage finished its work.", "", sentence(21, "s")]);
    const verdict = adoption.verifyStageReportAdoption(report);
    expect(verdict.ok).toBe(false);
    const reasons = sentenceReasons(verdict.reasons);
    expect(reasons.length).toBe(1);
    expect(reasons[0]).toMatch(/\bline 3\b/i);
    expect(reasons[0]).toMatch(/\b21[- ]words?\b/i);
    expect(reasons[0]).toContain(String(ps().PLAIN_SENTENCE_WORD_CAP));
  });

  test("the same report with that sentence at 20 words grades clean", () => {
    const report = reportWith(["The stage finished its work.", "", sentence(20, "s")]);
    expect(adoption.verifyStageReportAdoption(report)).toEqual({ ok: true, reasons: [] });
  });

  test("a wrapped lead-in sentence is named at the line holding the cap-crossing word", () => {
    // Words 1-12 on report line 1, 13-25 on report line 2: word 21 is on line 2.
    const report = reportWith([
      words(12, "p"),
      `${Array.from({ length: 13 }, (_, i) => `q${i + 13}`).join(" ")}.`,
    ]);
    const reasons = sentenceReasons(adoption.verifyStageReportAdoption(report).reasons);
    expect(reasons.length).toBe(1);
    expect(reasons[0]).toMatch(/\bline 2\b/i);
    expect(reasons[0]).toMatch(/\b25[- ]words?\b/i);
  });

  test("a blank line in the lead-in ends a sentence", () => {
    const split = reportWith([words(15, "a"), "", words(15, "b")]);
    expect(sentenceReasons(adoption.verifyStageReportAdoption(split).reasons)).toEqual([]);
    const joined = reportWith([words(15, "a"), words(15, "b")]);
    expect(sentenceReasons(adoption.verifyStageReportAdoption(joined).reasons).length).toBe(1);
  });

  test("cap-exempt sections are excluded from the lead-in sentence check", () => {
    // /implement owes `## Verification evidence`; place it BEFORE the block
    // with a 25-word list row. The row is the section's rendered shape, not
    // narration, so it is not graded as a sentence.
    expect(adoption.exemptSectionsFor("implement").length).toBeGreaterThan(0);
    const evidence = [...renderImplementReportEvidence({}).lines];
    expect(evidence[0]).toBe(IMPLEMENT_EVIDENCE_HEADING);
    const rowIdx = evidence.findIndex((l) => /^\s*-\s+\S/.test(l));
    evidence[rowIdx] = `  - ${words(25, "e")}`;
    const owedOthers = adoption
      .exemptSectionsFor("implement")
      .filter((e) => e.heading !== IMPLEMENT_EVIDENCE_HEADING)
      .flatMap((e) => (typeof e.renderMax === "function" ? e.renderMax() : [e.heading]));
    const report = [
      "The stage finished its work.",
      "",
      ...evidence,
      "",
      ...blockFor("implement"),
      ...owedOthers,
    ].join("\n");
    // The whole verdict, not just the absence of a sentence reason: a report
    // refused for some other cause would make "no sentence reason" vacuous.
    expect(adoption.verifyStageReportAdoption(report)).toEqual({ ok: true, reasons: [] });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-STE-661.8 — the registrations name the new rules, counts updated
// ═══════════════════════════════════════════════════════════════════════════

function probe67Entry(): string {
  const line = read(GATE_CHECK_SKILL)
    .split("\n")
    .find((l) => /^67\.\s+\*\*`fr_summary_altitude`\*\*/.test(l));
  if (line === undefined) throw new Error("probe #67 entry not found in gate-check SKILL.md");
  return line;
}

describe("AC-STE-661.8 — probe #67 and the adoption-rule list carry the new rules", () => {
  test("probe #67 states SIX altitude rules", () => {
    const entry = probe67Entry();
    expect(entry).toMatch(/\bsix altitude rules\b/);
    expect(entry).not.toMatch(/\bfive altitude rules\b/);
  });

  test("probe #67's closed union enumeration names `sentence_cap`", () => {
    const entry = probe67Entry();
    const anchor = /closed union\s+/.exec(entry);
    expect(anchor).not.toBeNull();
    const enumeration = entry.slice(anchor!.index).split(/\.\s/)[0]!;
    for (const id of ["line_cap", "backtick", "ac_id", "path_token", "word_cap", "sentence_cap"]) {
      expect({ id, listed: enumeration.includes(`\`${id}\``) }).toEqual({ id, listed: true });
    }
  });

  test("docs/stage-status-block.md heads SEVEN adoption rules and enumerates seven", () => {
    const doc = read(STATUS_BLOCK_DOC);
    expect(doc).toMatch(/^## The seven adoption rules\s*$/m);
    const section = level2Section(doc, "The seven adoption rules") ?? "";
    const items = section.split("\n").filter((l) => /^\d+\.\s+\S/.test(l));
    expect(items.length).toBe(7);
  });

  test("one adoption rule is the lead-in sentence rule", () => {
    const section = level2Section(read(STATUS_BLOCK_DOC), "The seven adoption rules") ?? "";
    const items = section.split("\n").filter((l) => /^\d+\.\s+\S/.test(l));
    const sentenceItems = items.filter(
      (l) => /sentence/i.test(l) && /lead-in/i.test(l) && /(PLAIN_SENTENCE_WORD_CAP|\b20\b)/.test(l),
    );
    expect(sentenceItems.length).toBe(1);
  });

  test("no stale count survives on either surface", () => {
    expect(read(STATUS_BLOCK_DOC)).not.toMatch(/## The six adoption rules/);
    expect(read(GATE_CHECK_SKILL)).not.toMatch(/enforcing five altitude rules/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-STE-661.9 — mutation-verified
// ═══════════════════════════════════════════════════════════════════════════

describe("AC-STE-661.9 — mutations turn the guarding tests red", () => {
  test("MUTATION: `sentence_cap` removed from the Summary row turns the AC-STE-661.5 assertion red", () => {
    const shipped = rowFor(scanner.SECTION_RULES, "Summary")!;
    const mutated: scanner.SectionRuleSpec[] = scanner.SECTION_RULES.map((row) =>
      row.section === "Summary"
        ? { ...row, rules: row.rules.filter((r) => (r as string) !== "sentence_cap") }
        : row,
    );
    const mutatedSummary = rowFor(mutated, "Summary")!;
    // The mutation APPLIED: the shipped row lists it, the mutated row lost it
    // and nothing else.
    expect(shipped.rules as readonly string[]).toContain("sentence_cap");
    expect(mutatedSummary.rules as readonly string[]).not.toContain("sentence_cap");
    expect(mutatedSummary.rules.length).toBe(shipped.rules.length - 1);

    // Shipped: the AC-STE-661.5 assertion holds. Mutated: it fails.
    expect(scanSummary(ONE_21_WORD_SENTENCE).rows.length).toBe(1);
    expect(scanSummary(ONE_21_WORD_SENTENCE, mutated).rows.length).not.toBe(1);
  });

  // The dedicated semicolon test: two 15-word clauses joined by `; `.
  const SEMICOLON_LINE = `${words(15, "a")}; ${words(15, "b")}.`;

  test("DEDICATED — `;` ends a sentence", () => {
    expect(longSentences([SEMICOLON_LINE])).toEqual([]);
  });

  test("the default terminator set IS the exported constant", () => {
    expect(longSentences([SEMICOLON_LINE])).toEqual(
      longSentences([SEMICOLON_LINE], ps().SENTENCE_TERMINATORS),
    );
  });

  test("MUTATION: `;` removed from the terminator set turns the semicolon test red", () => {
    const shipped = ps().SENTENCE_TERMINATORS;
    const mutated = shipped.filter((t) => t !== ";");
    // The mutation APPLIED.
    expect(shipped).toContain(";");
    expect(mutated).not.toContain(";");
    expect(mutated.length).toBe(shipped.length - 1);
    // Under the mutation the dedicated assertion (`toEqual([])`) fails.
    expect(longSentences([SEMICOLON_LINE], mutated)).toEqual([{ line: 1, words: 30 }]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-STE-661.10 — dogfood: this FR's own Summary
// ═══════════════════════════════════════════════════════════════════════════

function frSection(body: string, heading: string): string[] {
  const section = level2Section(body, heading);
  if (section === null) throw new Error(`STE-661 has no ## ${heading}`);
  return section.split("\n");
}

/** Independent measurement: longest sentence, split at terminator+whitespace and blank lines. */
function longestSentenceWords(lines: readonly string[]): number {
  let max = 0;
  for (const para of lines.join("\n").split(/\n\s*\n/)) {
    for (const s of para.split(/[.!?;](?=\s|$)/)) {
      const n = s.trim() === "" ? 0 : s.trim().split(/\s+/).length;
      if (n > max) max = n;
    }
  }
  return max;
}

describe("AC-STE-661.10 — dogfood on STE-661's own Summary", () => {
  const fr = readSpecFile(REPO_ROOT, "specs/frs", "STE-661.md").body;
  const summary = frSection(fr, "Summary");

  test("longSentences over this FR's own `## Summary` returns zero rows", () => {
    expect(summary.filter((l) => l.trim() !== "").length).toBeGreaterThan(0);
    expect(longSentences(summary)).toEqual([]);
  });

  test("CONTROL — the same words run together as one sentence ARE flagged", () => {
    const runTogether = [summary.join(" ").replace(/[.!?;](?=\s|$)/g, "")];
    expect(longSentences(runTogether).length).toBe(1);
  });

  test("## Notes records the measured longest Summary sentence word count", () => {
    const measured = longestSentenceWords(summary);
    expect(measured).toBeGreaterThan(0);
    expect(measured).toBeLessThanOrEqual(ps().PLAIN_SENTENCE_WORD_CAP);
    const notes = frSection(fr, "Notes").join("\n");
    const m = /longest[^\n]*?(\d+)\s+words/i.exec(notes);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBe(measured);
  });
});
