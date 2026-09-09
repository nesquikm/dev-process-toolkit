// M_840a06 / STE-578 — "Tracker-orphan import asks before it writes".
//
// Before this FR, § 0.5 of `skills/spec-write/SKILL.md` claimed the tracker-only
// auto-import was "guarded by `existsSync` per STE-135 to avoid clobbering
// local edits". Both halves were false: `adapters/_shared/src/import.ts`
// carries ZERO occurrences of `existsSync` (control: the sibling
// `reconcile_tracker_local.ts` carries 3, so the search fires), and STE-135 is
// the post-STE-76 resolver lookup contract in `resolve.ts`, not a clobber
// guard. The import wrote unconditionally and then pushed a rewritten
// description back to the ticket. § 0.5 now forbids the import outright.
//
// ---------------------------------------------------------------------------
// WHY THE OLD ASSERTIONS ARE DELETED RATHER THAN SATISFIED
// ---------------------------------------------------------------------------
// `tests/spec-write-preamble-reconcile.test.ts:43-48` asserts
// `expect(body).toContain("existsSync")` and `expect(body).toContain("STE-135")`.
// Those are jointly unsatisfiable with AC-STE-578.1. Keeping the token alive
// in the SKILL to keep them green would re-ship a false claim with a green
// suite defending it — this repository's recorded signature failure. AC.3
// below grades the DELETION.
//
// ---------------------------------------------------------------------------
// THE INVARIANT ACs (AC.2, AC.5, AC.6) ARE PAIRED WITH `editLanded()`
// ---------------------------------------------------------------------------
// AC.2, AC.5 and AC.6 are "keep this unchanged" obligations, so every one of
// them is already true at HEAD. Asserted alone they would be six tests that
// can never fail for this FR — green before the edit, green after, certifying
// nothing. Each is therefore paired with `editLanded()`, which is false until
// the false claim is actually removed. Read the pair as its plain meaning:
// "the edit landed AND this invariant survived it". That is what "byte-
// unchanged ACROSS the edit" means, and it is the only form of the assertion
// that can distinguish a careful in-place rewrite from a reflow.
//
// ---------------------------------------------------------------------------
// MEASURED AT HEAD (2026-09-09) — every constant below was measured, not recited
// ---------------------------------------------------------------------------
//   skills/spec-write/SKILL.md          -> 358 split-lines   (`wc -l` + 1)
//   line 111 / index 110                -> the milestone-attachment paragraph
//   line  26 / index  25                -> the whole § 0.5 body paragraph
//   STE tokens in spec-write/SKILL.md   -> 55 / 55           ZERO headroom
//   STE tokens across skills/ (.md)     -> 246 / 246         ZERO headroom
//   runModuleReachabilityProbe(repo)    -> 129 ordered-unreachable, ok: true
//   tests/spec-write-preamble-reconcile -> 6 test blocks, 10 `expect(` calls
//
// The line cap has ZERO headroom, so the § 0.5 fix is an IN-PLACE one-line-for-
// one-line rewrite of line 26. An insert or a delete above line 111 fails AC.2
// even when the total stays 358 — which is why the line-111 anchor is asserted
// by INDEX and not by `toContain`.
//
// The 129-pin is a DOWN-ONLY ratchet. Naming a module path on line 26 raises it
// to 130 (that line's module has no front door), and a raised pin is an
// unfixable GATE FAILED. Hence the no-module-path assertion.
//
// `runModuleReachabilityProbe` is ASYNC. Without `await` it returns a Promise
// whose every field reads `undefined` and every assertion passes vacuously.
// Every reachability assertion below awaits.
//
// Filter by AC with `bun test -t "AC-STE-578.N"`.

import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  ORDERED_UNREACHABLE_PIN,
  runModuleReachabilityProbe,
} from "../adapters/_shared/src/module_reachability";
// Archive-aware. A hardcoded `specs/frs/STE-578.md` goes ENOENT at the archive
// commit — the one transition no gate run precedes (M121/STE-459).
import { readSpecFile } from "./_spec_tree";

// ---------------------------------------------------------------------------
// Paths + measured constants
// ---------------------------------------------------------------------------

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");

