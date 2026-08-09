// M121 / STE-460 — AC.6, AC.7, AC.9.
//
// The three criteria that need NO new contract: a duplicated constant, an
// assertion that cannot fail, and a doc comment that disagrees with the array
// it documents. They live in their own file deliberately — the other three
// STE-460 suites depend on module surfaces that do not exist yet, and a missing
// export collapses a whole file at link time. Splitting keeps these three
// reddening for their own reasons instead of sharing one import error, which is
// this milestone's own standing complaint about reports that collapse several
// distinct facts into one number.

import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { AC9_DISCLAIMER_PINS, AC9_WINDOW, ac9Window } from "./_ac9-row-guard";

const TESTS_DIR = import.meta.dir;
const PLUGIN_ROOT = join(TESTS_DIR, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");
const SMOKE_SKILL = join(REPO_ROOT, ".claude/skills/smoke-test/SKILL.md");

const GUARD_MODULE = join(TESTS_DIR, "_ac9-row-guard.ts");
const SUITE_448 = join(TESTS_DIR, "m121-ste-448-mode-none-leg.test.ts");
const SUITE_456 = join(TESTS_DIR, "m121-ste-456-two-sided-lock-evidence.test.ts");
const FOLLOW_UPS = join(REPO_ROOT, "specs/notes/follow-ups.md");

function read(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

const smokeDoc = read(SMOKE_SKILL);
const describeIfSkills = smokeDoc === null ? describe.skip : describe;

describe("STE-460 hygiene — the documents under test were actually found", () => {
  test("the smoke driver resolves, so nothing below is a silent skip", () => {
    expect(smokeDoc).not.toBeNull();
    expect(smokeDoc!.length).toBeGreaterThan(10_000);
  });
});

// ═════════════════════ AC-STE-460.6 — one definition of the cap ══════════════

function tsFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...tsFilesUnder(p));
    else if (entry.endsWith(".ts")) out.push(p);
  }
  return out;
}

/**
 * RAW occurrences — deliberately not a comment/string tokenizer.
 *
 * A stripper was written first and thrown away. Several suites here carry regex
 * literals containing quote characters (`/--grep="([^"]*)"/`), which make a
 * naive stripper swallow arbitrary code, and every mis-parse UNDERCOUNTS. An
 * undercount is a false GREEN on exactly the question this AC asks. Raw
 * counting is strictly conservative: it also forbids restating the cap in a
 * comment or a test title — the same staleness with a different spelling — and
 * it cannot silently miss a definition.
 */
function rawCount(src: string, needle: string): number {
  return src.split(needle).length - 1;
}

