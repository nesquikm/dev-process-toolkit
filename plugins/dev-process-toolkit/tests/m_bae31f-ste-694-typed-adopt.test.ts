// STE-694 (M_bae31f) — a typed answer naming the key adopts the ticket.
//
// GitHub issue #118: a typed approval was not taken as `Adopt <KEY>`, so the
// operator was asked the same question again only to click. This suite pins
// the narrow rule that lets a typed answer count, on the ONE predicate the
// hook and the live grader share.
//
// ---------------------------------------------------------------------------
// CONTRACT this suite reads (the implementer satisfies it)
// ---------------------------------------------------------------------------
//   adapters/_shared/src/join_consent_ownership.ts:
//     export function typedAdopts(answer: string, key: string): boolean
//       — true only when the answer names `key` as a whole word
//         (case-insensitive), its first word is adopt|yes|approve|post|go
//         (case-insensitive), it holds none of skip|no|not|don't|dont|cancel,
//         never, or an n't contraction (won't, isn't, can't, … — straight or
//         curly apostrophe) as a whole word, and it names no ticket key other
//         than `key`. A whole word is read with quote characters (' " ‘ ’ “ ” `)
//         and brackets stripped from its edges, so 'no', "won't" and (no) are
//         the words no and won't.
//     perQuestionConsent(questions, label, names, answer) accepts a typed
//       answer through `typedAdopts` ONLY when `label` is `Adopt <KEY>`, with
//       the key taken from the label, never from the answer.
//   The hook (templates/hooks/_lib/hooks/pre-tracker-write-gate.ts) and the
//   grader (adapters/_shared/src/shared_tracker_live_grader.ts) re-implement
//   none of it.
//
// The hook-level and grader-level legs of the AC-STE-694.2 matrix live beside
// the pins they amend (AC-STE-694.6): the AC-STE-607.4 describe in
// tests/hook-modules-pre-tracker-write-gate.test.ts and the AC-STE-650.8
// describe in tests/m_2306b6-ste-617-live-grader.test.ts. All three suites
// read the one matrix in tests/_typed_adopt_matrix.ts.
//
// AC-STE-694.8 (mutation battery) — each mutation reddens the tests named here:
//   drop the whole-word key check     → "AC-STE-694.8 [battery: key check] …"
//   drop the affirmative-first-word   → "AC-STE-694.8 [battery: affirmative first word] …"
//   drop the negation-word check      → "AC-STE-694.8 [battery: negation] …"
//   drop the never / n't check        → "AC-STE-694.8 [battery: never/n't] …"
//   drop the other-ticket-key check   → "AC-STE-694.8 [battery: other key] …"
// (and their per-row twins in the matrix describe below, which carry the same tag).

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as consent from "../adapters/_shared/src/join_consent_ownership";
import { readSpecFile } from "./_spec_tree";
import { TYPED_ADOPT_MATRIX, otherKey } from "./_typed_adopt_matrix";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");
const SHARED = join(PLUGIN_ROOT, "adapters", "_shared", "src", "join_consent_ownership.ts");
const HOOK = join(PLUGIN_ROOT, "templates", "hooks", "_lib", "hooks", "pre-tracker-write-gate.ts");
const GRADER = join(PLUGIN_ROOT, "adapters", "_shared", "src", "shared_tracker_live_grader.ts");

const KEY = "NEZ-496";

/** The shared predicate, read through the namespace so a missing export fails a test, not the file load. */
function typedAdopts(answer: string, key: string): boolean {
  const fn = (consent as Record<string, unknown>).typedAdopts;
  if (typeof fn !== "function") throw new Error("join_consent_ownership.ts exports no typedAdopts(answer, key)");
  return (fn as (a: string, k: string) => boolean)(answer, key);
}

/** One question naming `key` and offering `<verb> <key>` and `Skip <key>`. */
const ask = (verb: string, key: string) => [
  {
    question: `${verb} ${key} into this repository?`,
    options: [{ label: `${verb} ${key}` }, { label: `Skip ${key}` }],
  },
];
const namesKey = (key: string) => (q: string) => q.includes(key);

/** perQuestionConsent on one ask whose every question is answered `answer`. */
const verdict = (verb: string, key: string, answer: string, label = `${verb} ${key}`) =>
  consent.perQuestionConsent(ask(verb, key), label, namesKey(key), () => answer);

// ===========================================================================
// AC-STE-694.1 / .2 — the matrix, on the predicate and through perQuestionConsent
// ===========================================================================