const SKILL_PATH = join(PLUGIN_ROOT, "skills", "spec-write", "SKILL.md");
const OLD_TEST_PATH = join(import.meta.dir, "spec-write-preamble-reconcile.test.ts");
const FR_NAME = "STE-578.md";
const GATE_CHECK_PATH = join(PLUGIN_ROOT, "skills", "gate-check", "SKILL.md");
const SKILLS_ROOT = join(PLUGIN_ROOT, "skills");
const ADAPTERS_ROOT = join(PLUGIN_ROOT, "adapters");

/** `adapters/_shared/src/<name>` — every module these pins name lives here. */
const sharedSrc = (name: string): string => join(ADAPTERS_ROOT, "_shared", "src", name);

/** NFR-1. `body.split("\n").length` — `wc -l` plus one. EXACT, not a bound. */
const SKILL_SPLIT_LINES = 358;
/** The milestone-attachment paragraph. 0-based; line 111 in an editor. */
const MILESTONE_ANCHOR_INDEX = 110;
const MILESTONE_ANCHOR =
  "**Milestone attachment (any adapter with `project_milestone: true`";
/** § 0.5's body paragraph. 0-based; line 26 in an editor. */
const SECTION_05_BODY_INDEX = 25;

const SPEC_WRITE_STE_TOKEN_CEILING = 55;
const SKILLS_STE_TOKEN_CEILING = 246;
const STE_TOKEN_RE = /\b(?:AC-)?STE-\d+(?:\.\d+)?\b/g;

/** 6 test blocks at HEAD — the file must not be gutted down to the deletion. */
const OLD_TEST_BLOCKS_AT_HEAD = 6;

const read = (p: string): string => readFileSync(p, "utf-8");
const skill = (): string => read(SKILL_PATH);
const lines = (): string[] => skill().split("\n");

/**
 * A slash-joined identifier ending in `.ts` — the shape probe #81 classifies as
 * an ORDERED module reference. Falsified below against a known module path, so
 * a regex that silently stopped matching cannot read as "no module path here".
 */
const MODULE_PATH_RE = /[A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]*\.ts\b/;

/** § 0.5, sliced from its own heading up to § 0a. Guarded, never a silent "". */
function section05(body: string = skill()): string {
  const start = body.indexOf("### 0.5");
  const end = body.indexOf("### 0a", start + 1);
  if (start < 0) throw new Error("§ 0.5 heading not found — the slicer is broken");
  if (end <= start) throw new Error("§ 0a heading not found after § 0.5");
  return body.slice(start, end);
}

/**
 * FALSE until the false claim is gone from § 0.5. Every invariant pin below is
 * conjoined with this so it cannot pass at HEAD.
 */
function editLanded(): boolean {
  const s = section05();
  return !s.includes("existsSync") && !s.includes("STE-135");
}

function steTokenCount(body: string): number {
  return (body.match(STE_TOKEN_RE) ?? []).length;
}

/** Canonical walk: `.md` files only, matching `tests/m116-ste-418-wiring.test.ts`. */
function steTokensUnder(dir: string): number {
  let count = 0;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      count += steTokensUnder(p);
      continue;
    }
    if (!name.endsWith(".md")) continue;
    count += steTokenCount(read(p));
  }
  return count;
}

/** Every `.ts` under `adapters/`, so "single source of truth" is a real sweep. */
function tsFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      out.push(...tsFilesUnder(p));
      continue;
    }
    if (name.endsWith(".ts")) out.push(p);
  }
  return out;
}

// ===========================================================================
// AC-STE-578.1 — the false claim is gone AND consent is routed
//
// The absence half alone is satisfied by deleting the clause outright, so it
// never ships without its partner: the presence half is asserted in the SAME
// test, not a sibling one that could be skipped or deleted independently.
// ===========================================================================

