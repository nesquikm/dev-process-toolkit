// M121 / STE-455 — "Correct the tracker-less plan/FR id equality clause — it is
// unsatisfiable in general".
//
// STE-448 AC.8 shipped a Phase 4 verify row demanding the milestone plan's
// minted identity be **byte-identical to the FR's**. The 2026-08-08 conformance
// run — the first live execution of that row — produced two consecutive
// monotonic mints differing in their final character. That is a near-miss, and
// the near-miss is not the finding. The finding is that the clause is
// UNSATISFIABLE IN GENERAL: one plan id cannot equal two different FR ids, so a
// two-FR milestone can never satisfy it. The shipped enforcing contract (gate
// probe #73) requires only self-derivation and says nothing about equality with
// any FR — it could not. The criterion was wrong and the code was right.
//
// WHAT THIS FILE IS FOR. The predecessor's pin was correctly anchored,
// mutation-verified and non-vacuous — and it was guarding a requirement no
// healthy run could meet. So the coverage here is deliberately of a different
// shape than "the pin is anchored":
//
//   * the clause is GONE and the surviving half is verbatim (AC-STE-455.2),
//   * the pin is RE-ANCHORED, not deleted, on a phrase measured unique
//     (AC-STE-455.3),
//   * the pinning test's own title stops advertising the deleted requirement
//     (AC-STE-455.4),
//   * the narrowing is falsifiable in BOTH DIRECTIONS — the distinguishing
//     mutation reddens the NEW pin while leaving the OLD one green, and the
//     converse mutation does the opposite (AC-STE-455.6),
//   * the generality claim is EXECUTED against a constructed two-FR
//     tracker-less milestone rather than argued in prose (AC-STE-455.7).
//
// AC-STE-455.6 is the load-bearing one. A mutation that reddens both pins would
// prove nothing about which pin is doing the work; the asymmetry is the proof
// that the re-anchor bit rather than blinded.

import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { milestoneIdFromUlid } from "../adapters/_shared/src/milestone_token";
import { mintId } from "../adapters/_shared/src/ulid";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");
const SMOKE_SKILL = join(REPO_ROOT, ".claude/skills/smoke-test/SKILL.md");
// AC-STE-459.2 / .4 — live-then-archive, the house conditional already shipped
// at `m108-ste-393-docs-pins.test.ts:99` and `m114-ste-416-…:203`. Before
// STE-459 this constant was live-only, so archiving the milestone made
// `describeIfSpecs` fire and the AC-STE-455.5 block skipped SILENTLY — a bare
// `describe.skip` with no reason in the title, indistinguishable from a test
// somebody disabled on purpose, while the suite went on reporting green.
const FR_448_ACTIVE = join(REPO_ROOT, "specs/frs/STE-448.md");
const FR_448_ARCHIVED = join(REPO_ROOT, "specs/frs/archive/STE-448.md");
const FR_448 = existsSync(FR_448_ACTIVE) ? FR_448_ACTIVE : FR_448_ARCHIVED;
/** The file that carries the pin under correction. Read as TEXT, never imported. */
const PIN_FILE = join(import.meta.dir, "m121-ste-448-mode-none-leg.test.ts");