describe("AC-STE-694.2 — the typed-answer matrix on `Adopt NEZ-496`", () => {
  for (const row of TYPED_ADOPT_MATRIX) {
    const tag = row.battery ? `AC-STE-694.8 [battery: ${row.battery}] ` : "";
    const answer = row.answer(KEY);
    test(`${tag}AC-STE-694.2 typedAdopts(${JSON.stringify(answer)}, ${KEY}) → ${row.consents}`, () => {
      expect(typedAdopts(answer, KEY)).toBe(row.consents);
    });
    test(`${tag}AC-STE-694.2 perQuestionConsent on \`Adopt ${KEY}\` answered ${JSON.stringify(answer)} → ${row.consents}`, () => {
      expect(verdict("Adopt", KEY, answer)).toBe(row.consents);
    });
  }

  test("CONTROL — the exact label `Adopt NEZ-496` still consents", () => {
    expect(verdict("Adopt", KEY, `Adopt ${KEY}`)).toBe(true);
  });

  test("the matrix holds every row AC-STE-694.2 names, with the stated verdicts", () => {
    const got = Object.fromEntries(TYPED_ADOPT_MATRIX.map((r) => [r.answer(KEY), r.consents]));
    expect(got).toEqual({
      "adopt NEZ-496": true,
      "yes, post to NEZ-496": true,
      "Adopt nez-496": true,
      "post it": false,
      "Skip NEZ-496": false,
      "don't adopt NEZ-496": false,
      "adopt NEZ-4960": false,
      "yes adopt NEZ-496 but not now": false,
      "NEZ-496": false,
      // Rows added by the 2026-10-23 amendment of AC-STE-694.1 / .2.
      "yes, never adopt NEZ-496": false,
      "go, I won't adopt NEZ-496": false,
      "adopt NEZ-496 and NEZ-497": false,
      "yes adopt NEZ-496 isn't it": false,
    });
  });
});

describe("AC-STE-694.1 — the three conditions of a typed consent", () => {
  for (const first of ["adopt", "yes", "approve", "post", "go", "ADOPT", "Yes", "Approve", "POST", "Go"]) {
    test(`first word ${JSON.stringify(first)} with the key → consents`, () => {
      expect(typedAdopts(`${first} ${KEY}`, KEY)).toBe(true);
    });
  }

  for (const first of ["sure", "ok", "please", "maybe", "adopting", "yesterday"]) {
    test(`AC-STE-694.8 [battery: affirmative first word] first word ${JSON.stringify(first)} → withholds even naming the key`, () => {
      expect(typedAdopts(`${first} adopt ${KEY}`, KEY)).toBe(false);
    });
  }

  for (const neg of ["skip", "no", "not", "don't", "dont", "cancel"]) {
    test(`AC-STE-694.8 [battery: negation] an affirmative answer holding ${JSON.stringify(neg)} as a whole word → withholds`, () => {
      expect(typedAdopts(`yes ${KEY} ${neg}`, KEY)).toBe(false);
    });
  }

  for (const word of ["nothing", "notes", "know", "cancelled", "skipper", "nova"]) {
    test(`CONTROL — ${JSON.stringify(word)} merely contains a negation word, so it does not withhold`, () => {
      expect(typedAdopts(`yes adopt ${KEY} ${word}`, KEY)).toBe(true);
    });
  }

  for (const near of [`${KEY}0`, `X${KEY}`, `${KEY}-1`, "NEZ-49", "NEZ496"]) {
    test(`AC-STE-694.8 [battery: key check] ${JSON.stringify(near)} is not the key ${KEY} as a whole word → withholds`, () => {
      expect(typedAdopts(`adopt ${near}`, KEY)).toBe(false);
    });
  }

  for (const around of [`adopt ${KEY}.`, `yes, adopt ${KEY}!`, `adopt (${KEY})`, `go ahead with ${KEY}`]) {
    test(`the key followed or wrapped by punctuation still names it: ${JSON.stringify(around)} → consents`, () => {
      expect(typedAdopts(around, KEY)).toBe(true);
    });
  }

  test("the key is taken from the label, never from the answer: `adopt NEZ-497` on `Adopt NEZ-496` withholds", () => {
    expect(verdict("Adopt", KEY, "adopt NEZ-497")).toBe(false);
    expect(typedAdopts("adopt NEZ-497", KEY)).toBe(false);
  });

  test("a no is never overridden by a typed yes (FO-2): two questions on the key, one typed `adopt NEZ-496`, one `Skip NEZ-496` → withholds", () => {
    const questions = [...ask("Adopt", KEY), { question: `Confirm: Adopt ${KEY}?`, options: [{ label: `Adopt ${KEY}` }] }];
    const answers: Record<string, string> = { [questions[0]!.question]: `adopt ${KEY}`, [questions[1]!.question]: `Skip ${KEY}` };
    expect(consent.perQuestionConsent(questions, `Adopt ${KEY}`, namesKey(KEY), (q) => answers[q] ?? null)).toBe(false);
    const both: Record<string, string> = { [questions[0]!.question]: `adopt ${KEY}`, [questions[1]!.question]: `yes, post to ${KEY}` };
    expect(consent.perQuestionConsent(questions, `Adopt ${KEY}`, namesKey(KEY), (q) => both[q] ?? null)).toBe(true);
  });

  test("an unanswered question (null answer) still withholds", () => {
    expect(consent.perQuestionConsent(ask("Adopt", KEY), `Adopt ${KEY}`, namesKey(KEY), () => null)).toBe(false);
  });
});