describe("AC-STE-578.1 — § 0.5 stops citing a guard it does not have", () => {
  test("§ 0.5 carries neither `existsSync` nor `STE-135`, AND still describes the import", () => {
    const s = section05();

    // ABSENCE — the false claim, both halves.
    expect(s, "§ 0.5 still cites `existsSync`").not.toContain("existsSync");
    expect(s, "§ 0.5 still cites `STE-135`").not.toContain("STE-135");

    // PARTNER — the clause was rewritten, not deleted. Without this the
    // absence half is satisfied by an empty section.
    expect(s, "§ 0.5 no longer names the import path").toContain("importFromTracker");
    expect(s.length, "§ 0.5 was gutted rather than rewritten").toBeGreaterThan(200);
  });

  test("§ 0.5 carries an explicit refusal-to-auto-import phrase", () => {
    const s = section05();
    const REFUSAL_RE =
      /\b(never auto-imports?|does not auto-import|do not auto-import|is never auto-imported|are never auto-imported|no auto-import|never auto-imported)\b/i;

    // CONTROL: the regex fires on the shape it is meant to catch, so a
    // no-match below is a missing phrase and not a dead regex.
    expect(
      REFUSAL_RE.test("tracker-only orphans are never auto-imported"),
      "REFUSAL_RE stopped matching its own control string",
    ).toBe(true);

    expect(
      REFUSAL_RE.test(s),
      "§ 0.5 does not state, in words, that a tracker-only orphan is not auto-imported",
    ).toBe(true);
  });

  test("consent routes `resolveInterviewAnswer` -> `requireOrRefuse` with `defaultValue: undefined`", () => {
    const s = section05();

    expect(s, "§ 0.5 does not name the sanctioned answer resolver").toContain(
      "resolveInterviewAnswer",
    );
    expect(s, "§ 0.5 does not route consent through the canonical gate helper").toContain(
      "requireOrRefuse",
    );

    // THE LOAD-BEARING CLAUSE. A `defaultValue` on this gate lets the
    // auto-approve marker resolve as `default-applied` and silently perform
    // the very import this FR removes. `undefined` is what forces the
    // refusal branch.
    expect(
      s,
      "§ 0.5 does not pin `defaultValue: undefined` — a default re-arms the silent import",
    ).toContain("defaultValue: undefined");
  });

  test("the deleted token frees budget rather than breaching it", () => {
    // Both ceilings sit AT the pin with ZERO headroom at HEAD. Deleting the
    // `STE-135` token frees exactly one on both.
    expect(steTokenCount(skill())).toBeLessThanOrEqual(SPEC_WRITE_STE_TOKEN_CEILING);
    expect(steTokensUnder(SKILLS_ROOT)).toBeLessThanOrEqual(SKILLS_STE_TOKEN_CEILING);

    // Paired: at HEAD both are already <= their ceiling, so alone this test
    // could never fail for this FR.
    expect(editLanded(), "the § 0.5 rewrite has not landed").toBe(true);
  });

  test("THE PREMISE — the cited guard really is absent from the import path", () => {
    const importPath = sharedSrc("import.ts");
    const controlPath = sharedSrc("reconcile_tracker_local.ts");

    // CONTROL FIRST: the search fires on a file that does use `existsSync`.
    // Without this, "0 hits" is indistinguishable from a broken read.
    expect(
      (read(controlPath).match(/existsSync/g) ?? []).length,
      "control file no longer uses `existsSync` — this premise needs re-measuring",
    ).toBeGreaterThan(0);

    expect(
      (read(importPath).match(/existsSync/g) ?? []).length,
      "`import.ts` now uses `existsSync` — the claim § 0.5 made may have become true",
    ).toBe(0);
  });
});

// ===========================================================================
// AC-STE-578.2 — the edit is one line for one line
// ===========================================================================

