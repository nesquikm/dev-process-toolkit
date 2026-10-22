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
//         (case-insensitive), and it holds none of skip|no|not|don't|dont|cancel
//         as a whole word.
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
// (and their per-row twins in the matrix describe below, which carry the same tag).

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as consent from "../adapters/_shared/src/join_consent_ownership";
import { readSpecFile } from "./_spec_tree";
import { TYPED_ADOPT_MATRIX } from "./_typed_adopt_matrix";

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