// ===========================================================================
// AC-STE-694.3 — only `Adopt <KEY>` gains the typed rule
// ===========================================================================

describe("AC-STE-694.3 — Import, Join, Create and Skip keep the exact-label rule", () => {
  const key = "NEZ-1";
  for (const verb of ["Import", "Join", "Create", "Skip"]) {
    for (const typed of [`yes ${verb.toLowerCase()} ${key}`, `${verb.toLowerCase()} ${key}`, `approve ${key}`, `adopt ${key}`]) {
      test(`\`${verb} ${key}\` answered typed ${JSON.stringify(typed)} → withholds`, () => {
        expect(verdict(verb, key, typed)).toBe(false);
      });
    }
    test(`CONTROL — \`${verb} ${key}\` answered exactly → consents`, () => {
      expect(verdict(verb, key, `${verb} ${key}`)).toBe(true);
    });
  }

  test("AC-STE-694.3 as written: a typed `yes import NEZ-1` withholds Import consent", () => {
    expect(verdict("Import", "NEZ-1", "yes import NEZ-1")).toBe(false);
  });

  test("CONTROL — the same typed shape does consent on `Adopt NEZ-1`", () => {
    expect(verdict("Adopt", "NEZ-1", "yes adopt NEZ-1")).toBe(true);
  });
});

// ===========================================================================
// AC-STE-694.4 — one home
// ===========================================================================

/** The body of the top-level `export function <name>` in `src`, up to the next top-level declaration. */
function functionBody(src: string, name: string): string {
  const at = src.indexOf(`export function ${name}(`);
  if (at < 0) throw new Error(`no \`export function ${name}(\` in the shared module`);
  const rest = src.slice(at + 1);
  const next = rest.search(/\n(?:export |function |const |\/\*\*)/);
  return next < 0 ? rest : rest.slice(0, next);
}