describe("AC-STE-578.2 — zero-headroom, no-shift, no-module-path", () => {
  test(`SKILL.md measures EXACTLY ${SKILL_SPLIT_LINES} split-lines`, () => {
    expect(
      lines().length,
      "the § 0.5 fix inserted or deleted a line — it must be one line for one line",
    ).toBe(SKILL_SPLIT_LINES);
    expect(editLanded(), "the § 0.5 rewrite has not landed").toBe(true);
  });

  test(`the milestone-attachment paragraph still resolves to index ${MILESTONE_ANCHOR_INDEX}`, () => {
    // BY INDEX, not `toContain`: a balanced insert-above + delete-below keeps
    // the total at 358 while shifting every line between. Only the index pins
    // "nothing above line 111 moved".
    const anchor = lines()[MILESTONE_ANCHOR_INDEX];
    expect(anchor, `no line at index ${MILESTONE_ANCHOR_INDEX}`).toBeDefined();
    expect(
      anchor!.trimStart().startsWith(MILESTONE_ANCHOR),
      `index ${MILESTONE_ANCHOR_INDEX} is no longer the milestone-attachment paragraph — ` +
        `content above line 111 shifted. Got: ${anchor!.trimStart().slice(0, 80)}`,
    ).toBe(true);
    expect(editLanded(), "the § 0.5 rewrite has not landed").toBe(true);
  });

  test(`line ${SECTION_05_BODY_INDEX + 1} names NO module path`, () => {
    const line = lines()[SECTION_05_BODY_INDEX];
    expect(line, `no line at index ${SECTION_05_BODY_INDEX}`).toBeDefined();

    // CONTROL: the regex fires on a real module path taken from this same
    // file, so a no-match on line 26 is an absent path and not a dead regex.
    expect(
      MODULE_PATH_RE.test("`adapters/_shared/src/attach_project_milestone.ts`"),
      "MODULE_PATH_RE stopped matching a known module path",
    ).toBe(true);
    expect(
      MODULE_PATH_RE.test(lines()[MILESTONE_ANCHOR_INDEX]!),
      "the control line no longer names a module path — re-measure this pin",
    ).toBe(true);

    // A module path here raises ORDERED_UNREACHABLE_PIN 129 -> 130 (that
    // line's modules have no front door), and the pin is a DOWN-ONLY ratchet:
    // raising it is an unfixable GATE FAILED. Bare backticked function names
    // are free.
    expect(
      MODULE_PATH_RE.test(line!),
      `line ${SECTION_05_BODY_INDEX + 1} names a module path — that raises the ` +
        `ordered-unreachable pin above ${ORDERED_UNREACHABLE_PIN}, a down-only ratchet. ` +
        `Name the helpers as bare backticked function names instead.`,
    ).toBe(false);

    // And the body line really is the § 0.5 paragraph, not some other line
    // that drifted into index 25.
    expect(
      section05().includes(line!.trim()),
      `index ${SECTION_05_BODY_INDEX} is not inside § 0.5 any more`,
    ).toBe(true);
    expect(editLanded(), "the § 0.5 rewrite has not landed").toBe(true);
  });

  test("the ordered-unreachable pin is NOT raised by this edit", async () => {
    // `runModuleReachabilityProbe` is ASYNC. Unawaited it yields a Promise
    // whose fields all read `undefined` and every assertion below passes
    // vacuously. The `await` is the assertion.
    const report = await runModuleReachabilityProbe(REPO_ROOT);

    expect(
      report.orderedUnreachable,
      `measured ${report.orderedUnreachable} against pin ${ORDERED_UNREACHABLE_PIN} — ` +
        `never raise it; re-measure per the probe's own remedy`,
    ).toBe(ORDERED_UNREACHABLE_PIN);
    expect(report.violations.filter((v) => v.severity === "error")).toEqual([]);
    expect(report.ok).toBe(true);
    expect(editLanded(), "the § 0.5 rewrite has not landed").toBe(true);
  }, 120_000);
});

// ===========================================================================
// AC-STE-578.3 — the old assertions are DELETED, not satisfied
// ===========================================================================

