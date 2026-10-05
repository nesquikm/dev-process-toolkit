// STE-662 — the prose that describes the FR Summary rules, and the one rule
// that was never named.
//
// AC-STE-662.8. STE-661 grew the closed rule union of `scan_fr_summary_altitude`
// to SIX members — `line_cap`, `backtick`, `ac_id`, `path_token`,
// `sentence_cap` (the five prose rules, Summary only) plus `word_cap`. Three
// test comments still describe the older union. This file asserts the three
// named places describe six, and that no five-member union description is left
// anywhere under `tests/` or `adapters/`. The grep carries a CONTROL: a zero-hit
// grep is a claim, and a pattern that cannot match anything would make it
// true for free, so the same scanner is run over a planted five-rule sentence
// and must find it.
//
// AC-STE-662.9. `longSentences` starts a new sentence at every list item. The
// splitter has done so since STE-661, but AC-STE-661.3 never said it; this
// test names the rule and completes that AC (the archived FR stays frozen).

import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative, resolve } from "node:path";

import { longSentences, PLAIN_SENTENCE_WORD_CAP } from "../adapters/_shared/src/plain_sentences";

const PLUGIN_ROOT = resolve(import.meta.dir, "..");
const THIS_FILE = basename(import.meta.path);

// ===========================================================================
// AC-STE-662.8 — the six-rule union, and no five-member description left.
// ===========================================================================

/** Phrasings that describe the rule union as having FIVE members. */
const FIVE_MEMBER_UNION: readonly RegExp[] = [
  /\bunion is (?:closed at |exactly )?five(?: members?)?\b/i,
  /\bunion (?:stays )?closed at five\b/i,
  /\bfive[- ]member (?:rule[- ])?union\b/i,
  /\bunion of (?:exactly )?five rules\b/i,
  /\bfive[- ]rule union\b/i,
];

/** A description of the union as having SIX members. */
const SIX_MEMBER_UNION = /\bsix[- ]rule\b|\bsix[- ]member|\bsix members\b|\bsix rules\b|\ball six\b/i;

interface Hit {
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".git") continue;
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) walk(path, out);
    else if (/\.(ts|md)$/.test(entry)) out.push(path);
  }
}

/** Every line under `roots` describing a five-member rule union. */
function scanFiveMemberUnion(roots: readonly string[], exclude: (path: string) => boolean): Hit[] {
  const files: string[] = [];
  for (const root of roots) walk(root, files);
  const hits: Hit[] = [];
  for (const file of files) {
    if (exclude(file)) continue;
    readFileSync(file, "utf-8")
      .split("\n")
      .forEach((text, idx) => {
        if (FIVE_MEMBER_UNION.some((re) => re.test(text))) hits.push({ file, line: idx + 1, text: text.trim() });
      });
  }
  return hits;
}