function read(path: string): string | null {
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

// Dogfood-only surfaces: a plugin-only checkout carries neither the driver skill
// nor the repo's own specs, so those suites skip cleanly. Same idiom as the
// sibling m121 suites.
const smokeDoc = read(SMOKE_SKILL);
const fr448 = read(FR_448);
const pinSrc = read(PIN_FILE);

const describeIfSkills = smokeDoc === null ? describe.skip : describe;
const describeIfSpecs = fr448 === null ? describe.skip : describe;
const describeIfPin = pinSrc === null ? describe.skip : describe;
const describeIfBoth =
  smokeDoc === null || pinSrc === null ? describe.skip : describe;

// ───────────────────────────── the two clauses ──────────────────────────────
//
// Named once. `EQUALITY_CLAUSE` is the DELETED half — quoted here as the
// experimental control for AC-STE-455.6, which needs to be able to place it
// somewhere other than the row. `SELF_DERIVATION` is the SURVIVING half, quoted
// verbatim from the row so that "survives verbatim" is checked against the
// bytes and not against a paraphrase.

const EQUALITY_CLAUSE = "byte-identical to the FR's";
const SELF_DERIVATION =
  "its own filename stem equals `M_` + `id.slice(23, 29)`";

/** Row boundaries. Both markers measured unique in the smoke driver. */
const ROW_START = "**AC-STE-448.8 — the plan's minted identity";
const ROW_END = "**AC-STE-448.9 — the release proof";

const count = (haystack: string, needle: string): number =>
  haystack.split(needle).length - 1;

/**
 * The AC.8 verify row, sliced by its own bolded heading rather than by a bare
 * `AC-STE-448.8` token — that token has a second satisfier ~77 lines above (a
 * fixture-group cross-reference), and `indexOf` would silently land on it. The
 * uniqueness of the marker is asserted, not assumed: this is the § 0i class the
 * predecessor FR was bitten by twice.
 */
function ac8Row(doc: string): string {
  expect(count(doc, ROW_START), "the AC.8 row marker must be unique").toBe(1);
  expect(count(doc, ROW_END), "the AC.9 row marker must be unique").toBe(1);
  const start = doc.indexOf(ROW_START);
  const end = doc.indexOf(ROW_END, start);
  expect(end).toBeGreaterThan(start);
  return doc.slice(start, end);
}

// ═════════════════════════════ AC-STE-455.2 ═════════════════════════════════

describeIfSkills("AC-STE-455.2 — the equality clause leaves the Phase 4 row", () => {
  test("the equality clause appears NOWHERE in the smoke driver", () => {
    // REDDENED BY: the row as shipped by STE-448. The phrase was measured to
    // occur exactly once in the document, in this row, so a count of zero is a
    // whole-document statement and not a scoped one.
    expect(count(smokeDoc!, EQUALITY_CLAUSE)).toBe(0);
  });

  test("the row itself states no id-equality requirement, in any of its wordings", () => {
    // Scoped to the row, because the clause had three parts and dropping only
    // the memorable one would leave the requirement standing: the row said the
    // plan carries "the **same** `id:` value **verbatim** — byte-identical to
    // the FR's, not merely the same tail". All three go together.
    //
    // `verbatim` is banned INSIDE THE ROW ONLY. It occurs nine times in the
    // driver, the first ~1240 lines above here; a document-wide ban would be
    // both wrong and unenforceable.
    const row = ac8Row(smokeDoc!);
    expect(row).not.toContain(EQUALITY_CLAUSE);
    expect(row).not.toContain("not merely the same tail");
    expect(row).not.toMatch(/\bverbatim\b/);
  });

  test("the surviving self-derivation half is verbatim, and still in this row", () => {
    // The other direction of the same AC, and the one that stops "delete the
    // clause" from being satisfied by deleting the row. Byte-exact.
    expect(count(smokeDoc!, SELF_DERIVATION)).toBe(1);
    const row = ac8Row(smokeDoc!);
    expect(row).toContain(SELF_DERIVATION);
    // The row's two other load-bearing sentences, which the edit must not take
    // with it: the artifact path, and the recompute-don't-substring instruction.
    expect(row).toContain("specs/plan/M_<PLAN-TAIL>.md");
    // REBOUND, and the rebinding is the point rather than a rename.
    //
    // The row used to say `specs/plan/M_<TAIL>.md`, and `<TAIL>` is bound by
    // the AC-STE-448.7 row directly ABOVE as the FR's filename stem. Under the
    // deleted equality clause that was coherent — same id implies same tail.
    // With equality gone the row's own next clause says the plan mints
    // independently, so the old path contradicted itself three clauses later
    // and pointed the operator at a file a healthy run does not produce: on the
    // run that prompted this correction the FR was `3Y2FQW` and the plan
    // `M_3Y2FQV`. The row survived its own correction still stating a rule the
    // correction had just refuted.
    //
    // So the forward form is pinned AND the stale one is banned — a ban alone
    // would be satisfied by deleting the path entirely.
    expect(row).not.toContain("specs/plan/M_<TAIL>.md");
    expect(row).toContain("Recompute the stem from the id read out of the file");
  });

  test("the row does not point at a 'second half' that no longer exists", () => {
    // REDDENED BY: leaving the surrounding prose untouched. The row explains
    // itself with "The second half is the load-bearing one" — an ordinal that
    // counted the deleted clause as the first half. With one half left the
    // sentence is a dangling reference, which is the same defect class as a
    // verify row passing for a reason other than the one it states.
    const row = ac8Row(smokeDoc!);
    expect(row).not.toMatch(/\bsecond half\b/i);
    // …but the rationale itself must survive the rewording. Deleting the
    // sentence outright would satisfy the line above and lose the argument for
    // why the row is not a duplicate of AC.7's.
    expect(row).toMatch(/load-bearing/);
    expect(row).toMatch(/not a duplicate of the row above/);
  });

  test("REGRESSION GUARD: the FR half of this AC, landed ahead of the code", () => {
    // Green by construction — AC-STE-455.1 required the spec correction to land
    // in its own `docs(specs)` commit BEFORE any skill or test edit. This holds
    // it there.
    if (fr448 === null) return;
    // The phrase survives in the FR — in the correction block and the
    // superseded note, which QUOTE it. Only the criterion line loses it.
    expect(count(fr448, EQUALITY_CLAUSE)).toBeGreaterThanOrEqual(1);
    const ac8Line = fr448
      .split(/\r?\n/)
      .find((l) => l.startsWith("- AC-STE-448.8:"));
    expect(ac8Line).toBeDefined();
    expect(ac8Line!).not.toContain(EQUALITY_CLAUSE);
    expect(ac8Line!).not.toMatch(/\bverbatim\b/);
    expect(ac8Line!).toContain("self-derives its own filename from its own recorded");
  });
});

// ═════════════════════════════ AC-STE-455.5 ═════════════════════════════════

describeIfSpecs("AC-STE-455.5 — the superseded note is annotated, not deleted", () => {
  test("the implementation note describing the old pin survives, marked SUPERSEDED", () => {
    // Green by construction (landed in the same `docs(specs)` commit). A
    // standing guard, because the temptation on the next pass is to delete a
    // paragraph that now describes a requirement nobody has to meet — and what
    // it records is the measurement, which is the record.
    const notes = fr448!.slice(fr448!.indexOf("## Implementation notes"));
    expect(notes).toContain(EQUALITY_CLAUSE);
    expect(notes).toMatch(/SUPERSEDED by STE-455/);
    expect(notes).toMatch(/A pin can be perfect and still be worthless/);
  });
});

// ═════════════════════════════ AC-STE-455.3 ═════════════════════════════════
//
// The pin is read out of the sibling suite as TEXT. Nothing here restates what
// the pin should say — the anchor is EXTRACTED, and every measurement below
// (uniqueness, location, falsifiability) runs against whatever literal the pin
// actually uses. A hand-copied anchor would drift silently.

const PIN_CALL_RE =
  /smokeDoc!\.split\(\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|`([^`]*)`)\s*\)\.length\s*-\s*1/;

/** The AC.8 suite's source, from its `describeIfSkills(` to the next one. */
function ac8Suite(src: string): string {
  const start = src.indexOf('describeIfSkills("AC-STE-448.8');
  expect(start).toBeGreaterThan(0);
  const rest = src.slice(start + 1);
  const next = rest.indexOf("\ndescribeIfSkills(");
  return next < 0 ? rest : rest.slice(0, next);
}

/** The occurrence-count pin's anchor literal, unescaped to its runtime value. */
function pinAnchor(src: string): string {
  const suite = ac8Suite(src);
  // EXACTLY ONE, not the first. `PIN_CALL_RE.exec` takes the first match, so a
  // second occurrence-count pin added earlier in the suite would silently
  // redirect every AC.3 and AC.6 measurement onto it — the measurements would
  // keep passing while no longer describing the pin under test. Identity by
  // position, which is the defect class this milestone removes.
  const all = suite.match(new RegExp(PIN_CALL_RE.source, "g")) ?? [];
  expect(
    all.length,
    "AC.8 must carry exactly one occurrence-count pin, or extraction is ambiguous",
  ).toBe(1);
  const m = PIN_CALL_RE.exec(suite);
  expect(m, "AC.8 must still carry an occurrence-count pin over the driver").not.toBeNull();
  const raw = m![1] ?? m![2] ?? m![3]!;
  return raw.replace(/\\(.)/g, "$1");
}

describeIfPin("AC-STE-455.3 — the pin is re-anchored, never deleted", () => {
  test("the new anchor is a substring of the SURVIVING self-derivation half", () => {
    // AC.3's actual wording is "re-anchored onto the surviving self-derivation
    // half". Until now that was enforced only TRANSITIVELY, by AC.6's
    // distinguishing mutation in a different suite — an anchor on, say,
    // "Recompute the stem from the id read out of the file" is unique, sits
    // inside the row, and satisfies every other assertion here while guarding
    // the wrong sentence. The teeth existed; they lived somewhere else, and an
    // AC whose enforcement is elsewhere reads as unenforced to anyone auditing
    // this suite.
    expect(SELF_DERIVATION).toContain(pinAnchor(pinSrc!));
  });

  test("the occurrence-count pin still exists and still expects exactly one", () => {
    // "Never deleted" is half the AC. A re-anchor that dropped the count and
    // left a bare `toContain` would weaken the guard while looking like a fix.
    const suite = ac8Suite(pinSrc!);
    expect(PIN_CALL_RE.test(suite)).toBe(true);
    const after = suite.slice(suite.search(PIN_CALL_RE));
    expect(after.slice(0, 400)).toMatch(/\.toBe\(1\)/);
  });

  test("the anchor is no longer the deleted equality clause", () => {
    // REDDENED BY: the pin as shipped, which splits on `byte-identical to the
    // FR's` — a phrase the corrected row does not contain, so the pin would be
    // guarding a string that can never appear.
    expect(pinAnchor(pinSrc!)).not.toBe(EQUALITY_CLAUSE);
  });
});