describe("AC-STE-578.3 — the false-claim pins are removed from the old test file", () => {
  test("`existsSync` appears ZERO times in tests/spec-write-preamble-reconcile.test.ts", () => {
    const body = read(OLD_TEST_PATH);

    // Note this covers the file's own header comment, which at HEAD narrates
    // "the STE-135 existsSync guard". A test file that documents a claim its
    // subject no longer makes is the same defect one level up.
    expect(
      (body.match(/existsSync/g) ?? []).length,
      "the `existsSync` pin (or its header narration) survives — it must be deleted, not satisfied",
    ).toBe(0);
  });

  test("the `STE-135` substring assertion is gone from that file", () => {
    const body = read(OLD_TEST_PATH);
    expect(
      body,
      "`toContain(\"STE-135\")` survives — the second half of the false pin",
    ).not.toContain('toContain("STE-135")');
  });

  test("the file was edited, not gutted — assertions still outnumber test blocks", () => {
    const body = read(OLD_TEST_PATH);
    const testBlocks = (body.match(/^\s*test\(/gm) ?? []).length;
    const assertions = (body.match(/expect\(/g) ?? []).length;

    expect(
      testBlocks,
      `test blocks dropped below the ${OLD_TEST_BLOCKS_AT_HEAD} present at HEAD — ` +
        `the deleted block must be REPLACED with a falsifiable positive`,
    ).toBeGreaterThanOrEqual(OLD_TEST_BLOCKS_AT_HEAD);
    expect(
      assertions,
      "assertions no longer outnumber test blocks — the file was gutted",
    ).toBeGreaterThan(testBlocks);
    expect(assertions).toBeGreaterThan(OLD_TEST_BLOCKS_AT_HEAD);
  });
});

// ===========================================================================
// AC-STE-578.4 — the reversal is named in the FR, not applied silently
// ===========================================================================

describe("AC-STE-578.4 — the FR names STE-284 and both sides of the decision", () => {
  /**
   * The `## Acceptance Criteria` section is EXCLUDED. AC.4 asks the FR BODY to
   * state the reversal; letting AC.4's own text satisfy AC.4 is circular and
   * would pass at HEAD without a word of narrative being written.
   */
  const frBody = (): string => readSpecFile(REPO_ROOT, "specs/frs", FR_NAME).body;

  function bodyOutsideAcceptanceCriteria(): string {
    const fr = frBody();
    const start = fr.indexOf("## Acceptance Criteria");
    const end = fr.indexOf("\n## ", start + 1);
    if (start < 0) throw new Error("FR has no `## Acceptance Criteria` heading");
    if (end <= start) throw new Error("no section follows `## Acceptance Criteria`");
    return fr.slice(0, start) + fr.slice(end);
  }

  test("the excluding slicer really does drop the AC section", () => {
    // CONTROL. Without it, a slicer that returned the whole file would make
    // every assertion below pass for the wrong reason.
    const outside = bodyOutsideAcceptanceCriteria();
    expect(frBody()).toContain("- AC-STE-578.1:");
    expect(outside, "the slicer did not drop the AC section").not.toContain(
      "- AC-STE-578.1:",
    );
    expect(outside, "the slicer dropped the Notes section too").toContain("## Notes");
  });

  test("STE-284 is named outside the AC list", () => {
    expect(bodyOutsideAcceptanceCriteria()).toContain("STE-284");
  });

  test("the REVERSED decision is named: the silent tracker-to-local import", () => {
    const outside = bodyOutsideAcceptanceCriteria();
    const REVERSED_RE = /\b(silent|automatic|unprompted|unconditional)\b[^.]{0,120}\bimport/i;
    expect(
      REVERSED_RE.test("reverses the silent tracker-to-local import"),
      "REVERSED_RE stopped matching its own control string",
    ).toBe(true);
    expect(
      REVERSED_RE.test(outside),
      "the FR body does not say WHICH STE-284 decision is reversed",
    ).toBe(true);
  });

  test("the PRESERVED invariant is named: the gate probe never mutates", () => {
    const outside = bodyOutsideAcceptanceCriteria();
    const PRESERVED_RE = /\b(preserv|keep|retain|unchanged|still)\w*\b[^.]{0,160}\b(never (mutat|writ)|read-only|does not mutat|no mutat)/i;
    expect(
      PRESERVED_RE.test("preserves the invariant that the gate probe never mutates"),
      "PRESERVED_RE stopped matching its own control string",
    ).toBe(true);
    expect(
      PRESERVED_RE.test(outside),
      "the FR body does not name the PRESERVED STE-284 invariant (the probe never mutates)",
    ).toBe(true);
  });
});

// ===========================================================================
// AC-STE-578.5 — the untouched neighbours. Pinned SEPARATELY, per the AC.
// ===========================================================================

describe("AC-STE-578.5 — neighbouring clauses survive the edit", () => {
  test("(a) local-only orphans + milestone mismatches keep their prompt clause BYTE-unchanged", () => {
    // The exact bytes from HEAD's line 26. Not a paraphrase-tolerant regex:
    // the AC says byte-unchanged, so this is a byte comparison.
    const CLAUSE =
      "local-only orphans and milestone mismatches prompt the user to resolve before continuing";
    expect(
      section05(),
      "the local-only / milestone-mismatch prompt clause was reworded or dropped",
    ).toContain(CLAUSE);
    expect(editLanded(), "the § 0.5 rewrite has not landed").toBe(true);
  });

  test("(b) mode-none stays vacuous", () => {
    expect(
      section05(),
      "§ 0.5 no longer declares itself vacuous under `mode: none`",
    ).toContain("mode-none vacuous");
    expect(editLanded(), "the § 0.5 rewrite has not landed").toBe(true);
  });

  test("(c) § 0.5 keeps its position between § 0 and § 0a", () => {
    const body = skill();
    const idx0 = body.search(/^###\s*0\.\s/m);
    const idx05 = body.search(/^###\s*0\.5\b/m);
    const idx0a = body.search(/^###\s*0a\b/m);

    expect(idx0, "§ 0 heading not found").toBeGreaterThanOrEqual(0);
    expect(idx05, "§ 0.5 heading not found").toBeGreaterThanOrEqual(0);
    expect(idx0a, "§ 0a heading not found").toBeGreaterThanOrEqual(0);
    expect(idx05, "§ 0.5 no longer follows § 0").toBeGreaterThan(idx0);
    expect(idx0a, "§ 0.5 no longer precedes § 0a").toBeGreaterThan(idx05);
    expect(editLanded(), "the § 0.5 rewrite has not landed").toBe(true);
  });
});

// ===========================================================================
// AC-STE-578.6 — the shared helper, the read-only probe, and the emission token
// ===========================================================================

describe("AC-STE-578.6 — the reconciliation contract is untouched", () => {
  test("(a) `reconcileTrackerLocal` is exported from exactly ONE module", () => {
    const definers = tsFilesUnder(ADAPTERS_ROOT).filter((p) =>
      /export\s+(async\s+)?function\s+reconcileTrackerLocal\b/.test(read(p)),
    );
    expect(
      definers.length,
      `reconcileTrackerLocal is defined in ${definers.length} modules — ` +
        `it must stay the single shared source of truth. ${definers.join(", ")}`,
    ).toBe(1);
    expect(definers[0]!.endsWith("/reconcile_tracker_local.ts")).toBe(true);

    // …and § 0.5 still routes through it rather than re-deriving drift.
    expect(section05(), "§ 0.5 stopped naming the shared helper").toContain(
      "reconcileTrackerLocal",
    );
    expect(editLanded(), "the § 0.5 rewrite has not landed").toBe(true);
  });

  test("(b) the /gate-check probe over it still never mutates", () => {
    // Prose contract…
    expect(
      read(GATE_CHECK_PATH),
      "probe #49 dropped its read-only declaration",
    ).toContain("Read-side: never writes");

    // …and the code behind it. A prose pin alone is a claim; the module scan
    // is the witness.
    const probePath = sharedSrc("tracker_local_reconciliation_drift.ts");
    for (const p of [probePath, sharedSrc("reconcile_tracker_local.ts")]) {
      const src = read(p);
      for (const mutator of ["writeFileSync", "unlinkSync", "mkdirSync", "importFromTracker"]) {
        expect(src, `${p} now calls ${mutator} — the probe path must stay read-only`).not.toContain(
          mutator,
        );
      }
    }
    expect(editLanded(), "the § 0.5 rewrite has not landed").toBe(true);
  });

  test("(c) the `tracker_local_reconciled` emission contract is untouched", () => {
    // Still a registered closing-summary capability key…
    expect(
      read(sharedSrc("closing_summary_capability_keys.ts")),
    ).toContain("tracker_local_reconciled");

    // …still rendered by /gate-check…
    expect(read(GATE_CHECK_PATH)).toContain("tracker_local_reconciled");

    // …and still owed by /spec-write on the >= 1 imported case. Consent
    // gating WHETHER an import happens must not change WHAT is emitted when
    // one does.
    const specWrite = skill();
    expect(specWrite).toContain("tracker_local_reconciled");
    expect(specWrite).toContain(
      "MUST emit `tracker_local_reconciled` whenever ≥ 1 FR or milestone is imported",
    );
    expect(editLanded(), "the § 0.5 rewrite has not landed").toBe(true);
  });
});