const TEMP_DIRS: string[] = [];
afterAll(() => {
  for (const dir of TEMP_DIRS.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const STALE_FILES = {
  epoch: join(PLUGIN_ROOT, "tests", "fr-word-cap-epoch-grandfathering.test.ts"),
  scanner: join(PLUGIN_ROOT, "adapters", "_shared", "src", "scan_fr_summary_altitude.test.ts"),
  wordCaps: join(PLUGIN_ROOT, "tests", "m137-ste-534-fr-word-caps.test.ts"),
};

/** The comment lines of a TypeScript file, joined. */
function commentText(path: string): string {
  return readFileSync(path, "utf-8")
    .split("\n")
    .filter((line) => /^\s*(\/\/|\*|\/\*)/.test(line))
    .join("\n");
}

/** The header comment block of a file — everything before its first `import`. */
function headerComment(path: string): string {
  const source = readFileSync(path, "utf-8");
  const firstImport = source.search(/^import\s/m);
  return firstImport === -1 ? source : source.slice(0, firstImport);
}

describe("AC-STE-662.8 — the three stale comments describe the six-rule union", () => {
  test("scan_fr_summary_altitude.test.ts: its header describes six members, not five", () => {
    const header = headerComment(STALE_FILES.scanner);
    expect(header).toMatch(SIX_MEMBER_UNION);
    expect(header).not.toMatch(/\bFIVE members\b/i);
  });

  test("fr-word-cap-epoch-grandfathering.test.ts: its comments describe the six-rule union", () => {
    expect(commentText(STALE_FILES.epoch)).toMatch(SIX_MEMBER_UNION);
  });

  test("m137-ste-534-fr-word-caps.test.ts: the asymmetry test's title describes the six-rule union", () => {
    const titles = readFileSync(STALE_FILES.wordCaps, "utf-8")
      .split("\n")
      .filter((line) => /\btest\(\s*"the shipped table carries the asymmetry as DATA/.test(line));
    expect(titles.length, "the asymmetry test is still there to be retitled").toBe(1);
    expect(titles[0]).toMatch(/\bsix\b/i);
  });

  test("CONTROL: the scanner finds a planted five-rule sentence and passes a six-rule one", () => {
    const dir = mkdtempSync(join(tmpdir(), "ste662-union-control-"));
    TEMP_DIRS.push(dir);
    writeFileSync(join(dir, "planted.test.ts"), "// Since STE-534 the closed rule union is FIVE members, not four.\n");
    writeFileSync(join(dir, "honest.test.ts"), "// Since STE-661 the closed rule union is SIX members.\n");

    const hits = scanFiveMemberUnion([dir], () => false);
    expect(hits.map((hit) => basename(hit.file))).toEqual(["planted.test.ts"]);
    // Each phrasing in the pattern list is live, not just the first one.
    for (const sentence of [
      "the rule union is closed at five members",
      "a five-member rule union",
      "a union of exactly five rules",
      "the five-rule union",
    ]) {
      expect(FIVE_MEMBER_UNION.some((re) => re.test(sentence)), sentence).toBe(true);
    }
  });

  test("no five-member rule-union description remains under tests/ or adapters/", () => {
    const hits = scanFiveMemberUnion(
      [join(PLUGIN_ROOT, "tests"), join(PLUGIN_ROOT, "adapters")],
      (path) => basename(path) === THIS_FILE,
    );
    const report = hits.map((hit) => `${relative(PLUGIN_ROOT, hit.file)}:${hit.line}: ${hit.text}`).join("\n");
    expect(hits.length, `five-member union descriptions:\n${report}`).toBe(0);
  });
});

// ===========================================================================
// AC-STE-662.9 — the list-item rule, named. Completes AC-STE-661.3.
// ===========================================================================

/** `n` plain words with no terminator anywhere. */
function words(n: number, stem: string): string {
  return Array.from({ length: n }, (_, i) => `${stem}${i + 1}`).join(" ");
}

describe("AC-STE-662.9 — longSentences starts a sentence at each list item (completes AC-STE-661.3)", () => {
  test("CONTROL: two unpunctuated 15-word lines with no marker pool into one 30-word sentence", () => {
    // Without the list-item rule this is what every bullet list below would do.
    expect(15 + 15).toBeGreaterThan(PLAIN_SENTENCE_WORD_CAP);
    expect(longSentences([words(15, "a"), words(15, "b")])).toEqual([{ line: 2, words: 30 }]);
  });

  const MARKERS: ReadonlyArray<readonly [string, string]> = [
    ["- ", "- "],
    ["* ", "* "],
    ["+ ", "+ "],
    ["1. ", "2. "],
    ["1) ", "2) "],
  ];

  for (const [first, second] of MARKERS) {
    test(`\`${first.trim()}\` list items: two unpunctuated 15-word rows yield zero rows`, () => {
      const rows = [`${first}${words(15, "a")}`, `${second}${words(15, "b")}`];
      expect(longSentences(rows)).toEqual([]);
    });
  }

  test("the marker is not a word: a 20-word row sits AT the cap, a 21-word row is over it", () => {
    expect(longSentences([`- ${words(PLAIN_SENTENCE_WORD_CAP, "w")}`])).toEqual([]);
    expect(longSentences([`- ${words(PLAIN_SENTENCE_WORD_CAP + 1, "w")}`])).toEqual([
      { line: 1, words: PLAIN_SENTENCE_WORD_CAP + 1 },
    ]);
  });
});