describeIfBoth("AC-STE-455.3 — the new anchor's uniqueness is MEASURED", () => {
  test("the anchor occurs exactly once in the smoke driver", () => {
    // The predecessor's failure mode, restated so it cannot recur: the pin
    // before last was a document-wide word match satisfied ~1240 lines above
    // the row it guarded. Uniqueness is asserted against the real document
    // here rather than asserted in a comment.
    expect(count(smokeDoc!, pinAnchor(pinSrc!))).toBe(1);
  });

  test("that one occurrence is INSIDE the AC.8 row", () => {
    // Unique is not the same as correctly placed. A phrase occurring once, in
    // some other section, would pass the count and guard nothing.
    const anchor = pinAnchor(pinSrc!);
    expect(ac8Row(smokeDoc!)).toContain(anchor);
  });
});

// ═════════════════════════════ AC-STE-455.4 ═════════════════════════════════

describeIfPin("AC-STE-455.4 — the pinning test's title stops naming the deleted requirement", () => {
  test("no test title under AC.8 advertises a verbatim-id requirement", () => {
    // REDDENED BY: the shipped title, "PROSE: the row names the plan path and
    // the verbatim-id requirement". A title is the first thing a reader trusts
    // about what a green suite proved; one naming a requirement that has been
    // withdrawn is a false statement the test run repeats on every pass.
    const titles = [...ac8Suite(pinSrc!).matchAll(/\btest\(\s*(["'`])((?:\\.|(?!\1).)*)\1/g)].map(
      (m) => m[2]!,
    );
    // Non-vacuity: if the title scrape ever stopped matching, an empty list
    // would satisfy the loop below silently.
    expect(titles.length).toBeGreaterThanOrEqual(4);
    for (const title of titles) {
      expect(title, `AC.8 test title still names the deleted clause: ${title}`).not.toMatch(
        /verbatim/i,
      );
    }
  });
});

// ═════════════════════════════ AC-STE-455.6 ═════════════════════════════════
//
// FALSIFIABILITY, BOTH DIRECTIONS, per Pattern 31's rider. Two mutations are
// applied to the real document and both pins are evaluated against each. The
// point is the ASYMMETRY: a mutation that reddened both pins would show only
// that the document changed, not that the narrowing moved the guard onto the
// surviving clause.
//
//   mutation                                     | OLD pin | NEW pin
//   ---------------------------------------------|---------|---------
//   delete the self-derivation half from the row, |  GREEN  |   RED
//     equality phrase left present elsewhere      |         |
//   delete the equality phrase everywhere,        |   RED   |  GREEN
//     self-derivation half left in the row        |         |

describeIfBoth("AC-STE-455.6 — falsifiability, measured in BOTH directions", () => {
  /**
   * The document as the correction leaves it, computed rather than assumed, so
   * the experiment is well-defined before AND after the edit lands: the
   * equality phrase is stripped wherever it appears (a no-op once the row is
   * corrected), leaving the self-derivation half untouched.
   */
  function equalityStripped(): string {
    const doc = smokeDoc!.split(EQUALITY_CLAUSE).join("");
    expect(count(doc, EQUALITY_CLAUSE)).toBe(0);
    expect(count(doc, SELF_DERIVATION)).toBe(1);
    return doc;
  }

  test("THE DISTINGUISHING MUTATION: old pin GREEN, new pin RED", () => {
    // Delete the self-derivation half FROM THE ROW while the equality phrase is
    // present somewhere else in the document. This is the mutation the whole
    // correction turns on, and it is the one input that separates the two pins.
    //
    // REDDENED BY: a pin still anchored on the equality clause. Under that pin
    // the injected control satisfies the count and the mutation passes — which
    // is exactly the state this FR exists to leave behind.
    const mutant =
      equalityStripped().replace(SELF_DERIVATION, "") +
      `\n\nMutation control, deliberately far from the row: ${EQUALITY_CLAUSE}.\n`;

    // OLD pin — `count(doc, EQUALITY_CLAUSE) === 1`. Satisfied ⇒ GREEN.
    expect(count(mutant, EQUALITY_CLAUSE)).toBe(1);
    // NEW pin — its anchor went with the deleted half. Unsatisfied ⇒ RED.
    expect(count(mutant, pinAnchor(pinSrc!))).toBe(0);
  });

  test("THE CONVERSE MUTATION: old pin RED, new pin GREEN", () => {
    // The other direction, without which "the new pin reddens" is compatible
    // with the new pin simply being stricter about everything. Here the
    // equality phrase is removed and the self-derivation half is left alone:
    // the old pin can no longer find its subject, the new one still can.
    const mutant = equalityStripped();

    // OLD pin expected exactly 1 ⇒ 0 is RED.
    expect(count(mutant, EQUALITY_CLAUSE)).toBe(0);
    // NEW pin ⇒ GREEN.
    expect(count(mutant, pinAnchor(pinSrc!))).toBe(1);
  });

  test("the two mutations are genuinely different documents", () => {
    // Guard against the experiment collapsing: if `SELF_DERIVATION` ever stops
    // matching, `replace` no-ops, both mutants become the same string, and the
    // asymmetry above would be measured over one document twice.
    const stripped = equalityStripped();
    const withoutSelfDerivation = stripped.replace(SELF_DERIVATION, "");
    expect(withoutSelfDerivation).not.toBe(stripped);
    expect(stripped.length - withoutSelfDerivation.length).toBe(SELF_DERIVATION.length);
  });
});

// ═════════════════════════════ AC-STE-455.7 ═════════════════════════════════
//
// THE GENERALITY CLAIM, EXECUTED. The FR's argument is that the deleted clause
// fails in general rather than by one unlucky mint. That is a claim about
// arithmetic over real artifacts, so it is measured over real artifacts: two
// tracker-less FRs and one plan, written to disk, read back, and scored by both
// rules.

function readId(path: string): string {
  const m = /^id:\s*(\S+)\s*$/m.exec(readFileSync(path, "utf8"));
  expect(m, `no frontmatter id: in ${path}`).not.toBeNull();
  return m![1]!;
}

/** The CORRECTED rule: the plan's stem derives from the plan's OWN recorded id. */
function selfDerives(planPath: string): boolean {
  return basename(planPath, ".md") === milestoneIdFromUlid(readId(planPath));
}

/** The DELETED clause: the plan's id is byte-identical to the FR's. */
function idEqualsFr(planPath: string, frPath: string): boolean {
  return readId(planPath) === readId(frPath);
}

function writePlan(root: string, id: string): string {
  const stem = milestoneIdFromUlid(id);
  const path = join(root, "specs", "plan", `${stem}.md`);
  writeFileSync(path, `---\nid: ${id}\nstatus: active\n---\n\n# ${stem}\n`);
  return path;
}

describe("AC-STE-455.7 — the generality claim, measured on a two-FR milestone", () => {
  test("one plan, two tracker-less FRs: self-derivation holds, equality cannot", () => {
    const root = mkdtempSync(join(tmpdir(), "ste455-two-fr-"));
    try {
      mkdirSync(join(root, "specs", "frs"), { recursive: true });
      mkdirSync(join(root, "specs", "plan"), { recursive: true });

      // Two FRs, each naming itself from its own mint — the `mode: none` shape
      // AC-STE-448.7 describes: an `id:`, no `tracker:` block.
      const frIds = [mintId(), mintId()];
      expect(frIds[0]).not.toBe(frIds[1]); // the premise, asserted not assumed
      const frPaths = frIds.map((id) => {
        const path = join(root, "specs", "frs", `${id.slice(23, 29)}.md`);
        writeFileSync(path, `---\nid: ${id}\nstatus: active\n---\n\n# fr\n`);
        return path;
      });

      // The milestone plan, minted independently, named from its own id.
      const planPath = writePlan(root, mintId());

      // THE CORRECTED RULE PASSES.
      expect(selfDerives(planPath)).toBe(true);

      // THE DELETED CLAUSE COULD NOT HAVE — and not because of this particular
      // mint. Force the plan's id to equal each FR in turn: whichever it
      // matches, it fails the other. The clause is satisfiable for at most one
      // FR of the two, so a two-FR milestone can never meet it.
      for (const [i, forcedId] of frIds.entries()) {
        const forcedPlan = writePlan(root, forcedId);
        const satisfied = frPaths.filter((fr) => idEqualsFr(forcedPlan, fr));
        expect(satisfied).toHaveLength(1);
        expect(satisfied[0]).toBe(frPaths[i]!);
        // …while the corrected rule is indifferent to which id was chosen.
        expect(selfDerives(forcedPlan)).toBe(true);
      }

      // And with an independent mint it matches neither.
      expect(frPaths.filter((fr) => idEqualsFr(planPath, fr))).toHaveLength(0);

      // NEGATIVE CONTROL — without it every `selfDerives(...) === true` above
      // is unfalsifiable, and the audit said so in exactly those terms.
      //
      // `writePlan` names the file with `milestoneIdFromUlid(id)`; `selfDerives`
      // re-derives with the SAME function. Same function on both sides means
      // the assertion cannot fail for any state of the toolkit short of a
      // broken `readFileSync`. It is a self-test of a five-line helper wearing
      // the clothes of a property test — STE-448's own § Audit findings names
      // this shape, in this milestone, about this test author.
      //
      // So: a plan whose FILENAME derives from one mint while its RECORDED id
      // is a different mint. That is precisely the regression the row warns
      // about — "a counter, another mint, a stale rename" — and `selfDerives`
      // must return false for it.
      const honestId = mintId();
      const strangerId = mintId();
      expect(honestId).not.toBe(strangerId);
      const mismatched = join(
        root,
        "specs",
        "plan",
        `${milestoneIdFromUlid(strangerId)}.md`,
      );
      writeFileSync(mismatched, `---\nid: ${honestId}\nstatus: active\n---\n\n# plan\n`);
      expect(selfDerives(mismatched)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("the driver states no rule that the two-FR milestone refutes", () => {
    // The measurement above is what makes this assertion more than a duplicate
    // of AC-STE-455.2's: the row is required to drop the clause BECAUSE a
    // legitimate milestone shape has just been shown to violate it. A verify
    // row stating an unsatisfiable predicate fails every healthy run.
    //
    // REDDENED BY: the row as shipped.
    if (smokeDoc === null) return;
    expect(ac8Row(smokeDoc)).not.toContain(EQUALITY_CLAUSE);
  });
});