describe("AC-STE-694.4 — the typed rule has one home", () => {
  const shared = readFileSync(SHARED, "utf-8");

  test("join_consent_ownership.ts exports typedAdopts and perQuestionConsent calls it", () => {
    expect(shared).toMatch(/export function typedAdopts\(/);
    expect(functionBody(shared, "perQuestionConsent")).toMatch(/\btypedAdopts\(/);
  });

  for (const [who, path] of [["hook", HOOK], ["live grader", GRADER]] as const) {
    test(`the ${who} reads consent through perQuestionConsent and re-implements no typed rule`, () => {
      const src = readFileSync(path, "utf-8");
      expect(src).toMatch(/import \{[^}]*\bperQuestionConsent\b[^}]*\} from "[^"]*join_consent_ownership(?:\.ts)?"/);
      expect(src).not.toMatch(/function typedAdopts\b|\btypedAdopts\s*=/);
      // The affirmative and negation word lists live only in the shared module.
      expect(src).not.toMatch(/approve[^\n]{0,60}\bpost\b|\bpost\b[^\n]{0,60}approve/i);
      expect(src).not.toMatch(/\bdont\b/);
      expect(src).not.toMatch(/["'`|(]cancel["'`|)]/i);
    });
  }
});

// ===========================================================================
// AC-STE-694.6 — the archived FRs carry the amendment
// ===========================================================================

describe("AC-STE-694.6 — STE-607 AC.4 and STE-650 AC.8 name this FR as their amendment", () => {
  for (const [fr, ac] of [["STE-607.md", "AC-STE-607.4"], ["STE-650.md", "AC-STE-650.8"]] as const) {
    test(`${fr}: the ${ac} line carries an amendment naming STE-694`, () => {
      const body = readSpecFile(REPO_ROOT, "specs/frs", fr).body;
      const line = body.split("\n").find((l) => l.startsWith(`- ${ac}:`));
      expect(line, `${fr} has no \`- ${ac}:\` line`).toBeDefined();
      expect(line!).toMatch(/Amended by[^)]*STE-694/);
    });
  }
});

// ===========================================================================
// AC-STE-694.1 / .2 / .8 — the 2026-10-23 amendment: never, n't contractions
// and a second ticket key withhold
// ===========================================================================

describe("AC-STE-694.1 (amended) — never and n't contractions withhold", () => {
  const words = ["never", "won't", "isn't", "can't", "shouldn't", "wouldn't", "doesn't"];
  // Case variants and the curly apostrophe (U+2019) a phone or a rich editor types.
  const variants = [
    ...words,
    ...words.map((w) => w.toUpperCase()),
    ...words.map((w) => w[0]!.toUpperCase() + w.slice(1)),
    ...words.filter((w) => w.includes("'")).map((w) => w.replace("'", "’")),
    "WON’T",
  ];
  for (const w of variants) {
    test(`AC-STE-694.8 [battery: never/n't] an affirmative answer holding ${JSON.stringify(w)} as a whole word → withholds`, () => {
      expect(typedAdopts(`yes adopt ${KEY} ${w}`, KEY)).toBe(false);
    });
    test(`AC-STE-694.8 [battery: never/n't] perQuestionConsent on \`Adopt ${KEY}\` answered "go, I ${w} adopt ${KEY}" → withholds`, () => {
      expect(verdict("Adopt", KEY, `go, I ${w} adopt ${KEY}`)).toBe(false);
    });
  }

  for (const w of ["never", "won't", "isn't"]) {
    test(`AC-STE-694.8 [battery: never/n't] ${JSON.stringify(w)} wrapped by punctuation is still a whole word → withholds`, () => {
      expect(typedAdopts(`yes, adopt ${KEY} (${w}!)`, KEY)).toBe(false);
    });
  }

  // CONTROLS — words that merely contain those letters are not the word.
  //   "nevertheless", "evernote"       — contain "never" / "ever" inside a token
  //   "pan'tomime"                     — n't inside a token, not at its end, so it is no n't contraction
  //   "isnt", "wont", "cant"           — the AC names n't contractions; an apostrophe-less form has no
  //                                      n't and so is NOT one (unlike "dont", which AC.1 lists by name)
  for (const word of ["nevertheless", "evernote", "pan'tomime", "isnt", "wont", "cant", "can", "is"]) {
    test(`CONTROL — ${JSON.stringify(word)} is not never nor an n't contraction, so it does not withhold`, () => {
      expect(typedAdopts(`yes adopt ${KEY} ${word}`, KEY)).toBe(true);
    });
  }
});

describe("AC-STE-694.1 (amended) — an answer naming another ticket key withholds", () => {
  const others: Array<[string, string]> = [
    ["the same project, the next number", otherKey(KEY)],
    ["the same project, another number", "NEZ-12"],
    ["another project", "GK-122"],
    ["another project in lower case", "gk-122"],
    ["the same project in lower case", otherKey(KEY).toLowerCase()],
    ["a key that only extends the label key's digits", `${KEY}0`],
  ];
  for (const [what, other] of others) {
    test(`AC-STE-694.8 [battery: other key] "adopt ${KEY} and ${other}" (${what}) → withholds`, () => {
      expect(typedAdopts(`adopt ${KEY} and ${other}`, KEY)).toBe(false);
    });
    test(`AC-STE-694.8 [battery: other key] perQuestionConsent on \`Adopt ${KEY}\` answered "yes, post to ${other} and ${KEY}" (${what}) → withholds`, () => {
      expect(verdict("Adopt", KEY, `yes, post to ${other} and ${KEY}`)).toBe(false);
    });
  }

  test("AC-STE-694.8 [battery: other key] AC-STE-694.2 as written: `adopt NEZ-1 and NEZ-2` on `Adopt NEZ-1` → withholds", () => {
    expect(typedAdopts("adopt NEZ-1 and NEZ-2", "NEZ-1")).toBe(false);
    expect(verdict("Adopt", "NEZ-1", "adopt NEZ-1 and NEZ-2")).toBe(false);
  });

  test("otherKey builds the AC-STE-694.2 second key from the label key", () => {
    expect(otherKey("NEZ-1")).toBe("NEZ-2");
    expect(otherKey(KEY)).toBe("NEZ-497");
  });

  // CONTROLS — the label key named twice is still one key.
  for (const twice of [`adopt ${KEY}, yes ${KEY}`, `yes, adopt ${KEY} (${KEY.toLowerCase()})`, `go: ${KEY} / ${KEY}`]) {
    test(`CONTROL — the label key named twice ${JSON.stringify(twice)} → consents`, () => {
      expect(typedAdopts(twice, KEY)).toBe(true);
    });
  }

  // CONTROL — `NEZ-496-1` stays governed by the existing whole-word key rule:
  // it does not name NEZ-496, so the answer withholds for the key check alone.
  test(`CONTROL — "adopt ${KEY}-1" stays governed by the whole-word key rule → withholds`, () => {
    expect(typedAdopts(`adopt ${KEY}-1`, KEY)).toBe(false);
  });
});

describe("AC-STE-694.2 (amended) — the FR's added rows are all in the shared matrix", () => {
  test("every backticked answer after \"and so do\" in AC-STE-694.2 is a withholding matrix row", () => {
    const body = readSpecFile(REPO_ROOT, "specs/frs", "STE-694.md").body;
    const line = body.split("\n").find((l) => l.startsWith("- AC-STE-694.2:"));
    expect(line, "STE-694.md has no `- AC-STE-694.2:` line").toBeDefined();
    const tail = line!.slice(line!.indexOf("and so do"));
    expect(tail.startsWith("and so do"), "AC-STE-694.2 carries no amended `and so do` rows").toBe(true);
    const named = [...tail.matchAll(/`([^`]+)`/g)].map((m) => m[1]!).filter((a) => a !== "Adopt NEZ-1");
    expect(named).toEqual(["yes, never adopt NEZ-496", "go, I won't adopt NEZ-496", "adopt NEZ-1 and NEZ-2", "yes adopt NEZ-496 isn't it"]);
    for (const a of named) {
      const key = a.includes("NEZ-496") ? "NEZ-496" : "NEZ-1";
      const row = TYPED_ADOPT_MATRIX.find((r) => r.answer(key) === a);
      expect(row, `no matrix row yields ${JSON.stringify(a)} on ${key}`).toBeDefined();
      expect(row!.consents).toBe(false);
    }
  });

  test("AC-STE-694.8 names the never/n't and the other-key mutations, and each has a battery row in the matrix", () => {
    const body = readSpecFile(REPO_ROOT, "specs/frs", "STE-694.md").body;
    const line = body.split("\n").find((l) => l.startsWith("- AC-STE-694.8:"));
    expect(line).toBeDefined();
    expect(line!).toMatch(/never\/n't check/);
    expect(line!).toMatch(/other-key check/);
    const tags = new Set(TYPED_ADOPT_MATRIX.map((r) => r.battery));
    expect(tags.has("never/n't")).toBe(true);
    expect(tags.has("other key")).toBe(true);
  });
});

// ===========================================================================
// AC-STE-694.1 — a quoted negation still withholds. Quote characters at a
// word's edges are not part of the word: 'no' is the word no.
// ===========================================================================

describe("AC-STE-694.1 — a quoted negation still withholds", () => {
  const quoted: Array<[string, "negation" | "never/n't"]> = [
    ["'no'", "negation"],
    ['"no"', "negation"],
    ["‘no’", "negation"],
    ["“no”", "negation"],
    ["`no`", "negation"],
    ["(no)", "negation"],
    ["[never]", "never/n't"],
    ["'never'", "never/n't"],
    ['"won\'t"', "never/n't"],
    ["won't'", "never/n't"],
    ["'skip'", "negation"],
    ['"cancel"', "negation"],
  ];
  for (const [q, battery] of quoted) {
    test(`AC-STE-694.8 [battery: ${battery}] typedAdopts("yes adopt ${KEY} ${q}") → withholds`, () => {
      expect(typedAdopts(`yes adopt ${KEY} ${q}`, KEY)).toBe(false);
    });
    test(`AC-STE-694.8 [battery: ${battery}] perQuestionConsent on \`Adopt ${KEY}\` answered "go, adopt ${KEY} ${q}" → withholds`, () => {
      expect(verdict("Adopt", KEY, `go, adopt ${KEY} ${q}`)).toBe(false);
    });
  }

  // CONTROLS — quoting the key, or the whole command, is still consent.
  for (const answer of [`yes, adopt '${KEY}'`, `go ahead: "adopt ${KEY}"`]) {
    test(`CONTROL — ${JSON.stringify(answer)} → consents through typedAdopts`, () => {
      expect(typedAdopts(answer, KEY)).toBe(true);
    });
    test(`CONTROL — perQuestionConsent on \`Adopt ${KEY}\` answered ${JSON.stringify(answer)} → consents`, () => {
      expect(verdict("Adopt", KEY, answer)).toBe(true);
    });
  }
});