describe("AC-STE-460.6 — `AC9_WINDOW` resolves from exactly ONE definition", () => {
  test("the counter is not a scan that matches nothing", () => {
    // Non-vacuity on the instrument before it scores anything.
    const cap = String(AC9_WINDOW);
    expect(rawCount(`const x = ${cap};`, cap)).toBe(1);
    expect(rawCount(`start + ${cap}) and again ${cap}`, cap)).toBe(2);
    expect(rawCount("no cap here", cap)).toBe(0);
  });

  test("the cap's digits appear in the guard module and NOWHERE else under tests/", () => {
    // Measured before this FR: three definitions — one exported constant plus
    // two hardcoded literals in a consumer that does not import it.
    const cap = String(AC9_WINDOW);
    const offenders = tsFilesUnder(TESTS_DIR)
      .map((p) => ({
        file: p.slice(TESTS_DIR.length + 1),
        count: rawCount(readFileSync(p, "utf8"), cap),
      }))
      .filter((r) => r.count > 0 && r.file !== "_ac9-row-guard.ts");
    expect(offenders).toEqual([]);
    // …and the module itself carries exactly one, which is the definition.
    expect(rawCount(readFileSync(GUARD_MODULE, "utf8"), cap)).toBe(1);
  });

  test("the consumer that hardcoded it now reads the definition", () => {
    const suite = read(SUITE_448);
    expect(suite).not.toBeNull();
    expect(suite!).toContain("./_ac9-row-guard");
    // RE-AIMED AT THE PROPERTY, NOT AT ONE IMPLEMENTATION OF IT.
    // The AC states "the cap resolves from exactly ONE definition". The first
    // form of this pin required the literal `AC9_WINDOW`, which is only one way
    // to satisfy that — and it BLOCKED the strictly better way: `ac9Window(doc)`
    // encapsulates the same constant AND calls `assertAnchorUnique`, so a
    // consumer using it is more guarded, not less. Measured: consolidating the
    // 448 suite onto the accessor failed EXACTLY this assertion and nothing
    // else, i.e. the guard was rejecting a change that served its own subject.
    //
    // Checked before loosening, because a pin that blocks a fix is sometimes
    // deliberate (M120 recorded a pin weakened that should not have been): the
    // property is carried by the raw-digit scan above plus the import pin on the
    // line before, and neither moves under this dedup. The literal added only
    // "names the constant explicitly", which the accessor satisfies transitively
    // — and the obfuscation the literal might otherwise block (`2 * 1200`, which
    // the digit scan cannot see) is blocked by the accessor too, since it
    // re-derives nothing.
    expect(suite!).toMatch(/AC9_WINDOW|ac9Window\(/);
  });
});

// ══════════════ AC-STE-460.7 — the unfalsifiable assertion is resolved ═══════

describeIfSkills("AC-STE-460.7 — the dead assertion and the dead disjunct are gone", () => {
  test("EXECUTED: no window slice can produce an overrun — the disjunct is unreachable", () => {
    // THE JUSTIFICATION, MEASURED RATHER THAN READ. `win` is
    // `doc.slice(start, start + W)`, so `indexOf` can only return the offset of
    // a COMPLETE in-window match: `endsAt <= W` holds by construction, and an
    // overrun makes `furthest` DECREASE rather than exceed the cap. Proved on
    // synthetic windows first, then on the real one.
    const synthetic: Array<{ w: number; hay: string; needle: string }> = [];
    const alphabet = "abcdefghij";
    for (const w of [1, 5, 10, 64, AC9_WINDOW]) {
      const hay = alphabet.repeat(Math.ceil((w + 20) / alphabet.length)).slice(0, w);
      for (const needle of ["a", "abc", alphabet, alphabet + "k", hay, `${hay}z`]) {
        synthetic.push({ w, hay, needle });
      }
    }
    const overruns = synthetic.filter(({ w, hay, needle }) => {
      const at = hay.indexOf(needle);
      return at !== -1 && at + needle.length > w;
    });
    expect(overruns).toEqual([]);

    // …and on the shipped document with the shipped pins.
    const win = ac9Window(smokeDoc!);
    const real = AC9_DISCLAIMER_PINS.map((p) => {
      const at = win.indexOf(p);
      return { phrase: p, at, endsAt: at === -1 ? -1 : at + p.length };
    });
    expect(real.filter((r) => r.at !== -1 && r.endsAt > AC9_WINDOW)).toEqual([]);
    // Non-vacuity: the sweep above is not scoring an empty set.
    expect(synthetic.length).toBeGreaterThan(20);
    expect(real.every((r) => r.at !== -1)).toBe(true);
  });

  test("the assertion that could not fail no longer ships, and neither does the disjunct", () => {
    for (const path of [GUARD_MODULE, SUITE_448, SUITE_456]) {
      const src = read(path);
      expect(src).not.toBeNull();
      const file = path.slice(TESTS_DIR.length + 1);
      expect({ file, deadAssertion: src!.includes("toBeLessThanOrEqual(AC9_WINDOW)") }).toEqual({
        file,
        deadAssertion: false,
      });
      expect({ file, deadDisjunct: src!.includes("endsAt > AC9_WINDOW") }).toEqual({
        file,
        deadDisjunct: false,
      });
    }
  });
});

// ══════════════ AC-STE-460.9 — the pin documentation matches the array ══════

const COUNT_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

const COUNTED_PIN_REFERENCE =
  /\b(one|two|three|four|five|six|seven|eight|nine|ten)\s+disclaimer\s+pins?\b/gi;

describeIfSkills("AC-STE-460.9 — the pin documentation matches the pin array", () => {
  test("no surviving claim of document order, unless the array really is in document order", () => {
    // Asserted as a CONSISTENCY, not as a ban: either repair is acceptable —
    // reorder the array, or stop claiming an order it does not have. A bare ban
    // would also be satisfied by deleting the comment, which is Pattern 31
    // rider 1's failure mode.
    //
    // Measured today: the claim appears TWICE and the array's window offsets are
    // 15, 1759, 2136, 2252, 435, 830 — the last two run backwards.
    const src = read(GUARD_MODULE);
    expect(src).not.toBeNull();
    const claims = (src!.match(/in document order/g) ?? []).length;
    const win = ac9Window(smokeDoc!);
    const offsets = AC9_DISCLAIMER_PINS.map((p) => win.indexOf(p));
    expect(offsets.every((o) => o > -1)).toBe(true); // the measurement is real
    const inDocumentOrder = offsets.every((o, i) => i === 0 || o > offsets[i - 1]!);
    // THE ORDER IS ASSERTED OUTRIGHT, not merely required to agree with the prose.
    // Measured during this FR's audit: the pair-shape below is satisfiable by
    // scrambling the array back to append order AND rewording the claim to "in
    // SOME order" — 158 pass / 0 fail. Every consumer is order-independent
    // (Math.max / filter / map, no index access), so nothing else would notice;
    // the property survives only if something states it. The module's own prose
    // calls the order load-bearing — "it makes the trailing entry really the
    // trailing one" — and the neighbouring notes about "the last pin" are read by
    // humans who cannot run Math.max. So the claim has to be true, not consistent.
    expect({ inDocumentOrder }).toEqual({ inDocumentOrder: true });
    expect({ claimsDocumentOrder: claims > 0, inDocumentOrder }).not.toEqual({
      claimsDocumentOrder: true,
      inDocumentOrder: false,
    });
  });

  test("the pin array's doc block is not DUPLICATED with a stale copy beside it", () => {
    // Two blocks head the same array today; the first describes a FIVE-element
    // list while the array holds six. A reader who stops at the first block is
    // reading documentation for a different array.
    const src = read(GUARD_MODULE);
    expect(src).not.toBeNull();
    expect(src!.split("Every phrase the row's disclaimer pins read").length - 1).toBe(1);
  });

  test("every counted reference to the pin set agrees with the array's length", () => {
    // THE THIRD MEASURED DISCREPANCY: the same set is six in the array, three in
    // one test comment (which asserts four), and five in the follow-ups note.
    // Counted across all three surfaces at once, because a count that is right
    // in one file and wrong in another is what a per-file pin cannot see.
    const surfaces = [GUARD_MODULE, SUITE_448, FOLLOW_UPS];
    const wrong: Array<{ file: string; said: string }> = [];
    for (const path of surfaces) {
      const src = read(path);
      expect({ file: path, found: src !== null }).toEqual({ file: path, found: true });
      for (const m of src!.matchAll(COUNTED_PIN_REFERENCE)) {
        if (COUNT_WORDS[m[1]!.toLowerCase()] !== AC9_DISCLAIMER_PINS.length) {
          wrong.push({ file: path.slice(REPO_ROOT.length + 1), said: m[0]! });
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  test("the count scan can SEE a wrong count — it is not a regex that matches nothing", () => {
    // Non-vacuity on the instrument. A scan blind to its subject would report
    // agreement for any repository, which is the failure the FR's own AC.10
    // names one level up.
    const hits = [...`the two disclaimer pins above`.matchAll(COUNTED_PIN_REFERENCE)].map(
      (m) => m[1]!,
    );
    expect(hits).toEqual(["two"]);
    expect(COUNT_WORDS[hits[0]!]).not.toBe(AC9_DISCLAIMER_PINS.length);
  });
});
